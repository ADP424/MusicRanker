from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .nationality import nationality

if TYPE_CHECKING:
    from .artist_person import ArtistPerson
    from .movie_person import MoviePerson


class Person(Base):
    __tablename__ = "people"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    birth_nationality: Mapped[str] = mapped_column(nationality)
    core_nationality: Mapped[str] = mapped_column(nationality)
    notes: Mapped[str | None] = mapped_column(Text)

    artist_links: Mapped[list[ArtistPerson]] = relationship(
        "ArtistPerson", back_populates="person", cascade="all, delete-orphan"
    )
    movie_links: Mapped[list[MoviePerson]] = relationship(
        "MoviePerson", back_populates="person", cascade="all, delete-orphan"
    )
