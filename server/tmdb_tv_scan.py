"""Show-centric scan for missing television person links.

The television counterpart of `tmdb_scan.py`, over the show -> season ->
episode tree.  Per local show:

    Phase 1  local show -> tmdb tv id              (search; cached ~forever)
    Phase 2  /tv/{id}, each season + its aggregate_credits, and the credits of
             every *local* episode                  (cached 30 days)
    Phase 3  match people + diff links              (no network at all)

Where a credit is offered follows the TV importer exactly (it reuses its
primitives): at the highest level it holds *everywhere* beneath.  The show
offers its creators plus whoever is on every aired episode; a season, whoever
is on every episode of it; an episode, its full cast, guest stars, director(s)
and composer(s).  A credit that qualifies higher up is never repeated lower
down, and a link a person already has on a parent (show/season) covers the
children too -- populating down is what copies those, not this scan.

Identity evidence works as in the movie scan, one level up: "works" are shows.
If the DB already links P anywhere in show X (show, season or episode) and
TMDB credits someone named like P anywhere in X, that corroborates P.

Local episodes store a rank, not an episode number, so they're found on TMDB by
title within their season (falling back to the whole show), as the episode
import does.  Seasons are found by `season_number`, falling back to title.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from . import database
from .database_models import (
    CastRole,
    Person,
    TelevisionEpisode,
    TelevisionEpisodePerson,
    TelevisionSeason,
    TelevisionSeasonPerson,
    TelevisionShow,
    TelevisionShowPerson,
)
from .scan_common import (
    Candidate,
    JobRegistry,
    ScanJob,
    ScanStats,
    Unresolved,
    fetch_all,
    identify,
    index_people,
    run_job,
    sort_candidates,
)
from .tmdb_client import (
    TTL_CREDITS,
    TTL_NEGATIVE,
    TTL_SEARCH,
    WORKERS,
    TmdbClient,
    get_sidecar,
)
from .tmdb_common import norm as _norm
from .tmdb_tv_import import (
    DIRECTOR_JOBS,
    _aired,
    _creators,
    _Credit,
    _dedupe,
    _episode_credits,
    _every_episode,
    _tally,
)

SHOW, SEASON, EPISODE = "show", "season", "episode"
#: Rejection scopes, per entity kind (see scan_common.ScopedRejections).
SCOPES = {SHOW: "tv_show", SEASON: "tv_season", EPISODE: "tv_episode"}

ACTING = (CastRole.lead_actor, CastRole.actor, CastRole.cameo_actor)

#: How many title/year-plausible TMDB shows get their credits fetched to be
#: told apart by the people already linked to the local show.
DISAMBIGUATE_TOP = 3

#: A show with at least this many linked people, none of whom TMDB credits on
#: the show it resolved to, resolved to the wrong show (a remake, a namesake).
MISMATCH_MIN_LINKS = 3


def slot_of(role: CastRole) -> str:
    """The unit of uniqueness for a person on an entity: any acting role is one
    slot ("cast"), every other role is its own."""
    return "cast" if role in ACTING else role.value


def _kind(cr: _Credit) -> str:
    """What a credit *is*, independent of the level it was offered at -- a show's
    every-episode director is offered as `creator`, but is still a director."""
    if cr.role in ACTING:
        return "cast"
    if cr.role is CastRole.creator and (cr.job or "").lower() not in DIRECTOR_JOBS:
        return "creator"
    return "director" if cr.role in (CastRole.director, CastRole.creator) else cr.role.value


# ──────────────────────────────────────────────────────────────
#  DB snapshot (flat queries; no ORM objects, no N+1)
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class LShow:
    id: int
    name: str
    name_en: Optional[str]
    release_year: Optional[int]
    seasons: list = field(default_factory=list)
    episodes: list = field(default_factory=list)


@dataclass(slots=True)
class LSeason:
    id: int
    show_id: int
    name: str
    season_number: Optional[int]
    release_year: Optional[int]


@dataclass(slots=True)
class LEpisode:
    id: int
    show_id: int
    season_id: int
    name: str
    name_en: Optional[str]
    release_year: Optional[int]


@dataclass
class _Db:
    shows: list[LShow]
    seasons: dict[int, LSeason]
    episodes: dict[int, LEpisode]
    people: list[tuple[int, str, Optional[str]]]
    # (level, entity id) -> person id -> slots held there
    slots: dict[tuple[str, int], dict[int, set[str]]]
    # person id -> show ids they're linked anywhere in
    works: dict[int, set[int]]


def _load_db(db, guild_id: int) -> _Db:
    shows = {
        r[0]: LShow(*r)
        for r in db.query(
            TelevisionShow.id, TelevisionShow.name, TelevisionShow.name_en, TelevisionShow.release_year
        ).filter(TelevisionShow.guild_id == guild_id)
    }
    seasons = {
        r[0]: LSeason(*r)
        for r in db.query(
            TelevisionSeason.id,
            TelevisionSeason.show_id,
            TelevisionSeason.name,
            TelevisionSeason.season_number,
            TelevisionSeason.release_year,
        ).filter(TelevisionSeason.guild_id == guild_id)
    }
    episodes = {
        r[0]: LEpisode(*r)
        for r in db.query(
            TelevisionEpisode.id,
            TelevisionEpisode.show_id,
            TelevisionEpisode.season_id,
            TelevisionEpisode.name,
            TelevisionEpisode.name_en,
            TelevisionEpisode.release_year,
        ).filter(TelevisionEpisode.guild_id == guild_id)
    }
    for s in seasons.values():
        shows[s.show_id].seasons.append(s)
    for e in episodes.values():
        shows[e.show_id].episodes.append(e)

    people = [
        (r[0], r[1], r[2]) for r in db.query(Person.id, Person.name, Person.name_en).filter(Person.guild_id == guild_id)
    ]

    slots: dict[tuple[str, int], dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))
    works: dict[int, set[int]] = defaultdict(set)
    tables = (
        (SHOW, TelevisionShowPerson, TelevisionShowPerson.show_id, lambda i: i),
        (SEASON, TelevisionSeasonPerson, TelevisionSeasonPerson.season_id, lambda i: seasons[i].show_id),
        (EPISODE, TelevisionEpisodePerson, TelevisionEpisodePerson.episode_id, lambda i: episodes[i].show_id),
    )
    for level, model, col, show_of in tables:
        for pid, eid, role in db.query(model.person_id, col, model.role).filter(model.guild_id == guild_id):
            slots[(level, eid)][pid].add(slot_of(role))
            works[pid].add(show_of(eid))

    return _Db(list(shows.values()), seasons, episodes, people, slots, works)


# ──────────────────────────────────────────────────────────────
#  Phase 1: local show -> tmdb id
# ──────────────────────────────────────────────────────────────
def _score_result(r: dict, want_norm: str, want_year: Optional[int]):
    """Same rules as the movie scan's: a dated result within a year of ours,
    exact title (or exact year) required, popularity breaks ties."""
    title_n = _norm(r.get("name") or "")
    orig_n = _norm(r.get("original_name") or "")
    raw_year = (r.get("first_air_date") or "")[:4]
    yr = int(raw_year) if raw_year.isdigit() else None
    if want_year and (yr is None or abs(yr - want_year) > 1):
        return None
    exact = want_norm in (title_n, orig_n)
    if not exact and not (want_year and yr == want_year):
        return None
    return (1 if exact else 0, 1 if yr == want_year else 0, float(r.get("popularity") or 0.0))


def _credit_norms(*payloads: Optional[dict]) -> set[str]:
    out: set[str] = set()
    for p in payloads:
        for c in (p or {}).get("cast", []) + (p or {}).get("crew", []) + (p or {}).get("created_by", []):
            out |= {_norm(n) for n in (c.get("name"), c.get("original_name")) if n}
    return out


def _resolve_show_id(client: TmdbClient, s: LShow, linked: set[str], *, allow_network: bool) -> Optional[int]:
    # Keyed on the DB id plus a fingerprint, so fixing a title or year
    # invalidates the mapping automatically.
    fp = f"{_norm(s.name)}|{_norm(s.name_en or '')}|{s.release_year}"
    key = f"tv_id:v1:{s.id}:{fp}"
    cached = None if client.force_refresh else client.sidecar.kv_get(key)
    if cached is not None:
        return cached or None  # 0 == known-missing
    if not allow_network:
        return None

    titles = list(filter(None, (s.name_en, s.name)))
    attempts: list[tuple[str, Optional[int]]] = [(t, s.release_year) for t in titles]
    if s.release_year:
        attempts += [(t, None) for t in titles]

    seen: set = set()
    scores: dict[int, tuple] = {}
    for title, year in attempts:
        k = (title.lower(), year)
        if k in seen:
            continue
        seen.add(k)
        params = {"query": title}
        if year:
            params["first_air_date_year"] = str(year)
        data = client.get("/search/tv", params, ttl=TTL_SEARCH)
        if not data:
            continue
        want_norm = _norm(title)
        for r in data.get("results", [])[:10]:
            sc = _score_result(r, want_norm, s.release_year)
            if sc and sc > scores.get(r["id"], ()):
                scores[r["id"]] = sc

    ranked = sorted(scores, key=scores.get, reverse=True)
    tid = ranked[0] if ranked else None
    if linked and len(ranked) > 1:
        by_pop = sorted(scores, key=lambda cid: scores[cid][2], reverse=True)
        pool = dict.fromkeys(ranked[:DISAMBIGUATE_TOP] + by_pop[:DISAMBIGUATE_TOP])
        overlap = {
            cid: len(linked & _credit_norms(client.get(f"/tv/{cid}/aggregate_credits", ttl=TTL_CREDITS)))
            for cid in pool
        }
        best = max(overlap, key=lambda cid: (overlap[cid], scores[cid]))
        if overlap[best] > 0:
            tid = best

    client.sidecar.kv_set(key, tid or 0, TTL_SEARCH if tid else TTL_NEGATIVE)
    return tid


# ──────────────────────────────────────────────────────────────
#  Phase 2: one show's credits, already placed at their level
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class _Placed:
    level: str
    entity_id: int
    ancestors: tuple[tuple[str, int], ...]
    credit: _Credit


@dataclass
class _ShowFetch:
    show: LShow
    error: Optional[str] = None
    # tmdb person id -> (name, norms, popularity) for everyone credited anywhere
    people: dict[int, tuple[str, set[str], float]] = field(default_factory=dict)
    placed: list[_Placed] = field(default_factory=list)
    unresolved: list[Unresolved] = field(default_factory=list)


def _note_people(out: _ShowFetch, *payloads: Optional[dict]) -> None:
    for p in payloads:
        for key in ("cast", "crew", "guest_stars", "created_by"):
            for c in (p or {}).get(key) or []:
                if not c.get("id"):
                    continue
                norms = {_norm(n) for n in (c.get("name"), c.get("original_name")) if n}
                name, have, pop = out.people.get(c["id"], (c.get("name") or "", set(), 0.0))
                out.people[c["id"]] = (name, have | norms, max(pop, float(c.get("popularity") or 0.0)))


def _season_for(meta: list[dict], s: LSeason) -> Optional[int]:
    numbers = {m["season_number"] for m in meta}
    if s.season_number is not None:
        return s.season_number if s.season_number in numbers else None
    named = [m["season_number"] for m in meta if _norm(m.get("name") or "") == _norm(s.name)]
    return named[0] if len(named) == 1 else None


def _locate_episode(e: LEpisode, sn: Optional[int], payloads: dict[int, dict]) -> Optional[tuple[int, int]]:
    """-> (season number, episode number) by title: within the season first,
    then anywhere in the show; only an unambiguous hit counts."""
    wanted = {_norm(n) for n in (e.name, e.name_en) if n}
    for pool in ([sn] if sn is not None else []) + [None]:
        hits = {
            (n, ep.get("episode_number"))
            for n, data in payloads.items()
            if pool is None or n == pool
            for ep in data.get("episodes") or []
            if _norm(ep.get("name") or "") in wanted and ep.get("episode_number") is not None
        }
        if len(hits) == 1:
            return hits.pop()
        if hits:
            return None  # ambiguous title
    return None


def _fetch_show(client: TmdbClient, s: LShow, linked: set[str], in_scope: bool) -> Optional[_ShowFetch]:
    tid = _resolve_show_id(client, s, linked, allow_network=in_scope)
    if tid is None:
        return None
    get = lambda path: client.get(path, ttl=TTL_CREDITS, allow_network=in_scope)  # noqa: E731
    details = get(f"/tv/{tid}")
    if details is None:
        return None

    out = _ShowFetch(s)
    meta = [m for m in details.get("seasons") or [] if m.get("season_number") is not None]
    local_sn = {ls.id: _season_for(meta, ls) for ls in s.seasons}
    wanted = sorted(
        {m["season_number"] for m in meta if m["season_number"] != 0} | {n for n in local_sn.values() if n is not None}
    )

    payloads: dict[int, dict] = {}
    tallies: dict[int, dict] = {}
    for n in wanted:
        data, agg = get(f"/tv/{tid}/season/{n}"), get(f"/tv/{tid}/season/{n}/aggregate_credits")
        if data:
            payloads[n] = data
            tallies[n] = _tally(agg or {})
        _note_people(out, agg)
    _note_people(out, details)

    if len(linked) >= MISMATCH_MIN_LINKS and not (linked & {n for _, ns, _ in out.people.values() for n in ns}):
        out.error = "TMDB's credits for it name none of the people already linked — probably the wrong show"
        return out
    if not in_scope:
        return out  # evidence only: who's in this show is all we need

    # Show level: creators + on every aired episode of every regular season.
    scopes = [(len(_aired(payloads[n].get("episodes") or [])), tallies[n]) for n in payloads if n != 0]
    show_level = _dedupe(_creators(details) + _every_episode(scopes, level="show"))
    above = {(cr.tmdb_id, _kind(cr)) for cr in show_level}
    out.placed += [_Placed(SHOW, s.id, (), cr) for cr in show_level]

    # Season level: on every episode of that season, unless offered above.
    season_above: dict[int, set] = {}
    for ls in s.seasons:
        n = local_sn[ls.id]
        if n is None or n not in payloads:
            out.unresolved.append(
                Unresolved(
                    SEASON,
                    ls.id,
                    f"{s.name} · {ls.name}",
                    ls.release_year,
                    "no matching TMDB season (check its season number)",
                )
            )
            continue
        eps = payloads[n].get("episodes") or []
        credits = _every_episode([(len(_aired(eps)) or len(eps), tallies[n])], level="season")
        credits = [cr for cr in credits if (cr.tmdb_id, _kind(cr)) not in above]
        season_above[n] = {(cr.tmdb_id, _kind(cr)) for cr in credits}
        out.placed += [_Placed(SEASON, ls.id, ((SHOW, s.id),), cr) for cr in credits]

    # Episode level: that episode's full credits, unless offered above.
    for le in s.episodes:
        ls = next((x for x in s.seasons if x.id == le.season_id), None)
        hit = _locate_episode(le, local_sn.get(le.season_id), payloads)
        if hit is None:
            out.unresolved.append(
                Unresolved(
                    EPISODE,
                    le.id,
                    f"{s.name} · {ls.name if ls else '?'} · {le.name}",
                    le.release_year,
                    "no TMDB episode with this title",
                )
            )
            continue
        n, en = hit
        credits = get(f"/tv/{tid}/season/{n}/episode/{en}/credits")
        if credits is None:
            continue
        _note_people(out, credits)
        blocked = above | season_above.get(n, set())
        out.placed += [
            _Placed(EPISODE, le.id, ((SEASON, le.season_id), (SHOW, s.id)), cr)
            for cr in _episode_credits(credits)
            if (cr.tmdb_id, _kind(cr)) not in blocked
        ]
    return out


# ──────────────────────────────────────────────────────────────
#  Credit index (only people whose name matches someone local)
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class _TPerson:
    ext_id: int
    name: str
    popularity: float = 0.0
    norms: set = field(default_factory=set)
    works: set = field(default_factory=set)  # local show ids
    placed: list = field(default_factory=list)


class _CreditIndex:
    def __init__(self, interesting_norms: set[str]):
        self._keep = interesting_norms
        self.people: dict[int, _TPerson] = {}

    def ingest(self, f: _ShowFetch) -> None:
        for tmdb_id, (name, norms, pop) in f.people.items():
            if not (norms & self._keep):
                continue
            tp = self.people.get(tmdb_id)
            if tp is None:
                tp = self.people[tmdb_id] = _TPerson(tmdb_id, name)
            tp.norms |= norms
            tp.popularity = max(tp.popularity, pop)
            tp.works.add(f.show.id)
        for pl in f.placed:
            tp = self.people.get(pl.credit.tmdb_id)
            if tp is not None:
                tp.placed.append(pl)


# ──────────────────────────────────────────────────────────────
#  Phase 3: matching
# ──────────────────────────────────────────────────────────────
def _labels(snap: _Db, shows: dict[int, LShow], level: str, eid: int) -> tuple[str, Optional[int], Optional[str]]:
    """-> (name, year, context)"""
    if level == SHOW:
        s = shows[eid]
        return s.name, s.release_year, None
    if level == SEASON:
        s = snap.seasons[eid]
        return s.name, s.release_year, shows[s.show_id].name
    e = snap.episodes[eid]
    season = snap.seasons.get(e.season_id)
    return e.name, e.release_year, f"{shows[e.show_id].name} · {season.name if season else '?'}"


def _match(snap: _Db, index: _CreditIndex, by_norm, suppressed: set) -> list[Candidate]:
    pname = {pid: name for pid, name, _ in snap.people}
    shows = {s.id: s for s in snap.shows}
    out: dict[str, Candidate] = {}

    for tp, pid, match, overlap in identify(index.people.values(), by_norm, snap.works):
        for pl in tp.placed:
            cr: _Credit = pl.credit
            slot = slot_of(cr.role)
            if slot in snap.slots.get((pl.level, pl.entity_id), {}).get(pid, ()):
                continue
            if any(slot in snap.slots.get(a, {}).get(pid, ()) for a in pl.ancestors):
                continue  # a parent already carries it
            name, year, context = _labels(snap, shows, pl.level, pl.entity_id)
            roles = [cr.role] + [r for r in ACTING if r is not cr.role] if slot == "cast" else [cr.role]
            c = Candidate(
                person_id=pid,
                person_name=pname[pid],
                entity_kind=pl.level,
                entity_id=pl.entity_id,
                entity_name=name,
                entity_year=year,
                context=context,
                credit_type=cr.credit_type,
                slot=slot,
                character=cr.character or None,
                billing_order=cr.billing_order,
                job=cr.job,
                episode_count=cr.episode_count,
                suggested_role=cr.role.value,
                roles=[r.value for r in roles],
                suggestion_reason=cr.reason,
                match=match,
                overlap=overlap,
                source_person_id=tp.ext_id,
                source_popularity=tp.popularity,
                suppressed=(SCOPES[pl.level], pid, pl.entity_id, slot) in suppressed,
            )
            out.setdefault(c.key, c)  # a cast + guest double-billing is one link
    return sort_candidates(list(out.values()))


# ──────────────────────────────────────────────────────────────
#  Entry point for BackgroundTasks
# ──────────────────────────────────────────────────────────────
REGISTRY = JobRegistry()


def run_scan(job_id: str, guild_id: int, show_ids: Optional[list[int]], force_refresh: bool) -> None:
    """See `scan_common.run_job`; `database.SessionLocal` is looked up at call
    time for the reason given in `tmdb_scan.run_scan`."""

    def body(job: ScanJob) -> None:
        with database.SessionLocal() as db:
            snap = _load_db(db, guild_id)

        by_norm, pnorms = index_people(snap.people, _norm)
        linked: dict[int, set[str]] = defaultdict(set)
        for pid, show_ids_of in snap.works.items():
            for sid in show_ids_of:
                linked[sid] |= pnorms[pid]

        all_ids = {s.id for s in snap.shows}
        scope = (set(show_ids) & all_ids) if show_ids else all_ids

        sidecar = get_sidecar()
        client = TmdbClient(sidecar, force_refresh=force_refresh)
        index = _CreditIndex(set(by_norm))
        unresolved: list[Unresolved] = []
        resolved = 0

        fetched = fetch_all(
            job,
            snap.shows,
            lambda s: _fetch_show(client, s, linked[s.id], s.id in scope),
            lambda s: s.name,
            WORKERS,
        )
        for s, f in fetched:
            if f is None or f.error:
                if s.id in scope:
                    reason = f.error if f else "TMDB has no show with this title and year"
                    unresolved.append(Unresolved(SHOW, s.id, s.name, s.release_year, reason))
                continue
            resolved += 1
            unresolved += f.unresolved
            index.ingest(f)  # ingest incrementally; never hold every payload

        if job.cancel.is_set():
            return

        job.mark(phase="matching")
        candidates = _match(snap, index, by_norm, sidecar.scoped_rejections(SCOPES.values()))
        job.mark(
            status="done",
            phase="finished",
            candidates=candidates,
            unresolved=unresolved,
            finished_at=time.time(),
            stats=ScanStats(
                items_total=len(snap.shows),
                items_in_scope=len(scope),
                items_resolved=resolved,
                items_unresolved=sum(1 for u in unresolved if u.entity_kind == SHOW),
                network_calls=client.network_calls,
                cache_hits=client.cache_hits,
            ),
        )

    run_job(REGISTRY, job_id, guild_id, body)
