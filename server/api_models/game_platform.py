from .genre_base import (
    CategoryInBase,
    CategoryOutBase,
    CategoryPatchBase,
    GenreInBase,
    GenreOutBase,
    GenrePatchBase,
)


class GamePlatformIn(GenreInBase):
    pass


class GamePlatformPatch(GenrePatchBase):
    pass


class GamePlatformOut(GenreOutBase):
    pass


class GamePlatformCategoryIn(CategoryInBase):
    pass


class GamePlatformCategoryPatch(CategoryPatchBase):
    pass


class GamePlatformCategoryOut(CategoryOutBase):
    pass
