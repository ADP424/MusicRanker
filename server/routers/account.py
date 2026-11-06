"""Your own account: profile, password, sessions, export, deletion.

Every change that proves who you are (password, email, deleting the account)
asks for the current password again: a session cookie alone, lifted from an
unlocked laptop, must not be enough to take the account over.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, literal, select
from sqlalchemy.orm import Session as DbSession

from ..database import get_database
from ..database_models import (
    Album, Artist, Book, Game, Guild, GuildMember, Movie, TelevisionEpisode, TelevisionSeason, TelevisionShow, User,
    UserAlbumRank, UserArtistRank, UserBookRank, UserGameRank, UserMovieRank, UserTelevisionEpisodeRank,
    UserTelevisionSeasonRank, UserTelevisionShowRank,
)
from ..database_models.guild_role import GuildRole
from ..database_models.user import Session as AuthSession
from ..deps import current_session, current_user
from ..normalize import norm
from ..ratelimit import hit
from ..security import CSRF_COOKIE, MIN_PASSWORD_LEN, SESSION_COOKIE, hash_password, verify_password

router = APIRouter(prefix="/account", tags=["account"])


def _check_password(user: User, password: str) -> None:
    hit("account-password", str(user.id), times=10, seconds=900)
    if not verify_password(password, user.password_hash):
        raise HTTPException(403, "That password isn't right.")


# ── profile ──────────────────────────────────────────────────────────────────
class ProfileIn(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.\-]+$")
    email: EmailStr | None = None
    current_password: str | None = None  # required to change the email


class ProfileOut(BaseModel):
    id: int
    username: str
    email: str
    created_at: datetime


@router.patch("", response_model=ProfileOut)
def update_profile(body: ProfileIn, user: User = Depends(current_user), db: DbSession = Depends(get_database, scope="function")):
    if body.email is not None and body.email != user.email:
        if body.current_password is None:
            raise HTTPException(422, "Changing your email needs your current password.")
        _check_password(user, body.current_password)
        user.email, user.email_norm = body.email, norm(body.email)
    if body.username is not None:
        user.username, user.username_norm = body.username, norm(body.username)
    db.flush()  # a taken name or email is a unique-index violation -> 409
    return ProfileOut(id=user.id, username=user.username, email=user.email, created_at=user.created_at)


# ── password ─────────────────────────────────────────────────────────────────
class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=MIN_PASSWORD_LEN, max_length=256)


@router.post("/password", status_code=204)
def change_password(
    body: PasswordIn,
    sess: AuthSession = Depends(current_session),
    db: DbSession = Depends(get_database, scope="function"),
):
    user = sess.user
    _check_password(user, body.current_password)
    user.password_hash = hash_password(body.new_password)
    # Whoever else is signed in with the old password is signed out.
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.id != sess.id))


# ── sessions ─────────────────────────────────────────────────────────────────
class SessionOut(BaseModel):
    id: int
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    user_agent: str | None
    ip: str | None
    current: bool


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(sess: AuthSession = Depends(current_session), db: DbSession = Depends(get_database, scope="function")):
    rows = db.scalars(
        select(AuthSession).where(AuthSession.user_id == sess.user_id).order_by(AuthSession.last_seen_at.desc())
    ).all()
    return [
        SessionOut(id=s.id, created_at=s.created_at, last_seen_at=s.last_seen_at, expires_at=s.expires_at,
                   user_agent=s.user_agent, ip=s.ip, current=s.id == sess.id)
        for s in rows
    ]


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(session_id: int, sess: AuthSession = Depends(current_session), db: DbSession = Depends(get_database, scope="function")):
    if session_id == sess.id:
        raise HTTPException(422, "That's this session; sign out instead.")
    db.execute(delete(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == sess.user_id))


@router.post("/sessions/revoke-others", status_code=204)
def revoke_other_sessions(sess: AuthSession = Depends(current_session), db: DbSession = Depends(get_database, scope="function")):
    db.execute(delete(AuthSession).where(AuthSession.user_id == sess.user_id, AuthSession.id != sess.id))


# ── deletion ─────────────────────────────────────────────────────────────────
class DeleteIn(BaseModel):
    password: str


@router.post("/delete", status_code=204)
def delete_account(body: DeleteIn, response: Response, user: User = Depends(current_user),
                   db: DbSession = Depends(get_database, scope="function")):
    """Refused while you own a guild with other members: that guild would be
    left without an owner. A guild only you are in goes with the account."""
    _check_password(user, body.password)
    owned = db.scalars(
        select(Guild).join(GuildMember, GuildMember.guild_id == Guild.id)
        .where(GuildMember.user_id == user.id, GuildMember.role == GuildRole.owner)
    ).all()
    blocking = [g.name for g in owned if db.scalar(
        select(GuildMember.user_id).where(GuildMember.guild_id == g.id, GuildMember.user_id != user.id).limit(1)
    ) is not None]
    if blocking:
        raise HTTPException(409, "Transfer ownership of these guilds first, or delete them: " + ", ".join(blocking))
    for g in owned:
        db.delete(g)
    db.delete(user)
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


# ── export ───────────────────────────────────────────────────────────────────
#: (list name, rank table, entity table, entity column, count column, scope: (label, table, column))
_LISTS = [
    ("artists", UserArtistRank, Artist, "artist_id", None, None),
    ("albums", UserAlbumRank, Album, "album_id", "listens", ("artist", Artist, "artist_id")),
    ("books", UserBookRank, Book, "book_id", "reads", None),
    ("movies", UserMovieRank, Movie, "movie_id", "watches", None),
    ("games", UserGameRank, Game, "game_id", "hours_played", None),
    ("tv_shows", UserTelevisionShowRank, TelevisionShow, "show_id", None, None),
    ("tv_seasons", UserTelevisionSeasonRank, TelevisionSeason, "season_id", None, ("show", TelevisionShow, "show_id")),
    ("tv_episodes", UserTelevisionEpisodeRank, TelevisionEpisode, "episode_id", "watches", ("season", TelevisionSeason, "season_id")),
]


def _export_rows(db: DbSession, user_id: int):
    guilds = dict(db.execute(
        select(Guild.id, Guild.name).join(GuildMember, GuildMember.guild_id == Guild.id).where(GuildMember.user_id == user_id)
    ).all())
    for name, rank, model, col, count, scope in _LISTS:
        ecol = getattr(rank, col)
        year = model.release_year if hasattr(model, "release_year") else literal(None)
        amount = getattr(rank, count) if count else literal(None)
        stmt = (
            select(rank.guild_id.label("guild_id"), model.name.label("name"), year.label("year"),
                   rank.notes.label("notes"), amount.label("amount"))
            .join(model, (model.id == ecol) & (model.guild_id == rank.guild_id))
            .where(rank.user_id == user_id)
        )
        order = [rank.guild_id]
        if scope:
            _, stable, scol = scope
            stmt = stmt.add_columns(stable.name.label("within")).join(stable, stable.id == getattr(rank, scol))
            order.append(getattr(rank, scol))
        else:
            stmt = stmt.add_columns(literal(None).label("within"))
        position: dict[tuple, int] = {}
        for r in db.execute(stmt.order_by(*order, rank.rank, ecol)).mappings():
            key = (r["guild_id"], r["within"])
            position[key] = position.get(key, 0) + 1
            amount = r["amount"]
            yield {
                "guild": guilds.get(r["guild_id"], str(r["guild_id"])),
                "list": name,
                "within": r["within"],  # the artist of an album, the show of a season, the season of an episode
                "position": position[key],
                "name": r["name"],
                "year": r["year"],
                **({count: float(amount) if count == "hours_played" and amount is not None else amount} if count else {}),
                "notes": r["notes"],
            }


@router.get("/export")
def export(format: Literal["json", "csv"] = "json", user: User = Depends(current_user),
           db: DbSession = Depends(get_database, scope="function")):
    """Every list you keep, in every guild, best first."""
    rows = list(_export_rows(db, user.id))
    stamp = datetime.now().strftime("%Y-%m-%d")
    filename = f"rankings-{user.username}-{stamp}.{format}"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if format == "json":
        return JSONResponse({"user": user.username, "exported": stamp, "items": rows}, headers=headers)
    buf = io.StringIO()
    fields = ["guild", "list", "within", "position", "name", "year", "listens", "reads", "watches", "hours_played", "notes"]
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)

