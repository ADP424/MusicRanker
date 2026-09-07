"""In-process fixed-window limiter. One origin, one process — adequate.
Swap the `_HITS` dict for Redis if you ever scale out."""
from __future__ import annotations

import threading
import time
from collections import defaultdict

from fastapi import HTTPException, Request

_HITS: dict[tuple[str, str], list[float]] = defaultdict(list)
_LOCK = threading.Lock()


def limit(scope: str, *, times: int, seconds: float):
    def dep(request: Request) -> None:
        ident = request.client.host if request.client else "unknown"
        now = time.monotonic()
        key = (scope, ident)
        with _LOCK:
            hits = [t for t in _HITS[key] if now - t < seconds]
            if len(hits) >= times:
                retry = int(seconds - (now - hits[0])) + 1
                raise HTTPException(429, f"Too many requests; retry in {retry}s")
            hits.append(now)
            _HITS[key] = hits

    return dep


login_limit = limit("login", times=10, seconds=300)
register_limit = limit("register", times=5, seconds=3600)
import_limit = limit("import", times=60, seconds=3600)
