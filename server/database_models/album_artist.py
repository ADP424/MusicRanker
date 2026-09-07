from __future__ import annotations

from sqlalchemy import ForeignKey, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class AlbumArtist(Base):
    __tablename__ = "album_artists"
    __table_args__ = (
        ForeignKeyConstraint(["album_id", "guild_id"], ["albums.id", "albums.guild_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["artist_id", "guild_id"], ["artists.id", "artists.guild_id"], ondelete="CASCADE"),
    )

    album_id: Mapped[int] = mapped_column(primary_key=True)
    artist_id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[int] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False, index=True)

    album = relationship("Album", back_populates="artist_links", foreign_keys=[album_id])
    artist = relationship("Artist", back_populates="album_links", foreign_keys=[artist_id])
