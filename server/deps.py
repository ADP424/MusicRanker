from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .authz import ROLE_CAPS, Capability
from .database import get_database
from .database_models import GuildMember, User
from .database_models.guild_role import GuildRole
from .database_models.mixins import utcnow
from .database_models.user import Session as AuthSession
from .security import SECURE_COOKIES, SESSION_COOKIE, SESSION_TTL, token_hash


def current_session(request: Request, response: Response, db: DbSession = Depends(get_database, scope="function")) -> AuthSession:
    raw = request.cookies.get(SESSION_COOKIE)
    if not raw:
        raise HTTPException(401, "Not authenticated")
    sess = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash(raw)))
    if sess is None or sess.expires_at <= utcnow():
        raise HTTPException(401, "Session expired")
    if not sess.user.is_active:
        raise HTTPException(403, "Account disabled")
    # Sliding expiry, but only write once a day to avoid a UPDATE per request.
    # The cookie's max-age is renewed alongside, or the browser would still
    # drop it SESSION_TTL after login.
    now = utcnow()
    if now - sess.last_seen_at > timedelta(hours=24):
        sess.last_seen_at = now
        sess.expires_at = now + SESSION_TTL
        response.set_cookie(
            SESSION_COOKIE, raw, httponly=True, samesite="lax",
            secure=SECURE_COOKIES, path="/", max_age=int(SESSION_TTL.total_seconds()),
        )
    return sess


def current_user(sess: AuthSession = Depends(current_session)) -> User:
    return sess.user


@dataclass(frozen=True)
class GuildContext:
    guild_id: int
    user_id: int
    role: GuildRole
    caps: frozenset[Capability]

    def has(self, cap: Capability) -> bool:
        return cap in self.caps

    def require(self, cap: Capability) -> None:
        if not self.has(cap):
            raise HTTPException(403, f"Your role ({self.role.value}) lacks '{cap.value}'")


def guild_ctx(*required: Capability):
    """Resolves membership from the path's `guild_id` and enforces capabilities.

    Non-membership is a 404, not a 403: we don't confirm a guild exists to
    someone who isn't in it.
    """

    def dep(
        guild_id: int,
        user: User = Depends(current_user),
        db: DbSession = Depends(get_database, scope="function"),
    ) -> GuildContext:
        member = db.get(GuildMember, (guild_id, user.id))
        if member is None:
            raise HTTPException(404, "Guild not found")
        ctx = GuildContext(guild_id, user.id, member.role, ROLE_CAPS[member.role])
        for cap in required:
            ctx.require(cap)
        return ctx

    dep.required_caps = frozenset(required)  # read by the authorization tests
    return dep
