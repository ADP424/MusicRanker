from __future__ import annotations

from sqlalchemy import ForeignKey, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .artist_band_role import BandRole, band_role_type
from .base import Base


class ArtistPerson(Base):
    __tablename__ = "artist_people"
    __table_args__ = (
        ForeignKeyConstraint(["artist_id", "guild_id"], ["artists.id", "artists.guild_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["person_id", "guild_id"], ["people.id", "people.guild_id"], ondelete="CASCADE"),
    )

    artist_id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[BandRole] = mapped_column(band_role_type, primary_key=True)
    guild_id: Mapped[int] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False, index=True)

    artist = relationship("Artist", back_populates="person_links", foreign_keys=[artist_id])
    person = relationship("Person", back_populates="artist_links", foreign_keys=[person_id])
