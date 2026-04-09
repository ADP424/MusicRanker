from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..api_models import (
    MovieGenreOut,
    MovieIn,
    MovieIndex,
    MovieOut,
    MoviePatch,
    MoviePersonRef,
    PositionBody,
)
from ..api_models.movie import MovieSoundtrackAlbumRef
from ..database import get_database
from ..database_models import Album, Movie, MovieGenre, MoviePerson, Person
from ..database_models.movie_cast_member import CastRole
from ..ranking import rank_between

router = APIRouter(prefix="/movies", tags=["movies"])

ROLE_ORDER = [CastRole.director, CastRole.composer, CastRole.actor, CastRole.lead_actor]


def _get(db: Session, mid: int) -> Movie:
    if m := db.get(Movie, mid):
        return m
    raise HTTPException(404, "Movie not found")


def _attach_persons(movie: Movie) -> list[MoviePersonRef]:
    refs = [
        MoviePersonRef(
            id=link.person.id,
            name=link.person.name,
            role=link.role,
        )
        for link in movie.person_links
    ]
    refs.sort(key=lambda r: (ROLE_ORDER.index(r.role) if r.role in ROLE_ORDER else 99, r.name))
    return refs


def _attach_soundtracks(movie: Movie) -> list[MovieSoundtrackAlbumRef]:
    return [
        MovieSoundtrackAlbumRef(
            id=album.id,
            name=album.name,
            artist_ids=[link.artist_id for link in album.artist_links],
        )
        for album in movie.soundtrack_albums
    ]


def _attach_position(db: Session, movie: Movie) -> Movie:
    movie.position = 1 + db.scalar(select(func.count()).select_from(Movie).where(Movie.global_rank < movie.global_rank))
    movie.persons = _attach_persons(movie)
    movie.genre_ids = [g.id for g in movie.genres]
    movie.soundtrack_album_refs = _attach_soundtracks(movie)
    return movie


@router.get("", response_model=list[MovieIndex])
def list_movies(db: Session = Depends(get_database)):
    movies = db.scalars(select(Movie)).all()
    result = []
    for movie in movies:
        result.append(
            MovieIndex(
                id=movie.id,
                name=movie.name,
                person_ids=[link.person_id for link in movie.person_links],
                genre_ids=[g.id for g in movie.genres],
            )
        )
    return result


@router.get("/ranked", response_model=list[MovieOut], response_model_by_alias=True)
def list_movies_ranked(db: Session = Depends(get_database)):
    rows = db.scalars(select(Movie).order_by(Movie.global_rank)).all()
    result = []
    for i, movie in enumerate(rows, start=1):
        movie.position = i
        movie.persons = _attach_persons(movie)
        movie.genre_ids = [g.id for g in movie.genres]
        movie.soundtrack_album_refs = _attach_soundtracks(movie)
        result.append(movie)
    return result


@router.get("/{mid}", response_model=MovieOut, response_model_by_alias=True)
def get_movie(mid: int, db: Session = Depends(get_database)):
    movie = _get(db, mid)
    movie.persons = _attach_persons(movie)
    movie.genre_ids = [g.id for g in movie.genres]
    movie.soundtrack_album_refs = _attach_soundtracks(movie)
    if movie.global_rank is not None:
        movie.position = 1 + db.scalar(
            select(func.count()).select_from(Movie).where(Movie.global_rank < movie.global_rank)
        )
    return movie


@router.post("", response_model=MovieOut, status_code=201, response_model_by_alias=True)
def create_movie(body: MovieIn, db: Session = Depends(get_database)):
    rank = _rank_at(db, body.position, exclude=None)
    movie = Movie(**body.model_dump(exclude={"position"}), global_rank=rank)
    db.add(movie)
    db.flush()
    movie.persons = []
    movie.genre_ids = []
    movie.soundtrack_album_refs = []
    if movie.global_rank is not None:
        movie.position = 1 + db.scalar(
            select(func.count()).select_from(Movie).where(Movie.global_rank < movie.global_rank)
        )
    return movie


@router.patch("/{mid}", response_model=MovieOut, response_model_by_alias=True)
def update_movie(mid: int, body: MoviePatch, db: Session = Depends(get_database)):
    movie = _get(db, mid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(movie, k, v)
    movie.persons = _attach_persons(movie)
    movie.genre_ids = [g.id for g in movie.genres]
    movie.soundtrack_album_refs = _attach_soundtracks(movie)
    return movie


@router.delete("/{mid}", status_code=204)
def delete_movie(mid: int, db: Session = Depends(get_database)):
    db.delete(_get(db, mid))


@router.put("/{mid}/position", response_model=MovieOut, response_model_by_alias=True)
def move_movie(mid: int, body: PositionBody, db: Session = Depends(get_database)):
    movie = _get(db, mid)
    movie.global_rank = _rank_at(db, body.position, exclude=mid)
    db.flush()
    return _attach_position(db, movie)


# ── Person links ───────────────────────────────────────────────────────────────


@router.put("/{mid}/persons/{person_id}/{role}", status_code=204)
def link_person(
    mid: int,
    person_id: int,
    role: CastRole,
    db: Session = Depends(get_database),
):
    _get(db, mid)
    if not db.get(Person, person_id):
        raise HTTPException(404, "Person not found")
    existing = db.get(MoviePerson, (mid, person_id, role))
    if not existing:
        db.add(MoviePerson(movie_id=mid, person_id=person_id, role=role))


@router.delete("/{mid}/persons/{person_id}/{role}", status_code=204)
def unlink_person(
    mid: int,
    person_id: int,
    role: CastRole,
    db: Session = Depends(get_database),
):
    if link := db.get(MoviePerson, (mid, person_id, role)):
        db.delete(link)


# ── Genre links ────────────────────────────────────────────────────────────────


@router.get("/{mid}/genres", response_model=list[MovieGenreOut])
def movie_genre_list(mid: int, db: Session = Depends(get_database)):
    return sorted(_get(db, mid).genres, key=lambda g: g.name)


@router.put("/{mid}/genres/{gid}", status_code=204)
def add_genre(mid: int, gid: int, db: Session = Depends(get_database)):
    movie = _get(db, mid)
    genre = db.get(MovieGenre, gid)
    if not genre:
        raise HTTPException(404, "Movie genre not found")
    if genre not in movie.genres:
        movie.genres.append(genre)


@router.delete("/{mid}/genres/{gid}", status_code=204)
def remove_genre(mid: int, gid: int, db: Session = Depends(get_database)):
    movie = _get(db, mid)
    if (genre := db.get(MovieGenre, gid)) and genre in movie.genres:
        movie.genres.remove(genre)


# ── Soundtrack links ───────────────────────────────────────────────────────────


@router.put("/{mid}/soundtrack/{aid}", status_code=204)
def link_soundtrack(mid: int, aid: int, db: Session = Depends(get_database)):
    movie = _get(db, mid)
    album = db.get(Album, aid)
    if not album:
        raise HTTPException(404, "Album not found")
    if album not in movie.soundtrack_albums:
        movie.soundtrack_albums.append(album)


@router.delete("/{mid}/soundtrack/{aid}", status_code=204)
def unlink_soundtrack(mid: int, aid: int, db: Session = Depends(get_database)):
    movie = _get(db, mid)
    album = db.get(Album, aid)
    if album and album in movie.soundtrack_albums:
        movie.soundtrack_albums.remove(album)


# ── Ranking helper ─────────────────────────────────────────────────────────────


def _rank_at(db: Session, position: int | None, exclude: int | None) -> Decimal:
    base = select(Movie.global_rank)
    if exclude is not None:
        base = base.where(Movie.id != exclude)

    if position is None:
        return rank_between(db.scalar(select(func.max(base.subquery().c.global_rank))), None)

    ranked = base.add_columns(func.row_number().over(order_by=Movie.global_rank).label("pos")).subquery()
    prev = db.scalar(select(ranked.c.global_rank).where(ranked.c.pos == position - 1))
    nxt = db.scalar(select(ranked.c.global_rank).where(ranked.c.pos == position))
    return rank_between(prev, nxt)
