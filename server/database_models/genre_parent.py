from sqlalchemy import CheckConstraint, Column, ForeignKeyConstraint, Index, Table

from .base import Base

genre_parents = Table(
    "genre_parents",
    Base.metadata,
    Column("genre_id", primary_key=True),
    Column("parent_genre_id", primary_key=True),
    Column("guild_id", nullable=False),
    ForeignKeyConstraint(["genre_id", "guild_id"], ["genres.id", "genres.guild_id"], ondelete="CASCADE"),
    ForeignKeyConstraint(["parent_genre_id", "guild_id"], ["genres.id", "genres.guild_id"], ondelete="CASCADE"),
    ForeignKeyConstraint(["guild_id"], ["guilds.id"], ondelete="CASCADE"),
    CheckConstraint("genre_id <> parent_genre_id", name="chk_genre_not_self_parent"),
    Index("idx_genre_parents_parent", "parent_genre_id"),
)
