"""Stored pairwise preferences backing the "Rank" tabs.

One row per answered question: the entry the user preferred (``winner_id``) and
the one they didn't (``loser_id``). The API keeps at most one row per *unordered*
pair — re-answering or swapping replaces it.

Foreign keys are declared against the mapped tables (rather than by name) and
cascade on delete, so deleting an artist / album / movie / game / show / episode
also deletes every question that mentioned it.

``AlbumComparison`` additionally carries ``artist_id`` because albums are ranked
*within* an artist's discography, so the same two albums can be compared once per
shared artist. Un-linking an album from an artist prunes those rows explicitly
(see ``routers/albums.py::unlink_artist``); deleting the album or the artist is
handled by the cascades.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from .album import Album
from .artist import Artist
from .base import Base
from .game import Game
from .movie import Movie
from .television import TelevisionShow
from .television_episode import TelevisionEpisode


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ArtistComparison(Base):
    __tablename__ = "artist_comparison"

    winner_id: Mapped[int] = mapped_column(ForeignKey(Artist.__table__.c.id, ondelete="CASCADE"), primary_key=True)
    loser_id: Mapped[int] = mapped_column(ForeignKey(Artist.__table__.c.id, ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AlbumComparison(Base):
    __tablename__ = "album_comparison"

    artist_id: Mapped[int] = mapped_column(ForeignKey(Artist.__table__.c.id, ondelete="CASCADE"), primary_key=True)
    winner_id: Mapped[int] = mapped_column(ForeignKey(Album.__table__.c.id, ondelete="CASCADE"), primary_key=True)
    loser_id: Mapped[int] = mapped_column(ForeignKey(Album.__table__.c.id, ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class MovieComparison(Base):
    __tablename__ = "movie_comparison"

    winner_id: Mapped[int] = mapped_column(ForeignKey(Movie.__table__.c.id, ondelete="CASCADE"), primary_key=True)
    loser_id: Mapped[int] = mapped_column(ForeignKey(Movie.__table__.c.id, ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GameComparison(Base):
    __tablename__ = "game_comparison"

    winner_id: Mapped[int] = mapped_column(ForeignKey(Game.__table__.c.id, ondelete="CASCADE"), primary_key=True)
    loser_id: Mapped[int] = mapped_column(ForeignKey(Game.__table__.c.id, ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TelevisionShowComparison(Base):
    __tablename__ = "television_show_comparison"

    winner_id: Mapped[int] = mapped_column(
        ForeignKey(TelevisionShow.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    loser_id: Mapped[int] = mapped_column(
        ForeignKey(TelevisionShow.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TelevisionEpisodeComparison(Base):
    """Episodes belong to exactly one show, so the show scope is implied."""

    __tablename__ = "television_episode_comparison"

    winner_id: Mapped[int] = mapped_column(
        ForeignKey(TelevisionEpisode.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    loser_id: Mapped[int] = mapped_column(
        ForeignKey(TelevisionEpisode.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
