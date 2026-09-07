from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .guild_role import GuildRole, guild_role_type
from .mixins import utcnow

if TYPE_CHECKING:
    from .user import User


class Guild(Base):
    __tablename__ = "guilds"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)  # B6: not unique
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    members: Mapped[list[GuildMember]] = relationship(
        "GuildMember", back_populates="guild", cascade="all, delete-orphan"
    )


class GuildMember(Base):
    __tablename__ = "guild_members"
    __table_args__ = (
        # B3: exactly one owner per guild, enforced by Postgres. A column-vs-enum
        # comparison is not a SQL predicate — the index needs a literal fragment.
        Index("uq_guild_single_owner", "guild_id", unique=True, postgresql_where=text("role = 'owner'")),
    )

    guild_id: Mapped[int] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[GuildRole] = mapped_column(guild_role_type)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    guild: Mapped[Guild] = relationship("Guild", back_populates="members")
    user: Mapped[User] = relationship("User", back_populates="memberships")
