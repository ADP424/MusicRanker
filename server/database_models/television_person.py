from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .movie_cast_member import CastRole, cast_role_type

if TYPE_CHECKING:
    from .person import Person
    from .television import TelevisionShow
    from .television_episode import TelevisionEpisode


class TelevisionShowPerson(Base):
    """Association: a person in a role on a show (the default for its episodes).
    A show is authored, not directed — ``creator`` replaces ``director`` here."""

    __tablename__ = "television_show_persons"
    __table_args__ = (
        CheckConstraint("role <> 'director'", name="chk_tv_show_person_no_director"),
        ForeignKeyConstraint(
            ["show_id", "guild_id"], ["television_shows.id", "television_shows.guild_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(["person_id", "guild_id"], ["people.id", "people.guild_id"], ondelete="CASCADE"),
    )

    show_id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[CastRole] = mapped_column(cast_role_type, primary_key=True)
    guild_id: Mapped[int] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False, index=True)

    show: Mapped[TelevisionShow] = relationship("TelevisionShow", back_populates="person_links", foreign_keys=[show_id])
    person: Mapped[Person] = relationship("Person", back_populates="television_links", foreign_keys=[person_id])


class TelevisionEpisodePerson(Base):
    """Association: a person in a role on a specific episode (the authoritative
    per-episode cast list). Episodes keep ``director``; ``creator`` is show-only."""

    __tablename__ = "television_episode_persons"
    __table_args__ = (
        CheckConstraint("role <> 'creator'", name="chk_tv_episode_person_no_creator"),
        ForeignKeyConstraint(
            ["episode_id", "guild_id"], ["television_episodes.id", "television_episodes.guild_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(["person_id", "guild_id"], ["people.id", "people.guild_id"], ondelete="CASCADE"),
    )

    episode_id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[CastRole] = mapped_column(cast_role_type, primary_key=True)
    guild_id: Mapped[int] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False, index=True)

    episode: Mapped[TelevisionEpisode] = relationship(
        "TelevisionEpisode", back_populates="person_links", foreign_keys=[episode_id]
    )
    person: Mapped[Person] = relationship("Person", back_populates="television_episode_links", foreign_keys=[person_id])
