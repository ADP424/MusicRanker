from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .security import CSRF_COOKIE, CSRF_HEADER, SECURE_COOKIES, csrf_ok, new_token

SAFE = {"GET", "HEAD", "OPTIONS"}


def _csrf_cookie_header() -> str:
    r = Response()
    r.set_cookie(CSRF_COOKIE, new_token(), httponly=False, samesite="lax", secure=SECURE_COOKIES, path="/")
    return r.headers["set-cookie"]


class CsrfMiddleware:
    """Double-submit. The cookie is readable by JS (that's the point); an
    attacker on another origin can neither read it nor set our header.

    Login and register are *included*: login CSRF (forcing you into the
    attacker's account) is a real attack. The cookie is minted on any request
    that lacks one, so a cold client does a GET first and is then armed.

    Plain ASGI rather than BaseHTTPMiddleware, which buffers responses and
    breaks context propagation; and installed inside CORS, so its refusals
    still carry CORS headers a browser will let the page read.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        conn = HTTPConnection(scope)
        cookie = conn.cookies.get(CSRF_COOKIE)
        if scope["method"] not in SAFE:
            if not cookie:
                await JSONResponse({"detail": "Missing CSRF cookie"}, status_code=403)(scope, receive, send)
                return
            if not csrf_ok(cookie, conn.headers.get(CSRF_HEADER)):
                await JSONResponse({"detail": "CSRF check failed"}, status_code=403)(scope, receive, send)
                return
        if cookie:
            await self.app(scope, receive, send)
            return

        async def send_minting(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).append("set-cookie", _csrf_cookie_header())
            await send(message)

        await self.app(scope, receive, send_minting)
