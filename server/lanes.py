"""Fair FIFO gates in front of each external provider.

G4: "only one call being made and awaited to TMDB or IGDB at a time." Both the
synchronous lookup endpoints and the background scan/import jobs route their
HTTP calls through the same lane, so there is exactly one outbound request per
provider in flight, and waiters are served strictly in arrival order.

`concurrency` is the single knob to widen later.
"""
from __future__ import annotations

import itertools
import os
import threading
from collections import deque
from contextlib import contextmanager


class Lane:
    def __init__(self, name: str, concurrency: int = 1):
        self.name = name
        self.concurrency = concurrency
        self._cv = threading.Condition()
        self._waiting: deque[int] = deque()
        self._active = 0
        self._tickets = itertools.count()

    @property
    def depth(self) -> int:
        with self._cv:
            return len(self._waiting) + self._active

    @contextmanager
    def slot(self, timeout: float | None = 300.0):
        ticket = next(self._tickets)
        with self._cv:
            self._waiting.append(ticket)
            ready = self._cv.wait_for(
                lambda: self._waiting and self._waiting[0] == ticket and self._active < self.concurrency,
                timeout,
            )
            if not ready:
                self._waiting.remove(ticket)
                self._cv.notify_all()
                raise TimeoutError(f"Timed out waiting for the {self.name} queue")
            self._waiting.popleft()
            self._active += 1
        try:
            yield
        finally:
            with self._cv:
                self._active -= 1
                self._cv.notify_all()


TMDB_LANE = Lane("tmdb", int(os.environ.get("TMDB_CONCURRENCY", "1")))
IGDB_LANE = Lane("igdb", int(os.environ.get("IGDB_CONCURRENCY", "1")))
