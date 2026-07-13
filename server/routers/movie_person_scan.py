import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..api_models.movie_person_scan import (
    ScanApplyIn,
    ScanApplyOut,
    ScanCandidateOut,
    ScanJobOut,
    ScanResultsOut,
    ScanStartIn,
    SuppressionListOut,
    SuppressionOut,
    UnresolvedMovieOut,
)
from ..database import get_database
from ..database_models import Movie, MoviePerson, Person
from ..tmdb_client import get_sidecar
from ..tmdb_scan import REGISTRY, run_scan

router = APIRouter(prefix="/movie-person-scan", tags=["movie-person-scan"])


def _job_or_404(job_id: str):
    job = REGISTRY.get(job_id)
    if job is None:
        raise HTTPException(404, f"No scan job {job_id!r} (it may have expired).")
    return job


@router.post("/jobs", response_model=ScanJobOut, status_code=202)
def start_scan(
    body: ScanStartIn,
    background: BackgroundTasks,
    db: Session = Depends(get_database),
):
    REGISTRY.evict()

    running = REGISTRY.running()
    if running is not None:
        raise HTTPException(409, f"A scan is already running (job {running.id}).")

    if body.movie_ids:
        found = {r[0] for r in db.query(Movie.id).filter(Movie.id.in_(body.movie_ids))}
        missing = sorted(set(body.movie_ids) - found)
        if missing:
            raise HTTPException(404, f"Unknown movie ids: {missing}")

    job = REGISTRY.create()
    # The request session is closed before this runs; run_scan opens its own.
    background.add_task(run_scan, job.id, body.movie_ids, body.force_refresh)
    return job


@router.get("/jobs", response_model=list[ScanJobOut])
def list_jobs():
    REGISTRY.evict()
    return REGISTRY.list()


@router.get("/jobs/{job_id}", response_model=ScanJobOut)
def get_job(job_id: str):
    return _job_or_404(job_id)


@router.get("/jobs/{job_id}/results", response_model=ScanResultsOut)
def get_results(job_id: str):
    job = _job_or_404(job_id)
    if job.status != "done":
        raise HTTPException(409, f"Job {job_id} is {job.status}, not done.")
    return ScanResultsOut(
        job_id=job.id,
        candidates=[ScanCandidateOut.model_validate(c) for c in job.candidates],
        unresolved_movies=[UnresolvedMovieOut.model_validate(m) for m in job.unresolved],
    )


@router.post("/jobs/{job_id}/cancel", status_code=204)
def cancel_job(job_id: str):
    job = _job_or_404(job_id)
    job.cancel.set()
    # Settle now. The worker sees the flag and unwinds; until it does, its
    # in-flight requests would otherwise keep REGISTRY.running() truthy and
    # make the next POST /jobs 409.
    if job.status in ("pending", "running"):
        job.mark(status="cancelled", phase="finished", finished_at=time.time())


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: str):
    job = _job_or_404(job_id)
    job.cancel.set()  # stop the worker before we drop our handle on it
    REGISTRY.delete(job_id)


@router.post("/apply", response_model=ScanApplyOut)
def apply_scan(body: ScanApplyIn, db: Session = Depends(get_database)):
    created = 0
    invalid = []
    rows: list[dict] = []

    if body.links:
        movie_ids = {link.movie_id for link in body.links}
        person_ids = {link.person_id for link in body.links}
        valid_m = {r[0] for r in db.query(Movie.id).filter(Movie.id.in_(movie_ids))}
        valid_p = {r[0] for r in db.query(Person.id).filter(Person.id.in_(person_ids))}

        # Dedupe: ON CONFLICT DO NOTHING does not protect against duplicate
        # rows *within* a single VALUES list.
        seen = set()
        for link in body.links:
            if link.movie_id not in valid_m or link.person_id not in valid_p:
                invalid.append(link)
                continue
            k = (link.movie_id, link.person_id, link.role)
            if k in seen:
                continue
            seen.add(k)
            rows.append({"movie_id": link.movie_id, "person_id": link.person_id, "role": link.role})

        if rows:
            stmt = (
                pg_insert(MoviePerson.__table__)
                .values(rows)
                .on_conflict_do_nothing(index_elements=["movie_id", "person_id", "role"])
            )
            created = db.execute(stmt).rowcount or 0
            # get_database commits on success; no commit here.

    sidecar = get_sidecar()
    suppressed = sidecar.add_rejections((s.person_id, s.movie_id, s.slot) for s in body.suppress)
    unsuppressed = sidecar.remove_rejections((s.person_id, s.movie_id, s.slot) for s in body.unsuppress)

    return ScanApplyOut(
        created=created,
        skipped=len(rows) - created,
        invalid=invalid,
        suppressed=suppressed,
        unsuppressed=unsuppressed,
    )


@router.get("/suppressions", response_model=SuppressionListOut)
def list_suppressions(db: Session = Depends(get_database)):
    raw = get_sidecar().rejections_detailed()
    if not raw:
        return SuppressionListOut(count=0, items=[])

    pnames = dict(db.query(Person.id, Person.name).filter(Person.id.in_({r[0] for r in raw})).all())
    mnames = dict(db.query(Movie.id, Movie.name).filter(Movie.id.in_({r[1] for r in raw})).all())

    items = [
        SuppressionOut(
            person_id=pid,
            person_name=pnames.get(pid),
            movie_id=mid,
            movie_name=mnames.get(mid),
            slot=slot,
        )
        for pid, mid, slot, _ in raw
    ]
    return SuppressionListOut(count=len(items), items=items)


@router.delete("/suppressions", status_code=204)
def clear_suppressions():
    get_sidecar().clear_rejections()
