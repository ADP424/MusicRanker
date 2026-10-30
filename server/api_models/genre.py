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
    pass


class MovieGenreOut(GenreOutBase, MediaTypesOutMixin):
    pass


class GameGenreOut(GenreOutBase, MediaTypesOutMixin):
    pass


class TelevisionGenreOut(GenreOutBase, MediaTypesOutMixin):
    pass


class BookGenreOut(GenreOutBase, MediaTypesOutMixin):
    pass


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


class TelevisionGenreCategoryIn(CategoryInBase):
    pass


class TelevisionGenreCategoryPatch(CategoryPatchBase):
    pass


class TelevisionGenreCategoryOut(CategoryOutBase):
    pass


class BookGenreCategoryIn(CategoryInBase):
    pass


class BookGenreCategoryPatch(CategoryPatchBase):
    pass


class BookGenreCategoryOut(CategoryOutBase):
    pass


class GenreMediaTypesPatch(BaseModel):
    is_music: bool | None = None
    is_movie: bool | None = None
    is_game: bool | None = None
    is_television: bool | None = None
    is_book: bool | None = None
