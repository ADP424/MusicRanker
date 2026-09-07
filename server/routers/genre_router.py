"""Factories for the guild-scoped genre CRUD/tree router and its category router.

One factory serves music, movie, game and television genres (all rows of the
shared `genres` table, distinguished by `is_*` flags) plus game platforms (their
own table). Everything is scoped to a guild and gated on capabilities; the
parent/child tree keeps the cycle guard.

Deliberately no `from __future__ import annotations` here: these routes are
defined inside a factory function and annotated with parameters captured from
the *enclosing closure* (`in_schema`, `patch_schema`, `out_schema` — not
module globals). Under postponed evaluation those annotations become plain
strings that FastAPI's `get_type_hints()` can't resolve against the function's
`__globals__` (the closure variable isn't in there), so it silently treats
`body: in_schema` as un-annotated and routes it to query params instead of the
JSON body — every POST/PATCH here would 422 with "field required" for `body`
in the query. Real annotations (evaluated eagerly) don't have this problem.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..authz import Capability
from ..database import get_database
from ..deps import GuildContext, guild_ctx
from ..guild_junction_helpers import link_guild_scoped


def _cycle_path(start, target) -> list | None:
    """Walk *up* `start`'s parent links looking for `target`, breadth-first.

    Returns `[start, …, target]` when `target` is already an ancestor of `start`,
    else None. `seen` doubles as protection against data that is already cyclical,
    so the guard can never itself hang.
    """
    seen = {start.id}
    queue: list[list] = [[start]]
    while queue:
        path = queue.pop(0)
        node = path[-1]
        if node.id == target.id:
            return path
        for parent in node.parents:
            if parent.id in seen:
                continue
            seen.add(parent.id)
            queue.append([*path, parent])
    return None


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
    router = APIRouter(prefix=f"/guilds/{{guild_id}}{prefix}", tags=[tag])

    VIEW = guild_ctx(Capability.VIEW)
    CREATE = guild_ctx(Capability.CATALOG_CREATE)
    EDIT = guild_ctx(Capability.CATALOG_EDIT)
    DELETE = guild_ctx(Capability.CATALOG_DELETE)

    def _get(db: Session, ctx: GuildContext, gid: int):
        row = db.get(model, gid)
        if row is None or row.guild_id != ctx.guild_id:
            raise HTTPException(404, not_found)
        return row

    def _get_category(db: Session, ctx: GuildContext, cid: int):
        cat = db.get(category_model, cid)
        if cat is None or cat.guild_id != ctx.guild_id:
            raise HTTPException(404, "Category not found")
        return cat

    def _categories(row):
        return getattr(row, category_junction_attr)

    def _in_domain(row) -> bool:
        return media_flag is None or bool(getattr(row, media_flag))

    def _with_refs(row):
        row.parent_ids = [p.id for p in row.parents]
        row.category_ids = [c.id for c in _categories(row)]
        return row

    # ── Literal paths must precede /{gid} ────────────────────────────────────
    @router.get("", response_model=list[out_schema])
    def list_genres(ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
        stmt = select(model).where(model.guild_id == ctx.guild_id).order_by(model.name)
        if media_flag is not None:
            stmt = stmt.where(getattr(model, media_flag).is_(True))
        return [_with_refs(g) for g in db.scalars(stmt).all()]

    @router.get("/roots", response_model=list[out_schema])
    def list_root_genres(ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
        stmt = select(model).where(model.guild_id == ctx.guild_id, ~model.parents.any()).order_by(model.name)
        if media_flag is not None:
            stmt = stmt.where(getattr(model, media_flag).is_(True))
        return [_with_refs(g) for g in db.scalars(stmt).all()]

    @router.post("", response_model=out_schema, status_code=201)
    def create_genre(body: in_schema, ctx: GuildContext = Depends(CREATE), db: Session = Depends(get_database)):
        data = body.model_dump()
        if media_flag is not None:
            data[media_flag] = True
        row = model(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **data)
        db.add(row)
        db.flush()
        return _with_refs(row)

    @router.get("/{gid}", response_model=out_schema)
    def get_genre(gid: int, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
        return _with_refs(_get(db, ctx, gid))

    @router.patch("/{gid}", response_model=out_schema)
    def update_genre(gid: int, body: patch_schema, ctx: GuildContext = Depends(EDIT),
                     db: Session = Depends(get_database)):
        row = _get(db, ctx, gid)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(row, k, v)
        row.updated_by_user_id = ctx.user_id
        return _with_refs(row)

    @router.delete("/{gid}", status_code=204)
    def delete_genre(gid: int, ctx: GuildContext = Depends(DELETE), db: Session = Depends(get_database)):
        db.delete(_get(db, ctx, gid))

    @router.get("/{gid}/parents", response_model=list[out_schema])
    def get_parents(gid: int, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
        return [_with_refs(g) for g in sorted(_get(db, ctx, gid).parents, key=lambda g: g.name)]

    @router.get("/{gid}/children", response_model=list[out_schema])
    def get_children(gid: int, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
        return [_with_refs(g) for g in sorted(_get(db, ctx, gid).children, key=lambda g: g.name)]

    @router.get("/{gid}/descendants", response_model=list[out_schema])
    def get_descendants(gid: int, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
        """Everything reachable downward, filtered to this domain. The walk
        traverses the whole shared tree so a filtered intermediate node doesn't
        sever the chain; `visited` makes it safe on cyclical data."""
        visited: set[int] = set()
        queue = list(_get(db, ctx, gid).children)
        result = []
        while queue:
            g = queue.pop(0)
            if g.id in visited:
                continue
            visited.add(g.id)
            if _in_domain(g):
                result.append(g)
            queue.extend(g.children)
        return [_with_refs(g) for g in sorted(result, key=lambda g: g.name)]

    @router.put("/{gid}/parents/{pid}", status_code=204)
    def add_parent(gid: int, pid: int, ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database)):
        row, parent = _get(db, ctx, gid), _get(db, ctx, pid)
        if row.id == parent.id:
            raise HTTPException(422, f"'{row.name}' cannot be its own parent")
        if parent in row.parents:
            return
        loop = _cycle_path(parent, row)
        if loop is not None:
            chain = " → ".join(g.name for g in [row, *loop])
            raise HTTPException(409, f"That would create a circular parent chain: {chain}")
        link_guild_scoped(db, row, model.parents, parent, guild_id=ctx.guild_id)

    @router.delete("/{gid}/parents/{pid}", status_code=204)
    def remove_parent(gid: int, pid: int, ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database)):
        row = _get(db, ctx, gid)
        parent = db.get(model, pid)
        if parent is not None and parent in row.parents:
            row.parents.remove(parent)

    @router.put("/{gid}/categories/{cid}", status_code=204)
    def add_category(gid: int, cid: int, ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database)):
        row, cat = _get(db, ctx, gid), _get_category(db, ctx, cid)
        if cat not in _categories(row):
            link_guild_scoped(db, row, getattr(model, category_junction_attr), cat, guild_id=ctx.guild_id)

    @router.delete("/{gid}/categories/{cid}", status_code=204)
    def remove_category(gid: int, cid: int, ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database)):
        row = _get(db, ctx, gid)
        cat = db.get(category_model, cid)
        if cat is not None and cat in _categories(row):
            _categories(row).remove(cat)

    return router


def make_category_router(*, model, in_schema, patch_schema, out_schema, prefix: str, tag: str) -> APIRouter:
    router = APIRouter(prefix=f"/guilds/{{guild_id}}{prefix}", tags=[tag])
    VIEW = guild_ctx(Capability.VIEW)
    CREATE = guild_ctx(Capability.CATALOG_CREATE)
    EDIT = guild_ctx(Capability.CATALOG_EDIT)
    DELETE = guild_ctx(Capability.CATALOG_DELETE)

    def _get(db: Session, ctx: GuildContext, cid: int):
        cat = db.get(model, cid)
        if cat is None or cat.guild_id != ctx.guild_id:
            raise HTTPException(404, "Category not found")
        return cat

    @router.get("", response_model=list[out_schema])
    def list_categories(ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
        return db.scalars(select(model).where(model.guild_id == ctx.guild_id).order_by(model.name)).all()

    @router.post("", response_model=out_schema, status_code=201)
    def create_category(body: in_schema, ctx: GuildContext = Depends(CREATE), db: Session = Depends(get_database)):
        cat = model(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **body.model_dump())
        db.add(cat)
        db.flush()
        return cat

    @router.patch("/{cid}", response_model=out_schema)
    def update_category(cid: int, body: patch_schema, ctx: GuildContext = Depends(EDIT),
                        db: Session = Depends(get_database)):
        cat = _get(db, ctx, cid)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(cat, k, v)
        return cat

    @router.delete("/{cid}", status_code=204)
    def delete_category(cid: int, ctx: GuildContext = Depends(DELETE), db: Session = Depends(get_database)):
        db.delete(_get(db, ctx, cid))

    return router
