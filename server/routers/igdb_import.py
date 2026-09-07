from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..api_models.igdb_import import (
    IgdbImportIn,
    IgdbImportOut,
    IgdbLookupIn,
    IgdbLookupOut,
)
from ..authz import Capability
from ..database import get_database
from ..deps import GuildContext, guild_ctx
from ..igdb_import import igdb_import_game, igdb_lookup

router = APIRouter(prefix="/guilds/{guild_id}/games/igdb-import", tags=["igdb-import"])
VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)


@router.post("/lookup", response_model=IgdbLookupOut)
def lookup(body: IgdbLookupIn, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
    result = igdb_lookup(db, ctx.guild_id, body.title, body.year)
    if result is None:
        raise HTTPException(404, f"No IGDB match found for '{body.title}'")
    return result


@router.post("", response_model=IgdbImportOut, status_code=201)
def import_game(body: IgdbImportIn, ctx: GuildContext = Depends(CREATE), db: Session = Depends(get_database)):
    try:
        return igdb_import_game(db, ctx.guild_id, ctx.user_id, body)
    except ValueError as e:
        raise HTTPException(409, str(e))
