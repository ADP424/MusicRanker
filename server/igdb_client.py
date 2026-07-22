"""IGDB HTTP access: Twitch OAuth token management + shared rate limiter +
an on-disk sidecar cache.

IGDB (api.igdb.com/v4) auth is OAuth2 client-credentials via Twitch, not a
static bearer token: exchange IGDB_CLIENT_ID/IGDB_CLIENT_SECRET for a
short-lived App Access Token, then send it as `Authorization: Bearer` plus
a `Client-ID` header on every request. Queries are POSTed as raw
"Apicalypse" text bodies (not query-string params, not JSON), and IGDB has
no ETag/conditional-GET support, so caching here is TTL-only (no 304
branch, unlike tmdb_client.py).

The sidecar SQLite file holds two things:

  http_cache   raw IGDB JSON, keyed by resource+query, with a TTL
  kv           small key/value store; currently the cached Twitch access
               token + its expiry, so a fresh token isn't fetched on every
               process start
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

IGDB_BASE = "https://api.igdb.com/v4"
TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token"

_REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = Path(os.environ.get("IGDB_CACHE_PATH", _REPO_ROOT / "igdb_cache.sqlite3"))

REQ_PER_SEC = float(os.environ.get("IGDB_RPS", "3"))
BURST = int(os.environ.get("IGDB_BURST", "4"))

TTL_SEARCH = 90 * 24 * 3600  # title -> igdb id rarely changes
TTL_DETAILS = 30 * 24 * 3600  # genres/companies change rarely
TOKEN_SAFETY_MARGIN = 24 * 3600  # refetch a day before Twitch expires it


# ──────────────────────────────────────────────────────────────
#  Sidecar store
# ──────────────────────────────────────────────────────────────
class Sidecar:
    _DDL = """
    CREATE TABLE IF NOT EXISTS http_cache (
        key        TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        expires_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        expires_at REAL NOT NULL
    );
    """

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.executescript(self._DDL)
        self._db.commit()

    def http_get(self, key: str) -> tuple[Optional[Any], bool]:
        """-> (payload | None, fresh)"""
        with self._lock:
            row = self._db.execute(
                "SELECT payload, expires_at FROM http_cache WHERE key = ?",
                (key,),
            ).fetchone()
        if row is None:
            return None, False
        return json.loads(row[0]), time.time() < row[1]

    def http_set(self, key: str, payload: Any, ttl: float) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO http_cache VALUES (?, ?, ?)",
                (key, json.dumps(payload), time.time() + ttl),
            )
            self._db.commit()

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


def _client_id() -> str:
    cid = os.environ.get("IGDB_CLIENT_ID")
    if not cid:
        raise RuntimeError("IGDB_CLIENT_ID is not set")
    return cid


def _client_secret() -> str:
    secret = os.environ.get("IGDB_CLIENT_SECRET")
    if not secret:
        raise RuntimeError("IGDB_CLIENT_SECRET is not set")
    return secret


def _fetch_access_token() -> str:
    resp = _SESSION.post(
        TWITCH_TOKEN_URL,
        params={
            "client_id": _client_id(),
            "client_secret": _client_secret(),
            "grant_type": "client_credentials",
        },
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data["access_token"]
    ttl = max(data.get("expires_in", 0) - TOKEN_SAFETY_MARGIN, 60)
    get_sidecar().kv_set("igdb_access_token", token, ttl)
    return token


def _access_token(*, force_refresh: bool = False) -> str:
    if not force_refresh:
        cached = get_sidecar().kv_get("igdb_access_token")
        if cached:
            return cached
    return _fetch_access_token()


class IgdbClient:
    """Shared session/bucket/sidecar wrapper for one request or batch of requests."""

    def __init__(self, sidecar: Sidecar, *, force_refresh: bool = False):
        self.sidecar = sidecar
        self.force_refresh = force_refresh

    def post(self, resource: str, query: str, ttl: float = TTL_DETAILS) -> Optional[list]:
        key = f"{resource}:{query}"

        payload, fresh = self.sidecar.http_get(key)
        if payload is not None and fresh and not self.force_refresh:
            return payload

        token = _access_token()
        refreshed = False
        last_exc: Optional[Exception] = None
        for attempt in range(4):
            _BUCKET.acquire()
            headers = {
                "Client-ID": _client_id(),
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            }
            try:
                r = _SESSION.post(f"{IGDB_BASE}/{resource}", data=query, headers=headers, timeout=20)
            except requests.RequestException as exc:
                last_exc = exc
                time.sleep(1.5**attempt)
                continue

            if r.status_code == 401:
                # Token expired mid-lifetime (Twitch revoked/rotated) — refetch once
                # and retry. If it's still 401 after that, the credentials themselves
                # are wrong, not just stale: fail loudly instead of burning every
                # remaining attempt re-minting a token IGDB will keep rejecting.
                if refreshed:
                    r.raise_for_status()
                refreshed = True
                token = _access_token(force_refresh=True)
                continue
            if r.status_code == 429:
                time.sleep(2.0)
                continue
            if r.status_code == 404:
                return None
            if r.status_code >= 500:
                time.sleep(1.5**attempt)
                continue

            r.raise_for_status()
            data = r.json()
            self.sidecar.http_set(key, data, ttl)
            return data

        if last_exc:
            raise last_exc
        return payload
