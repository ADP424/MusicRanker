"""POST /batch: a form's steps as one transaction."""
from __future__ import annotations


def _nat(client):
    return client.get("/nationalities").json()[0]


def test_batch_commits_everything_with_references(make_user):
    alice, _, guild = make_user("alice")
    nat = _nat(alice)
    pid = alice.post(f"/guilds/{guild}/persons", json={"name": "Ann", "birth_nationality": nat, "core_nationality": nat}).json()["id"]
    r = alice.post("/batch", json={"ops": [
        {"method": "POST", "path": f"/guilds/{guild}/movies", "body": {"name": "Film", "release_year": 2000, "runtime_minutes": 90}},
        {"method": "PUT", "path": f"/guilds/{guild}/movies/{{0.id}}/persons/{pid}/director"},
        {"method": "PUT", "path": f"/guilds/{guild}/movies/{{0.id}}/entry", "body": {}},
    ]})
    assert r.status_code == 200, r.text
    mid = r.json()["results"][0]["id"]
    movie = alice.get(f"/guilds/{guild}/movies/{mid}").json()
    assert [(p["id"], p["role"]) for p in movie["persons"]] == [(pid, "director")]
    assert movie["in_my_list"] is True


def test_batch_rolls_back_on_any_failure(make_user):
    alice, _, guild = make_user("alice")
    before = len(alice.get(f"/guilds/{guild}/movies").json())
    r = alice.post("/batch", json={"ops": [
        {"method": "POST", "path": f"/guilds/{guild}/movies", "body": {"name": "Film", "release_year": 2000, "runtime_minutes": 90}},
        {"method": "PUT", "path": f"/guilds/{guild}/movies/{{0.id}}/persons/999999/director"},  # no such person
    ]})
    assert r.status_code == 404, r.text
    assert r.json()["detail"]["op"] == 1
    assert len(alice.get(f"/guilds/{guild}/movies").json()) == before  # the movie was not kept


def test_batch_keeps_each_ops_own_authorization(make_user):
    alice, _, guild = make_user("alice")
    bob, _, _ = make_user("bob")
    r = bob.post("/batch", json={"ops": [
        {"method": "POST", "path": f"/guilds/{guild}/movies", "body": {"name": "X", "release_year": 2000, "runtime_minutes": 1}},
    ]})
    assert r.status_code == 404  # bob isn't in alice's guild
    assert alice.post("/batch", json={"ops": [
        {"method": "POST", "path": f"/guilds/{guild}/movies/tmdb-import", "body": {}},
    ]}).status_code == 422  # routes that commit part-way are refused
