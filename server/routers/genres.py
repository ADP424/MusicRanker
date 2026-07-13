from ..api_models import GenreIn, GenreOut, GenrePatch
from ..database_models import Genre
from ..database_models.genre_parent import genre_parents
from .genre_router import make_genre_router

router = make_genre_router(
    model=Genre,
    junction=genre_parents,
    in_schema=GenreIn,
    patch_schema=GenrePatch,
    out_schema=GenreOut,
    prefix="/genres",
    tag="genres",
    not_found="Genre not found",
)
