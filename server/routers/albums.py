from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..api_models import AlbumIn, AlbumOut, AlbumPatch, GenreOut, LinkBody, PositionBody
from ..database import get_database
from ..database_models import Album, AlbumArtist, Genre
from ..ranking import rank_between

router = APIRouter(prefix="/albums", tags=["albums"])


def _get(db: Session, aid: int) -> Album:
    if a := db.get(Album, aid):
        return a
    raise HTTPException(404, "Album not found")


@router.get("/{aid}", response_model=AlbumOut)
def get_album(aid: int, db: Session = Depends(get_database)):
    return _get(db, aid)


@router.post("", response_model=AlbumOut, status_code=201)
def create_album(body: AlbumIn, db: Session = Depends(get_database)):
    data = body.model_dump()
    data["runtime"] = timedelta(seconds=data.pop("runtime_seconds"))
    album = Album(**data)
    db.add(album)
    db.flush()
    return album


@router.patch("/{aid}", response_model=AlbumOut)
def update_album(aid: int, body: AlbumPatch, db: Session = Depends(get_database)):
    album = _get(db, aid)
    data = body.model_dump(exclude_unset=True)
    if "runtime_seconds" in data:
        album.runtime = timedelta(seconds=data.pop("runtime_seconds"))
    for k, v in data.items():
        setattr(album, k, v)
    return album


@router.delete("/{aid}", status_code=204)
def delete_album(aid: int, db: Session = Depends(get_database)):
    db.delete(_get(db, aid))


@router.put("/{aid}/artists/{artist_id}", status_code=204)
def link_artist(aid: int, artist_id: int, body: LinkBody | None = None, db: Session = Depends(get_database)):
    pos = body.position if body else None
    rank = _rank_at(db, artist_id, pos, exclude=aid)
    if link := db.get(AlbumArtist, (aid, artist_id)):
        link.album_rank = rank
    else:
        db.add(AlbumArtist(album_id=aid, artist_id=artist_id, album_rank=rank))


@router.delete("/{aid}/artists/{artist_id}", status_code=204)
def unlink_artist(aid: int, artist_id: int, db: Session = Depends(get_database)):
    if link := db.get(AlbumArtist, (aid, artist_id)):
        db.delete(link)


@router.put("/{aid}/artists/{artist_id}/position", status_code=204)
def move_album(aid: int, artist_id: int, body: PositionBody, db: Session = Depends(get_database)):
    link = db.get(AlbumArtist, (aid, artist_id))
    if not link:
        raise HTTPException(404, "Album not linked to artist")
    link.album_rank = _rank_at(db, artist_id, body.position, exclude=aid)


@router.get("/{aid}/genres", response_model=list[GenreOut])
def album_genres(aid: int, db: Session = Depends(get_database)):
    return sorted(_get(db, aid).genres, key=lambda g: g.name)


@router.put("/{aid}/genres/{gid}", status_code=204)
def add_genre(aid: int, gid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    genre = db.get(Genre, gid)
    if not genre:
        raise HTTPException(404, "Genre not found")
    if genre not in album.genres:
        album.genres.append(genre)


@router.delete("/{aid}/genres/{gid}", status_code=204)
def remove_genre(aid: int, gid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    if (genre := db.get(Genre, gid)) and genre in album.genres:
        album.genres.remove(genre)


def _rank_at(db: Session, artist_id: int, position: int | None, exclude: int | None) -> Decimal:
    base = select(AlbumArtist.album_rank).where(AlbumArtist.artist_id == artist_id)
    if exclude is not None:
        base = base.where(AlbumArtist.album_id != exclude)

    if position is None:
        return rank_between(db.scalar(select(func.max(base.subquery().c.album_rank))), None)

    ranked = base.add_columns(func.row_number().over(order_by=AlbumArtist.album_rank).label("pos")).subquery()
    prev = db.scalar(select(ranked.c.album_rank).where(ranked.c.pos == position - 1))
    nxt = db.scalar(select(ranked.c.album_rank).where(ranked.c.pos == position))
    return rank_between(prev, nxt)
