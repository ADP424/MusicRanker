"""TMDB movie lookup + import service.

The media-agnostic half of this (search-and-pick, the cast-role heuristic, the
nationality table, filmography matching, person resolution) lives in
`tmdb_common` and is shared with `tmdb_tv_import` and `tmdb_scan`. What remains
here is movie-shaped: which crew jobs a film credits, and the DB writes.
"""

from __future__ import annotations

from typing import Literal

from sqlalchemy.orm import Session

from . import tmdb_common as common
from .api_models.tmdb_import import (
    DbPersonMatchOut,
    TmdbGenreOut,
    TmdbImportIn,
    TmdbImportOut,
    TmdbImportPersonResult,
    TmdbLookupOut,
    TmdbPersonOut,
)
from .database_models import CastRole, Genre, Movie, MoviePerson, Person
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
                artist_summary=m.artist_summary,
                game_summary=m.game_summary,
            )
            for m in enrichment.db_matches
        ],
    )


# ── Public: lookup ───────────────────────────────────────────────────
def tmdb_lookup(db: Session, title: str, year: int | None) -> TmdbLookupOut | None:
    client: TmdbClient = common.client()

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

    details = client.get(f"/movie/{best['id']}")
    credits_data = client.get(f"/movie/{best['id']}/credits")
    if details is None or credits_data is None:
        return None

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
    persons_by_name = common.batch_load_persons(db, all_names)
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

    db_genres = common.db_genres_for(db, MEDIA_FLAG)
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
        people=people,
        genres=genres,
        ambiguous=ambiguous,
    )


# ── Public: import ───────────────────────────────────────────────────
def tmdb_import_movie(db: Session, body: TmdbImportIn) -> TmdbImportOut:
    existing = (
        db.query(Movie)
        .filter(
            (Movie.name == body.title) | (Movie.name_en == body.title),
            Movie.release_year == body.release_year,
        )
        .first()
    )
    if existing:
        raise ValueError(f"Movie '{body.title}' ({body.release_year}) already exists (id={existing.id})")

    name_en = body.title if body.original_title and body.original_title != body.title else None
    movie = Movie(
        name=body.title,
        name_en=name_en,
        runtime_minutes=body.runtime_minutes,
        release_year=body.release_year,
        global_rank=common.append_rank(db, Movie.global_rank, id_col=Movie.id),
    )
    db.add(movie)
    db.flush()

    resolver = common.PeopleResolver(db)
    linked: set[tuple[int, CastRole]] = set()
    for p in body.people:
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
            db.add(MoviePerson(movie_id=movie.id, person_id=person.id, role=p.role))

    if body.genre_ids:
        movie.genres = db.query(Genre).filter(Genre.id.in_(body.genre_ids), Genre.is_movie.is_(True)).all()

    db.flush()
    return TmdbImportOut(
        movie_id=movie.id,
        created_people=[TmdbImportPersonResult(**vars(r)) for r in resolver.created],
        reused_people=[TmdbImportPersonResult(**vars(r)) for r in resolver.reused],
    )
