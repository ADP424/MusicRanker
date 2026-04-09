from __future__ import annotations

from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Table, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

movie_genre_parents = Table(
    "movie_genre_parents",
    Base.metadata,
    Column("genre_id", ForeignKey("movie_genres.id", ondelete="CASCADE"), primary_key=True),
    Column("parent_genre_id", ForeignKey("movie_genres.id", ondelete="CASCADE"), primary_key=True),
    CheckConstraint("genre_id <> parent_genre_id", name="chk_movie_genre_not_self_parent"),
    Index("idx_movie_genre_parents_parent", "parent_genre_id"),
)


class MovieGenre(Base):
    __tablename__ = "movie_genres"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    synonyms: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    notes: Mapped[str | None] = mapped_column(Text)

    parents: Mapped[list[MovieGenre]] = relationship(
        "MovieGenre",
        secondary=movie_genre_parents,
        primaryjoin=lambda: MovieGenre.id == movie_genre_parents.c.genre_id,
        secondaryjoin=lambda: MovieGenre.id == movie_genre_parents.c.parent_genre_id,
        back_populates="children",
    )
    children: Mapped[list[MovieGenre]] = relationship(
        "MovieGenre",
        secondary=movie_genre_parents,
        primaryjoin=lambda: MovieGenre.id == movie_genre_parents.c.parent_genre_id,
        secondaryjoin=lambda: MovieGenre.id == movie_genre_parents.c.genre_id,
        back_populates="parents",
    )
