"""One TMDB scan for missing person links across movies *and* television.

TMDB person ids are shared between its movie and TV credits, so one index of
TMDB people covers both media.  Per local movie and per local show:

    Phase 1  local movie/show -> tmdb id            (search; cached ~forever)
    Phase 2  the movie's credits, or the show's     (cached 30 days)
             seasons + aggregate credits + the credits of every local episode
    Phase 3  match people + diff links              (no network at all)

The per-medium mechanics live in `tmdb_scan.py` (movie id resolution) and
`tmdb_tv_scan.py` (show resolution, and placing each credit at the level the TV
importer would: show / season / episode).  What this adds is identity across
the two: a local person's "works" are the movies *and* shows they're linked
to, so ten linked shows corroborate a movie suggestion too, and every
candidate carries a per-medium breakdown —

    evidence = {"movie": (corroborating, linked), "show": (corroborating, linked)}

counting only works TMDB resolved.  When one medium corroborates and another
doesn't ("4/4 movies, 0/3 shows"), or the person's only links contradict the
name match, the verdict is `conflict`: most likely two people sharing a name.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from . import database
from . import tmdb_tv_scan as tv
from .database_models import CastRole, Movie, Person, TelevisionShow
from .scan_common import (
    MATCH_VERIFIED,
    VERDICT_CONFLICT,
    Candidate,
    ScanJob,
    ScanResult,
    ScanStats,
    Unresolved,
    fetch_all,
    identify,
    index_people,
    register_scan,
    remember_ids,
    sort_candidates,
)
from .tmdb_client import TTL_CREDITS, WORKERS, TmdbClient, get_sidecar
from .tmdb_common import norm as _norm, suggest_cast_role
from .tmdb_scan import JOB_SLOTS, MISMATCH_MIN_LINKS, SLOT_TO_ROLE, LMovie, _credit_norms, _load_db, _resolve_movie_id

NAME = "tmdb"
MOVIE, SHOW = "movie", tv.SHOW
#: Rejection scopes per entity kind (see scan_common.ScopedRejections).
SCOPES = {MOVIE: "movie", **tv.SCOPES}

ACTING = tv.ACTING
slot_of = tv.slot_of


# ──────────────────────────────────────────────────────────────
#  Credit index (only people whose name matches someone local)
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class _TPerson:
    ext_id: int
    name: str
    popularity: float = 0.0
    norms: set = field(default_factory=set)
    works: set = field(default_factory=set)  # {(MOVIE, id), (SHOW, id)}
    movie_cast: dict = field(default_factory=dict)  # movie id -> (character, order)
    movie_crew: dict = field(default_factory=dict)  # (movie id, slot) -> job
    placed: list = field(default_factory=list)  # tv._Placed


class _CreditIndex:
    def __init__(self, interesting_norms: set[str]):
        self._keep = interesting_norms
        self.people: dict[int, _TPerson] = {}

    def _touch(self, ext_id: int, name: str, norms: set[str], popularity: float) -> Optional[_TPerson]:
        if not (norms & self._keep):
            return None
        tp = self.people.get(ext_id)
        if tp is None:
            tp = self.people[ext_id] = _TPerson(ext_id, name)
        tp.norms |= norms
        tp.popularity = max(tp.popularity, popularity)
        return tp

    def ingest_movie(self, movie_id: int, credits: dict) -> None:
        for key in ("cast", "crew"):
            for c in credits.get(key, []):
                if not c.get("id"):
                    continue
                norms = {_norm(n) for n in (c.get("name"), c.get("original_name")) if n}
                tp = self._touch(c["id"], c.get("name") or "", norms, float(c.get("popularity") or 0.0))
                if tp is None:
                    continue
                # Any credit is identity evidence; only some are offered as links.
                tp.works.add((MOVIE, movie_id))
                if key == "cast":
                    tp.movie_cast.setdefault(movie_id, (c.get("character") or "", int(c.get("order") or 99)))
                elif slot := JOB_SLOTS.get(c.get("job") or ""):
                    tp.movie_crew.setdefault((movie_id, slot), c["job"])

    def ingest_show(self, f: tv._ShowFetch) -> None:
        for ext_id, (name, norms, pop) in f.people.items():
            tp = self._touch(ext_id, name, norms, pop)
            if tp is not None:
                tp.works.add((SHOW, f.show.id))
        for pl in f.placed:
            tp = self.people.get(pl.credit.tmdb_id)
            if tp is not None:
                tp.placed.append(pl)


# ──────────────────────────────────────────────────────────────
#  Phase 1+2 for a movie
# ──────────────────────────────────────────────────────────────
_WRONG_FILM = "wrong film"


def _fetch_movie(client: TmdbClient, m: LMovie, linked: set[str], in_scope: bool):
    """-> (tmdb id, credits), None, or _WRONG_FILM."""
    tid = m.tmdb_id or _resolve_movie_id(client, m, linked, allow_network=in_scope)
    if tid is None:
        return None
    credits = client.get(f"/movie/{tid}/credits", ttl=TTL_CREDITS, allow_network=in_scope)
    if credits is None:
        return None
    # A stored id was set by an import or a person: trust it over the names.
    if m.tmdb_id is None and len(linked) >= MISMATCH_MIN_LINKS and not (linked & _credit_norms(credits)):
        return _WRONG_FILM  # report it unresolved rather than offer its cast
    return tid, credits


# ──────────────────────────────────────────────────────────────
#  Phase 3: matching
# ──────────────────────────────────────────────────────────────
def _verdict(match: str, evidence: dict[str, tuple[int, int]]) -> str:
    """A medium where the person has checked links and none corroborate
    contradicts the match, however good the other medium looks."""
    if any(linked and not agree for agree, linked in evidence.values()):
        return VERDICT_CONFLICT
    return match


def _match(
    movies: list[LMovie],
    movie_links: list[tuple[int, int, CastRole]],
    movie_scope: set[int],
    snap: tv._Db,
    index: _CreditIndex,
    by_norm: dict[str, set[int]],
    resolved: set[tuple[str, int]],
    suppressed: set,
    pinned: dict[int, int] | None = None,
) -> list[Candidate]:
    pname = {pid: name for pid, name, _ in snap.people}
    minfo = {m.id: (m.name, m.release_year) for m in movies}
    shows = {s.id: s for s in snap.shows}

    movie_have: dict[int, dict[int, set]] = defaultdict(lambda: defaultdict(set))
    plinks: dict[int, set] = defaultdict(set)
    for pid, mid, role in movie_links:
        movie_have[pid][mid].add(role)
        plinks[pid].add((MOVIE, mid))
    for pid, show_ids in snap.works.items():
        plinks[pid] |= {(SHOW, sid) for sid in show_ids}

    out: dict[str, Candidate] = {}
    for tp, pid, match, overlap in identify(index.people.values(), by_norm, plinks, pinned):
        evidence = {}
        for medium in (MOVIE, SHOW):
            checked = {w for w in plinks[pid] if w[0] == medium and w in resolved}
            evidence[medium] = (len(checked & tp.works), len(checked))
        verdict = _verdict(match, evidence)
        common = dict(
            person_id=pid,
            person_name=pname[pid],
            match=match,
            overlap=overlap,
            source_person_id=tp.ext_id,
            source_popularity=tp.popularity,
            verdict=verdict,
            evidence=evidence,
        )

        have = movie_have[pid]
        for mid, (character, order) in tp.movie_cast.items():
            if mid not in movie_scope or have.get(mid, set()) & set(ACTING):
                continue
            role, reason = suggest_cast_role(order=order, popularity=tp.popularity, character=character)
            name, year = minfo[mid]
            c = Candidate(
                entity_kind=MOVIE, entity_id=mid, entity_name=name, entity_year=year, context=None,
                credit_type="cast", slot="cast", character=character or None, billing_order=order, job=None,
                episode_count=None, suggested_role=role.value,
                roles=[role.value] + [r.value for r in ACTING if r is not role],
                suggestion_reason=reason, suppressed=(SCOPES[MOVIE], pid, mid, "cast") in suppressed, **common,
            )
            out.setdefault(c.key, c)
        for (mid, slot), job in tp.movie_crew.items():
            role = SLOT_TO_ROLE[slot]
            if mid not in movie_scope or role in have.get(mid, set()):
                continue
            name, year = minfo[mid]
            c = Candidate(
                entity_kind=MOVIE, entity_id=mid, entity_name=name, entity_year=year, context=None,
                credit_type="crew", slot=slot, character=None, billing_order=None, job=job,
                episode_count=None, suggested_role=role.value, roles=[role.value],
                suggestion_reason=f"credited as {job}", suppressed=(SCOPES[MOVIE], pid, mid, slot) in suppressed,
                **common,
            )
            out.setdefault(c.key, c)

        for pl in tp.placed:
            cr = pl.credit
            slot = slot_of(cr.role)
            if slot in snap.slots.get((pl.level, pl.entity_id), {}).get(pid, ()):
                continue
            if any(slot in snap.slots.get(a, {}).get(pid, ()) for a in pl.ancestors):
                continue  # a parent already carries it
            name, year, context = tv._labels(snap, shows, pl.level, pl.entity_id)
            roles = [cr.role] + [r for r in ACTING if r is not cr.role] if slot == "cast" else [cr.role]
            c = Candidate(
                entity_kind=pl.level, entity_id=pl.entity_id, entity_name=name, entity_year=year, context=context,
                credit_type=cr.credit_type, slot=slot, character=cr.character or None,
                billing_order=cr.billing_order, job=cr.job, episode_count=cr.episode_count,
                suggested_role=cr.role.value, roles=[r.value for r in roles], suggestion_reason=cr.reason,
                suppressed=(SCOPES[pl.level], pid, pl.entity_id, slot) in suppressed, **common,
            )
            out.setdefault(c.key, c)  # a cast + guest double-billing is one link
    return sort_candidates(list(out.values()))


# ──────────────────────────────────────────────────────────────
#  The job
# ──────────────────────────────────────────────────────────────
def run_scan(
    job: ScanJob, guild_id: int, entity_ids: Optional[list[int]], entity_kind: Optional[str], force_refresh: bool
) -> Optional[ScanResult]:
    """`entity_ids` scopes the scan to those movies (`entity_kind="movie"`) or
    shows (`"show"`): only they are fetched and reported, while everything
    already cached still counts as identity evidence."""
    with database.SessionLocal() as db:
        movies, _people, movie_links = _load_db(db, guild_id)
        snap = tv._load_db(db, guild_id)
        pinned = dict(db.query(Person.tmdb_id, Person.id).filter(Person.guild_id == guild_id, Person.tmdb_id.isnot(None)))

    by_norm, pnorms = index_people(snap.people, _norm)
    movie_linked: dict[int, set[str]] = defaultdict(set)
    for pid, mid, _role in movie_links:
        movie_linked[mid] |= pnorms[pid]
    show_linked: dict[int, set[str]] = defaultdict(set)
    for pid, show_ids in snap.works.items():
        for sid in show_ids:
            show_linked[sid] |= pnorms[pid]

    def scope_of(kind: str, all_ids: set[int]) -> set[int]:
        if not entity_ids:
            return all_ids
        return set(entity_ids) & all_ids if entity_kind == kind else set()

    movie_scope = scope_of(MOVIE, {m.id for m in movies})
    show_scope = scope_of(SHOW, {s.id for s in snap.shows})

    sidecar = get_sidecar()
    client = TmdbClient(sidecar, force_refresh=force_refresh)
    index = _CreditIndex(set(by_norm))
    unresolved: list[Unresolved] = []
    resolved: set[tuple[str, int]] = set()
    learned: dict[str, dict[int, int]] = {MOVIE: {}, SHOW: {}}  # kind -> local id -> tmdb id

    def fetch(item):
        kind, x = item
        if kind == MOVIE:
            return _fetch_movie(client, x, movie_linked[x.id], x.id in movie_scope)
        return tv._fetch_show(client, x, show_linked[x.id], x.id in show_scope)

    items = [(MOVIE, m) for m in movies] + [(SHOW, s) for s in snap.shows]
    for (kind, x), f in fetch_all(job, items, fetch, lambda it: it[1].name, WORKERS):
        in_scope = x.id in (movie_scope if kind == MOVIE else show_scope)
        if kind == MOVIE:
            if f is None or f == _WRONG_FILM:
                if in_scope:
                    reason = ("TMDB's credits for it name none of the people already linked — probably the wrong film"
                              if f == _WRONG_FILM else "TMDB has no movie with this title and year")
                    unresolved.append(Unresolved(MOVIE, x.id, x.name, x.release_year, reason))
                continue
            tid, credits = f
            resolved.add((MOVIE, x.id))
            learned[MOVIE][x.id] = tid
            index.ingest_movie(x.id, credits)  # ingest incrementally; never hold every payload
        else:
            if f is None or f.error:
                if in_scope:
                    reason = f.error if f else "TMDB has no show with this title and year"
                    unresolved.append(Unresolved(SHOW, x.id, x.name, x.release_year, reason))
                continue
            resolved.add((SHOW, x.id))
            if f.tmdb_id:
                learned[SHOW][x.id] = f.tmdb_id
            unresolved += f.unresolved
            index.ingest_show(f)

    if job.cancel.is_set():
        return None

    job.mark(phase="matching")
    candidates = _match(
        movies, movie_links, movie_scope, snap, index, by_norm, resolved,
        sidecar.scoped_rejections(SCOPES.values()), pinned,
    )
    # People whose identity both media agree on learn their TMDB id too.
    people_ids = {c.person_id: c.source_person_id for c in candidates if c.verdict == MATCH_VERIFIED}
    remember_ids(guild_id, [(Movie, "tmdb_id", learned[MOVIE]), (TelevisionShow, "tmdb_id", learned[SHOW]),
                            (Person, "tmdb_id", people_ids)])
    return ScanResult(
        candidates=candidates,
        unresolved=unresolved,
        stats=ScanStats(
            items_total=len(items),
            items_in_scope=len(movie_scope) + len(show_scope),
            items_resolved=len(resolved),
            items_unresolved=sum(1 for u in unresolved if u.entity_kind in (MOVIE, SHOW)),
            network_calls=client.network_calls,
            cache_hits=client.cache_hits,
        ),
    )


register_scan(NAME, run_scan)
