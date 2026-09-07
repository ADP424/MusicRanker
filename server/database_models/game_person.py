from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .game_credit import GameRole, game_role_type

if TYPE_CHECKING:
    from .game import Game
    from .person import Person


class GamePerson(Base):
    __tablename__ = "game_persons"
    __table_args__ = (
        ForeignKeyConstraint(["game_id", "guild_id"], ["games.id", "games.guild_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["person_id", "guild_id"], ["people.id", "people.guild_id"], ondelete="CASCADE"),
    )

    game_id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[GameRole] = mapped_column(game_role_type, primary_key=True)
    guild_id: Mapped[int] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False, index=True)

    game: Mapped[Game] = relationship("Game", back_populates="person_links", foreign_keys=[game_id])
    person: Mapped[Person] = relationship("Person", back_populates="game_links", foreign_keys=[person_id])
