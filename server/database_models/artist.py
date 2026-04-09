from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .nationality import nationality

if TYPE_CHECKING:
    from .album_artist import AlbumArtist
    from .artist_person import ArtistPerson


class Artist(Base):
    __tablename__ = "artists"
    __table_args__ = (
        CheckConstraint("global_rank > 0", name="chk_artist_rank_positive"),
        Index("idx_artists_primary_genre", "primary_genre"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    global_rank: Mapped[Decimal | None] = mapped_column(Numeric, unique=True)
    discography_link: Mapped[str] = mapped_column(Text)
    birth_nationality: Mapped[str] = mapped_column(nationality)
    core_nationality: Mapped[str] = mapped_column(nationality)
    primary_genre: Mapped[int | None] = mapped_column(ForeignKey("music_genres.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)

    album_links: Mapped[list[AlbumArtist]] = relationship(
        "AlbumArtist",
        back_populates="artist",
        cascade="all, delete-orphan",
    )
    person_links: Mapped[list[ArtistPerson]] = relationship(
        "ArtistPerson",
        back_populates="artist",
        cascade="all, delete-orphan",
    )
