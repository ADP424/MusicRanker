from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .album_movie_soundtrack import album_movie_soundtrack
from .base import Base
from .junctions import movie_genres_junction
from .mixins import Audited, GuildScoped, NormalizedNames, guild_unique


class Movie(GuildScoped, Audited, NormalizedNames, Base):
    __tablename__ = "movies"
    __table_args__ = (
        guild_unique("movies"),
        Index("idx_movies_guild_norm", "guild_id", "name_norm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    runtime_minutes: Mapped[int]
    release_year: Mapped[int]
    notes: Mapped[str | None] = mapped_column(Text)

    person_links = relationship("MoviePerson", back_populates="movie", cascade="all, delete-orphan",
                                foreign_keys="MoviePerson.movie_id")
    genres = relationship("Genre", secondary=movie_genres_junction)
    soundtrack_albums = relationship("Album", secondary=album_movie_soundtrack, back_populates="soundtrack_movies")
    links = relationship("MovieLink", cascade="all, delete-orphan", order_by="MovieLink.position")
