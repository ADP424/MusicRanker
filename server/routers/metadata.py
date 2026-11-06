"""Refresh a catalog entry's synopsis and artwork from TMDB / IGDB.

For entries imported before ids and artwork were stored, or entered by hand:
the entry's stored id is used when it has one; otherwise it's looked up by
title and year, and only an unambiguous match is taken (and remembered).
Fields are only ever filled or refreshed from the provider, never cleared.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .. import jobs, loading
from .. import tmdb_common as common
from ..authz import Capability
from ..database import get_database
from ..database_models import Game, Job, JobLane, JobStatus, Movie, TelevisionShow
from ..deps import GuildContext, guild_ctx
from ..igdb_client import IgdbClient, get_sidecar as igdb_sidecar
from ..igdb_import import cover_url

router = APIRouter(prefix="/guilds/{guild_id}", tags=["metadata"])
EDIT = guild_ctx(Capability.CATALOG_EDIT)


class RefreshOut(BaseModel):
    external_id: int
    overview: str | None
    image_url: str | None
    filled: list[str]  # what changed


def _own(db: DbSession, model, ctx: GuildContext, ident: int):
    row = db.get(model, ident)
    if row is None or row.guild_id != ctx.guild_id:
        raise HTTPException(404, "Not found")
    return row


def _claim(db: DbSession, model, row, column: str, ext_id: int) -> None:
    """Take an id unless another entry of the guild already has it."""
    if getattr(row, column) == ext_id:
        return
    other = db.scalar(select(model.id).where(
        model.guild_id == row.guild_id, getattr(model, column) == ext_id, model.id != row.id,
    ))
    if other is not None:
        raise HTTPException(409, f"Another entry (id {other}) is already linked to that title; merge or fix it first.")
    setattr(row, column, ext_id)


def _apply(row, filled: list[str], **values) -> None:
    for field, value in values.items():
        if value and getattr(row, field) != value:
            setattr(row, field, value)
            filled.append(field)


def _tmdb_find(c, row, path: str, year_param: str, keys: tuple[str, ...]) -> int:
    best, ambiguous = None, False
    for title in filter(None, (row.name_en, row.name)):
        best, ambiguous = common.search_best(c, path, title, year=row.release_year, year_param=year_param, title_keys=keys)
        if best:
            break
    if best is None:
        raise HTTPException(404, "TMDB has nothing with this title and year.")
    if ambiguous:
        raise HTTPException(409, "Several TMDB titles match; import it from TMDB once to pick the right one.")
    return best["id"]


@router.post("/movies/{mid}/tmdb-refresh", response_model=RefreshOut)
def refresh_movie(mid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    movie = _own(db, Movie, ctx, mid)
    c = common.client()
    tid = movie.tmdb_id or _tmdb_find(c, movie, "/search/movie", "primary_release_year", ("title", "original_title"))
    details = c.get(f"/movie/{tid}")
    if not details:
        raise HTTPException(502, "TMDB didn't answer; try again in a moment.")
    filled: list[str] = []
    if movie.tmdb_id is None:
        filled.append("tmdb_id")
    _claim(db, Movie, movie, "tmdb_id", tid)
    _apply(movie, filled, overview=details.get("overview"), image_url=common.image_url(details.get("poster_path")))
    if not movie.runtime_minutes and details.get("runtime"):
        _apply(movie, filled, runtime_minutes=details["runtime"])
    return RefreshOut(external_id=tid, overview=movie.overview, image_url=movie.image_url, filled=filled)


@router.post("/television/shows/{sid}/tmdb-refresh", response_model=RefreshOut)
def refresh_show(sid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    show = loading.get(db, TelevisionShow, sid, loading.SHOW)
    if show is None or show.guild_id != ctx.guild_id:
        raise HTTPException(404, "Not found")
    c = common.client()
    tid = show.tmdb_id or _tmdb_find(c, show, "/search/tv", "first_air_date_year", ("name", "original_name"))
    details = c.get(f"/tv/{tid}")
    if not details:
        raise HTTPException(502, "TMDB didn't answer; try again in a moment.")
    filled: list[str] = []
    if show.tmdb_id is None:
        filled.append("tmdb_id")
    _claim(db, TelevisionShow, show, "tmdb_id", tid)
    _apply(show, filled, overview=details.get("overview"), image_url=common.image_url(details.get("poster_path")))
    # Seasons come along for free: the show's details list each one's synopsis and poster.
    meta = {m.get("season_number"): m for m in details.get("seasons") or []}
    seasons_filled: list[str] = []
    for season in show.seasons:
        m = meta.get(season.season_number)
        if m:
            _apply(season, seasons_filled, overview=m.get("overview"), image_url=common.image_url(m.get("poster_path")))
    if seasons_filled:
        filled.append("seasons")
    return RefreshOut(external_id=tid, overview=show.overview, image_url=show.image_url, filled=filled)


@router.post("/games/{gid}/igdb-refresh", response_model=RefreshOut)
def refresh_game(gid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    game = _own(db, Game, ctx, gid)
    client = IgdbClient(igdb_sidecar())
    fields = "fields name,first_release_date,summary,cover.image_id;"
    if game.igdb_id:
        results = client.post("games", f"{fields} where id = {game.igdb_id};")
    else:
        escaped = game.name.replace('"', '\\"')
        results = client.post("games", f'search "{escaped}"; {fields} limit 10;')
        results = [
            r for r in results or []
            if common.norm(r.get("name") or "") == common.norm(game.name)
            and r.get("first_release_date") and abs(_year(r["first_release_date"]) - game.release_year) <= 1
        ]
        if len(results) > 1:
            raise HTTPException(409, "Several IGDB games match; import it from IGDB once to pick the right one.")
    if not results:
        raise HTTPException(404, "IGDB has no game with this title and year.")
    r = results[0]
    filled: list[str] = []
    if game.igdb_id is None:
        filled.append("igdb_id")
    _claim(db, Game, game, "igdb_id", r["id"])
    _apply(game, filled, overview=r.get("summary"), image_url=cover_url((r.get("cover") or {}).get("image_id")))
    return RefreshOut(external_id=r["id"], overview=game.overview, image_url=game.image_url, filled=filled)


def _year(unix_ts: int) -> int:
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).year


# ── Bulk: fill every entry that has an id but no artwork ─────────────────────
ARTWORK_JOB = "artwork_backfill"


class BackfillOut(BaseModel):
    job_id: int
    missing: int  # entries the job will look up


def _missing(db: DbSession, guild_id: int):
    """(model, entry ids) that have an external id but no picture yet."""
    for model, col in ((Movie, Movie.tmdb_id), (TelevisionShow, TelevisionShow.tmdb_id), (Game, Game.igdb_id)):
        ids = list(db.scalars(select(model.id).where(model.guild_id == guild_id, col.isnot(None), model.image_url.is_(None))))
        yield model, ids


@router.post("/metadata/backfill", response_model=BackfillOut, status_code=202)
def start_backfill(ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    running = db.scalar(select(Job.id).where(
        Job.guild_id == ctx.guild_id, Job.kind == ARTWORK_JOB, Job.status.in_((JobStatus.pending, JobStatus.running)),
    ))
    if running is not None:
        raise HTTPException(409, f"Already fetching artwork (job {running}).")
    missing = sum(len(ids) for _, ids in _missing(db, ctx.guild_id))
    job = jobs.enqueue(db, lane=JobLane.tmdb, kind=ARTWORK_JOB, guild_id=ctx.guild_id, user_id=ctx.user_id, payload={})
    return BackfillOut(job_id=job.id, missing=missing)


@jobs.handler(ARTWORK_JOB)
def _backfill(db: DbSession, job: Job, ctx: jobs.JobContext) -> dict:
    guild_id = job.guild_id
    todo = {model.__name__: ids for model, ids in _missing(db, guild_id)}
    db.commit()
    total = sum(len(ids) for ids in todo.values())
    ctx.progress(phase="fetching", total=total, processed=0)
    done = filled = 0
    c = common.client()

    def tick(name: str) -> None:
        nonlocal done
        done += 1
        if done % 10 == 0 or done == total:
            if ctx.cancelled():
                raise jobs.JobCancelled()
            ctx.progress(processed=done, message=name)

    for model, path in ((Movie, "/movie/{}"), (TelevisionShow, "/tv/{}")):
        for ident in todo[model.__name__]:
            row = db.get(model, ident)
            details = c.get(path.format(row.tmdb_id))
            if details:
                changed: list[str] = []
                _apply(row, changed, overview=details.get("overview"), image_url=common.image_url(details.get("poster_path")))
                if model is TelevisionShow:
                    meta = {m.get("season_number"): m for m in details.get("seasons") or []}
                    for season in row.seasons:
                        m = meta.get(season.season_number)
                        if m:
                            _apply(season, changed, overview=m.get("overview"),
                                   image_url=common.image_url(m.get("poster_path")))
                filled += bool(changed)
                db.commit()
            tick(row.name)

    games = todo["Game"]
    igdb = IgdbClient(igdb_sidecar())
    for start in range(0, len(games), 200):  # IGDB answers up to 500 ids per query
        rows = {g.igdb_id: g for g in db.scalars(select(Game).where(Game.id.in_(games[start:start + 200])))}
        ids = ",".join(str(i) for i in rows)
        for r in igdb.post("games", f"fields summary,cover.image_id; where id = ({ids}); limit 500;") or []:
            g = rows.get(r["id"])
            if g is not None:
                changed = []
                _apply(g, changed, overview=r.get("summary"), image_url=cover_url((r.get("cover") or {}).get("image_id")))
                filled += bool(changed)
        db.commit()
        for g in rows.values():
            tick(g.name)

    return {"looked_up": total, "filled": filled}
