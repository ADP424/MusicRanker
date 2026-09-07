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
from ..authz import Capability
from ..database import get_database
from ..deps import GuildContext, guild_ctx
from ..tmdb_tv_import import (
    tmdb_import_episode,
    tmdb_import_show,
    tv_episode_lookup,
    tv_lookup,
)

router = APIRouter(prefix="/guilds/{guild_id}/television/tmdb-import", tags=["tmdb-import"])
VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)


@router.post("/lookup", response_model=TmdbTvLookupOut)
def lookup(body: TmdbTvLookupIn, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
    result = tv_lookup(
        db,
        ctx.guild_id,
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
def import_show(body: TmdbTvImportIn, ctx: GuildContext = Depends(CREATE), db: Session = Depends(get_database)):
    try:
        return tmdb_import_show(db, ctx.guild_id, ctx.user_id, body)
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.post("/episode-lookup", response_model=TmdbTvEpisodeLookupOut)
def episode_lookup(body: TmdbTvEpisodeLookupIn, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
    try:
        result = tv_episode_lookup(db, ctx.guild_id, body)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if result is None:
        raise HTTPException(404, "No matching TMDB episode found")
    return result


@router.post("/episode", response_model=TmdbTvEpisodeImportOut, status_code=201)
def import_episode(body: TmdbTvEpisodeImportIn, ctx: GuildContext = Depends(CREATE), db: Session = Depends(get_database)):
    try:
        return tmdb_import_episode(db, ctx.guild_id, ctx.user_id, body)
    except ValueError as e:
        raise HTTPException(409, str(e))
