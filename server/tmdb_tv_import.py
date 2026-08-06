"""TMDB television lookup + import.

Shares every media-agnostic primitive with the movie importer via `tmdb_common`.
What's television-shaped is the credit graph, and it is deliberately *not* one
flat aggregate:

  show step    /tv/{id}                      -> created_by, genres, seasons
               /tv/{id}/aggregate_credits    -> the show's CAST, plus crew
  episode step /tv/{id}/season/{n}           -> that season's episode list
               /tv/{id}/season/{n}/episode/{e}/credits
                                             -> that episode's FULL cast+crew

Show level shows the show's cast. Crew, though, comes out of an *aggregate* —
every director of every episode is in there — so crew is filtered to people
credited on at least `crew_episode_threshold` of the episodes (default 50%,
user-adjustable before searching). Creators and composers are exempt and are
always offered at show level.

Shows have no `director` role (see `CastRole`): a show is authored. `created_by`
and any `Creator` crew job map to `creator`; a director who passes the threshold
is a show-level fixture and is offered as `creator` too, with a reason saying
so. Episodes keep `director`.

Episode level shows exactly that episode's cast and crew — nothing aggregated,
nothing from its siblings.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import tmdb_common as common
from .api_models.tmdb_tv_import import (
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
    TmdbTvImportPersonResult,
    TmdbTvLookupOut,
    TmdbTvPersonOut,
    TmdbTvSeasonOut,
)
from .database_models import (
    ACTING_ROLES,
    TELEVISION_EPISODE_ROLES,
    TELEVISION_SHOW_ROLES,
    CastRole,
    TelevisionEpisode,
    TelevisionEpisodePerson,
    TelevisionShow,
    TelevisionShowPerson,
)
from .tmdb_client import WORKERS, TmdbClient

MEDIA_FLAG = "is_television"
DEFAULT_CREW_EPISODE_THRESHOLD = 0.5

# TMDB job strings (lowercased) by the role they imply.
CREATOR_JOBS = {"creator", "series creator", "created by"}
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


def _year_of(date: str | None, fallback: int) -> int:
    if date and len(date) >= 4 and date[:4].isdigit():
        return int(date[:4])
    return fallback


def _show_credits(details: dict, agg: dict, *, threshold: float) -> list[_Credit]:
    """Show-level credits only.

    TMDB's show credits are an aggregate over every episode, so a one-episode
    guest star and a one-episode director are both in here. Anyone credited on
    less than `threshold` of the episodes belongs to the episodes they're
    actually in, not to the show — they're offered by the per-episode import.
    Creators and composers are exempt and are always show-level.
    """
    total = details.get("number_of_episodes") or 0
    out: list[_Credit] = []

    def _share(eps: int | None) -> float | None:
        return (eps / total) if (eps and total) else None

    for creator in details.get("created_by") or []:
        out.append(
            _Credit(
                tmdb_id=creator.get("id"),
                name=creator.get("name") or "",
                credit_type="crew",
                role=CastRole.creator,
                reason="TMDB lists them as a creator of the series",
                job="Creator",
            )
        )

    for m in agg.get("crew") or []:
        # aggregate_credits groups one person's jobs; plain credits has one.
        entries = m.get("jobs") or [{"job": m.get("job"), "episode_count": m.get("episode_count")}]
        for entry in entries:
            job = (entry.get("job") or "").strip()
            jl = job.lower()
            eps = entry.get("episode_count") or m.get("total_episode_count") or 0
            share = _share(eps)

            if jl in CREATOR_JOBS:
                out.append(
                    _Credit(
                        m.get("id"), m.get("name") or "", "crew", CastRole.creator,
                        f"credited as {job}", job=job, episode_count=eps,
                    )
                )
            elif jl in COMPOSER_JOBS:
                reason = f"credited as {job}" + (f" on {eps}/{total} episodes" if eps and total else "")
                out.append(
                    _Credit(
                        m.get("id"), m.get("name") or "", "crew", CastRole.composer,
                        reason, job=job, episode_count=eps,
                    )
                )
            elif jl in DIRECTOR_JOBS:
                # Every episode's director is in this aggregate. Only someone who
                # directed most of the run belongs at show level — and a show has
                # no director role, so they surface as a Creator credit.
                if share is None or share < threshold:
                    continue
                out.append(
                    _Credit(
                        m.get("id"), m.get("name") or "", "crew", CastRole.creator,
                        f"directed {eps}/{total} episodes (>={threshold:.0%}); shows have no "
                        f"director role, so this is offered as a show-level Creator credit",
                        job=job, episode_count=eps,
                    )
                )
            # any other job: not a role this app tracks

    for m in agg.get("cast") or []:
        roles = m.get("roles") or []
        character = next((r.get("character") for r in roles if r.get("character")), m.get("character")) or ""
        eps = max((r.get("episode_count") or 0 for r in roles), default=0) or m.get("total_episode_count") or 0
        share = _share(eps)
        if share is not None and share < threshold:
            continue  # recurring or guest: the per-episode import's job
        role, reason = common.suggest_cast_role(
            order=m.get("order"),
            popularity=m.get("popularity") or 0,
            character=character,
            episode_count=eps,
            total_episodes=total,
        )
        out.append(
            _Credit(
                m.get("id"), m.get("name") or "", "cast", role, reason,
                character=character or None, billing_order=m.get("order"), episode_count=eps,
            )
        )

    return _dedupe(out)


def _episode_credits(credits: dict) -> list[_Credit]:
    """Episode-level: exactly this episode's cast, guest stars and crew."""
    out: list[_Credit] = []

    for m in credits.get("crew") or []:
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
    """The credits the show-level import attaches to an episode automatically:
    its director(s) and composer(s), which the season payload already embeds.
    Everything else about an episode is the per-episode import's business."""
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


# ── Lookup ───────────────────────────────────────────────────────────
def _fetch_season(c: TmdbClient, tmdb_id: int, n: int) -> Optional[dict]:
    try:
        return c.get(f"/tv/{tmdb_id}/season/{n}")
    except Exception:
        return None


def _fetch_episode_credits(c: TmdbClient, tmdb_id: int, n: int, e: int) -> Optional[dict]:
    try:
        return c.get(f"/tv/{tmdb_id}/season/{n}/episode/{e}/credits")
    except Exception:
        return None


def tv_lookup(
    db: Session,
    title: str,
    year: int | None = None,
    *,
    include_episodes: bool = True,
    include_specials: bool = False,
    season_numbers: list[int] | None = None,
    crew_episode_threshold: float = DEFAULT_CREW_EPISODE_THRESHOLD,
) -> Optional[TmdbTvLookupOut]:
    c = common.client()

    best, ambiguous = common.search_best(
        c, "/search/tv", title, year=year, year_param="first_air_date_year",
        title_keys=("name", "original_name"),
    )
    if best is None:
        return None

    tmdb_id = best["id"]
    details = c.get(f"/tv/{tmdb_id}")
    agg = c.get(f"/tv/{tmdb_id}/aggregate_credits")
    if details is None or agg is None:
        return None

    show_year = _year_of(details.get("first_air_date"), 0)
    runtimes = details.get("episode_run_time") or []
    default_runtime = int(runtimes[0]) if runtimes else 0

    show_raw = _show_credits(details, agg, threshold=crew_episode_threshold)

    # ── Episodes: one call per season. The season payload carries each
    #    episode's title/air date/runtime and its crew — which is all the show
    #    step needs, since cast is reviewed per episode.
    episode_rows: list[tuple[dict, dict, list[_Credit]]] = []  # (season, episode, auto crew)
    seasons_meta: list[dict] = []
    if include_episodes:
        wanted = []
        for season in details.get("seasons") or []:
            n = season.get("season_number")
            if n is None or (n == 0 and not include_specials):
                continue
            if season_numbers is not None and n not in season_numbers:
                continue
            wanted.append(season)

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            season_data = {
                s["season_number"]: f.result()
                for s, f in [(s, ex.submit(_fetch_season, c, tmdb_id, s["season_number"])) for s in wanted]
            }

        for season in wanted:
            data = season_data.get(season["season_number"])
            if not data:
                continue
            seasons_meta.append(season)
            for e in data.get("episodes") or []:
                episode_rows.append((season, e, _episode_auto_crew(e)))

    # ── One batched DB query + all person calls in parallel ───────────
    every: list[_Credit] = list(show_raw) + [cr for _, _, raw in episode_rows for cr in raw]
    persons_by_name = common.batch_load_persons(db, {cr.name for cr in every})
    person_data = common.fetch_person_data_bulk(c, [cr.tmdb_id for cr in every])

    enrichment_cache: dict[tuple[int, str], common.PersonEnrichment] = {}

    def _out(cr: _Credit) -> TmdbTvPersonOut:
        ck = (cr.tmdb_id, cr.name)
        if ck not in enrichment_cache:
            data = person_data.get(cr.tmdb_id) or common.PersonTmdbData(cr.tmdb_id)
            enrichment_cache[ck] = common.build_enrichment(data, cr.name, persons_by_name)
        e = enrichment_cache[ck]
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
                    artist_summary=m.artist_summary,
                    game_summary=m.game_summary,
                )
                for m in e.db_matches
            ],
        )

    by_season: dict[int, list[TmdbTvEpisodeOut]] = {}
    for season, e, raw in episode_rows:
        n = e.get("season_number") or season["season_number"]
        by_season.setdefault(n, []).append(
            TmdbTvEpisodeOut(
                tmdb_id=e.get("id"),
                season_number=n,
                episode_number=e.get("episode_number") or 0,
                name=e.get("name") or f"Episode {e.get('episode_number')}",
                air_date=e.get("air_date"),
                release_year=_year_of(e.get("air_date"), show_year),
                runtime=int(e.get("runtime") or default_runtime or 0),
                overview=e.get("overview") or None,
                people=[_out(cr) for cr in raw],
            )
        )
    for eps in by_season.values():
        eps.sort(key=lambda x: x.episode_number)

    seasons_out = [
        TmdbTvSeasonOut(
            season_number=s["season_number"],
            name=s.get("name") or f"Season {s['season_number']}",
            air_date=s.get("air_date"),
            episode_count=s.get("episode_count") or len(by_season.get(s["season_number"], [])),
            episodes=by_season.get(s["season_number"], []),
        )
        for s in sorted(seasons_meta, key=lambda s: s["season_number"])
    ]

    db_genres = common.db_genres_for(db, MEDIA_FLAG)
    return TmdbTvLookupOut(
        tmdb_id=tmdb_id,
        name=details.get("name") or title,
        original_name=details.get("original_name"),
        first_air_date=details.get("first_air_date"),
        release_year=show_year,
        overview=details.get("overview") or None,
        episode_run_time=default_runtime,
        number_of_seasons=details.get("number_of_seasons") or len(seasons_out),
        number_of_episodes=details.get("number_of_episodes") or sum(len(s.episodes) for s in seasons_out),
        crew_episode_threshold=crew_episode_threshold,
        people=[_out(cr) for cr in show_raw],
        genres=[
            TmdbTvGenreOut(tmdb_id=tg["id"], tmdb_name=tg["name"], db_genre_id=common.match_genre(tg["name"], db_genres))
            for tg in details.get("genres", [])
        ],
        seasons=seasons_out,
        ambiguous=ambiguous,
    )


def _locate_episode(
    c: TmdbClient,
    tmdb_show_id: int,
    details: dict,
    *,
    season_number: int | None,
    episode_number: int | None,
    episode_name: str | None,
) -> Optional[tuple[int, int]]:
    """Our episodes store a rank within their show, not season/episode numbers,
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
        data = _fetch_season(c, tmdb_show_id, s["season_number"])
        for e in (data or {}).get("episodes") or []:
            if common.norm(e.get("name") or "") == needle:
                return e.get("season_number") or s["season_number"], e.get("episode_number") or 0
    return None


def tv_episode_lookup(db: Session, body: TmdbTvEpisodeLookupIn) -> Optional[TmdbTvEpisodeLookupOut]:
    """One episode's full cast, guest stars and crew."""
    c = common.client()

    tmdb_show_id = body.tmdb_show_id
    ambiguous = False
    if tmdb_show_id is None:
        if not body.title:
            raise ValueError("Either tmdb_show_id or title is required")
        best, ambiguous = common.search_best(
            c, "/search/tv", body.title, year=body.year, year_param="first_air_date_year",
            title_keys=("name", "original_name"),
        )
        if best is None:
            return None
        tmdb_show_id = best["id"]

    details = c.get(f"/tv/{tmdb_show_id}")
    if details is None:
        return None

    located = _locate_episode(
        c, tmdb_show_id, details,
        season_number=body.season_number,
        episode_number=body.episode_number,
        episode_name=body.episode_name,
    )
    if located is None:
        return None
    season_number, episode_number = located

    show_year = _year_of(details.get("first_air_date"), 0)
    runtimes = details.get("episode_run_time") or []
    default_runtime = int(runtimes[0]) if runtimes else 0

    base = f"/tv/{tmdb_show_id}/season/{season_number}/episode/{episode_number}"
    episode = c.get(base)
    if episode is None:
        return None
    raw = _episode_credits(c.get(f"{base}/credits") or {})

    persons_by_name = common.batch_load_persons(db, {cr.name for cr in raw})
    person_data = common.fetch_person_data_bulk(c, [cr.tmdb_id for cr in raw])

    people: list[TmdbTvPersonOut] = []
    for cr in raw:
        data = person_data.get(cr.tmdb_id) or common.PersonTmdbData(cr.tmdb_id)
        e = common.build_enrichment(data, cr.name, persons_by_name)
        people.append(
            TmdbTvPersonOut(
                tmdb_id=cr.tmdb_id,
                name=cr.name,
                credit_type=cr.credit_type,  # type: ignore[arg-type]
                character=cr.character,
                billing_order=cr.billing_order,
                job=cr.job,
                episode_count=None,
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
                        artist_summary=m.artist_summary,
                        game_summary=m.game_summary,
                    )
                    for m in e.db_matches
                ],
            )
        )

    return TmdbTvEpisodeLookupOut(
        tmdb_show_id=tmdb_show_id,
        show_name=details.get("name") or (body.title or ""),
        show_ambiguous=ambiguous,
        episode=TmdbTvEpisodeOut(
            tmdb_id=episode.get("id"),
            season_number=episode.get("season_number") or season_number,
            episode_number=episode.get("episode_number") or episode_number,
            name=episode.get("name") or f"Episode {episode_number}",
            air_date=episode.get("air_date"),
            release_year=_year_of(episode.get("air_date"), show_year),
            runtime=int(episode.get("runtime") or default_runtime or 0),
            overview=episode.get("overview") or None,
            people=people,
        ),
    )


# ── Import ───────────────────────────────────────────────────────────
def _link_episode_people(
    db: Session,
    show: TelevisionShow,
    episode: TelevisionEpisode,
    body: TmdbTvImportEpisodeIn,
    resolver: common.PeopleResolver,
) -> int:
    """Merge the selected credits into `episode`, idempotently. -> links added."""
    existing: set[tuple[int, CastRole]] = {(l.person_id, l.role) for l in episode.person_links}
    acting: dict[int, CastRole] = {l.person_id: l.role for l in episode.person_links if l.role in ACTING_ROLES}
    added = 0

    def _add(person_id: int, role: CastRole) -> None:
        nonlocal added
        if role not in TELEVISION_EPISODE_ROLES:
            return  # a show's creator credit doesn't descend to its episodes
        if role in ACTING_ROLES and person_id in acting:
            return  # already cast here; don't double-bill under a second role
        if (person_id, role) in existing:
            return
        if role in ACTING_ROLES:
            acting[person_id] = role
        existing.add((person_id, role))
        db.add(TelevisionEpisodePerson(episode_id=episode.id, person_id=person_id, role=role))
        added += 1

    if body.inherit_show_people:
        for link in show.person_links:
            _add(link.person_id, link.role)
    for p in body.people:
        if p.role is CastRole.creator:
            raise ValueError("The creator role only applies to shows, not episodes")
        _add(
            resolver.resolve(
                tmdb_id=p.tmdb_id,
                name=p.name,
                nationality=p.nationality,
                existing_person_id=p.existing_person_id,
            ).id,
            p.role,
        )

    db.flush()
    return added


def _episode_genres(db: Session, show: TelevisionShow, genre_ids: list[int] | None) -> list:
    if genre_ids is None:
        return list(show.genres)
    wanted = set(genre_ids)
    return [g for g in common.db_genres_for(db, MEDIA_FLAG) if g.id in wanted]


def _create_episode(
    db: Session,
    show: TelevisionShow,
    body: TmdbTvImportEpisodeIn,
    resolver: common.PeopleResolver,
) -> tuple[TelevisionEpisode, int]:
    episode = TelevisionEpisode(
        show_id=show.id,
        name=body.name or show.name,
        name_en=body.name_en,
        runtime_minutes=body.runtime_minutes,
        release_year=body.release_year,
        watches=body.watches,
        watch_link=body.watch_link,
        notes=body.notes,
        episode_rank=common.append_rank(
            db,
            TelevisionEpisode.episode_rank,
            id_col=TelevisionEpisode.id,
            scope=TelevisionEpisode.show_id == show.id,
        ),
    )
    episode.genres = _episode_genres(db, show, body.genre_ids)
    db.add(episode)
    db.flush()
    return episode, _link_episode_people(db, show, episode, body, resolver)


def tmdb_import_show(db: Session, body: TmdbTvImportIn) -> TmdbTvImportOut:
    existing = db.scalar(
        select(TelevisionShow).where(
            (TelevisionShow.name == body.name) | (TelevisionShow.name_en == body.name),
            TelevisionShow.release_year == body.release_year,
        )
    )
    if existing is not None:
        raise ValueError(
            f"Television show '{body.name}' ({body.release_year}) already exists (id={existing.id})"
        )

    show = TelevisionShow(
        name=body.name,
        name_en=body.name_en,
        release_year=body.release_year,
        watch_link=body.watch_link,
        notes=body.notes,
        global_rank=common.append_rank(db, TelevisionShow.global_rank, id_col=TelevisionShow.id),
    )
    show.genres = [g for g in common.db_genres_for(db, MEDIA_FLAG) if g.id in set(body.genre_ids)]
    db.add(show)
    db.flush()

    resolver = common.PeopleResolver(db)
    linked: set[tuple[int, CastRole]] = set()
    for p in body.people:
        if p.role not in TELEVISION_SHOW_ROLES:
            raise ValueError("Shows are credited with the creator role, not director")
        person = resolver.resolve(
            tmdb_id=p.tmdb_id,
            name=p.name,
            nationality=p.nationality,
            existing_person_id=p.existing_person_id,
        )
        key = (person.id, p.role)
        if key not in linked:
            linked.add(key)
            db.add(TelevisionShowPerson(show_id=show.id, person_id=person.id, role=p.role))
    db.flush()

    episode_ids = [_create_episode(db, show, ep, resolver)[0].id for ep in body.episodes]

    return TmdbTvImportOut(
        show_id=show.id,
        episode_ids=episode_ids,
        created_people=[TmdbTvImportPersonResult(**vars(r)) for r in resolver.created],
        reused_people=[TmdbTvImportPersonResult(**vars(r)) for r in resolver.reused],
    )


def tmdb_import_episode(db: Session, body: TmdbTvEpisodeImportIn) -> TmdbTvEpisodeImportOut:
    show = db.get(TelevisionShow, body.show_id)
    if show is None:
        raise ValueError(f"Television show {body.show_id} not found")

    resolver = common.PeopleResolver(db)

    if body.episode_id is None:
        episode, added = _create_episode(db, show, body.episode, resolver)
        created = True
    else:
        episode = db.get(TelevisionEpisode, body.episode_id)
        if episode is None:
            raise ValueError(f"Television episode {body.episode_id} not found")
        if episode.show_id != show.id:
            raise ValueError("That episode belongs to a different show")
        if body.update_episode_fields:
            # Opt-in: the user may have edited these since the show import.
            episode.name = body.episode.name or episode.name
            episode.runtime_minutes = body.episode.runtime_minutes
            episode.release_year = body.episode.release_year
            if body.episode.genre_ids is not None:
                episode.genres = _episode_genres(db, show, body.episode.genre_ids)
            db.flush()
        added = _link_episode_people(db, show, episode, body.episode, resolver)
        created = False

    return TmdbTvEpisodeImportOut(
        show_id=show.id,
        episode_id=episode.id,
        created=created,
        people_linked=added,
        created_people=[TmdbTvImportPersonResult(**vars(r)) for r in resolver.created],
        reused_people=[TmdbTvImportPersonResult(**vars(r)) for r in resolver.reused],
    )
