from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .album_game_soundtrack import album_game_soundtrack
from .base import Base
from .junctions import book_game_adaptations, game_genres_junction, game_platforms_junction
from .mixins import Audited, GuildScoped, NormalizedNames, guild_unique

if TYPE_CHECKING:
    from .album import Album
    from .game_person import GamePerson
    from .game_platform import GamePlatform
    from .genre import Genre


class Game(GuildScoped, Audited, NormalizedNames, Base):
    __tablename__ = "games"
    __table_args__ = (guild_unique("games"), Index("idx_games_guild_norm", "guild_id", "name_norm"))

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    release_year: Mapped[int]
    notes: Mapped[str | None] = mapped_column(Text)
    # `hours_played` / `play_link` / `global_rank` are gone: personal (UserGameRank)
    # or now labelled entries in `links`.

    person_links: Mapped[list[GamePerson]] = relationship(
        "GamePerson", back_populates="game", cascade="all, delete-orphan",
        foreign_keys="GamePerson.game_id",
    )
    genres: Mapped[list[Genre]] = relationship("Genre", secondary=game_genres_junction)
    platforms: Mapped[list[GamePlatform]] = relationship("GamePlatform", secondary=game_platforms_junction)
    soundtrack_albums: Mapped[list[Album]] = relationship(
        "Album", secondary=album_game_soundtrack, back_populates="soundtrack_games"
    )
    source_books = relationship("Book", secondary=book_game_adaptations, back_populates="adaptation_games")
    links = relationship("GameLink", cascade="all, delete-orphan", order_by="GameLink.position")
