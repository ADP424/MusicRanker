"""Stats scores are percentiles of the member's list, so lists of different lengths compare."""
from __future__ import annotations

from server.stats_common import percentile


def test_percentile_scale():
    assert percentile(1, 10) == 0.95 and percentile(10, 10) == 0.05 and percentile(1, 1) == 0.5


def test_movie_scores_follow_list_position(make_user):
    alice, _, guild = make_user("alice")
    ids = []
    for year in (2001, 2002):
        r = alice.post(f"/guilds/{guild}/movies", json={"name": f"M{year}", "release_year": year, "runtime_minutes": 90})
        ids.append(r.json()["id"])
        alice.put(f"/guilds/{guild}/movies/{ids[-1]}/entry", json={})
    by_year = {r["year"]: r["avg_score"] for r in alice.get(f"/guilds/{guild}/movie-stats/by-year").json()}
    assert by_year == {2001: 0.75, 2002: 0.25}
