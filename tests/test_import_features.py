"""Credits merged into an existing title, show re-sync, full episode cast, taxonomy merge, guild stats."""
from __future__ import annotations

from server import tmdb_tv_import
from server.api_models.tmdb_tv_import import TmdbTvEpisodeOut, TmdbTvLookupOut, TmdbTvSeasonOut

from .seed import seed_guild


def _movie(client, guild, name="Some Film", year=2001):
    r = client.post(f"/guilds/{guild}/movies", json={"name": name, "runtime_minutes": 100, "release_year": year})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _nat(client):
    return client.get("/nationalities").json()[0]


def test_credits_merge_into_an_existing_movie_without_duplicating(make_user):
    alice, _, guild = make_user("alice")
    mid = _movie(alice, guild)
    nat = _nat(alice)
    body = {
        "tmdb_id": 555, "overview": "A film.", "poster_url": "https://example.com/p.jpg",
        "people": [{"tmdb_id": 9, "name": "Jane Doe", "role": "director", "nationality": nat}],
    }
    r = alice.post(f"/guilds/{guild}/movies/tmdb-import/credits/{mid}", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["people_linked"] == 1 and len(r.json()["created_people"]) == 1

    # Running it again changes nothing, and reuses the same person by TMDB id.
    r = alice.post(f"/guilds/{guild}/movies/tmdb-import/credits/{mid}", json=body)
    assert r.json()["people_linked"] == 0 and r.json()["created_people"] == []

    movie = alice.get(f"/guilds/{guild}/movies/{mid}").json()
    assert movie["tmdb_id"] == 555 and movie["overview"] == "A film."
    assert [(p["name"], p["role"]) for p in movie["persons"]] == [("Jane Doe", "director")]


def test_merge_keeps_existing_metadata_and_refuses_other_guilds(make_user):
    alice, _, guild = make_user("alice")
    bob, _, bob_guild = make_user("bob")
    mid = _movie(alice, guild)
    url = f"/guilds/{guild}/movies/tmdb-import/credits/{mid}"
    assert alice.post(url, json={"overview": "First"}).status_code == 200
    assert alice.post(url, json={"overview": "Second"}).status_code == 200
    assert alice.get(f"/guilds/{guild}/movies/{mid}").json()["overview"] == "First"
    assert bob.post(f"/guilds/{bob_guild}/movies/tmdb-import/credits/{mid}", json={}).status_code == 404


def test_game_credits_merge(make_user):
    alice, _, guild = make_user("alice")
    r = alice.post(f"/guilds/{guild}/games", json={"name": "Some Game", "release_year": 2010})
    assert r.status_code == 201, r.text
    gid = r.json()["id"]
    body = {"igdb_id": 77, "people": [
        {"igdb_id": 3, "source": "company", "name": "Studio", "role": "developer", "nationality": _nat(alice)},
    ]}
    r = alice.post(f"/guilds/{guild}/games/igdb-import/credits/{gid}", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["people_linked"] == 1
    assert alice.post(f"/guilds/{guild}/games/igdb-import/credits/{gid}", json=body).json()["people_linked"] == 0
    assert alice.get(f"/guilds/{guild}/games/{gid}").json()["igdb_id"] == 77


def _lookup(*seasons) -> TmdbTvLookupOut:
    return TmdbTvLookupOut(
        tmdb_id=4242, name="My Show", release_year=2020, number_of_seasons=len(seasons), number_of_episodes=0,
        episodes_counted=0, episode_run_time=0, people=[], genres=[], ambiguous=False, seasons=[
            TmdbTvSeasonOut(season_number=n, name=f"Season {n}", release_year=2020, episode_count=len(eps), episodes=[
                TmdbTvEpisodeOut(season_number=n, episode_number=e, name=f"S{n}E{e}", release_year=2020, runtime=rt, people=[])
                for e, rt in eps
            ], people=[], episodes_counted=len(eps))
            for n, eps in seasons
        ],
    )


def test_sync_adds_whats_missing_and_corrects_runtimes(make_user, monkeypatch):
    alice, _, guild = make_user("alice")
    base = f"/guilds/{guild}/television"
    sid = alice.post(f"{base}/shows", json={"name": "My Show", "release_year": 2020}).json()["id"]
    season = alice.post(f"{base}/shows/{sid}/seasons", json={"name": "Season 1", "season_number": 1}).json()
    ep = alice.post(f"{base}/seasons/{season['id']}/episodes", json={
        "name": "S1E1", "runtime_minutes": 10, "inherit_from_parent": False,
    })
    assert ep.status_code == 201, ep.text
    monkeypatch.setattr(tmdb_tv_import, "tv_lookup", lambda *a, **k: _lookup((1, [(1, 45), (2, 50)]), (2, [(1, 60)])))

    r = alice.post(f"{base}/tmdb-import/sync/{sid}")
    assert r.status_code == 200, r.text
    got = r.json()
    assert (got["seasons_added"], got["episodes_added"], got["runtimes_updated"]) == (1, 2, 1)
    # Idempotent, and it learned the id.
    again = alice.post(f"{base}/tmdb-import/sync/{sid}").json()
    assert (again["seasons_added"], again["episodes_added"], again["runtimes_updated"]) == (0, 0, 0)
    show = alice.get(f"{base}/shows/{sid}").json()
    assert show["tmdb_id"] == 4242 and len(show["seasons"]) == 2
    assert alice.get(f"{base}/episodes/{ep.json()['id']}").json()["runtime_minutes"] == 45


def test_sync_refuses_a_guess_for_an_unlinked_show(make_user, monkeypatch):
    alice, _, guild = make_user("alice")
    base = f"/guilds/{guild}/television"
    sid = alice.post(f"{base}/shows", json={"name": "My Show", "release_year": 2020}).json()["id"]
    monkeypatch.setattr(tmdb_tv_import, "tv_lookup", lambda *a, **k: _lookup().model_copy(update={"ambiguous": True}))
    assert alice.post(f"{base}/tmdb-import/sync/{sid}").status_code == 409


def test_full_episode_cast_credits_every_episode_and_reuses_the_only_namesake(make_user, monkeypatch):
    alice, _, guild = make_user("alice")
    nat = _nat(alice)
    known = alice.post(f"/guilds/{guild}/persons", json={
        "name": "Known Actor", "birth_nationality": nat, "core_nationality": nat,
    }).json()["id"]
    credits = {"cast": [{"id": 1, "name": "Known Actor", "order": 0, "character": "A"}],
               "guest_stars": [{"id": 2, "name": "New Guest", "order": 5, "character": "B"}], "crew": []}
    monkeypatch.setattr(tmdb_tv_import, "_fetch", lambda c, path: credits)
    monkeypatch.setattr(tmdb_tv_import.common, "client", lambda **k: object())
    monkeypatch.setattr(tmdb_tv_import.common, "fetch_person_data_bulk", lambda c, ids: {})

    r = alice.post(f"/guilds/{guild}/television/tmdb-import", json={
        "name": "Cast Show", "release_year": 2021, "tmdb_id": 99, "full_episode_cast": True,
        "seasons": [{"name": "Season 1", "season_number": 1, "release_year": 2021, "episodes": [
            {"name": "One", "episode_number": 1, "release_year": 2021},
            {"name": "Two", "episode_number": 2, "release_year": 2021},
        ]}],
    })
    assert r.status_code == 201, r.text
    assert [p["person_id"] for p in r.json()["reused_people"]] == [known]
    assert [p["name"] for p in r.json()["created_people"]] == ["New Guest"]
    for eid in r.json()["episode_ids"]:
        ep = alice.get(f"/guilds/{guild}/television/episodes/{eid}").json()
        assert {p["name"] for p in ep["persons"]} == {"Known Actor", "New Guest"}


def test_full_cast_needs_a_tmdb_id(make_user):
    alice, _, guild = make_user("alice")
    r = alice.post(f"/guilds/{guild}/television/tmdb-import", json={
        "name": "No Id", "release_year": 2021, "full_episode_cast": True, "seasons": [],
    })
    assert r.status_code == 409


def test_genre_merge_moves_titles_and_keeps_the_name_as_a_synonym(make_user):
    alice, _, guild = make_user("alice")
    base = f"/guilds/{guild}/movie-genres"
    keep = alice.post(base, json={"name": "Sci-Fi", "synonyms": ["SF"]}).json()["id"]
    dup = alice.post(base, json={"name": "Science Fiction", "synonyms": ["Sci Fi"]}).json()["id"]
    parent = alice.post(base, json={"name": "Speculative"}).json()["id"]
    child = alice.post(base, json={"name": "Space Opera"}).json()["id"]
    assert alice.put(f"{base}/{dup}/parents/{parent}").status_code == 204
    assert alice.put(f"{base}/{child}/parents/{dup}").status_code == 204
    assert alice.put(f"{base}/{dup}/parents/{keep}").status_code == 204  # a link between the two must vanish

    both, only_dup = _movie(alice, guild, "Both"), _movie(alice, guild, "Only Dup")
    assert alice.put(f"/guilds/{guild}/movies/{both}/genres/{keep}").status_code == 204
    assert alice.put(f"/guilds/{guild}/movies/{both}/genres/{dup}").status_code == 204
    assert alice.put(f"/guilds/{guild}/movies/{only_dup}/genres/{dup}").status_code == 204

    r = alice.post(f"{base}/{keep}/merge", json={"duplicate_id": dup})
    assert r.status_code == 200, r.text
    assert alice.get(f"{base}/{dup}").status_code == 404
    kept = alice.get(f"{base}/{keep}").json()
    assert set(kept["synonyms"]) == {"SF", "Science Fiction", "Sci Fi"}
    assert alice.get(f"/guilds/{guild}/movies/{both}").json()["genre_ids"] == [keep]
    assert alice.get(f"/guilds/{guild}/movies/{only_dup}").json()["genre_ids"] == [keep]
    assert [p["id"] for p in alice.get(f"{base}/{keep}/parents").json()] == [parent]
    assert [c["id"] for c in alice.get(f"{base}/{keep}/children").json()] == [child]
    assert alice.post(f"{base}/{keep}/merge", json={"duplicate_id": keep}).status_code == 422


def test_guild_stats_and_list_counts(make_user, conn):
    alice, alice_id, guild = make_user("alice")
    seed_guild(conn, guild, alice_id)
    mid = _movie(alice, guild, "Counted")
    assert alice.put(f"/guilds/{guild}/movies/{mid}/entry", json={"watches": 2}).status_code == 204

    stats = alice.get(f"/guilds/{guild}/overview/stats").json()
    assert stats["me"]["movie_minutes"] >= 200
    assert stats["sections"]["movies"]["mine"] >= 1
    assert stats["sections"]["movies"]["top"]
    assert stats["members"][0]["username"] == "alice"

    assert alice.get(f"/guilds/{guild}/overview/list-counts/movies").json()[str(mid)] == 1
    assert alice.get(f"/guilds/{guild}/overview/list-counts/nonsense").status_code == 422


def test_graph_says_what_is_in_my_list(make_user):
    alice, _, guild = make_user("alice")
    mid = _movie(alice, guild, "Mine")
    other = _movie(alice, guild, "Not Mine")
    alice.put(f"/guilds/{guild}/movies/{mid}/entry", json={})
    mine = alice.get(f"/guilds/{guild}/persons/graph").json()["mine"]
    assert {"kind": "movie", "id": mid} in mine and {"kind": "movie", "id": other} not in mine


def test_inviting_by_email_does_not_reveal_accounts(make_user):
    alice, _, guild = make_user("alice")
    bob, _, _ = make_user("bob")
    url = f"/guilds/{guild}/invitations"
    unknown = alice.post(url, json={"identifier": "nobody@example.com", "role": "ranker"})
    known = alice.post(url, json={"identifier": "bob@example.com", "role": "ranker"})
    again = alice.post(url, json={"identifier": "bob@example.com", "role": "ranker"})
    assert unknown.status_code == known.status_code == again.status_code == 201
    assert unknown.json() == known.json() == again.json() == {"id": None}
    assert len(bob.get("/invitations").json()) == 1
    assert alice.post(url, json={"identifier": "no_such_name", "role": "ranker"}).status_code == 404
