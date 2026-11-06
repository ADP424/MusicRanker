from __future__ import annotations

from ..database_models.game_credit import GameRole
from .base import ORMSchema


class IgdbLookupIn(ORMSchema):
    title: str = ""  # or "igdb:1234"
    year: int | None = None
    igdb_id: int | None = None  # skip the search: this exact game


class IgdbCandidateOut(ORMSchema):
    igdb_id: int
    title: str
    year: int | None = None
    cover_url: str | None = None


class DbPersonMatchOut(ORMSchema):
    person_id: int
    person_name: str
    has_game_entries: bool
    #: True iff `has_game_entries` and at least one of those credits' titles
    #: overlaps this IGDB game. False (with `has_game_entries=True`) means this
    #: is a name-only match against a differing catalog of games.
    filmography_overlap: bool
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
    cover_url: str | None = None
    # A game already in the catalog with this IGDB id (or the same title and year).
    existing_game_id: int | None = None
    # The other search results, best first (empty when looked up by id).
    candidates: list[IgdbCandidateOut] = []
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
    igdb_id: int | None = None
    title: str
    release_year: int
    summary: str | None = None
    cover_url: str | None = None
    people: list[IgdbImportPersonIn] = []
    genre_ids: list[int] = []
    platform_ids: list[int] = []
    #: Also put the game at the bottom of the importing user's list.
    add_to_list: bool = False


class IgdbImportPersonResult(ORMSchema):
    person_id: int
    name: str
    nationality: str
    created: bool


class IgdbCreditsIn(ORMSchema):
    """Credits (and genres, platforms, any blank metadata) for a game already in the catalog."""

    igdb_id: int | None = None
    summary: str | None = None
    cover_url: str | None = None
    people: list[IgdbImportPersonIn] = []
    genre_ids: list[int] = []
    platform_ids: list[int] = []


class IgdbCreditsOut(ORMSchema):
    people_linked: int
    created_people: list[IgdbImportPersonResult]
    reused_people: list[IgdbImportPersonResult]


class IgdbImportOut(ORMSchema):
    game_id: int
    created_people: list[IgdbImportPersonResult]
    reused_people: list[IgdbImportPersonResult]
