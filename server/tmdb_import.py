"""TMDB movie lookup + import service.

The media-agnostic half of this (search-and-pick, the cast-role heuristic, the
nationality table, filmography matching, person resolution) lives in
`tmdb_common` and is shared with `tmdb_tv_import` and `tmdb_scan`. What remains
here is movie-shaped: which crew jobs a film credits, and the DB writes.
"""

from __future__ import annotations

from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import tmdb_common as common
from .api_models.tmdb_import import (
    DbPersonMatchOut,
    TmdbCreditsIn,
    TmdbCreditsOut,
    TmdbGenreOut,
    TmdbImportIn,
    TmdbImportOut,
    TmdbImportPersonResult,
    TmdbLookupOut,
    TmdbPersonOut,
)
from .normalize import norm as db_norm
from .database_models import CastRole, Genre, Movie, MoviePerson, UserMovieRank
from .ranking import next_rank
from .tmdb_client import TmdbClient

MEDIA_FLAG = "is_movie"

#: The only crew jobs a film-level import cares about.
CREW_JOBS = common.CREW_JOB_ROLES  # {"Director": director, "Original Music Composer": composer}


def _person_out(
    member: dict,
    credit_type: Literal["cast", "crew"],
    suggested_role: CastRole,
    enrichment: common.PersonEnrichment,
    *,
    character: str | None = None,
    billing_order: int | None = None,
    job: str | None = None,
    suggestion_reason: str = "",
) -> TmdbPersonOut:
    return TmdbPersonOut(
        tmdb_id=member["id"],
        name=member["name"],
        credit_type=credit_type,
        character=character,
        billing_order=billing_order,
        job=job,
        suggested_role=suggested_role,
        suggestion_reason=suggestion_reason,
        top_credits=enrichment.top_credits,
        nationality_guess=enrichment.nationality_guess,
        birth_place=enrichment.birth_place,
        db_matches=[
            DbPersonMatchOut(
                person_id=m.person_id,
                person_name=m.person_name,
                has_screen_entries=m.has_screen_entries,
                filmography_overlap=m.filmography_overlap,
                artist_summary=m.artist_summary,
                game_summary=m.game_summary,
            )
            for m in enrichment.db_matches
        ],
    )


# ── Public: lookup ───────────────────────────────────────────────────
def _existing_movie(db: Session, guild_id: int, result: dict) -> int | None:
    """The catalog's copy of a TMDB result, if any: by TMDB id, else by title
    (English or original) and year."""
    found = db.scalar(select(Movie.id).where(Movie.guild_id == guild_id, Movie.tmdb_id == result["id"]))
    if found is not None:
        return found
    titles = {db_norm(t) for t in (result.get("title"), result.get("original_title")) if t} - {""}
    year = (result.get("release_date") or "")[:4]
    if not titles or not year.isdigit():
        return None
    return db.scalar(select(Movie.id).where(
        Movie.guild_id == guild_id, Movie.release_year == int(year),
        Movie.name_norm.in_(titles) | Movie.name_en_norm.in_(titles),
    ).limit(1))


def tmdb_lookup(db: Session, guild_id: int, title: str, year: int | None, tmdb_id: int | None = None) -> TmdbLookupOut | None:
    client: TmdbClient = common.client()

    tmdb_id = tmdb_id or common.parse_tmdb_ref(title, "movie")
    candidates: list[dict] = []
    ambiguous = False
    if tmdb_id is None:
        best, ambiguous = common.search_best(
            client,
            "/search/movie",
            title,
            year=year,
            year_param="primary_release_year",
            title_keys=("title",),
        )
        if best is None:
            return None
        tmdb_id = best["id"]
        candidates = common.search_candidates(
            client, "/search/movie", title, year=year, year_param="primary_release_year",
            title_key="title", date_key="release_date",
        )

    details = client.get(f"/movie/{tmdb_id}")
    credits_data = client.get(f"/movie/{tmdb_id}/credits")
    if details is None or credits_data is None:
        return None
    best = details  # the movie itself: same title / date / overview / poster keys as a search result

    # ── Which credits we keep ────────────────────────────────────────
    crew: list[tuple[dict, str]] = []
    seen_crew: set[tuple[int, str]] = set()
    for m in credits_data.get("crew", []):
        job = m.get("job")
        if job not in CREW_JOBS or not m.get("id"):
            continue
        if (m["id"], job) in seen_crew:
            continue
        seen_crew.add((m["id"], job))
        crew.append((m, job))
    cast = [m for m in credits_data.get("cast", []) if m.get("id")]

    # ── One batched DB query, then all TMDB person calls in parallel ──
    all_names = {m["name"] for m, _ in crew} | {m["name"] for m in cast}
    persons_by_name = common.batch_load_persons(db, guild_id, all_names)
    db.commit()  # loaded eagerly; release the connection before the next network calls
    person_data = common.fetch_person_data_bulk(client, [m["id"] for m, _ in crew] + [m["id"] for m in cast])

    def enrich(member: dict) -> common.PersonEnrichment:
        data = person_data.get(member["id"]) or common.PersonTmdbData(member["id"])
        return common.build_enrichment(data, member["name"], persons_by_name)

    people: list[TmdbPersonOut] = []
    for m, job in crew:
        people.append(_person_out(m, "crew", CREW_JOBS[job], enrich(m), job=job, suggestion_reason=job))
    for m in cast:
        role, reason = common.suggest_cast_role(
            order=m.get("order", 99),
            popularity=m.get("popularity", 0),
            character=m.get("character") or "",
        )
        people.append(
            _person_out(
                m,
                "cast",
                role,
                enrich(m),
                character=m.get("character"),
                billing_order=m.get("order"),
                suggestion_reason=reason,
            )
        )

    db_genres = common.db_genres_for(db, guild_id, MEDIA_FLAG)
    genres = [
        TmdbGenreOut(
            tmdb_id=tg["id"],
            tmdb_name=tg["name"],
            db_genre_id=common.match_genre(tg["name"], db_genres),
        )
        for tg in details.get("genres", [])
    ]

    return TmdbLookupOut(
        tmdb_id=best["id"],
        title=best.get("title", title),
        original_title=best.get("original_title"),
        release_date=best.get("release_date"),
        runtime=details.get("runtime") or 0,
        overview=best.get("overview"),
        poster_url=common.image_url(best.get("poster_path") or details.get("poster_path")),
        existing_movie_id=_existing_movie(db, guild_id, best),
        candidates=[c for c in candidates if c["tmdb_id"] != tmdb_id],
        people=people,
        genres=genres,
        ambiguous=ambiguous,
    )


# ── Public: import ───────────────────────────────────────────────────
def _link_people(db: Session, guild_id: int, movie: Movie, people: list, resolver: common.PeopleResolver) -> int:
    """Credit `people` on `movie`, skipping any it already has. -> credits added."""
    linked = set(db.execute(
        select(MoviePerson.person_id, MoviePerson.role).where(MoviePerson.movie_id == movie.id)
    ).tuples().all())
    added = 0
    for p in people:
        if p.role is CastRole.creator:
            raise ValueError("The creator role only applies to television shows")
        person = resolver.resolve(
            tmdb_id=p.tmdb_id,
            name=p.name,
            nationality=p.nationality,
            existing_person_id=p.existing_person_id,
        )
        key = (person.id, p.role)
        if key not in linked:
            linked.add(key)
            added += 1
            db.add(MoviePerson(movie_id=movie.id, person_id=person.id, role=p.role, guild_id=guild_id))
    return added


def tmdb_import_movie(db: Session, guild_id: int, user_id: int, body: TmdbImportIn) -> TmdbImportOut:
    titles = {db_norm(t) for t in (body.title, body.original_title) if t} - {""}
    existing = db.scalar(
        select(Movie).where(
            Movie.guild_id == guild_id,
            Movie.name_norm.in_(titles) | Movie.name_en_norm.in_(titles),
            Movie.release_year == body.release_year,
        )
    )
    if existing is None and body.tmdb_id is not None:
        existing = db.scalar(select(Movie).where(Movie.guild_id == guild_id, Movie.tmdb_id == body.tmdb_id))
    if existing:
        raise ValueError(f"Movie '{body.title}' ({body.release_year}) already exists (id={existing.id})")

    # Same convention as people: `name` is the original, `name_en` the English
    # title when it differs. (This used to store the English title in both.)
    foreign = bool(body.original_title) and db_norm(body.original_title) != db_norm(body.title)
    movie = Movie(
        guild_id=guild_id, created_by_user_id=user_id,
        name=body.original_title if foreign else body.title,
        name_en=body.title if foreign else None,
        runtime_minutes=body.runtime_minutes,
        release_year=body.release_year,
        tmdb_id=body.tmdb_id,
        overview=body.overview,
        image_url=body.poster_url,
    )
    db.add(movie)
    db.flush()

    resolver = common.PeopleResolver(db, guild_id, user_id)
    _link_people(db, guild_id, movie, body.people, resolver)

    if body.genre_ids:
        movie.genres = list(db.scalars(
            select(Genre).where(Genre.guild_id == guild_id, Genre.id.in_(body.genre_ids), Genre.is_movie.is_(True))
        ).all())

    if body.add_to_list:
        db.add(UserMovieRank(user_id=user_id, guild_id=guild_id, movie_id=movie.id,
                             rank=next_rank(db, UserMovieRank, user_id=user_id, guild_id=guild_id)))
    db.flush()
    return TmdbImportOut(
        movie_id=movie.id,
        created_people=[TmdbImportPersonResult(**vars(r)) for r in resolver.created],
        reused_people=[TmdbImportPersonResult(**vars(r)) for r in resolver.reused],
    )


def tmdb_merge_credits(db: Session, guild_id: int, user_id: int, movie_id: int, body: TmdbCreditsIn) -> TmdbCreditsOut:
    """Add TMDB's credits to a movie already in the catalog. Nothing existing is
    removed or overwritten: only missing credits and genres and blank metadata."""
    movie = db.get(Movie, movie_id)
    if movie is None or movie.guild_id != guild_id:
        raise LookupError(f"Movie {movie_id} not found")
    if movie.tmdb_id is None and body.tmdb_id is not None and not db.scalar(
        select(Movie.id).where(Movie.guild_id == guild_id, Movie.tmdb_id == body.tmdb_id)
    ):
        movie.tmdb_id = body.tmdb_id
    movie.overview = movie.overview or body.overview
    movie.image_url = movie.image_url or body.poster_url

    resolver = common.PeopleResolver(db, guild_id, user_id)
    added = _link_people(db, guild_id, movie, body.people, resolver)
    have = {g.id for g in movie.genres}
    new = set(body.genre_ids) - have
    if new:
        movie.genres = list(movie.genres) + list(db.scalars(
            select(Genre).where(Genre.guild_id == guild_id, Genre.id.in_(new), Genre.is_movie.is_(True))
        ).all())
    db.flush()
    return TmdbCreditsOut(
        people_linked=added,
        created_people=[TmdbImportPersonResult(**vars(r)) for r in resolver.created],
        reused_people=[TmdbImportPersonResult(**vars(r)) for r in resolver.reused],
    )
