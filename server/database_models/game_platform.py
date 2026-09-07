from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Text

from .base import Base
from .categories import game_platform_category_members
from .junctions import game_platform_parents
from .mixins import Audited, GuildScoped, guild_unique

if TYPE_CHECKING:
    from .categories import GamePlatformCategory


class GamePlatform(GuildScoped, Audited, Base):
    """Hierarchical platform taxonomy, e.g. PlayStation -> PlayStation 4."""

    __tablename__ = "game_platforms"
    __table_args__ = (guild_unique("game_platforms"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    synonyms: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    notes: Mapped[str | None] = mapped_column(Text)

    categories: Mapped[list["GamePlatformCategory"]] = relationship(
        "GamePlatformCategory", secondary=game_platform_category_members, back_populates="platforms"
    )

    parents: Mapped[list[GamePlatform]] = relationship(
        "GamePlatform",
        secondary=game_platform_parents,
        primaryjoin=lambda: GamePlatform.id == game_platform_parents.c.platform_id,
        secondaryjoin=lambda: GamePlatform.id == game_platform_parents.c.parent_platform_id,
        back_populates="children",
    )
    children: Mapped[list[GamePlatform]] = relationship(
        "GamePlatform",
        secondary=game_platform_parents,
        primaryjoin=lambda: GamePlatform.id == game_platform_parents.c.parent_platform_id,
        secondaryjoin=lambda: GamePlatform.id == game_platform_parents.c.platform_id,
        back_populates="parents",
    )
