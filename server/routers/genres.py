from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..api_models import (
    GenreCategoryIn,
    GenreCategoryOut,
    GenreCategoryPatch,
    GenreIn,
    GenreMediaTypesPatch,
    GenrePatch,
    MusicGenreOut,
)
from ..database import get_database
from ..database_models import Genre, GenreCategory
from .genre_router import make_category_router, make_genre_router

router = make_genre_router(
    model=Genre,
    category_model=GenreCategory,
    category_junction_attr="music_categories",
    media_flag="is_music",
    in_schema=GenreIn,
    patch_schema=GenrePatch,
    out_schema=MusicGenreOut,
    prefix="/genres",
    tag="genres",
    not_found="Genre not found",
)

category_router = make_category_router(
    model=GenreCategory,
    in_schema=GenreCategoryIn,
    patch_schema=GenreCategoryPatch,
    out_schema=GenreCategoryOut,
    prefix="/genres/categories",
    tag="genre-categories",
)


@router.patch("/{gid}/media-types", response_model=MusicGenreOut)
def update_media_types(gid: int, body: GenreMediaTypesPatch, db: Session = Depends(get_database)):
    """Cross-domain: toggle which media types a genre applies to. Not scoped
    to this router's own ``is_music`` flag — this is the one place all three
    flags are editable together."""
    genre = db.get(Genre, gid)
    if not genre:
        raise HTTPException(404, "Genre not found")
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(genre, k, v)
    is_music = updates.get("is_music", genre.is_music)
    is_movie = updates.get("is_movie", genre.is_movie)
    is_game = updates.get("is_game", genre.is_game)
    if not (is_music or is_movie or is_game):
        raise HTTPException(422, "Genre must apply to at least one media type")
    db.flush()
    genre.parent_ids = [p.id for p in genre.parents]
    genre.category_ids = [c.id for c in genre.music_categories]
    return genre
