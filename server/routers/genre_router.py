"""Factories for the genre CRUD/tree router and its category router.

Music, Movie, and Game genres all live in one shared ``Genre`` table/tree
(and its own three independent category tables), distinguished by the
``is_music``/``is_movie``/``is_game`` flags. Game platforms are a separate,
structurally similar but semantically distinct taxonomy with its own model.
``make_genre_router`` is parameterized by ``media_flag`` (which boolean
column scopes this domain's genre list) and ``category_junction_attr``
(which of the model's category relationships this domain uses), so the same
factory produces all four (music-genre, movie-genre, game-genre,
game-platform) routers. Game platforms pass a ``media_flag`` too, but since
``GamePlatform`` has no media-type split it's simply a column that's always
true — see ``routers/game_platforms.py``.

The parent/child tree is shared and unfiltered internally (a genre's
``parents``/``children`` may reach across media types, since a parent link
expresses pure taxonomy); only the *lists* returned to a given domain
(``list``, ``roots``, ``descendants``) are filtered down to that domain's
flagged genres.

Categories are unordered tags assignable to root (parentless) genres; a
genre's own ``category_ids`` are the categories assigned directly to it in
this domain's category junction. Non-root genres don't carry categories
themselves — callers resolve a genre's "effective" categories by walking up
to its root ancestors (see the frontend's ``GenreChooser``), so no
server-side traversal endpoint is needed for that.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_database


def make_genre_router(
    *,
    model,
    category_model,
    in_schema,
    patch_schema,
    out_schema,
    prefix: str,
    tag: str,
    not_found: str,
    category_junction_attr: str = "categories",
    media_flag: str | None = None,
) -> APIRouter:
    """``media_flag``, if given, is the boolean column (e.g. ``"is_movie"``)
    that scopes this domain's slice of a shared genre table. Leave it unset
    for taxonomies (like game platforms) that aren't split by media type."""
    router = APIRouter(prefix=prefix, tags=[tag])

    def _get(db: Session, gid: int):
        if g := db.get(model, gid):
            return g
        raise HTTPException(404, not_found)

    def _get_category(db: Session, cid: int):
        if c := db.get(category_model, cid):
            return c
        raise HTTPException(404, "Category not found")

    def _categories(genre):
        return getattr(genre, category_junction_attr)

    def _in_domain(genre) -> bool:
        return media_flag is None or bool(getattr(genre, media_flag))

    def _with_refs(genre):
        genre.parent_ids = [p.id for p in genre.parents]
        genre.category_ids = [c.id for c in _categories(genre)]
        return genre

    @router.get("", response_model=list[out_schema])
    def list_genres(db: Session = Depends(get_database)):
        stmt = select(model).order_by(model.name)
        if media_flag is not None:
            stmt = stmt.where(getattr(model, media_flag).is_(True))
        genres = db.scalars(stmt).all()
        return [_with_refs(g) for g in genres]

    @router.get("/roots", response_model=list[out_schema])
    def list_root_genres(db: Session = Depends(get_database)):
        """This domain's genres that have no parent genres (top-level entries)."""
        stmt = select(model).where(~model.parents.any()).order_by(model.name)
        if media_flag is not None:
            stmt = stmt.where(getattr(model, media_flag).is_(True))
        roots = db.scalars(stmt).all()
        return [_with_refs(g) for g in roots]

    @router.get("/{gid}", response_model=out_schema)
    def get_genre(gid: int, db: Session = Depends(get_database)):
        return _with_refs(_get(db, gid))

    @router.post("", response_model=out_schema, status_code=201)
    def create_genre(body: in_schema, db: Session = Depends(get_database)):
        data = body.model_dump()
        if media_flag is not None:
            # The domain being posted to always applies; the client may
            # additionally flag other media types up front (e.g. creating a
            # genre from the Movies section but also checking "Game"). Only
            # in_schemas with a media-type mixin (i.e. real genre domains,
            # not GamePlatform) carry these fields at all.
            data[media_flag] = True
        genre = model(**data)
        db.add(genre)
        db.flush()
        return _with_refs(genre)

    @router.patch("/{gid}", response_model=out_schema)
    def update_genre(gid: int, body: patch_schema, db: Session = Depends(get_database)):
        genre = _get(db, gid)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(genre, k, v)
        return _with_refs(genre)

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
        """All genres reachable downward from this one (breadth-first, deduplicated),
        filtered to this domain's genres — the walk itself traverses the full shared
        tree so a domain-filtered intermediate node doesn't sever the chain."""
        visited: set[int] = set()
        queue = list(_get(db, gid).children)
        result = []
        while queue:
            g = queue.pop(0)
            if g.id in visited:
                continue
            visited.add(g.id)
            if _in_domain(g):
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

    @router.put("/{gid}/categories/{cid}", status_code=204)
    def add_category(gid: int, cid: int, db: Session = Depends(get_database)):
        genre, category = _get(db, gid), _get_category(db, cid)
        if category not in _categories(genre):
            _categories(genre).append(category)

    @router.delete("/{gid}/categories/{cid}", status_code=204)
    def remove_category(gid: int, cid: int, db: Session = Depends(get_database)):
        genre = _get(db, gid)
        if (category := db.get(category_model, cid)) and category in _categories(genre):
            _categories(genre).remove(category)

    return router


def make_category_router(
    *,
    model,
    in_schema,
    patch_schema,
    out_schema,
    prefix: str,
    tag: str,
) -> APIRouter:
    """CRUD for a genre domain's (unordered, non-hierarchical) categories."""
    router = APIRouter(prefix=prefix, tags=[tag])

    def _get(db: Session, cid: int):
        if c := db.get(model, cid):
            return c
        raise HTTPException(404, "Category not found")

    @router.get("", response_model=list[out_schema])
    def list_categories(db: Session = Depends(get_database)):
        return db.scalars(select(model).order_by(model.name)).all()

    @router.post("", response_model=out_schema, status_code=201)
    def create_category(body: in_schema, db: Session = Depends(get_database)):
        category = model(**body.model_dump())
        db.add(category)
        db.flush()
        return category

    @router.patch("/{cid}", response_model=out_schema)
    def update_category(cid: int, body: patch_schema, db: Session = Depends(get_database)):
        category = _get(db, cid)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(category, k, v)
        return category

    @router.delete("/{cid}", status_code=204)
    def delete_category(cid: int, db: Session = Depends(get_database)):
        db.delete(_get(db, cid))

    return router
