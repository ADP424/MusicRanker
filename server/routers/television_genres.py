from ..api_models import (
    GenreIn,
    GenrePatch,
    TelevisionGenreCategoryIn,
    TelevisionGenreCategoryOut,
    TelevisionGenreCategoryPatch,
    TelevisionGenreOut,
)
from ..database_models import Genre, TelevisionGenreCategory
from .genre_router import make_category_router, make_genre_router

router = make_genre_router(
    model=Genre,
    category_model=TelevisionGenreCategory,
    category_junction_attr="television_categories",
    media_flag="is_television",
    in_schema=GenreIn,
    patch_schema=GenrePatch,
    out_schema=TelevisionGenreOut,
    prefix="/television-genres",
    tag="television-genres",
    not_found="Television genre not found",
)

category_router = make_category_router(
    model=TelevisionGenreCategory,
    in_schema=TelevisionGenreCategoryIn,
    patch_schema=TelevisionGenreCategoryPatch,
    out_schema=TelevisionGenreCategoryOut,
    prefix="/television-genres/categories",
    tag="television-genre-categories",
)
