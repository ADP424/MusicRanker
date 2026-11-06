"""Shared machinery for the person-link scans: the TMDB scan over movies and
television (`tmdb_person_scan.py`) and the IGDB game scan (`igdb_scan.py`).
What lives here:

  * the shared "is this TMDB/IGDB person one of ours?" matcher,
  * a scoped rejection store both sidecars mix in,
  * the glue that runs a scan as a Postgres-queued job (`jobs.py`) with its
    results stored on the job row, and a runner that fans the per-entity
    fetches out over a thread pool.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from typing import Callable, Iterable, Iterator, Optional, Protocol, TypeVar

from . import database, jobs
from .jobs import JobContext

log = logging.getLogger(__name__)

T = TypeVar("T")
R = TypeVar("R")

# ──────────────────────────────────────────────────────────────
#  Results
# ──────────────────────────────────────────────────────────────
MATCH_VERIFIED = "verified"
MATCH_NAME_ONLY = "name_only"
#: The person's links in one medium corroborate them and in another don't —
#: most likely two different people sharing a name (TMDB scan only).
VERDICT_CONFLICT = "conflict"


@dataclass(slots=True)
class Candidate:
    """One suggested link: `person_id` -> (`entity_kind`, `entity_id`) as `slot`."""

    person_id: int
    person_name: str
    entity_kind: str  # "movie" | "show" | "season" | "episode" | "game"
    entity_id: int
    entity_name: str
    entity_year: Optional[int]
    context: Optional[str]  # e.g. the show/season an episode belongs to
    credit_type: str  # "cast" | "guest" | "crew" | "company"
    slot: str
    character: Optional[str]
    billing_order: Optional[int]
    job: Optional[str]
    episode_count: Optional[int]
    suggested_role: str
    roles: list[str]  # what the user may pick instead, suggested first
    suggestion_reason: str
    match: str  # MATCH_VERIFIED | MATCH_NAME_ONLY
    overlap: int
    source_person_id: int
    source_popularity: float
    suppressed: bool
    # MATCH_* or VERDICT_CONFLICT; "" where a scan has only one medium.
    verdict: str = ""
    # medium -> (linked works that corroborate, linked works checked)
    evidence: dict[str, tuple[int, int]] = field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.entity_kind}:{self.entity_id}:{self.person_id}:{self.slot}"


@dataclass(slots=True)
class Unresolved:
    entity_kind: str
    id: int
    name: str
    release_year: Optional[int]
    reason: str


_SCRUTINY = {VERDICT_CONFLICT: 0, MATCH_NAME_ONLY: 1, MATCH_VERIFIED: 2}


def sort_candidates(out: list[Candidate]) -> list[Candidate]:
    """Unsuppressed conflicts and name-only first (they need scrutiny),
    suppressed last."""
    out.sort(
        key=lambda c: (
            c.suppressed,
            _SCRUTINY.get(c.verdict or c.match, 2),
            c.person_name.lower(),
            (c.context or "").lower(),
            c.entity_name.lower(),
        )
    )
    return out


# ──────────────────────────────────────────────────────────────
#  Identity
# ──────────────────────────────────────────────────────────────
class ExternalPerson(Protocol):
    ext_id: int
    norms: set[str]
    works: set[int]  # local work ids (show / game) this person is credited on


P = TypeVar("P", bound=ExternalPerson)


def identify(
    people: Iterable[P],
    by_norm: dict[str, set[int]],
    plinks: dict[int, set[int]],
    pinned: dict[int, int] | None = None,
) -> Iterator[tuple[P, int, str, int]]:
    """-> (external person, local person id, match, overlap) for every external
    person we can pin to exactly one local person.

    A local person whose stored external id is `ep.ext_id` (`pinned`: external
    id -> local id) is that person, whatever the names say, and is never bound
    to anyone else. Otherwise identity evidence is free: if the DB already says
    "P is on work X" and the provider's credits for X contain someone named
    like P, that's proof enough. Without any, a name binds only when it's
    unique on both sides."""
    people = list(people)
    pinned = pinned or {}
    taken = set(pinned.values())

    # How many distinct external people share each normalised name *within our
    # catalogue*?  Guards the name-only binding against Chris Evans problems.
    ext_by_norm: dict[str, set[int]] = defaultdict(set)
    for ep in people:
        for n in ep.norms:
            ext_by_norm[n].add(ep.ext_id)

    for ep in people:
        if ep.ext_id in pinned:
            pid = pinned[ep.ext_id]
            yield ep, pid, MATCH_VERIFIED, len(plinks.get(pid, set()) & ep.works)
            continue
        pids: set[int] = set()
        for n in ep.norms:
            pids |= by_norm.get(n, set())
        pids -= taken
        if not pids:
            continue

        scored = sorted(((len(plinks.get(pid, set()) & ep.works), pid) for pid in pids), reverse=True)
        best_overlap, pid = scored[0]
        if best_overlap > 0:
            if len(scored) > 1 and scored[1][0] == best_overlap:
                continue  # two local people equally corroborated -> ambiguous
            yield ep, pid, MATCH_VERIFIED, best_overlap
            continue
        if len(pids) != 1:
            continue
        if any(len(ext_by_norm[n]) > 1 for n in ep.norms if n in by_norm):
            continue
        yield ep, pid, MATCH_NAME_ONLY, 0


def index_people(people: Iterable[tuple[int, str, Optional[str]]], norm: Callable[[str], str]):
    """(id, name, name_en) rows -> (norm -> person ids, person id -> norms)."""
    by_norm: dict[str, set[int]] = defaultdict(set)
    pnorms: dict[int, set[str]] = defaultdict(set)
    for pid, name, name_en in people:
        for nm in filter(None, (name, name_en)):
            n = norm(nm)
            if n:
                by_norm[n].add(pid)
                pnorms[pid].add(n)
    return by_norm, pnorms


# ──────────────────────────────────────────────────────────────
#  Rejections ("never suggest this again")
# ──────────────────────────────────────────────────────────────
#: Keyed by `scope` (the entity kind, e.g. "tv_episode" / "game") because the
#: ids of different entity tables overlap.  Ids are globally unique within a
#: table, so like the movie scan's table this needs no guild column; callers
#: filter by guild when listing or clearing.
SCOPED_REJECTIONS_DDL = """
CREATE TABLE IF NOT EXISTS scoped_scan_rejections (
    scope      TEXT    NOT NULL,
    person_id  INTEGER NOT NULL,
    entity_id  INTEGER NOT NULL,
    slot       TEXT    NOT NULL,
    created_at REAL    NOT NULL,
    PRIMARY KEY (scope, person_id, entity_id, slot)
);
"""

Rejection = tuple[str, int, int, str]  # (scope, person_id, entity_id, slot)


class ScopedRejections:
    """Mixed into a sidecar that has `_db` (sqlite3 connection) and `_lock`,
    and runs `SCOPED_REJECTIONS_DDL` at start-up."""

    def scoped_rejections(self, scopes: Iterable[str]) -> set[Rejection]:
        scopes = list(scopes)
        marks = ",".join("?" * len(scopes))
        with self._lock:
            rows = self._db.execute(
                f"SELECT scope, person_id, entity_id, slot FROM scoped_scan_rejections WHERE scope IN ({marks})",
                scopes,
            ).fetchall()
        return {(r[0], r[1], r[2], r[3]) for r in rows}

    def add_scoped_rejections(self, items: Iterable[Rejection]) -> int:
        items = list(items)
        if not items:
            return 0
        now = time.time()
        with self._lock:
            before = self._db.total_changes
            self._db.executemany(
                "INSERT OR IGNORE INTO scoped_scan_rejections VALUES (?, ?, ?, ?, ?)",
                [(*it, now) for it in items],
            )
            self._db.commit()
            return self._db.total_changes - before

    def remove_scoped_rejections(self, items: Iterable[Rejection]) -> int:
        items = list(items)
        if not items:
            return 0
        with self._lock:
            before = self._db.total_changes
            self._db.executemany(
                "DELETE FROM scoped_scan_rejections "
                "WHERE scope = ? AND person_id = ? AND entity_id = ? AND slot = ?",
                items,
            )
            self._db.commit()
            return self._db.total_changes - before


# ──────────────────────────────────────────────────────────────
#  Running as a queued job
# ──────────────────────────────────────────────────────────────
@dataclass
class ScanStats:
    items_total: int = 0
    items_in_scope: int = 0
    items_resolved: int = 0
    items_unresolved: int = 0
    network_calls: int = 0
    cache_hits: int = 0


@dataclass
class ScanResult:
    candidates: list[Candidate]
    unresolved: list[Unresolved]
    stats: ScanStats


class _CancelFlag:
    """`is_set()` reads the job row's `cancel_requested`, at most once a second
    however many fetch threads ask."""

    POLL = 1.0

    def __init__(self, ctx: JobContext):
        self._ctx = ctx
        self._set = False
        self._checked = 0.0
        self._lock = threading.Lock()

    def is_set(self) -> bool:
        with self._lock:
            if not self._set and time.monotonic() - self._checked >= self.POLL:
                self._checked = time.monotonic()
                self._set = self._ctx.cancelled()
            return self._set


class ScanJob:
    """What a scan body sees while it runs as a job: progress goes to the job
    row (throttled, since every fetch thread ticks), cancellation comes from it."""

    TICK_EVERY = 0.5

    def __init__(self, ctx: JobContext):
        self._ctx = ctx
        self.cancel = _CancelFlag(ctx)
        self.processed = 0
        self.total = 0
        self._reported = 0.0
        self._lock = threading.Lock()

    def mark(self, *, phase: str, total: Optional[int] = None) -> None:
        with self._lock:
            kw: dict = {"phase": phase}
            if total is not None:
                self.total = kw["total"] = total
                self.processed = kw["processed"] = 0
            self._ctx.progress(**kw)

    def tick(self, name: str) -> None:
        with self._lock:
            self.processed += 1
            now = time.monotonic()
            if now - self._reported >= self.TICK_EVERY or self.processed == self.total:
                self._reported = now
                self._ctx.progress(processed=self.processed, message=name)


#: (job handle, guild id, entity ids or None for everything, which kind those
#: ids are, force refresh) -> the result, or None once cancelled.
ScanBody = Callable[[ScanJob, int, Optional[list[int]], Optional[str], bool], Optional[ScanResult]]


def job_kind(name: str) -> str:
    return f"person_scan:{name}"


def register_scan(name: str, body: ScanBody) -> None:
    """Registers `body` as the job handler for scan `name`. Results are stored
    on the job row, so they survive restarts and are shared by every worker."""

    @jobs.handler(job_kind(name))
    def _run(db, job, ctx: JobContext) -> dict:
        guild_id, payload = job.guild_id, dict(job.payload or {})
        db.commit()  # don't sit idle-in-transaction for the length of the scan
        handle = ScanJob(ctx)
        handle.mark(phase="loading")
        result = body(
            handle, guild_id, payload.get("entity_ids"), payload.get("entity_kind"), bool(payload.get("force_refresh"))
        )
        if result is None or handle.cancel.is_set():
            raise jobs.JobCancelled()
        return {
            "candidates": [{**asdict(c), "key": c.key} for c in result.candidates],
            "unresolved": [asdict(u) for u in result.unresolved],
            "stats": asdict(result.stats),
        }


def fetch_all(
    job: ScanJob,
    items: list[T],
    fetch: Callable[[T], Optional[R]],
    name: Callable[[T], str],
    workers: int,
) -> Iterator[tuple[T, Optional[R]]]:
    """Runs `fetch` over `items` in a pool, ticking progress as each finishes.
    A failing fetch yields None: one bad entity must not kill the scan.  Stops
    early (yielding nothing more) once the job is cancelled."""

    def guarded(it: T) -> Optional[R]:
        if job.cancel.is_set():
            return None
        try:
            return fetch(it)
        except Exception:  # noqa: BLE001
            log.warning("Scan fetch failed for %s", name(it), exc_info=True)
            return None

    job.mark(phase="fetching", total=len(items))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(guarded, it): it for it in items}
        for fut in as_completed(futures):
            if job.cancel.is_set():
                ex.shutdown(wait=False, cancel_futures=True)
                return
            it = futures[fut]
            job.tick(name(it))
            yield it, fut.result()


# ──────────────────────────────────────────────────────────────
#  Backfilling external ids
# ──────────────────────────────────────────────────────────────
def remember_ids(guild_id: int, found: Iterable[tuple[type, str, dict[int, int]]]) -> None:
    """Stores the external ids a scan worked out, as (model, id column,
    {row id: external id}), on rows that don't have one yet, so later scans,
    imports and refreshes go straight to them. An id another row of the guild
    already holds is left alone: that's a duplicate to merge, not a guess."""
    with database.SessionLocal() as db:
        for model, column, mapping in found:
            if not mapping:
                continue
            col = getattr(model, column)
            taken = {t for (t,) in db.query(col).filter(model.guild_id == guild_id, col.isnot(None))}
            for row in db.query(model).filter(model.guild_id == guild_id, model.id.in_(mapping), col.is_(None)):
                ext = mapping[row.id]
                if ext not in taken:
                    taken.add(ext)
                    setattr(row, column, ext)
        db.commit()
