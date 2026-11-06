from __future__ import annotations

from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session as DbSession

from ..api_models.music import AlbumIn, AlbumOut, AlbumPatch, NamedRef
from ..authz import Capability
from ..database import get_database
from ..database_models import (
    Album, AlbumArtist, AlbumComparison, AlbumLink, Artist, Game, Genre, Movie, TelevisionShow, UserAlbumRank,
)
from ..deps import GuildContext, guild_ctx
from ..guild_junction_helpers import link_guild_scoped
from ..ranking import next_rank
from .. import loading
from .links import make_links_router

router = APIRouter(prefix="/guilds/{guild_id}/albums", tags=["albums"])
VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)

links_router = make_links_router(
    owner_model=Album, link_model=AlbumLink, owner_fk="album_id", prefix="/albums", tag="albums"
)

SoundtrackKind = Literal["movie", "game", "television_show"]
# kind -> (scored media model, Album relationship)
_SOUNDTRACKS = {
    "movie": (Movie, Album.soundtrack_movies),
    "game": (Game, Album.soundtrack_games),
    "television_show": (TelevisionShow, Album.soundtrack_television_shows),
}


def _album(db: DbSession, ctx: GuildContext, aid: int) -> Album:
    a = loading.get(db, Album, aid, loading.ALBUM)
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
def list_albums(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    rows = db.scalars(select(Album).where(Album.guild_id == ctx.guild_id).order_by(Album.name).options(*loading.ALBUM)).all()
    return [_out(a) for a in rows]


@router.post("", response_model=AlbumOut, status_code=201)
def create_album(body: AlbumIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database, scope="function")):
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
def get_album(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return _out(_album(db, ctx, aid))


@router.patch("/{aid}", response_model=AlbumOut)
def update_album(aid: int, body: AlbumPatch, ctx: GuildContext = Depends(EDIT),
                 db: DbSession = Depends(get_database, scope="function")):
    album = _album(db, ctx, aid)
    data = body.model_dump(exclude_unset=True)
    if "runtime_seconds" in data:
        album.runtime = timedelta(seconds=data.pop("runtime_seconds"))
    for k, v in data.items():
        setattr(album, k, v)
    album.updated_by_user_id = ctx.user_id
    return _out(album)


@router.get("/{aid}/impact")
def delete_impact(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    _album(db, ctx, aid)
    return {"rankings_destroyed": db.scalar(
        select(func.count()).select_from(UserAlbumRank).where(UserAlbumRank.album_id == aid)
    )}


@router.delete("/{aid}", status_code=204)
def delete_album(aid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database, scope="function")):
    db.delete(_album(db, ctx, aid))


@router.put("/{aid}/artists/{artist_id}", status_code=204)
def link_artist(aid: int, artist_id: int, ctx: GuildContext = Depends(EDIT),
                db: DbSession = Depends(get_database, scope="function")):
    _album(db, ctx, aid)
    artist = db.get(Artist, artist_id)
    if artist is None or artist.guild_id != ctx.guild_id:
        raise HTTPException(404, "Artist not found")
    if not db.get(AlbumArtist, (aid, artist_id)):
        db.add(AlbumArtist(album_id=aid, artist_id=artist_id, guild_id=ctx.guild_id))
        _carry_ranks_to_artist(db, ctx.guild_id, aid, artist_id)


def _carry_ranks_to_artist(db: DbSession, guild_id: int, aid: int, artist_id: int) -> None:
    """Every member who already has this album in their list under a co-credited
    artist gets it appended to their list for the newly linked artist too — having
    listened to the album doesn't depend on which artist's discography you file it under."""
    listens = dict(db.execute(
        select(UserAlbumRank.user_id, func.max(UserAlbumRank.listens))
        .where(UserAlbumRank.guild_id == guild_id, UserAlbumRank.album_id == aid,
               UserAlbumRank.artist_id != artist_id)
        .group_by(UserAlbumRank.user_id)
    ).all())
    for user_id, n in listens.items():
        if db.get(UserAlbumRank, {"user_id": user_id, "artist_id": artist_id, "album_id": aid}):
            continue
        db.add(UserAlbumRank(
            user_id=user_id, guild_id=guild_id, artist_id=artist_id, album_id=aid, listens=n,
            rank=next_rank(db, UserAlbumRank, user_id=user_id, guild_id=guild_id,
                           scope=UserAlbumRank.artist_id == artist_id),
        ))


@router.delete("/{aid}/artists/{artist_id}", status_code=204)
def unlink_artist(aid: int, artist_id: int, ctx: GuildContext = Depends(EDIT),
                  db: DbSession = Depends(get_database, scope="function")):
    _album(db, ctx, aid)
    link = db.get(AlbumArtist, (aid, artist_id))
    if link:
        db.delete(link)
    # The album is no longer in this artist's ranked list, so every member's
    # (artist, album) rank row and every pairwise answer about it are meaningless.
    db.execute(delete(UserAlbumRank).where(
        UserAlbumRank.guild_id == ctx.guild_id, UserAlbumRank.artist_id == artist_id, UserAlbumRank.album_id == aid,
    ))
    db.execute(delete(AlbumComparison).where(
        AlbumComparison.guild_id == ctx.guild_id, AlbumComparison.artist_id == artist_id,
        or_(AlbumComparison.winner_id == aid, AlbumComparison.loser_id == aid),
    ))


@router.get("/{aid}/genres", response_model=list[dict])
def album_genres(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return [{"id": g.id, "name": g.name} for g in sorted(_album(db, ctx, aid).genres, key=lambda g: g.name)]


@router.put("/{aid}/genres/{gid}", status_code=204)
def add_genre(aid: int, gid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    album = _album(db, ctx, aid)
    genre = db.get(Genre, gid)
    if genre is None or genre.guild_id != ctx.guild_id:
        raise HTTPException(404, "Genre not found")
    if not genre.is_music:
        raise HTTPException(422, "Genre is not applicable to music")
    if genre not in album.genres:
        link_guild_scoped(db, album, Album.genres, genre, guild_id=ctx.guild_id)


@router.delete("/{aid}/genres/{gid}", status_code=204)
def remove_genre(aid: int, gid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    album = _album(db, ctx, aid)
    genre = db.get(Genre, gid)
    if genre is not None and genre in album.genres:
        album.genres.remove(genre)


# ── soundtracks: the movies / games / TV shows this album scores ─────────────
@router.put("/{aid}/soundtracks/{kind}/{target_id}", status_code=204)
def link_soundtrack(aid: int, kind: SoundtrackKind, target_id: int, ctx: GuildContext = Depends(EDIT),
                    db: DbSession = Depends(get_database, scope="function")):
    album = _album(db, ctx, aid)
    model, rel = _SOUNDTRACKS[kind]
    target = db.get(model, target_id)
    if target is None or target.guild_id != ctx.guild_id:
        raise HTTPException(404, f"{model.__name__} not found")
    if target not in getattr(album, rel.key):
        link_guild_scoped(db, album, rel, target, guild_id=ctx.guild_id)


@router.delete("/{aid}/soundtracks/{kind}/{target_id}", status_code=204)
def unlink_soundtrack(aid: int, kind: SoundtrackKind, target_id: int, ctx: GuildContext = Depends(EDIT),
                      db: DbSession = Depends(get_database, scope="function")):
    album = _album(db, ctx, aid)
    model, rel = _SOUNDTRACKS[kind]
    target = db.get(model, target_id)
    if target is not None and target in getattr(album, rel.key):
        getattr(album, rel.key).remove(target)
