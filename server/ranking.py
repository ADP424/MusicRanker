from decimal import Decimal

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
