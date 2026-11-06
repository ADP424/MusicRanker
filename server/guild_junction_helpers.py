"""Insert helper for guild-scoped `secondary=` relationships declared with an
**explicit** `primaryjoin`/`secondaryjoin` (the self-referential `parents`
relationships, and the category memberships from `categories.py`'s `_members()`).

A *bare* `secondary=` relationship (`Movie.genres`, `Game.platforms`, …) is fine to
assign or `.append()` to: SQLAlchemy derives its join from the composite FKs, so its
synchronize pairs include `guild_id` and the junction row gets it automatically.

An explicit join, though, names only the id columns. SQLAlchemy then has no idea the
table also carries a `guild_id`, leaves it NULL, and the not-null constraint added
by `guild_junction()`/`_members()` rejects the insert. Use `link_guild_scoped`
instead of `.append()` for those.
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
