from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .movie_cast_member import CastRole, cast_role_type

if TYPE_CHECKING:
    from .movie import Movie
    from .person import Person


class MoviePerson(Base):
    """Association: a person in a specific role on a specific movie."""

    __tablename__ = "movie_persons"

    movie_id: Mapped[int] = mapped_column(ForeignKey("movies.id", ondelete="CASCADE"), primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[CastRole] = mapped_column(cast_role_type, primary_key=True)

    movie: Mapped[Movie] = relationship("Movie", back_populates="person_links")
    person: Mapped[Person] = relationship("Person", back_populates="movie_links")
