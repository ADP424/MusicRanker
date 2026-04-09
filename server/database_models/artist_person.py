from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .artist import Artist
    from .person import Person


class ArtistPerson(Base):
    __tablename__ = "artist_people"

    artist_id: Mapped[int] = mapped_column(ForeignKey("artists.id", ondelete="CASCADE"), primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id", ondelete="CASCADE"), primary_key=True)

    artist: Mapped[Artist] = relationship("Artist", back_populates="person_links")
    person: Mapped[Person] = relationship("Person", back_populates="artist_links")
