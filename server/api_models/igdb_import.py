from __future__ import annotations

from ..database_models.game_credit import GameRole
from .base import ORMSchema


class IgdbLookupIn(ORMSchema):
    title: str
    year: int | None = None


class DbPersonMatchOut(ORMSchema):
    person_id: int
    person_name: str
    has_game_entries: bool
    artist_summary: str


class IgdbPersonOut(ORMSchema):
    igdb_id: int
    name: str
    source: str  # "company" | "person" — which IGDB resource this credit came from
    suggested_role: GameRole
    suggestion_reason: str
    top_credits: list[str]
    nationality_guess: str
    birth_place: str | None = None
    db_matches: list[DbPersonMatchOut] = []


class IgdbGenreOut(ORMSchema):
    igdb_id: int
    igdb_name: str
    db_genre_id: int | None = None


class IgdbPlatformOut(ORMSchema):
    igdb_id: int
    igdb_name: str
    db_platform_id: int | None = None


class IgdbLookupOut(ORMSchema):
    igdb_id: int
    title: str
    release_date: str | None = None
    summary: str | None = None
    people: list[IgdbPersonOut]
    genres: list[IgdbGenreOut]
    platforms: list[IgdbPlatformOut]
    ambiguous: bool


class IgdbImportPersonIn(ORMSchema):
    igdb_id: int
    source: str = "company"  # namespaces igdb_id; IGDB company/person ids collide
    name: str
    role: GameRole
    nationality: str
    existing_person_id: int | None = None


class IgdbImportIn(ORMSchema):
    title: str
    release_year: int
    people: list[IgdbImportPersonIn] = []
    genre_ids: list[int] = []
    platform_ids: list[int] = []


class IgdbImportPersonResult(ORMSchema):
    person_id: int
    name: str
    nationality: str
    created: bool


class IgdbImportOut(ORMSchema):
    game_id: int
    created_people: list[IgdbImportPersonResult]
    reused_people: list[IgdbImportPersonResult]
