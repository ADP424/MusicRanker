from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..api_models.tmdb_tv_import import (
    TmdbTvEpisodeImportIn,
    TmdbTvEpisodeImportOut,
    TmdbTvEpisodeLookupIn,
    TmdbTvEpisodeLookupOut,
    TmdbTvImportIn,
    TmdbTvImportOut,
    TmdbTvLookupIn,
    TmdbTvLookupOut,
)
from ..database import get_database
from ..tmdb_tv_import import (
    tmdb_import_episode,
    tmdb_import_show,
    tv_episode_lookup,
    tv_lookup,
)

router = APIRouter(prefix="/television/tmdb-import", tags=["tmdb-import"])


@router.post("/lookup", response_model=TmdbTvLookupOut)
def lookup(body: TmdbTvLookupIn, db: Session = Depends(get_database)):
    result = tv_lookup(
        db,
        body.title,
        body.year,
        include_episodes=body.include_episodes,
        include_specials=body.include_specials,
        season_numbers=body.season_numbers,
        crew_episode_threshold=body.crew_episode_threshold,
    )
    if result is None:
        raise HTTPException(404, f"No TMDB TV match found for '{body.title}'")
    return result


@router.post("", response_model=TmdbTvImportOut, status_code=201)
def import_show(body: TmdbTvImportIn, db: Session = Depends(get_database)):
    try:
        return tmdb_import_show(db, body)
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.post("/episode-lookup", response_model=TmdbTvEpisodeLookupOut)
def episode_lookup(body: TmdbTvEpisodeLookupIn, db: Session = Depends(get_database)):
    try:
        result = tv_episode_lookup(db, body)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if result is None:
        raise HTTPException(404, "No matching TMDB episode found")
    return result


@router.post("/episode", response_model=TmdbTvEpisodeImportOut, status_code=201)
def import_episode(body: TmdbTvEpisodeImportIn, db: Session = Depends(get_database)):
    try:
        return tmdb_import_episode(db, body)
    except ValueError as e:
        raise HTTPException(409, str(e))
