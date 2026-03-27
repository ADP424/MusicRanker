from decimal import Decimal

from pydantic import BaseModel, Field

from .base import ORMSchema


class AlbumArtistRef(BaseModel):
    id: int
    name: str
    discography_link: str


class AlbumIn(BaseModel):
    name: str
    runtime_seconds: int = Field(gt=0)
    release_year: int
    alias: str | None = None
    alias_link: str | None = None
    listens: int = Field(default=1, ge=1)
    listen_link: str | None = None
    notes: str | None = None


class AlbumPatch(BaseModel):
    name: str | None = None
    runtime_seconds: int | None = Field(default=None, gt=0)
    release_year: int | None = None
    alias: str | None = None
    alias_link: str | None = None
    listens: int | None = Field(default=None, ge=1)
    listen_link: str | None = None
    notes: str | None = None


class AlbumOut(ORMSchema):
    id: int
    name: str
    runtime_seconds: int
    release_year: int
    alias: str | None
    alias_link: str | None
    listens: int
    listen_link: str | None
    notes: str | None
    album_rank: Decimal | None = None
    position: int | None = None
    artists: list[AlbumArtistRef] = []
    genre_ids: list[int] = []


class AlbumIndex(ORMSchema):
    """Slim album shape for global cache / search — no rank or position."""

    id: int
    name: str
    artist_ids: list[int] = []
    genre_ids: list[int] = []
