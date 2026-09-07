from __future__ import annotations

from typing import Literal

from ..database_models.movie_cast_member import CastRole
from .base import ORMSchema


class TmdbLookupIn(ORMSchema):
    title: str
    year: int | None = None


class DbPersonMatchOut(ORMSchema):
    person_id: int
    person_name: str
    #: Has movies *or* TV credits — i.e. something the TMDB filmography can
    #: corroborate. Identity is a person question, not a per-media one.
    has_screen_entries: bool
    #: True iff `has_screen_entries` and at least one of those credits' titles
    #: overlaps this TMDB filmography. False (with `has_screen_entries=True`)
    #: means this is a name-only match against a differing filmography — e.g.
    #: our catalog's title differs from TMDB's own (see `tmdb_common.norm`
    #: doesn't fix title *substitutions* like "Dune: Part One" vs. "Dune").
    filmography_overlap: bool
    artist_summary: str
    game_summary: str


class TmdbPersonOut(ORMSchema):
    tmdb_id: int
    name: str
    credit_type: Literal["cast", "crew"]
    character: str | None = None
    billing_order: int | None = None
    job: str | None = None
    suggested_role: CastRole
    suggestion_reason: str
    top_credits: list[str]
    nationality_guess: str
    birth_place: str | None = None
    db_matches: list[DbPersonMatchOut] = []


class TmdbGenreOut(ORMSchema):
    tmdb_id: int
    tmdb_name: str
    db_genre_id: int | None = None


class TmdbLookupOut(ORMSchema):
    tmdb_id: int
    title: str
    original_title: str | None = None
    release_date: str | None = None
    runtime: int
    overview: str | None = None
    people: list[TmdbPersonOut]
    genres: list[TmdbGenreOut]
    ambiguous: bool


class TmdbImportPersonIn(ORMSchema):
    tmdb_id: int
    name: str
    role: CastRole
    nationality: str
    existing_person_id: int | None = None


class TmdbImportIn(ORMSchema):
    title: str
    original_title: str | None = None
    runtime_minutes: int
    release_year: int
    people: list[TmdbImportPersonIn] = []
    genre_ids: list[int] = []


class TmdbImportPersonResult(ORMSchema):
    person_id: int
    name: str
    nationality: str
    created: bool


class TmdbImportOut(ORMSchema):
    movie_id: int
    created_people: list[TmdbImportPersonResult]
    reused_people: list[TmdbImportPersonResult]
