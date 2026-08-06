from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..api_models import (
    AlbumIn,
    AlbumIndex,
    AlbumOut,
    AlbumPatch,
    ArtistOut,
    LinkBody,
    MusicGenreOut,
    PositionBody,
)
from ..api_models.album import AlbumArtistRef
from ..database import get_database
from ..database_models import (
    Album,
    AlbumArtist,
    AlbumComparison,
    Game,
    Genre,
    Movie,
    TelevisionShow,
)
from ..ranking import rank_at

router = APIRouter(prefix="/albums", tags=["albums"])


@router.get("", response_model=list[AlbumIndex])
def list_albums(db: Session = Depends(get_database)):
    """Return all albums with their artist_ids and genre_ids for client-side search/cache."""
    albums = db.scalars(select(Album)).all()
    result = []
    for album in albums:
        result.append(
            AlbumIndex(
                id=album.id,
                name=album.name,
                name_en=album.name_en,
                artist_ids=[link.artist_id for link in album.artist_links],
                genre_ids=[g.id for g in album.genres],
            )
        )
    return result


def _get(db: Session, aid: int) -> Album:
    if a := db.get(Album, aid):
        return a
    raise HTTPException(404, "Album not found")


def _shape(album: Album) -> Album:
    """Populate the virtual (non-column) fields ``AlbumOut`` expects. Without
    this they silently fall back to their `[]` defaults."""
    album.artists = [
        AlbumArtistRef(
            id=link.artist.id,
            name=link.artist.name,
            name_en=link.artist.name_en,
            discography_link=link.artist.discography_link,
        )
        for link in album.artist_links
    ]
    album.genre_ids = [g.id for g in album.genres]
    return album


@router.get("/{aid}", response_model=AlbumOut)
def get_album(aid: int, db: Session = Depends(get_database)):
    return _shape(_get(db, aid))


@router.post("", response_model=AlbumOut, status_code=201)
def create_album(body: AlbumIn, db: Session = Depends(get_database)):
    data = body.model_dump()
    data["runtime"] = timedelta(seconds=data.pop("runtime_seconds"))
    album = Album(**data)
    db.add(album)
    db.flush()
    return _shape(album)


@router.patch("/{aid}", response_model=AlbumOut)
def update_album(aid: int, body: AlbumPatch, db: Session = Depends(get_database)):
    album = _get(db, aid)
    data = body.model_dump(exclude_unset=True)
    if "runtime_seconds" in data:
        album.runtime = timedelta(seconds=data.pop("runtime_seconds"))
    for k, v in data.items():
        setattr(album, k, v)
    return _shape(album)


@router.get("/{aid}/artists", response_model=list[ArtistOut])
def album_artists(aid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    return [link.artist for link in album.artist_links]


@router.delete("/{aid}", status_code=204)
def delete_album(aid: int, db: Session = Depends(get_database)):
    db.delete(_get(db, aid))


@router.put("/{aid}/artists/{artist_id}", status_code=204)
def link_artist(
    aid: int,
    artist_id: int,
    body: LinkBody | None = None,
    db: Session = Depends(get_database),
):
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
    # The album is no longer part of this artist's ranked list, so any question
    # the user answered about it inside that list is meaningless. (Deleting the
    # album itself is handled by the FK cascade.)
    stale = db.scalars(
        select(AlbumComparison).where(
            AlbumComparison.artist_id == artist_id,
            or_(AlbumComparison.winner_id == aid, AlbumComparison.loser_id == aid),
        )
    ).all()
    for row in stale:
        db.delete(row)


@router.put("/{aid}/artists/{artist_id}/position", status_code=204)
def move_album(aid: int, artist_id: int, body: PositionBody, db: Session = Depends(get_database)):
    link = db.get(AlbumArtist, (aid, artist_id))
    if not link:
        raise HTTPException(404, "Album not linked to artist")
    link.album_rank = _rank_at(db, artist_id, body.position, exclude=aid)


@router.get("/{aid}/genres", response_model=list[MusicGenreOut])
def album_genres(aid: int, db: Session = Depends(get_database)):
    return sorted(_get(db, aid).genres, key=lambda g: g.name)


@router.put("/{aid}/genres/{gid}", status_code=204)
def add_genre(aid: int, gid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    genre = db.get(Genre, gid)
    if not genre:
        raise HTTPException(404, "Genre not found")
    if not genre.is_music:
        raise HTTPException(422, "Genre is not applicable to music")
    if genre not in album.genres:
        album.genres.append(genre)


@router.delete("/{aid}/genres/{gid}", status_code=204)
def remove_genre(aid: int, gid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    if (genre := db.get(Genre, gid)) and genre in album.genres:
        album.genres.remove(genre)


# ── Soundtrack links ───────────────────────────────────────────────────────────


@router.put("/{aid}/soundtrack/{mid}", status_code=204)
def link_soundtrack(aid: int, mid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    movie = db.get(Movie, mid)
    if not movie:
        raise HTTPException(404, "Movie not found")
    if movie not in album.soundtrack_movies:
        album.soundtrack_movies.append(movie)


@router.delete("/{aid}/soundtrack/{mid}", status_code=204)
def unlink_soundtrack(aid: int, mid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    movie = db.get(Movie, mid)
    if movie and movie in album.soundtrack_movies:
        album.soundtrack_movies.remove(movie)


@router.put("/{aid}/soundtrack-games/{gid}", status_code=204)
def link_soundtrack_game(aid: int, gid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    game = db.get(Game, gid)
    if not game:
        raise HTTPException(404, "Game not found")
    if game not in album.soundtrack_games:
        album.soundtrack_games.append(game)


@router.delete("/{aid}/soundtrack-games/{gid}", status_code=204)
def unlink_soundtrack_game(aid: int, gid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    game = db.get(Game, gid)
    if game and game in album.soundtrack_games:
        album.soundtrack_games.remove(game)


@router.put("/{aid}/soundtrack-television/{sid}", status_code=204)
def link_soundtrack_television_show(aid: int, sid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    show = db.get(TelevisionShow, sid)
    if not show:
        raise HTTPException(404, "Television show not found")
    if show not in album.soundtrack_television_shows:
        album.soundtrack_television_shows.append(show)


@router.delete("/{aid}/soundtrack-television/{sid}", status_code=204)
def unlink_soundtrack_television_show(aid: int, sid: int, db: Session = Depends(get_database)):
    album = _get(db, aid)
    show = db.get(TelevisionShow, sid)
    if show and show in album.soundtrack_television_shows:
        album.soundtrack_television_shows.remove(show)


def _rank_at(db: Session, artist_id: int, position: int | None, exclude: int | None) -> Decimal:
    return rank_at(
        db,
        AlbumArtist.album_rank,
        position,
        exclude_col=AlbumArtist.album_id,
        exclude=exclude,
        scope=AlbumArtist.artist_id == artist_id,
    )
