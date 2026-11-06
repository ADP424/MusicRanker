from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .. import nationalities
from ..database import get_database
from ..database_models import Guild, GuildMember, User
from ..database_models.guild_role import GuildRole
from ..database_models.mixins import utcnow
from ..database_models.user import Session as AuthSession
from ..deps import current_session, current_user
from ..normalize import norm
from ..ratelimit import client_ip, hit, login_limit, register_limit
from ..security import (
    CSRF_COOKIE, SECURE_COOKIES, SESSION_COOKIE, SESSION_TTL, MIN_PASSWORD_LEN,
    hash_password, needs_rehash, new_token, token_hash, verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.\-]+$")
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LEN, max_length=256)


class LoginIn(BaseModel):
    identifier: str  # username or email
    password: str


class MeOut(BaseModel):
    id: int
    username: str
    email: str


def _issue(response: Response, db: DbSession, user: User, request: Request) -> None:
    raw, csrf = new_token(), new_token()
    db.add(AuthSession(
        user_id=user.id, token_hash=token_hash(raw),
        csrf_token=csrf,
        expires_at=utcnow() + SESSION_TTL,
        user_agent=request.headers.get("user-agent"),
        ip=client_ip(request),
    ))
    user.last_login_at = utcnow()
    response.set_cookie(
        SESSION_COOKIE, raw, httponly=True, samesite="lax",
        secure=SECURE_COOKIES, path="/", max_age=int(SESSION_TTL.total_seconds()),
    )
    # Rotate the CSRF token at the privilege boundary, so a token planted or
    # observed before login is worthless after it.
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, samesite="lax", secure=SECURE_COOKIES, path="/")


@router.post("/register", response_model=MeOut, status_code=201, dependencies=[Depends(register_limit)])
def register(body: RegisterIn, request: Request, response: Response, db: DbSession = Depends(get_database, scope="function")):
    uname, email = norm(body.username), body.email.strip().casefold()
    if db.scalar(select(User).where(User.username_norm == uname)):
        raise HTTPException(409, "That username is taken")
    if db.scalar(select(User).where(User.email_norm == email)):
        raise HTTPException(409, "That email is already registered")

    user = User(
        username=body.username, username_norm=uname,
        email=body.email, email_norm=email,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.flush()

    # B2: the personal guild is an ordinary guild in every respect. It just
    # happens to be created here, and it counts against the 3-owner cap.
    guild = Guild(name=f"{body.username}'s Guild", created_by_user_id=user.id)
    db.add(guild)
    db.flush()
    nationalities.seed_defaults(db, guild.id)
    db.add(GuildMember(guild_id=guild.id, user_id=user.id, role=GuildRole.owner))

    _issue(response, db, user, request)
    return MeOut(id=user.id, username=user.username, email=user.email)


@router.post("/login", response_model=MeOut, dependencies=[Depends(login_limit)])
def login(body: LoginIn, request: Request, response: Response, db: DbSession = Depends(get_database, scope="function")):
    ident = body.identifier.strip()
    # Per-account limit on top of the per-IP one: guessing against one account
    # is capped no matter how many addresses it comes from.
    hit("login-account", norm(ident), times=10, seconds=900)
    user = db.scalar(
        select(User).where((User.username_norm == norm(ident)) | (User.email_norm == ident.casefold()))
    )
    # verify_password runs against a dummy hash when the user is absent, so the
    # response time does not leak whether the account exists.
    if not verify_password(body.password, user.password_hash if user else None) or not user.is_active:
        raise HTTPException(401, "Invalid credentials")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    _issue(response, db, user, request)
    return MeOut(id=user.id, username=user.username, email=user.email)


@router.post("/logout", status_code=204)
def logout(response: Response, sess: AuthSession = Depends(current_session), db: DbSession = Depends(get_database, scope="function")):
    db.delete(sess)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)):
    return MeOut(id=user.id, username=user.username, email=user.email)
