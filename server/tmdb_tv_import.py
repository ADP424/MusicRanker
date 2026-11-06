"""TMDB television lookup + import.

Shares every media-agnostic primitive with the movie importer via `tmdb_common`.
What's television-shaped is the credit graph: show → season → episode, where a
credit belongs at the highest level it holds *everywhere* beneath:

  show step     /tv/{id}                          -> created_by, genres, seasons
                /tv/{id}/season/{n}               -> each season's episode list
                /tv/{id}/season/{n}/aggregate_credits
                                                  -> per-season episode counts
  season step   the same two season calls, for one season
  episode step  /tv/{id}/season/{n}/episode/{e}/credits
                                                  -> that episode's FULL cast+crew

Show level offers the creators, plus anyone credited on every single (aired)
episode of every included season. Season level offers anyone credited on every
episode of that season. Episode level offers the episode's whole cast, guest
stars and crew, the way a movie import does. A season/episode lookup also marks
who is already on the parent (show/season), so the dialog can preselect them.

Shows have no `director` role (see `CastRole`): a show is authored. A director
of every episode is offered at show level as `creator`, with a reason saying so;
seasons and episodes keep `director`.

Every episode the show/season step creates also gets its own director(s) and
composer(s) automatically — the season payload already carries them.
"""

from __future__ import annotations

import math

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable, Literal, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import tmdb_common as common
from .api_models.tmdb_tv_import import (
    TmdbTvSyncOut,
    TmdbTvDbPersonMatchOut,
    TmdbTvEpisodeImportIn,
    TmdbTvEpisodeImportOut,
    TmdbTvEpisodeLookupIn,
    TmdbTvEpisodeLookupOut,
    TmdbTvEpisodeOut,
    TmdbTvGenreOut,
    TmdbTvImportEpisodeIn,
    TmdbTvImportIn,
    TmdbTvImportOut,
    TmdbTvImportPersonIn,
    TmdbTvImportPersonResult,
    TmdbTvImportSeasonIn,
    TmdbTvLookupOut,
    TmdbTvPersonOut,
    TmdbTvSeasonImportIn,
    TmdbTvSeasonImportOut,
    TmdbTvSeasonLookupIn,
    TmdbTvSeasonLookupOut,
    TmdbTvSeasonOut,
)
from .normalize import norm as db_norm
from .database_models import (
    TELEVISION_EPISODE_ROLES,
    TELEVISION_SEASON_ROLES,
    TELEVISION_SHOW_ROLES,
    CastRole,
    Person,
    TelevisionEpisode,
    TelevisionSeason,
    TelevisionShow,
    TelevisionShowPerson,
    UserTelevisionEpisodeRank,
    UserTelevisionSeasonRank,
    UserTelevisionShowRank,
)
from .normalize import norm
from .ranking import next_rank
from .television_hierarchy import (
    merge_people, next_episode_rank, next_season_rank, populate_season_down, populate_show_down,
)
from .tmdb_client import WORKERS, TmdbClient

MEDIA_FLAG = "is_television"

# TMDB job strings (lowercased) by the role they imply.
COMPOSER_JOBS = {
    "original music composer",
    "composer",
    "music",
    "original music",
    "series composer",
    "theme song performance",
}
DIRECTOR_JOBS = {"director", "series director", "co-director"}

# ── Raw (pre-enrichment) credits ─────────────────────────────────────
@dataclass
class _Credit:
    tmdb_id: int
    name: str
    credit_type: str  # "cast" | "crew" | "guest"
    role: CastRole
    reason: str
    character: Optional[str] = None
    billing_order: Optional[int] = None
    job: Optional[str] = None
    episode_count: Optional[int] = None

    def key(self) -> tuple:
        return (self.tmdb_id, self.role, self.credit_type)


def _dedupe(credits: Iterable[_Credit]) -> list[_Credit]:
    seen: set[tuple] = set()
    out: list[_Credit] = []
    for c in credits:
        if not c.tmdb_id or not c.name or c.key() in seen:
            continue
        seen.add(c.key())
        out.append(c)
    return out


def _year_of(date_s: str | None, fallback: int) -> int:
    if date_s and len(date_s) >= 4 and date_s[:4].isdigit():
        return int(date_s[:4])
    return fallback


def _aired(episodes: list[dict]) -> list[dict]:
    """Episodes that have aired. "Every episode" is measured against these: an
    announced, unaired episode has no credits yet, so counting it would leave
    nobody credited on all of them."""
    today = date.today().isoformat()
    return [e for e in episodes if e.get("air_date") and e["air_date"] <= today]


# ── "Credited on every episode" ──────────────────────────────────────
@dataclass
class _Tally:
    tmdb_id: int
    name: str
    eps: int
    character: Optional[str] = None
    order: Optional[int] = None
    popularity: float = 0.0
    job: Optional[str] = None


Kind = Literal["cast", "director", "composer"]


def _tally(agg: dict) -> dict[tuple[int, Kind], _Tally]:
    """One season's aggregate credits -> episode counts per (person, kind)."""
    out: dict[tuple[int, Kind], _Tally] = {}
    for m in agg.get("cast") or []:
        roles = m.get("roles") or []
        eps = m.get("total_episode_count") or max((r.get("episode_count") or 0 for r in roles), default=0)
        character = next((r.get("character") for r in roles if r.get("character")), None) or m.get("character")
        out[(m.get("id"), "cast")] = _Tally(
            m.get("id"), m.get("name") or "", eps, character=character,
            order=m.get("order"), popularity=m.get("popularity") or 0,
        )
    for m in agg.get("crew") or []:
        # aggregate_credits groups one person's jobs; plain credits has one.
        for entry in m.get("jobs") or [{"job": m.get("job"), "episode_count": m.get("episode_count")}]:
            job = (entry.get("job") or "").strip()
            jl = job.lower()
            kind: Kind | None = "director" if jl in DIRECTOR_JOBS else "composer" if jl in COMPOSER_JOBS else None
            if kind is None:
                continue  # not a role this app tracks
            eps = entry.get("episode_count") or 0
            prev = out.get((m.get("id"), kind))
            if prev is None or eps > prev.eps:
                out[(m.get("id"), kind)] = _Tally(m.get("id"), m.get("name") or "", eps, job=job)
    return out


#: The import dialogs offer a show/season credit to whoever is on at least this
#: share of the episodes of every season, so a lead who missed an episode or
#: two still counts as main cast. The scan keeps 1.0: it only places a credit
#: higher up when that's exactly true.
MAIN_CAST_SHARE = 0.8


def _every_episode(
    scopes: list[tuple[int, dict[tuple[int, Kind], _Tally]]],
    *,
    level: Literal["show", "season"],
    share: float = 1.0,
) -> list[_Credit]:
    """Credits held in *every* scope (season) on at least `share` of that
    scope's episodes — with the default, on every single episode. `scopes` is
    [(episodes, tally)]."""
    scopes = [(n, t) for n, t in scopes if n > 0]
    if not scopes:
        return []
    total = sum(n for n, _ in scopes)
    where = "episodes" if level == "show" else "episodes of the season"
    crew: list[_Credit] = []
    cast: list[_Credit] = []
    for key, t in scopes[0][1].items():
        if not all(tally.get(key) is not None and tally[key].eps >= math.ceil(n * share) for n, tally in scopes):
            continue
        on = sum(min(tally[key].eps, n) for n, tally in scopes)
        span = f"all {total}" if on >= total else f"{on} of {total}"
        kind = key[1]
        if kind == "cast":
            role, reason = common.suggest_cast_role(
                order=t.order, popularity=t.popularity, character=t.character or "",
                episode_count=total, total_episodes=total,
            )
            cast.append(_Credit(
                t.tmdb_id, t.name, "cast", role, f"in {span} {where} — {reason}",
                character=t.character, billing_order=t.order, episode_count=on,
            ))
        elif kind == "director" and level == "show":
            crew.append(_Credit(
                t.tmdb_id, t.name, "crew", CastRole.creator,
                f"directed {span} episodes; shows have no director role, so this is offered as a "
                f"show-level Creator credit",
                job=t.job, episode_count=on,
            ))
        else:
            role = CastRole.director if kind == "director" else CastRole.composer
            crew.append(_Credit(
                t.tmdb_id, t.name, "crew", role, f"credited as {t.job} on {span} {where}",
                job=t.job, episode_count=on,
            ))
    cast.sort(key=lambda c: 999 if c.billing_order is None else c.billing_order)
    return crew + cast


def _creators(details: dict) -> list[_Credit]:
    return [
        _Credit(
            tmdb_id=creator.get("id"), name=creator.get("name") or "", credit_type="crew",
            role=CastRole.creator, reason="TMDB lists them as a creator of the series", job="Creator",
        )
        for creator in details.get("created_by") or []
    ]


def _episode_credits(credits: dict) -> list[_Credit]:
    """Episode-level: exactly this episode's cast, guest stars and crew."""
    out: list[_Credit] = list(_episode_auto_crew(credits))

    for m in credits.get("cast") or []:
        role, reason = common.suggest_cast_role(
            order=m.get("order"),
            popularity=m.get("popularity") or 0,
            character=m.get("character") or "",
        )
        out.append(
            _Credit(
                m.get("id"), m.get("name") or "", "cast", role, reason,
                character=m.get("character"), billing_order=m.get("order"),
            )
        )

    for m in credits.get("guest_stars") or []:
        role, reason = common.suggest_cast_role(
            order=m.get("order"),
            popularity=m.get("popularity") or 0,
            character=m.get("character") or "",
        )
        out.append(
            _Credit(
                m.get("id"), m.get("name") or "", "guest", role, f"guest star — {reason}",
                character=m.get("character"), billing_order=m.get("order"),
            )
        )

    return _dedupe(out)


def _episode_auto_crew(episode: dict) -> list[_Credit]:
    """An episode's director(s) and composer(s). The show/season step attaches
    these automatically (the season payload embeds each episode's crew)."""
    out: list[_Credit] = []
    for m in episode.get("crew") or []:
        job = (m.get("job") or "").strip()
        jl = job.lower()
        if jl in DIRECTOR_JOBS:
            role = CastRole.director  # episodes keep director
        elif jl in COMPOSER_JOBS:
            role = CastRole.composer
        else:
            continue
        out.append(
            _Credit(
                m.get("id"), m.get("name") or "", "crew", role,
                f"credited as {job} on this episode", job=job,
            )
        )
    return _dedupe(out)


# ── TMDB fetches ─────────────────────────────────────────────────────
def _fetch(c: TmdbClient, path: str) -> Optional[dict]:
    try:
        return c.get(path)
    except Exception:
        return None


def _fetch_seasons(c: TmdbClient, tmdb_id: int, numbers: list[int]) -> dict[int, tuple[Optional[dict], Optional[dict]]]:
    """season number -> (season payload, season aggregate credits), in parallel."""
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {
            n: (ex.submit(_fetch, c, f"/tv/{tmdb_id}/season/{n}"),
                ex.submit(_fetch, c, f"/tv/{tmdb_id}/season/{n}/aggregate_credits"))
            for n in numbers
        }
        return {n: (data.result(), agg.result()) for n, (data, agg) in futures.items()}


def _resolve_show(c: TmdbClient, tmdb_show_id: int | None, title: str | None, year: int | None) -> tuple[Optional[int], bool]:
    if tmdb_show_id is not None:
        return tmdb_show_id, False
    if not title:
        raise ValueError("Either tmdb_show_id or title is required")
    best, ambiguous = common.search_best(
        c, "/search/tv", title, year=year, year_param="first_air_date_year",
        title_keys=("name", "original_name"),
    )
    return (best["id"] if best else None), ambiguous


def _remember_show_id(db: Session, show: TelevisionShow, tmdb_id: int | None, ambiguous: bool) -> None:
    """A show entered by hand learns its TMDB id from its first unambiguous
    season/episode lookup, so later ones go straight to it."""
    if show.tmdb_id is None and tmdb_id is not None and not ambiguous and not db.scalar(
        select(TelevisionShow.id).where(TelevisionShow.guild_id == show.guild_id, TelevisionShow.tmdb_id == tmdb_id)
    ):
        show.tmdb_id = tmdb_id
        db.commit()


def _default_runtime(details: dict) -> int:
    runtimes = details.get("episode_run_time") or []
    return int(runtimes[0]) if runtimes else 0


# ── Enrichment (DB matches + TMDB person data) ───────────────────────
class _Enricher:
    """Batch-loads candidate people and TMDB person data for a set of credits,
    then shapes each credit for the wire. `parent_links` (the show's links for a
    season lookup, the season's for an episode lookup) drive `parent_roles`."""

    def __init__(self, db: Session, guild_id: int, c: TmdbClient, credits: list[_Credit], parent_links=()):
        self._persons_by_name = common.batch_load_persons(db, guild_id, {cr.name for cr in credits})
        db.commit()  # loaded eagerly; release the connection before the next network calls
        self._data = common.fetch_person_data_bulk(c, [cr.tmdb_id for cr in credits])
        self._cache: dict[tuple[int, str], common.PersonEnrichment] = {}
        self._parent: dict[int, list[CastRole]] = defaultdict(list)
        for link in parent_links:
            self._parent[link.person_id].append(link.role)

    def out(self, cr: _Credit) -> TmdbTvPersonOut:
        ck = (cr.tmdb_id, cr.name)
        if ck not in self._cache:
            data = self._data.get(cr.tmdb_id) or common.PersonTmdbData(cr.tmdb_id)
            self._cache[ck] = common.build_enrichment(data, cr.name, self._persons_by_name)
        e = self._cache[ck]
        # A verified match wins over a name-only one when deciding who this is.
        on_parent = next(
            (m for m in sorted(e.db_matches, key=lambda m: not m.filmography_overlap) if m.person_id in self._parent),
            None,
        )
        return TmdbTvPersonOut(
            tmdb_id=cr.tmdb_id,
            name=cr.name,
            credit_type=cr.credit_type,  # type: ignore[arg-type]
            character=cr.character,
            billing_order=cr.billing_order,
            job=cr.job,
            episode_count=cr.episode_count,
            suggested_role=cr.role,
            suggestion_reason=cr.reason,
            top_credits=e.top_credits,
            nationality_guess=e.nationality_guess,
            birth_place=e.birth_place,
            db_matches=[
                TmdbTvDbPersonMatchOut(
                    person_id=m.person_id,
                    person_name=m.person_name,
                    has_screen_entries=m.has_screen_entries,
                    filmography_overlap=m.filmography_overlap,
                    artist_summary=m.artist_summary,
                    game_summary=m.game_summary,
                )
                for m in e.db_matches
            ],
            parent_roles=self._parent[on_parent.person_id] if on_parent else [],
            parent_person_id=on_parent.person_id if on_parent else None,
        )


def _episode_out(e: dict, season_number: int, show_year: int, default_runtime: int, people: list[TmdbTvPersonOut]) -> TmdbTvEpisodeOut:
    n = e.get("episode_number") or 0
    return TmdbTvEpisodeOut(
        tmdb_id=e.get("id"),
        season_number=e.get("season_number") or season_number,
        episode_number=n,
        name=e.get("name") or f"Episode {n}",
        air_date=e.get("air_date"),
        release_year=_year_of(e.get("air_date"), show_year),
        runtime=int(e.get("runtime") or default_runtime or 0),
        overview=e.get("overview") or None,
        still_url=common.image_url(e.get("still_path"), "w300"),
        people=people,
    )


def _season_out(
    data: dict, meta: dict, show_year: int, default_runtime: int, enricher: _Enricher,
    auto_crew: dict[int, list[_Credit]], *, people: list[_Credit] = (), counted: int = 0,
) -> TmdbTvSeasonOut:
    number = meta.get("season_number", data.get("season_number"))
    episodes = sorted(data.get("episodes") or [], key=lambda e: e.get("episode_number") or 0)
    air_date = data.get("air_date") or meta.get("air_date")
    return TmdbTvSeasonOut(
        season_number=number,
        name=data.get("name") or meta.get("name") or f"Season {number}",
        air_date=air_date,
        release_year=_year_of(air_date, show_year),
        episode_count=len(episodes),
        overview=data.get("overview") or meta.get("overview") or None,
        poster_url=common.image_url(data.get("poster_path") or meta.get("poster_path")),
        episodes=[
            _episode_out(e, number, show_year, default_runtime,
                         [enricher.out(cr) for cr in auto_crew.get(e.get("id"), [])])
            for e in episodes
        ],
        people=[enricher.out(cr) for cr in people],
        episodes_counted=counted,
    )


# ── Lookup: whole show ───────────────────────────────────────────────
def tv_lookup(
    db: Session,
    guild_id: int,
    title: str,
    year: int | None = None,
    *,
    include_episodes: bool = True,
    include_specials: bool = False,
    season_numbers: list[int] | None = None,
    tmdb_id: int | None = None,
) -> Optional[TmdbTvLookupOut]:
    c = common.client()

    tmdb_id = tmdb_id or common.parse_tmdb_ref(title, "tv")
    candidates: list[dict] = []
    ambiguous = False
    if tmdb_id is None:
        best, ambiguous = common.search_best(
            c, "/search/tv", title, year=year, year_param="first_air_date_year",
            title_keys=("name", "original_name"),
        )
        if best is None:
            return None
        tmdb_id = best["id"]
        candidates = common.search_candidates(
            c, "/search/tv", title, year=year, year_param="first_air_date_year",
            title_key="name", date_key="first_air_date",
        )
    details = c.get(f"/tv/{tmdb_id}")
    if details is None:
        return None

    show_year = _year_of(details.get("first_air_date"), 0)
    default_runtime = _default_runtime(details)

    # Seasons are always fetched: even without episodes, "credited on every
    # episode" needs each season's episode list and aggregate credits.
    wanted = [
        s for s in details.get("seasons") or []
        if s.get("season_number") is not None
        and (s["season_number"] != 0 or include_specials)
        and (season_numbers is None or s["season_number"] in season_numbers)
    ]
    fetched = _fetch_seasons(c, tmdb_id, [s["season_number"] for s in wanted])

    scopes: list[tuple[int, dict]] = []
    seasons: list[tuple[dict, dict]] = []  # (meta, payload)
    auto_crew: dict[int, list[_Credit]] = {}
    for meta in wanted:
        data, agg = fetched.get(meta["season_number"], (None, None))
        if not data:
            continue
        seasons.append((meta, data))
        scopes.append((len(_aired(data.get("episodes") or [])), _tally(agg or {})))
        if include_episodes:
            for e in data.get("episodes") or []:
                auto_crew[e.get("id")] = _episode_auto_crew(e)

    show_raw = _dedupe(_creators(details) + _every_episode(scopes, level="show", share=MAIN_CAST_SHARE))
    enricher = _Enricher(db, guild_id, c, show_raw + [cr for crs in auto_crew.values() for cr in crs])

    seasons_out = []
    for meta, data in sorted(seasons, key=lambda s: s[0]["season_number"]):
        out = _season_out(data, meta, show_year, default_runtime, enricher, auto_crew,
                          counted=len(_aired(data.get("episodes") or [])))
        if not include_episodes:
            out.episodes = []
        seasons_out.append(out)

    db_genres = common.db_genres_for(db, guild_id, MEDIA_FLAG)
    return TmdbTvLookupOut(
        tmdb_id=tmdb_id,
        name=details.get("name") or title,
        original_name=details.get("original_name"),
        first_air_date=details.get("first_air_date"),
        release_year=show_year,
        overview=details.get("overview") or None,
        poster_url=common.image_url(details.get("poster_path")),
        existing_show_id=_existing_show(db, guild_id, tmdb_id, details),
        candidates=[x for x in candidates if x["tmdb_id"] != tmdb_id],
        episode_run_time=default_runtime,
        number_of_seasons=details.get("number_of_seasons") or len(seasons_out),
        number_of_episodes=details.get("number_of_episodes") or sum(s.episode_count for s in seasons_out),
        people=[enricher.out(cr) for cr in show_raw],
        episodes_counted=sum(n for n, _ in scopes),
        genres=[
            TmdbTvGenreOut(tmdb_id=tid, tmdb_name=name, db_genre_id=gid)
            for tid, name, gid in common.match_genres(details.get("genres", []), db_genres)
        ],
        seasons=seasons_out,
        ambiguous=ambiguous,
    )


# ── Lookup: one season ───────────────────────────────────────────────
def _get_show(db: Session, guild_id: int, show_id: int) -> TelevisionShow:
    show = db.get(TelevisionShow, show_id)
    if show is None or show.guild_id != guild_id:
        raise ValueError(f"Television show {show_id} not found")
    return show


def _get_season(db: Session, guild_id: int, season_id: int) -> TelevisionSeason:
    season = db.get(TelevisionSeason, season_id)
    if season is None or season.guild_id != guild_id:
        raise ValueError(f"Television season {season_id} not found")
    return season


def tv_season_lookup(db: Session, guild_id: int, body: TmdbTvSeasonLookupIn) -> Optional[TmdbTvSeasonLookupOut]:
    """One season: everyone credited on every one of its episodes, and its
    episode list (with each episode's automatic director/composer)."""
    show = _get_show(db, guild_id, body.show_id)
    c = common.client()
    tmdb_show_id, ambiguous = _resolve_show(c, body.tmdb_show_id or show.tmdb_id, body.title or show.name, body.year)
    _remember_show_id(db, show, tmdb_show_id, ambiguous)
    if tmdb_show_id is None:
        return None
    details = c.get(f"/tv/{tmdb_show_id}")
    if details is None:
        return None
    data, agg = _fetch_seasons(c, tmdb_show_id, [body.season_number])[body.season_number]
    if not data:
        return None

    episodes = data.get("episodes") or []
    # An entirely unaired season is measured against its announced episodes.
    counted = len(_aired(episodes)) or len(episodes)
    people = _every_episode([(counted, _tally(agg or {}))], level="season", share=MAIN_CAST_SHARE)
    auto_crew = {e.get("id"): _episode_auto_crew(e) for e in episodes}

    enricher = _Enricher(db, guild_id, c, people + [cr for crs in auto_crew.values() for cr in crs],
                         parent_links=show.person_links)
    show_year = _year_of(details.get("first_air_date"), show.release_year)
    meta = next((s for s in details.get("seasons") or [] if s.get("season_number") == body.season_number),
                {"season_number": body.season_number})
    return TmdbTvSeasonLookupOut(
        tmdb_show_id=tmdb_show_id,
        show_name=details.get("name") or show.name,
        show_ambiguous=ambiguous,
        season=_season_out(data, meta, show_year, _default_runtime(details), enricher, auto_crew,
                           people=people, counted=counted),
    )


# ── Lookup: one episode ──────────────────────────────────────────────
def _locate_episode(
    c: TmdbClient,
    tmdb_show_id: int,
    details: dict,
    *,
    season_number: int | None,
    episode_number: int | None,
    episode_name: str | None,
) -> Optional[tuple[int, int]]:
    """Our episodes store a rank within their season, not an episode number,
    so the usual way in is the episode's title."""
    if season_number is not None and episode_number is not None:
        return season_number, episode_number
    if not episode_name:
        return None
    needle = common.norm(episode_name)
    seasons = [s for s in (details.get("seasons") or []) if s.get("season_number") is not None]
    if season_number is not None:
        seasons = [s for s in seasons if s["season_number"] == season_number]
    for s in sorted(seasons, key=lambda s: s["season_number"]):
        data = _fetch(c, f"/tv/{tmdb_show_id}/season/{s['season_number']}")
        for e in (data or {}).get("episodes") or []:
            if common.norm(e.get("name") or "") == needle:
                return e.get("season_number") or s["season_number"], e.get("episode_number") or 0
    return None


def tv_episode_lookup(db: Session, guild_id: int, body: TmdbTvEpisodeLookupIn) -> Optional[TmdbTvEpisodeLookupOut]:
    """One episode's full cast, guest stars and crew."""
    season = _get_season(db, guild_id, body.season_id) if body.season_id is not None else None
    c = common.client()

    title = body.title or (season.show.name if season else None)
    known = season.show.tmdb_id if season else None
    tmdb_show_id, ambiguous = _resolve_show(c, body.tmdb_show_id or known, title, body.year)
    if season:
        _remember_show_id(db, season.show, tmdb_show_id, ambiguous)
    if tmdb_show_id is None:
        return None
    details = c.get(f"/tv/{tmdb_show_id}")
    if details is None:
        return None

    season_number = body.season_number
    if season_number is None and season is not None:
        season_number = season.season_number
    located = _locate_episode(
        c, tmdb_show_id, details,
        season_number=season_number,
        episode_number=body.episode_number,
        episode_name=body.episode_name,
    )
    if located is None:
        return None
    season_number, episode_number = located

    base = f"/tv/{tmdb_show_id}/season/{season_number}/episode/{episode_number}"
    episode = c.get(base)
    if episode is None:
        return None
    raw = _episode_credits(c.get(f"{base}/credits") or {})
    enricher = _Enricher(db, guild_id, c, raw, parent_links=season.person_links if season else ())

    show_year = _year_of(details.get("first_air_date"), 0)
    return TmdbTvEpisodeLookupOut(
        tmdb_show_id=tmdb_show_id,
        show_name=details.get("name") or (title or ""),
        show_ambiguous=ambiguous,
        episode=_episode_out(episode, season_number, show_year, _default_runtime(details),
                             [enricher.out(cr) for cr in raw]),
    )


# ── Import ───────────────────────────────────────────────────────────
def _resolve_people(
    resolver: common.PeopleResolver,
    people: list[TmdbTvImportPersonIn],
    allowed: frozenset[CastRole],
    error: str,
) -> list[tuple[int, CastRole]]:
    out: list[tuple[int, CastRole]] = []
    for p in people:
        if p.role not in allowed:
            raise ValueError(error)
        person = resolver.resolve(
            tmdb_id=p.tmdb_id, name=p.name, nationality=p.nationality, existing_person_id=p.existing_person_id,
        )
        out.append((person.id, p.role))
    return out


def _link_episode_people(
    db: Session,
    season: TelevisionSeason,
    episode: TelevisionEpisode,
    body: TmdbTvImportEpisodeIn,
    resolver: common.PeopleResolver,
) -> int:
    """Merge the selected credits into `episode`, idempotently. -> links added."""
    people: list[tuple[int, CastRole]] = []
    if body.inherit_parent_people:
        people += [(l.person_id, l.role) for l in season.person_links]
    people += _resolve_people(resolver, body.people, TELEVISION_EPISODE_ROLES,
                              "The creator role only applies to shows, not episodes")
    return merge_people(db, episode, people)


def _episode_genres(db: Session, guild_id: int, show: TelevisionShow, genre_ids: list[int] | None) -> list:
    if genre_ids is None:
        return list(show.genres)
    wanted = set(genre_ids)
    return [g for g in common.db_genres_for(db, guild_id, MEDIA_FLAG) if g.id in wanted]


def _create_episode(
    db: Session,
    guild_id: int,
    user_id: int,
    season: TelevisionSeason,
    body: TmdbTvImportEpisodeIn,
    resolver: common.PeopleResolver,
) -> tuple[TelevisionEpisode, int]:
    episode = TelevisionEpisode(
        guild_id=guild_id, created_by_user_id=user_id,
        show_id=season.show_id,
        season_id=season.id,
        name=body.name or season.name,
        name_en=body.name_en,
        runtime_minutes=body.runtime_minutes,
        release_year=body.release_year,
        notes=body.notes,
        episode_rank=next_episode_rank(db, season.id),
        episode_number=body.episode_number,
        overview=body.overview,
        image_url=body.still_url,
    )
    episode.genres = _episode_genres(db, guild_id, season.show, body.genre_ids)
    db.add(episode)
    db.flush()
    return episode, _link_episode_people(db, season, episode, body, resolver)


def _create_season(db: Session, guild_id: int, user_id: int, show: TelevisionShow, body: TmdbTvImportSeasonIn) -> TelevisionSeason:
    season = TelevisionSeason(
        guild_id=guild_id, created_by_user_id=user_id,
        show_id=show.id,
        name=body.name or (f"Season {body.season_number}" if body.season_number is not None else show.name),
        name_en=body.name_en,
        season_number=body.season_number,
        release_year=body.release_year,
        notes=body.notes,
        season_rank=next_season_rank(db, show.id),
        overview=body.overview,
        image_url=body.poster_url,
    )
    db.add(season)
    db.flush()
    return season


def _ensure_season_episodes(
    db: Session,
    guild_id: int,
    user_id: int,
    season: TelevisionSeason,
    episodes: list[TmdbTvImportEpisodeIn],
    resolver: common.PeopleResolver,
    *,
    credit_existing: bool = False,
) -> tuple[list[int], int]:
    """Make each listed episode exist in `season`, in order. -> (ids, created).
    One already in the season (same normalised title) is left as it is, so a
    re-import doesn't duplicate, unless `credit_existing` asks for its credits to
    be merged in; anything else is created."""
    in_season: dict[str, list[TelevisionEpisode]] = defaultdict(list)
    for e in season.episodes:
        in_season[norm(e.name)].append(e)

    ids: list[int] = []
    created = 0
    for body in episodes:
        matches = in_season.get(norm(body.name))
        if matches:
            existing = matches.pop(0)
            if credit_existing:
                _link_episode_people(db, season, existing, body, resolver)
            ids.append(existing.id)
            continue
        episode, _ = _create_episode(db, guild_id, user_id, season, body, resolver)
        created += 1
        ids.append(episode.id)
    return ids, created


def _people_results(resolver: common.PeopleResolver) -> dict:
    return {
        "created_people": [TmdbTvImportPersonResult(**vars(r)) for r in resolver.created],
        "reused_people": [TmdbTvImportPersonResult(**vars(r)) for r in resolver.reused],
    }


def _existing_show(db: Session, guild_id: int, tmdb_id: int, details: dict) -> int | None:
    """The catalog's copy of a TMDB show, if any: by TMDB id, else by title
    (English or original) and first-air year."""
    found = db.scalar(select(TelevisionShow.id).where(
        TelevisionShow.guild_id == guild_id, TelevisionShow.tmdb_id == tmdb_id,
    ))
    if found is not None:
        return found
    titles = {db_norm(t) for t in (details.get("name"), details.get("original_name")) if t} - {""}
    year = (details.get("first_air_date") or "")[:4]
    if not titles or not year.isdigit():
        return None
    return db.scalar(select(TelevisionShow.id).where(
        TelevisionShow.guild_id == guild_id, TelevisionShow.release_year == int(year),
        TelevisionShow.name_norm.in_(titles) | TelevisionShow.name_en_norm.in_(titles),
    ).limit(1))


def _add_full_cast(db: Session, guild_id: int, tmdb_show_id: int | None, seasons: list[TmdbTvImportSeasonIn]) -> None:
    """Add every episode's whole cast to its import body. Runs before anything is
    written: it's one TMDB call per episode, plus one per new person (their
    nationality). A name with exactly one unidentified person in the catalog is
    taken to be them, as the dialogs do; anything else goes to the resolver."""
    if tmdb_show_id is None:
        raise ValueError("The full episode cast needs the show's TMDB id")
    c = common.client()
    fetched: list[tuple[TmdbTvImportEpisodeIn, list[_Credit]]] = []
    for season in seasons:
        for ep in season.episodes:
            if season.season_number is None or ep.episode_number is None:
                continue
            data = _fetch(c, f"/tv/{tmdb_show_id}/season/{season.season_number}/episode/{ep.episode_number}/credits")
            if data:
                fetched.append((ep, [cr for cr in _episode_credits(data) if cr.role in TELEVISION_EPISODE_ROLES]))

    credits = [cr for _, crs in fetched for cr in crs]
    by_name = common.batch_load_persons(db, guild_id, {cr.name for cr in credits})
    known = set(db.scalars(select(Person.tmdb_id).where(
        Person.guild_id == guild_id, Person.tmdb_id.in_({cr.tmdb_id for cr in credits}),
    )).all())

    def existing_id(cr: _Credit) -> int | None:
        same = by_name.get(db_norm(cr.name)) or []
        return same[0].id if cr.tmdb_id not in known and len(same) == 1 and same[0].tmdb_id is None else None

    new = {cr.tmdb_id for cr in credits if cr.tmdb_id not in known and existing_id(cr) is None}
    details = common.fetch_person_data_bulk(c, list(new))
    for ep, crs in fetched:
        have = {(p.tmdb_id, p.role) for p in ep.people}
        for cr in crs:
            if (cr.tmdb_id, cr.role) in have:
                continue
            have.add((cr.tmdb_id, cr.role))
            data = details.get(cr.tmdb_id)
            nationality = common.derive_nationality(data.details)[0] if data and data.details else "Unknown"
            ep.people.append(TmdbTvImportPersonIn(
                tmdb_id=cr.tmdb_id, name=cr.name, role=cr.role, nationality=nationality,
                existing_person_id=existing_id(cr),
            ))


def tmdb_import_show(db: Session, guild_id: int, user_id: int, body: TmdbTvImportIn) -> TmdbTvImportOut:
    if body.full_episode_cast:
        db.commit()  # hand the pooled connection back during the TMDB calls
        _add_full_cast(db, guild_id, body.tmdb_id, body.seasons)
    titles = {db_norm(t) for t in (body.name, body.name_en) if t} - {""}
    existing = db.scalar(
        select(TelevisionShow).where(
            TelevisionShow.guild_id == guild_id,
            TelevisionShow.name_norm.in_(titles) | TelevisionShow.name_en_norm.in_(titles),
            TelevisionShow.release_year == body.release_year,
        )
    )
    if existing is None and body.tmdb_id is not None:
        existing = db.scalar(select(TelevisionShow).where(
            TelevisionShow.guild_id == guild_id, TelevisionShow.tmdb_id == body.tmdb_id,
        ))
    if existing is not None:
        raise ValueError(
            f"Television show '{body.name}' ({body.release_year}) already exists (id={existing.id})"
        )

    show = TelevisionShow(
        guild_id=guild_id, created_by_user_id=user_id,
        name=body.name,
        name_en=body.name_en,
        release_year=body.release_year,
        notes=body.notes,
        tmdb_id=body.tmdb_id,
        overview=body.overview,
        image_url=body.poster_url,
    )
    show.genres = [g for g in common.db_genres_for(db, guild_id, MEDIA_FLAG) if g.id in set(body.genre_ids)]
    db.add(show)
    db.flush()

    resolver = common.PeopleResolver(db, guild_id, user_id)
    linked: set[tuple[int, CastRole]] = set()
    for key in _resolve_people(resolver, body.people, TELEVISION_SHOW_ROLES,
                               "Shows are credited with the creator role, not director"):
        if key not in linked:
            linked.add(key)
            db.add(TelevisionShowPerson(show_id=show.id, person_id=key[0], role=key[1], guild_id=guild_id))
    db.flush()

    if body.add_to_list:
        db.add(UserTelevisionShowRank(
            user_id=user_id, guild_id=guild_id, show_id=show.id,
            rank=next_rank(db, UserTelevisionShowRank, user_id=user_id, guild_id=guild_id),
        ))

    season_ids: list[int] = []
    episode_ids: list[int] = []
    listed_seasons = 0
    for season_in in body.seasons:
        season = _create_season(db, guild_id, user_id, show, season_in)
        season_ids.append(season.id)
        merge_people(db, season, _resolve_people(resolver, season_in.people, TELEVISION_SEASON_ROLES,
                                                 "The creator role only applies to shows, not seasons"))
        episodes = [_create_episode(db, guild_id, user_id, season, ep, resolver)[0] for ep in season_in.episodes]
        episode_ids.extend(e.id for e in episodes)

        # The show is brand new, so its personal lists start empty: rank in airing order.
        if season_in.add_to_list:
            listed_seasons += 1
            db.add(UserTelevisionSeasonRank(
                user_id=user_id, guild_id=guild_id, season_id=season.id, show_id=show.id,
                rank=Decimal(listed_seasons),
            ))
            for i, episode in enumerate(episodes, start=1):
                db.add(UserTelevisionEpisodeRank(
                    user_id=user_id, guild_id=guild_id, episode_id=episode.id,
                    show_id=show.id, season_id=season.id, watches=1, rank=Decimal(i),
                ))

    if body.populate_down:
        populate_show_down(db, show)

    return TmdbTvImportOut(show_id=show.id, season_ids=season_ids, episode_ids=episode_ids, **_people_results(resolver))


def tmdb_import_season(db: Session, guild_id: int, user_id: int, body: TmdbTvSeasonImportIn) -> TmdbTvSeasonImportOut:
    show = _get_show(db, guild_id, body.show_id)
    if body.full_episode_cast:
        tmdb_show_id = show.tmdb_id
        db.commit()  # hand the pooled connection back during the TMDB calls
        _add_full_cast(db, guild_id, tmdb_show_id, [body.season])
    resolver = common.PeopleResolver(db, guild_id, user_id)

    if body.season_id is None:
        season = _create_season(db, guild_id, user_id, show, body.season)
        created = True
    else:
        season = _get_season(db, guild_id, body.season_id)
        if season.show_id != show.id:
            raise ValueError("That season belongs to a different show")
        if body.update_season_fields:
            # Opt-in: the user may have edited these since the show import.
            season.name = body.season.name or season.name
            season.season_number = body.season.season_number
            season.release_year = body.season.release_year
            season.overview = body.season.overview or season.overview
            season.image_url = body.season.poster_url or season.image_url
            db.flush()
        # Filling a gap never overwrites anything, so it needs no opt-in.
        season.overview = season.overview or body.season.overview
        season.image_url = season.image_url or body.season.poster_url
        created = False

    added = merge_people(db, season, _resolve_people(resolver, body.season.people, TELEVISION_SEASON_ROLES,
                                                     "The creator role only applies to shows, not seasons"))
    _, episodes_created = _ensure_season_episodes(
        db, guild_id, user_id, season, body.season.episodes, resolver, credit_existing=body.full_episode_cast,
    )
    if body.populate_down:
        populate_season_down(db, season)

    return TmdbTvSeasonImportOut(
        show_id=show.id,
        season_id=season.id,
        created=created,
        people_linked=added,
        episodes_created=episodes_created,
        **_people_results(resolver),
    )


def tmdb_import_episode(db: Session, guild_id: int, user_id: int, body: TmdbTvEpisodeImportIn) -> TmdbTvEpisodeImportOut:
    season = _get_season(db, guild_id, body.season_id)
    resolver = common.PeopleResolver(db, guild_id, user_id)

    if body.episode_id is None:
        episode, added = _create_episode(db, guild_id, user_id, season, body.episode, resolver)
        created = True
    else:
        episode = db.get(TelevisionEpisode, body.episode_id)
        if episode is None or episode.guild_id != guild_id:
            raise ValueError(f"Television episode {body.episode_id} not found")
        if episode.season_id != season.id:
            raise ValueError("That episode belongs to a different season")
        if body.update_episode_fields:
            # Opt-in: the user may have edited these since the show import.
            episode.name = body.episode.name or episode.name
            episode.runtime_minutes = body.episode.runtime_minutes
            episode.release_year = body.episode.release_year
            episode.episode_number = body.episode.episode_number or episode.episode_number
            episode.overview = body.episode.overview or episode.overview
            episode.image_url = body.episode.still_url or episode.image_url
            if body.episode.genre_ids is not None:
                episode.genres = _episode_genres(db, guild_id, season.show, body.episode.genre_ids)
            db.flush()
        episode.episode_number = episode.episode_number or body.episode.episode_number
        episode.overview = episode.overview or body.episode.overview
        episode.image_url = episode.image_url or body.episode.still_url
        added = _link_episode_people(db, season, episode, body.episode, resolver)
        created = False

    return TmdbTvEpisodeImportOut(
        show_id=season.show_id,
        season_id=season.id,
        episode_id=episode.id,
        created=created,
        people_linked=added,
        **_people_results(resolver),
    )


def _credit_in(p: TmdbTvPersonOut) -> TmdbTvImportPersonIn:
    """An episode's automatic crew member, identified as the dialogs would: whoever
    they already are on the parent, a verified match, or the only person of that name."""
    verified = next((m.person_id for m in p.db_matches if m.filmography_overlap), None)
    only = p.db_matches[0].person_id if len(p.db_matches) == 1 else None
    return TmdbTvImportPersonIn(
        tmdb_id=p.tmdb_id, name=p.name, role=p.suggested_role, nationality=p.nationality_guess,
        existing_person_id=p.parent_person_id or verified or only,
    )


def tmdb_sync_show(db: Session, guild_id: int, user_id: int, show_id: int) -> TmdbTvSyncOut:
    """Bring a show up to date with TMDB: add the seasons and episodes it's missing
    and correct episode runtimes. Nothing is removed, and nothing is added to anyone's list."""
    show = _get_show(db, guild_id, show_id)
    has_specials = any(s.season_number == 0 for s in show.seasons)
    title, year, stored_id = show.name_en or show.name, show.release_year, show.tmdb_id
    db.commit()  # hand the pooled connection back during the TMDB calls
    lookup = tv_lookup(db, guild_id, title, year, include_specials=has_specials, tmdb_id=stored_id)
    if lookup is None:
        raise LookupError(f"No TMDB match found for '{title}'")
    if stored_id is None and lookup.ambiguous:
        raise ValueError("Several TMDB shows match this title. Open the show's season import once to pick the right one.")

    show = _get_show(db, guild_id, show_id)
    _remember_show_id(db, show, lookup.tmdb_id, lookup.ambiguous)
    show = _get_show(db, guild_id, show_id)
    show.overview = show.overview or lookup.overview
    show.image_url = show.image_url or lookup.poster_url

    resolver = common.PeopleResolver(db, guild_id, user_id)
    seasons_added = episodes_added = runtimes_updated = 0
    by_number = {s.season_number: s for s in show.seasons if s.season_number is not None}
    by_name = {norm(s.name): s for s in show.seasons}
    for out in lookup.seasons:
        season = by_number.get(out.season_number) or by_name.get(norm(out.name))
        if season is None:
            season = _create_season(db, guild_id, user_id, show, TmdbTvImportSeasonIn(
                name=out.name, season_number=out.season_number, release_year=out.release_year,
                overview=out.overview, poster_url=out.poster_url,
            ))
            seasons_added += 1
        else:
            season.season_number = season.season_number if season.season_number is not None else out.season_number
            season.overview = season.overview or out.overview
            season.image_url = season.image_url or out.poster_url

        episodes = {e.episode_number: e for e in season.episodes if e.episode_number is not None}
        named = {norm(e.name): e for e in season.episodes}
        for e in out.episodes:
            existing = episodes.get(e.episode_number) or named.get(norm(e.name))
            if existing is not None:
                if e.runtime and existing.runtime_minutes != e.runtime:
                    existing.runtime_minutes = e.runtime
                    runtimes_updated += 1
                existing.episode_number = existing.episode_number or e.episode_number
                existing.overview = existing.overview or e.overview
                existing.image_url = existing.image_url or e.still_url
                continue
            _create_episode(db, guild_id, user_id, season, TmdbTvImportEpisodeIn(
                name=e.name, episode_number=e.episode_number, overview=e.overview, still_url=e.still_url,
                runtime_minutes=e.runtime, release_year=e.release_year,
                people=[_credit_in(p) for p in e.people], inherit_parent_people=True,
            ), resolver)
            episodes_added += 1
    db.flush()
    return TmdbTvSyncOut(
        seasons_added=seasons_added, episodes_added=episodes_added, runtimes_updated=runtimes_updated,
        **_people_results(resolver),
    )
