from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .movie_cast_member import CastRole, cast_role_type


class MoviePerson(Base):
    __tablename__ = "movie_persons"
    __table_args__ = (
        CheckConstraint("role <> 'creator'", name="chk_movie_person_no_creator"),
        ForeignKeyConstraint(["movie_id", "guild_id"], ["movies.id", "movies.guild_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["person_id", "guild_id"], ["people.id", "people.guild_id"], ondelete="CASCADE"),
    )

    movie_id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[CastRole] = mapped_column(cast_role_type, primary_key=True)
    guild_id: Mapped[int] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False, index=True)

    # `foreign_keys` disambiguates which of the two `relationship()`s (this one
    # vs. `person`) each side's column belongs to.
    movie = relationship("Movie", back_populates="person_links", foreign_keys=[movie_id])
    person = relationship("Person", back_populates="movie_links", foreign_keys=[person_id])
