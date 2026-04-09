from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Numeric, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .album_movie_soundtrack import album_movie_soundtrack
from .base import Base

if TYPE_CHECKING:
    from .album import Album
    from .movie_genre import MovieGenre
    from .movie_person import MoviePerson

movie_genres_junction = Table(
    "movie_genres_junction",
    Base.metadata,
    Column("movie_id", ForeignKey("movies.id", ondelete="CASCADE"), primary_key=True),
    Column("genre_id", ForeignKey("movie_genres.id", ondelete="CASCADE"), primary_key=True),
    Index("idx_movie_genres_junction_genre", "genre_id"),
)


class Movie(Base):
    __tablename__ = "movies"
    __table_args__ = (
        CheckConstraint("watches >= 1", name="chk_movie_watches_min"),
        CheckConstraint("global_rank > 0", name="chk_movie_global_rank_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    runtime_minutes: Mapped[int]
    release_year: Mapped[int]
    watches: Mapped[int] = mapped_column(server_default="1")
    watch_link: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    global_rank: Mapped[Decimal | None] = mapped_column(Numeric, unique=True)

    person_links: Mapped[list[MoviePerson]] = relationship(
        "MoviePerson",
        back_populates="movie",
        cascade="all, delete-orphan",
    )
    genres: Mapped[list[MovieGenre]] = relationship(
        "MovieGenre",
        secondary=movie_genres_junction,
    )
    soundtrack_albums: Mapped[list[Album]] = relationship(
        "Album",
        secondary=album_movie_soundtrack,
        back_populates="soundtrack_movies",
    )
