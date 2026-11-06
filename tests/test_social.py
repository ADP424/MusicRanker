"""Comparing two members' rankings, and the guild consensus."""
from __future__ import annotations

from .seed import seed_guild


def _join(owner, guild, newcomer, newcomer_name):
    r = owner.post(f"/guilds/{guild}/invitations", json={"identifier": newcomer_name, "role": "ranker"})
    assert r.status_code == 201, r.text
    inv = newcomer.get("/invitations").json()[0]["id"]
    assert newcomer.post(f"/invitations/{inv}/accept").status_code == 204


def _rank(client, guild, ids):
    for pos, mid in enumerate(ids, start=1):
        r = client.put(f"/guilds/{guild}/movies/{mid}/entry", json={"position": pos})
        assert r.status_code in (200, 201, 204), r.text


def test_compare_and_consensus(make_user, conn):
    alice, alice_id, guild = make_user("alice")
    bob, bob_id, _ = make_user("bob")
    seed_guild(conn, guild, alice_id)  # movies 1001 and 1002
    _join(alice, guild, bob, "bob")
    for mid in (1001, 1002):
        alice.delete(f"/guilds/{guild}/movies/{mid}/entry")
    _rank(alice, guild, [1001, 1002])
    _rank(bob, guild, [1002, 1001])

    r = alice.get(f"/guilds/{guild}/social/compare", params={"vertical": "movies", "other": bob_id})
    assert r.status_code == 200, r.text
    c = r.json()
    assert (c["shared"], c["agreement"]) == (2, 0.0)  # every pair flipped
    assert [s["id"] for s in c["shared_items"]] == [1001, 1002]
    assert c["disagreements"][0]["gap"] in (1.0, -1.0)

    same = bob.get(f"/guilds/{guild}/social/compare", params={"vertical": "movies", "other": bob_id}).json()
    assert same["agreement"] == 100.0

    cons = alice.get(f"/guilds/{guild}/social/consensus", params={"vertical": "movies"}).json()
    assert cons["members"] == 2
    assert {i["id"]: (i["score"], i["members"]) for i in cons["items"]} == {1001: (50.0, 2), 1002: (50.0, 2)}
    assert sorted(sum((i["top_of"] for i in cons["items"]), [])) == ["alice", "bob"]


def test_compare_rejects_non_members(make_user, conn):
    alice, _, guild = make_user("alice")
    _, outsider_id, _ = make_user("mallory")
    r = alice.get(f"/guilds/{guild}/social/compare", params={"vertical": "movies", "other": outsider_id})
    assert r.status_code == 404


def test_holders_lists_members_with_positions(make_user, conn):
    alice, alice_id, guild = make_user("alice")
    bob, _, _ = make_user("bob")
    seed_guild(conn, guild, alice_id)
    _join(alice, guild, bob, "bob")
    for mid in (1001, 1002):
        alice.delete(f"/guilds/{guild}/movies/{mid}/entry")
    _rank(alice, guild, [1001, 1002])
    _rank(bob, guild, [1002])

    r = alice.get(f"/guilds/{guild}/social/holders", params={"vertical": "movies", "id": 1002})
    assert [(h["username"], h["position"], h["of"]) for h in r.json()] == [("bob", 1, 1), ("alice", 2, 2)]
