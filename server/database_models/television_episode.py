from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Numeric,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .genre import Genre
    from .television import TelevisionShow
    from .television_person import TelevisionEpisodePerson

television_episode_genres_junction = Table(
    "television_episode_genres_junction",
    Base.metadata,
    Column("episode_id", ForeignKey("television_episodes.id", ondelete="CASCADE"), primary_key=True),
    Column("genre_id", ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True),
    Index("idx_tv_episode_genres_junction_genre", "genre_id"),
)


class TelevisionEpisode(Base):
    """An episode of a show. Ranked *within* its show (``episode_rank``), the
    way albums are ranked within an artist. Carries the concrete runtime and
    watch count, and its own (initially inherited) people/genres. Soundtracks
    are show-level only — see ``TelevisionShow.soundtrack_albums``."""

    __tablename__ = "television_episodes"
    __table_args__ = (
        UniqueConstraint("show_id", "episode_rank", name="uq_tv_episode_rank_per_show"),
        CheckConstraint("watches >= 1", name="chk_tv_episode_watches_min"),
        CheckConstraint("episode_rank > 0", name="chk_tv_episode_rank_positive"),
        Index("idx_tv_episodes_show", "show_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    show_id: Mapped[int] = mapped_column(ForeignKey("television_shows.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    runtime_minutes: Mapped[int] = mapped_column(server_default="0")
    release_year: Mapped[int]
    watches: Mapped[int] = mapped_column(server_default="1")
    watch_link: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    episode_rank: Mapped[Decimal | None] = mapped_column(Numeric)

    show: Mapped[TelevisionShow] = relationship("TelevisionShow", back_populates="episodes")
    person_links: Mapped[list[TelevisionEpisodePerson]] = relationship(
        "TelevisionEpisodePerson",
        back_populates="episode",
        cascade="all, delete-orphan",
    )
    genres: Mapped[list[Genre]] = relationship(
        "Genre",
        secondary=television_episode_genres_junction,
    )
