"""Every read endpoint, called by the owner on a guild with one of everything,
answers 2xx. Catches serializer breakage across the whole API at once."""
from __future__ import annotations

from .seed import seed_guild
from .test_authz_matrix import _call, _is_guild_route, _routes

#: Reads that legitimately aren't 2xx on seeded data.
EXPECTED = {
    # The seed has no scan jobs (tests/test_person_scan.py covers them).
    "/guilds/{guild_id}/tmdb-person-scan/jobs/{job_id}",
    "/guilds/{guild_id}/tmdb-person-scan/jobs/{job_id}/results",
    "/guilds/{guild_id}/game-person-scan/jobs/{job_id}",
    "/guilds/{guild_id}/game-person-scan/jobs/{job_id}/results",
}


def test_every_read_succeeds_on_a_full_guild(make_user, conn):
    alice, alice_id, guild = make_user("alice")
    seed_guild(conn, guild, alice_id)
    bad = []
    for route, method in _routes():
        if method != "GET" or not _is_guild_route(route) or route.path in EXPECTED:
            continue
        if "lookup" in route.path or "tmdb-credits" in route.path:
            continue  # TMDB/IGDB lookups call out to the network
        r = _call(alice, route, method, guild_id=guild, user_id=alice_id)
        if r.status_code >= 300:
            bad.append(f"GET {route.path} -> {r.status_code}: {r.text[:160]}")
    assert not bad, "reads failing on a seeded guild:\n" + "\n".join(bad)


def test_no_write_crashes_on_a_full_guild(make_user, conn):
    """Every mutation, called by the owner with a generated body against real
    rows, may refuse (4xx) but must never crash (5xx)."""
    alice, alice_id, guild = make_user("alice")
    seed_guild(conn, guild, alice_id)
    crashed = []
    for route, method in _routes():
        if method == "GET" or not _is_guild_route(route):
            continue
        if any(k in route.path for k in ("lookup", "tmdb-import", "igdb-import", "-refresh")):
            continue  # network
        if route.path.endswith("/jobs") and method == "POST":
            continue  # starts a background scan that calls out to TMDB/IGDB
        r = _call(alice, route, method, guild_id=guild, user_id=alice_id)
        if r.status_code >= 500:
            crashed.append(f"{method} {route.path} -> {r.status_code}")
    assert not crashed, "mutations crashing:\n" + "\n".join(crashed)
