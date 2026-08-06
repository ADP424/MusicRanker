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
    #: Crew credited on fewer than this share of the show's episodes are left to
    #: the per-episode step. Creators and composers are exempt.
    crew_episode_threshold: float = Field(default=0.5, ge=0.0, le=1.0)


class TmdbTvDbPersonMatchOut(ORMSchema):
    person_id: int
    person_name: str
    has_screen_entries: bool
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
    #: At the *show* step this holds only the episode's director(s) and
    #: composer(s) — the credits that are always automatic. The full cast and
    #: crew of an episode comes from the per-episode lookup.
    people: list[TmdbTvPersonOut] = []


class TmdbTvSeasonOut(ORMSchema):
    season_number: int
    name: str
    air_date: str | None = None
    episode_count: int
    episodes: list[TmdbTvEpisodeOut] = []


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
    crew_episode_threshold: float
    people: list[TmdbTvPersonOut]
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
    watches: int = Field(default=1, ge=1)
    watch_link: str | None = None
    notes: str | None = None
    people: list[TmdbTvImportPersonIn] = []
    #: Off by default: a TMDB-imported episode gets its own credits, and the
    #: show-level import deliberately attaches only director/composer.
    inherit_show_people: bool = False
    genre_ids: list[int] | None = None  # None -> inherit the show's genres


class TmdbTvImportIn(ORMSchema):
    name: str
    name_en: str | None = None
    release_year: int
    watch_link: str | None = None
    notes: str | None = None
    people: list[TmdbTvImportPersonIn] = []
    genre_ids: list[int] = []
    episodes: list[TmdbTvImportEpisodeIn] = []


class TmdbTvImportPersonResult(ORMSchema):
    person_id: int
    name: str
    nationality: str
    created: bool


class TmdbTvImportOut(ORMSchema):
    show_id: int
    episode_ids: list[int]
    created_people: list[TmdbTvImportPersonResult]
    reused_people: list[TmdbTvImportPersonResult]


# ── Single-episode lookup/import (adding an episode to an existing show) ─────
class TmdbTvEpisodeLookupIn(ORMSchema):
    """Locate one episode. Give the TMDB show id or a title (+year), then
    either the season/episode numbers or an episode name to search for (our
    episodes don't store season/episode numbers, only their rank in the show)."""

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
    appended to the show."""

    show_id: int
    episode_id: int | None = None
    update_episode_fields: bool = False  # only meaningful with episode_id
    episode: TmdbTvImportEpisodeIn


class TmdbTvEpisodeImportOut(ORMSchema):
    show_id: int
    episode_id: int
    created: bool
    people_linked: int
    created_people: list[TmdbTvImportPersonResult] = []
    reused_people: list[TmdbTvImportPersonResult] = []
