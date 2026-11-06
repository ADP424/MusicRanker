from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..api_models.tmdb_import import (
    TmdbCreditsIn,
    TmdbCreditsOut,
    TmdbImportIn,
    TmdbImportOut,
    TmdbLookupIn,
    TmdbLookupOut,
)
from ..authz import Capability
from ..database import get_database
from ..deps import GuildContext, guild_ctx
from ..tmdb_import import tmdb_import_movie, tmdb_lookup, tmdb_merge_credits

router = APIRouter(prefix="/guilds/{guild_id}/movies/tmdb-import", tags=["tmdb-import"])
VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)


@router.post("/lookup", response_model=TmdbLookupOut)
def lookup(body: TmdbLookupIn, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database, scope="function")):
    db.commit()  # hand the pooled connection back while TMDB/IGDB is called (it may queue for a while)
    result = tmdb_lookup(db, ctx.guild_id, body.title, body.year, body.tmdb_id)
    if result is None:
        raise HTTPException(404, f"No TMDB match found for '{body.title}'")
    return result


@router.post("", response_model=TmdbImportOut, status_code=201)
def import_movie(body: TmdbImportIn, ctx: GuildContext = Depends(CREATE), db: Session = Depends(get_database, scope="function")):
    try:
        return tmdb_import_movie(db, ctx.guild_id, ctx.user_id, body)
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.post("/credits/{mid}", response_model=TmdbCreditsOut)
def merge_credits(mid: int, body: TmdbCreditsIn, ctx: GuildContext = Depends(EDIT),
                  db: Session = Depends(get_database, scope="function")):
    try:
        return tmdb_merge_credits(db, ctx.guild_id, ctx.user_id, mid, body)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
