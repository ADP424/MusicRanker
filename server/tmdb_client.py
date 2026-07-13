"""TMDB HTTP access: shared rate limiter + an on-disk sidecar cache.

One sidecar SQLite file holds three things:

  http_cache       raw TMDB JSON, keyed by path+params, with a TTL and the
                   response ETag for conditional revalidation
  kv               small key/value store.  Currently the movie.id -> tmdb_id
                   map, which is how we avoid adding a tmdb_id column to Movie
  scan_rejections  (person_id, movie_id, slot) triples the user explicitly
                   rejected, so the scanner stops resurfacing them

Unlike the standalone script there is NO in-memory L1 cache: this process is
long-lived and credits payloads are 30-100 KB each, so we read through to
SQLite every time (~0.1 ms) rather than growing the heap without bound.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv

load_dotenv()

TMDB_BASE = "https://api.themoviedb.org/3"

_REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = Path(os.environ.get("TMDB_CACHE_PATH", _REPO_ROOT / "tmdb_cache.sqlite3"))

REQ_PER_SEC = float(os.environ.get("TMDB_RPS", "20"))
BURST = int(os.environ.get("TMDB_BURST", "40"))
WORKERS = int(os.environ.get("TMDB_WORKERS", "8"))

TTL_SEARCH = 365 * 24 * 3600  # title+year -> tmdb id never really changes
TTL_CREDITS = 30 * 24 * 3600  # credits change very rarely
TTL_NEGATIVE = 7 * 24 * 3600  # "TMDB has no such movie"


# ──────────────────────────────────────────────────────────────
#  Sidecar store
# ──────────────────────────────────────────────────────────────
class Sidecar:
    _DDL = """
    CREATE TABLE IF NOT EXISTS http_cache (
        key        TEXT PRIMARY KEY,
        etag       TEXT,
        payload    TEXT NOT NULL,
        expires_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        expires_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scan_rejections (
        person_id  INTEGER NOT NULL,
        movie_id   INTEGER NOT NULL,
        slot       TEXT    NOT NULL,
        created_at REAL    NOT NULL,
        PRIMARY KEY (person_id, movie_id, slot)
    );
    """

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        # One connection shared across the scan's worker threads; every access
        # is serialised by _lock, which is cheap relative to the HTTP calls.
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.executescript(self._DDL)
        self._db.commit()

    # -- http_cache --------------------------------------------------
    def http_get(self, key: str) -> tuple[Optional[Any], Optional[str], bool]:
        """-> (payload | None, etag | None, fresh)"""
        with self._lock:
            row = self._db.execute(
                "SELECT payload, etag, expires_at FROM http_cache WHERE key = ?",
                (key,),
            ).fetchone()
        if row is None:
            return None, None, False
        return json.loads(row[0]), row[1], time.time() < row[2]

    def http_set(self, key: str, payload: Any, etag: Optional[str], ttl: float) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO http_cache VALUES (?, ?, ?, ?)",
                (key, etag, json.dumps(payload), time.time() + ttl),
            )
            self._db.commit()

    def http_touch(self, key: str, ttl: float) -> None:
        """Extend expiry after a 304 Not Modified."""
        with self._lock:
            self._db.execute(
                "UPDATE http_cache SET expires_at = ? WHERE key = ?",
                (time.time() + ttl, key),
            )
            self._db.commit()

    # -- kv ----------------------------------------------------------
    def kv_get(self, key: str) -> Any:
        with self._lock:
            row = self._db.execute("SELECT value, expires_at FROM kv WHERE key = ?", (key,)).fetchone()
        if row is None or time.time() >= row[1]:
            return None
        return json.loads(row[0])

    def kv_set(self, key: str, value: Any, ttl: float) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO kv VALUES (?, ?, ?)",
                (key, json.dumps(value), time.time() + ttl),
            )
            self._db.commit()

    # -- rejections --------------------------------------------------
    def rejections(self) -> set[tuple[int, int, str]]:
        with self._lock:
            rows = self._db.execute("SELECT person_id, movie_id, slot FROM scan_rejections").fetchall()
        return {(r[0], r[1], r[2]) for r in rows}

    def rejections_detailed(self) -> list[tuple[int, int, str, float]]:
        with self._lock:
            return self._db.execute(
                "SELECT person_id, movie_id, slot, created_at " "FROM scan_rejections ORDER BY created_at DESC"
            ).fetchall()

    def add_rejections(self, items: Iterable[tuple[int, int, str]]) -> int:
        items = list(items)
        if not items:
            return 0
        now = time.time()
        with self._lock:
            before = self._db.total_changes
            self._db.executemany(
                "INSERT OR IGNORE INTO scan_rejections VALUES (?, ?, ?, ?)",
                [(p, m, s, now) for p, m, s in items],
            )
            self._db.commit()
            return self._db.total_changes - before

    def remove_rejections(self, items: Iterable[tuple[int, int, str]]) -> int:
        items = list(items)
        if not items:
            return 0
        with self._lock:
            before = self._db.total_changes
            self._db.executemany(
                "DELETE FROM scan_rejections " "WHERE person_id = ? AND movie_id = ? AND slot = ?",
                items,
            )
            self._db.commit()
            return self._db.total_changes - before

    def clear_rejections(self) -> None:
        with self._lock:
            self._db.execute("DELETE FROM scan_rejections")
            self._db.commit()


_sidecar: Optional[Sidecar] = None
_sidecar_lock = threading.Lock()


def get_sidecar() -> Sidecar:
    global _sidecar
    if _sidecar is None:
        with _sidecar_lock:
            if _sidecar is None:
                _sidecar = Sidecar(CACHE_PATH)
    return _sidecar


# ──────────────────────────────────────────────────────────────
#  Rate limiting + client
# ──────────────────────────────────────────────────────────────
class _TokenBucket:
    def __init__(self, rate: float, burst: int):
        self.rate, self.cap = rate, float(burst)
        self.tokens = float(burst)
        self.ts = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self.lock:
                now = time.monotonic()
                self.tokens = min(self.cap, self.tokens + (now - self.ts) * self.rate)
                self.ts = now
                if self.tokens >= 1.0:
                    self.tokens -= 1.0
                    return
                wait = (1.0 - self.tokens) / self.rate
            time.sleep(wait)


_BUCKET = _TokenBucket(REQ_PER_SEC, BURST)

_SESSION = requests.Session()
_SESSION.mount(
    "https://",
    requests.adapters.HTTPAdapter(pool_connections=WORKERS, pool_maxsize=WORKERS),
)


def _bearer() -> str:
    token = os.environ.get("TMDB_BEARER_TOKEN")
    if not token:
        raise RuntimeError("TMDB_BEARER_TOKEN is not set")
    return token


class TmdbClient:
    """Per-scan wrapper: shared session/bucket/sidecar, per-scan counters."""

    def __init__(self, sidecar: Sidecar, *, force_refresh: bool = False):
        self.sidecar = sidecar
        self.force_refresh = force_refresh
        self._headers = {
            "Authorization": f"Bearer {_bearer()}",
            "accept": "application/json",
        }
        self._stats_lock = threading.Lock()
        self.network_calls = 0
        self.cache_hits = 0
        self.revalidated = 0

    def _bump(self, attr: str) -> None:
        with self._stats_lock:
            setattr(self, attr, getattr(self, attr) + 1)

    def get(
        self,
        path: str,
        params: Optional[dict] = None,
        ttl: float = TTL_CREDITS,
        *,
        allow_network: bool = True,
    ) -> Optional[Any]:
        params = params or {}
        key = f"{path}?{urlencode(sorted(params.items()))}"

        payload, etag, fresh = self.sidecar.http_get(key)
        if payload is not None and fresh and not self.force_refresh:
            self._bump("cache_hits")
            return payload
        if not allow_network:
            # Stale is better than nothing when we're only here for evidence.
            return payload

        headers = dict(self._headers)
        if etag and payload is not None and not self.force_refresh:
            headers["If-None-Match"] = etag

        last_exc: Optional[Exception] = None
        for attempt in range(4):
            _BUCKET.acquire()
            try:
                r = _SESSION.get(f"{TMDB_BASE}{path}", params=params, headers=headers, timeout=20)
            except requests.RequestException as exc:
                last_exc = exc
                time.sleep(1.5**attempt)
                continue

            self._bump("network_calls")

            if r.status_code == 304:
                self._bump("revalidated")
                self.sidecar.http_touch(key, ttl)
                return payload
            if r.status_code == 429:
                time.sleep(float(r.headers.get("Retry-After", 2)) + 0.25)
                continue
            if r.status_code == 404:
                return None
            if r.status_code >= 500:
                time.sleep(1.5**attempt)
                continue

            r.raise_for_status()
            data = r.json()
            self.sidecar.http_set(key, data, r.headers.get("ETag"), ttl)
            return data

        if last_exc:
            raise last_exc
        return payload
