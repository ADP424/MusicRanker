from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKeyConstraint, Index, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import Audited, Described, guild_unique, GuildScoped, NormalizedNames

if TYPE_CHECKING:
    from .television import TelevisionShow
    from .television_episode import TelevisionEpisode
    from .television_person import TelevisionSeasonPerson


class TelevisionSeason(GuildScoped, Audited, NormalizedNames, Described, Base):
    """A season of a show — the layer between a show and its episodes. Ranked
    *within* its show (``season_rank`` is the canonical airing order; a user's
    personal order is ``UserTelevisionSeasonRank``), and episodes are in turn
    ranked within their season, the way albums are ranked within an artist.

    ``season_number`` is TMDB's number (0 = specials), kept so a season can be
    re-looked-up on TMDB; it's optional for hand-made seasons."""

    __tablename__ = "television_seasons"
    __table_args__ = (
        guild_unique("television_seasons"),
        UniqueConstraint("show_id", "season_rank", name="uq_tv_season_rank_per_show"),
        ForeignKeyConstraint(
            ["show_id", "guild_id"], ["television_shows.id", "television_shows.guild_id"], ondelete="CASCADE"
        ),
        Index("idx_tv_seasons_show", "show_id"),
        Index("idx_tv_seasons_guild_norm", "guild_id", "name_norm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    show_id: Mapped[int]
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    season_number: Mapped[int | None]
    release_year: Mapped[int]
    notes: Mapped[str | None] = mapped_column(Text)
    season_rank: Mapped[Decimal | None] = mapped_column(Numeric)

    show: Mapped[TelevisionShow] = relationship(
        "TelevisionShow", back_populates="seasons", foreign_keys="TelevisionSeason.show_id"
    )
    episodes: Mapped[list[TelevisionEpisode]] = relationship(
        "TelevisionEpisode",
        back_populates="season",
        cascade="all, delete-orphan",
        order_by="TelevisionEpisode.episode_rank",
        foreign_keys="TelevisionEpisode.season_id",
    )
    person_links: Mapped[list[TelevisionSeasonPerson]] = relationship(
        "TelevisionSeasonPerson",
        back_populates="season",
        cascade="all, delete-orphan",
        foreign_keys="TelevisionSeasonPerson.season_id",
    )
    links = relationship(
        "TelevisionSeasonLink", cascade="all, delete-orphan", order_by="TelevisionSeasonLink.position"
    )
