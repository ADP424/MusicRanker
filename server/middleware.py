from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .security import CSRF_COOKIE, CSRF_HEADER, SECURE_COOKIES, csrf_ok, new_token

SAFE = {"GET", "HEAD", "OPTIONS"}


class CsrfMiddleware(BaseHTTPMiddleware):
    """Double-submit. The cookie is readable by JS (that's the point); an
    attacker on another origin can neither read it nor set our header.

    Login and register are *included*: login CSRF (forcing you into the
    attacker's account) is a real attack. The cookie is minted on any request
    that lacks one, so a cold client does a GET first and is then armed.
    """

    async def dispatch(self, request, call_next):
        cookie = request.cookies.get(CSRF_COOKIE)
        if request.method not in SAFE and not cookie:
            return JSONResponse({"detail": "Missing CSRF cookie"}, status_code=403)
        if request.method not in SAFE and not csrf_ok(cookie, request.headers.get(CSRF_HEADER)):
            return JSONResponse({"detail": "CSRF check failed"}, status_code=403)

        response = await call_next(request)
        if not cookie:
            response.set_cookie(
                CSRF_COOKIE, new_token(), httponly=False,
                samesite="lax", secure=SECURE_COOKIES, path="/",
            )
        return response
