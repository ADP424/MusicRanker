from decimal import Decimal

from pydantic import BaseModel, Field

from ..database_models.game_credit import GameRole
from .base import ORMSchema


class GamePersonRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    role: GameRole


class GameSoundtrackAlbumRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None


class GameIn(BaseModel):
    name: str
    name_en: str | None = None
    release_year: int
    hours_played: Decimal | None = Field(default=None, ge=0)
    play_link: str | None = None
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class GamePatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    release_year: int | None = None
    hours_played: Decimal | None = Field(default=None, ge=0)
    play_link: str | None = None
    notes: str | None = None


class GameOut(ORMSchema):
    model_config = ORMSchema.model_config.copy()
    model_config["populate_by_name"] = True

    id: int
    name: str
    name_en: str | None = None
    release_year: int
    hours_played: Decimal | None
    play_link: str | None
    notes: str | None
    global_rank: Decimal | None
    position: int | None = None
    persons: list[GamePersonRef] = []
    genre_ids: list[int] = []
    platform_ids: list[int] = []
    soundtrack_album_refs: list[GameSoundtrackAlbumRef] = Field(default=[], serialization_alias="soundtrack_albums")


class GameIndex(ORMSchema):
    """Slim shape for list views / global cache."""

    id: int
    name: str
    name_en: str | None = None
    person_ids: list[int] = []
    genre_ids: list[int] = []
    platform_ids: list[int] = []
