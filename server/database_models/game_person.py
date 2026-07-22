from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .game_credit import GameRole, game_role_type

if TYPE_CHECKING:
    from .game import Game
    from .person import Person


class GamePerson(Base):
    __tablename__ = "game_persons"

    game_id: Mapped[int] = mapped_column(
        ForeignKey("games.id", ondelete="CASCADE"),
        primary_key=True,
    )
    person_id: Mapped[int] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[GameRole] = mapped_column(game_role_type, primary_key=True)

    game: Mapped[Game] = relationship("Game", back_populates="person_links")
    person: Mapped[Person] = relationship("Person", back_populates="game_links")
