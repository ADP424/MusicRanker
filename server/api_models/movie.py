from decimal import Decimal

from pydantic import BaseModel, Field

from ..database_models.movie_cast_member import CastRole
from .base import ORMSchema


class MoviePersonRef(BaseModel):
    id: int
    name: str
    role: CastRole


class MovieSoundtrackAlbumRef(BaseModel):
    id: int
    name: str
    artist_ids: list[int] = []


class MovieIn(BaseModel):
    name: str
    runtime_minutes: int = Field(gt=0)
    release_year: int
    watches: int = Field(default=1, ge=1)
    watch_link: str | None = None
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class MoviePatch(BaseModel):
    name: str | None = None
    runtime_minutes: int | None = Field(default=None, gt=0)
    release_year: int | None = None
    watches: int | None = Field(default=None, ge=1)
    watch_link: str | None = None
    notes: str | None = None


class MovieOut(ORMSchema):
    model_config = ORMSchema.model_config.copy()
    model_config["populate_by_name"] = True

    id: int
    name: str
    runtime_minutes: int
    release_year: int
    watches: int
    watch_link: str | None
    notes: str | None
    global_rank: Decimal | None
    position: int | None = None
    persons: list[MoviePersonRef] = []
    genre_ids: list[int] = []
    soundtrack_album_refs: list[MovieSoundtrackAlbumRef] = Field(default=[], serialization_alias="soundtrack_albums")


class MovieIndex(ORMSchema):
    """Slim movie shape for global cache / search."""

    id: int
    name: str
    person_ids: list[int] = []
    genre_ids: list[int] = []
