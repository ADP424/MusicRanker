from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..api_models.igdb_import import (
    IgdbCreditsIn,
    IgdbCreditsOut,
    IgdbImportIn,
    IgdbImportOut,
    IgdbLookupIn,
    IgdbLookupOut,
)
from ..authz import Capability
from ..database import get_database
from ..deps import GuildContext, guild_ctx
from ..igdb_import import igdb_import_game, igdb_lookup, igdb_merge_credits

router = APIRouter(prefix="/guilds/{guild_id}/games/igdb-import", tags=["igdb-import"])
VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)


@router.post("/lookup", response_model=IgdbLookupOut)
def lookup(body: IgdbLookupIn, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database, scope="function")):
    db.commit()  # hand the pooled connection back while TMDB/IGDB is called (it may queue for a while)
    result = igdb_lookup(db, ctx.guild_id, body.title, body.year, body.igdb_id)
    if result is None:
        raise HTTPException(404, f"No IGDB match found for '{body.title}'")
    return result


@router.post("", response_model=IgdbImportOut, status_code=201)
def import_game(body: IgdbImportIn, ctx: GuildContext = Depends(CREATE), db: Session = Depends(get_database, scope="function")):
    try:
        return igdb_import_game(db, ctx.guild_id, ctx.user_id, body)
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.post("/credits/{gid}", response_model=IgdbCreditsOut)
def merge_credits(gid: int, body: IgdbCreditsIn, ctx: GuildContext = Depends(EDIT),
                  db: Session = Depends(get_database, scope="function")):
    try:
        return igdb_merge_credits(db, ctx.guild_id, ctx.user_id, gid, body)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
