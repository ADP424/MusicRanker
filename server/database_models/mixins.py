from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, declared_attr, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def guild_unique(tablename: str) -> UniqueConstraint:
    """The companion to `GuildScoped.guild_id`.

    UNIQUE(id, guild_id) is what lets every junction table carry a *composite*
    foreign key, so Postgres itself refuses to link Guild A's movie to Guild B's
    person. A forgotten `WHERE guild_id = ?` then cannot leak data across
    guilds — it can only return nothing.
    """
    return UniqueConstraint("id", "guild_id", name=f"uq_{tablename}_id_guild")


class GuildScoped:
    @declared_attr
    def guild_id(cls) -> Mapped[int]:
        return mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False, index=True)


class Audited:
    @declared_attr
    def created_at(cls) -> Mapped[datetime]:
        return mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    @declared_attr
    def created_by_user_id(cls) -> Mapped[int | None]:
        return mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    @declared_attr
    def updated_at(cls) -> Mapped[datetime]:
        return mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    @declared_attr
    def updated_by_user_id(cls) -> Mapped[int | None]:
        return mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class NormalizedNames:
    """`name_norm` / `name_en_norm`, kept in sync by a Session `before_flush`
    hook (see database.py). Everything that matches names matches on these."""

    @declared_attr
    def name_norm(cls) -> Mapped[str]:
        return mapped_column(Text, nullable=False, index=True)

    @declared_attr
    def name_en_norm(cls) -> Mapped[str | None]:
        return mapped_column(Text, index=True)
