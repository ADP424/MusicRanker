from __future__ import annotations

from typing import Literal

from pydantic import Field

from ..database_models.movie_cast_member import CastRole
from .base import ORMSchema


class TmdbTvLookupIn(ORMSchema):
    title: str
    year: int | None = None
    include_episodes: bool = True
    include_specials: bool = False
    season_numbers: list[int] | None = None


class TmdbTvDbPersonMatchOut(ORMSchema):
    person_id: int
    person_name: str
    has_screen_entries: bool
    #: True iff `has_screen_entries` and at least one of those credits overlaps
    #: this TMDB filmography. False (with `has_screen_entries=True`) means this
    #: is a name-only match against a differing filmography.
    filmography_overlap: bool
    artist_summary: str
    game_summary: str


class TmdbTvPersonOut(ORMSchema):
    tmdb_id: int
    name: str
    credit_type: Literal["cast", "crew", "guest"]
    character: str | None = None
    billing_order: int | None = None
    job: str | None = None
    episode_count: int | None = None
    suggested_role: CastRole
    suggestion_reason: str
    top_credits: list[str]
    nationality_guess: str
    birth_place: str | None = None
    db_matches: list[TmdbTvDbPersonMatchOut] = []
    #: Season/episode lookups only: the roles this person (matched by name to
    #: `parent_person_id`) already holds on the parent — the show for a season,
    #: the season for an episode. Empty when they aren't on the parent.
    parent_roles: list[CastRole] = []
    parent_person_id: int | None = None


class TmdbTvGenreOut(ORMSchema):
    tmdb_id: int
    tmdb_name: str
    db_genre_id: int | None = None


class TmdbTvEpisodeOut(ORMSchema):
    tmdb_id: int | None = None
    season_number: int
    episode_number: int
    name: str
    air_date: str | None = None
    release_year: int
    runtime: int
    overview: str | None = None
    #: At the show and season steps this holds only the episode's director(s)
    #: and composer(s) — the credits that are always automatic. The full cast
    #: and crew of an episode comes from the per-episode lookup.
    people: list[TmdbTvPersonOut] = []


class TmdbTvSeasonOut(ORMSchema):
    season_number: int
    name: str
    air_date: str | None = None
    release_year: int
    episode_count: int
    episodes: list[TmdbTvEpisodeOut] = []
    #: Season lookup only: everyone credited on *every* episode of the season.
    people: list[TmdbTvPersonOut] = []
    #: The episodes "every episode" was measured against (aired ones).
    episodes_counted: int = 0


class TmdbTvLookupOut(ORMSchema):
    tmdb_id: int
    name: str
    original_name: str | None = None
    first_air_date: str | None = None
    release_year: int
    overview: str | None = None
    episode_run_time: int
    number_of_seasons: int
    number_of_episodes: int
    #: The creators, plus everyone credited on every single episode of the
    #: included seasons (`episodes_counted` aired episodes).
    people: list[TmdbTvPersonOut]
    episodes_counted: int
    genres: list[TmdbTvGenreOut]
    seasons: list[TmdbTvSeasonOut]
    ambiguous: bool


class TmdbTvImportPersonIn(ORMSchema):
    tmdb_id: int
    name: str
    role: CastRole
    nationality: str
    existing_person_id: int | None = None


class TmdbTvImportEpisodeIn(ORMSchema):
    name: str
    name_en: str | None = None
    runtime_minutes: int = Field(default=0, ge=0)
    release_year: int
    notes: str | None = None
    people: list[TmdbTvImportPersonIn] = []
    #: Off by default: a TMDB-imported episode gets its own credits. On, it also
    #: gets its season's people.
    inherit_parent_people: bool = False
    genre_ids: list[int] | None = None  # None -> inherit the show's genres


class TmdbTvImportSeasonIn(ORMSchema):
    name: str
    name_en: str | None = None
    season_number: int | None = Field(default=None, ge=0)
    release_year: int
    notes: str | None = None
    people: list[TmdbTvImportPersonIn] = []
    episodes: list[TmdbTvImportEpisodeIn] = []
    #: Whole-show import only: also put this season and all its imported
    #: episodes in the importing user's personal list.
    add_to_list: bool = False


class TmdbTvImportIn(ORMSchema):
    name: str
    name_en: str | None = None
    release_year: int
    notes: str | None = None
    people: list[TmdbTvImportPersonIn] = []
    genre_ids: list[int] = []
    seasons: list[TmdbTvImportSeasonIn] = []
    #: Copy the show's people onto every imported season and episode.
    populate_down: bool = False
    #: Put the show in the importing user's personal list (seasons opt in
    #: individually via their own `add_to_list`).
    add_to_list: bool = False


class TmdbTvImportPersonResult(ORMSchema):
    person_id: int
    name: str
    nationality: str
    created: bool


class TmdbTvImportOut(ORMSchema):
    show_id: int
    season_ids: list[int]
    episode_ids: list[int]
    created_people: list[TmdbTvImportPersonResult]
    reused_people: list[TmdbTvImportPersonResult]


# ── Single-season lookup/import (a season of an existing show) ───────────────
class TmdbTvSeasonLookupIn(ORMSchema):
    """Locate one season: the TMDB show id or a title (+year), plus the TMDB
    season number. ``show_id`` (ours) is what the result's `parent_roles` are
    measured against."""

    show_id: int
    tmdb_show_id: int | None = None
    title: str | None = None
    year: int | None = None
    season_number: int = Field(ge=0)


class TmdbTvSeasonLookupOut(ORMSchema):
    tmdb_show_id: int
    show_name: str
    show_ambiguous: bool
    season: TmdbTvSeasonOut


class TmdbTvSeasonImportIn(ORMSchema):
    """Import one season's credits. With ``season_id`` they're merged into that
    existing season (the re-import path); without it a new season is added to
    the show. Either way, the listed episodes are made to exist in the season:
    one already in it (same title) is left alone, anything else is created."""

    show_id: int
    season_id: int | None = None
    update_season_fields: bool = False  # only meaningful with season_id
    season: TmdbTvImportSeasonIn
    #: Copy the season's people (all of them, after this import) onto every one
    #: of its episodes.
    populate_down: bool = False


class TmdbTvSeasonImportOut(ORMSchema):
    show_id: int
    season_id: int
    created: bool
    people_linked: int
    episodes_created: int
    created_people: list[TmdbTvImportPersonResult] = []
    reused_people: list[TmdbTvImportPersonResult] = []


# ── Single-episode lookup/import (an episode of an existing season) ──────────
class TmdbTvEpisodeLookupIn(ORMSchema):
    """Locate one episode. Give the TMDB show id or a title (+year), then
    either the season/episode numbers or an episode name to search for (our
    episodes don't store their episode number, only their rank in the season).
    ``season_id`` (ours) is what the result's `parent_roles` are measured
    against, and supplies the season number when one isn't given."""

    season_id: int | None = None
    tmdb_show_id: int | None = None
    title: str | None = None
    year: int | None = None
    season_number: int | None = Field(default=None, ge=0)
    episode_number: int | None = Field(default=None, ge=1)
    episode_name: str | None = None


class TmdbTvEpisodeLookupOut(ORMSchema):
    tmdb_show_id: int
    show_name: str
    show_ambiguous: bool
    episode: TmdbTvEpisodeOut


class TmdbTvEpisodeImportIn(ORMSchema):
    """Import one episode's credits. With ``episode_id`` the credits are merged
    into that existing episode (the re-import path); without it a new episode is
    appended to the season."""

    season_id: int
    episode_id: int | None = None
    update_episode_fields: bool = False  # only meaningful with episode_id
    episode: TmdbTvImportEpisodeIn


class TmdbTvEpisodeImportOut(ORMSchema):
    show_id: int
    season_id: int
    episode_id: int
    created: bool
    people_linked: int
    created_people: list[TmdbTvImportPersonResult] = []
    reused_people: list[TmdbTvImportPersonResult] = []
