from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Column, ForeignKey, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .genre import Genre

movie_genre_category_members = Table(
    "movie_genre_category_members",
    Base.metadata,
    Column("genre_id", ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True),
    Column("category_id", ForeignKey("movie_genre_categories.id", ondelete="CASCADE"), primary_key=True),
)


class MovieGenreCategory(Base):
    __tablename__ = "movie_genre_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)

    genres: Mapped[list["Genre"]] = relationship(
        "Genre", secondary=movie_genre_category_members, back_populates="movie_categories"
    )
