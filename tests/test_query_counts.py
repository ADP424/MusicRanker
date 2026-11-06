"""No read endpoint's query count may grow with the amount of data: the same
route on a guild with 2 rows per table and on one with 6 must issue the same
number of SQL statements. Growth means an N+1 (a lazy load per row)."""
from __future__ import annotations

from sqlalchemy import event

from .seed import seed_guild
from .test_authz_matrix import _call, _is_guild_route, _routes
from .test_smoke import EXPECTED

SMALL = (1001, 1002)
LARGE = (1001, 1002, 1003, 1004, 1005, 1006)


class QueryCounter:
    def __init__(self, engine):
        self.engine, self.n = engine, 0

    def _hit(self, *_):
        self.n += 1

    def __enter__(self):
        self.n = 0
        event.listen(self.engine, "before_cursor_execute", self._hit)
        return self

    def __exit__(self, *_):
        event.remove(self.engine, "before_cursor_execute", self._hit)


def _counts(make_user, conn, engine, ids, name):
    client, user_id, guild = make_user(name)
    seed_guild(conn, guild, user_id, ids)
    out = {}
    for route, method in _routes():
        if method != "GET" or not _is_guild_route(route) or route.path in EXPECTED or "lookup" in route.path:
            continue
        with QueryCounter(engine) as qc:
            _call(client, route, method, guild_id=guild, user_id=user_id)
        out[route.path] = qc.n
    return out


def test_reads_do_not_scale_with_data(make_user, conn, engine):
    small = _counts(make_user, conn, engine, SMALL, "small")
    large = _counts(make_user, conn, engine, tuple(i + 100 for i in LARGE), "large")
    grew = sorted((p, small[p], large[p]) for p in small if large.get(p, 0) > small[p])
    assert not grew, "N+1 (queries for 2 rows -> 6 rows):\n" + "\n".join(f"{p}: {a} -> {b}" for p, a, b in grew)
