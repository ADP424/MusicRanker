from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKeyConstraint, Index, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .junctions import television_episode_genres_junction
from .mixins import Audited, Described, guild_unique, GuildScoped, NormalizedNames

if TYPE_CHECKING:
    from .genre import Genre
    from .television import TelevisionShow
    from .television_person import TelevisionEpisodePerson
    from .television_season import TelevisionSeason


class TelevisionEpisode(GuildScoped, Audited, NormalizedNames, Described, Base):
    """An episode of a season. Ranked *within* its season (``episode_rank``),
    the way albums are ranked within an artist. Carries the concrete runtime,
    and its own (initially inherited) people/genres. Soundtracks are show-level
    only — see ``TelevisionShow.soundtrack_albums``. Watch count is personal
    (``UserTelevisionEpisodeRank``); ``episode_rank`` stays here as the
    canonical airing order, distinct from a user's personal rank of it.

    ``show_id`` is kept alongside ``season_id`` (always the season's show) so
    show-wide queries — stats, people, merges — don't need the extra join."""

    __tablename__ = "television_episodes"
    __table_args__ = (
        guild_unique("television_episodes"),
        UniqueConstraint("season_id", "episode_rank", name="uq_tv_episode_rank_per_season"),
        ForeignKeyConstraint(
            ["show_id", "guild_id"], ["television_shows.id", "television_shows.guild_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["season_id", "guild_id"], ["television_seasons.id", "television_seasons.guild_id"], ondelete="CASCADE"
        ),
        Index("idx_tv_episodes_show", "show_id"),
        Index("idx_tv_episodes_season", "season_id"),
        Index("idx_tv_episodes_guild_norm", "guild_id", "name_norm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    show_id: Mapped[int]
    season_id: Mapped[int]
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    runtime_minutes: Mapped[int] = mapped_column(server_default="0")
    release_year: Mapped[int]
    notes: Mapped[str | None] = mapped_column(Text)
    episode_rank: Mapped[Decimal | None] = mapped_column(Numeric)
    # TMDB's number within the season; the canonical order is episode_rank.
    episode_number: Mapped[int | None]

    show: Mapped[TelevisionShow] = relationship("TelevisionShow", viewonly=True,
                                                foreign_keys="TelevisionEpisode.show_id")
    season: Mapped[TelevisionSeason] = relationship("TelevisionSeason", back_populates="episodes",
                                                    foreign_keys="TelevisionEpisode.season_id")
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
