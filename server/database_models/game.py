from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Numeric,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .album_game_soundtrack import album_game_soundtrack
from .base import Base

if TYPE_CHECKING:
    from .album import Album
    from .game_person import GamePerson
    from .game_platform import GamePlatform
    from .genre import Genre

game_genres_junction = Table(
    "game_genres_junction",
    Base.metadata,
    Column("game_id", ForeignKey("games.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "genre_id",
        ForeignKey("genres.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Index("idx_game_genres_junction_genre", "genre_id"),
)

game_platforms_junction = Table(
    "game_platforms_junction",
    Base.metadata,
    Column("game_id", ForeignKey("games.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "platform_id",
        ForeignKey("game_platforms.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Index("idx_game_platforms_junction_platform", "platform_id"),
)


class Game(Base):
    __tablename__ = "games"
    __table_args__ = (
        CheckConstraint("hours_played >= 0", name="chk_game_hours_played_min"),
        CheckConstraint("global_rank > 0", name="chk_game_global_rank_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    release_year: Mapped[int]
    hours_played: Mapped[Decimal | None] = mapped_column(Numeric(7, 1))
    play_link: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    global_rank: Mapped[Decimal | None] = mapped_column(Numeric, unique=True)

    person_links: Mapped[list[GamePerson]] = relationship(
        "GamePerson",
        back_populates="game",
        cascade="all, delete-orphan",
    )
    genres: Mapped[list[Genre]] = relationship(
        "Genre",
        secondary=game_genres_junction,
    )
    platforms: Mapped[list[GamePlatform]] = relationship(
        "GamePlatform",
        secondary=game_platforms_junction,
    )
    soundtrack_albums: Mapped[list[Album]] = relationship(
        "Album",
        secondary=album_game_soundtrack,
        back_populates="soundtrack_games",
    )
