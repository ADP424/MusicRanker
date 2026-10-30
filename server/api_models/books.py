"""Books — ranked directly, like movies. Authors and contributors are people."""
from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field

from ..database_models.book_role import BookRole
from .base import ORMSchema
from .music import LinkOut, NamedRef


class BookPersonRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    role: BookRole


class BookIn(BaseModel):
    name: str
    name_en: str | None = None
    word_count: int | None = Field(default=None, ge=0)
    release_year: int
    alias: str | None = None
    notes: str | None = None


class BookPatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    word_count: int | None = Field(default=None, ge=0)
    release_year: int | None = None
    alias: str | None = None
    notes: str | None = None


class BookOut(ORMSchema):
    id: int
    name: str
    name_en: str | None
    word_count: int | None
    release_year: int
    alias: str | None
    notes: str | None
    persons: list[BookPersonRef] = []
    genre_ids: list[int] = []
    links: list[LinkOut] = []
    adaptation_movies: list[NamedRef] = []
    adaptation_games: list[NamedRef] = []
    adaptation_television_shows: list[NamedRef] = []
    in_my_list: bool = False


class RankedBookOut(BaseModel):
    position: int
    rank: Decimal
    reads: int
    notes: str | None
    book: BookOut


class BookEntryIn(BaseModel):
    """The personal layer. Creating this row is what "add to my list" means.
    Fields left unset (rather than explicitly null) are a partial update — the
    existing value on the row is kept. See `upsert_entry` in routers/books.py."""
    reads: int | None = Field(default=None, ge=1)
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class BookEntryOut(BaseModel):
    reads: int
    notes: str | None
