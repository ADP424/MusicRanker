from ..api_models import (
    GameGenreCategoryIn,
    GameGenreCategoryOut,
    GameGenreCategoryPatch,
    GameGenreOut,
    GenreIn,
    GenrePatch,
)
from ..database_models import GameGenreCategory, Genre
from .genre_router import make_category_router, make_genre_router

router = make_genre_router(
    model=Genre,
    category_model=GameGenreCategory,
    category_junction_attr="game_categories",
    media_flag="is_game",
    in_schema=GenreIn,
    patch_schema=GenrePatch,
    out_schema=GameGenreOut,
    prefix="/game-genres",
    tag="game-genres",
    not_found="Game genre not found",
)

category_router = make_category_router(
    model=GameGenreCategory,
    in_schema=GameGenreCategoryIn,
    patch_schema=GameGenreCategoryPatch,
    out_schema=GameGenreCategoryOut,
    prefix="/game-genres/categories",
    tag="game-genre-categories",
)
