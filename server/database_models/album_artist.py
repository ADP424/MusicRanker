from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .album import Album
    from .artist import Artist


class AlbumArtist(Base):
    """Association object carrying the per‑artist album rank."""

    __tablename__ = "album_artists"
    __table_args__ = (
        UniqueConstraint("artist_id", "album_rank", name="uq_artist_album_rank"),
        CheckConstraint("album_rank > 0", name="chk_album_rank_positive"),
        Index("idx_album_artists_rank", "artist_id", "album_rank"),
    )

    album_id: Mapped[int] = mapped_column(ForeignKey("albums.id", ondelete="CASCADE"), primary_key=True)
    artist_id: Mapped[int] = mapped_column(ForeignKey("artists.id", ondelete="CASCADE"), primary_key=True)
    album_rank: Mapped[Decimal | None] = mapped_column(Numeric)

    album: Mapped[Album] = relationship("Album", back_populates="artist_links")
    artist: Mapped[Artist] = relationship("Artist", back_populates="album_links")
