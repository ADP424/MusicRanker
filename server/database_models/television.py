from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .album_television_soundtrack import album_television_show_soundtrack
from .base import Base
from .junctions import book_television_show_adaptations, television_show_genres_junction
from .mixins import Audited, Described, external_id_index, guild_unique, GuildScoped, NormalizedNames

if TYPE_CHECKING:
    from .album import Album
    from .genre import Genre
    from .television_episode import TelevisionEpisode
    from .television_person import TelevisionShowPerson
    from .television_season import TelevisionSeason


class TelevisionShow(GuildScoped, Audited, NormalizedNames, Described, Base):
    """A television show. Structurally a Movie, minus runtime/watches (those are
    per-episode), plus an ordered, independently ranked list of seasons, each of
    which holds its own ordered, independently ranked list of episodes.

    The soundtrack lives here, at show level, exactly like Movie's — episodes
    don't carry their own."""

    __tablename__ = "television_shows"
    __table_args__ = (
        guild_unique("television_shows"),
        Index("idx_tv_shows_guild_norm", "guild_id", "name_norm"),
        external_id_index("television_shows", "tmdb_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    release_year: Mapped[int]
    notes: Mapped[str | None] = mapped_column(Text)
    tmdb_id: Mapped[int | None]
    # `watch_link` / `global_rank` are gone: personal (UserTelevisionShowRank) or
    # now labelled entries in `links`.

    seasons: Mapped[list[TelevisionSeason]] = relationship(
        "TelevisionSeason",
        back_populates="show",
        cascade="all, delete-orphan",
        order_by="TelevisionSeason.season_rank",
        foreign_keys="TelevisionSeason.show_id",
    )
    # Every episode across every season. Read-only: episodes are owned (and
    # cascaded) by their season; this is the show-wide roll-up.
    episodes: Mapped[list[TelevisionEpisode]] = relationship(
        "TelevisionEpisode",
        viewonly=True,
        order_by="(TelevisionEpisode.season_id, TelevisionEpisode.episode_rank)",
        foreign_keys="TelevisionEpisode.show_id",
    )
    person_links: Mapped[list[TelevisionShowPerson]] = relationship(
        "TelevisionShowPerson",
        back_populates="show",
        cascade="all, delete-orphan",
        foreign_keys="TelevisionShowPerson.show_id",
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
    source_books = relationship("Book", secondary=book_television_show_adaptations,
                                back_populates="adaptation_television_shows")
    links = relationship("TelevisionShowLink", cascade="all, delete-orphan", order_by="TelevisionShowLink.position")
