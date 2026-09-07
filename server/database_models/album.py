from __future__ import annotations

from datetime import timedelta

from sqlalchemy import Index, Interval, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .album_game_soundtrack import album_game_soundtrack
from .album_genre import album_genres
from .album_movie_soundtrack import album_movie_soundtrack
from .album_television_soundtrack import album_television_show_soundtrack
from .base import Base
from .mixins import Audited, GuildScoped, NormalizedNames, guild_unique


class Album(GuildScoped, Audited, NormalizedNames, Base):
    __tablename__ = "albums"
    __table_args__ = (guild_unique("albums"), Index("idx_albums_guild_norm", "guild_id", "name_norm"))

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    runtime: Mapped[timedelta] = mapped_column(Interval)
    release_year: Mapped[int]
    alias: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    # `listens` / `listen_link` / `alias_link` are gone: the first is personal
    # (UserAlbumRank), the last two are now labelled entries in `links`.

    artist_links = relationship("AlbumArtist", back_populates="album", cascade="all, delete-orphan",
                                foreign_keys="AlbumArtist.album_id")
    genres = relationship("Genre", secondary=album_genres)
    soundtrack_movies = relationship("Movie", secondary=album_movie_soundtrack, back_populates="soundtrack_albums")
    soundtrack_games = relationship("Game", secondary=album_game_soundtrack, back_populates="soundtrack_albums")
    soundtrack_television_shows = relationship("TelevisionShow", secondary=album_television_show_soundtrack,
                                               back_populates="soundtrack_albums")
    links = relationship("AlbumLink", cascade="all, delete-orphan", order_by="AlbumLink.position")

    @property
    def runtime_seconds(self) -> int:
        return int(self.runtime.total_seconds())
