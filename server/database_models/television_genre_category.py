from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Column, ForeignKey, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .genre import Genre

television_genre_category_members = Table(
    "television_genre_category_members",
    Base.metadata,
    Column("genre_id", ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True),
    Column("category_id", ForeignKey("television_genre_categories.id", ondelete="CASCADE"), primary_key=True),
)


class TelevisionGenreCategory(Base):
    __tablename__ = "television_genre_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)

    genres: Mapped[list["Genre"]] = relationship(
        "Genre", secondary=television_genre_category_members, back_populates="television_categories"
    )
