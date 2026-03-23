from decimal import Decimal

from pydantic import BaseModel, Field

from .base import ORMSchema


class ArtistIn(BaseModel):
    name: str
    discography_link: str
    birth_nationality: str
    core_nationality: str
    primary_genre: int | None = None
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class ArtistPatch(BaseModel):
    name: str | None = None
    discography_link: str | None = None
    birth_nationality: str | None = None
    core_nationality: str | None = None
    primary_genre: int | None = None
    notes: str | None = None


class ArtistOut(ORMSchema):
    id: int
    name: str
    global_rank: Decimal | None
    position: int | None = None
    discography_link: str
    birth_nationality: str
    core_nationality: str
    primary_genre: int | None
    notes: str | None
