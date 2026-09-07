from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .guild_role import GuildRole, guild_role_type
from .mixins import utcnow


class InvitationStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    declined = "declined"
    revoked = "revoked"


invitation_status_type = Enum(InvitationStatus, name="invitation_status")


class GuildInvitation(Base):
    __tablename__ = "guild_invitations"
    __table_args__ = (
        # C3: no expiry, but at most one live invite per (guild, invitee).
        Index("uq_invitation_pending", "guild_id", "invitee_id", unique=True,
              postgresql_where=text("status = 'pending'")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[int] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), index=True)
    inviter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    invitee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[GuildRole] = mapped_column(guild_role_type)
    status: Mapped[InvitationStatus] = mapped_column(invitation_status_type, default=InvitationStatus.pending)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    guild = relationship("Guild")
    invitee = relationship("User", foreign_keys=[invitee_id])
    inviter = relationship("User", foreign_keys=[inviter_id])
