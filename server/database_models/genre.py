from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .game_genre_category import game_genre_category_members
from .genre_category import genre_category_members
from .genre_parent import genre_parents
from .movie_genre_category import movie_genre_category_members
from .television_genre_category import television_genre_category_members

if TYPE_CHECKING:
    from .game_genre_category import GameGenreCategory
    from .genre_category import GenreCategory
    from .movie_genre_category import MovieGenreCategory
    from .television_genre_category import TelevisionGenreCategory


class Genre(Base):
    __tablename__ = "genres"
    __table_args__ = (
        CheckConstraint("is_music OR is_movie OR is_game OR is_television", name="chk_genre_has_media_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    synonyms: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    notes: Mapped[str | None] = mapped_column(Text)
    is_music: Mapped[bool] = mapped_column(server_default="false")
    is_movie: Mapped[bool] = mapped_column(server_default="false")
    is_game: Mapped[bool] = mapped_column(server_default="false")
    is_television: Mapped[bool] = mapped_column(server_default="false")

    music_categories: Mapped[list["GenreCategory"]] = relationship(
        "GenreCategory", secondary=genre_category_members, back_populates="genres"
    )
    movie_categories: Mapped[list["MovieGenreCategory"]] = relationship(
        "MovieGenreCategory", secondary=movie_genre_category_members, back_populates="genres"
    )
    game_categories: Mapped[list["GameGenreCategory"]] = relationship(
        "GameGenreCategory", secondary=game_genre_category_members, back_populates="genres"
    )
    television_categories: Mapped[list["TelevisionGenreCategory"]] = relationship(
        "TelevisionGenreCategory", secondary=television_genre_category_members, back_populates="genres"
    )

    parents: Mapped[list[Genre]] = relationship(
        "Genre",
        secondary=genre_parents,
        primaryjoin=lambda: Genre.id == genre_parents.c.genre_id,
        secondaryjoin=lambda: Genre.id == genre_parents.c.parent_genre_id,
        back_populates="children",
    )
    children: Mapped[list[Genre]] = relationship(
        "Genre",
        secondary=genre_parents,
        primaryjoin=lambda: Genre.id == genre_parents.c.parent_genre_id,
        secondaryjoin=lambda: Genre.id == genre_parents.c.genre_id,
        back_populates="parents",
    )
