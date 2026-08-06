from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Numeric, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .album_television_soundtrack import album_television_show_soundtrack
from .base import Base

if TYPE_CHECKING:
    from .album import Album
    from .genre import Genre
    from .television_episode import TelevisionEpisode
    from .television_person import TelevisionShowPerson

television_show_genres_junction = Table(
    "television_show_genres_junction",
    Base.metadata,
    Column("show_id", ForeignKey("television_shows.id", ondelete="CASCADE"), primary_key=True),
    Column("genre_id", ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True),
    Index("idx_tv_show_genres_junction_genre", "genre_id"),
)


class TelevisionShow(Base):
    """A television show. Structurally a Movie, minus runtime/watches (those are
    per-episode), plus an ordered, independently ranked list of episodes.

    The soundtrack lives here, at show level, exactly like Movie's — episodes
    don't carry their own."""

    __tablename__ = "television_shows"
    __table_args__ = (CheckConstraint("global_rank > 0", name="chk_tv_show_global_rank_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    release_year: Mapped[int]
    watch_link: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    global_rank: Mapped[Decimal | None] = mapped_column(Numeric, unique=True)

    episodes: Mapped[list[TelevisionEpisode]] = relationship(
        "TelevisionEpisode",
        back_populates="show",
        cascade="all, delete-orphan",
        order_by="TelevisionEpisode.episode_rank",
    )
    person_links: Mapped[list[TelevisionShowPerson]] = relationship(
        "TelevisionShowPerson",
        back_populates="show",
        cascade="all, delete-orphan",
    )
    genres: Mapped[list[Genre]] = relationship(
        "Genre",
        secondary=television_show_genres_junction,
    )
    soundtrack_albums: Mapped[list[Album]] = relationship(
        "Album",
        secondary=album_television_show_soundtrack,
        back_populates="soundtrack_television_shows",
    )
