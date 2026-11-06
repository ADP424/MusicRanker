from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session as DbSession

from ..api_models.base import PositionBody, ReorderBody
from ..api_models.comparison import ComparisonIn, ComparisonOut
from ..api_models.music import NamedRef
from ..api_models.television import (
    EpisodeRef, RankedTelevisionEpisodeOut, RankedTelevisionSeasonOut, RankedTelevisionShowOut, SeasonRef,
    TelevisionEpisodeEntryIn, TelevisionEpisodeEntryOut, TelevisionEpisodeIn, TelevisionEpisodeOut,
    TelevisionEpisodePatch, TelevisionPersonRef, TelevisionSeasonEntryIn, TelevisionSeasonEntryOut,
    TelevisionSeasonIn, TelevisionSeasonOut, TelevisionSeasonPatch, TelevisionShowEntryIn, TelevisionShowEntryOut,
    TelevisionShowIn, TelevisionShowOut, TelevisionShowPatch,
)
from ..authz import Capability
from ..comparisons import clear_comparisons, delete_comparison, list_comparisons, upsert_comparison
from ..database import get_database
from ..database_models import (
    Genre, GuildMember, Person, TelevisionEpisode, TelevisionEpisodeComparison, TelevisionEpisodeLink,
    TelevisionEpisodePerson, TelevisionSeason, TelevisionSeasonComparison, TelevisionSeasonLink,
    TelevisionSeasonPerson, TelevisionShow, TelevisionShowComparison, TelevisionShowEpisodeComparison, TelevisionShowLink,
    TelevisionShowPerson,
)
from ..database_models.movie_cast_member import CastRole
from ..database_models.ranking import UserTelevisionEpisodeRank, UserTelevisionSeasonRank, UserTelevisionShowRank
from ..deps import GuildContext, guild_ctx
from ..guild_junction_helpers import link_guild_scoped
from ..ranking import apply_order, check_reorder_ids, next_rank, rank_at
from ..television_hierarchy import (
    merge_people, move_episode, next_episode_rank, next_season_rank, populate_season_down, populate_show_down,
)
from .. import loading
from .links import make_links_router

router = APIRouter(prefix="/guilds/{guild_id}/television", tags=["television"])

VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)
RANK = guild_ctx(Capability.RANK)

# `owner_id` in the generic links router maps onto `/television/shows/{owner_id}/links`.
links_router = make_links_router(
    owner_model=TelevisionShow, link_model=TelevisionShowLink,
    owner_fk="show_id", prefix="/television/shows", tag="television",
)
season_links_router = make_links_router(
    owner_model=TelevisionSeason, link_model=TelevisionSeasonLink,
    owner_fk="season_id", prefix="/television/seasons", tag="television",
)
episode_links_router = make_links_router(
    owner_model=TelevisionEpisode, link_model=TelevisionEpisodeLink,
    owner_fk="episode_id", prefix="/television/episodes", tag="television",
)


def _show(db: DbSession, ctx: GuildContext, sid: int) -> TelevisionShow:
    s = loading.get(db, TelevisionShow, sid, loading.SHOW)
    if s is None or s.guild_id != ctx.guild_id:
        raise HTTPException(404, "Show not found")
    return s


def _season(db: DbSession, ctx: GuildContext, seid: int) -> TelevisionSeason:
    s = loading.get(db, TelevisionSeason, seid, loading.SEASON)
    if s is None or s.guild_id != ctx.guild_id:
        raise HTTPException(404, "Season not found")
    return s


def _episode(db: DbSession, ctx: GuildContext, eid: int) -> TelevisionEpisode:
    e = loading.get(db, TelevisionEpisode, eid, loading.EPISODE)
    if e is None or e.guild_id != ctx.guild_id:
        raise HTTPException(404, "Episode not found")
    return e


def _person(db: DbSession, ctx: GuildContext, person_id: int) -> Person:
    person = db.get(Person, person_id)
    if person is None or person.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")
    return person


def _genre(db: DbSession, ctx: GuildContext, genre_id: int) -> Genre:
    genre = db.get(Genre, genre_id)
    if genre is None or genre.guild_id != ctx.guild_id:
        raise HTTPException(404, "Genre not found")
    if not genre.is_television:
        raise HTTPException(422, "Genre is not applicable to television")
    return genre


def _target_user(db: DbSession, ctx: GuildContext, user_id: int | None) -> int:
    if user_id is None or user_id == ctx.user_id:
        return ctx.user_id
    if db.get(GuildMember, (ctx.guild_id, user_id)) is None:
        raise HTTPException(404, "Not a member of this guild")
    return user_id


def _mine(db: DbSession, ctx: GuildContext, id_col, *scope) -> set[int]:
    """Ids of `id_col`'s entity in the caller's own list (the `in_my_list` flag)."""
    model = id_col.class_
    return set(db.scalars(
        select(id_col).where(model.user_id == ctx.user_id, model.guild_id == ctx.guild_id, *scope)
    ))


def _persons(links) -> list[TelevisionPersonRef]:
    return [TelevisionPersonRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role) for l in links]


def _show_out(s: TelevisionShow, mine: set[int]) -> TelevisionShowOut:
    out = TelevisionShowOut.model_validate(s)
    out.persons = _persons(s.person_links)
    out.genre_ids = [g.id for g in s.genres]
    out.soundtrack_albums = [NamedRef(id=a.id, name=a.name, name_en=a.name_en) for a in s.soundtrack_albums]
    out.source_books = [NamedRef(id=b.id, name=b.name, name_en=b.name_en) for b in s.source_books]
    out.seasons = [SeasonRef.model_validate(se) for se in s.seasons]
    out.season_count = len(s.seasons)
    out.episodes = [EpisodeRef.model_validate(e) for e in s.episodes]
    out.episode_count = len(s.episodes)
    out.in_my_list = s.id in mine
    return out


def _season_out(s: TelevisionSeason, mine: set[int]) -> TelevisionSeasonOut:
    out = TelevisionSeasonOut.model_validate(s)
    out.persons = _persons(s.person_links)
    out.episodes = [EpisodeRef.model_validate(e) for e in s.episodes]
    out.episode_count = len(s.episodes)
    out.runtime_minutes = sum(e.runtime_minutes for e in s.episodes)
    out.in_my_list = s.id in mine
    return out


def _episode_out(e: TelevisionEpisode, mine: set[int]) -> TelevisionEpisodeOut:
    out = TelevisionEpisodeOut.model_validate(e)
    out.persons = _persons(e.person_links)
    out.genre_ids = [g.id for g in e.genres]
    out.in_my_list = e.id in mine
    return out


def _sorted_persons(links) -> list[TelevisionPersonRef]:
    return sorted(_persons(links), key=lambda p: p.name)


# ── Shows: catalog ─────────────────────────────────────────────────────────────
@router.get("/shows", response_model=list[TelevisionShowOut])
def list_shows(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    mine = _mine(db, ctx, UserTelevisionShowRank.show_id)
    rows = db.scalars(
        select(TelevisionShow).where(TelevisionShow.guild_id == ctx.guild_id)
        .order_by(TelevisionShow.name).options(*loading.SHOW)
    ).all()
    return [_show_out(s, mine) for s in rows]


@router.post("/shows", response_model=TelevisionShowOut, status_code=201)
def create_show(body: TelevisionShowIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database, scope="function")):
    s = TelevisionShow(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **body.model_dump())
    db.add(s)
    db.flush()
    return _show_out(s, set())


# ── Shows: my ranking (literal paths before /shows/{sid}) ─────────────────────
# Starlette matches routes in registration order, so /shows/{sid} declared
# first would swallow /shows/ranked etc. as sid="ranked".
@router.get("/shows/ranked", response_model=list[RankedTelevisionShowOut])
def ranked_shows(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    uid = _target_user(db, ctx, user_id)
    mine = _mine(db, ctx, UserTelevisionShowRank.show_id)
    rows = db.scalars(
        select(UserTelevisionShowRank)
        .where(UserTelevisionShowRank.user_id == uid, UserTelevisionShowRank.guild_id == ctx.guild_id)
        .order_by(UserTelevisionShowRank.rank, UserTelevisionShowRank.show_id)
    ).all()
    loaded = loading.by_ids(db, TelevisionShow, (r.show_id for r in rows), loading.SHOW)
    return [
        RankedTelevisionShowOut(position=i, rank=r.rank, notes=r.notes if uid == ctx.user_id else None,
                                show=_show_out(loaded[r.show_id], mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/shows/reorder", status_code=204)
def reorder_shows(body: ReorderBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    rows = db.scalars(
        select(UserTelevisionShowRank).where(
            UserTelevisionShowRank.user_id == ctx.user_id, UserTelevisionShowRank.guild_id == ctx.guild_id
        )
    ).all()
    check_reorder_ids(body.ids, [r.show_id for r in rows])
    apply_order(db, {r.show_id: r for r in rows}, body.ids)


def _show_scope(ctx: GuildContext, user_id: int):
    return (TelevisionShowComparison.user_id == user_id) & (TelevisionShowComparison.guild_id == ctx.guild_id)


@router.get("/shows/comparisons", response_model=list[ComparisonOut])
def list_show_cmp(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return list_comparisons(db, TelevisionShowComparison, scope=_show_scope(ctx, _target_user(db, ctx, user_id)))


@router.put("/shows/comparisons", response_model=ComparisonOut)
def upsert_show_cmp(body: ComparisonIn, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, body.winner_id)
    _show(db, ctx, body.loser_id)
    return upsert_comparison(db, TelevisionShowComparison, body.winner_id, body.loser_id,
                             scope=_show_scope(ctx, ctx.user_id), extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id})


@router.delete("/shows/comparisons", status_code=204)
def clear_show_cmp(ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    clear_comparisons(db, TelevisionShowComparison, scope=_show_scope(ctx, ctx.user_id))


@router.delete("/shows/comparisons/{a}/{b}", status_code=204)
def delete_show_cmp(a: int, b: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    delete_comparison(db, TelevisionShowComparison, a, b, scope=_show_scope(ctx, ctx.user_id))


@router.get("/shows/{sid}", response_model=TelevisionShowOut)
def get_show(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return _show_out(_show(db, ctx, sid), _mine(db, ctx, UserTelevisionShowRank.show_id))


@router.patch("/shows/{sid}", response_model=TelevisionShowOut)
def update_show(sid: int, body: TelevisionShowPatch, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    s = _show(db, ctx, sid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    s.updated_by_user_id = ctx.user_id
    return _show_out(s, _mine(db, ctx, UserTelevisionShowRank.show_id))


@router.get("/shows/{sid}/impact")
def show_delete_impact(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    return {"rankings_destroyed": db.scalar(
        select(func.count()).select_from(UserTelevisionShowRank).where(UserTelevisionShowRank.show_id == sid)
    )}


@router.delete("/shows/{sid}", status_code=204)
def delete_show(sid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database, scope="function")):
    db.delete(_show(db, ctx, sid))


# ── Shows: people & genres ────────────────────────────────────────────────────
@router.get("/shows/{sid}/persons", response_model=list[TelevisionPersonRef])
def show_persons(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return _sorted_persons(_show(db, ctx, sid).person_links)


@router.put("/shows/{sid}/persons/{person_id}/{role}", status_code=204)
def link_show_person(sid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                     db: DbSession = Depends(get_database, scope="function")):
    if role == CastRole.director:
        raise HTTPException(422, "Shows use 'creator', not 'director'")
    _show(db, ctx, sid)
    _person(db, ctx, person_id)
    if not db.get(TelevisionShowPerson, (sid, person_id, role)):
        db.add(TelevisionShowPerson(show_id=sid, person_id=person_id, role=role, guild_id=ctx.guild_id))


@router.delete("/shows/{sid}/persons/{person_id}/{role}", status_code=204)
def unlink_show_person(sid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                       db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    link = db.get(TelevisionShowPerson, (sid, person_id, role))
    if link:
        db.delete(link)


@router.post("/shows/{sid}/populate-down")
def populate_show(sid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    """Copy the show's people onto every season and episode (creator excluded)."""
    return {"links_added": populate_show_down(db, _show(db, ctx, sid))}


@router.get("/shows/{sid}/genres")
def show_genres(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return [{"id": g.id, "name": g.name} for g in sorted(_show(db, ctx, sid).genres, key=lambda g: g.name)]


@router.put("/shows/{sid}/genres/{genre_id}", status_code=204)
def add_show_genre(sid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    s = _show(db, ctx, sid)
    genre = _genre(db, ctx, genre_id)
    if genre not in s.genres:
        link_guild_scoped(db, s, TelevisionShow.genres, genre, guild_id=ctx.guild_id)


@router.delete("/shows/{sid}/genres/{genre_id}", status_code=204)
def remove_show_genre(sid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    s = _show(db, ctx, sid)
    genre = db.get(Genre, genre_id)
    if genre is not None and genre in s.genres:
        s.genres.remove(genre)


@router.get("/shows/{sid}/entry", response_model=TelevisionShowEntryOut | None)
def get_show_entry(sid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    row = db.get(UserTelevisionShowRank, {"user_id": ctx.user_id, "show_id": sid})
    return TelevisionShowEntryOut(notes=row.notes) if row else None


@router.put("/shows/{sid}/entry", status_code=204)
def upsert_show_entry(sid: int, body: TelevisionShowEntryIn, ctx: GuildContext = Depends(RANK),
                      db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    row = db.get(UserTelevisionShowRank, {"user_id": ctx.user_id, "show_id": sid})
    if row is None:
        row = UserTelevisionShowRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, show_id=sid,
            rank=rank_at(db, UserTelevisionShowRank, user_id=ctx.user_id, guild_id=ctx.guild_id, position=body.position),
        )
        db.add(row)
    data = body.model_dump(exclude_unset=True, exclude={"position"})
    for k, v in data.items():
        setattr(row, k, v)


@router.delete("/shows/{sid}/entry", status_code=204)
def remove_show_entry(sid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    row = db.get(UserTelevisionShowRank, {"user_id": ctx.user_id, "show_id": sid})
    if row:
        db.delete(row)


@router.put("/shows/{sid}/position", status_code=204)
def move_show(sid: int, body: PositionBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    row = db.get(UserTelevisionShowRank, {"user_id": ctx.user_id, "show_id": sid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserTelevisionShowRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                       position=body.position, exclude_col=UserTelevisionShowRank.show_id, exclude=sid)


# ── Seasons: catalog, nested under a show ─────────────────────────────────────
@router.get("/shows/{sid}/seasons", response_model=list[TelevisionSeasonOut])
def list_seasons(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    show = _show(db, ctx, sid)
    mine = _mine(db, ctx, UserTelevisionSeasonRank.season_id, UserTelevisionSeasonRank.show_id == sid)
    seasons = db.scalars(
        select(TelevisionSeason).where(TelevisionSeason.show_id == show.id)
        .order_by(TelevisionSeason.season_rank).options(*loading.SEASON)
    ).all()
    return [_season_out(s, mine) for s in seasons]


@router.post("/shows/{sid}/seasons", response_model=TelevisionSeasonOut, status_code=201)
def create_season(sid: int, body: TelevisionSeasonIn, ctx: GuildContext = Depends(CREATE),
                  db: DbSession = Depends(get_database, scope="function")):
    show = _show(db, ctx, sid)
    data = body.model_dump(exclude={"inherit_from_show"})
    if data.get("release_year") is None:
        data["release_year"] = show.release_year
    season = TelevisionSeason(
        guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, show_id=sid,
        season_rank=next_season_rank(db, sid), **data,
    )
    db.add(season)
    db.flush()
    if body.inherit_from_show:
        merge_people(db, season, [(l.person_id, l.role) for l in show.person_links])
    return _season_out(season, set())


# ── Seasons: my ranking, scoped to the show ───────────────────────────────────
@router.get("/shows/{sid}/seasons/ranked", response_model=list[RankedTelevisionSeasonOut])
def ranked_seasons(sid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                   db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    uid = _target_user(db, ctx, user_id)
    rows = db.scalars(
        select(UserTelevisionSeasonRank)
        .where(UserTelevisionSeasonRank.user_id == uid, UserTelevisionSeasonRank.guild_id == ctx.guild_id,
               UserTelevisionSeasonRank.show_id == sid)
        .order_by(UserTelevisionSeasonRank.rank, UserTelevisionSeasonRank.season_id)
    ).all()
    mine = _mine(db, ctx, UserTelevisionSeasonRank.season_id, UserTelevisionSeasonRank.show_id == sid)
    loaded = loading.by_ids(db, TelevisionSeason, (r.season_id for r in rows), loading.SEASON)
    return [
        RankedTelevisionSeasonOut(position=i, rank=r.rank, notes=r.notes if uid == ctx.user_id else None,
                                  season=_season_out(loaded[r.season_id], mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/shows/{sid}/seasons/reorder", status_code=204)
def reorder_seasons(sid: int, body: ReorderBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    rows = db.scalars(
        select(UserTelevisionSeasonRank).where(
            UserTelevisionSeasonRank.user_id == ctx.user_id, UserTelevisionSeasonRank.guild_id == ctx.guild_id,
            UserTelevisionSeasonRank.show_id == sid,
        )
    ).all()
    check_reorder_ids(body.ids, [r.season_id for r in rows])
    apply_order(db, {r.season_id: r for r in rows}, body.ids)


def _season_scope(ctx: GuildContext, user_id: int, sid: int):
    return ((TelevisionSeasonComparison.user_id == user_id) & (TelevisionSeasonComparison.guild_id == ctx.guild_id)
            & (TelevisionSeasonComparison.show_id == sid))


@router.get("/shows/{sid}/seasons/comparisons", response_model=list[ComparisonOut])
def list_season_cmp(sid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                    db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    return list_comparisons(db, TelevisionSeasonComparison, scope=_season_scope(ctx, _target_user(db, ctx, user_id), sid))


@router.put("/shows/{sid}/seasons/comparisons", response_model=ComparisonOut)
def upsert_season_cmp(sid: int, body: ComparisonIn, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    for season_id in (body.winner_id, body.loser_id):
        if _season(db, ctx, season_id).show_id != sid:
            raise HTTPException(422, "Both seasons must belong to this show")
    return upsert_comparison(db, TelevisionSeasonComparison, body.winner_id, body.loser_id,
                             scope=_season_scope(ctx, ctx.user_id, sid),
                             extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id, "show_id": sid})


@router.delete("/shows/{sid}/seasons/comparisons", status_code=204)
def clear_season_cmp(sid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    clear_comparisons(db, TelevisionSeasonComparison, scope=_season_scope(ctx, ctx.user_id, sid))


@router.delete("/shows/{sid}/seasons/comparisons/{a}/{b}", status_code=204)
def delete_season_cmp(sid: int, a: int, b: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    delete_comparison(db, TelevisionSeasonComparison, a, b, scope=_season_scope(ctx, ctx.user_id, sid))


# ── Seasons: single season ────────────────────────────────────────────────────
@router.get("/seasons/{seid}", response_model=TelevisionSeasonOut)
def get_season(seid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    s = _season(db, ctx, seid)
    return _season_out(s, _mine(db, ctx, UserTelevisionSeasonRank.season_id, UserTelevisionSeasonRank.show_id == s.show_id))


@router.patch("/seasons/{seid}", response_model=TelevisionSeasonOut)
def update_season(seid: int, body: TelevisionSeasonPatch, ctx: GuildContext = Depends(EDIT),
                  db: DbSession = Depends(get_database, scope="function")):
    s = _season(db, ctx, seid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    s.updated_by_user_id = ctx.user_id
    return _season_out(s, set())


@router.get("/seasons/{seid}/impact")
def season_delete_impact(seid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    s = _season(db, ctx, seid)
    return {
        "rankings_destroyed": db.scalar(
            select(func.count()).select_from(UserTelevisionSeasonRank).where(UserTelevisionSeasonRank.season_id == seid)
        ),
        "episodes_destroyed": len(s.episodes),
        "episode_rankings_destroyed": db.scalar(
            select(func.count()).select_from(UserTelevisionEpisodeRank).where(UserTelevisionEpisodeRank.season_id == seid)
        ),
    }


@router.delete("/seasons/{seid}", status_code=204)
def delete_season(seid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database, scope="function")):
    db.delete(_season(db, ctx, seid))


@router.get("/seasons/{seid}/persons", response_model=list[TelevisionPersonRef])
def season_persons(seid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return _sorted_persons(_season(db, ctx, seid).person_links)


@router.put("/seasons/{seid}/persons/{person_id}/{role}", status_code=204)
def link_season_person(seid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                       db: DbSession = Depends(get_database, scope="function")):
    if role == CastRole.creator:
        raise HTTPException(422, "Seasons use 'director', not 'creator'")
    _season(db, ctx, seid)
    _person(db, ctx, person_id)
    if not db.get(TelevisionSeasonPerson, (seid, person_id, role)):
        db.add(TelevisionSeasonPerson(season_id=seid, person_id=person_id, role=role, guild_id=ctx.guild_id))


@router.delete("/seasons/{seid}/persons/{person_id}/{role}", status_code=204)
def unlink_season_person(seid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                         db: DbSession = Depends(get_database, scope="function")):
    _season(db, ctx, seid)
    link = db.get(TelevisionSeasonPerson, (seid, person_id, role))
    if link:
        db.delete(link)


@router.post("/seasons/{seid}/populate-down")
def populate_season(seid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    """Copy the season's people onto every one of its episodes."""
    return {"links_added": populate_season_down(db, _season(db, ctx, seid))}


@router.get("/seasons/{seid}/entry", response_model=TelevisionSeasonEntryOut | None)
def get_season_entry(seid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    row = db.get(UserTelevisionSeasonRank, {"user_id": ctx.user_id, "season_id": seid})
    return TelevisionSeasonEntryOut(notes=row.notes) if row else None


@router.put("/seasons/{seid}/entry", status_code=204)
def upsert_season_entry(seid: int, body: TelevisionSeasonEntryIn, ctx: GuildContext = Depends(RANK),
                        db: DbSession = Depends(get_database, scope="function")):
    s = _season(db, ctx, seid)
    row = db.get(UserTelevisionSeasonRank, {"user_id": ctx.user_id, "season_id": seid})
    if row is None:
        row = UserTelevisionSeasonRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, season_id=seid, show_id=s.show_id,
            rank=rank_at(db, UserTelevisionSeasonRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                         position=body.position, scope=UserTelevisionSeasonRank.show_id == s.show_id),
        )
        db.add(row)
    data = body.model_dump(exclude_unset=True, exclude={"position"})
    for k, v in data.items():
        setattr(row, k, v)


@router.delete("/seasons/{seid}/entry", status_code=204)
def remove_season_entry(seid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    row = db.get(UserTelevisionSeasonRank, {"user_id": ctx.user_id, "season_id": seid})
    if row:
        db.delete(row)


@router.put("/seasons/{seid}/position", status_code=204)
def move_season(seid: int, body: PositionBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    row = db.get(UserTelevisionSeasonRank, {"user_id": ctx.user_id, "season_id": seid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserTelevisionSeasonRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                       position=body.position, exclude_col=UserTelevisionSeasonRank.season_id, exclude=seid,
                       scope=UserTelevisionSeasonRank.show_id == row.show_id)


# ── Episodes: catalog, nested under a season ──────────────────────────────────
@router.get("/seasons/{seid}/episodes", response_model=list[TelevisionEpisodeOut])
def list_episodes(seid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    season = _season(db, ctx, seid)
    mine = _mine(db, ctx, UserTelevisionEpisodeRank.episode_id, UserTelevisionEpisodeRank.season_id == seid)
    episodes = db.scalars(
        select(TelevisionEpisode).where(TelevisionEpisode.season_id == season.id)
        .order_by(TelevisionEpisode.episode_rank).options(*loading.EPISODE)
    ).all()
    return [_episode_out(e, mine) for e in episodes]


@router.post("/seasons/{seid}/episodes", response_model=TelevisionEpisodeOut, status_code=201)
def create_episode(seid: int, body: TelevisionEpisodeIn, ctx: GuildContext = Depends(CREATE),
                   db: DbSession = Depends(get_database, scope="function")):
    season = _season(db, ctx, seid)
    data = body.model_dump(exclude={"inherit_from_parent"})
    if data.get("release_year") is None:
        data["release_year"] = season.release_year
    episode = TelevisionEpisode(
        guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, show_id=season.show_id, season_id=seid,
        episode_rank=next_episode_rank(db, seid), **data,
    )
    db.add(episode)
    db.flush()
    if body.inherit_from_parent:
        merge_people(db, episode, [(l.person_id, l.role) for l in season.person_links])
        for genre in season.show.genres:
            link_guild_scoped(db, episode, TelevisionEpisode.genres, genre, guild_id=ctx.guild_id)
        db.flush()
    return _episode_out(episode, set())


# ── Episodes: ranking, scoped to the season ───────────────────────────────────
@router.get("/seasons/{seid}/episodes/ranked", response_model=list[RankedTelevisionEpisodeOut])
def ranked_episodes(seid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                    db: DbSession = Depends(get_database, scope="function")):
    _season(db, ctx, seid)
    uid = _target_user(db, ctx, user_id)
    rows = db.scalars(
        select(UserTelevisionEpisodeRank)
        .where(UserTelevisionEpisodeRank.user_id == uid, UserTelevisionEpisodeRank.guild_id == ctx.guild_id,
               UserTelevisionEpisodeRank.season_id == seid)
        .order_by(UserTelevisionEpisodeRank.rank, UserTelevisionEpisodeRank.episode_id)
    ).all()
    mine = _mine(db, ctx, UserTelevisionEpisodeRank.episode_id, UserTelevisionEpisodeRank.season_id == seid)
    loaded = loading.by_ids(db, TelevisionEpisode, (r.episode_id for r in rows), loading.EPISODE)
    return [
        RankedTelevisionEpisodeOut(position=i, rank=r.rank, watches=r.watches,
                                   notes=r.notes if uid == ctx.user_id else None,
                                   episode=_episode_out(loaded[r.episode_id], mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/seasons/{seid}/episodes/reorder", status_code=204)
def reorder_episodes(seid: int, body: ReorderBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    _season(db, ctx, seid)
    rows = db.scalars(
        select(UserTelevisionEpisodeRank).where(
            UserTelevisionEpisodeRank.user_id == ctx.user_id, UserTelevisionEpisodeRank.guild_id == ctx.guild_id,
            UserTelevisionEpisodeRank.season_id == seid,
        )
    ).all()
    check_reorder_ids(body.ids, [r.episode_id for r in rows])
    apply_order(db, {r.episode_id: r for r in rows}, body.ids)


def _episode_scope(ctx: GuildContext, user_id: int, seid: int):
    return ((TelevisionEpisodeComparison.user_id == user_id) & (TelevisionEpisodeComparison.guild_id == ctx.guild_id)
            & (TelevisionEpisodeComparison.season_id == seid))


@router.get("/seasons/{seid}/episodes/comparisons", response_model=list[ComparisonOut])
def list_episode_cmp(seid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                     db: DbSession = Depends(get_database, scope="function")):
    _season(db, ctx, seid)
    return list_comparisons(db, TelevisionEpisodeComparison, scope=_episode_scope(ctx, _target_user(db, ctx, user_id), seid))


@router.put("/seasons/{seid}/episodes/comparisons", response_model=ComparisonOut)
def upsert_episode_cmp(seid: int, body: ComparisonIn, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    _season(db, ctx, seid)
    for episode_id in (body.winner_id, body.loser_id):
        if _episode(db, ctx, episode_id).season_id != seid:
            raise HTTPException(422, "Both episodes must belong to this season")
    return upsert_comparison(db, TelevisionEpisodeComparison, body.winner_id, body.loser_id,
                             scope=_episode_scope(ctx, ctx.user_id, seid),
                             extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id, "season_id": seid})


@router.delete("/seasons/{seid}/episodes/comparisons", status_code=204)
def clear_episode_cmp(seid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    clear_comparisons(db, TelevisionEpisodeComparison, scope=_episode_scope(ctx, ctx.user_id, seid))


@router.delete("/seasons/{seid}/episodes/comparisons/{a}/{b}", status_code=204)
def delete_episode_cmp(seid: int, a: int, b: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    delete_comparison(db, TelevisionEpisodeComparison, a, b, scope=_episode_scope(ctx, ctx.user_id, seid))


# ── Episodes: ranking across the whole show ──────────────────────────────────
# A second order over the same list rows (`show_rank`): every episode of the show
# you've ranked, best first, whatever season it's from. Same-season answers are
# shared with the per-season ranking; cross-season ones live in their own table.
_ER = UserTelevisionEpisodeRank


def _show_episode_rows(db: DbSession, ctx: GuildContext, uid: int, sid: int) -> list[UserTelevisionEpisodeRank]:
    rows = db.scalars(
        select(_ER).where(_ER.user_id == uid, _ER.guild_id == ctx.guild_id, _ER.show_id == sid)
        .order_by(_ER.show_rank.asc().nulls_last(), _ER.episode_id)
    ).all()
    if uid == ctx.user_id and any(r.show_rank is None for r in rows):
        apply_order(db, {r.episode_id: r for r in rows}, [r.episode_id for r in rows], attr="show_rank")
    return rows


def _show_cmp_scopes(ctx: GuildContext, uid: int, sid: int):
    season_ids = select(TelevisionSeason.id).where(TelevisionSeason.show_id == sid).scalar_subquery()
    E, S = TelevisionEpisodeComparison, TelevisionShowEpisodeComparison
    return (
        (E, and_(E.user_id == uid, E.guild_id == ctx.guild_id, E.season_id.in_(season_ids))),
        (S, and_(S.user_id == uid, S.guild_id == ctx.guild_id, S.show_id == sid)),
    )


@router.get("/shows/{sid}/episodes/ranked", response_model=list[RankedTelevisionEpisodeOut])
def ranked_show_episodes(sid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                         db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    uid = _target_user(db, ctx, user_id)
    rows = _show_episode_rows(db, ctx, uid, sid)
    mine = _mine(db, ctx, _ER.episode_id, _ER.show_id == sid)
    loaded = loading.by_ids(db, TelevisionEpisode, (r.episode_id for r in rows), loading.EPISODE)
    return [
        RankedTelevisionEpisodeOut(position=i, rank=r.show_rank if r.show_rank is not None else r.rank,
                                   watches=r.watches, notes=r.notes if uid == ctx.user_id else None,
                                   episode=_episode_out(loaded[r.episode_id], mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/shows/{sid}/episodes/reorder", status_code=204)
def reorder_show_episodes(sid: int, body: ReorderBody, ctx: GuildContext = Depends(RANK),
                          db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    rows = _show_episode_rows(db, ctx, ctx.user_id, sid)
    check_reorder_ids(body.ids, [r.episode_id for r in rows])
    apply_order(db, {r.episode_id: r for r in rows}, body.ids, attr="show_rank")


@router.get("/shows/{sid}/episodes/comparisons", response_model=list[ComparisonOut])
def list_show_episode_cmp(sid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                          db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    uid = _target_user(db, ctx, user_id)
    out = [c for model, scope in _show_cmp_scopes(ctx, uid, sid) for c in list_comparisons(db, model, scope=scope)]
    return sorted(out, key=lambda c: (c.created_at, c.winner_id))


@router.put("/shows/{sid}/episodes/comparisons", response_model=ComparisonOut)
def upsert_show_episode_cmp(sid: int, body: ComparisonIn, ctx: GuildContext = Depends(RANK),
                            db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    w, l = _episode(db, ctx, body.winner_id), _episode(db, ctx, body.loser_id)
    if w.show_id != sid or l.show_id != sid:
        raise HTTPException(422, "Both episodes must belong to this show")
    (E, e_scope), (S, s_scope) = _show_cmp_scopes(ctx, ctx.user_id, sid)
    # Wherever the pair was answered before, this answer replaces it.
    delete_comparison(db, E, w.id, l.id, scope=e_scope)
    delete_comparison(db, S, w.id, l.id, scope=s_scope)
    common = {"user_id": ctx.user_id, "guild_id": ctx.guild_id}
    if w.season_id == l.season_id:
        return upsert_comparison(db, E, w.id, l.id, extra={**common, "season_id": w.season_id})
    return upsert_comparison(db, S, w.id, l.id, extra={**common, "show_id": sid})


@router.delete("/shows/{sid}/episodes/comparisons", status_code=204)
def clear_show_episode_cmp(sid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    """Every answer this order reads, including the per-season ones."""
    _show(db, ctx, sid)
    for model, scope in _show_cmp_scopes(ctx, ctx.user_id, sid):
        clear_comparisons(db, model, scope=scope)


@router.delete("/shows/{sid}/episodes/comparisons/{a}/{b}", status_code=204)
def delete_show_episode_cmp(sid: int, a: int, b: int, ctx: GuildContext = Depends(RANK),
                            db: DbSession = Depends(get_database, scope="function")):
    _show(db, ctx, sid)
    for model, scope in _show_cmp_scopes(ctx, ctx.user_id, sid):
        delete_comparison(db, model, a, b, scope=scope)


@router.put("/episodes/{eid}/show-position", status_code=204)
def move_episode_show_rank(eid: int, body: PositionBody, ctx: GuildContext = Depends(RANK),
                           db: DbSession = Depends(get_database, scope="function")):
    row = db.get(_ER, {"user_id": ctx.user_id, "episode_id": eid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    _show_episode_rows(db, ctx, ctx.user_id, row.show_id)  # backfills any missing show_rank first
    row.show_rank = rank_at(db, _ER, user_id=ctx.user_id, guild_id=ctx.guild_id, position=body.position,
                            exclude_col=_ER.episode_id, exclude=eid, scope=_ER.show_id == row.show_id,
                            col=_ER.show_rank)


def _next_show_rank(db: DbSession, ctx: GuildContext, show_id: int):
    return next_rank(db, _ER, user_id=ctx.user_id, guild_id=ctx.guild_id, scope=_ER.show_id == show_id, col=_ER.show_rank)


# ── Episodes: single episode ──────────────────────────────────────────────────
@router.get("/episodes/{eid}", response_model=TelevisionEpisodeOut)
def get_episode(eid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    e = _episode(db, ctx, eid)
    return _episode_out(e, _mine(db, ctx, UserTelevisionEpisodeRank.episode_id, UserTelevisionEpisodeRank.episode_id == eid))


@router.patch("/episodes/{eid}", response_model=TelevisionEpisodeOut)
def update_episode(eid: int, body: TelevisionEpisodePatch, ctx: GuildContext = Depends(EDIT),
                   db: DbSession = Depends(get_database, scope="function")):
    e = _episode(db, ctx, eid)
    data = body.model_dump(exclude_unset=True)
    target_season = data.pop("season_id", None)
    for k, v in data.items():
        setattr(e, k, v)
    if target_season is not None and target_season != e.season_id:
        season = _season(db, ctx, target_season)
        if season.show_id != e.show_id:
            raise HTTPException(422, "An episode can only move to another season of its own show")
        move_episode(db, e, season)
    e.updated_by_user_id = ctx.user_id
    return _episode_out(e, set())


@router.get("/episodes/{eid}/impact")
def episode_delete_impact(eid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    _episode(db, ctx, eid)
    return {"rankings_destroyed": db.scalar(
        select(func.count()).select_from(UserTelevisionEpisodeRank).where(UserTelevisionEpisodeRank.episode_id == eid)
    )}


@router.delete("/episodes/{eid}", status_code=204)
def delete_episode(eid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database, scope="function")):
    db.delete(_episode(db, ctx, eid))


@router.get("/episodes/{eid}/persons", response_model=list[TelevisionPersonRef])
def episode_persons(eid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return _sorted_persons(_episode(db, ctx, eid).person_links)


@router.put("/episodes/{eid}/persons/{person_id}/{role}", status_code=204)
def link_episode_person(eid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                        db: DbSession = Depends(get_database, scope="function")):
    if role == CastRole.creator:
        raise HTTPException(422, "Episodes use 'director', not 'creator'")
    _episode(db, ctx, eid)
    _person(db, ctx, person_id)
    if not db.get(TelevisionEpisodePerson, (eid, person_id, role)):
        db.add(TelevisionEpisodePerson(episode_id=eid, person_id=person_id, role=role, guild_id=ctx.guild_id))


@router.delete("/episodes/{eid}/persons/{person_id}/{role}", status_code=204)
def unlink_episode_person(eid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                          db: DbSession = Depends(get_database, scope="function")):
    _episode(db, ctx, eid)
    link = db.get(TelevisionEpisodePerson, (eid, person_id, role))
    if link:
        db.delete(link)


@router.get("/episodes/{eid}/genres")
def episode_genres(eid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return [{"id": g.id, "name": g.name} for g in sorted(_episode(db, ctx, eid).genres, key=lambda g: g.name)]


@router.put("/episodes/{eid}/genres/{genre_id}", status_code=204)
def add_episode_genre(eid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    e = _episode(db, ctx, eid)
    genre = _genre(db, ctx, genre_id)
    if genre not in e.genres:
        link_guild_scoped(db, e, TelevisionEpisode.genres, genre, guild_id=ctx.guild_id)


@router.delete("/episodes/{eid}/genres/{genre_id}", status_code=204)
def remove_episode_genre(eid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database, scope="function")):
    e = _episode(db, ctx, eid)
    genre = db.get(Genre, genre_id)
    if genre is not None and genre in e.genres:
        e.genres.remove(genre)


@router.get("/episodes/{eid}/entry", response_model=TelevisionEpisodeEntryOut | None)
def get_episode_entry(eid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    row = db.get(UserTelevisionEpisodeRank, {"user_id": ctx.user_id, "episode_id": eid})
    return TelevisionEpisodeEntryOut(watches=row.watches, notes=row.notes) if row else None


@router.put("/episodes/{eid}/entry", status_code=204)
def upsert_episode_entry(eid: int, body: TelevisionEpisodeEntryIn, ctx: GuildContext = Depends(RANK),
                         db: DbSession = Depends(get_database, scope="function")):
    e = _episode(db, ctx, eid)
    row = db.get(UserTelevisionEpisodeRank, {"user_id": ctx.user_id, "episode_id": eid})
    if row is None:
        row = UserTelevisionEpisodeRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, episode_id=eid, show_id=e.show_id, season_id=e.season_id,
            watches=1,
            rank=rank_at(db, UserTelevisionEpisodeRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                         position=body.position, scope=UserTelevisionEpisodeRank.season_id == e.season_id),
            show_rank=_next_show_rank(db, ctx, e.show_id),
        )
        db.add(row)
    data = body.model_dump(exclude_unset=True, exclude={"position"})
    for k, v in data.items():
        setattr(row, k, v)


@router.delete("/episodes/{eid}/entry", status_code=204)
def remove_episode_entry(eid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    row = db.get(UserTelevisionEpisodeRank, {"user_id": ctx.user_id, "episode_id": eid})
    if row:
        db.delete(row)


@router.put("/episodes/{eid}/position", status_code=204)
def move_episode_rank(eid: int, body: PositionBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    row = db.get(UserTelevisionEpisodeRank, {"user_id": ctx.user_id, "episode_id": eid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserTelevisionEpisodeRank, user_id=ctx.user_id, guild_id=ctx.guild_id, position=body.position,
                       exclude_col=UserTelevisionEpisodeRank.episode_id, exclude=eid,
                       scope=UserTelevisionEpisodeRank.season_id == row.season_id)


# ── Bulk: add everything below a show or season to your list ─────────────────
class AddedOut(BaseModel):
    added: int


@router.post("/shows/{sid}/seasons/add-all", response_model=AddedOut)
def add_all_seasons(sid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    """Every season of the show not yet in your list, appended in airing order."""
    _show(db, ctx, sid)
    have = set(db.scalars(select(UserTelevisionSeasonRank.season_id).where(
        UserTelevisionSeasonRank.user_id == ctx.user_id, UserTelevisionSeasonRank.show_id == sid)))
    added = 0
    for season in db.scalars(select(TelevisionSeason).where(
        TelevisionSeason.guild_id == ctx.guild_id, TelevisionSeason.show_id == sid,
    ).order_by(TelevisionSeason.season_rank, TelevisionSeason.id)):
        if season.id in have:
            continue
        db.add(UserTelevisionSeasonRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, season_id=season.id, show_id=sid,
            rank=next_rank(db, UserTelevisionSeasonRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                           scope=UserTelevisionSeasonRank.show_id == sid),
        ))
        db.flush()
        added += 1
    return AddedOut(added=added)


@router.post("/seasons/{seid}/episodes/add-all", response_model=AddedOut)
def add_all_episodes(seid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database, scope="function")):
    """Every episode of the season not yet in your list, appended in airing order."""
    season = _season(db, ctx, seid)
    have = set(db.scalars(select(UserTelevisionEpisodeRank.episode_id).where(
        UserTelevisionEpisodeRank.user_id == ctx.user_id, UserTelevisionEpisodeRank.season_id == seid)))
    added = 0
    for ep in db.scalars(select(TelevisionEpisode).where(
        TelevisionEpisode.guild_id == ctx.guild_id, TelevisionEpisode.season_id == seid,
    ).order_by(TelevisionEpisode.episode_rank, TelevisionEpisode.id)):
        if ep.id in have:
            continue
        db.add(UserTelevisionEpisodeRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, episode_id=ep.id, show_id=season.show_id, season_id=seid,
            watches=1,
            rank=next_rank(db, UserTelevisionEpisodeRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                           scope=UserTelevisionEpisodeRank.season_id == seid),
            show_rank=_next_show_rank(db, ctx, season.show_id),
        ))
        db.flush()
        added += 1
    return AddedOut(added=added)
