"""Merging a duplicate person into another."""
from __future__ import annotations

from .seed import seed_guild


def _person(client, guild, name, nat):
    r = client.post(f"/guilds/{guild}/persons", json={"name": name, "birth_nationality": nat, "core_nationality": nat})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_merge_moves_credits_and_deletes_the_duplicate(make_user, conn):
    alice, alice_id, guild = make_user("alice")
    bob, _, bob_guild = make_user("bob")
    seed_guild(conn, guild, alice_id)
    nat = alice.get("/nationalities").json()[0]
    keep = _person(alice, guild, "Penélope Cruz", nat)
    dup = _person(alice, guild, "Penelope Cruz", nat)
    for pid, movie in ((keep, 1001), (dup, 1001), (dup, 1002)):
        r = alice.put(f"/guilds/{guild}/movies/{movie}/persons/{pid}/actor")
        assert r.status_code in (200, 201, 204), r.text

    r = alice.post(f"/guilds/{guild}/persons/{keep}/merge", json={"duplicate_id": dup})
    assert r.status_code == 200, r.text
    assert r.json() == {"moved": 1, "already_had": 1}

    assert alice.get(f"/guilds/{guild}/persons/{dup}").status_code == 404
    detail = alice.get(f"/guilds/{guild}/persons/{keep}/detail").json()
    assert sorted(m["movie_id"] for m in detail["movie_roles"]) == [1001, 1002]
    assert detail["name_en"] == "Penelope Cruz"

    # Someone from another guild can neither merge into nor out of these people.
    other = _person(bob, bob_guild, "Someone", nat)
    assert bob.post(f"/guilds/{bob_guild}/persons/{other}/merge", json={"duplicate_id": keep}).status_code == 404
    assert alice.post(f"/guilds/{guild}/persons/{keep}/merge", json={"duplicate_id": keep}).status_code == 422
