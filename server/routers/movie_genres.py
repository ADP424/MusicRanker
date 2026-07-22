from ..api_models import (
    GenreIn,
    GenrePatch,
    MovieGenreCategoryIn,
    MovieGenreCategoryOut,
    MovieGenreCategoryPatch,
    MovieGenreOut,
)
from ..database_models import Genre, MovieGenreCategory
from .genre_router import make_category_router, make_genre_router

router = make_genre_router(
    model=Genre,
    category_model=MovieGenreCategory,
    category_junction_attr="movie_categories",
    media_flag="is_movie",
    in_schema=GenreIn,
    patch_schema=GenrePatch,
    out_schema=MovieGenreOut,
    prefix="/movie-genres",
    tag="movie-genres",
    not_found="Movie genre not found",
)

category_router = make_category_router(
    model=MovieGenreCategory,
    in_schema=MovieGenreCategoryIn,
    patch_schema=MovieGenreCategoryPatch,
    out_schema=MovieGenreCategoryOut,
    prefix="/movie-genres/categories",
    tag="movie-genre-categories",
)
