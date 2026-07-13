"""Factory for the genre CRUD/tree router.

The music-genre and movie-genre features are identical apart from the ORM
model, its self-referential junction table, the API prefix/tag, and the
not-found message. ``make_genre_router`` closes over those and returns a fully
wired ``APIRouter`` so both features share one implementation.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_database


def make_genre_router(
    *,
    model,
    junction,
    in_schema,
    patch_schema,
    out_schema,
    prefix: str,
    tag: str,
    not_found: str,
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])

    def _get(db: Session, gid: int):
        if g := db.get(model, gid):
            return g
        raise HTTPException(404, not_found)

    @router.get("", response_model=list[out_schema])
    def list_genres(db: Session = Depends(get_database)):
        genres = db.scalars(select(model).order_by(model.name)).all()
        for g in genres:
            g.parent_ids = [p.id for p in g.parents]
        return genres

    @router.get("/roots", response_model=list[out_schema])
    def list_root_genres(db: Session = Depends(get_database)):
        """Genres that have no parent genres (top-level categories)."""
        has_parent = select(junction.c.genre_id)
        return db.scalars(select(model).where(model.id.not_in(has_parent)).order_by(model.name)).all()

    @router.get("/{gid}", response_model=out_schema)
    def get_genre(gid: int, db: Session = Depends(get_database)):
        return _get(db, gid)

    @router.post("", response_model=out_schema, status_code=201)
    def create_genre(body: in_schema, db: Session = Depends(get_database)):
        genre = model(**body.model_dump())
        db.add(genre)
        db.flush()
        return genre

    @router.patch("/{gid}", response_model=out_schema)
    def update_genre(gid: int, body: patch_schema, db: Session = Depends(get_database)):
        genre = _get(db, gid)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(genre, k, v)
        return genre

    @router.delete("/{gid}", status_code=204)
    def delete_genre(gid: int, db: Session = Depends(get_database)):
        db.delete(_get(db, gid))

    @router.get("/{gid}/parents", response_model=list[out_schema])
    def get_parents(gid: int, db: Session = Depends(get_database)):
        return sorted(_get(db, gid).parents, key=lambda g: g.name)

    @router.get("/{gid}/children", response_model=list[out_schema])
    def get_children(gid: int, db: Session = Depends(get_database)):
        return sorted(_get(db, gid).children, key=lambda g: g.name)

    @router.get("/{gid}/descendants", response_model=list[out_schema])
    def get_descendants(gid: int, db: Session = Depends(get_database)):
        """All genres reachable downward from this one (breadth-first, deduplicated)."""
        visited: set[int] = set()
        queue = list(_get(db, gid).children)
        result = []
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
        if (parent := db.get(model, pid)) and parent in genre.parents:
            genre.parents.remove(parent)

    return router
