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


class EpisodeRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None


class TelevisionShowOut(ORMSchema):
    id: int
    name: str
    name_en: str | None
    release_year: int
    notes: str | None
    persons: list[TelevisionPersonRef] = []
    genre_ids: list[int] = []
    links: list[LinkOut] = []
    soundtrack_albums: list[NamedRef] = []
    episodes: list[EpisodeRef] = []
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


# ── Episodes ─────────────────────────────────────────────────────────────────
class TelevisionEpisodeIn(BaseModel):
    """Inheritable scalars are optional: omitting one copies the parent show's
    value. ``inherit_from_show`` additionally copies the show's people and
    genres onto the new episode (both editable afterwards)."""

    name: str
    name_en: str | None = None
    runtime_minutes: int = Field(default=0, ge=0)
    release_year: int | None = None
    notes: str | None = None
    inherit_from_show: bool = True


class TelevisionEpisodePatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    runtime_minutes: int | None = Field(default=None, ge=0)
    release_year: int | None = None
    notes: str | None = None


class TelevisionEpisodeOut(ORMSchema):
    id: int
    show_id: int
    name: str
    name_en: str | None
    runtime_minutes: int
    release_year: int
    notes: str | None
    episode_rank: Decimal | None
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
