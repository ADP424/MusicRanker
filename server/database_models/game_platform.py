from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Table, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .game_platform_category import game_platform_category_members

if TYPE_CHECKING:
    from .game_platform_category import GamePlatformCategory

game_platform_parents = Table(
    "game_platform_parents",
    Base.metadata,
    Column(
        "platform_id",
        ForeignKey("game_platforms.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "parent_platform_id",
        ForeignKey("game_platforms.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    CheckConstraint(
        "platform_id <> parent_platform_id",
        name="chk_game_platform_not_self_parent",
    ),
    Index("idx_game_platform_parents_parent", "parent_platform_id"),
)


class GamePlatform(Base):
    """Hierarchical platform taxonomy, e.g. PlayStation -> PlayStation 4."""

    __tablename__ = "game_platforms"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
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
