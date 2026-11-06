"""Game-centric scan for missing developer links, via IGDB.

The game counterpart of `tmdb_person_scan.py`, much smaller because IGDB's credit
data is company-level only: there is no per-person cast or crew to offer (see
`igdb_import.py`), so this scan finds *developer studios* already in the
catalogue as people but not yet linked to games IGDB says they developed.
Publishers are deliberately not offered: `GameRole` has no publisher role, and
calling a publisher the developer would be wrong data.

    Phase 1  local game -> IGDB game, by title search   (cached 90 days)
             the search payload carries involved_companies, so resolving a
             game *is* fetching its credits -- one call per title tried
    Phase 2  match companies + diff links                (no network at all)

Identity evidence works as in the movie scan: a company IGDB credits (as
developer *or* publisher) on a game the DB already links to a local person of
that name corroborates them.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from . import database
from .database_models import Game, GamePerson, GameRole, Person
from .igdb_client import TTL_SEARCH, IgdbClient, get_sidecar
from .normalize import norm
from .scan_common import (
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

GAME = "game"
SCOPE = "game"  # rejection scope (see scan_common.ScopedRejections)
SLOT = GameRole.developer.value

#: IGDB is rate-limited to a few requests a second; more workers only queue.
WORKERS = 4

#: A game with at least this many linked *developers*, none of whom IGDB
#: credits on the game it resolved to, resolved to the wrong game.  Only
#: developers count: IGDB never lists the composers/directors a game may have.
MISMATCH_MIN_LINKS = 2

_FIELDS = (
    "fields name,alternative_names.name,first_release_date,total_rating_count,"
    "involved_companies.company.name,involved_companies.developer,involved_companies.publisher;"
)


# ──────────────────────────────────────────────────────────────
#  DB snapshot
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class LGame:
    id: int
    name: str
    name_en: Optional[str]
    release_year: Optional[int]
    igdb_id: Optional[int] = None


def _load_db(db, guild_id: int):
    games = [
        LGame(*r)
        for r in db.query(Game.id, Game.name, Game.name_en, Game.release_year, Game.igdb_id)
        .filter(Game.guild_id == guild_id)
    ]
    people = [
        (r[0], r[1], r[2]) for r in db.query(Person.id, Person.name, Person.name_en).filter(Person.guild_id == guild_id)
    ]
    links = (
        db.query(GamePerson.person_id, GamePerson.game_id, GamePerson.role)
        .filter(GamePerson.guild_id == guild_id)
        .all()
    )
    return games, people, [(r[0], r[1], r[2]) for r in links]


# ──────────────────────────────────────────────────────────────
#  Phase 1: local game -> IGDB game (and its companies)
# ──────────────────────────────────────────────────────────────
def _year(unix_ts: Optional[int]) -> Optional[int]:
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).year if unix_ts else None


def _score_result(r: dict, wanted: set[str], want_year: Optional[int]):
    names = {norm(r.get("name"))} | {norm(a.get("name")) for a in r.get("alternative_names") or []}
    yr = _year(r.get("first_release_date"))
    # An undated result is usually an unannounced remake sharing the title.
    if want_year and (yr is None or abs(yr - want_year) > 1):
        return None
    exact = bool(wanted & names)
    if not exact and not (want_year and yr == want_year):
        return None
    return (1 if exact else 0, 1 if yr == want_year else 0, float(r.get("total_rating_count") or 0))


def _companies(r: dict) -> list[tuple[int, str, bool]]:
    """-> (company id, name, is developer) per credited company."""
    out = []
    for ic in r.get("involved_companies") or []:
        c = ic.get("company") or {}
        if c.get("id") and c.get("name") and (ic.get("developer") or ic.get("publisher")):
            out.append((c["id"], c["name"], bool(ic.get("developer"))))
    return out


def _resolve(client: IgdbClient, g: LGame, linked: set[str], *, allow_network: bool) -> Optional[dict]:
    """`linked` is the normalised names of people already linked to `g`: when
    several IGDB games fit the title and year, the one crediting the most of
    them wins. A stored IGDB id skips the search."""
    if g.igdb_id:
        data = client.post("games", f"{_FIELDS} where id = {g.igdb_id};", ttl=TTL_SEARCH, allow_network=allow_network)
        return data[0] if data else None
    scores: dict[int, tuple] = {}
    results: dict[int, dict] = {}
    wanted = {norm(n) for n in (g.name, g.name_en) if n}
    for title in dict.fromkeys(filter(None, (g.name_en, g.name))):
        escaped = title.replace("\\", "\\\\").replace('"', '\\"')
        data = client.post(
            "games", f'search "{escaped}"; {_FIELDS} limit 10;', ttl=TTL_SEARCH, allow_network=allow_network
        )
        for r in data or []:
            sc = _score_result(r, wanted, g.release_year)
            if sc and sc > scores.get(r["id"], ()):
                scores[r["id"]], results[r["id"]] = sc, r
    if not scores:
        return None

    def overlap(gid: int) -> int:
        return len(linked & {norm(name) for _, name, _ in _companies(results[gid])})

    best = max(scores, key=lambda gid: (overlap(gid), scores[gid]))
    return results[best]


# ──────────────────────────────────────────────────────────────
#  Phase 2: matching
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class _Company:
    ext_id: int
    name: str
    norms: set = field(default_factory=set)
    works: set = field(default_factory=set)  # local game ids credited on at all
    developed: set = field(default_factory=set)  # local game ids, as developer


def _ingest(index: dict[int, _Company], keep: set[str], g: LGame, r: dict) -> None:
    for cid, name, is_dev in _companies(r):
        n = norm(name)
        if n not in keep:
            continue
        c = index.get(cid)
        if c is None:
            c = index[cid] = _Company(cid, name, {n})
        c.works.add(g.id)
        if is_dev:
            c.developed.add(g.id)


def _match(games, people, links, index, by_norm, scope, suppressed) -> list[Candidate]:
    pname = {pid: name for pid, name, _ in people}
    ginfo = {g.id: g for g in games}
    plinks: dict[int, set[int]] = defaultdict(set)
    has_dev: set[tuple[int, int]] = set()
    for pid, gid, role in links:
        plinks[pid].add(gid)
        if role is GameRole.developer:
            has_dev.add((pid, gid))

    out: list[Candidate] = []
    for c, pid, match, overlap in identify(index.values(), by_norm, plinks):
        for gid in sorted(c.developed & scope):
            if (pid, gid) in has_dev:
                continue
            g = ginfo[gid]
            out.append(
                Candidate(
                    person_id=pid,
                    person_name=pname[pid],
                    entity_kind=GAME,
                    entity_id=gid,
                    entity_name=g.name,
                    entity_year=g.release_year,
                    context=None,
                    credit_type="company",
                    slot=SLOT,
                    character=None,
                    billing_order=None,
                    job="Developer",
                    episode_count=None,
                    suggested_role=SLOT,
                    roles=[SLOT],
                    suggestion_reason="IGDB credits this company as a developer",
                    match=match,
                    overlap=overlap,
                    source_person_id=c.ext_id,
                    source_popularity=0.0,
                    suppressed=(SCOPE, pid, gid, SLOT) in suppressed,
                )
            )
    return sort_candidates(out)


# ──────────────────────────────────────────────────────────────
#  The job
# ──────────────────────────────────────────────────────────────
NAME = "igdb"


def run_scan(
    job: ScanJob, guild_id: int, game_ids: Optional[list[int]], _kind: Optional[str], force_refresh: bool
) -> Optional[ScanResult]:
    with database.SessionLocal() as db:
        games, people, links = _load_db(db, guild_id)

    by_norm, pnorms = index_people(people, norm)
    linked: dict[int, set[str]] = defaultdict(set)
    linked_devs: dict[int, set[str]] = defaultdict(set)
    for pid, gid, role in links:
        linked[gid] |= pnorms[pid]
        if role is GameRole.developer:
            linked_devs[gid] |= pnorms[pid]

    all_ids = {g.id for g in games}
    scope = (set(game_ids) & all_ids) if game_ids else all_ids

    sidecar = get_sidecar()
    client = IgdbClient(sidecar, force_refresh=force_refresh)
    index: dict[int, _Company] = {}
    keep = set(by_norm)
    unresolved: list[Unresolved] = []
    resolved = 0
    learned: dict[int, int] = {}  # game id -> IGDB id

    fetched = fetch_all(
        job,
        games,
        lambda g: _resolve(client, g, linked[g.id], allow_network=g.id in scope),
        lambda g: g.name,
        WORKERS,
    )
    for g, r in fetched:
        reason = None
        if r is None:
            reason = "IGDB has no game with this title and year"
        elif len(linked_devs[g.id]) >= MISMATCH_MIN_LINKS and not (
            linked_devs[g.id] & {norm(name) for _, name, _ in _companies(r)}
        ):
            reason = "IGDB's credits for it name none of its linked developers — probably the wrong game"
        if reason:
            if g.id in scope:
                unresolved.append(Unresolved(GAME, g.id, g.name, g.release_year, reason))
            continue
        resolved += 1
        learned[g.id] = r["id"]
        _ingest(index, keep, g, r)

    if job.cancel.is_set():
        return None

    job.mark(phase="matching")
    candidates = _match(games, people, links, index, by_norm, scope, sidecar.scoped_rejections([SCOPE]))
    studios = {c.person_id: c.source_person_id for c in candidates if c.match == "verified"}
    remember_ids(guild_id, [(Game, "igdb_id", learned), (Person, "igdb_id", studios)])
    return ScanResult(
        candidates=candidates,
        unresolved=unresolved,
        stats=ScanStats(
            items_total=len(games),
            items_in_scope=len(scope),
            items_resolved=resolved,
            items_unresolved=len(unresolved),
            network_calls=client.network_calls,
            cache_hits=client.cache_hits,
        ),
    )


register_scan(NAME, run_scan)
