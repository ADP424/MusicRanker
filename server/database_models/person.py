from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import Audited, GuildScoped, NormalizedNames, guild_unique
from .nationality import nationality

if TYPE_CHECKING:
    from .artist_person import ArtistPerson
    ...


class Person(GuildScoped, Audited, NormalizedNames, Base):
    __tablename__ = "people"
    __table_args__ = (
        guild_unique("people"),
        Index("idx_people_guild_norm", "guild_id", "name_norm"),
        Index("idx_people_guild_en_norm", "guild_id", "name_en_norm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    birth_nationality: Mapped[str] = mapped_column(nationality)
    core_nationality: Mapped[str] = mapped_column(nationality)
    notes: Mapped[str | None] = mapped_column(Text)  # guild-visible; personal notes live on the rank rows

    artist_links = relationship("ArtistPerson", back_populates="person", cascade="all, delete-orphan",
                                foreign_keys="ArtistPerson.person_id")
    book_links = relationship("BookPerson", back_populates="person", cascade="all, delete-orphan",
                              foreign_keys="BookPerson.person_id")
    movie_links = relationship("MoviePerson", back_populates="person", cascade="all, delete-orphan",
                               foreign_keys="MoviePerson.person_id")
    game_links = relationship("GamePerson", back_populates="person", cascade="all, delete-orphan",
                              foreign_keys="GamePerson.person_id")
    television_links = relationship("TelevisionShowPerson", back_populates="person", cascade="all, delete-orphan",
                                    foreign_keys="TelevisionShowPerson.person_id")
    television_season_links = relationship(
        "TelevisionSeasonPerson", back_populates="person", cascade="all, delete-orphan",
        foreign_keys="TelevisionSeasonPerson.person_id",
    )
    television_episode_links = relationship(
        "TelevisionEpisodePerson", back_populates="person", cascade="all, delete-orphan",
        foreign_keys="TelevisionEpisodePerson.person_id",
    )
