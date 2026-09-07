from ..api_models import (
    GamePlatformCategoryIn,
    GamePlatformCategoryOut,
    GamePlatformCategoryPatch,
    GamePlatformIn,
    GamePlatformOut,
    GamePlatformPatch,
)
from ..database_models import GamePlatform, GamePlatformCategory
from .genre_router import make_category_router, make_genre_router

router = make_genre_router(
    model=GamePlatform,
    category_model=GamePlatformCategory,
    category_junction_attr="categories",
    media_flag=None,
    in_schema=GamePlatformIn,
    patch_schema=GamePlatformPatch,
    out_schema=GamePlatformOut,
    prefix="/game-platforms",
    tag="game-platforms",
    not_found="Game platform not found",
)

category_router = make_category_router(
    model=GamePlatformCategory,
    in_schema=GamePlatformCategoryIn,
    patch_schema=GamePlatformCategoryPatch,
    out_schema=GamePlatformCategoryOut,
    prefix="/game-platforms/categories",
    tag="game-platform-categories",
)
