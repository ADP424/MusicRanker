"""Router factory shared by the person-link scans (TMDB, IGDB).

A candidate, link or suppression names its target as (entity_kind, entity_id),
and each kind maps to the ORM entity, its person-link table and the roles that
table accepts.  Scans run as Postgres-queued jobs (`jobs.py`); their results
live on the job row, so they survive restarts and the page can reopen the
latest one.
"""

from __future__ import annotations

import enum
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Iterable

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..api_models.person_scan import (
    PersonScanApplyIn,
    PersonScanApplyOut,
    PersonScanJobOut,
    PersonScanResultsOut,
    PersonScanStartIn,
    PersonScanSuppressionListOut,
    PersonScanSuppressionOut,
)
from ..authz import Capability
from ..database import get_database
from .. import jobs
from ..database_models import Job, JobLane, JobStatus, Person
from ..deps import GuildContext, guild_ctx
from ..scan_common import ScopedRejections, job_kind

VIEW = guild_ctx(Capability.VIEW)
EDIT = guild_ctx(Capability.CATALOG_EDIT)

LIVE = (JobStatus.pending, JobStatus.running)
PHASES = {"queued", "loading", "fetching", "matching", "finished"}
#: Finished scans kept per guild and scan, newest first.
KEEP_FINISHED = 5


@dataclass(frozen=True)
class EntityKind:
    model: type  # the entity: has id, guild_id, name
    link: type  # its person-link table: (<fk>, person_id, role, guild_id)
    fk: str
    role_enum: type[enum.Enum]
    roles: frozenset  # members of role_enum this kind may hold
    scope: str  # rejection scope


def make_router(
    *,
    prefix: str,
    tag: str,
    scan: str,  # the scan's name, as given to scan_common.register_scan
    lane: JobLane,
    roots: dict[str, type],  # kinds a start request may scope to; the first is the default
    kinds: dict[str, EntityKind],
    sidecar: Callable[[], ScopedRejections],
) -> APIRouter:
    router = APIRouter(prefix=f"/guilds/{{guild_id}}/{prefix}", tags=[tag])
    by_scope = {k.scope: name for name, k in kinds.items()}
    kind = job_kind(scan)

    def job_out(job: Job) -> PersonScanJobOut:
        done = job.status is JobStatus.done and job.result is not None
        return PersonScanJobOut(
            id=str(job.id),
            status=job.status.value,
            phase=job.phase if job.phase in PHASES else "queued",
            processed=job.processed,
            total=job.total,
            last_item=job.message,
            error=job.error,
            candidate_count=len(job.result["candidates"]) if done else None,
            stats=job.result["stats"] if done else None,
            scoped=bool((job.payload or {}).get("entity_ids")),
            created_at=job.created_at,
            finished_at=job.finished_at,
        )

    def job_or_404(db: Session, job_id: str, guild_id: int) -> Job:
        job = db.get(Job, int(job_id)) if job_id.isdigit() else None
        if job is None or job.guild_id != guild_id or job.kind != kind:
            raise HTTPException(404, f"No scan job {job_id!r} (it may have been discarded).")
        return job

    def in_guild(db: Session, model: type, ids: Iterable[int], guild_id: int) -> set[int]:
        ids = set(ids)
        if not ids:
            return set()
        return {r[0] for r in db.query(model.id).filter(model.id.in_(ids), model.guild_id == guild_id)}

    def valid_refs(db: Session, guild_id: int, refs) -> tuple[dict[str, set[int]], set[int]]:
        """-> (kind -> entity ids in this guild, person ids in this guild)"""
        wanted: dict[str, set[int]] = defaultdict(set)
        for r in refs:
            if r.entity_kind in kinds:
                wanted[r.entity_kind].add(r.entity_id)
        entities = {k: in_guild(db, kinds[k].model, ids, guild_id) for k, ids in wanted.items()}
        return entities, in_guild(db, Person, {r.person_id for r in refs}, guild_id)

    def guild_jobs(db: Session, guild_id: int):
        return db.query(Job).filter(Job.guild_id == guild_id, Job.kind == kind)

    @router.post("/jobs", response_model=PersonScanJobOut, status_code=202)
    def start_scan(
        body: PersonScanStartIn,
        ctx: GuildContext = Depends(EDIT),
        db: Session = Depends(get_database, scope="function"),
    ):
        running = guild_jobs(db, ctx.guild_id).filter(Job.status.in_(LIVE)).first()
        if running is not None:
            raise HTTPException(409, f"A scan is already running (job {running.id}).")
        root = body.entity_kind or next(iter(roots))
        if root not in roots:
            raise HTTPException(422, f"This scan can't be limited to {root}s.")
        if body.entity_ids:
            missing = sorted(set(body.entity_ids) - in_guild(db, roots[root], body.entity_ids, ctx.guild_id))
            if missing:
                raise HTTPException(404, f"Unknown ids: {missing}")
        # Old results are kept so the page can reopen them, but not forever.
        finished = guild_jobs(db, ctx.guild_id).filter(Job.status.notin_(LIVE)).order_by(Job.created_at.desc())
        for old in finished.offset(KEEP_FINISHED - 1).all():
            db.delete(old)
        job = jobs.enqueue(
            db, lane=lane, kind=kind, guild_id=ctx.guild_id, user_id=ctx.user_id,
            payload={"entity_ids": body.entity_ids, "entity_kind": root, "force_refresh": body.force_refresh},
        )
        return job_out(job)

    @router.get("/jobs", response_model=list[PersonScanJobOut])
    def list_jobs(ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database, scope="function")):
        return [job_out(j) for j in guild_jobs(db, ctx.guild_id).order_by(Job.created_at.desc()).limit(KEEP_FINISHED)]

    @router.get("/jobs/{job_id}", response_model=PersonScanJobOut)
    def get_job(job_id: str, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database, scope="function")):
        return job_out(job_or_404(db, job_id, ctx.guild_id))

    @router.get("/jobs/{job_id}/results", response_model=PersonScanResultsOut)
    def get_results(job_id: str, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database, scope="function")):
        job = job_or_404(db, job_id, ctx.guild_id)
        if job.status is not JobStatus.done or job.result is None:
            raise HTTPException(409, f"Job {job_id} is {job.status.value}, not done.")
        return PersonScanResultsOut(
            job_id=str(job.id), candidates=job.result["candidates"], unresolved=job.result["unresolved"],
        )

    @router.post("/jobs/{job_id}/cancel", status_code=204)
    def cancel_job(job_id: str, ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database, scope="function")):
        job = job_or_404(db, job_id, ctx.guild_id)
        jobs.request_cancel(db, job)

    @router.delete("/jobs/{job_id}", status_code=204)
    def delete_job(job_id: str, ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database, scope="function")):
        job = job_or_404(db, job_id, ctx.guild_id)
        if job.status is JobStatus.running:
            jobs.request_cancel(db, job)  # the worker still holds it; it settles as cancelled
        else:
            db.delete(job)

    @router.post("/apply", response_model=PersonScanApplyOut)
    def apply_scan(body: PersonScanApplyIn, ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database, scope="function")):
        entities, persons = valid_refs(db, ctx.guild_id, body.links)
        invalid = []
        rows: dict[str, list[dict]] = defaultdict(list)
        seen = set()  # ON CONFLICT DO NOTHING doesn't cover duplicates within one VALUES list
        for link in body.links:
            kind = kinds.get(link.entity_kind)
            role = next((r for r in kind.roles if r.value == link.role), None) if kind else None
            if (
                role is None
                or link.entity_id not in entities.get(link.entity_kind, ())
                or link.person_id not in persons
            ):
                invalid.append(link)
                continue
            k = (link.entity_kind, link.entity_id, link.person_id, role)
            if k in seen:
                continue
            seen.add(k)
            rows[link.entity_kind].append(
                {kind.fk: link.entity_id, "person_id": link.person_id, "role": role, "guild_id": ctx.guild_id}
            )

        created = 0
        for name, values in rows.items():
            kind = kinds[name]
            stmt = (
                pg_insert(kind.link.__table__)
                .values(values)
                .on_conflict_do_nothing(index_elements=[kind.fk, "person_id", "role"])
            )
            created += db.execute(stmt).rowcount or 0
        # get_database commits on success; no commit here.

        refs = body.suppress + body.unsuppress
        entities, persons = valid_refs(db, ctx.guild_id, refs)

        def keys(items):
            return [
                (kinds[s.entity_kind].scope, s.person_id, s.entity_id, s.slot)
                for s in items
                if s.entity_id in entities.get(s.entity_kind, ()) and s.person_id in persons
            ]

        store = sidecar()
        return PersonScanApplyOut(
            created=created,
            skipped=sum(len(v) for v in rows.values()) - created,
            invalid=invalid,
            suppressed=store.add_scoped_rejections(keys(body.suppress)),
            unsuppressed=store.remove_scoped_rejections(keys(body.unsuppress)),
        )

    def guild_rejections(db: Session, guild_id: int):
        """Rejections are stored globally (ids are unique across guilds); only
        this guild's entities and people are this guild's business."""
        raw = sidecar().scoped_rejections(by_scope)
        wanted: dict[str, set[int]] = defaultdict(set)
        for scope, _pid, eid, _slot in raw:
            wanted[by_scope[scope]].add(eid)
        entities = {k: in_guild(db, kinds[k].model, ids, guild_id) for k, ids in wanted.items()}
        persons = in_guild(db, Person, {r[1] for r in raw}, guild_id)
        return [r for r in raw if r[1] in persons and r[2] in entities.get(by_scope[r[0]], ())]

    @router.get("/suppressions", response_model=PersonScanSuppressionListOut)
    def list_suppressions(ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database, scope="function")):
        raw = guild_rejections(db, ctx.guild_id)
        if not raw:
            return PersonScanSuppressionListOut(count=0, items=[])
        pnames = dict(db.query(Person.id, Person.name).filter(Person.id.in_({r[1] for r in raw})))
        enames: dict[str, dict[int, str]] = {}
        for name, kind in kinds.items():
            ids = {r[2] for r in raw if by_scope[r[0]] == name}
            if ids:
                enames[name] = dict(db.query(kind.model.id, kind.model.name).filter(kind.model.id.in_(ids)))
        items = [
            PersonScanSuppressionOut(
                entity_kind=by_scope[scope],
                entity_id=eid,
                entity_name=enames.get(by_scope[scope], {}).get(eid),
                person_id=pid,
                person_name=pnames.get(pid),
                slot=slot,
            )
            for scope, pid, eid, slot in sorted(raw)
        ]
        return PersonScanSuppressionListOut(count=len(items), items=items)

    @router.delete("/suppressions", status_code=204)
    def clear_suppressions(ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database, scope="function")):
        sidecar().remove_scoped_rejections(guild_rejections(db, ctx.guild_id))

    return router
