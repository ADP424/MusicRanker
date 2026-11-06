from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field

from ..database_models.movie_cast_member import CastRole
from .base import ORMSchema
from .music import LinkOut, NamedRef


class TelevisionPersonRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    role: CastRole


# ── Shows ────────────────────────────────────────────────────────────────────
class TelevisionShowIn(BaseModel):
    name: str
    name_en: str | None = None
    release_year: int
    notes: str | None = None


class TelevisionShowPatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    release_year: int | None = None
    notes: str | None = None


class EpisodeRef(ORMSchema):
    id: int
    name: str
    name_en: str | None = None


class SeasonRef(ORMSchema):
    id: int
    name: str
    name_en: str | None = None
    season_number: int | None = None


class TelevisionShowOut(ORMSchema):
    id: int
    name: str
    name_en: str | None
    release_year: int
    notes: str | None
    tmdb_id: int | None = None
    overview: str | None = None
    image_url: str | None = None
    persons: list[TelevisionPersonRef] = []
    genre_ids: list[int] = []
    links: list[LinkOut] = []
    soundtrack_albums: list[NamedRef] = []
    source_books: list[NamedRef] = []
    seasons: list[SeasonRef] = []
    season_count: int = 0
    episodes: list[EpisodeRef] = []  # every episode, all seasons — for search
    episode_count: int = 0
    in_my_list: bool = False


class RankedTelevisionShowOut(BaseModel):
    position: int
    rank: Decimal
    notes: str | None
    show: TelevisionShowOut


class TelevisionShowEntryIn(BaseModel):
    """Fields left unset (rather than explicitly null) are a partial update —
    the existing value on the row is kept. See upsert_show_entry in routers/television.py."""
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class TelevisionShowEntryOut(BaseModel):
    notes: str | None


# ── Seasons ──────────────────────────────────────────────────────────────────
class TelevisionSeasonIn(BaseModel):
    """Omitting ``release_year`` copies the show's. ``inherit_from_show`` copies
    the show's people onto the new season (minus ``creator``, which is
    show-only); editable afterwards."""

    name: str
    name_en: str | None = None
    season_number: int | None = Field(default=None, ge=0)
    release_year: int | None = None
    notes: str | None = None
    inherit_from_show: bool = True


class TelevisionSeasonPatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    season_number: int | None = Field(default=None, ge=0)
    release_year: int | None = None
    notes: str | None = None


class TelevisionSeasonOut(ORMSchema):
    id: int
    show_id: int
    name: str
    name_en: str | None
    season_number: int | None
    release_year: int
    notes: str | None
    season_rank: Decimal | None
    overview: str | None = None
    image_url: str | None = None
    persons: list[TelevisionPersonRef] = []
    links: list[LinkOut] = []
    episodes: list[EpisodeRef] = []
    episode_count: int = 0
    runtime_minutes: int = 0  # sum over its episodes
    in_my_list: bool = False


class RankedTelevisionSeasonOut(BaseModel):
    position: int
    rank: Decimal
    notes: str | None
    season: TelevisionSeasonOut


class TelevisionSeasonEntryIn(BaseModel):
    """Fields left unset (rather than explicitly null) are a partial update —
    the existing value on the row is kept. See upsert_season_entry in routers/television.py."""
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class TelevisionSeasonEntryOut(BaseModel):
    notes: str | None


# ── Episodes ─────────────────────────────────────────────────────────────────
class TelevisionEpisodeIn(BaseModel):
    """Inheritable scalars are optional: omitting one copies the parent
    season's value. ``inherit_from_parent`` additionally copies the season's
    people and the show's genres onto the new episode (both editable afterwards)."""

    name: str
    name_en: str | None = None
    runtime_minutes: int = Field(default=0, ge=0)
    release_year: int | None = None
    notes: str | None = None
    inherit_from_parent: bool = True


class TelevisionEpisodePatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    runtime_minutes: int | None = Field(default=None, ge=0)
    release_year: int | None = None
    notes: str | None = None
    #: Move the episode to another season of the same show (appended at the end).
    season_id: int | None = None


class TelevisionEpisodeOut(ORMSchema):
    id: int
    show_id: int
    season_id: int
    name: str
    name_en: str | None
    runtime_minutes: int
    release_year: int
    notes: str | None
    episode_rank: Decimal | None
    episode_number: int | None = None
    overview: str | None = None
    image_url: str | None = None
    persons: list[TelevisionPersonRef] = []
    genre_ids: list[int] = []
    links: list[LinkOut] = []
    in_my_list: bool = False


class RankedTelevisionEpisodeOut(BaseModel):
    position: int
    rank: Decimal
    watches: int
    notes: str | None
    episode: TelevisionEpisodeOut


class TelevisionEpisodeEntryIn(BaseModel):
    """Fields left unset (rather than explicitly null) are a partial update —
    the existing value on the row is kept. See upsert_episode_entry in routers/television.py."""
    watches: int | None = Field(default=None, ge=1)
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class TelevisionEpisodeEntryOut(BaseModel):
    watches: int
    notes: str | None
