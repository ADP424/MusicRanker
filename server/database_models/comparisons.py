"""Pairwise preferences, now keyed by (user, guild, winner, loser).

Per E4 there is no stored "guild ranking": a consensus order is *derived* from
members' own comparisons (Copeland/Borda over these rows), so this table stays
the single source of truth and guild aggregates come for free later.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from .base import Base
from .mixins import utcnow


class Comparison:
    @declared_attr
    def user_id(cls) -> Mapped[int]:
        return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)

    @declared_attr
    def guild_id(cls) -> Mapped[int]:
        return mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False)

    @declared_attr
    def created_at(cls) -> Mapped[datetime]:
        return mapped_column(DateTime(timezone=True), default=utcnow)


def _pair_fks(table: str):
    return (
        ForeignKeyConstraint(["winner_id", "guild_id"], [f"{table}.id", f"{table}.guild_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["loser_id", "guild_id"], [f"{table}.id", f"{table}.guild_id"], ondelete="CASCADE"),
    )


class ArtistComparison(Comparison, Base):
    __tablename__ = "artist_comparison"
    winner_id: Mapped[int] = mapped_column(primary_key=True)
    loser_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = _pair_fks("artists")


class AlbumComparison(Comparison, Base):
    __tablename__ = "album_comparison"
    artist_id: Mapped[int] = mapped_column(ForeignKey("artists.id", ondelete="CASCADE"), primary_key=True)
    winner_id: Mapped[int] = mapped_column(primary_key=True)
    loser_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = _pair_fks("albums")


class MovieComparison(Comparison, Base):
    __tablename__ = "movie_comparison"
    winner_id: Mapped[int] = mapped_column(primary_key=True)
    loser_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = _pair_fks("movies")


class GameComparison(Comparison, Base):
    __tablename__ = "game_comparison"
    winner_id: Mapped[int] = mapped_column(primary_key=True)
    loser_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = _pair_fks("games")


class TelevisionShowComparison(Comparison, Base):
    __tablename__ = "television_show_comparison"
    winner_id: Mapped[int] = mapped_column(primary_key=True)
    loser_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = _pair_fks("television_shows")


class TelevisionSeasonComparison(Comparison, Base):
    __tablename__ = "television_season_comparison"
    show_id: Mapped[int] = mapped_column(ForeignKey("television_shows.id", ondelete="CASCADE"), primary_key=True)
    winner_id: Mapped[int] = mapped_column(primary_key=True)
    loser_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = _pair_fks("television_seasons")


class TelevisionEpisodeComparison(Comparison, Base):
    __tablename__ = "television_episode_comparison"
    season_id: Mapped[int] = mapped_column(ForeignKey("television_seasons.id", ondelete="CASCADE"), primary_key=True)
    winner_id: Mapped[int] = mapped_column(primary_key=True)
    loser_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = _pair_fks("television_episodes")


class BookComparison(Comparison, Base):
    __tablename__ = "book_comparison"
    winner_id: Mapped[int] = mapped_column(primary_key=True)
    loser_id: Mapped[int] = mapped_column(primary_key=True)
    __table_args__ = _pair_fks("books")
