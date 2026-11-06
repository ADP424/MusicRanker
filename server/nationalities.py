"""Per-guild nationality helpers: seeding a new guild, and mapping a free-form
value (an import's guess, another guild's spelling) onto this guild's list."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .database_models.nationality import DEFAULT_NATIONALITIES, UNKNOWN, Nationality
from .normalize import norm


def seed_defaults(db: Session, guild_id: int) -> None:
    """Give a new guild the default list (one statement)."""
    db.execute(pg_insert(Nationality).values([
        {"guild_id": guild_id, "name": n, "name_norm": norm(n)} for n in DEFAULT_NATIONALITIES
    ]).on_conflict_do_nothing())


def _cache_key(guild_id: int) -> tuple[str, int]:
    return ("nationalities", guild_id)


def forget(db: Session, guild_id: int) -> None:
    """Drop the per-session lookup after the guild's list changed."""
    db.info.pop(_cache_key(guild_id), None)


def by_norm(db: Session, guild_id: int) -> dict[str, str]:
    """norm(name) -> the guild's spelling. Cached for the session (imports call
    this once per new person)."""
    key = _cache_key(guild_id)
    if key not in db.info:
        rows = db.execute(select(Nationality.name).where(Nationality.guild_id == guild_id)).scalars()
        db.info[key] = {norm(n): n for n in rows}
    return db.info[key]


def resolve(db: Session, guild_id: int, value: str | None) -> str:
    """`value` as this guild spells it, or Unknown if the guild doesn't have it."""
    if not value or value == UNKNOWN:
        return UNKNOWN
    return by_norm(db, guild_id).get(norm(value), UNKNOWN)


def ensure(db: Session, guild_id: int, value: str | None) -> str:
    """Like `resolve`, but adds a missing nationality to the guild instead of
    dropping it (guild merges bring their vocabulary along)."""
    if not value or value == UNKNOWN:
        return UNKNOWN
    known = by_norm(db, guild_id)
    if (n := norm(value)) not in known:
        db.add(Nationality(guild_id=guild_id, name=value))
        db.flush()
        known[n] = value
    return known[n]
