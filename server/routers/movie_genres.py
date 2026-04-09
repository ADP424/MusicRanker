from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..api_models import MovieGenreIn, MovieGenreOut, MovieGenrePatch
from ..database import get_database
from ..database_models import MovieGenre, movie_genre_parents

router = APIRouter(prefix="/movie-genres", tags=["movie-genres"])


def _get(db: Session, gid: int) -> MovieGenre:
    if g := db.get(MovieGenre, gid):
        return g
    raise HTTPException(404, "Movie genre not found")


@router.get("", response_model=list[MovieGenreOut])
def list_genres(db: Session = Depends(get_database)):
    genres = db.scalars(select(MovieGenre).order_by(MovieGenre.name)).all()
    for g in genres:
        g.parent_ids = [p.id for p in g.parents]
    return genres


@router.get("/roots", response_model=list[MovieGenreOut])
def list_root_genres(db: Session = Depends(get_database)):
    has_parent = select(movie_genre_parents.c.genre_id)
    return db.scalars(select(MovieGenre).where(MovieGenre.id.not_in(has_parent)).order_by(MovieGenre.name)).all()


@router.get("/{gid}", response_model=MovieGenreOut)
def get_genre(gid: int, db: Session = Depends(get_database)):
    return _get(db, gid)


@router.post("", response_model=MovieGenreOut, status_code=201)
def create_genre(body: MovieGenreIn, db: Session = Depends(get_database)):
    genre = MovieGenre(**body.model_dump())
    db.add(genre)
    db.flush()
    return genre


@router.patch("/{gid}", response_model=MovieGenreOut)
def update_genre(gid: int, body: MovieGenrePatch, db: Session = Depends(get_database)):
    genre = _get(db, gid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(genre, k, v)
    return genre


@router.delete("/{gid}", status_code=204)
def delete_genre(gid: int, db: Session = Depends(get_database)):
    db.delete(_get(db, gid))


@router.get("/{gid}/parents", response_model=list[MovieGenreOut])
def get_parents(gid: int, db: Session = Depends(get_database)):
    return sorted(_get(db, gid).parents, key=lambda g: g.name)


@router.get("/{gid}/children", response_model=list[MovieGenreOut])
def get_children(gid: int, db: Session = Depends(get_database)):
    return sorted(_get(db, gid).children, key=lambda g: g.name)


@router.get("/{gid}/descendants", response_model=list[MovieGenreOut])
def get_descendants(gid: int, db: Session = Depends(get_database)):
    visited: set[int] = set()
    queue = list(_get(db, gid).children)
    result: list[MovieGenre] = []
    while queue:
        g = queue.pop(0)
        if g.id in visited:
            continue
        visited.add(g.id)
        result.append(g)
        queue.extend(g.children)
    return sorted(result, key=lambda g: g.name)


@router.put("/{gid}/parents/{pid}", status_code=204)
def add_parent(gid: int, pid: int, db: Session = Depends(get_database)):
    genre, parent = _get(db, gid), _get(db, pid)
    if parent not in genre.parents:
        genre.parents.append(parent)


@router.delete("/{gid}/parents/{pid}", status_code=204)
def remove_parent(gid: int, pid: int, db: Session = Depends(get_database)):
    genre = _get(db, gid)
    if (parent := db.get(MovieGenre, pid)) and parent in genre.parents:
        genre.parents.remove(parent)
