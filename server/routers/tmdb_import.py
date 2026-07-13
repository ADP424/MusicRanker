from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..api_models.tmdb_import import (
    TmdbImportIn,
    TmdbImportOut,
    TmdbLookupIn,
    TmdbLookupOut,
)
from ..database import get_database
from ..tmdb_import import tmdb_import_movie, tmdb_lookup

router = APIRouter(prefix="/movies/tmdb-import", tags=["tmdb-import"])


@router.post("/lookup", response_model=TmdbLookupOut)
def lookup(body: TmdbLookupIn, db: Session = Depends(get_database)):
    result = tmdb_lookup(db, body.title, body.year)
    if result is None:
        raise HTTPException(404, f"No TMDB match found for '{body.title}'")
    return result


@router.post("", response_model=TmdbImportOut, status_code=201)
def import_movie(body: TmdbImportIn, db: Session = Depends(get_database)):
    try:
        return tmdb_import_movie(db, body)
    except ValueError as e:
        raise HTTPException(409, str(e))
