from ..api_models import MovieGenreIn, MovieGenreOut, MovieGenrePatch
from ..database_models import MovieGenre, movie_genre_parents
from .genre_router import make_genre_router

router = make_genre_router(
    model=MovieGenre,
    junction=movie_genre_parents,
    in_schema=MovieGenreIn,
    patch_schema=MovieGenrePatch,
    out_schema=MovieGenreOut,
    prefix="/movie-genres",
    tag="movie-genres",
    not_found="Movie genre not found",
)
