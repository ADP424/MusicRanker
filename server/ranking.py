from collections.abc import Iterable, Sequence
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session


def rank_between(prev: Decimal | None, next: Decimal | None) -> Decimal:
    if prev is None and next is None:
        return Decimal(1)
    if prev is None:
        return next / 2
    if next is None:
        return prev + 1
    return (prev + next) / 2


def rank_at(
    db: Session,
    rank_col,
    position: int | None,
    *,
    exclude_col=None,
    exclude=None,
    scope=None,
) -> Decimal:
    """Compute the Decimal rank for inserting a row at a 1-based ``position``.

    ``rank_col`` is the ORM column holding the rank (e.g. ``Artist.global_rank``).
    ``scope`` is an optional extra WHERE clause restricting the ordered set
    (e.g. ``AlbumArtist.artist_id == artist_id``). ``exclude_col``/``exclude``
    omit the row being moved so it doesn't count as its own neighbour.
    When ``position`` is None the row is appended after the current maximum.
    """
    base = select(rank_col)
    if scope is not None:
        base = base.where(scope)
    if exclude_col is not None and exclude is not None:
        base = base.where(exclude_col != exclude)

    if position is None:
        return rank_between(db.scalar(select(func.max(base.subquery().c[0]))), None)

    ranked = base.add_columns(func.row_number().over(order_by=rank_col).label("pos")).subquery()
    prev = db.scalar(select(ranked.c[0]).where(ranked.c.pos == position - 1))
    nxt = db.scalar(select(ranked.c[0]).where(ranked.c.pos == position))
    return rank_between(prev, nxt)


# ── Bulk reorder ───────────────────────────────────────────────────────────────
# The pairwise "Rank" tabs rewrite a whole list at once. Doing that through the
# per-row /position endpoints would be O(n) round trips *and* would bisect the
# rank space n times; instead we hand the server the full permutation and lay
# the ranks back down as 1..n, which also reclaims all the fractional gaps that
# repeated drag-and-drop inserts accumulate.


def check_reorder_ids(requested: Sequence[int], existing: Iterable[int]) -> None:
    """Validate a bulk-reorder payload: it must be a permutation of ``existing``."""
    existing_set = set(existing)
    requested_set = set(requested)
    if len(requested) != len(requested_set):
        raise HTTPException(422, "Reorder payload contains duplicate ids")
    missing = existing_set - requested_set
    unknown = requested_set - existing_set
    if missing or unknown:
        raise HTTPException(
            422,
            "Reorder payload must list every id in the collection exactly once "
            f"(missing: {sorted(missing)}, unknown: {sorted(unknown)})",
        )


def sequential_rank(position: int) -> Decimal:
    """Rank value for the 1-based ``position`` of a freshly reordered list."""
    return Decimal(position)


def apply_sequential_ranks(db: Session, by_id: dict[int, Any], ids: Sequence[int], attr: str) -> None:
    """Rewrite a ranked collection's ranks as 1..n.

    Writing 1..n straight away collides with whichever row still holds the value
    being written (any swap does it): SQLAlchemy emits one UPDATE per row and
    PostgreSQL checks the non-deferrable UNIQUE index row-by-row.

    So: park every row above the current maximum, flush, then lay down 1..n.
    ``offset`` is at least ``n``, so the parked values can't clash with the
    final ones either.
    """
    if not ids:
        return
    current = [getattr(by_id[i], attr) or Decimal(0) for i in ids]
    offset = max([Decimal(len(ids)), *current])
    for i, key in enumerate(ids, start=1):
        setattr(by_id[key], attr, offset + i)
    db.flush()
    for i, key in enumerate(ids, start=1):
        setattr(by_id[key], attr, sequential_rank(i))
    db.flush()
