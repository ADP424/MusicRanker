from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..api_models.base import PositionBody, ReorderBody
from ..api_models.comparison import ComparisonIn, ComparisonOut
from ..api_models.music import NamedRef
from ..api_models.television import (
    EpisodeRef, RankedTelevisionEpisodeOut, RankedTelevisionShowOut, TelevisionEpisodeEntryIn,
    TelevisionEpisodeEntryOut, TelevisionEpisodeIn, TelevisionEpisodeOut, TelevisionEpisodePatch,
    TelevisionPersonRef, TelevisionShowEntryIn, TelevisionShowEntryOut, TelevisionShowIn, TelevisionShowOut,
    TelevisionShowPatch,
)
from ..authz import Capability
from ..comparisons import clear_comparisons, delete_comparison, list_comparisons, upsert_comparison
from ..database import get_database
from ..database_models import (
    Genre, GuildMember, Person, TelevisionEpisode, TelevisionEpisodeComparison, TelevisionEpisodeLink,
    TelevisionEpisodePerson, TelevisionShow, TelevisionShowComparison, TelevisionShowLink, TelevisionShowPerson,
)
from ..database_models.movie_cast_member import CastRole
from ..database_models.ranking import UserTelevisionEpisodeRank, UserTelevisionShowRank
from ..deps import GuildContext, guild_ctx
from ..guild_junction_helpers import link_guild_scoped
from ..ranking import apply_order, check_reorder_ids, rank_at
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
episode_links_router = make_links_router(
    owner_model=TelevisionEpisode, link_model=TelevisionEpisodeLink,
    owner_fk="episode_id", prefix="/television/episodes", tag="television",
)


def _show(db: DbSession, ctx: GuildContext, sid: int) -> TelevisionShow:
    s = db.get(TelevisionShow, sid)
    if s is None or s.guild_id != ctx.guild_id:
        raise HTTPException(404, "Show not found")
    return s


def _episode(db: DbSession, ctx: GuildContext, eid: int) -> TelevisionEpisode:
    e = db.get(TelevisionEpisode, eid)
    if e is None or e.guild_id != ctx.guild_id:
        raise HTTPException(404, "Episode not found")
    return e


def _target_user(db: DbSession, ctx: GuildContext, user_id: int | None) -> int:
    if user_id is None or user_id == ctx.user_id:
        return ctx.user_id
    if db.get(GuildMember, (ctx.guild_id, user_id)) is None:
        raise HTTPException(404, "Not a member of this guild")
    return user_id


def _my_show_ids(db: DbSession, ctx: GuildContext) -> set[int]:
    return set(db.scalars(
        select(UserTelevisionShowRank.show_id).where(
            UserTelevisionShowRank.user_id == ctx.user_id, UserTelevisionShowRank.guild_id == ctx.guild_id
        )
    ))


def _show_out(s: TelevisionShow, mine: set[int]) -> TelevisionShowOut:
    out = TelevisionShowOut.model_validate(s)
    out.persons = [
        TelevisionPersonRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role)
        for l in s.person_links
    ]
    out.genre_ids = [g.id for g in s.genres]
    out.soundtrack_albums = [NamedRef(id=a.id, name=a.name, name_en=a.name_en) for a in s.soundtrack_albums]
    out.episodes = [EpisodeRef(id=e.id, name=e.name, name_en=e.name_en) for e in s.episodes]
    out.episode_count = len(s.episodes)
    out.in_my_list = s.id in mine
    return out


def _episode_out(e: TelevisionEpisode, mine: set[int]) -> TelevisionEpisodeOut:
    out = TelevisionEpisodeOut.model_validate(e)
    out.persons = [
        TelevisionPersonRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role)
        for l in e.person_links
    ]
    out.genre_ids = [g.id for g in e.genres]
    out.in_my_list = e.id in mine
    return out


# ── Shows: catalog ─────────────────────────────────────────────────────────────
@router.get("/shows", response_model=list[TelevisionShowOut])
def list_shows(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    mine = _my_show_ids(db, ctx)
    rows = db.scalars(select(TelevisionShow).where(TelevisionShow.guild_id == ctx.guild_id).order_by(TelevisionShow.name)).all()
    return [_show_out(s, mine) for s in rows]


@router.post("/shows", response_model=TelevisionShowOut, status_code=201)
def create_show(body: TelevisionShowIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database)):
    s = TelevisionShow(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **body.model_dump())
    db.add(s)
    db.flush()
    return _show_out(s, set())


# ── Shows: my ranking (literal paths before /shows/{sid}) ─────────────────────
# Starlette matches routes in registration order, so /shows/{sid} declared
# first would swallow /shows/ranked etc. as sid="ranked".
@router.get("/shows/ranked", response_model=list[RankedTelevisionShowOut])
def ranked_shows(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    mine = _my_show_ids(db, ctx)
    rows = db.scalars(
        select(UserTelevisionShowRank)
        .where(UserTelevisionShowRank.user_id == uid, UserTelevisionShowRank.guild_id == ctx.guild_id)
        .order_by(UserTelevisionShowRank.rank, UserTelevisionShowRank.show_id)
    ).all()
    return [
        RankedTelevisionShowOut(position=i, rank=r.rank, notes=r.notes if uid == ctx.user_id else None,
                                show=_show_out(db.get(TelevisionShow, r.show_id), mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/shows/reorder", status_code=204)
def reorder_shows(body: ReorderBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
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
def list_show_cmp(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return list_comparisons(db, TelevisionShowComparison, scope=_show_scope(ctx, _target_user(db, ctx, user_id)))


@router.put("/shows/comparisons", response_model=ComparisonOut)
def upsert_show_cmp(body: ComparisonIn, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    _show(db, ctx, body.winner_id)
    _show(db, ctx, body.loser_id)
    return upsert_comparison(db, TelevisionShowComparison, body.winner_id, body.loser_id,
                             scope=_show_scope(ctx, ctx.user_id), extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id})


@router.delete("/shows/comparisons", status_code=204)
def clear_show_cmp(ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    clear_comparisons(db, TelevisionShowComparison, scope=_show_scope(ctx, ctx.user_id))


@router.delete("/shows/comparisons/{a}/{b}", status_code=204)
def delete_show_cmp(a: int, b: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    delete_comparison(db, TelevisionShowComparison, a, b, scope=_show_scope(ctx, ctx.user_id))


@router.get("/shows/{sid}", response_model=TelevisionShowOut)
def get_show(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return _show_out(_show(db, ctx, sid), _my_show_ids(db, ctx))


@router.patch("/shows/{sid}", response_model=TelevisionShowOut)
def update_show(sid: int, body: TelevisionShowPatch, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    s = _show(db, ctx, sid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    s.updated_by_user_id = ctx.user_id
    return _show_out(s, _my_show_ids(db, ctx))


@router.get("/shows/{sid}/impact")
def show_delete_impact(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    _show(db, ctx, sid)
    return {"rankings_destroyed": db.scalar(
        select(func.count()).select_from(UserTelevisionShowRank).where(UserTelevisionShowRank.show_id == sid)
    )}


@router.delete("/shows/{sid}", status_code=204)
def delete_show(sid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database)):
    db.delete(_show(db, ctx, sid))


# ── Shows: people & genres ────────────────────────────────────────────────────
@router.get("/shows/{sid}/persons", response_model=list[TelevisionPersonRef])
def show_persons(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    s = _show(db, ctx, sid)
    return sorted(
        (TelevisionPersonRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role) for l in s.person_links),
        key=lambda p: p.name,
    )


@router.put("/shows/{sid}/persons/{person_id}/{role}", status_code=204)
def link_show_person(sid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                     db: DbSession = Depends(get_database)):
    if role == CastRole.director:
        raise HTTPException(422, "Shows use 'creator', not 'director'")
    _show(db, ctx, sid)
    person = db.get(Person, person_id)
    if person is None or person.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")
    if not db.get(TelevisionShowPerson, (sid, person_id, role)):
        db.add(TelevisionShowPerson(show_id=sid, person_id=person_id, role=role, guild_id=ctx.guild_id))


@router.delete("/shows/{sid}/persons/{person_id}/{role}", status_code=204)
def unlink_show_person(sid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                       db: DbSession = Depends(get_database)):
    link = db.get(TelevisionShowPerson, (sid, person_id, role))
    if link:
        db.delete(link)


@router.get("/shows/{sid}/genres")
def show_genres(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return [{"id": g.id, "name": g.name} for g in sorted(_show(db, ctx, sid).genres, key=lambda g: g.name)]


@router.put("/shows/{sid}/genres/{genre_id}", status_code=204)
def add_show_genre(sid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    s = _show(db, ctx, sid)
    genre = db.get(Genre, genre_id)
    if genre is None or genre.guild_id != ctx.guild_id:
        raise HTTPException(404, "Genre not found")
    if not genre.is_television:
        raise HTTPException(422, "Genre is not applicable to television")
    if genre not in s.genres:
        link_guild_scoped(db, s, TelevisionShow.genres, genre, guild_id=ctx.guild_id)


@router.delete("/shows/{sid}/genres/{genre_id}", status_code=204)
def remove_show_genre(sid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    s = _show(db, ctx, sid)
    genre = db.get(Genre, genre_id)
    if genre is not None and genre in s.genres:
        s.genres.remove(genre)


@router.get("/shows/{sid}/entry", response_model=TelevisionShowEntryOut | None)
def get_show_entry(sid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserTelevisionShowRank, {"user_id": ctx.user_id, "show_id": sid})
    return TelevisionShowEntryOut(notes=row.notes) if row else None


@router.put("/shows/{sid}/entry", status_code=204)
def upsert_show_entry(sid: int, body: TelevisionShowEntryIn, ctx: GuildContext = Depends(RANK),
                      db: DbSession = Depends(get_database)):
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
def remove_show_entry(sid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserTelevisionShowRank, {"user_id": ctx.user_id, "show_id": sid})
    if row:
        db.delete(row)


@router.put("/shows/{sid}/position", status_code=204)
def move_show(sid: int, body: PositionBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserTelevisionShowRank, {"user_id": ctx.user_id, "show_id": sid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserTelevisionShowRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                       position=body.position, exclude_col=UserTelevisionShowRank.show_id, exclude=sid)


# ── Episodes: catalog, nested under a show ────────────────────────────────────
@router.get("/shows/{sid}/episodes", response_model=list[TelevisionEpisodeOut])
def list_episodes(sid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    show = _show(db, ctx, sid)
    mine = set(db.scalars(
        select(UserTelevisionEpisodeRank.episode_id).where(
            UserTelevisionEpisodeRank.user_id == ctx.user_id, UserTelevisionEpisodeRank.guild_id == ctx.guild_id,
            UserTelevisionEpisodeRank.show_id == sid,
        )
    ))
    return [_episode_out(e, mine) for e in show.episodes]


@router.post("/shows/{sid}/episodes", response_model=TelevisionEpisodeOut, status_code=201)
def create_episode(sid: int, body: TelevisionEpisodeIn, ctx: GuildContext = Depends(CREATE),
                   db: DbSession = Depends(get_database)):
    show = _show(db, ctx, sid)
    data = body.model_dump(exclude={"inherit_from_show"})
    if data.get("release_year") is None:
        data["release_year"] = show.release_year
    ranks = [e.episode_rank for e in show.episodes if e.episode_rank is not None]
    next_rank = (max(ranks) + 1) if ranks else Decimal(1)
    episode = TelevisionEpisode(
        guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, show_id=sid, episode_rank=next_rank, **data,
    )
    db.add(episode)
    db.flush()
    if body.inherit_from_show:
        for link in show.person_links:
            if link.role != CastRole.creator and not db.get(TelevisionEpisodePerson, (episode.id, link.person_id, link.role)):
                db.add(TelevisionEpisodePerson(episode_id=episode.id, person_id=link.person_id, role=link.role,
                                               guild_id=ctx.guild_id))
        for genre in show.genres:
            link_guild_scoped(db, episode, TelevisionEpisode.genres, genre, guild_id=ctx.guild_id)
        db.flush()
    return _episode_out(episode, set())


@router.get("/episodes/{eid}", response_model=TelevisionEpisodeOut)
def get_episode(eid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    e = _episode(db, ctx, eid)
    mine = set(db.scalars(
        select(UserTelevisionEpisodeRank.episode_id).where(
            UserTelevisionEpisodeRank.user_id == ctx.user_id, UserTelevisionEpisodeRank.guild_id == ctx.guild_id
        )
    ))
    return _episode_out(e, mine)


@router.patch("/episodes/{eid}", response_model=TelevisionEpisodeOut)
def update_episode(eid: int, body: TelevisionEpisodePatch, ctx: GuildContext = Depends(EDIT),
                   db: DbSession = Depends(get_database)):
    e = _episode(db, ctx, eid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    e.updated_by_user_id = ctx.user_id
    return _episode_out(e, set())


@router.get("/episodes/{eid}/impact")
def episode_delete_impact(eid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    _episode(db, ctx, eid)
    return {"rankings_destroyed": db.scalar(
        select(func.count()).select_from(UserTelevisionEpisodeRank).where(UserTelevisionEpisodeRank.episode_id == eid)
    )}


@router.delete("/episodes/{eid}", status_code=204)
def delete_episode(eid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database)):
    db.delete(_episode(db, ctx, eid))


@router.get("/episodes/{eid}/persons", response_model=list[TelevisionPersonRef])
def episode_persons(eid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    e = _episode(db, ctx, eid)
    return sorted(
        (TelevisionPersonRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role) for l in e.person_links),
        key=lambda p: p.name,
    )


@router.put("/episodes/{eid}/persons/{person_id}/{role}", status_code=204)
def link_episode_person(eid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                        db: DbSession = Depends(get_database)):
    if role == CastRole.creator:
        raise HTTPException(422, "Episodes use 'director', not 'creator'")
    _episode(db, ctx, eid)
    person = db.get(Person, person_id)
    if person is None or person.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")
    if not db.get(TelevisionEpisodePerson, (eid, person_id, role)):
        db.add(TelevisionEpisodePerson(episode_id=eid, person_id=person_id, role=role, guild_id=ctx.guild_id))


@router.delete("/episodes/{eid}/persons/{person_id}/{role}", status_code=204)
def unlink_episode_person(eid: int, person_id: int, role: CastRole, ctx: GuildContext = Depends(EDIT),
                          db: DbSession = Depends(get_database)):
    link = db.get(TelevisionEpisodePerson, (eid, person_id, role))
    if link:
        db.delete(link)


@router.get("/episodes/{eid}/genres")
def episode_genres(eid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return [{"id": g.id, "name": g.name} for g in sorted(_episode(db, ctx, eid).genres, key=lambda g: g.name)]


@router.put("/episodes/{eid}/genres/{genre_id}", status_code=204)
def add_episode_genre(eid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    e = _episode(db, ctx, eid)
    genre = db.get(Genre, genre_id)
    if genre is None or genre.guild_id != ctx.guild_id:
        raise HTTPException(404, "Genre not found")
    if not genre.is_television:
        raise HTTPException(422, "Genre is not applicable to television")
    if genre not in e.genres:
        link_guild_scoped(db, e, TelevisionEpisode.genres, genre, guild_id=ctx.guild_id)


@router.delete("/episodes/{eid}/genres/{genre_id}", status_code=204)
def remove_episode_genre(eid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    e = _episode(db, ctx, eid)
    genre = db.get(Genre, genre_id)
    if genre is not None and genre in e.genres:
        e.genres.remove(genre)


# ── Episodes: ranking, scoped to the show ─────────────────────────────────────
@router.get("/shows/{sid}/episodes/ranked", response_model=list[RankedTelevisionEpisodeOut])
def ranked_episodes(sid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                    db: DbSession = Depends(get_database)):
    _show(db, ctx, sid)
    uid = _target_user(db, ctx, user_id)
    rows = db.scalars(
        select(UserTelevisionEpisodeRank)
        .where(UserTelevisionEpisodeRank.user_id == uid, UserTelevisionEpisodeRank.guild_id == ctx.guild_id,
               UserTelevisionEpisodeRank.show_id == sid)
        .order_by(UserTelevisionEpisodeRank.rank, UserTelevisionEpisodeRank.episode_id)
    ).all()
    mine = {r.episode_id for r in rows} if uid == ctx.user_id else set()
    return [
        RankedTelevisionEpisodeOut(position=i, rank=r.rank, watches=r.watches,
                                   notes=r.notes if uid == ctx.user_id else None,
                                   episode=_episode_out(db.get(TelevisionEpisode, r.episode_id), mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/shows/{sid}/episodes/reorder", status_code=204)
def reorder_episodes(sid: int, body: ReorderBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    _show(db, ctx, sid)
    rows = db.scalars(
        select(UserTelevisionEpisodeRank).where(
            UserTelevisionEpisodeRank.user_id == ctx.user_id, UserTelevisionEpisodeRank.guild_id == ctx.guild_id,
            UserTelevisionEpisodeRank.show_id == sid,
        )
    ).all()
    check_reorder_ids(body.ids, [r.episode_id for r in rows])
    apply_order(db, {r.episode_id: r for r in rows}, body.ids)


@router.get("/episodes/{eid}/entry", response_model=TelevisionEpisodeEntryOut | None)
def get_episode_entry(eid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserTelevisionEpisodeRank, {"user_id": ctx.user_id, "episode_id": eid})
    return TelevisionEpisodeEntryOut(watches=row.watches, notes=row.notes) if row else None


@router.put("/episodes/{eid}/entry", status_code=204)
def upsert_episode_entry(eid: int, body: TelevisionEpisodeEntryIn, ctx: GuildContext = Depends(RANK),
                         db: DbSession = Depends(get_database)):
    e = _episode(db, ctx, eid)
    row = db.get(UserTelevisionEpisodeRank, {"user_id": ctx.user_id, "episode_id": eid})
    if row is None:
        row = UserTelevisionEpisodeRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, episode_id=eid, show_id=e.show_id, watches=1,
            rank=rank_at(db, UserTelevisionEpisodeRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                        position=body.position, scope=UserTelevisionEpisodeRank.show_id == e.show_id),
        )
        db.add(row)
    data = body.model_dump(exclude_unset=True, exclude={"position"})
    for k, v in data.items():
        setattr(row, k, v)


@router.delete("/episodes/{eid}/entry", status_code=204)
def remove_episode_entry(eid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserTelevisionEpisodeRank, {"user_id": ctx.user_id, "episode_id": eid})
    if row:
        db.delete(row)


@router.put("/episodes/{eid}/position", status_code=204)
def move_episode(eid: int, body: PositionBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserTelevisionEpisodeRank, {"user_id": ctx.user_id, "episode_id": eid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserTelevisionEpisodeRank, user_id=ctx.user_id, guild_id=ctx.guild_id, position=body.position,
                       exclude_col=UserTelevisionEpisodeRank.episode_id, exclude=eid,
                       scope=UserTelevisionEpisodeRank.show_id == row.show_id)


def _episode_scope(ctx: GuildContext, user_id: int, sid: int):
    return ((TelevisionEpisodeComparison.user_id == user_id) & (TelevisionEpisodeComparison.guild_id == ctx.guild_id))


@router.get("/shows/{sid}/episodes/comparisons", response_model=list[ComparisonOut])
def list_episode_cmp(sid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                     db: DbSession = Depends(get_database)):
    _show(db, ctx, sid)
    return list_comparisons(db, TelevisionEpisodeComparison, scope=_episode_scope(ctx, _target_user(db, ctx, user_id), sid))


@router.put("/shows/{sid}/episodes/comparisons", response_model=ComparisonOut)
def upsert_episode_cmp(sid: int, body: ComparisonIn, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    _show(db, ctx, sid)
    _episode(db, ctx, body.winner_id)
    _episode(db, ctx, body.loser_id)
    return upsert_comparison(db, TelevisionEpisodeComparison, body.winner_id, body.loser_id,
                             scope=_episode_scope(ctx, ctx.user_id, sid),
                             extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id})


@router.delete("/shows/{sid}/episodes/comparisons", status_code=204)
def clear_episode_cmp(sid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    clear_comparisons(db, TelevisionEpisodeComparison, scope=_episode_scope(ctx, ctx.user_id, sid))


@router.delete("/shows/{sid}/episodes/comparisons/{a}/{b}", status_code=204)
def delete_episode_cmp(sid: int, a: int, b: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    delete_comparison(db, TelevisionEpisodeComparison, a, b, scope=_episode_scope(ctx, ctx.user_id, sid))
