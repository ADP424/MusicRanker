from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field

from ..database_models.movie_cast_member import CastRole
from .base import ORMSchema
from .music import LinkOut, NamedRef


class MoviePersonRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    role: CastRole


class MovieIn(BaseModel):
    name: str
    name_en: str | None = None
    runtime_minutes: int = Field(ge=0)
    release_year: int
    notes: str | None = None


class MoviePatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    runtime_minutes: int | None = Field(default=None, ge=0)
    release_year: int | None = None
    notes: str | None = None


class MovieOut(ORMSchema):
    id: int
    name: str
    name_en: str | None
    runtime_minutes: int
    release_year: int
    notes: str | None
    persons: list[MoviePersonRef] = []
    genre_ids: list[int] = []
    links: list[LinkOut] = []
    soundtrack_albums: list[NamedRef] = []
    in_my_list: bool = False


class RankedMovieOut(BaseModel):
    position: int
    rank: Decimal
    watches: int
    notes: str | None
    movie: MovieOut


class MovieEntryIn(BaseModel):
    """The personal layer. Creating this row is what "add to my list" means.
    Fields left unset (rather than explicitly null) are a partial update — the
    existing value on the row is kept. See `upsert_entry` in routers/movies.py."""
    watches: int | None = Field(default=None, ge=1)
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class MovieEntryOut(BaseModel):
    watches: int
    notes: str | None
