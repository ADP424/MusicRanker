from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import utcnow

if TYPE_CHECKING:
    from .guild import GuildMember


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("uq_users_username_lower", "username_norm", unique=True),
        Index("uq_users_email_lower", "email_norm", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(Text)
    username_norm: Mapped[str] = mapped_column(Text)  # casefolded; uniqueness key (C1)
    email: Mapped[str] = mapped_column(Text)
    email_norm: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list[GuildMember]] = relationship(
        "GuildMember", back_populates="user", cascade="all, delete-orphan"
    )


class Session(Base):
    """Opaque server-side session. We store only a SHA-256 of the token, so a
    database dump does not hand over live sessions. Revocation is a DELETE."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    csrf_token: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    user_agent: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(Text)

    user: Mapped[User] = relationship("User")
