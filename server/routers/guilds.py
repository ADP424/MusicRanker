from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from .. import nationalities
from ..api_models.guild import GuildNameIn, InviteIn, RoleIn, TransferIn
from ..authz import MAX_OWNED_GUILDS, Capability, ROLE_CAPS, can_assign, can_manage_member
from ..database import get_database
from ..database_models import Guild, GuildMember, User
from ..database_models.comparisons import Comparison
from ..database_models.guild_role import GuildRole
from ..database_models.invitation import GuildInvitation, InvitationStatus
from ..database_models.mixins import utcnow
from ..database_models.ranking import UserRank
from ..deps import current_user, guild_ctx
from ..normalize import norm

router = APIRouter(tags=["guilds"])


class GuildOut(BaseModel):
    id: int
    name: str
    role: GuildRole
    capabilities: list[Capability]
    member_count: int


class MemberOut(BaseModel):
    user_id: int
    username: str
    role: GuildRole


def _owned_count(db: DbSession, user_id: int) -> int:
    return db.scalar(
        select(func.count()).select_from(GuildMember)
        .where(GuildMember.user_id == user_id, GuildMember.role == GuildRole.owner)
    )


def _purge_member_data(db: DbSession, guild_id: int, user_id: int) -> None:
    """A member's personal layer (ranks, notes, pairwise answers) belongs to their
    membership; it has no FK to guild_members, so remove it explicitly."""
    for model in (*UserRank.__subclasses__(), *Comparison.__subclasses__()):
        db.execute(delete(model).where(model.guild_id == guild_id, model.user_id == user_id))


def _guild_out(db: DbSession, m: GuildMember) -> GuildOut:
    n = db.scalar(select(func.count()).select_from(GuildMember).where(GuildMember.guild_id == m.guild_id))
    return GuildOut(id=m.guild_id, name=m.guild.name, role=m.role,
                    capabilities=sorted(ROLE_CAPS[m.role], key=lambda c: c.value), member_count=n)


@router.get("/guilds", response_model=list[GuildOut])
def my_guilds(user: User = Depends(current_user), db: DbSession = Depends(get_database, scope="function")):
    rows = db.scalars(select(GuildMember).where(GuildMember.user_id == user.id)).all()
    return [_guild_out(db, m) for m in rows]


@router.post("/guilds", response_model=GuildOut, status_code=201)
def create_guild(body: GuildNameIn, user: User = Depends(current_user), db: DbSession = Depends(get_database, scope="function")):
    if _owned_count(db, user.id) >= MAX_OWNED_GUILDS:
        raise HTTPException(409, f"You already own {MAX_OWNED_GUILDS} guilds")
    guild = Guild(name=body.name, created_by_user_id=user.id)
    db.add(guild)
    db.flush()
    nationalities.seed_defaults(db, guild.id)
    m = GuildMember(guild_id=guild.id, user_id=user.id, role=GuildRole.owner)
    db.add(m)
    db.flush()
    return _guild_out(db, m)


@router.patch("/guilds/{guild_id}", response_model=GuildOut)
def rename_guild(guild_id: int, body: GuildNameIn, ctx=Depends(guild_ctx(Capability.GUILD_SETTINGS)),
                 db: DbSession = Depends(get_database, scope="function")):
    db.get(Guild, guild_id).name = body.name
    return _guild_out(db, db.get(GuildMember, (guild_id, ctx.user_id)))


@router.delete("/guilds/{guild_id}", status_code=204)
def delete_guild(guild_id: int, ctx=Depends(guild_ctx(Capability.GUILD_DELETE)),
                 db: DbSession = Depends(get_database, scope="function")):
    """There is exactly one owner (DB-enforced), so the owner always sees Delete
    and everyone else always sees Leave. No orphan is reachable."""
    db.delete(db.get(Guild, guild_id))


@router.post("/guilds/{guild_id}/leave", status_code=204)
def leave_guild(guild_id: int, ctx=Depends(guild_ctx(Capability.VIEW)), db: DbSession = Depends(get_database, scope="function")):
    if ctx.role is GuildRole.owner:
        raise HTTPException(409, "Transfer ownership or delete the guild instead")
    db.delete(db.get(GuildMember, (guild_id, ctx.user_id)))
    _purge_member_data(db, guild_id, ctx.user_id)


@router.post("/guilds/{guild_id}/transfer-ownership", status_code=204)
def transfer(guild_id: int, body: TransferIn, ctx=Depends(guild_ctx(Capability.TRANSFER_OWNERSHIP)),
             db: DbSession = Depends(get_database, scope="function")):
    target = db.get(GuildMember, (guild_id, body.user_id))
    if target is None:
        raise HTTPException(404, "That user is not a member")
    if _owned_count(db, target.user_id) >= MAX_OWNED_GUILDS:
        raise HTTPException(409, "That user already owns the maximum number of guilds")
    if target.user_id == ctx.user_id:
        raise HTTPException(422, "You already own this guild")
    me = db.get(GuildMember, (guild_id, ctx.user_id))
    # Step down first: the partial unique index forbids two owners for an instant.
    me.role = GuildRole.manager
    db.flush()
    target.role = GuildRole.owner


# ── Members ──────────────────────────────────────────────────────────────────
@router.get("/guilds/{guild_id}/members", response_model=list[MemberOut])
def members(guild_id: int, ctx=Depends(guild_ctx(Capability.VIEW)), db: DbSession = Depends(get_database, scope="function")):
    rows = db.scalars(select(GuildMember).where(GuildMember.guild_id == guild_id)).all()
    return [MemberOut(user_id=m.user_id, username=m.user.username, role=m.role) for m in rows]


@router.patch("/guilds/{guild_id}/members/{user_id}", status_code=204)
def set_role(guild_id: int, user_id: int, body: RoleIn,
             ctx=Depends(guild_ctx(Capability.MANAGE_MEMBERS)), db: DbSession = Depends(get_database, scope="function")):
    member = db.get(GuildMember, (guild_id, user_id))
    if member is None:
        raise HTTPException(404, "Not a member")
    new_role = body.role
    if not can_manage_member(ctx.role, member.role) or not can_assign(ctx.role, new_role):
        raise HTTPException(403, "Only the owner may grant or revoke the manager role")
    member.role = new_role


@router.delete("/guilds/{guild_id}/members/{user_id}", status_code=204)
def remove_member(guild_id: int, user_id: int,
                  ctx=Depends(guild_ctx(Capability.MANAGE_MEMBERS)), db: DbSession = Depends(get_database, scope="function")):
    member = db.get(GuildMember, (guild_id, user_id))
    if member is None:
        raise HTTPException(404, "Not a member")
    if not can_manage_member(ctx.role, member.role):
        raise HTTPException(403, "You cannot remove that member")
    db.delete(member)
    _purge_member_data(db, guild_id, user_id)


# ── Invitations (C3: invite-only, no expiry, revocable) ──────────────────────
@router.post("/guilds/{guild_id}/invitations", status_code=201)
def invite(guild_id: int, body: InviteIn, ctx=Depends(guild_ctx(Capability.MANAGE_MEMBERS)),
           db: DbSession = Depends(get_database, scope="function")):
    ident, role = body.identifier, body.role
    if not can_assign(ctx.role, role):
        raise HTTPException(403, "You cannot invite at that role")
    invitee = db.scalar(
        select(User).where((User.username_norm == norm(ident)) | (User.email_norm == ident.casefold()))
    )
    # Usernames are visible to fellow members anyway; an email address must not
    # reveal whether it has an account, so every outcome for one looks the same.
    by_email = "@" in ident
    if invitee is None:
        if by_email:
            return {"id": None}
        raise HTTPException(404, "No such user")
    if db.get(GuildMember, (guild_id, invitee.id)):
        if by_email:
            return {"id": None}
        raise HTTPException(409, "Already a member")
    if db.scalar(select(GuildInvitation).where(
        GuildInvitation.guild_id == guild_id, GuildInvitation.invitee_id == invitee.id,
        GuildInvitation.status == InvitationStatus.pending,
    )):
        if by_email:
            return {"id": None}
        raise HTTPException(409, "That user already has a pending invitation")
    inv = GuildInvitation(guild_id=guild_id, inviter_id=ctx.user_id, invitee_id=invitee.id, role=role)
    db.add(inv)
    db.flush()
    return {"id": None if by_email else inv.id}


@router.get("/guilds/{guild_id}/invitations")
def list_invitations(guild_id: int, ctx=Depends(guild_ctx(Capability.MANAGE_MEMBERS)),
                     db: DbSession = Depends(get_database, scope="function")):
    rows = db.scalars(
        select(GuildInvitation).where(GuildInvitation.guild_id == guild_id,
                                      GuildInvitation.status == InvitationStatus.pending)
    ).all()
    return [{"id": i.id, "username": i.invitee.username, "role": i.role} for i in rows]


@router.delete("/guilds/{guild_id}/invitations/{inv_id}", status_code=204)
def revoke(guild_id: int, inv_id: int, ctx=Depends(guild_ctx(Capability.MANAGE_MEMBERS)),
           db: DbSession = Depends(get_database, scope="function")):
    inv = db.get(GuildInvitation, inv_id)
    if inv is None or inv.guild_id != guild_id:
        raise HTTPException(404, "No such invitation")
    inv.status, inv.responded_at = InvitationStatus.revoked, utcnow()


@router.get("/invitations")
def my_invitations(user: User = Depends(current_user), db: DbSession = Depends(get_database, scope="function")):
    rows = db.scalars(
        select(GuildInvitation).where(GuildInvitation.invitee_id == user.id,
                                      GuildInvitation.status == InvitationStatus.pending)
    ).all()
    return [{"id": i.id, "guild_id": i.guild_id, "guild_name": i.guild.name,
             "role": i.role, "inviter": i.inviter.username if i.inviter else None} for i in rows]


@router.post("/invitations/{inv_id}/accept", status_code=204)
def accept(inv_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_database, scope="function")):
    inv = db.get(GuildInvitation, inv_id)
    if inv is None or inv.invitee_id != user.id or inv.status is not InvitationStatus.pending:
        raise HTTPException(404, "No such invitation")
    if not db.get(GuildMember, (inv.guild_id, user.id)):
        db.add(GuildMember(guild_id=inv.guild_id, user_id=user.id, role=inv.role))
    inv.status, inv.responded_at = InvitationStatus.accepted, utcnow()


@router.post("/invitations/{inv_id}/decline", status_code=204)
def decline(inv_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_database, scope="function")):
    inv = db.get(GuildInvitation, inv_id)
    if inv is None or inv.invitee_id != user.id or inv.status is not InvitationStatus.pending:
        raise HTTPException(404, "No such invitation")
    inv.status, inv.responded_at = InvitationStatus.declined, utcnow()
