"""Shared machinery for the person-link scans that aren't movies: the
television scan (`tmdb_tv_scan.py`) and the game scan (`igdb_scan.py`).

The movie scan (`tmdb_scan.py`) predates this and keeps its own copies; the
shapes are the same.  What lives here:

  * the in-memory job registry the routers poll,
  * the shared "is this TMDB/IGDB person one of ours?" matcher,
  * a scoped rejection store both sidecars mix in,
  * a runner that fans the per-entity fetches out over a thread pool and
    settles the job however it ends.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable, Iterable, Iterator, Optional, Protocol, TypeVar

# ──────────────────────────────────────────────────────────────
#  Results
# ──────────────────────────────────────────────────────────────
MATCH_VERIFIED = "verified"
MATCH_NAME_ONLY = "name_only"


@dataclass(slots=True)
class Candidate:
    """One suggested link: `person_id` -> (`entity_kind`, `entity_id`) as `slot`."""

    person_id: int
    person_name: str
    entity_kind: str  # "show" | "season" | "episode" | "game"
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


def sort_candidates(out: list[Candidate]) -> list[Candidate]:
    """Unsuppressed name-only first (they need scrutiny), suppressed last."""
    out.sort(
        key=lambda c: (
            c.suppressed,
            c.match != MATCH_NAME_ONLY,
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
) -> Iterator[tuple[P, int, str, int]]:
    """-> (external person, local person id, match, overlap) for every external
    person we can pin to exactly one local person.

    Identity evidence is free: if the DB already says "P is on work X" and the
    provider's credits for X contain someone named like P, that's proof enough.
    Without any, a name binds only when it's unique on both sides."""
    people = list(people)

    # How many distinct external people share each normalised name *within our
    # catalogue*?  Guards the name-only binding against Chris Evans problems.
    ext_by_norm: dict[str, set[int]] = defaultdict(set)
    for ep in people:
        for n in ep.norms:
            ext_by_norm[n].add(ep.ext_id)

    for ep in people:
        pids: set[int] = set()
        for n in ep.norms:
            pids |= by_norm.get(n, set())
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
#  Job registry (single-process, in-memory — same model as tmdb_scan)
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
class ScanJob:
    id: str
    guild_id: int = 0
    status: str = "pending"  # pending | running | done | cancelled | error
    phase: str = "queued"  # queued | loading | fetching | matching | finished
    processed: int = 0
    total: int = 0
    last_item: Optional[str] = None
    error: Optional[str] = None
    stats: Optional[ScanStats] = None
    candidates: list[Candidate] = field(default_factory=list)
    unresolved: list[Unresolved] = field(default_factory=list)
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

    def tick(self, name: str) -> None:
        with self._lock:
            self.processed += 1
            self.last_item = name


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


# ──────────────────────────────────────────────────────────────
#  Runner
# ──────────────────────────────────────────────────────────────
T = TypeVar("T")
R = TypeVar("R")


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


def run_job(registry: JobRegistry, job_id: str, guild_id: int, body: Callable[[ScanJob], None]) -> None:
    """Runs in a FastAPI BackgroundTask and must swallow every exception: an
    escaped error would leave the client polling `running` forever.  `body`
    does the work and finishes with `job.mark(status="done", ...)`, or just
    returns early once `job.cancel` is set."""
    job = registry.get(job_id, guild_id)
    if job is None:
        return
    try:
        job.mark(status="running", phase="loading")
        body(job)
        if job.status == "running":  # body bailed out on cancel without finishing
            job.mark(status="cancelled", phase="finished", finished_at=time.time())
    except Exception as exc:  # noqa: BLE001
        if job.cancel.is_set():
            return  # cancel already settled the job; a teardown error is noise
        job.mark(status="error", phase="finished", error=str(exc), finished_at=time.time())
