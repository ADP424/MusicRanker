"""Shared CRUD for the pairwise-preference tables.

Everything goes through the ORM (rather than bulk `delete()` statements) so the
identity map stays consistent: an upsert deletes the existing row for the pair
and re-inserts it in the same flush, which would otherwise collide on the PK.
"""

from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session


def _pair_clause(model, a: int, b: int):
    """Matches the pair in *either* direction."""
    return or_(
        and_(model.winner_id == a, model.loser_id == b),
        and_(model.winner_id == b, model.loser_id == a),
    )


def _select(model, *clauses):
    stmt = select(model)
    for clause in clauses:
        if clause is not None:
            stmt = stmt.where(clause)
    return stmt


def list_comparisons(db: Session, model, *, scope=None):
    stmt = _select(model, scope).order_by(model.created_at.asc(), model.winner_id.asc())
    return db.scalars(stmt).all()


def delete_comparison(db: Session, model, a: int, b: int, *, scope=None) -> int:
    rows = db.scalars(_select(model, _pair_clause(model, a, b), scope)).all()
    for row in rows:
        db.delete(row)
    db.flush()
    return len(rows)


def clear_comparisons(db: Session, model, *, scope=None) -> int:
    rows = db.scalars(_select(model, scope)).all()
    for row in rows:
        db.delete(row)
    db.flush()
    return len(rows)


def upsert_comparison(
    db: Session,
    model,
    winner_id: int,
    loser_id: int,
    *,
    scope=None,
    extra: dict[str, Any] | None = None,
):
    """Record `winner_id` beats `loser_id`, replacing whatever was stored for the
    unordered pair (so answering again, or swapping, is idempotent)."""
    if winner_id == loser_id:
        raise HTTPException(422, "An entry cannot be compared with itself")
    delete_comparison(db, model, winner_id, loser_id, scope=scope)
    row = model(winner_id=winner_id, loser_id=loser_id, **(extra or {}))
    db.add(row)
    db.flush()
    return row
