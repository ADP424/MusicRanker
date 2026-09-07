from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

SESSION_COOKIE = "session"
CSRF_COOKIE = "csrftoken"
CSRF_HEADER = "x-csrf-token"
SESSION_TTL = timedelta(days=int(os.environ.get("SESSION_TTL_DAYS", "30")))
SECURE_COOKIES = os.environ.get("SECURE_COOKIES", "false").lower() == "true"

_ph = PasswordHasher()

#: A dummy hash, verified against on unknown usernames so login takes the same
#: time whether or not the account exists.
_DUMMY = _ph.hash("x" * 24)

MIN_PASSWORD_LEN = 10


def hash_password(raw: str) -> str:
    return _ph.hash(raw)


def verify_password(raw: str, stored: str | None) -> bool:
    try:
        _ph.verify(stored or _DUMMY, raw)
        return stored is not None
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(stored: str) -> bool:
    return _ph.check_needs_rehash(stored)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """Sessions are stored hashed. A database dump must not hand over live logins."""
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_ok(cookie: str | None, header: str | None) -> bool:
    return bool(cookie) and bool(header) and hmac.compare_digest(cookie, header)
