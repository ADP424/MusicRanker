from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Table

from .base import Base

genre_parents = Table(
    "genre_parents",
    Base.metadata,
    Column("genre_id", ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True),
    Column("parent_genre_id", ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True),
    CheckConstraint("genre_id <> parent_genre_id", name="chk_genre_not_self_parent"),
    Index("idx_genre_parents_parent", "parent_genre_id"),
)
