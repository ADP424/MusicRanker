from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Interval, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .album_genre import album_genres
from .album_movie_soundtrack import album_movie_soundtrack
from .base import Base

if TYPE_CHECKING:
    from .album_artist import AlbumArtist
    from .genre import Genre
    from .movie import Movie


class Album(Base):
    __tablename__ = "albums"
    __table_args__ = (CheckConstraint("listens >= 1", name="chk_album_listens_min"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    runtime: Mapped[timedelta] = mapped_column(Interval)
    release_year: Mapped[int]
    alias: Mapped[str | None] = mapped_column(Text)
    alias_link: Mapped[str | None] = mapped_column(Text)
    listens: Mapped[int] = mapped_column(server_default="1")
    listen_link: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    artist_links: Mapped[list[AlbumArtist]] = relationship(
        "AlbumArtist",
        back_populates="album",
        cascade="all, delete-orphan",
    )
    genres: Mapped[list[Genre]] = relationship(
        "Genre",
        secondary=album_genres,
    )
    soundtrack_movies: Mapped[list[Movie]] = relationship(
        "Movie",
        secondary=album_movie_soundtrack,
        back_populates="soundtrack_albums",
    )

    @property
    def runtime_seconds(self) -> int:
        """Exposed to the API in place of the raw timedelta."""
        return int(self.runtime.total_seconds())
