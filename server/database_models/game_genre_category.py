from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Column, ForeignKey, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .genre import Genre

game_genre_category_members = Table(
    "game_genre_category_members",
    Base.metadata,
    Column("genre_id", ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True),
    Column("category_id", ForeignKey("game_genre_categories.id", ondelete="CASCADE"), primary_key=True),
)


class GameGenreCategory(Base):
    __tablename__ = "game_genre_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)

    genres: Mapped[list["Genre"]] = relationship(
        "Genre", secondary=game_genre_category_members, back_populates="game_categories"
    )
