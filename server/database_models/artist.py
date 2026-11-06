from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import Audited, GuildScoped, NormalizedNames, guild_unique
from .nationality import HasNationalities, nationality_fks


class Artist(GuildScoped, Audited, NormalizedNames, HasNationalities, Base):
    __tablename__ = "artists"
    __table_args__ = (
        guild_unique("artists"), Index("idx_artists_guild_norm", "guild_id", "name_norm"), *nationality_fks("artists"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    # Plain FK, not composite: ON DELETE SET NULL on a composite would try to
    # null `guild_id` too, which is NOT NULL. The router validates the guild.
    primary_genre: Mapped[int | None] = mapped_column(ForeignKey("genres.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)

    album_links = relationship("AlbumArtist", back_populates="artist", cascade="all, delete-orphan",
                               foreign_keys="AlbumArtist.artist_id")
    person_links = relationship("ArtistPerson", back_populates="artist", cascade="all, delete-orphan",
                                foreign_keys="ArtistPerson.artist_id")
    links = relationship("ArtistLink", cascade="all, delete-orphan", order_by="ArtistLink.position")
