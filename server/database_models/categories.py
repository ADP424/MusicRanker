"""All six category taxonomies. They were five near-identical files; guild
scoping them five times was pure repetition."""
from __future__ import annotations

from sqlalchemy import Column, ForeignKeyConstraint, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import Audited, GuildScoped, guild_unique


def _members(table: str, cat_table: str, owner_table: str, owner_col: str) -> Table:
    # No plain single-column ForeignKey alongside the composite constraints
    # below: a column carrying both leaves SQLAlchemy with two FK paths to the
    # same target and no way to pick one for a bare `secondary=` relationship
    # (AmbiguousForeignKeysError) — the composite constraint alone is enough.
    return Table(
        table,
        Base.metadata,
        Column(owner_col, primary_key=True),
        Column("category_id", primary_key=True),
        Column("guild_id", nullable=False),
        ForeignKeyConstraint([owner_col, "guild_id"], [f"{owner_table}.id", f"{owner_table}.guild_id"],
                             ondelete="CASCADE"),
        ForeignKeyConstraint(["category_id", "guild_id"], [f"{cat_table}.id", f"{cat_table}.guild_id"],
                             ondelete="CASCADE"),
        ForeignKeyConstraint(["guild_id"], ["guilds.id"], ondelete="CASCADE"),
    )


genre_category_members = _members("music_genre_category_members", "music_genre_categories", "genres", "genre_id")
movie_genre_category_members = _members("movie_genre_category_members", "movie_genre_categories", "genres", "genre_id")
game_genre_category_members = _members("game_genre_category_members", "game_genre_categories", "genres", "genre_id")
television_genre_category_members = _members(
    "television_genre_category_members", "television_genre_categories", "genres", "genre_id"
)
book_genre_category_members = _members(
    "book_genre_category_members", "book_genre_categories", "genres", "genre_id"
)
game_platform_category_members = _members(
    "game_platform_category_members", "game_platform_categories", "game_platforms", "platform_id"
)


class _Category(GuildScoped, Audited):
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)


def _args(table: str) -> tuple:
    # `name` was globally unique; it is now unique *within a guild* (landmine 12).
    return (guild_unique(table), UniqueConstraint("guild_id", "name", name=f"uq_{table}_guild_name"))


class GenreCategory(_Category, Base):
    __tablename__ = "music_genre_categories"
    __table_args__ = _args("music_genre_categories")
    genres = relationship("Genre", secondary=genre_category_members, back_populates="music_categories")


class MovieGenreCategory(_Category, Base):
    __tablename__ = "movie_genre_categories"
    __table_args__ = _args("movie_genre_categories")
    genres = relationship("Genre", secondary=movie_genre_category_members, back_populates="movie_categories")


class GameGenreCategory(_Category, Base):
    __tablename__ = "game_genre_categories"
    __table_args__ = _args("game_genre_categories")
    genres = relationship("Genre", secondary=game_genre_category_members, back_populates="game_categories")


class TelevisionGenreCategory(_Category, Base):
    __tablename__ = "television_genre_categories"
    __table_args__ = _args("television_genre_categories")
    genres = relationship("Genre", secondary=television_genre_category_members,
                          back_populates="television_categories")


class BookGenreCategory(_Category, Base):
    __tablename__ = "book_genre_categories"
    __table_args__ = _args("book_genre_categories")
    genres = relationship("Genre", secondary=book_genre_category_members, back_populates="book_categories")


class GamePlatformCategory(_Category, Base):
    __tablename__ = "game_platform_categories"
    __table_args__ = _args("game_platform_categories")
    platforms = relationship("GamePlatform", secondary=game_platform_category_members, back_populates="categories")
