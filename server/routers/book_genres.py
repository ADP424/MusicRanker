from ..api_models import (
    BookGenreCategoryIn,
    BookGenreCategoryOut,
    BookGenreCategoryPatch,
    BookGenreOut,
    GenreIn,
    GenrePatch,
)
from ..database_models import BookGenreCategory, Genre
from .genre_router import make_category_router, make_genre_router

router = make_genre_router(
    model=Genre,
    category_model=BookGenreCategory,
    category_junction_attr="book_categories",
    media_flag="is_book",
    in_schema=GenreIn,
    patch_schema=GenrePatch,
    out_schema=BookGenreOut,
    prefix="/book-genres",
    tag="book-genres",
    not_found="Book genre not found",
)

category_router = make_category_router(
    model=BookGenreCategory,
    in_schema=BookGenreCategoryIn,
    patch_schema=BookGenreCategoryPatch,
    out_schema=BookGenreCategoryOut,
    prefix="/book-genres/categories",
    tag="book-genre-categories",
)
