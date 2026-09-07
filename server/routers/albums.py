from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..api_models.music import AlbumIn, AlbumOut, AlbumPatch, NamedRef
from ..authz import Capability
from ..database import get_database
from ..database_models import Album, AlbumArtist, AlbumLink, Artist, Genre, UserAlbumRank
from ..deps import GuildContext, guild_ctx
from ..guild_junction_helpers import link_guild_scoped
from .links import make_links_router

router = APIRouter(prefix="/guilds/{guild_id}/albums", tags=["albums"])
VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)

links_router = make_links_router(
    owner_model=Album, link_model=AlbumLink, owner_fk="album_id", prefix="/albums", tag="albums"
)


def _album(db: DbSession, ctx: GuildContext, aid: int) -> Album:
    a = db.get(Album, aid)
    if a is None or a.guild_id != ctx.guild_id:
        raise HTTPException(404, "Album not found")
    return a


def _out(a: Album) -> AlbumOut:
    out = AlbumOut.model_validate(a)
    out.runtime_seconds = a.runtime_seconds
    out.artists = [NamedRef(id=l.artist.id, name=l.artist.name, name_en=l.artist.name_en) for l in a.artist_links]
    out.genre_ids = [g.id for g in a.genres]
    out.soundtrack_movies = [NamedRef(id=m.id, name=m.name, name_en=m.name_en) for m in a.soundtrack_movies]
    out.soundtrack_games = [NamedRef(id=g.id, name=g.name, name_en=g.name_en) for g in a.soundtrack_games]
    out.soundtrack_television_shows = [
        NamedRef(id=s.id, name=s.name, name_en=s.name_en) for s in a.soundtrack_television_shows
    ]
    return out


@router.get("", response_model=list[AlbumOut])
def list_albums(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    rows = db.scalars(select(Album).where(Album.guild_id == ctx.guild_id).order_by(Album.name)).all()
    return [_out(a) for a in rows]


@router.post("", response_model=AlbumOut, status_code=201)
def create_album(body: AlbumIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database)):
    data = body.model_dump()
    artist_ids = data.pop("artist_ids")
    album = Album(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id,
                  runtime=timedelta(seconds=data.pop("runtime_seconds")), **data)
    db.add(album)
    db.flush()
    for aid in artist_ids:
        artist = db.get(Artist, aid)
        if artist is None or artist.guild_id != ctx.guild_id:
            raise HTTPException(404, f"Artist {aid} not found")
        db.add(AlbumArtist(album_id=album.id, artist_id=aid, guild_id=ctx.guild_id))
    db.flush()
    return _out(album)


@router.get("/{aid}", response_model=AlbumOut)
def get_album(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return _out(_album(db, ctx, aid))


@router.patch("/{aid}", response_model=AlbumOut)
def update_album(aid: int, body: AlbumPatch, ctx: GuildContext = Depends(EDIT),
                 db: DbSession = Depends(get_database)):
    album = _album(db, ctx, aid)
    data = body.model_dump(exclude_unset=True)
    if "runtime_seconds" in data:
        album.runtime = timedelta(seconds=data.pop("runtime_seconds"))
    for k, v in data.items():
        setattr(album, k, v)
    album.updated_by_user_id = ctx.user_id
    return _out(album)


@router.get("/{aid}/impact")
def delete_impact(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    _album(db, ctx, aid)
    return {"rankings_destroyed": db.scalar(
        select(func.count()).select_from(UserAlbumRank).where(UserAlbumRank.album_id == aid)
    )}


@router.delete("/{aid}", status_code=204)
def delete_album(aid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database)):
    db.delete(_album(db, ctx, aid))


@router.put("/{aid}/artists/{artist_id}", status_code=204)
def link_artist(aid: int, artist_id: int, ctx: GuildContext = Depends(EDIT),
                db: DbSession = Depends(get_database)):
    _album(db, ctx, aid)
    artist = db.get(Artist, artist_id)
    if artist is None or artist.guild_id != ctx.guild_id:
        raise HTTPException(404, "Artist not found")
    if not db.get(AlbumArtist, (aid, artist_id)):
        db.add(AlbumArtist(album_id=aid, artist_id=artist_id, guild_id=ctx.guild_id))


@router.delete("/{aid}/artists/{artist_id}", status_code=204)
def unlink_artist(aid: int, artist_id: int, ctx: GuildContext = Depends(EDIT),
                  db: DbSession = Depends(get_database)):
    link = db.get(AlbumArtist, (aid, artist_id))
    if link:
        db.delete(link)
    # The album is no longer in this artist's ranked list, so every member's
    # (artist, album) rank row and every pairwise answer about it are meaningless.
    for row in db.scalars(
        select(UserAlbumRank).where(UserAlbumRank.artist_id == artist_id, UserAlbumRank.album_id == aid)
    ).all():
        db.delete(row)


@router.get("/{aid}/genres", response_model=list[dict])
def album_genres(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return [{"id": g.id, "name": g.name} for g in sorted(_album(db, ctx, aid).genres, key=lambda g: g.name)]


@router.put("/{aid}/genres/{gid}", status_code=204)
def add_genre(aid: int, gid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    album = _album(db, ctx, aid)
    genre = db.get(Genre, gid)
    if genre is None or genre.guild_id != ctx.guild_id:
        raise HTTPException(404, "Genre not found")
    if not genre.is_music:
        raise HTTPException(422, "Genre is not applicable to music")
    if genre not in album.genres:
        link_guild_scoped(db, album, Album.genres, genre, guild_id=ctx.guild_id)


@router.delete("/{aid}/genres/{gid}", status_code=204)
def remove_genre(aid: int, gid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    album = _album(db, ctx, aid)
    genre = db.get(Genre, gid)
    if genre is not None and genre in album.genres:
        album.genres.remove(genre)
