"""Guild-wide search: finds every kind, ignores accents and case, and never
reaches into another guild."""
from __future__ import annotations

from .seed import MARKER, seed_guild


def test_search_covers_every_kind_in_this_guild_only(make_user, conn):
    alice, alice_id, guild = make_user("alice")
    bob, bob_id, bob_guild = make_user("bob")
    seed_guild(conn, guild, alice_id)
    seed_guild(conn, bob_guild, bob_id, ids=(2001, 2002))

    hits = alice.get(f"/guilds/{guild}/search", params={"q": MARKER.lower()}).json()
    kinds = {h["kind"] for h in hits}
    assert kinds == {"artist", "album", "book", "movie", "game", "show", "season", "episode", "person", "genre"}
    assert all(h["id"] in (1001, 1002) for h in hits), "a hit came from another guild"

    limited = alice.get(f"/guilds/{guild}/search", params={"q": MARKER, "kinds": ["movie"], "limit": 1}).json()
    assert [h["kind"] for h in limited] == ["movie"]


def test_search_ignores_accents(make_user):
    alice, _, guild = make_user("alice")
    nat = alice.get("/nationalities").json()[0]
    r = alice.post(f"/guilds/{guild}/persons", json={
        "name": "Penélope Cruz", "birth_nationality": nat, "core_nationality": nat,
    })
    assert r.status_code == 201, r.text
    hits = alice.get(f"/guilds/{guild}/search", params={"q": "penelope"}).json()
    assert [(h["kind"], h["name"]) for h in hits] == [("person", "Penélope Cruz")]


def test_blank_query_is_rejected(make_user):
    alice, _, guild = make_user("alice")
    assert alice.get(f"/guilds/{guild}/search", params={"q": ""}).status_code == 422
