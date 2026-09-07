from __future__ import annotations

import threading
import time
from typing import Callable, Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import database
from .database_models.job import Job, JobLane, JobStatus
from .database_models.mixins import utcnow


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
            db.commit()


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
        job.started_at = utcnow()
        db.commit()
        return job.id


def _run_one(job_id: int) -> None:
    ctx = _Ctx(job_id)
    with database.SessionLocal() as db:
        job = db.get(Job, job_id)
        fn = JOB_HANDLERS.get(job.kind)
        try:
            if fn is None:
                raise RuntimeError(f"No handler for job kind {job.kind!r}")
            job.result = fn(db, job, ctx)
            job.status = JobStatus.cancelled if ctx.cancelled() else JobStatus.done
        except Exception as exc:  # noqa: BLE001 — a crashed job must settle, not hang
            db.rollback()
            job = db.get(Job, job_id)
            job.status = JobStatus.error
            job.error = str(exc)
        job.phase = "finished"
        job.finished_at = utcnow()
        db.commit()


_stop = threading.Event()
_threads: list[threading.Thread] = []


def _worker(lane: JobLane) -> None:
    while not _stop.is_set():
        job_id = _claim(lane)
        if job_id is None:
            _stop.wait(1.0)
            continue
        _run_one(job_id)


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
