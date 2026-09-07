"""Insert helper for guild-scoped `secondary=` many-to-many/self-referential
relationships (see `database_models/junctions.py`'s `guild_junction()` and
`database_models/categories.py`'s `_members()`).

Appending to one of these relationships the ordinary ORM way
(`row.parents.append(parent)`) inserts into the association table via SQLAlchemy's
`secondary=` machinery, which only knows about the two FK columns declared in the
`primaryjoin`/`secondaryjoin` — it has no idea the table also carries a `guild_id`
column, so that column is left NULL and the not-null constraint added by
`guild_junction()`/`_members()` rejects the insert. Use `link_guild_scoped` instead
of `.append()` for any relationship backed by one of these tables.
"""

from sqlalchemy.orm import InstrumentedAttribute, Session


def link_guild_scoped(db: Session, parent, attr: InstrumentedAttribute, child, *, guild_id: int) -> None:
    """Insert the association row for `parent.<attr>.append(child)` with `guild_id`
    set, then expire `attr` on `parent` so the next access re-reads it from the DB
    instead of showing stale (pre-insert) in-memory state."""
    rel = attr.property
    # `synchronize_pairs` is the primaryjoin's (parent column -> association column)
    # mapping, `secondary_synchronize_pairs` the secondaryjoin's (child column ->
    # association column) mapping — each includes a guild_id pair alongside the id
    # one, so only take the id pair.
    (_, parent_assoc_col), = ((l, r) for l, r in rel.synchronize_pairs if l.name == "id")
    (_, child_assoc_col), = ((l, r) for l, r in rel.secondary_synchronize_pairs if l.name == "id")
    db.execute(rel.secondary.insert().values(**{
        parent_assoc_col.name: parent.id,
        child_assoc_col.name: child.id,
        "guild_id": guild_id,
    }))
    db.expire(parent, [attr.key])
