from pydantic import BaseModel

from .base import ORMSchema


class GenreInBase(BaseModel):
    name: str
    synonyms: list[str] | None = None
    notes: str | None = None


class GenrePatchBase(BaseModel):
    name: str | None = None
    synonyms: list[str] | None = None
    notes: str | None = None


class GenreOutBase(ORMSchema):
    id: int
    name: str
    synonyms: list[str] | None
    notes: str | None
    parent_ids: list[int] = []
    # Every domain's router populates this in `_with_refs`, so it belongs on the
    # base: declaring it per-subclass is how GamePlatformOut came to silently
    # drop it (the platform pickers then read `undefined`, and platform
    # categories could be assigned but never unassigned).
    category_ids: list[int] = []


class MediaTypesInMixin(BaseModel):
    """Extra fields for domains backed by the shared Genre model (which has
    is_music/is_movie/is_game/is_television/is_book columns) — not used by taxonomies
    like GamePlatform that don't have a media-type split."""

    is_music: bool = False
    is_movie: bool = False
    is_game: bool = False
    is_television: bool = False
    is_book: bool = False


class MediaTypesOutMixin(BaseModel):
    is_music: bool
    is_movie: bool
    is_game: bool
    is_television: bool
    is_book: bool


class CategoryInBase(BaseModel):
    name: str


class CategoryPatchBase(BaseModel):
    name: str | None = None


class CategoryOutBase(ORMSchema):
    id: int
    name: str
