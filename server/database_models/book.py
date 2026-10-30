from __future__ import annotations

from sqlalchemy import CheckConstraint, Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .junctions import (
    book_game_adaptations, book_genres, book_movie_adaptations, book_television_show_adaptations,
)
from .mixins import Audited, GuildScoped, NormalizedNames, guild_unique


class Book(GuildScoped, Audited, NormalizedNames, Base):
    """Ranked directly, like a movie. Authors and contributors are people
    (`BookPerson`), not a separate entity."""

    __tablename__ = "books"
    __table_args__ = (
        guild_unique("books"),
        Index("idx_books_guild_norm", "guild_id", "name_norm"),
        CheckConstraint("word_count >= 0", name="chk_book_word_count_min"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    # Optional: unlike an album's runtime, a word count often just isn't known.
    word_count: Mapped[int | None]
    release_year: Mapped[int]
    alias: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    person_links = relationship("BookPerson", back_populates="book", cascade="all, delete-orphan",
                                foreign_keys="BookPerson.book_id")
    genres = relationship("Genre", secondary=book_genres)
    adaptation_movies = relationship("Movie", secondary=book_movie_adaptations, back_populates="source_books")
    adaptation_games = relationship("Game", secondary=book_game_adaptations, back_populates="source_books")
    adaptation_television_shows = relationship("TelevisionShow", secondary=book_television_show_adaptations,
                                               back_populates="source_books")
    links = relationship("BookLink", cascade="all, delete-orphan", order_by="BookLink.position")
