from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKeyConstraint, Index, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .junctions import television_episode_genres_junction
from .mixins import Audited, GuildScoped, NormalizedNames, guild_unique

if TYPE_CHECKING:
    from .genre import Genre
    from .television import TelevisionShow
    from .television_person import TelevisionEpisodePerson


class TelevisionEpisode(GuildScoped, Audited, NormalizedNames, Base):
    """An episode of a show. Ranked *within* its show (``episode_rank``), the
    way albums are ranked within an artist. Carries the concrete runtime, and
    its own (initially inherited) people/genres. Soundtracks are show-level
    only — see ``TelevisionShow.soundtrack_albums``. Watch count is personal
    (``UserTelevisionEpisodeRank``); ``episode_rank`` stays here as the
    canonical airing order, distinct from a user's personal rank of it."""

    __tablename__ = "television_episodes"
    __table_args__ = (
        guild_unique("television_episodes"),
        UniqueConstraint("show_id", "episode_rank", name="uq_tv_episode_rank_per_show"),
        ForeignKeyConstraint(
            ["show_id", "guild_id"], ["television_shows.id", "television_shows.guild_id"], ondelete="CASCADE"
        ),
        Index("idx_tv_episodes_show", "show_id"),
        Index("idx_tv_episodes_guild_norm", "guild_id", "name_norm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    show_id: Mapped[int]
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    runtime_minutes: Mapped[int] = mapped_column(server_default="0")
    release_year: Mapped[int]
    notes: Mapped[str | None] = mapped_column(Text)
    episode_rank: Mapped[Decimal | None] = mapped_column(Numeric)

    show: Mapped[TelevisionShow] = relationship("TelevisionShow", back_populates="episodes",
                                                foreign_keys="TelevisionEpisode.show_id")
    person_links: Mapped[list[TelevisionEpisodePerson]] = relationship(
        "TelevisionEpisodePerson",
        back_populates="episode",
        cascade="all, delete-orphan",
        foreign_keys="TelevisionEpisodePerson.episode_id",
    )
    genres: Mapped[list[Genre]] = relationship(
        "Genre",
        secondary=television_episode_genres_junction,
    )
    links = relationship(
        "TelevisionEpisodeLink", cascade="all, delete-orphan", order_by="TelevisionEpisodeLink.position"
    )
