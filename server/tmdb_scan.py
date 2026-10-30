"""Movie-centric scan for missing MoviePerson links.

    Phase 1  local movie  ->  tmdb_movie_id    (1 call, cached ~forever)
    Phase 2  /movie/{id}/credits               (1 call, cached 30 days)
    Phase 3  match people + diff links         (no network at all)

Identity evidence is free: if the DB already says "P is in movie X" and TMDB's
credits for X contain a person named like P, that's proof enough, and we
already fetched those credits.  `overlap` counts how many such movies agree.

Scoped scans (`movie_ids=[...]`) only *fetch* and only *report* for the scoped
movies, but still build the evidence index from every movie whose credits are
already cached -- so a per-movie scan is fully evidenced the moment you've run
one full scan.  On a cold cache a scoped scan has no evidence and everything
lands in `name_only`.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional

from . import database
from .database_models import CastRole, Movie, MoviePerson, Person
from .tmdb_client import (
    TTL_CREDITS,
    TTL_NEGATIVE,
    TTL_SEARCH,
    WORKERS,
    TmdbClient,
    get_sidecar,
)
from .tmdb_common import CREW_JOB_ROLES, norm as _norm, suggest_cast_role

# A "slot" is the unit of uniqueness for a person on a movie.  It is what the
# already-linked check keys on, and therefore what a rejection keys on too.
SLOT_CAST = "cast"
JOB_SLOTS = {"Director": "director", "Original Music Composer": "composer"}
SLOT_TO_ROLE = {slot: CREW_JOB_ROLES[job] for job, slot in JOB_SLOTS.items()}
CAST_ROLES = frozenset({CastRole.lead_actor, CastRole.actor, CastRole.cameo_actor})


# ──────────────────────────────────────────────────────────────
#  DB snapshot (three flat queries; no ORM objects, no N+1)
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class LMovie:
    id: int
    name: str
    name_en: Optional[str]
    release_year: Optional[int]


@dataclass(slots=True)
class LPerson:
    id: int
    name: str
    name_en: Optional[str]


def _load_db(db, guild_id: int):
    movies = [
        LMovie(*r) for r in db.query(Movie.id, Movie.name, Movie.name_en, Movie.release_year)
        .filter(Movie.guild_id == guild_id).all()
    ]
    people = [
        LPerson(*r) for r in db.query(Person.id, Person.name, Person.name_en)
        .filter(Person.guild_id == guild_id).all()
    ]
    links = db.query(MoviePerson.person_id, MoviePerson.movie_id, MoviePerson.role) \
        .filter(MoviePerson.guild_id == guild_id).all()
    return movies, people, [(r[0], r[1], r[2]) for r in links]


# ──────────────────────────────────────────────────────────────
#  Phase 1: local movie -> tmdb id  (the no-schema-change workaround)
# ──────────────────────────────────────────────────────────────
#: How many title/year-plausible TMDB films get their credits fetched to be
#: told apart by the people already linked to the local movie.
DISAMBIGUATE_TOP = 3

#: A movie with at least this many links whose resolved TMDB credits contain
#: none of them was resolved to the wrong film (a same-titled remake, an
#: unreleased reboot...).  Its cast must not be offered as missing links.
MISMATCH_MIN_LINKS = 3


def _score_result(r: dict, want_norm: str, want_year: Optional[int]):
    title_n = _norm(r.get("title") or "")
    orig_n = _norm(r.get("original_title") or "")
    raw_year = (r.get("release_date") or "")[:4]
    yr = int(raw_year) if raw_year.isdigit() else None

    # An undated result is usually an unannounced remake or reboot sharing the
    # title; it can't be confirmed against a known year, so it doesn't qualify.
    if want_year and (yr is None or abs(yr - want_year) > 1):
        return None
    exact = want_norm in (title_n, orig_n)
    if not exact and not (want_year and yr == want_year):
        return None
    # Festival-vs-wide-release years drift by one, so an off-by-one year stays
    # a candidate; when it loses to an obscure exact-year namesake here, the
    # linked-people overlap in `_resolve_movie_id` is what corrects it.
    return (1 if exact else 0, 1 if yr == want_year else 0, float(r.get("popularity") or 0.0))


def _credit_norms(credits: Optional[dict]) -> set[str]:
    out: set[str] = set()
    for c in (credits or {}).get("cast", []) + (credits or {}).get("crew", []):
        out |= {_norm(n) for n in (c.get("name"), c.get("original_name")) if n}
    return out


def _resolve_movie_id(
    client: TmdbClient, m: LMovie, linked: set[str], *, allow_network: bool
) -> Optional[int]:
    """`linked` is the normalised names of people already linked to `m`: when
    several TMDB films fit the title and year, the one crediting the most of
    them wins."""
    # Keyed on the DB id *plus* a fingerprint, so fixing a title or year
    # invalidates the mapping automatically.  (v2: the v1 resolver stopped at
    # the first exact title within the DB year, mapping e.g. Enemy (2013) to an
    # obscure namesake instead of Villeneuve's film, TMDB-dated 2014.)
    fp = f"{_norm(m.name)}|{_norm(m.name_en or '')}|{m.release_year}"
    key = f"movie_id:v2:{m.id}:{fp}"

    # force_refresh must bypass this, or a forced re-scan keeps honouring the
    # 7-day negative cache and never retries a movie whose title you just fixed.
    cached = None if client.force_refresh else client.sidecar.kv_get(key)
    if cached is not None:
        return cached or None  # 0 == known-missing
    if not allow_network:
        return None

    titles = list(filter(None, (m.name_en, m.name)))
    attempts: list[tuple[str, Optional[int]]] = [(t, m.release_year) for t in titles]
    if m.release_year:
        attempts += [(t, None) for t in titles]

    # Every attempt runs: stopping at the first exact title inside the DB year
    # would never see the real film when TMDB dates it a year later.
    seen: set = set()
    scores: dict[int, tuple] = {}
    for title, year in attempts:
        k = (title.lower(), year)
        if k in seen:
            continue
        seen.add(k)

        params = {"query": title}
        if year:
            params["primary_release_year"] = str(year)
        data = client.get("/search/movie", params, ttl=TTL_SEARCH)
        if not data:
            continue

        want_norm = _norm(title)
        for r in data.get("results", [])[:10]:
            sc = _score_result(r, want_norm, m.release_year)
            if sc and sc > scores.get(r["id"], ()):
                scores[r["id"]] = sc

    ranked = sorted(scores, key=scores.get, reverse=True)
    tid = ranked[0] if ranked else None
    if linked and len(ranked) > 1:
        # By score *and* by popularity: a handful of obscure exact-year
        # namesakes can otherwise crowd the famous film out of the pool.
        by_pop = sorted(scores, key=lambda cid: scores[cid][2], reverse=True)
        pool = dict.fromkeys(ranked[:DISAMBIGUATE_TOP] + by_pop[:DISAMBIGUATE_TOP])
        overlap = {
            cid: len(linked & _credit_norms(client.get(f"/movie/{cid}/credits", ttl=TTL_CREDITS)))
            for cid in pool
        }
        best = max(overlap, key=lambda cid: (overlap[cid], scores[cid]))
        if overlap[best] > 0:
            tid = best

    client.sidecar.kv_set(key, tid or 0, TTL_SEARCH if tid else TTL_NEGATIVE)
    return tid


# ──────────────────────────────────────────────────────────────
#  Credit index (only people whose name matches someone local)
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class _TPerson:
    tmdb_id: int
    name: str
    popularity: float = 0.0
    norms: set = field(default_factory=set)
    cast: dict = field(default_factory=dict)  # movie_id -> (character, order)
    crew: dict = field(default_factory=dict)  # (movie_id, slot) -> job


class _CreditIndex:
    """Ingests credits, discarding anyone who can't possibly be in our DB."""

    def __init__(self, interesting_norms: set[str]):
        self._keep = interesting_norms
        self.people: dict[int, _TPerson] = {}

    def _touch(self, c: dict) -> Optional[_TPerson]:
        norms = {_norm(n) for n in (c.get("name"), c.get("original_name")) if n}
        if not (norms & self._keep):
            return None
        tp = self.people.get(c["id"])
        if tp is None:
            tp = self.people[c["id"]] = _TPerson(c["id"], c.get("name") or "")
        tp.norms |= norms
        tp.popularity = max(tp.popularity, float(c.get("popularity") or 0.0))
        return tp

    def ingest(self, movie_id: int, credits: dict) -> None:
        for c in credits.get("cast", []):
            tp = self._touch(c)
            if tp is None:
                continue
            if movie_id not in tp.cast:  # first (highest) billing wins
                tp.cast[movie_id] = (c.get("character") or "", int(c.get("order") or 99))
        for c in credits.get("crew", []):
            slot = JOB_SLOTS.get(c.get("job") or "")
            if slot is None:
                continue
            tp = self._touch(c)
            if tp is None:
                continue
            tp.crew.setdefault((movie_id, slot), c["job"])


# ──────────────────────────────────────────────────────────────
#  Phase 3: matching
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class Candidate:
    person_id: int
    person_name: str
    movie_id: int
    movie_name: str
    movie_year: Optional[int]
    credit_type: str  # "cast" | "crew"
    slot: str  # "cast" | "director" | "composer"
    character: Optional[str]
    billing_order: Optional[int]
    job: Optional[str]
    suggested_role: CastRole
    suggestion_reason: str
    match: str  # "verified" | "name_only"
    overlap: int
    tmdb_person_id: int
    tmdb_popularity: float
    suppressed: bool

    @property
    def key(self) -> str:
        return f"{self.person_id}:{self.movie_id}:{self.slot}"


def _match(movies, people, links, index, by_norm, scope, suppressed) -> list[Candidate]:
    pname = {p.id: p.name for p in people}
    minfo = {m.id: (m.name, m.release_year) for m in movies}

    plinks: dict[int, dict[int, set]] = defaultdict(lambda: defaultdict(set))
    for pid, mid, role in links:
        plinks[pid][mid].add(role)

    # How many distinct TMDB people share each normalised name *within our
    # catalogue*?  Guards the name-only binding against Chris Evans problems.
    tmdb_by_norm: dict[str, set[int]] = defaultdict(set)
    for tp in index.people.values():
        for n in tp.norms:
            tmdb_by_norm[n].add(tp.tmdb_id)

    out: list[Candidate] = []
    for tp in index.people.values():
        pids: set[int] = set()
        for n in tp.norms:
            pids |= by_norm.get(n, set())
        if not pids:
            continue

        tp_movies = set(tp.cast) | {mid for mid, _ in tp.crew}
        scored = sorted(((len(plinks[pid].keys() & tp_movies), pid) for pid in pids), reverse=True)
        best_overlap, pid = scored[0]

        if best_overlap > 0:
            if len(scored) > 1 and scored[1][0] == best_overlap:
                continue  # two local people equally corroborated -> ambiguous
            match = "verified"
        else:
            if len(pids) != 1:
                continue
            if any(len(tmdb_by_norm[n]) > 1 for n in tp.norms if n in by_norm):
                continue
            match = "name_only"

        have = plinks[pid]

        for mid, (character, order) in tp.cast.items():
            if mid not in scope:
                continue
            if have.get(mid, set()) & CAST_ROLES:
                continue
            role, reason = suggest_cast_role(order=order, popularity=tp.popularity, character=character)
            name, year = minfo[mid]
            out.append(
                Candidate(
                    person_id=pid,
                    person_name=pname[pid],
                    movie_id=mid,
                    movie_name=name,
                    movie_year=year,
                    credit_type="cast",
                    slot=SLOT_CAST,
                    character=character or None,
                    billing_order=order,
                    job=None,
                    suggested_role=role,
                    suggestion_reason=reason,
                    match=match,
                    overlap=best_overlap,
                    tmdb_person_id=tp.tmdb_id,
                    tmdb_popularity=tp.popularity,
                    suppressed=(pid, mid, SLOT_CAST) in suppressed,
                )
            )

        for (mid, slot), job in tp.crew.items():
            if mid not in scope:
                continue
            role = SLOT_TO_ROLE[slot]
            if role in have.get(mid, set()):
                continue
            name, year = minfo[mid]
            out.append(
                Candidate(
                    person_id=pid,
                    person_name=pname[pid],
                    movie_id=mid,
                    movie_name=name,
                    movie_year=year,
                    credit_type="crew",
                    slot=slot,
                    character=None,
                    billing_order=None,
                    job=job,
                    suggested_role=role,
                    suggestion_reason=f"credited as {job}",
                    match=match,
                    overlap=best_overlap,
                    tmdb_person_id=tp.tmdb_id,
                    tmdb_popularity=tp.popularity,
                    suppressed=(pid, mid, slot) in suppressed,
                )
            )

    # Unsuppressed name-only first (they need scrutiny), suppressed last.
    out.sort(
        key=lambda c: (
            c.suppressed,
            c.match != "name_only",
            c.person_name.lower(),
            c.movie_name.lower(),
        )
    )
    return out


# ──────────────────────────────────────────────────────────────
#  Job registry (single-process, in-memory)
# ──────────────────────────────────────────────────────────────
@dataclass
class ScanStats:
    movies_total: int = 0
    movies_in_scope: int = 0
    movies_resolved: int = 0
    movies_unresolved: int = 0
    network_calls: int = 0
    cache_hits: int = 0
    revalidated: int = 0


@dataclass
class ScanJob:
    id: str
    guild_id: int = 0
    status: str = "pending"  # pending | running | done | cancelled | error
    phase: str = "queued"  # queued | loading | fetching | matching | finished
    processed: int = 0
    total: int = 0
    last_movie: Optional[str] = None
    error: Optional[str] = None
    stats: Optional[ScanStats] = None
    candidates: list[Candidate] = field(default_factory=list)
    unresolved: list[LMovie] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    cancel: threading.Event = field(default_factory=threading.Event)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def candidate_count(self) -> Optional[int]:
        return len(self.candidates) if self.status == "done" else None

    def mark(self, **kw) -> None:
        with self._lock:
            for k, v in kw.items():
                setattr(self, k, v)

    def tick(self, movie_name: str) -> None:
        with self._lock:
            self.processed += 1
            self.last_movie = movie_name


class JobRegistry:
    TTL = 3600.0
    MAX = 10

    def __init__(self):
        self._jobs: dict[str, ScanJob] = {}
        self._lock = threading.Lock()

    def create(self, guild_id: int) -> ScanJob:
        job = ScanJob(id=uuid.uuid4().hex[:12], guild_id=guild_id)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, jid: str, guild_id: int) -> Optional[ScanJob]:
        with self._lock:
            job = self._jobs.get(jid)
        return job if job is not None and job.guild_id == guild_id else None

    def list(self, guild_id: int) -> list[ScanJob]:
        with self._lock:
            jobs = [j for j in self._jobs.values() if j.guild_id == guild_id]
        return sorted(jobs, key=lambda j: j.created_at, reverse=True)

    def running(self, guild_id: int) -> Optional[ScanJob]:
        with self._lock:
            for j in self._jobs.values():
                if j.guild_id == guild_id and j.status in ("pending", "running"):
                    return j
        return None

    def delete(self, jid: str) -> None:
        with self._lock:
            self._jobs.pop(jid, None)

    def evict(self) -> None:
        now = time.time()
        with self._lock:
            for jid, j in list(self._jobs.items()):
                if j.finished_at and now - j.finished_at > self.TTL:
                    del self._jobs[jid]
            if len(self._jobs) > self.MAX:
                keep = sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
                for j in keep[self.MAX :]:
                    if j.status not in ("pending", "running"):
                        del self._jobs[j.id]


REGISTRY = JobRegistry()


# ──────────────────────────────────────────────────────────────
#  Entry point for BackgroundTasks
# ──────────────────────────────────────────────────────────────
def _fetch_one(client: TmdbClient, m: LMovie, linked: set[str], in_scope: bool, cancel: threading.Event):
    if cancel.is_set():
        return None
    try:
        tid = _resolve_movie_id(client, m, linked, allow_network=in_scope)
        if tid is None or cancel.is_set():
            return None
        credits = client.get(f"/movie/{tid}/credits", ttl=TTL_CREDITS, allow_network=in_scope)
        if len(linked) >= MISMATCH_MIN_LINKS and not (linked & _credit_norms(credits)):
            return None  # wrong film: report it unresolved rather than offer its cast
        return credits
    except Exception:
        return None  # one bad movie must not kill the scan


def run_scan(job_id: str, guild_id: int, movie_ids: Optional[list[int]], force_refresh: bool) -> None:
    """Runs in a FastAPI BackgroundTask. Must swallow every exception:
    an escaped error would leave the client polling `running` forever.

    Uses `database.SessionLocal()` (looked up on the module at call time)
    rather than `from .database import SessionLocal`: this module is
    imported when `server/main.py` builds its router list, which happens
    before the FastAPI lifespan hook calls `init_engine()`. A value-import
    would freeze in the `None` that `SessionLocal` holds at that point;
    looking it up lazily via the module (as `database.get_database` itself
    does) always sees the current value.
    """
    job = REGISTRY.get(job_id, guild_id)
    if job is None:
        return

    try:
        job.mark(status="running", phase="loading")

        with database.SessionLocal() as db:
            movies, people, links = _load_db(db, guild_id)

        by_norm: dict[str, set[int]] = defaultdict(set)
        pnorms: dict[int, set[str]] = defaultdict(set)
        for p in people:
            for nm in filter(None, (p.name, p.name_en)):
                by_norm[_norm(nm)].add(p.id)
                pnorms[p.id].add(_norm(nm))
        linked: dict[int, set[str]] = defaultdict(set)
        for pid, mid, _role in links:
            linked[mid] |= pnorms[pid]

        all_ids = {m.id for m in movies}
        scope = (set(movie_ids) & all_ids) if movie_ids else all_ids

        sidecar = get_sidecar()
        client = TmdbClient(sidecar, force_refresh=force_refresh)
        index = _CreditIndex(set(by_norm.keys()))

        job.mark(phase="fetching", total=len(movies))
        unresolved: list[LMovie] = []
        resolved = 0

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futures = {
                ex.submit(_fetch_one, client, m, linked[m.id], m.id in scope, job.cancel): m for m in movies
            }
            for fut in as_completed(futures):
                m = futures[fut]
                if job.cancel.is_set():
                    ex.shutdown(wait=False, cancel_futures=True)
                    break
                credits = fut.result()
                job.tick(m.name)
                if credits is None:
                    if m.id in scope:
                        unresolved.append(m)
                    continue
                resolved += 1
                index.ingest(m.id, credits)  # ingest incrementally; never hold
                # every credits payload in RAM

        if job.cancel.is_set():
            job.mark(status="cancelled", phase="finished", finished_at=time.time())
            return

        job.mark(phase="matching")
        candidates = _match(movies, people, links, index, by_norm, scope, sidecar.rejections())

        job.mark(
            status="done",
            phase="finished",
            candidates=candidates,
            unresolved=unresolved,
            finished_at=time.time(),
            stats=ScanStats(
                movies_total=len(movies),
                movies_in_scope=len(scope),
                movies_resolved=resolved,
                movies_unresolved=len(unresolved),
                network_calls=client.network_calls,
                cache_hits=client.cache_hits,
                revalidated=client.revalidated,
            ),
        )
    except Exception as exc:  # noqa: BLE001
        if job.cancel.is_set():
            return  # cancel already settled the job; a teardown error is noise
        job.mark(status="error", phase="finished", error=str(exc), finished_at=time.time())
