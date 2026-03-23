from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..api_models import GenreIn, GenreOut, GenrePatch
from ..database import get_database
from ..database_models import Genre

router = APIRouter(prefix="/genres", tags=["genres"])


def _get(db: Session, gid: int) -> Genre:
    if g := db.get(Genre, gid):
        return g
    raise HTTPException(404, "Genre not found")


@router.get("", response_model=list[GenreOut])
def list_genres(db: Session = Depends(get_database)):
    return db.scalars(select(Genre).order_by(Genre.name)).all()


@router.get("/{gid}", response_model=GenreOut)
def get_genre(gid: int, db: Session = Depends(get_database)):
    return _get(db, gid)


@router.post("", response_model=GenreOut, status_code=201)
def create_genre(body: GenreIn, db: Session = Depends(get_database)):
    genre = Genre(**body.model_dump())
    db.add(genre)
    db.flush()
    return genre


@router.patch("/{gid}", response_model=GenreOut)
def update_genre(gid: int, body: GenrePatch, db: Session = Depends(get_database)):
    genre = _get(db, gid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(genre, k, v)
    return genre


@router.delete("/{gid}", status_code=204)
def delete_genre(gid: int, db: Session = Depends(get_database)):
    db.delete(_get(db, gid))


@router.get("/{gid}/parents", response_model=list[GenreOut])
def get_parents(gid: int, db: Session = Depends(get_database)):
    return sorted(_get(db, gid).parents, key=lambda g: g.name)


@router.get("/{gid}/children", response_model=list[GenreOut])
def get_children(gid: int, db: Session = Depends(get_database)):
    return sorted(_get(db, gid).children, key=lambda g: g.name)


@router.put("/{gid}/parents/{pid}", status_code=204)
def add_parent(gid: int, pid: int, db: Session = Depends(get_database)):
    genre, parent = _get(db, gid), _get(db, pid)
    if parent not in genre.parents:
        genre.parents.append(parent)


@router.delete("/{gid}/parents/{pid}", status_code=204)
def remove_parent(gid: int, pid: int, db: Session = Depends(get_database)):
    genre = _get(db, gid)
    if (parent := db.get(Genre, pid)) and parent in genre.parents:
        genre.parents.remove(parent)
