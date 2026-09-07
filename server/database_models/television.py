from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .album_television_soundtrack import album_television_show_soundtrack
from .base import Base
from .junctions import television_show_genres_junction
from .mixins import Audited, GuildScoped, NormalizedNames, guild_unique

if TYPE_CHECKING:
    from .album import Album
    from .genre import Genre
    from .television_episode import TelevisionEpisode
    from .television_person import TelevisionShowPerson


class TelevisionShow(GuildScoped, Audited, NormalizedNames, Base):
    """A television show. Structurally a Movie, minus runtime/watches (those are
    per-episode), plus an ordered, independently ranked list of episodes.

    The soundtrack lives here, at show level, exactly like Movie's — episodes
    don't carry their own."""

    __tablename__ = "television_shows"
    __table_args__ = (guild_unique("television_shows"), Index("idx_tv_shows_guild_norm", "guild_id", "name_norm"))

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    release_year: Mapped[int]
    notes: Mapped[str | None] = mapped_column(Text)
    # `watch_link` / `global_rank` are gone: personal (UserTelevisionShowRank) or
    # now labelled entries in `links`.

    episodes: Mapped[list[TelevisionEpisode]] = relationship(
        "TelevisionEpisode",
        back_populates="show",
        cascade="all, delete-orphan",
        order_by="TelevisionEpisode.episode_rank",
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
    links = relationship("TelevisionShowLink", cascade="all, delete-orphan", order_by="TelevisionShowLink.position")
