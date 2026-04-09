from __future__ import annotations

from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .genre_parent import genre_parents


class Genre(Base):
    __tablename__ = "music_genres"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    synonyms: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    notes: Mapped[str | None] = mapped_column(Text)

    parents: Mapped[list[Genre]] = relationship(
        "Genre",
        secondary=genre_parents,
        primaryjoin=lambda: Genre.id == genre_parents.c.genre_id,
        secondaryjoin=lambda: Genre.id == genre_parents.c.parent_genre_id,
        back_populates="children",
    )
    children: Mapped[list[Genre]] = relationship(
        "Genre",
        secondary=genre_parents,
        primaryjoin=lambda: Genre.id == genre_parents.c.parent_genre_id,
        secondaryjoin=lambda: Genre.id == genre_parents.c.genre_id,
        back_populates="parents",
    )
