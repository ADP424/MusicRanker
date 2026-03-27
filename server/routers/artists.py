from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..api_models import AlbumOut, ArtistIn, ArtistOut, ArtistPatch, PositionBody
from ..api_models.album import AlbumArtistRef
from ..database import get_database
from ..database_models import Album, AlbumArtist, Artist
from ..database_models.genre import Genre
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


@router.get("/search", response_model=list[int])
def search_artists(
    q: str = Query(..., min_length=1),
    by: Literal["artist", "genre", "album", "all"] = Query("all"),
    db: Session = Depends(get_database),
):
    """Return artist IDs (in rank order) whose name/genre/albums match the query."""
    needle = q.strip().lower()
    matching_ids: set[int] = set()

    if by in ("artist", "all"):
        rows = db.scalars(select(Artist.id).where(Artist.name.ilike(f"%{needle}%"))).all()
        matching_ids.update(rows)

    if by in ("genre", "all"):
        from ..database_models.album_genre import album_genres as album_genres_table

        genre_ids = db.scalars(select(Genre.id).where(Genre.name.ilike(f"%{needle}%"))).all()
        if genre_ids:
            # Artists whose primary genre matches
            rows = db.scalars(select(Artist.id).where(Artist.primary_genre.in_(genre_ids))).all()
            matching_ids.update(rows)
            # Artists whose albums have a matching genre
            rows = (
                db.execute(
                    select(AlbumArtist.artist_id)
                    .join(album_genres_table, album_genres_table.c.album_id == AlbumArtist.album_id)
                    .where(album_genres_table.c.genre_id.in_(genre_ids))
                )
                .scalars()
                .all()
            )
            matching_ids.update(rows)

    if by in ("album", "all"):
        # Match artists linked to albums whose name contains the needle
        rows = (
            db.execute(
                select(AlbumArtist.artist_id)
                .join(Album, Album.id == AlbumArtist.album_id)
                .where(Album.name.ilike(f"%{needle}%"))
            )
            .scalars()
            .all()
        )
        matching_ids.update(rows)

    if not matching_ids:
        return []

    # Return IDs in global rank order
    ordered = db.scalars(select(Artist.id).where(Artist.id.in_(matching_ids)).order_by(Artist.global_rank)).all()
    return list(ordered)


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
        album.artists = [
            AlbumArtistRef(id=link.artist.id, name=link.artist.name, discography_link=link.artist.discography_link)
            for link in album.artist_links
        ]
        album.genre_ids = [g.id for g in album.genres]
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
