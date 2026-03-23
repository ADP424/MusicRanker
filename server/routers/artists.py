from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..api_models import AlbumOut, ArtistIn, ArtistOut, ArtistPatch, PositionBody
from ..database import get_database
from ..database_models import Album, AlbumArtist, Artist
from ..ranking import rank_between

router = APIRouter(prefix="/artists", tags=["artists"])


def _get(db: Session, aid: int) -> Artist:
    if a := db.get(Artist, aid):
        return a
    raise HTTPException(404, "Artist not found")


def _attach_position(db: Session, artist: Artist) -> Artist:
    artist.position = 1 + db.scalar(
        select(func.count()).select_from(Artist).where(Artist.global_rank < artist.global_rank)
    )
    return artist


@router.get("", response_model=list[ArtistOut])
def list_artists(db: Session = Depends(get_database)):
    rows = db.scalars(select(Artist).order_by(Artist.global_rank)).all()
    for i, a in enumerate(rows, start=1):
        a.position = i
    return rows


@router.get("/{aid}", response_model=ArtistOut)
def get_artist(aid: int, db: Session = Depends(get_database)):
    return _attach_position(db, _get(db, aid))


@router.post("", response_model=ArtistOut, status_code=201)
def create_artist(body: ArtistIn, db: Session = Depends(get_database)):
    rank = _rank_at(db, body.position, exclude=None)
    artist = Artist(**body.model_dump(exclude={"position"}), global_rank=rank)
    db.add(artist)
    db.flush()
    return _attach_position(db, artist)


@router.patch("/{aid}", response_model=ArtistOut)
def update_artist(aid: int, body: ArtistPatch, db: Session = Depends(get_database)):
    artist = _get(db, aid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(artist, k, v)
    return _attach_position(db, artist)


@router.delete("/{aid}", status_code=204)
def delete_artist(aid: int, db: Session = Depends(get_database)):
    db.delete(_get(db, aid))


@router.put("/{aid}/position", response_model=ArtistOut)
def move_artist(aid: int, body: PositionBody, db: Session = Depends(get_database)):
    artist = _get(db, aid)
    artist.global_rank = _rank_at(db, body.position, exclude=aid)
    db.flush()
    return _attach_position(db, artist)


@router.get("/{aid}/albums", response_model=list[AlbumOut])
def artist_albums(aid: int, db: Session = Depends(get_database)):
    stmt = (
        select(Album, AlbumArtist.album_rank)
        .join(AlbumArtist)
        .where(AlbumArtist.artist_id == aid)
        .order_by(AlbumArtist.album_rank)
    )
    out = []
    for i, (album, rank) in enumerate(db.execute(stmt), start=1):
        album.album_rank, album.position = rank, i
        out.append(album)
    return out


def _rank_at(db: Session, position: int | None, exclude: int | None) -> Decimal:
    base = select(Artist.global_rank)
    if exclude is not None:
        base = base.where(Artist.id != exclude)

    if position is None:
        return rank_between(db.scalar(select(func.max(base.subquery().c.global_rank))), None)

    ranked = base.add_columns(func.row_number().over(order_by=Artist.global_rank).label("pos")).subquery()
    prev = db.scalar(select(ranked.c.global_rank).where(ranked.c.pos == position - 1))
    nxt = db.scalar(select(ranked.c.global_rank).where(ranked.c.pos == position))
    return rank_between(prev, nxt)
