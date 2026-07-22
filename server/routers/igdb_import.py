from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..api_models.igdb_import import (
    IgdbImportIn,
    IgdbImportOut,
    IgdbLookupIn,
    IgdbLookupOut,
)
from ..database import get_database
from ..igdb_import import igdb_import_game, igdb_lookup

router = APIRouter(prefix="/games/igdb-import", tags=["igdb-import"])


@router.post("/lookup", response_model=IgdbLookupOut)
def lookup(body: IgdbLookupIn, db: Session = Depends(get_database)):
    result = igdb_lookup(db, body.title, body.year)
    if result is None:
        raise HTTPException(404, f"No IGDB match found for '{body.title}'")
    return result


@router.post("", response_model=IgdbImportOut, status_code=201)
def import_game(body: IgdbImportIn, db: Session = Depends(get_database)):
    try:
        return igdb_import_game(db, body)
    except ValueError as e:
        raise HTTPException(409, str(e))
