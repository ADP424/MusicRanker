from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from ..database import get_database
from ..database_models import Job, JobStatus, User
from ..deps import current_user
from .. import jobs
from ..jobs import queue_position

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobOut(BaseModel):
    id: int
    lane: str
    kind: str
    guild_id: int | None
    status: JobStatus
    phase: str
    processed: int
    total: int
    message: str | None
    queue_position: int
    result: dict | None
    error: str | None


def _mine(db: DbSession, job_id: int, user: User) -> Job:
    job = db.get(Job, job_id)
    # Someone else's job is indistinguishable from a nonexistent one.
    if job is None or job.user_id != user.id:
        raise HTTPException(404, "No such job")
    return job


def _out(db: DbSession, job: Job) -> JobOut:
    return JobOut(
        id=job.id, lane=job.lane.value, kind=job.kind, guild_id=job.guild_id,
        status=job.status, phase=job.phase, processed=job.processed, total=job.total,
        message=job.message, queue_position=queue_position(db, job),
        result=job.result, error=job.error,
    )


@router.get("", response_model=list[JobOut])
def my_jobs(user: User = Depends(current_user), db: DbSession = Depends(get_database, scope="function")):
    rows = db.query(Job).filter(Job.user_id == user.id).order_by(Job.created_at.desc()).limit(25).all()
    return [_out(db, j) for j in rows]


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_database, scope="function")):
    return _out(db, _mine(db, job_id, user))


@router.post("/{job_id}/cancel", status_code=204)
def cancel_job(job_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_database, scope="function")):
    jobs.request_cancel(db, _mine(db, job_id, user))
