from __future__ import annotations

from sqlalchemy import ForeignKeyConstraint, Index, Integer, Text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from .base import Base
from .mixins import GuildScoped


class ExternalLink(GuildScoped):
    """`{"Discogs": "https://…"}` — a labelled URL. `label` is free text and may
    be null (a bare link). `position` keeps the user's ordering."""

    @declared_attr
    def id(cls) -> Mapped[int]:
        return mapped_column(Integer, primary_key=True)

    @declared_attr
    def label(cls) -> Mapped[str | None]:
        return mapped_column(Text)

    @declared_attr
    def url(cls) -> Mapped[str]:
        return mapped_column(Text)

    @declared_attr
    def position(cls) -> Mapped[int]:
        return mapped_column(Integer, default=0)


def _link_table(name: str, owner_table: str, owner_col: str):
    """Composite FK to (owner.id, owner.guild_id): a link can never point at an
    entity in another guild."""
    return (
        ForeignKeyConstraint(
            [owner_col, "guild_id"], [f"{owner_table}.id", f"{owner_table}.guild_id"], ondelete="CASCADE"
        ),
        Index(f"idx_{name}_owner", owner_col, "position"),
    )


class ArtistLink(ExternalLink, Base):
    __tablename__ = "artist_links"
    artist_id: Mapped[int] = mapped_column(index=True)
    __table_args__ = _link_table("artist_links", "artists", "artist_id")


class AlbumLink(ExternalLink, Base):
    __tablename__ = "album_links"
    album_id: Mapped[int] = mapped_column(index=True)
    __table_args__ = _link_table("album_links", "albums", "album_id")


class MovieLink(ExternalLink, Base):
    __tablename__ = "movie_links"
    movie_id: Mapped[int] = mapped_column(index=True)
    __table_args__ = _link_table("movie_links", "movies", "movie_id")


class GameLink(ExternalLink, Base):
    __tablename__ = "game_links"
    game_id: Mapped[int] = mapped_column(index=True)
    __table_args__ = _link_table("game_links", "games", "game_id")


class TelevisionShowLink(ExternalLink, Base):
    __tablename__ = "television_show_links"
    show_id: Mapped[int] = mapped_column(index=True)
    __table_args__ = _link_table("television_show_links", "television_shows", "show_id")


class TelevisionSeasonLink(ExternalLink, Base):
    __tablename__ = "television_season_links"
    season_id: Mapped[int] = mapped_column(index=True)
    __table_args__ = _link_table("television_season_links", "television_seasons", "season_id")


class TelevisionEpisodeLink(ExternalLink, Base):
    __tablename__ = "television_episode_links"
    episode_id: Mapped[int] = mapped_column(index=True)
    __table_args__ = _link_table("television_episode_links", "television_episodes", "episode_id")


class BookLink(ExternalLink, Base):
    __tablename__ = "book_links"
    book_id: Mapped[int] = mapped_column(index=True)
    __table_args__ = _link_table("book_links", "books", "book_id")
