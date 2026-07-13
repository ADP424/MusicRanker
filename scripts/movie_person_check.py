"""
missing_links_scanner.py

Finds movie–person links that should exist in the local database but don't,
by cross-referencing against TMDB.

Scanning is movie-centric and cached:

    Phase 1   local movie  →  tmdb_movie_id         (1 call, cached ~forever)
    Phase 2   /movie/{id}/credits                   (1 call, cached 30 days)
    Phase 3   match people + diff links             (no network at all)

Cold cache costs ~2 calls per *movie*; warm cache costs zero.

Keyboard shortcuts (review screen)
───────────────────────────────────
  1 Lead Actor    4 Director     S      Reject        ↑ ↓  Navigate
  2 Actor         5 Composer     Enter  Accept
  3 Cameo Actor                  Space  Toggle

Usage:
    python missing_links_scanner.py
"""

import json
import os
import re
import sqlite3
import threading
import time
import tkinter as tk
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from tkinter import messagebox, ttk
from typing import Optional
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv

import server.database as _db
from server.database import dispose_engine, init_engine
from server.database_models import CastRole, Movie, MoviePerson, Person

load_dotenv()

# ── Tunables ───────────────────────────────────────────────────
TMDB_BASE = "https://api.themoviedb.org/3"
CACHE_PATH = Path(os.environ.get("TMDB_CACHE", "tmdb_cache.sqlite3"))

REQ_PER_SEC = float(os.environ.get("TMDB_RPS", "20"))  # token-bucket refill
BURST = 40
WORKERS = int(os.environ.get("TMDB_WORKERS", "8"))

TTL_SEARCH = 365 * 24 * 3600  # title+year → id never really changes
TTL_CREDITS = 30 * 24 * 3600  # credits change very rarely
TTL_NEGATIVE = 7 * 24 * 3600  # "TMDB has no such movie"

# If your Movie model ever gains a `tmdb_id` column it is used automatically
# (saving the Phase-1 search entirely) and back-filled after each scan.
HAS_TMDB_ID = hasattr(Movie, "tmdb_id")
PERSIST_TMDB_IDS = HAS_TMDB_ID

WANTED_JOBS = {"Director": CastRole.director, "Original Music Composer": CastRole.composer}
CAST_ROLES = frozenset({CastRole.lead_actor, CastRole.actor, CastRole.cameo_actor})

ROLE_NAMES = ("Lead Actor", "Actor", "Cameo Actor", "Director", "Composer")
ROLE_ENUM = {
    "Lead Actor": CastRole.lead_actor,
    "Actor": CastRole.actor,
    "Cameo Actor": CastRole.cameo_actor,
    "Director": CastRole.director,
    "Composer": CastRole.composer,
}

_CAMEO_RE = re.compile(r"(uncredited|himself|herself|themselves|\bself\b|cameo)", re.I)
_PUNCT_RE = re.compile(r"[:\-–—,.'\"\[\]!?()&/]+")
_WS_RE = re.compile(r"\s+")


# ── Normalisation ──────────────────────────────────────────────
def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _norm_title(s: str) -> str:
    return _WS_RE.sub(" ", _PUNCT_RE.sub(" ", _strip_accents(s).lower())).strip()


def _norm_name(s: str) -> str:
    """Person names: drop accents, punctuation ('J. K. Simmons' → 'j k simmons')."""
    return _WS_RE.sub(" ", _PUNCT_RE.sub(" ", _strip_accents(s).lower())).strip()


# ══════════════════════════════════════════════════════════════
#  Persistent HTTP cache
# ══════════════════════════════════════════════════════════════
class TmdbCache:
    """SQLite-backed response cache + a small key/value store."""

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
    """

    def __init__(self, path: Path):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(self._DDL)
        self._db.commit()
        self._mem: dict[str, tuple] = {}  # in-process L1, avoids sqlite churn

    # -- http_cache --
    def get(self, key):
        """→ (payload|None, etag|None, fresh: bool)"""
        if key in self._mem:
            return self._mem[key]
        with self._lock:
            row = self._db.execute(
                "SELECT payload, etag, expires_at FROM http_cache WHERE key=?",
                (key,),
            ).fetchone()
        if not row:
            return None, None, False
        payload, etag, exp = json.loads(row[0]), row[1], row[2]
        res = (payload, etag, time.time() < exp)
        self._mem[key] = res
        return res

    def set(self, key, payload, etag, ttl):
        exp = time.time() + ttl
        self._mem[key] = (payload, etag, True)
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO http_cache VALUES (?,?,?,?)",
                (key, etag, json.dumps(payload), exp),
            )
            self._db.commit()

    def touch(self, key, ttl):
        """Refresh expiry after a 304 Not Modified."""
        with self._lock:
            self._db.execute(
                "UPDATE http_cache SET expires_at=? WHERE key=?",
                (time.time() + ttl, key),
            )
            self._db.commit()
        if key in self._mem:
            p, e, _ = self._mem[key]
            self._mem[key] = (p, e, True)

    # -- kv (resolved movie ids) --
    def kv_get(self, key):
        with self._lock:
            row = self._db.execute("SELECT value, expires_at FROM kv WHERE key=?", (key,)).fetchone()
        if not row or time.time() >= row[1]:
            return None
        return json.loads(row[0])

    def kv_set(self, key, value, ttl):
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO kv VALUES (?,?,?)",
                (key, json.dumps(value), time.time() + ttl),
            )
            self._db.commit()

    def stats(self):
        with self._lock:
            n = self._db.execute("SELECT COUNT(*) FROM http_cache").fetchone()[0]
        return n


# ══════════════════════════════════════════════════════════════
#  Rate-limited, caching TMDB client
# ══════════════════════════════════════════════════════════════
class _TokenBucket:
    def __init__(self, rate, burst):
        self.rate, self.cap = rate, burst
        self.tokens = float(burst)
        self.ts = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self):
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


class TmdbClient:
    def __init__(self, token, cache, *, force_refresh=False, offline=False):
        self.cache = cache
        self.force_refresh = force_refresh
        self.offline = offline
        self.bucket = _TokenBucket(REQ_PER_SEC, BURST)

        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}", "accept": "application/json"})
        adapter = requests.adapters.HTTPAdapter(pool_connections=WORKERS, pool_maxsize=WORKERS)
        self.s.mount("https://", adapter)

        self._c = threading.Lock()
        self.net = 0  # requests actually sent
        self.hits = 0  # served from cache without any request
        self.revalidated = 0  # 304s

    def _bump(self, field):
        with self._c:
            setattr(self, field, getattr(self, field) + 1)

    def get(self, path, params=None, ttl=TTL_CREDITS):
        params = params or {}
        key = f"{path}?{urlencode(sorted(params.items()))}"

        payload, etag, fresh = self.cache.get(key)
        if payload is not None and fresh and not self.force_refresh:
            self._bump("hits")
            return payload
        if self.offline:
            return payload  # may be stale or None; no network allowed

        headers = {}
        if etag and payload is not None and not self.force_refresh:
            headers["If-None-Match"] = etag

        for attempt in range(4):
            self.bucket.acquire()
            try:
                r = self.s.get(f"{TMDB_BASE}{path}", params=params, headers=headers, timeout=20)
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(1.5**attempt)
                continue

            self._bump("net")

            if r.status_code == 304:
                self._bump("revalidated")
                self.cache.touch(key, ttl)
                return payload
            if r.status_code == 429:
                time.sleep(float(r.headers.get("Retry-After", 2)) + 0.25)
                continue
            if r.status_code >= 500:
                time.sleep(1.5**attempt)
                continue

            r.raise_for_status()
            data = r.json()
            self.cache.set(key, data, r.headers.get("ETag"), ttl)
            return data

        r.raise_for_status()

    def stats(self):
        return {"network": self.net, "cache_hits": self.hits, "revalidated": self.revalidated}


# ══════════════════════════════════════════════════════════════
#  DB snapshot  (3 flat queries — no ORM objects, no N+1)
# ══════════════════════════════════════════════════════════════
@dataclass(slots=True)
class LMovie:
    id: int
    name: str
    name_en: Optional[str]
    year: Optional[int]
    tmdb_id: Optional[int] = None


@dataclass(slots=True)
class LPerson:
    id: int
    name: str
    name_en: Optional[str]


def _load_db():
    with _db.SessionLocal() as db:
        mcols = [Movie.id, Movie.name, Movie.name_en, Movie.release_year]
        if HAS_TMDB_ID:
            mcols.append(Movie.tmdb_id)
        movies = [LMovie(*row) for row in db.query(*mcols).all()]

        people = [LPerson(*row) for row in db.query(Person.id, Person.name, Person.name_en).all()]

        links = db.query(MoviePerson.person_id, MoviePerson.movie_id, MoviePerson.role).all()
    return movies, people, list(links)


# ══════════════════════════════════════════════════════════════
#  Phase 1 — resolve local movie → tmdb id
# ══════════════════════════════════════════════════════════════
def _score_result(r, want_norm, want_year):
    title_n = _norm_title(r.get("title") or "")
    orig_n = _norm_title(r.get("original_title") or "")
    yr = (r.get("release_date") or "")[:4]
    yr = int(yr) if yr.isdigit() else None

    if want_year and yr and abs(yr - want_year) > 1:
        return None  # hard reject
    exact = want_norm in (title_n, orig_n)
    if not exact and not (want_year and yr == want_year):
        return None  # too weak to trust
    return (1 if exact else 0, r.get("popularity", 0.0))


def _resolve_movie_id(client: TmdbClient, m: LMovie) -> Optional[int]:
    if m.tmdb_id:
        return m.tmdb_id

    fp = f"{_norm_title(m.name)}|{_norm_title(m.name_en or '')}|{m.year}"
    kvkey = f"movie_id:{m.id}:{fp}"
    cached = client.cache.kv_get(kvkey)
    if cached is not None:
        return cached or None  # 0 == known-missing

    # At most three searches; the first almost always wins.
    attempts = []
    for title in filter(None, (m.name_en, m.name)):
        attempts.append((title, m.year))
    if m.year:
        attempts.append((m.name_en or m.name, None))

    seen, best, best_score = set(), None, None
    for title, year in attempts:
        key = (title.lower(), year)
        if key in seen:
            continue
        seen.add(key)
        params = {"query": title}
        if year:
            params["primary_release_year"] = str(year)
        try:
            results = client.get("/search/movie", params, ttl=TTL_SEARCH)
        except requests.RequestException:
            continue
        if not results:
            continue
        want_norm = _norm_title(title)
        for r in results.get("results", [])[:10]:
            sc = _score_result(r, want_norm, m.year)
            if sc and (best_score is None or sc > best_score):
                best, best_score = r, sc
        if best_score and best_score[0] == 1:  # exact title: stop early
            break

    tid = best["id"] if best else None
    client.cache.kv_set(kvkey, tid or 0, TTL_SEARCH if tid else TTL_NEGATIVE)
    return tid


# ══════════════════════════════════════════════════════════════
#  Phase 3 — pure local matching (zero network)
# ══════════════════════════════════════════════════════════════
def _suggest(kind, order=99, pop=0.0, char="", job=""):
    if kind == "crew":
        return ("Director" if job == "Director" else "Composer", f"credited as {job}")
    if _CAMEO_RE.search(char):
        return "Cameo Actor", f'"{char}" — looks like cameo'
    if order <= 2:
        return "Lead Actor", f"billed #{order + 1}"
    if order >= 10 and pop >= 20:
        return "Cameo Actor", f"popular ({pop:.0f}) but billed #{order + 1}"
    if order >= 12:
        return "Cameo Actor", f"billed #{order + 1}"
    return "Actor", f"billed #{order + 1}"


@dataclass
class _TPerson:
    tmdb_id: int
    name: str
    norms: set = field(default_factory=set)
    pop: float = 0.0
    cast: dict = field(default_factory=dict)  # movie_id -> credit
    crew: dict = field(default_factory=dict)  # (movie_id, job) -> credit


def _match(movies, people, links, credits_by_movie):
    movie_title = {m.id: (m.name, str(m.year or "")) for m in movies}

    # local person name index
    by_norm = defaultdict(set)
    for p in people:
        for nm in filter(None, (p.name, p.name_en)):
            by_norm[_norm_name(nm)].add(p.id)

    # existing links
    plinks = defaultdict(lambda: defaultdict(set))
    for pid, mid, role in links:
        plinks[pid][mid].add(role)

    # invert the credits we already have
    tps: dict[int, _TPerson] = {}
    for mid, credits in credits_by_movie.items():
        for c in credits.get("cast", []):
            tp = tps.setdefault(c["id"], _TPerson(c["id"], c.get("name", "")))
            tp.norms.update(_norm_name(n) for n in filter(None, (c.get("name"), c.get("original_name"))))
            tp.pop = max(tp.pop, c.get("popularity", 0.0))
            if mid not in tp.cast:  # first billing wins
                tp.cast[mid] = c
        for c in credits.get("crew", []):
            job = c.get("job")
            if job not in WANTED_JOBS:
                continue
            tp = tps.setdefault(c["id"], _TPerson(c["id"], c.get("name", "")))
            tp.norms.update(_norm_name(n) for n in filter(None, (c.get("name"), c.get("original_name"))))
            tp.pop = max(tp.pop, c.get("popularity", 0.0))
            tp.crew.setdefault((mid, job), c)

    # how many distinct TMDB people share each normalised name in our catalogue?
    tmdb_by_norm = defaultdict(set)
    for tp in tps.values():
        for n in tp.norms:
            tmdb_by_norm[n].add(tp.tmdb_id)

    cands = []
    for tp in tps.values():
        pids = set()
        for n in tp.norms:
            pids |= by_norm.get(n, set())
        if not pids:
            continue  # person not in our DB — out of scope for this tool

        tp_movies = set(tp.cast) | {mid for mid, _ in tp.crew}
        scored = sorted(
            ((len(plinks[pid].keys() & tp_movies), pid) for pid in pids),
            reverse=True,
        )
        best_ov, pid = scored[0]

        if best_ov > 0:
            if len(scored) > 1 and scored[1][0] == best_ov:
                continue  # ambiguous tie → skip
            conf, kind = best_ov, "verified"
        else:
            # no shared movie: only accept an unambiguous name on both sides
            if len(pids) != 1:
                continue
            if any(len(tmdb_by_norm[n]) > 1 for n in tp.norms & by_norm.keys()):
                continue
            conf, kind = 0, "name-only"

        have = plinks[pid]

        for mid, c in tp.cast.items():
            if have.get(mid, set()) & CAST_ROLES:
                continue
            order, pop = c.get("order", 99), c.get("popularity", 0.0)
            char = c.get("character", "")
            sg, rs = _suggest("cast", order, pop, char)
            mt, my = movie_title[mid]
            cands.append(
                dict(
                    person_id=pid,
                    person_name=next(p.name for p in people if p.id == pid),
                    movie_id=mid,
                    movie_title=mt,
                    movie_year=my,
                    type="cast",
                    character=char,
                    order=order,
                    job="",
                    suggested=sg,
                    reason=rs,
                    overlap=conf,
                    match=kind,
                    tmdb_person_id=tp.tmdb_id,
                    tmdb_pop=tp.pop,
                )
            )

        for (mid, job), c in tp.crew.items():
            if WANTED_JOBS[job] in have.get(mid, set()):
                continue
            sg, rs = _suggest("crew", job=job)
            mt, my = movie_title[mid]
            cands.append(
                dict(
                    person_id=pid,
                    person_name=next(p.name for p in people if p.id == pid),
                    movie_id=mid,
                    movie_title=mt,
                    movie_year=my,
                    type="crew",
                    character="",
                    order=-1,
                    job=job,
                    suggested=sg,
                    reason=rs,
                    overlap=conf,
                    match=kind,
                    tmdb_person_id=tp.tmdb_id,
                    tmdb_pop=tp.pop,
                )
            )

    cands.sort(key=lambda c: (c["match"] != "name-only", c["person_name"].lower(), c["movie_title"].lower()))
    return cands


# ══════════════════════════════════════════════════════════════
#  Orchestration
# ══════════════════════════════════════════════════════════════
def scan(progress=None, cancel=None, *, force_refresh=False, offline=False):
    """→ (candidates, unresolved_movies, stats)"""
    movies, people, links = _load_db()
    cache = TmdbCache(CACHE_PATH)
    client = TmdbClient(os.environ["TMDB_BEARER_TOKEN"], cache, force_refresh=force_refresh, offline=offline)

    credits_by_movie, unresolved, resolved_ids = {}, [], {}
    total, done = len(movies), 0

    def _work(m: LMovie):
        if cancel and cancel.is_set():
            return m, None, None
        tid = _resolve_movie_id(client, m)
        if tid is None:
            return m, None, None
        try:
            cr = client.get(f"/movie/{tid}/credits", ttl=TTL_CREDITS)
        except requests.RequestException:
            return m, tid, None
        return m, tid, cr

    with ThreadPoolExecutor(max_workers=1 if offline else WORKERS) as ex:
        futures = [ex.submit(_work, m) for m in movies]
        for fut in as_completed(futures):
            done += 1
            m, tid, cr = fut.result()
            if progress:
                progress(done, total, m.name)
            if cr is None:
                unresolved.append(m)
                continue
            credits_by_movie[m.id] = cr
            if tid and not m.tmdb_id:
                resolved_ids[m.id] = tid

    # Opportunistically back-fill Movie.tmdb_id so future cold runs halve again
    if PERSIST_TMDB_IDS and resolved_ids and not (cancel and cancel.is_set()):
        try:
            with _db.SessionLocal() as db:
                for mid, tid in resolved_ids.items():
                    db.query(Movie).filter(Movie.id == mid).update({"tmdb_id": tid}, synchronize_session=False)
                db.commit()
        except Exception:
            pass  # purely an optimisation

    cands = _match(movies, people, links, credits_by_movie)
    stats = client.stats()
    stats.update(movies=total, resolved=len(credits_by_movie), cache_entries=cache.stats())
    return cands, unresolved, stats


def save_links(items):
    n = 0
    with _db.SessionLocal() as db:
        for pid, mid, rname in items:
            role = ROLE_ENUM[rname]
            if db.query(MoviePerson).filter_by(movie_id=mid, person_id=pid, role=role).first():
                continue
            db.add(MoviePerson(movie_id=mid, person_id=pid, role=role))
            n += 1
        db.commit()
    return n


# ══════════════════════════════════════════════════════════════
#  UI
# ══════════════════════════════════════════════════════════════
_COL_SPEC = [
    ("st", "", 30, "center", False),
    ("person", "Person", 170, "w", True),
    ("movie", "Movie", 200, "w", True),
    ("credit", "TMDB Credit", 230, "w", True),
    ("role", "Role", 105, "center", False),
    ("match", "Match", 80, "center", False),
]
_COL_IDX = {s[0]: i for i, s in enumerate(_COL_SPEC)}
_CLR = {
    "Lead Actor": "#1565c0",
    "Actor": "#2e7d32",
    "Cameo Actor": "#6a1b9a",
    "Director": "#e65100",
    "Composer": "#00695c",
    "Reject": "#757575",
}


class App:
    def __init__(self, root):
        self.root = root
        root.title("Missing Movie–Person Links")
        root.geometry("1000x760")
        self.cands, self.unresolved, self.stats = [], [], {}
        self.dec, self._order, self._sort_dirs = {}, [], {}
        self._cancel = threading.Event()
        self._build_start()

    # ── start ──
    def _build_start(self):
        f = self._sf = ttk.Frame(self.root, padding=30)
        f.pack(expand=True, fill="both")
        ttk.Label(f, text="Missing Links Scanner", font=("Helvetica", 18, "bold")).pack(pady=(0, 14))
        ttk.Label(
            f,
            justify="center",
            wraplength=560,
            text=(
                "Fetches credits for every movie in the database (≈2 TMDB calls per\n"
                "movie, cached on disk), then diffs them against existing links.\n\n"
                "Re-running is nearly free — responses are cached and revalidated\n"
                "with ETags."
            ),
        ).pack(pady=(0, 18))

        opt = ttk.Frame(f)
        opt.pack(pady=(0, 14))
        self._force = tk.BooleanVar(value=False)
        self._offline = tk.BooleanVar(value=False)
        ttk.Checkbutton(opt, text="Force refresh (ignore cache)", variable=self._force).pack(side="left", padx=6)
        ttk.Checkbutton(opt, text="Offline (cache only)", variable=self._offline).pack(side="left", padx=6)

        brow = ttk.Frame(f)
        brow.pack()
        ttk.Button(brow, text="Start Scan", command=self._go).pack(side="left", padx=4)
        self._cancel_btn = ttk.Button(brow, text="Cancel", state="disabled", command=self._cancel.set)
        self._cancel_btn.pack(side="left", padx=4)

        self._pv = tk.StringVar()
        ttk.Label(f, textvariable=self._pv).pack(pady=14)
        self._pb = ttk.Progressbar(f, length=440, mode="determinate")

    def _go(self):
        self._cancel.clear()
        self._cancel_btn.config(state="normal")
        self._pb.pack(pady=4)
        self._pv.set("Starting…")
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self):
        def cb(c, t, n):
            self.root.after(0, self._tick, c, t, n)

        try:
            result = scan(
                progress=cb, cancel=self._cancel, force_refresh=self._force.get(), offline=self._offline.get()
            )
        except Exception as exc:
            msg = str(exc)
            self.root.after(0, lambda: messagebox.showerror("Scan error", msg))
            return
        self.root.after(0, self._done, result)

    def _tick(self, cur, tot, name):
        if tot:
            self._pb["maximum"], self._pb["value"] = tot, cur
            self._pv.set(f"{cur}/{tot} movies  ·  {name}")

    def _done(self, result):
        cands, unresolved, stats = result
        self._cancel_btn.config(state="disabled")
        self.cands, self.unresolved, self.stats = cands, unresolved, stats
        self._sf.destroy()
        if not cands:
            f = ttk.Frame(self.root, padding=40)
            f.pack(expand=True)
            ttk.Label(f, text="✓  No missing links found.", font=("Helvetica", 16, "bold")).pack(pady=20)
            ttk.Label(f, text=self._stat_line()).pack(pady=(0, 20))
            ttk.Button(f, text="Close", command=self.root.destroy).pack()
            return
        # Pre-accept only verified matches; name-only stay rejected.
        self.dec = {str(i): (c["suggested"] if c["match"] == "verified" else None) for i, c in enumerate(cands)}
        self._order = [str(i) for i in range(len(cands))]
        self._build_review()

    def _stat_line(self):
        s = self.stats
        return (
            f"{s.get('movies', 0)} movies · {s.get('resolved', 0)} resolved · "
            f"{s.get('network', 0)} TMDB calls "
            f"({s.get('cache_hits', 0)} cache hits, "
            f"{s.get('revalidated', 0)} revalidated) · "
            f"{len(self.unresolved)} unresolved"
        )

    # ── review ──
    def _build_review(self):
        fr = ttk.Frame(self.root)
        fr.pack(expand=True, fill="both")

        bot = ttk.Frame(fr, padding=(16, 6))
        bot.pack(side="bottom", fill="x")
        ttk.Label(
            bot,
            foreground="gray",
            text=("1 Lead · 2 Actor · 3 Cameo · 4 Dir · 5 Comp · " "S Reject · Enter Accept · Space Toggle · ↑↓ Nav"),
        ).pack(side="bottom")

        brow = ttk.Frame(bot)
        brow.pack(side="bottom", pady=(6, 2))
        tk.Button(
            brow, text="💾 Save accepted", font=("Helvetica", 11, "bold"), bg="#1565c0", fg="white", command=self._save
        ).pack(side="left", padx=5)
        tk.Button(brow, text="Accept verified", bg="#2e7d32", fg="white", command=lambda: self._bulk("verified")).pack(
            side="left", padx=5
        )
        tk.Button(brow, text="Accept all", bg="#558b2f", fg="white", command=lambda: self._bulk("all")).pack(
            side="left", padx=5
        )
        tk.Button(brow, text="Reject all", bg="#c62828", fg="white", command=lambda: self._bulk("none")).pack(
            side="left", padx=5
        )
        if self.unresolved:
            tk.Button(
                brow,
                text=f"⚠ {len(self.unresolved)} unresolved",
                bg="#b06000",
                fg="white",
                command=self._show_unresolved,
            ).pack(side="left", padx=5)

        self._cnt = tk.StringVar()
        ttk.Label(bot, textvariable=self._cnt).pack(side="bottom", pady=(4, 0))
        ttk.Label(bot, text=self._stat_line(), foreground="gray").pack(side="bottom")

        det = ttk.LabelFrame(fr, text="Selected candidate", padding=10)
        det.pack(side="bottom", fill="x", padx=16, pady=(0, 4))
        self._dtxt = ttk.Label(det, wraplength=920, justify="left")
        self._dtxt.pack(anchor="w", pady=(0, 6))

        arow = ttk.Frame(det)
        arow.pack(anchor="w")
        self._rbtns = {}
        for j, nm in enumerate(ROLE_NAMES):
            b = tk.Button(
                arow,
                text=f"{j+1}: {nm}",
                font=("Helvetica", 10, "bold"),
                width=14,
                bg=_CLR[nm],
                fg="white",
                command=lambda n=nm: self._assign(n),
            )
            b.pack(side="left", padx=2)
            self._rbtns[nm] = b
        tk.Button(
            arow,
            text="S: Reject",
            width=10,
            font=("Helvetica", 10, "bold"),
            bg=_CLR["Reject"],
            fg="white",
            command=lambda: self._assign(None),
        ).pack(side="left", padx=2)

        hdr = ttk.Frame(fr, padding=(16, 8, 16, 0))
        hdr.pack(side="top", fill="x")
        self._hdr = tk.StringVar(value=f"Found {len(self.cands)} candidate links")
        ttk.Label(hdr, textvariable=self._hdr, font=("Helvetica", 12, "bold")).pack(side="left")
        ttk.Label(hdr, text="  Filter:").pack(side="left", padx=(16, 4))
        self._fv = tk.StringVar()
        self._fv.trace_add("write", lambda *_: self._filter())
        ttk.Entry(hdr, textvariable=self._fv, width=26).pack(side="left")

        tbox = ttk.Frame(fr)
        tbox.pack(fill="both", expand=True, padx=16, pady=(4, 0))
        tv = self.tv = ttk.Treeview(tbox, columns=tuple(s[0] for s in _COL_SPEC), show="headings", selectmode="browse")
        for cid, lbl, w, anc, stretch in _COL_SPEC:
            tv.heading(cid, text=lbl, command=lambda c=cid: self._sort(c))
            tv.column(cid, width=w, anchor=anc, stretch=stretch)
        sb = ttk.Scrollbar(tbox, orient="vertical", command=tv.yview)
        tv.configure(yscrollcommand=sb.set)
        tv.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        tv.tag_configure("a", background="#e8f5e9")
        tv.tag_configure("r", background="#ffebee")
        tv.tag_configure("w", background="#fff8e1")  # name-only, unaccepted

        for i in range(len(self.cands)):
            tv.insert("", "end", iid=str(i), values=self._vals(i), tags=self._tag(i))
        tv.bind("<<TreeviewSelect>>", lambda _: self._detail())

        for j, nm in enumerate(ROLE_NAMES):
            self.root.bind(str(j + 1), lambda _, n=nm: self._assign(n))
        self.root.bind("s", lambda _: self._assign(None))
        self.root.bind("S", lambda _: self._assign(None))
        self.root.bind("<space>", lambda _: self._toggle())
        self.root.bind("<Return>", lambda _: self._accept_cur())
        self.root.bind("<Down>", lambda _: self._nav(1))
        self.root.bind("<Up>", lambda _: self._nav(-1))

        tv.selection_set("0")
        tv.focus("0")
        self._recount()

    def _show_unresolved(self):
        w = tk.Toplevel(self.root)
        w.title("Movies TMDB could not resolve")
        w.geometry("520x420")
        ttk.Label(
            w,
            padding=10,
            wraplength=480,
            justify="left",
            text=(
                "These movies were not matched on TMDB, so none of their credits "
                "were checked. Fix the title/year in the DB (or set tmdb_id) and "
                "re-scan."
            ),
        ).pack(anchor="w")
        lb = tk.Listbox(w)
        lb.pack(fill="both", expand=True, padx=10, pady=10)
        for m in self.unresolved:
            lb.insert("end", f"#{m.id}  {m.name} ({m.year or '?'})")

    # ── tree helpers ──
    def _vals(self, i):
        c = self.cands[i]
        d = self.dec.get(str(i))
        info = c["job"] if c["type"] == "crew" else f'{c["character"] or "?"} · #{c["order"] + 1}'
        match = f'✔ {c["overlap"]}' if c["match"] == "verified" else "~ name"
        return ("✓" if d else "✗", c["person_name"], f'{c["movie_title"]} ({c["movie_year"]})', info, d or "—", match)

    def _tag(self, i):
        if self.dec.get(str(i)):
            return ("a",)
        return ("w",) if self.cands[i]["match"] == "name-only" else ("r",)

    def _upd(self, i):
        self.tv.item(str(i), values=self._vals(i), tags=self._tag(i))

    def _recount(self):
        a = sum(1 for v in self.dec.values() if v)
        t = len(self.cands)
        self._cnt.set(f"Accepted {a} / {t}   ·   Rejected {t - a}")

    def _sel(self):
        s = self.tv.selection()
        return s[0] if s else None

    def _detail(self):
        iid = self._sel()
        if iid is None:
            return
        c = self.cands[int(iid)]
        d = self.dec.get(iid)
        cred = c["job"] if c["type"] == "crew" else f'{c["character"] or "?"}  ·  billed #{c["order"] + 1}'
        evidence = (
            f"{c['overlap']} shared movie(s) already linked in the DB"
            if c["match"] == "verified"
            else "⚠ name match only — no shared movie confirms identity"
        )
        self._dtxt.config(
            text="\n".join(
                [
                    f"Person:    {c['person_name']}   (TMDB #{c['tmdb_person_id']}, " f"pop {c['tmdb_pop']:.1f})",
                    f"Movie:     {c['movie_title']} ({c['movie_year']})",
                    f"Credit:    {cred}",
                    f"Suggested: {c['suggested']}  —  {c['reason']}",
                    f"Evidence:  {evidence}",
                    f"Decision:  {d or 'REJECTED'}",
                ]
            )
        )
        for nm, b in self._rbtns.items():
            sug = nm == c["suggested"]
            b.config(relief="solid" if sug else "raised", borderwidth=3 if sug else 1)

    # ── actions ──
    def _assign(self, role):
        iid = self._sel()
        if iid is None:
            return
        self.dec[iid] = role
        self._upd(int(iid))
        self._detail()
        self._recount()
        self._nav(1)

    def _toggle(self):
        iid = self._sel()
        if iid is None:
            return
        self.dec[iid] = None if self.dec.get(iid) else self.cands[int(iid)]["suggested"]
        self._upd(int(iid))
        self._detail()
        self._recount()

    def _accept_cur(self):
        iid = self._sel()
        if iid is None:
            return
        self.dec[iid] = self.cands[int(iid)]["suggested"]
        self._upd(int(iid))
        self._detail()
        self._recount()
        self._nav(1)

    def _bulk(self, mode):
        for i, c in enumerate(self.cands):
            if mode == "none":
                self.dec[str(i)] = None
            elif mode == "all" or c["match"] == "verified":
                self.dec[str(i)] = c["suggested"]
            self._upd(i)
        self._detail()
        self._recount()

    def _nav(self, d):
        iid = self._sel()
        if iid is None:
            ch = self.tv.get_children()
            if ch:
                self.tv.selection_set(ch[0])
                self.tv.focus(ch[0])
            return
        nxt = self.tv.next(iid) if d > 0 else self.tv.prev(iid)
        if nxt:
            self.tv.selection_set(nxt)
            self.tv.focus(nxt)
            self.tv.see(nxt)

    def _filter(self):
        needle = self._fv.get().strip().lower()
        for iid in self.tv.get_children():
            self.tv.detach(iid)
        vis = 0
        for iid in self._order:
            c = self.cands[int(iid)]
            if not needle or needle in c["person_name"].lower() or needle in c["movie_title"].lower():
                self.tv.reattach(iid, "", "end")
                vis += 1
        self._hdr.set(
            f"Showing {vis} / {len(self.cands)} candidates" if needle else f"Found {len(self.cands)} candidate links"
        )

    def _sort(self, col):
        rev = self._sort_dirs.get(col, False)
        ci = _COL_IDX[col]
        self._order.sort(key=lambda iid: self._vals(int(iid))[ci].lower(), reverse=rev)
        self._sort_dirs[col] = not rev
        self._filter()

    def _save(self):
        acc = [(self.cands[int(i)]["person_id"], self.cands[int(i)]["movie_id"], r) for i, r in self.dec.items() if r]
        if not acc:
            messagebox.showinfo("Nothing to save", "No links accepted.", parent=self.root)
            return
        if not messagebox.askyesno("Confirm", f"Write {len(acc)} link(s)?", parent=self.root):
            return
        try:
            n = save_links(acc)
        except Exception as exc:
            messagebox.showerror("Database error", str(exc), parent=self.root)
            return
        messagebox.showinfo("Saved", f"Wrote {n} new link(s).", parent=self.root)
        self.root.destroy()


def main():
    init_engine()
    try:
        root = tk.Tk()
        App(root)
        root.mainloop()
    finally:
        dispose_engine()


if __name__ == "__main__":
    main()
