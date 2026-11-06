"""In-process fixed-window limiter. One origin, one process — adequate.
Swap the `_HITS` dict for Redis if you ever scale out.

Behind a reverse proxy every request arrives from the proxy's address, which
would make the per-IP limits global. Set `TRUSTED_PROXY_HOPS` to the number of
proxies in front of the app and the client address is read from
`X-Forwarded-For` instead (counting from the right, which only proxies append to).
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict

from fastapi import HTTPException, Request

TRUSTED_PROXY_HOPS = int(os.environ.get("TRUSTED_PROXY_HOPS", "0"))

_HITS: dict[tuple[str, str], list[float]] = defaultdict(list)
_LOCK = threading.Lock()
_LAST_SWEEP = time.monotonic()
_SWEEP_EVERY = 600.0
_MAX_WINDOW = 3600.0


def client_ip(request: Request) -> str:
    if TRUSTED_PROXY_HOPS > 0:
        chain = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(chain) >= TRUSTED_PROXY_HOPS:
            return chain[-TRUSTED_PROXY_HOPS]
    return request.client.host if request.client else "unknown"


def _sweep(now: float) -> None:
    """Drop keys whose hits have all aged out, so the dict can't grow forever."""
    global _LAST_SWEEP
    if now - _LAST_SWEEP < _SWEEP_EVERY:
        return
    _LAST_SWEEP = now
    for key in [k for k, hits in _HITS.items() if not hits or now - hits[-1] > _MAX_WINDOW]:
        del _HITS[key]


def hit(scope: str, ident: str, *, times: int, seconds: float) -> None:
    """Record one hit for (scope, ident); 429 if the window is already full."""
    now = time.monotonic()
    key = (scope, ident)
    with _LOCK:
        _sweep(now)
        hits = [t for t in _HITS[key] if now - t < seconds]
        if len(hits) >= times:
            retry = int(seconds - (now - hits[0])) + 1
            raise HTTPException(429, f"Too many requests; retry in {retry}s")
        hits.append(now)
        _HITS[key] = hits


def limit(scope: str, *, times: int, seconds: float):
    def dep(request: Request) -> None:
        hit(scope, client_ip(request), times=times, seconds=seconds)

    return dep


login_limit = limit("login", times=10, seconds=300)
register_limit = limit("register", times=5, seconds=3600)
