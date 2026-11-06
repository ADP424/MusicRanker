from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field

from ..database_models.game_credit import GameRole
from .base import ORMSchema
from .music import LinkOut, NamedRef


class GamePersonRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    role: GameRole


# ── Catalog ──────────────────────────────────────────────────────────────────
class GameIn(BaseModel):
    name: str
    name_en: str | None = None
    release_year: int
    notes: str | None = None


class GamePatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    release_year: int | None = None
    notes: str | None = None


class GameOut(ORMSchema):
    id: int
    name: str
    name_en: str | None
    release_year: int
    notes: str | None
    igdb_id: int | None = None
    overview: str | None = None
    image_url: str | None = None
    persons: list[GamePersonRef] = []
    genre_ids: list[int] = []
    platform_ids: list[int] = []
    links: list[LinkOut] = []
    soundtrack_albums: list[NamedRef] = []
    source_books: list[NamedRef] = []
    in_my_list: bool = False


class RankedGameOut(BaseModel):
    position: int
    rank: Decimal
    hours_played: Decimal | None
    notes: str | None
    game: GameOut


class GameEntryIn(BaseModel):
    """Fields left unset (rather than explicitly null) are a partial update —
    the existing value on the row is kept. See upsert_entry in routers/games.py."""
    hours_played: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class GameEntryOut(BaseModel):
    hours_played: Decimal | None
    notes: str | None
