from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import GuildMember
from ..database_models.guild_role import GuildRole
from ..database_models.job import Job, JobLane, JobStatus
from ..deps import guild_ctx
from ..jobs import enqueue, queue_position
from ..merge.preview import build_preview

router = APIRouter(prefix="/guilds/{guild_id}/merges", tags=["merge"])


def _assert_source_owned(db: DbSession, user_id: int, source_guild_id: int, target_guild_id: int) -> None:
    """D2: the source must be a guild you *own*. Otherwise a ranker in Guild B
    could siphon B's entire catalog into a guild of their own."""
    if source_guild_id == target_guild_id:
        raise HTTPException(422, "A guild cannot be merged into itself")
    m = db.get(GuildMember, (source_guild_id, user_id))
    if m is None or m.role is not GuildRole.owner:
        raise HTTPException(403, "You may only merge in a guild you own")


@router.post("/preview")
def preview(guild_id: int, body: dict, ctx=Depends(guild_ctx(Capability.MERGE_IN)),
            db: DbSession = Depends(get_database)):
    src = body["source_guild_id"]
    _assert_source_owned(db, ctx.user_id, src, guild_id)
    # D8: warn, don't block. Re-merging an updated source is a legitimate use.
    previously = db.scalar(
        select(Job).where(Job.guild_id == guild_id, Job.kind == "guild_merge",
                          Job.status == JobStatus.done,
                          Job.payload["source_guild_id"].astext == str(src))
    )
    sections = build_preview(db, src, guild_id)
    return {
        "source_guild_id": src,
        "already_merged": previously is not None,
        "sections": {k: [asdict(i) for i in v] for k, v in sections.items()},
    }


@router.post("", status_code=202)
def start_merge(guild_id: int, body: dict, ctx=Depends(guild_ctx(Capability.MERGE_IN)),
                db: DbSession = Depends(get_database)):
    _assert_source_owned(db, ctx.user_id, body["source_guild_id"], guild_id)
    job = enqueue(db, lane=JobLane.merge, kind="guild_merge", guild_id=guild_id, user_id=ctx.user_id,
                  payload={"source_guild_id": body["source_guild_id"],
                           "decisions": body["decisions"],
                           "copy_my_ranking": body.get("copy_my_ranking", True)})
    return {"job_id": job.id, "queue_position": queue_position(db, job)}
