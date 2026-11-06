"""Helpers shared by the stats routers."""
from __future__ import annotations

import functools
from collections import defaultdict
from typing import Callable

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database_models.genre_parent import genre_parents


def genre_ancestors(db: Session, guild_id: int) -> dict[int, set[int]]:
    """genre id -> every ancestor id, for one guild's (possibly cyclic) genre graph."""
    rows = db.execute(
        select(genre_parents.c.genre_id, genre_parents.c.parent_genre_id).where(genre_parents.c.guild_id == guild_id)
    ).all()
    parent_of: dict[int, set[int]] = defaultdict(set)
    for child_id, parent_id in rows:
        parent_of[child_id].add(parent_id)

    ancestors: dict[int, set[int]] = {}
    for gid in {g for g, _ in rows} | {p for _, p in rows}:
        seen: set[int] = set()
        queue = list(parent_of.get(gid, ()))
        while queue:
            pid = queue.pop()
            if pid not in seen:
                seen.add(pid)
                queue.extend(parent_of.get(pid, ()))
        ancestors[gid] = seen
    return ancestors


def percentile(pos: int, n: int) -> float:
    """A position as a share of the list: (n - pos + 0.5) / n. #1 of 10 is 0.95,
    #10 of 10 is 0.05. Lists of different lengths score on the same 0..1 scale
    (so two members compare fairly), and it never reaches 0, so nested scores
    (album within artist, episode within season within show) can be multiplied."""
    return (n - pos + 0.5) / n if n else 0.0


def session_cached(load):
    """Memoises a stats router's `_load(db, ctx, uid)` for the request's session,
    so `/all` (which calls every section) reads the member's list once."""
    @functools.wraps(load)
    def wrapper(db: Session, ctx, uid: int):
        cache = db.info.setdefault("stats_load", {})
        key = (load.__module__, ctx.guild_id, uid)
        if key not in cache:
            cache[key] = load(db, ctx, uid)
        return cache[key]
    return wrapper


def add_all_route(router: APIRouter, view, sections: dict[str, Callable]) -> None:
    """`GET /all`: every section of a stats page in one response, keyed by name."""
    from .database import get_database
    from .deps import GuildContext

    @router.get("/all")
    def all_sections(user_id: int | None = Query(None), ctx: GuildContext = Depends(view),
                     db: Session = Depends(get_database, scope="function")):
        return {name: fn(user_id=user_id, ctx=ctx, db=db) for name, fn in sections.items()}
