"""One person's whole TMDB filmography next to the catalog.

Each TMDB credit is matched to a catalog movie / show (stored `tmdb_id` first,
then exact normalised title + year) and reports which roles the person already
holds there, so the page can offer "Link" for titles in the catalog and "Import"
for the rest. A person with no stored TMDB id gets search candidates instead;
picking one stores it (`PUT .../tmdb-id`).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .. import tmdb_common as common
from ..authz import Capability
from ..database import get_database
from ..database_models import (
    CastRole, Movie, MoviePerson, Person, TelevisionEpisode, TelevisionEpisodePerson, TelevisionSeason,
    TelevisionSeasonPerson, TelevisionShow, TelevisionShowPerson,
)
from ..deps import GuildContext, guild_ctx
from ..normalize import norm
from ..tmdb_client import TTL_SEARCH
from ..tmdb_tv_import import COMPOSER_JOBS, DIRECTOR_JOBS

router = APIRouter(prefix="/guilds/{guild_id}/persons", tags=["persons"])
VIEW = guild_ctx(Capability.VIEW)
EDIT = guild_ctx(Capability.CATALOG_EDIT)


class CreditRole(BaseModel):
    label: str  # the character, or the crew job
    role: CastRole | None  # what linking would record; None for jobs the catalog has no role for


class TmdbCredit(BaseModel):
    media: Literal["movie", "tv"]
    tmdb_id: int
    title: str
    year: int | None
    poster_url: str | None
    popularity: float
    roles: list[CreditRole]
    local_id: int | None  # the catalog movie / show, if there is one
    linked_roles: list[CastRole]  # roles the person already holds there (TV: on the show or anything below it)


class PersonCandidate(BaseModel):
    tmdb_id: int
    name: str
    department: str | None
    known_for: list[str]
    profile_url: str | None


class PersonTmdbOut(BaseModel):
    tmdb_id: int | None
    profile_url: str | None = None
    candidates: list[PersonCandidate] = []  # only when there's no stored id
    credits: list[TmdbCredit] = []


class TmdbIdIn(BaseModel):
    tmdb_id: int | None


def _person(db: DbSession, ctx: GuildContext, pid: int) -> Person:
    p = db.get(Person, pid)
    if p is None or p.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")
    return p


def _year(date: str | None) -> int | None:
    y = (date or "")[:4]
    return int(y) if y.isdigit() else None


def _crew_role(media: str, job: str) -> CastRole | None:
    j = job.lower()
    if j in DIRECTOR_JOBS:
        return CastRole.director if media == "movie" else None  # shows have creators, not directors
    if j in COMPOSER_JOBS:
        return CastRole.composer
    if j in ("creator", "series creator") and media == "tv":
        return CastRole.creator
    return None


def _cast_role(c: dict) -> CastRole:
    if c.get("media_type") == "tv":
        # Combined credits carry the person's episode count but not the show's.
        n = c.get("episode_count") or 0
        return CastRole.cameo_actor if n <= 2 else CastRole.actor
    return common.suggest_cast_role(order=c.get("order"), popularity=c.get("popularity") or 0,
                                    character=c.get("character") or "")[0]


def _credits(data: dict) -> dict[tuple[str, int], TmdbCredit]:
    out: dict[tuple[str, int], TmdbCredit] = {}
    for kind in ("cast", "crew"):
        for c in data.get(kind) or []:
            media = c.get("media_type")
            if media not in ("movie", "tv") or not c.get("id"):
                continue
            key = (media, c["id"])
            if key not in out:
                out[key] = TmdbCredit(
                    media=media, tmdb_id=c["id"],
                    title=(c.get("title") if media == "movie" else c.get("name")) or "",
                    year=_year(c.get("release_date") if media == "movie" else c.get("first_air_date")),
                    poster_url=common.image_url(c.get("poster_path"), "w92"),
                    popularity=c.get("popularity") or 0, roles=[], local_id=None, linked_roles=[],
                )
            if kind == "cast":
                label, role = c.get("character") or "Actor", _cast_role(c)
            else:
                label, role = c.get("job") or "Crew", _crew_role(media, c.get("job") or "")
            if all(r.label != label or r.role != role for r in out[key].roles):
                out[key].roles.append(CreditRole(label=label, role=role))
    return out


def _match_local(db: DbSession, guild_id: int, model, credits: list[TmdbCredit]) -> None:
    rows = db.execute(select(model.id, model.tmdb_id, model.name_norm, model.name_en_norm, model.release_year)
                      .where(model.guild_id == guild_id)).all()
    by_id = {r.tmdb_id: r.id for r in rows if r.tmdb_id}
    by_title: dict[tuple[str, int], list[int]] = defaultdict(list)
    for r in rows:
        for n in {r.name_norm, r.name_en_norm} - {None}:
            by_title[(n, r.release_year)].append(r.id)
    for c in credits:
        if c.tmdb_id in by_id:
            c.local_id = by_id[c.tmdb_id]
        elif c.year is not None:
            hits = set(by_title.get((norm(c.title), c.year), []))
            if len(hits) == 1:
                c.local_id = hits.pop()


def _linked(db: DbSession, person: Person, credits: list[TmdbCredit]) -> None:
    movies: dict[int, set] = defaultdict(set)
    for mid, role in db.execute(select(MoviePerson.movie_id, MoviePerson.role).where(MoviePerson.person_id == person.id)):
        movies[mid].add(role)
    shows: dict[int, set] = defaultdict(set)
    for q in (
        select(TelevisionShowPerson.show_id, TelevisionShowPerson.role).where(TelevisionShowPerson.person_id == person.id),
        select(TelevisionSeason.show_id, TelevisionSeasonPerson.role)
        .join(TelevisionSeason, TelevisionSeason.id == TelevisionSeasonPerson.season_id)
        .where(TelevisionSeasonPerson.person_id == person.id),
        select(TelevisionEpisode.show_id, TelevisionEpisodePerson.role)
        .join(TelevisionEpisode, TelevisionEpisode.id == TelevisionEpisodePerson.episode_id)
        .where(TelevisionEpisodePerson.person_id == person.id),
    ):
        for sid, role in db.execute(q):
            shows[sid].add(role)
    for c in credits:
        if c.local_id is not None:
            held = (movies if c.media == "movie" else shows).get(c.local_id, set())
            c.linked_roles = sorted(held, key=lambda r: list(CastRole).index(r))


@router.get("/{pid}/tmdb-credits", response_model=PersonTmdbOut)
def tmdb_credits(pid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    person = _person(db, ctx, pid)
    c = common.client()
    if person.tmdb_id is None:
        data = c.get("/search/person", params={"query": person.name_en or person.name}, ttl=TTL_SEARCH) or {}
        return PersonTmdbOut(tmdb_id=None, candidates=[
            PersonCandidate(
                tmdb_id=r["id"], name=r.get("name") or "", department=r.get("known_for_department"),
                known_for=[k.get("title") or k.get("name") or "" for k in (r.get("known_for") or [])][:3],
                profile_url=common.image_url(r.get("profile_path"), "w92"),
            )
            for r in (data.get("results") or [])[:8]
        ])

    details = c.get(f"/person/{person.tmdb_id}") or {}
    credits = list(_credits(c.get(common.PERSON_CREDITS_PATH.format(pid=person.tmdb_id)) or {}).values())
    _match_local(db, ctx.guild_id, Movie, [x for x in credits if x.media == "movie"])
    _match_local(db, ctx.guild_id, TelevisionShow, [x for x in credits if x.media == "tv"])
    _linked(db, person, credits)
    credits.sort(key=lambda x: (-(x.year or 0), x.title))
    return PersonTmdbOut(tmdb_id=person.tmdb_id, profile_url=common.image_url(details.get("profile_path"), "w185"),
                         credits=credits)


@router.put("/{pid}/tmdb-id", status_code=204)
def set_tmdb_id(pid: int, body: TmdbIdIn, ctx: GuildContext = Depends(EDIT),
                db: DbSession = Depends(get_database, scope="function")):
    """Say which TMDB person this is (or, with null, that we don't know)."""
    person = _person(db, ctx, pid)
    if body.tmdb_id is not None:
        other = db.scalar(select(Person.id).where(
            Person.guild_id == ctx.guild_id, Person.tmdb_id == body.tmdb_id, Person.id != pid))
        if other is not None:
            raise HTTPException(409, f"Another person (id {other}) is already that TMDB person; merge them instead.")
    person.tmdb_id = body.tmdb_id
    person.updated_by_user_id = ctx.user_id
