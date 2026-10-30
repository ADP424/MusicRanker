"""Router factory shared by the television and game person-link scans.

Same endpoints as `movie_person_scan.py`, generalised over entity kinds: a
candidate, link or suppression names its target as (entity_kind, entity_id),
and each kind maps to the ORM entity, its person-link table and the roles that
table accepts.
"""

from __future__ import annotations

import enum
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..api_models.person_scan import (
    PersonScanApplyIn,
    PersonScanApplyOut,
    PersonScanCandidateOut,
    PersonScanJobOut,
    PersonScanResultsOut,
    PersonScanStartIn,
    PersonScanSuppressionListOut,
    PersonScanSuppressionOut,
    PersonScanUnresolvedOut,
)
from ..authz import Capability
from ..database import get_database
from ..database_models import Person
from ..deps import GuildContext, guild_ctx
from ..scan_common import JobRegistry, ScopedRejections

VIEW = guild_ctx(Capability.VIEW)
EDIT = guild_ctx(Capability.CATALOG_EDIT)


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
    registry: JobRegistry,
    run_scan: Callable[[str, int, Optional[list[int]], bool], None],
    root: type,  # what `entity_ids` in a start request refers to
    kinds: dict[str, EntityKind],
    sidecar: Callable[[], ScopedRejections],
) -> APIRouter:
    router = APIRouter(prefix=f"/guilds/{{guild_id}}/{prefix}", tags=[tag])
    by_scope = {k.scope: name for name, k in kinds.items()}

    def job_or_404(job_id: str, guild_id: int):
        job = registry.get(job_id, guild_id)
        if job is None:
            raise HTTPException(404, f"No scan job {job_id!r} (it may have expired).")
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

    @router.post("/jobs", response_model=PersonScanJobOut, status_code=202)
    def start_scan(
        body: PersonScanStartIn,
        background: BackgroundTasks,
        ctx: GuildContext = Depends(EDIT),
        db: Session = Depends(get_database),
    ):
        registry.evict()
        running = registry.running(ctx.guild_id)
        if running is not None:
            raise HTTPException(409, f"A scan is already running (job {running.id}).")
        if body.entity_ids:
            missing = sorted(set(body.entity_ids) - in_guild(db, root, body.entity_ids, ctx.guild_id))
            if missing:
                raise HTTPException(404, f"Unknown ids: {missing}")
        job = registry.create(ctx.guild_id)
        # The request session is closed before this runs; run_scan opens its own.
        background.add_task(run_scan, job.id, ctx.guild_id, body.entity_ids, body.force_refresh)
        return job

    @router.get("/jobs", response_model=list[PersonScanJobOut])
    def list_jobs(ctx: GuildContext = Depends(VIEW)):
        registry.evict()
        return registry.list(ctx.guild_id)

    @router.get("/jobs/{job_id}", response_model=PersonScanJobOut)
    def get_job(job_id: str, ctx: GuildContext = Depends(VIEW)):
        return job_or_404(job_id, ctx.guild_id)

    @router.get("/jobs/{job_id}/results", response_model=PersonScanResultsOut)
    def get_results(job_id: str, ctx: GuildContext = Depends(VIEW)):
        job = job_or_404(job_id, ctx.guild_id)
        if job.status != "done":
            raise HTTPException(409, f"Job {job_id} is {job.status}, not done.")
        return PersonScanResultsOut(
            job_id=job.id,
            candidates=[PersonScanCandidateOut.model_validate(c) for c in job.candidates],
            unresolved=[PersonScanUnresolvedOut.model_validate(u) for u in job.unresolved],
        )

    @router.post("/jobs/{job_id}/cancel", status_code=204)
    def cancel_job(job_id: str, ctx: GuildContext = Depends(EDIT)):
        job = job_or_404(job_id, ctx.guild_id)
        job.cancel.set()
        # Settle now, so the next POST /jobs doesn't 409 while the worker unwinds.
        if job.status in ("pending", "running"):
            job.mark(status="cancelled", phase="finished", finished_at=time.time())

    @router.delete("/jobs/{job_id}", status_code=204)
    def delete_job(job_id: str, ctx: GuildContext = Depends(EDIT)):
        job = job_or_404(job_id, ctx.guild_id)
        job.cancel.set()  # stop the worker before we drop our handle on it
        registry.delete(job_id)

    @router.post("/apply", response_model=PersonScanApplyOut)
    def apply_scan(body: PersonScanApplyIn, ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database)):
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
    def list_suppressions(ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database)):
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
    def clear_suppressions(ctx: GuildContext = Depends(EDIT), db: Session = Depends(get_database)):
        sidecar().remove_scoped_rejections(guild_rejections(db, ctx.guild_id))

    return router
