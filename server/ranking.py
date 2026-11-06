"""Rank arithmetic for the personal layer.

The UNIQUE constraint on rank is gone (ordering is `(rank, entity_id)`), so the
two-phase `apply_sequential_ranks` dance is no longer needed: a straight 1..n
write cannot collide with anything.
"""
from collections.abc import Iterable, Sequence
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session


def rank_between(prev: Decimal | None, nxt: Decimal | None) -> Decimal:
    if prev is None and nxt is None:
        return Decimal(1)
    if prev is None:
        return nxt / 2
    if nxt is None:
        return prev + 1
    return (prev + nxt) / 2


# `col` picks which order to work on: `model.rank` unless a table keeps a second
# one (episodes' show-wide `show_rank`).

def _scoped(model, user_id: int, guild_id: int, scope=None, col=None):
    col = model.rank if col is None else col
    q = select(col.label("rank")).where(model.user_id == user_id, model.guild_id == guild_id, col.is_not(None))
    return q if scope is None else q.where(scope)


def next_rank(db: Session, model, *, user_id: int, guild_id: int, scope=None, col=None) -> Decimal:
    sub = _scoped(model, user_id, guild_id, scope, col).subquery()
    return rank_between(db.scalar(select(func.max(sub.c.rank))), None)


def rank_at(db: Session, model, *, user_id: int, guild_id: int, position: int | None,
            exclude_col=None, exclude=None, scope=None, col=None) -> Decimal:
    base = _scoped(model, user_id, guild_id, scope, col)
    if exclude_col is not None and exclude is not None:
        base = base.where(exclude_col != exclude)
    if position is None:
        return rank_between(db.scalar(select(func.max(base.subquery().c.rank))), None)
    ranked = base.add_columns(func.row_number().over(order_by=model.rank if col is None else col).label("pos")).subquery()
    prev = db.scalar(select(ranked.c.rank).where(ranked.c.pos == position - 1))
    nxt = db.scalar(select(ranked.c.rank).where(ranked.c.pos == position))
    return rank_between(prev, nxt)


def check_reorder_ids(requested: Sequence[int], existing: Iterable[int]) -> None:
    existing_set, requested_set = set(existing), set(requested)
    if len(requested) != len(requested_set):
        raise HTTPException(422, "Reorder payload contains duplicate ids")
    if existing_set != requested_set:
        raise HTTPException(422, "Reorder payload must list every id in the collection exactly once")


def apply_order(db: Session, by_id: dict[int, Any], ids: Sequence[int], attr: str = "rank") -> None:
    for i, key in enumerate(ids, start=1):
        setattr(by_id[key], attr, Decimal(i))
    db.flush()
