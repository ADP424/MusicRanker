from pydantic import BaseModel

from .genre_base import (
    CategoryInBase,
    CategoryOutBase,
    CategoryPatchBase,
    GenreInBase,
    GenreOutBase,
    GenrePatchBase,
    MediaTypesInMixin,
    MediaTypesOutMixin,
)


class GenreIn(GenreInBase, MediaTypesInMixin):
    pass


class GenrePatch(GenrePatchBase):
    pass


class MusicGenreOut(GenreOutBase, MediaTypesOutMixin):
    category_ids: list[int] = []


class MovieGenreOut(GenreOutBase, MediaTypesOutMixin):
    category_ids: list[int] = []


class GameGenreOut(GenreOutBase, MediaTypesOutMixin):
    category_ids: list[int] = []


class GenreCategoryIn(CategoryInBase):
    pass


class GenreCategoryPatch(CategoryPatchBase):
    pass


class GenreCategoryOut(CategoryOutBase):
    pass


class MovieGenreCategoryIn(CategoryInBase):
    pass


class MovieGenreCategoryPatch(CategoryPatchBase):
    pass


class MovieGenreCategoryOut(CategoryOutBase):
    pass


class GameGenreCategoryIn(CategoryInBase):
    pass


class GameGenreCategoryPatch(CategoryPatchBase):
    pass


class GameGenreCategoryOut(CategoryOutBase):
    pass


class GenreMediaTypesPatch(BaseModel):
    is_music: bool | None = None
    is_movie: bool | None = None
    is_game: bool | None = None
