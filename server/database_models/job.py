from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .mixins import utcnow


class JobLane(str, enum.Enum):
    tmdb = "tmdb"
    igdb = "igdb"
    merge = "merge"


class JobStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    done = "done"
    cancelled = "cancelled"
    error = "error"


job_lane_type = Enum(JobLane, name="job_lane")
job_status_type = Enum(JobStatus, name="job_status")


class Job(Base):
    """Jobs live in Postgres, not in a process-global dict.

    The old `tmdb_scan.REGISTRY` enforced "one scan at a time" *globally* across
    all users, and broke outright under `uvicorn --workers > 1` (a job started in
    worker A 404s when polled from worker B). Workers now claim rows with
    `FOR UPDATE SKIP LOCKED`, which is correct for any number of processes.
    """

    __tablename__ = "jobs"
    __table_args__ = (Index("idx_jobs_lane_pending", "lane", "status", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lane: Mapped[JobLane] = mapped_column(job_lane_type)
    kind: Mapped[str] = mapped_column(Text)  # dispatch key into JOB_HANDLERS
    guild_id: Mapped[int | None] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    status: Mapped[JobStatus] = mapped_column(job_status_type, default=JobStatus.pending, index=True)
    phase: Mapped[str] = mapped_column(Text, default="queued")
    processed: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)

    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    result: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
