from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Column, ForeignKey, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .game_platform import GamePlatform

game_platform_category_members = Table(
    "game_platform_category_members",
    Base.metadata,
    Column("platform_id", ForeignKey("game_platforms.id", ondelete="CASCADE"), primary_key=True),
    Column("category_id", ForeignKey("game_platform_categories.id", ondelete="CASCADE"), primary_key=True),
)


class GamePlatformCategory(Base):
    __tablename__ = "game_platform_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)

    platforms: Mapped[list["GamePlatform"]] = relationship(
        "GamePlatform", secondary=game_platform_category_members, back_populates="categories"
    )
