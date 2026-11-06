from __future__ import annotations

import logging
import threading
from typing import Callable, Protocol

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from . import database
from .database_models.job import Job, JobLane, JobStatus
from .database_models.mixins import utcnow


log = logging.getLogger(__name__)


class JobCancelled(Exception):
    """Raised by a handler that noticed `ctx.cancelled()`; the job settles as
    `cancelled` with its transaction rolled back, not as an error."""


class JobContext(Protocol):
    def cancelled(self) -> bool: ...
    def progress(self, *, phase: str = ..., processed: int = ..., total: int = ..., message: str = ...) -> None: ...


Handler = Callable[[Session, Job, JobContext], dict]
JOB_HANDLERS: dict[str, Handler] = {}


def handler(kind: str):
    def deco(fn: Handler) -> Handler:
        JOB_HANDLERS[kind] = fn
        return fn

    return deco


def enqueue(db: Session, *, lane: JobLane, kind: str, guild_id: int | None, user_id: int, payload: dict) -> Job:
    job = Job(lane=lane, kind=kind, guild_id=guild_id, user_id=user_id, payload=payload)
    db.add(job)
    db.flush()
    return job


def request_cancel(db: Session, job: Job) -> None:
    """Cooperative: the handler polls `cancel_requested` between units of work.
    A job that has not been claimed yet is settled immediately so it never runs."""
    if job.status in (JobStatus.done, JobStatus.error, JobStatus.cancelled):
        return
    job.cancel_requested = True
    if job.status is JobStatus.pending:
        job.status, job.phase, job.finished_at = JobStatus.cancelled, "finished", utcnow()


def queue_position(db: Session, job: Job) -> int:
    """0 = running/next. Drives the "you are Nth in line" UI."""
    if job.status is not JobStatus.pending:
        return 0
    return db.scalar(
        select(func.count())
        .select_from(Job)
        .where(Job.lane == job.lane, Job.status == JobStatus.pending, Job.created_at < job.created_at)
    )


class _Ctx:
    def __init__(self, job_id: int):
        self.job_id = job_id

    def cancelled(self) -> bool:
        with database.SessionLocal() as db:
            return bool(db.scalar(select(Job.cancel_requested).where(Job.id == self.job_id)))

    def progress(self, **kw) -> None:
        with database.SessionLocal() as db:
            job = db.get(Job, self.job_id)
            for k, v in kw.items():
                setattr(job, k, v)
            job.heartbeat_at = utcnow()
            db.commit()


HEARTBEAT_EVERY = 30.0


def _heartbeat(job_id: int, stop: threading.Event) -> None:
    """Keeps a running job's heartbeat fresh even through a long silent step,
    so only a dead worker's jobs ever look stale."""
    while not stop.wait(HEARTBEAT_EVERY):
        try:
            with database.SessionLocal() as db:
                db.execute(update(Job).where(Job.id == job_id).values(heartbeat_at=utcnow()))
                db.commit()
        except Exception:  # noqa: BLE001
            log.warning("Heartbeat for job %s failed", job_id, exc_info=True)


def _claim(lane: JobLane) -> int | None:
    """`FOR UPDATE SKIP LOCKED` — correct under any number of worker processes,
    unlike the in-memory registry it replaces."""
    with database.SessionLocal() as db:
        job = db.scalars(
            select(Job)
            .where(Job.lane == lane, Job.status == JobStatus.pending)
            .order_by(Job.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        ).first()
        if job is None:
            return None
        job.status = JobStatus.running
        job.started_at = job.heartbeat_at = utcnow()
        job.attempts += 1
        db.commit()
        return job.id


def _run_one(job_id: int) -> None:
    stop = threading.Event()
    beat = threading.Thread(target=_heartbeat, args=(job_id, stop), name=f"job-{job_id}-heartbeat", daemon=True)
    beat.start()
    try:
        _settle(job_id)
    finally:
        stop.set()


def _settle(job_id: int) -> None:
    ctx = _Ctx(job_id)
    with database.SessionLocal() as db:
        job = db.get(Job, job_id)
        fn = JOB_HANDLERS.get(job.kind)
        try:
            if fn is None:
                raise RuntimeError(f"No handler for job kind {job.kind!r}")
            job.result = fn(db, job, ctx)
            job.status = JobStatus.cancelled if ctx.cancelled() else JobStatus.done
        except JobCancelled:
            db.rollback()
            job = db.get(Job, job_id)
            job.status = JobStatus.cancelled
        except Exception as exc:  # noqa: BLE001 — a crashed job must settle, not hang
            log.exception("Job %s (%s) failed", job_id, job.kind)
            db.rollback()
            job = db.get(Job, job_id)
            job.status = JobStatus.error
            job.error = str(exc) or type(exc).__name__
        job.phase = "finished"
        job.finished_at = utcnow()
        db.commit()


_stop = threading.Event()
_threads: list[threading.Thread] = []


def _worker(lane: JobLane) -> None:
    while not _stop.is_set():
        # One bad DB moment (restart, dropped connection) must not kill the lane.
        try:
            job_id = _claim(lane)
            if job_id is None:
                _stop.wait(1.0)
                continue
            _run_one(job_id)
        except Exception:  # noqa: BLE001
            log.exception("Job worker for lane %s hit an error; backing off", lane.value)
            _stop.wait(5.0)


def start_workers() -> None:
    _stop.clear()
    for lane in JobLane:
        t = threading.Thread(target=_worker, args=(lane,), name=f"job-{lane.value}", daemon=True)
        t.start()
        _threads.append(t)


def stop_workers() -> None:
    _stop.set()
    for t in _threads:
        t.join(timeout=5)
    _threads.clear()
