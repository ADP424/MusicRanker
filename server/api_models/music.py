from __future__ import annotations

from decimal import Decimal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

from ..database_models.artist_band_role import BandRole
from .base import ORMSchema


class LinkIn(BaseModel):
    label: str | None = None
    url: str
    position: int = 0

    @field_validator("url")
    @classmethod
    def _web_url(cls, v: str) -> str:
        """Only http(s): links are rendered as <a href>, and a `javascript:` URL
        there is stored XSS. A bare host ("example.com/x") gets https:// added."""
        v = v.strip()
        if "://" not in v and not v.lower().startswith(("javascript:", "data:", "vbscript:")):
            v = "https://" + v
        parts = urlsplit(v)
        if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
            raise ValueError("Links must be http:// or https:// web addresses")
        return v


class LinkOut(ORMSchema):
    id: int
    label: str | None
    url: str
    position: int


class NamedRef(ORMSchema):
    id: int
    name: str
    name_en: str | None = None


class AlbumRef(ORMSchema):
    id: int
    name: str
    name_en: str | None = None
    alias: str | None = None
    genre_ids: list[int] = []


# ── Artists ──────────────────────────────────────────────────────────────────
class ArtistIn(BaseModel):
    name: str
    name_en: str | None = None
    birth_nationality: str = "Unknown"  # the other one is copied in when only one is given
    core_nationality: str = "Unknown"
    primary_genre: int | None = None
    notes: str | None = None


class ArtistPatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    birth_nationality: str | None = None
    core_nationality: str | None = None
    primary_genre: int | None = None
    notes: str | None = None


class PersonArtistRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    role: BandRole


class ArtistOut(ORMSchema):
    id: int
    name: str
    name_en: str | None
    birth_nationality: str
    core_nationality: str
    primary_genre: int | None
    notes: str | None
    links: list[LinkOut] = []
    persons: list[PersonArtistRef] = []
    albums: list[AlbumRef] = []
    album_count: int = 0
    in_my_list: bool = False


class RankedArtistOut(BaseModel):
    position: int
    rank: Decimal
    notes: str | None
    artist: ArtistOut


class EntryIn(BaseModel):
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


# ── Albums ───────────────────────────────────────────────────────────────────
class AlbumIn(BaseModel):
    name: str
    name_en: str | None = None
    runtime_seconds: int = Field(ge=0)
    release_year: int
    alias: str | None = None
    notes: str | None = None
    artist_ids: list[int] = []


class AlbumPatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    runtime_seconds: int | None = Field(default=None, ge=0)
    release_year: int | None = None
    alias: str | None = None
    notes: str | None = None


class AlbumOut(ORMSchema):
    id: int
    name: str
    name_en: str | None
    runtime_seconds: int
    release_year: int
    alias: str | None
    notes: str | None
    artists: list[NamedRef] = []
    genre_ids: list[int] = []
    links: list[LinkOut] = []
    soundtrack_movies: list[NamedRef] = []
    soundtrack_games: list[NamedRef] = []
    soundtrack_television_shows: list[NamedRef] = []
    in_my_list: bool = False


class RankedAlbumOut(BaseModel):
    position: int
    rank: Decimal
    listens: int
    notes: str | None
    album: AlbumOut


class AlbumEntryIn(BaseModel):
    """Fields left unset (rather than explicitly null) are a partial update —
    the existing value on the row is kept. See upsert_album_entry in routers/artists.py."""
    listens: int | None = Field(default=None, ge=1)
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class AlbumEntryOut(BaseModel):
    listens: int
    notes: str | None
