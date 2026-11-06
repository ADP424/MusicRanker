"""Account settings: password, sessions, export, deletion."""
from __future__ import annotations

from .conftest import ApiClient
from .seed import seed_guild

PASSWORD = "correct horse battery"


def _login(username: str, password: str = PASSWORD) -> ApiClient:
    c = ApiClient()
    r = c.post("/auth/login", json={"identifier": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_password_change_signs_out_other_sessions(make_user):
    alice, _, _ = make_user("alice")
    laptop = _login("alice")
    assert {s["current"] for s in alice.get("/account/sessions").json()} == {True, False}

    assert alice.post("/account/password", json={"current_password": "wrong one!", "new_password": "x" * 12}).status_code == 403
    r = alice.post("/account/password", json={"current_password": PASSWORD, "new_password": "a brand new password"})
    assert r.status_code == 204, r.text

    assert laptop.get("/auth/me").status_code == 401
    assert alice.get("/auth/me").status_code == 200
    _login("alice", "a brand new password")


def test_revoke_one_session(make_user):
    alice, _, _ = make_user("alice")
    laptop = _login("alice")
    other = next(s for s in alice.get("/account/sessions").json() if not s["current"])
    assert alice.delete(f"/account/sessions/{other['id']}").status_code == 204
    assert laptop.get("/auth/me").status_code == 401
    current = next(s for s in alice.get("/account/sessions").json() if s["current"])
    assert alice.delete(f"/account/sessions/{current['id']}").status_code == 422


def test_cannot_revoke_someone_elses_session(make_user):
    alice, _, _ = make_user("alice")
    bob, _, _ = make_user("bob")
    bobs = bob.get("/account/sessions").json()[0]["id"]
    alice.delete(f"/account/sessions/{bobs}")
    assert bob.get("/auth/me").status_code == 200


def test_email_change_needs_password(make_user):
    alice, _, _ = make_user("alice")
    assert alice.patch("/account", json={"email": "new@example.com"}).status_code == 422
    r = alice.patch("/account", json={"email": "new@example.com", "current_password": PASSWORD, "username": "alice2"})
    assert r.status_code == 200, r.text
    assert alice.get("/auth/me").json()["username"] == "alice2"


def test_export_lists_my_rankings(make_user, conn):
    alice, alice_id, guild = make_user("alice")
    seed_guild(conn, guild, alice_id)
    data = alice.get("/account/export").json()
    lists = {i["list"] for i in data["items"]}
    assert {"artists", "albums", "books", "movies", "games", "tv_shows", "tv_seasons", "tv_episodes"} <= lists
    movies = [i for i in data["items"] if i["list"] == "movies"]
    assert [m["position"] for m in movies] == list(range(1, len(movies) + 1))
    csv = alice.get("/account/export", params={"format": "csv"})
    assert csv.status_code == 200 and csv.text.startswith("guild,list,within,position,name")


def test_delete_account(make_user):
    alice, _, guild = make_user("alice")
    bob, _, _ = make_user("bob")
    alice.post(f"/guilds/{guild}/invitations", json={"identifier": "bob", "role": "ranker"})
    bob.post(f"/invitations/{bob.get('/invitations').json()[0]['id']}/accept")

    # Alice's guild has another member: she must hand it over first.
    r = alice.post("/account/delete", json={"password": PASSWORD})
    assert r.status_code == 409 and "transfer" in r.text.lower()

    # Bob only owns his own empty personal guild, which goes with him.
    assert bob.post("/account/delete", json={"password": PASSWORD}).status_code == 204
    assert bob.get("/auth/me").status_code == 401
    assert [m["username"] for m in alice.get(f"/guilds/{guild}/members").json()] == ["alice"]
