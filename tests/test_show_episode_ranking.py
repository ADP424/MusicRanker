"""Ranking a show's episodes across seasons, alongside the per-season order."""
from __future__ import annotations


def _make_show(client, guild):
    show = client.post(f"/guilds/{guild}/television/shows", json={"name": "Show", "release_year": 2000}).json()["id"]
    seasons, episodes = [], []
    for n in (1, 2):
        se = client.post(f"/guilds/{guild}/television/shows/{show}/seasons",
                         json={"name": f"Season {n}", "release_year": 2000}).json()["id"]
        seasons.append(se)
        for e in (1, 2):
            r = client.post(f"/guilds/{guild}/television/seasons/{se}/episodes",
                            json={"name": f"S{n}E{e}", "runtime_minutes": 40, "release_year": 2000})
            assert r.status_code == 201, r.text
            episodes.append(r.json()["id"])
    return show, seasons, episodes


def _order(client, path):
    return [r["episode"]["id"] for r in client.get(path).json()]


def test_show_wide_order_is_independent_of_season_order(make_user):
    alice, _, guild = make_user("alice")
    show, (s1, s2), (a, b, c, d) = _make_show(alice, guild)
    for e in (a, b):
        assert alice.put(f"/guilds/{guild}/television/episodes/{e}/entry", json={}).status_code == 204
    assert alice.post(f"/guilds/{guild}/television/seasons/{s2}/episodes/add-all").json() == {"added": 2}

    base = f"/guilds/{guild}/television"
    assert _order(alice, f"{base}/shows/{show}/episodes/ranked") == [a, b, c, d]

    assert alice.put(f"{base}/shows/{show}/episodes/reorder", json={"ids": [d, a, c, b]}).status_code == 204
    assert _order(alice, f"{base}/shows/{show}/episodes/ranked") == [d, a, c, b]
    # The per-season lists are untouched.
    assert _order(alice, f"{base}/seasons/{s1}/episodes/ranked") == [a, b]

    assert alice.put(f"{base}/episodes/{b}/show-position", json={"position": 1}).status_code == 204
    assert _order(alice, f"{base}/shows/{show}/episodes/ranked") == [b, d, a, c]

    r = alice.put(f"{base}/shows/{show}/episodes/reorder", json={"ids": [a, b]})
    assert r.status_code == 422  # must list every ranked episode of the show


def test_show_wide_comparisons_share_same_season_answers(make_user):
    alice, _, guild = make_user("alice")
    show, (s1, s2), (a, b, c, d) = _make_show(alice, guild)
    base = f"/guilds/{guild}/television"

    # Answered on the season page: visible show-wide too.
    assert alice.put(f"{base}/seasons/{s1}/episodes/comparisons", json={"winner_id": b, "loser_id": a}).status_code == 200
    # Answered show-wide across seasons: not visible on either season page.
    assert alice.put(f"{base}/shows/{show}/episodes/comparisons", json={"winner_id": c, "loser_id": a}).status_code == 200
    # Answered show-wide within a season: lands in the season's answers.
    assert alice.put(f"{base}/shows/{show}/episodes/comparisons", json={"winner_id": d, "loser_id": c}).status_code == 200

    pairs = lambda path: {(x["winner_id"], x["loser_id"]) for x in alice.get(path).json()}  # noqa: E731
    assert pairs(f"{base}/shows/{show}/episodes/comparisons") == {(b, a), (c, a), (d, c)}
    assert pairs(f"{base}/seasons/{s1}/episodes/comparisons") == {(b, a)}
    assert pairs(f"{base}/seasons/{s2}/episodes/comparisons") == {(d, c)}

    # Flipping a pair show-wide replaces the season answer rather than duplicating it.
    alice.put(f"{base}/shows/{show}/episodes/comparisons", json={"winner_id": a, "loser_id": b})
    assert pairs(f"{base}/seasons/{s1}/episodes/comparisons") == {(a, b)}

    # Moving an episode keeps its answers, re-homed for its new season.
    assert alice.patch(f"{base}/episodes/{a}", json={"season_id": s2}).status_code == 200
    assert pairs(f"{base}/seasons/{s2}/episodes/comparisons") == {(d, c), (c, a)}
    assert pairs(f"{base}/shows/{show}/episodes/comparisons") == {(a, b), (c, a), (d, c)}

    assert alice.delete(f"{base}/shows/{show}/episodes/comparisons").status_code == 204
    assert pairs(f"{base}/shows/{show}/episodes/comparisons") == set()


def test_activity_feed(make_user):
    alice, _, guild = make_user("alice")
    mid = alice.post(f"/guilds/{guild}/movies", json={"name": "Film", "release_year": 1999, "runtime_minutes": 90})
    assert mid.status_code == 201, mid.text
    mid = mid.json()["id"]
    alice.put(f"/guilds/{guild}/movies/{mid}/entry", json={})

    feed = alice.get(f"/guilds/{guild}/overview/activity").json()
    assert [(i["kind"], i["id"], i["username"]) for i in feed["items"]] == [("list", mid, "alice"), ("catalog", mid, "alice")]
    only = alice.get(f"/guilds/{guild}/overview/activity", params={"kind": "catalog"}).json()["items"]
    assert [i["kind"] for i in only] == ["catalog"]
    page = alice.get(f"/guilds/{guild}/overview/activity", params={"limit": 1}).json()
    assert len(page["items"]) == 1 and page["next_before"]
    rest = alice.get(f"/guilds/{guild}/overview/activity", params={"before": page["next_before"]}).json()
    assert [i["kind"] for i in rest["items"]] == ["catalog"]
