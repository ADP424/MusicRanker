"""Splitting a person in two, and a person's TMDB filmography against the catalog."""
from __future__ import annotations

from server.routers import person_tmdb

from .seed import seed_guild


def _person(client, guild, name, nat):
    r = client.post(f"/guilds/{guild}/persons", json={"name": name, "birth_nationality": nat, "core_nationality": nat})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_split_moves_only_the_chosen_credits(make_user, conn):
    alice, alice_id, guild = make_user("alice")
    seed_guild(conn, guild, alice_id)
    nat = alice.get("/nationalities").json()[0]
    pid = _person(alice, guild, "John Smith", nat)
    for movie, role in ((1001, "actor"), (1002, "director"), (1002, "actor")):
        assert alice.put(f"/guilds/{guild}/movies/{movie}/persons/{pid}/{role}").status_code in (200, 204)

    r = alice.post(f"/guilds/{guild}/persons/{pid}/split", json={
        "name": "John Smith (director)",
        "credits": [{"kind": "movie", "id": 1002, "role": "director"}],
    })
    assert r.status_code == 201, r.text
    new = r.json()["person_id"]
    assert r.json()["moved"] == 1

    roles = lambda p: sorted(  # noqa: E731
        (m["movie_id"], m["role"]) for m in alice.get(f"/guilds/{guild}/persons/{p}/detail").json()["movie_roles"])
    assert roles(pid) == [(1001, "actor"), (1002, "actor")]
    assert roles(new) == [(1002, "director")]

    # A credit they don't hold is refused, and nothing is created.
    bad = alice.post(f"/guilds/{guild}/persons/{pid}/split", json={
        "name": "X", "credits": [{"kind": "movie", "id": 1001, "role": "composer"}]})
    assert bad.status_code == 422
    assert all(p["name"] != "X" for p in alice.get(f"/guilds/{guild}/persons").json())


class _FakeTmdb:
    def __init__(self, pages):
        self.pages = pages

    def get(self, path, params=None, ttl=None):
        return self.pages.get(path)


def test_tmdb_credits_marks_linked_unlinked_and_missing(make_user, conn, monkeypatch):
    alice, alice_id, guild = make_user("alice")
    seed_guild(conn, guild, alice_id)
    conn.exec_driver_sql(f"UPDATE movies SET tmdb_id = id WHERE guild_id = {guild}")
    nat = alice.get("/nationalities").json()[0]
    pid = _person(alice, guild, "Ann", nat)
    other = _person(alice, guild, "Bo", nat)
    assert alice.put(f"/guilds/{guild}/persons/{other}/tmdb-id", json={"tmdb_id": 78}).status_code == 204
    assert alice.put(f"/guilds/{guild}/persons/{pid}/tmdb-id", json={"tmdb_id": 78}).status_code == 409  # taken
    assert alice.put(f"/guilds/{guild}/persons/{pid}/tmdb-id", json={"tmdb_id": 77}).status_code == 204
    alice.put(f"/guilds/{guild}/movies/1001/persons/{pid}/director")

    monkeypatch.setattr(person_tmdb.common, "client", lambda: _FakeTmdb({
        "/person/77": {"profile_path": "/p.jpg"},
        "/person/77/combined_credits": {
            "cast": [
                {"media_type": "movie", "id": 1002, "title": "In catalog", "release_date": "2001-01-01",
                 "character": "Her", "order": 0},
                {"media_type": "movie", "id": 5, "title": "Elsewhere", "release_date": "1990-01-01",
                 "character": "Her", "order": 0},
            ],
            "crew": [{"media_type": "movie", "id": 1001, "title": "Directed", "release_date": "2000-01-01",
                      "job": "Director"}],
        },
    }))
    r = alice.get(f"/guilds/{guild}/persons/{pid}/tmdb-credits")
    assert r.status_code == 200, r.text
    by_id = {c["tmdb_id"]: c for c in r.json()["credits"]}
    assert (by_id[1001]["local_id"], by_id[1001]["linked_roles"]) == (1001, ["director"])
    assert (by_id[1002]["local_id"], by_id[1002]["linked_roles"]) == (1002, [])
    assert by_id[1002]["roles"] == [{"label": "Her", "role": "lead_actor"}]
    assert by_id[5]["local_id"] is None

    # Without a stored id: search candidates instead.
    alice.put(f"/guilds/{guild}/persons/{pid}/tmdb-id", json={"tmdb_id": None})
    monkeypatch.setattr(person_tmdb.common, "client", lambda: _FakeTmdb({
        "/search/person": {"results": [{"id": 77, "name": "Ann", "known_for_department": "Acting",
                                        "known_for": [{"title": "Elsewhere"}]}]},
    }))
    out = alice.get(f"/guilds/{guild}/persons/{pid}/tmdb-credits").json()
    assert out["tmdb_id"] is None and out["candidates"][0]["known_for"] == ["Elsewhere"]
