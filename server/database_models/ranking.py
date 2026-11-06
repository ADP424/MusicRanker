from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Index, Numeric, Text, func
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from .base import Base
from .mixins import utcnow


class UserRank:
    """A row exists **iff** the user has opted this entry into their list (A2).

    That restores the meaning of `watches >= 1` / `listens >= 1`: presence of the
    row *is* "I consumed this". The guild catalog is the pool; this is the list.

    `rank` carries no UNIQUE constraint — ordering is `(rank, <entity_id>)`, which
    is deterministic, and ties are harmless. That deletes the entire reason
    `apply_sequential_ranks` needed its two-phase park-then-write dance.
    """

    @declared_attr
    def user_id(cls) -> Mapped[int]:
        return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)

    @declared_attr
    def guild_id(cls) -> Mapped[int]:
        return mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False)

    @declared_attr
    def rank(cls) -> Mapped[Decimal]:
        return mapped_column(Numeric, nullable=False)

    @declared_attr
    def notes(cls) -> Mapped[str | None]:
        return mapped_column(Text)  # private to the user

    @declared_attr
    def added_at(cls) -> Mapped[datetime | None]:
        # When it went into the list (the activity feed). NULL for rows older than the column.
        return mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())


def _order_index(name: str, *extra: str) -> Index:
    return Index(f"idx_{name}_order", "user_id", "guild_id", *extra, "rank")


class UserArtistRank(UserRank, Base):
    __tablename__ = "user_artist_ranks"
    artist_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = (
        ForeignKeyConstraint(["artist_id", "guild_id"], ["artists.id", "artists.guild_id"], ondelete="CASCADE"),
        _order_index("user_artist_ranks"),
    )


class UserAlbumRank(UserRank, Base):
    """Albums are ranked *within an artist's discography*, so the key is
    (user, artist, album) — mirroring the old `album_artists.album_rank`."""

    __tablename__ = "user_album_ranks"
    artist_id: Mapped[int] = mapped_column(primary_key=True)
    album_id: Mapped[int] = mapped_column(primary_key=True)
    listens: Mapped[int] = mapped_column(server_default="1")
    __table_args__ = (
        CheckConstraint("listens >= 1", name="chk_user_album_listens_min"),
        ForeignKeyConstraint(["album_id", "guild_id"], ["albums.id", "albums.guild_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["artist_id", "guild_id"], ["artists.id", "artists.guild_id"], ondelete="CASCADE"),
        _order_index("user_album_ranks", "artist_id"),
    )


class UserMovieRank(UserRank, Base):
    __tablename__ = "user_movie_ranks"
    movie_id: Mapped[int] = mapped_column(primary_key=True)
    watches: Mapped[int] = mapped_column(server_default="1")
    __table_args__ = (
        CheckConstraint("watches >= 1", name="chk_user_movie_watches_min"),
        ForeignKeyConstraint(["movie_id", "guild_id"], ["movies.id", "movies.guild_id"], ondelete="CASCADE"),
        _order_index("user_movie_ranks"),
    )


class UserGameRank(UserRank, Base):
    __tablename__ = "user_game_ranks"
    game_id: Mapped[int] = mapped_column(primary_key=True)
    hours_played: Mapped[Decimal | None] = mapped_column(Numeric(7, 1))
    __table_args__ = (
        CheckConstraint("hours_played >= 0", name="chk_user_game_hours_min"),
        ForeignKeyConstraint(["game_id", "guild_id"], ["games.id", "games.guild_id"], ondelete="CASCADE"),
        _order_index("user_game_ranks"),
    )


class UserTelevisionShowRank(UserRank, Base):
    __tablename__ = "user_television_show_ranks"
    show_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = (
        ForeignKeyConstraint(
            ["show_id", "guild_id"], ["television_shows.id", "television_shows.guild_id"], ondelete="CASCADE"
        ),
        _order_index("user_television_show_ranks"),
    )


class UserTelevisionSeasonRank(UserRank, Base):
    """Seasons are ranked *within their show*, the way albums are within an
    artist's discography. Notes only — watch counts live on episodes."""

    __tablename__ = "user_television_season_ranks"
    season_id: Mapped[int] = mapped_column(primary_key=True)
    show_id: Mapped[int] = mapped_column(ForeignKey("television_shows.id", ondelete="CASCADE"), nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(
            ["season_id", "guild_id"], ["television_seasons.id", "television_seasons.guild_id"], ondelete="CASCADE"
        ),
        _order_index("user_television_season_ranks", "show_id"),
    )


class UserTelevisionEpisodeRank(UserRank, Base):
    """Episodes are ranked *within their season*. ``show_id`` rides along for
    show-wide queries (stats); ``season_id`` is the ranking scope."""

    __tablename__ = "user_television_episode_ranks"
    episode_id: Mapped[int] = mapped_column(primary_key=True)
    show_id: Mapped[int] = mapped_column(ForeignKey("television_shows.id", ondelete="CASCADE"), nullable=False)
    season_id: Mapped[int] = mapped_column(ForeignKey("television_seasons.id", ondelete="CASCADE"), nullable=False)
    watches: Mapped[int] = mapped_column(server_default="1")
    # A second order over the same rows: the whole show's episodes, best first.
    show_rank: Mapped[Decimal | None] = mapped_column(Numeric)
    __table_args__ = (
        CheckConstraint("watches >= 1", name="chk_user_tv_episode_watches_min"),
        ForeignKeyConstraint(
            ["episode_id", "guild_id"], ["television_episodes.id", "television_episodes.guild_id"], ondelete="CASCADE"
        ),
        _order_index("user_television_episode_ranks", "season_id"),
        Index("idx_user_television_episode_ranks_show_order", "user_id", "guild_id", "show_id", "show_rank"),
    )


class UserBookRank(UserRank, Base):
    __tablename__ = "user_book_ranks"
    book_id: Mapped[int] = mapped_column(primary_key=True)
    reads: Mapped[int] = mapped_column(server_default="1")
    __table_args__ = (
        CheckConstraint("reads >= 1", name="chk_user_book_reads_min"),
        ForeignKeyConstraint(["book_id", "guild_id"], ["books.id", "books.guild_id"], ondelete="CASCADE"),
        _order_index("user_book_ranks"),
    )
