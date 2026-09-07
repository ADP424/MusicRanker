from __future__ import annotations

from sqlalchemy import CheckConstraint, Index, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .categories import (
    game_genre_category_members, genre_category_members,
    movie_genre_category_members, television_genre_category_members,
)
from .genre_parent import genre_parents
from .mixins import Audited, GuildScoped, NormalizedNames, guild_unique


class Genre(GuildScoped, Audited, NormalizedNames, Base):
    __tablename__ = "genres"
    __table_args__ = (
        guild_unique("genres"),
        CheckConstraint("is_music OR is_movie OR is_game OR is_television", name="chk_genre_has_media_type"),
        Index("idx_genres_guild_norm", "guild_id", "name_norm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    synonyms: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    notes: Mapped[str | None] = mapped_column(Text)
    is_music: Mapped[bool] = mapped_column(server_default="false")
    is_movie: Mapped[bool] = mapped_column(server_default="false")
    is_game: Mapped[bool] = mapped_column(server_default="false")
    is_television: Mapped[bool] = mapped_column(server_default="false")

    music_categories = relationship("GenreCategory", secondary=genre_category_members, back_populates="genres")
    movie_categories = relationship("MovieGenreCategory", secondary=movie_genre_category_members,
                                    back_populates="genres")
    game_categories = relationship("GameGenreCategory", secondary=game_genre_category_members, back_populates="genres")
    television_categories = relationship("TelevisionGenreCategory", secondary=television_genre_category_members,
                                         back_populates="genres")

    parents = relationship(
        "Genre", secondary=genre_parents,
        primaryjoin=lambda: Genre.id == genre_parents.c.genre_id,
        secondaryjoin=lambda: Genre.id == genre_parents.c.parent_genre_id,
        back_populates="children",
    )
    children = relationship(
        "Genre", secondary=genre_parents,
        primaryjoin=lambda: Genre.id == genre_parents.c.parent_genre_id,
        secondaryjoin=lambda: Genre.id == genre_parents.c.genre_id,
        back_populates="parents",
    )
