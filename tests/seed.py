"""Fill a guild with one or two rows in *every* guild-scoped table, generically.

Rows get fixed ids (`IDS`), so any integer path parameter can be filled with
`IDS[0]` and is then guaranteed to name one of this guild's rows of whatever
kind the route expects, with no per-route mapping to maintain. Every text value
carries `MARKER`, so a response that leaks this guild's data is easy to spot.
"""
from __future__ import annotations

import datetime as dt
import enum

from sqlalchemy import ARRAY, Boolean, Date, DateTime, Enum, Integer, Interval, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection

from server.database_models import Base
from server.normalize import norm, norm_or_none

MARKER = "LEAKMARKA"
IDS = (1001, 1002)
#: Not seeded: the guild row itself, and memberships (the caller arranges those).
SKIP = {"guilds", "guild_members"}


def enum_value(values) -> str:
    """The value seeded for an enum column, and so the one routes are called with."""
    values = [v.value if isinstance(v, enum.Enum) else v for v in values]
    return next(v for v in values if v != "creator")  # movie credits forbid `creator`


def _value(col, n: int, row: dict):
    t = col.type
    if isinstance(t, Enum):
        return enum_value(t.enums)
    if isinstance(t, Boolean):
        return True
    if isinstance(t, (Integer, Numeric)):
        return n
    if isinstance(t, Interval):
        return dt.timedelta(minutes=40)
    if isinstance(t, DateTime):
        return dt.datetime.now(dt.timezone.utc)
    if isinstance(t, Date):
        return dt.date(2000, 1, 1)
    if isinstance(t, JSONB):
        return {}
    if isinstance(t, ARRAY):
        return [MARKER]
    if isinstance(t, (String, Text)):
        if col.name.endswith("_norm"):
            src = row.get(col.name[: -len("_norm")])
            return (norm(src) if col.name == "name_norm" else norm_or_none(src)) if src else None
        if col.name in ("url",):
            return "https://example.com/" + MARKER
        return f"{MARKER} {col.table.name} {n}"
    raise NotImplementedError(f"{col.table.name}.{col.name}: {t!r}")


#: table -> why its first row was refused, from the last `seed_guild` call.
failures: dict[str, str] = {}


def seed_guild(conn: Connection, guild_id: int, user_id: int, ids: tuple[int, ...] = IDS) -> dict[str, int]:
    """-> rows inserted per table. Tables that couldn't take a row are absent
    (and explained in `failures`). `ids` beyond the default make bigger guilds,
    for spotting queries that scale with the data."""
    failures.clear()
    inserted: dict[str, int] = {}
    for table in Base.metadata.sorted_tables:
        if table.name in SKIP or "guild_id" not in table.c:
            continue
        for i, n in enumerate(ids):
            row: dict = {"guild_id": guild_id}
            # FK columns: users -> the given user; anything else -> this guild's
            # row in the target table. Two FKs to the same table get distinct ids
            # (winner/loser, genre/parent) so pair constraints hold.
            per_target: dict[str, int] = {}
            for col in table.c:
                if col.name == "guild_id":
                    continue
                # Only id references; a text FK (a nationality name) is left to the
                # value rules below (nullable -> NULL, i.e. Unknown).
                targets = {fk.column.table.name for fk in col.foreign_keys
                           if fk.column.name != "guild_id" and isinstance(fk.column.type, Integer)}
                if not targets:
                    continue
                target = sorted(targets)[0]
                if target == "users":
                    row[col.name] = user_id
                elif target == "guilds":
                    row[col.name] = guild_id
                else:
                    k = per_target.get(target, 0)
                    per_target[target] = k + 1
                    row[col.name] = ids[(i + k) % len(ids)]
            for col in table.c:
                if col.name in row:
                    continue
                if col.primary_key and col.name == "id":
                    row["id"] = n
                    continue
                if col.name.endswith("_norm"):
                    continue  # filled below, from its source column
                if isinstance(col.type, Boolean):
                    row[col.name] = True  # e.g. every genre media flag, so every domain sees it
                    continue
                if col.nullable and col.name != "name_en":
                    continue
                if col.server_default is not None or col.default is not None:
                    if not col.primary_key:
                        continue
                row[col.name] = _value(col, n, row)
            for col in table.c:
                if col.name.endswith("_norm") and col.name not in row:
                    row[col.name] = _value(col, n, row)
            # A check constraint may refuse the preferred enum value (TV show
            # credits forbid `director`, movie credits `creator`); try the others.
            enum_cols = [c for c in table.c if isinstance(c.type, Enum) and c.name in row]
            choices = [None] + (list(enum_cols[0].type.enums) if enum_cols else [])
            error = None
            for choice in choices:
                if choice is not None:
                    row[enum_cols[0].name] = choice
                sp = conn.begin_nested()
                try:
                    conn.execute(table.insert().values(**row))
                    sp.commit()
                    inserted[table.name] = inserted.get(table.name, 0) + 1
                    error = None
                    break
                except Exception as exc:
                    sp.rollback()
                    error = str(exc).splitlines()[0]
            if error and i == 0:
                failures[table.name] = error
    return inserted


def fingerprint(conn: Connection, guild_id: int) -> dict[str, str]:
    """A digest of every guild-scoped table's rows for this guild."""
    out = {}
    for table in Base.metadata.sorted_tables:
        if "guild_id" not in table.c:
            continue
        out[table.name] = conn.execute(text(
            f'SELECT md5(coalesce(string_agg(t::text, \'|\' ORDER BY t::text), \'\')) '
            f'FROM "{table.name}" t WHERE guild_id = :g'
        ), {"g": guild_id}).scalar()
    return out
