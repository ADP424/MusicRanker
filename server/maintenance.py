"""Periodic housekeeping, run on one background thread per process.

Every task here is a single idempotent UPDATE/DELETE, so several processes
running it at once only repeat each other's work.

  * reap_jobs        a `running` job whose heartbeat went stale lost its worker
                     (a restart, a crash): re-queue it, or fail it once it has
                     used up its attempts — never leave it `running` forever
  * prune_jobs       finished jobs (and their payloads/results) after a while
  * purge_sessions   expired login sessions
  * expire_invites   pending invitations nobody answered
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import timedelta

from sqlalchemy import delete, update

from . import database
from .database_models import GuildInvitation, InvitationStatus, Job, JobStatus, Session
from .database_models.mixins import utcnow

log = logging.getLogger(__name__)

EVERY = 60.0
#: A running job's heartbeat is refreshed every 30 s (jobs.HEARTBEAT_EVERY).
STALE_AFTER = timedelta(minutes=3)
MAX_ATTEMPTS = 2
JOB_RETENTION = timedelta(days=int(os.environ.get("JOB_RETENTION_DAYS", "30")))
INVITE_TTL = timedelta(days=int(os.environ.get("INVITE_TTL_DAYS", "30")))

_FINISHED = (JobStatus.done, JobStatus.error, JobStatus.cancelled)


def reap_jobs(db) -> None:
    stale = (Job.status == JobStatus.running) & (Job.heartbeat_at < utcnow() - STALE_AFTER)
    requeued = db.execute(
        update(Job)
        .where(stale, Job.attempts < MAX_ATTEMPTS, Job.cancel_requested.is_(False))
        .values(status=JobStatus.pending, phase="queued", message="Restarted after an interruption")
    ).rowcount
    failed = db.execute(
        update(Job)
        .where(stale)
        .values(
            status=JobStatus.error, phase="finished", finished_at=utcnow(),
            error="Interrupted: the server stopped while this job was running.",
        )
    ).rowcount
    if requeued or failed:
        log.warning("Reaped stale jobs: %d re-queued, %d failed", requeued, failed)


def prune_jobs(db) -> None:
    db.execute(delete(Job).where(Job.status.in_(_FINISHED), Job.finished_at < utcnow() - JOB_RETENTION))


def purge_sessions(db) -> None:
    db.execute(delete(Session).where(Session.expires_at < utcnow()))


def expire_invites(db) -> None:
    db.execute(
        update(GuildInvitation)
        .where(GuildInvitation.status == InvitationStatus.pending, GuildInvitation.created_at < utcnow() - INVITE_TTL)
        .values(status=InvitationStatus.revoked, responded_at=utcnow())
    )


TASKS = (reap_jobs, prune_jobs, purge_sessions, expire_invites)


def run_once() -> None:
    for task in TASKS:
        try:
            with database.SessionLocal() as db:
                task(db)
                db.commit()
        except Exception:  # noqa: BLE001 — one failing task mustn't stop the others
            log.exception("Maintenance task %s failed", task.__name__)


_stop = threading.Event()
_thread: threading.Thread | None = None


def _loop() -> None:
    while not _stop.is_set():
        run_once()
        _stop.wait(EVERY)


def start() -> None:
    global _thread
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="maintenance", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
    if _thread:
        _thread.join(timeout=5)
