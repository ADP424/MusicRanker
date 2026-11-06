"""The TMDB person scan: jobs are rows (scoped to their guild), and identity
is judged across movies and shows together."""
from __future__ import annotations

from server import jobs, maintenance
from server import tmdb_person_scan as scan
from server import tmdb_tv_scan as tv
from server.database_models import Job, JobLane, JobStatus
from server.database_models.mixins import utcnow
from server.scan_common import MATCH_NAME_ONLY, MATCH_VERIFIED, VERDICT_CONFLICT, job_kind
from server.tmdb_scan import LMovie

RESULT = {
    "candidates": [{
        "key": "movie:1:2:cast", "person_id": 2, "person_name": "Ann", "entity_kind": "movie", "entity_id": 1,
        "entity_name": "Film", "entity_year": 2000, "context": None, "credit_type": "cast", "slot": "cast",
        "character": "Her", "billing_order": 0, "job": None, "episode_count": None, "suggested_role": "lead_actor",
        "roles": ["lead_actor", "actor", "cameo_actor"], "suggestion_reason": "top billed", "match": "verified",
        "overlap": 2, "source_person_id": 9, "source_popularity": 1.0, "suppressed": False,
        "verdict": "conflict", "evidence": {"movie": [2, 2], "show": [0, 3]},
    }],
    "unresolved": [],
    "stats": {"items_total": 5, "items_in_scope": 5, "items_resolved": 5, "items_unresolved": 0,
              "network_calls": 0, "cache_hits": 9},
}


def _done_job(session, guild_id, user_id) -> Job:
    job = Job(lane=JobLane.tmdb, kind=job_kind(scan.NAME), guild_id=guild_id, user_id=user_id,
              status=JobStatus.done, phase="finished", payload={}, result=RESULT, finished_at=utcnow())
    session.add(job)
    session.commit()
    return job


def test_finished_scan_is_served_from_its_row(make_user, session):
    alice, alice_id, guild = make_user("alice")
    job = _done_job(session, guild, alice_id)

    listed = alice.get(f"/guilds/{guild}/tmdb-person-scan/jobs").json()
    assert [j["id"] for j in listed] == [str(job.id)]
    assert listed[0]["candidate_count"] == 1

    r = alice.get(f"/guilds/{guild}/tmdb-person-scan/jobs/{job.id}/results")
    assert r.status_code == 200, r.text
    c = r.json()["candidates"][0]
    assert c["verdict"] == "conflict" and c["evidence"] == {"movie": [2, 2], "show": [0, 3]}


def test_another_guilds_scan_is_invisible(make_user, session):
    alice, alice_id, guild = make_user("alice")
    bob, _, bob_guild = make_user("bob")
    job = _done_job(session, guild, alice_id)
    assert bob.get(f"/guilds/{bob_guild}/tmdb-person-scan/jobs").json() == []
    assert bob.get(f"/guilds/{bob_guild}/tmdb-person-scan/jobs/{job.id}").status_code == 404
    assert bob.delete(f"/guilds/{bob_guild}/tmdb-person-scan/jobs/{job.id}").status_code == 404


def test_start_queues_one_scan_per_guild(make_user):
    alice, _, guild = make_user("alice")
    r = alice.post(f"/guilds/{guild}/tmdb-person-scan/jobs", json={})
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "pending"
    assert alice.post(f"/guilds/{guild}/tmdb-person-scan/jobs", json={}).status_code == 409
    alice.post(f"/guilds/{guild}/tmdb-person-scan/jobs/{r.json()['id']}/cancel")
    assert alice.get(f"/guilds/{guild}/tmdb-person-scan/jobs/{r.json()['id']}").json()["status"] == "cancelled"


def test_stale_running_job_is_requeued_then_failed(make_user, session):
    _, user_id, guild = make_user("alice")
    job = Job(lane=JobLane.tmdb, kind="x", guild_id=guild, user_id=user_id, status=JobStatus.running,
              attempts=1, heartbeat_at=utcnow() - maintenance.STALE_AFTER * 2, payload={})
    session.add(job)
    session.commit()

    maintenance.reap_jobs(session)
    session.refresh(job)
    assert job.status is JobStatus.pending

    job.status, job.attempts, job.heartbeat_at = JobStatus.running, 2, utcnow() - maintenance.STALE_AFTER * 2
    session.commit()
    maintenance.reap_jobs(session)
    session.refresh(job)
    assert job.status is JobStatus.error and "Interrupted" in job.error


def test_request_cancel_settles_a_pending_job(make_user, session):
    _, user_id, guild = make_user("alice")
    job = Job(lane=JobLane.tmdb, kind="x", guild_id=guild, user_id=user_id, payload={})
    session.add(job)
    session.flush()
    jobs.request_cancel(session, job)
    assert job.status is JobStatus.cancelled and job.finished_at is not None


# ── cross-medium identity (pure: no database, no network) ──

def _snap(people, works=None, shows=()):
    return tv._Db(shows=list(shows), seasons={}, episodes={}, people=people, slots={}, works=works or {})


def _index(*persons):
    idx = scan._CreditIndex(set())
    for p in persons:
        idx.people[p.ext_id] = p
    return idx


def _run(index, snap, movies, movie_links, resolved):
    by_norm = {}
    for pid, name, _ in snap.people:
        by_norm.setdefault(name.lower(), set()).add(pid)
    return scan._match(movies, movie_links, {m.id for m in movies}, snap, index, by_norm, resolved, set())


def test_movies_corroborate_but_shows_contradict_is_a_conflict():
    movies = [LMovie(1, "Old", None, 2000), LMovie(2, "New", None, 2010)]
    show = tv.LShow(7, "Show", None, 2005)
    snap = _snap([(10, "chris", None)], works={10: {7}}, shows=[show])
    # TMDB's "chris" is on movie 1 (linked) and movie 2 (not yet), but not on show 7.
    tp = scan._TPerson(ext_id=99, name="chris", norms={"chris"}, works={("movie", 1), ("movie", 2)},
                       movie_cast={1: ("A", 0), 2: ("B", 0)})
    out = _run(_index(tp), snap, movies, [(10, 1, scan.ACTING[0])], {("movie", 1), ("movie", 2), ("show", 7)})
    [c] = out
    assert c.entity_id == 2 and c.match == MATCH_VERIFIED
    assert c.evidence == {"movie": (1, 1), "show": (0, 1)}
    assert c.verdict == VERDICT_CONFLICT


def test_links_in_both_media_agreeing_are_verified():
    movies = [LMovie(1, "Old", None, 2000), LMovie(2, "New", None, 2010)]
    snap = _snap([(10, "chris", None)], works={10: {7}}, shows=[tv.LShow(7, "Show", None, 2005)])
    tp = scan._TPerson(ext_id=99, name="chris", norms={"chris"},
                       works={("movie", 1), ("movie", 2), ("show", 7)}, movie_cast={2: ("B", 0)})
    [c] = _run(_index(tp), snap, movies, [(10, 1, scan.ACTING[0])], {("movie", 1), ("movie", 2), ("show", 7)})
    assert c.verdict == MATCH_VERIFIED and c.evidence == {"movie": (1, 1), "show": (1, 1)}


def test_unresolved_works_are_not_counted_against_anyone():
    movies = [LMovie(2, "New", None, 2010)]
    snap = _snap([(10, "chris", None)], works={10: {7}}, shows=[tv.LShow(7, "Show", None, 2005)])
    tp = scan._TPerson(ext_id=99, name="chris", norms={"chris"}, works={("movie", 2)}, movie_cast={2: ("B", 0)})
    # Show 7 never resolved on TMDB, so it can't contradict the name match.
    [c] = _run(_index(tp), snap, movies, [], {("movie", 2)})
    assert c.match == MATCH_NAME_ONLY and c.verdict == MATCH_NAME_ONLY
    assert c.evidence == {"movie": (0, 0), "show": (0, 0)}
