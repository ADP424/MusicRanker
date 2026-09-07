from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..api_models.base import PositionBody, ReorderBody
from ..api_models.comparison import ComparisonIn, ComparisonOut
from ..api_models.game import GameEntryIn, GameEntryOut, GameIn, GameOut, GamePatch, GamePersonRef, RankedGameOut
from ..api_models.music import NamedRef
from ..authz import Capability
from ..comparisons import clear_comparisons, delete_comparison, list_comparisons, upsert_comparison
from ..database import get_database
from ..database_models import (
    Game, GameComparison, GameLink, GamePerson, GamePlatform, Genre, GuildMember, Person,
)
from ..database_models.game_credit import GameRole
from ..database_models.ranking import UserGameRank
from ..deps import GuildContext, guild_ctx
from ..guild_junction_helpers import link_guild_scoped
from ..ranking import apply_order, check_reorder_ids, rank_at
from .links import make_links_router

router = APIRouter(prefix="/guilds/{guild_id}/games", tags=["games"])

VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)
RANK = guild_ctx(Capability.RANK)

links_router = make_links_router(
    owner_model=Game, link_model=GameLink, owner_fk="game_id", prefix="/games", tag="games"
)


def _game(db: DbSession, ctx: GuildContext, gid: int) -> Game:
    g = db.get(Game, gid)
    if g is None or g.guild_id != ctx.guild_id:
        raise HTTPException(404, "Game not found")
    return g


def _target_user(db: DbSession, ctx: GuildContext, user_id: int | None) -> int:
    if user_id is None or user_id == ctx.user_id:
        return ctx.user_id
    if db.get(GuildMember, (ctx.guild_id, user_id)) is None:
        raise HTTPException(404, "Not a member of this guild")
    return user_id


def _my_game_ids(db: DbSession, ctx: GuildContext) -> set[int]:
    return set(db.scalars(
        select(UserGameRank.game_id).where(UserGameRank.user_id == ctx.user_id, UserGameRank.guild_id == ctx.guild_id)
    ))


def _out(g: Game, mine: set[int]) -> GameOut:
    out = GameOut.model_validate(g)
    out.persons = [
        GamePersonRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role)
        for l in g.person_links
    ]
    out.genre_ids = [x.id for x in g.genres]
    out.platform_ids = [x.id for x in g.platforms]
    out.soundtrack_albums = [NamedRef(id=a.id, name=a.name, name_en=a.name_en) for a in g.soundtrack_albums]
    out.in_my_list = g.id in mine
    return out


# ── Catalog ──────────────────────────────────────────────────────────────────
@router.get("", response_model=list[GameOut])
def list_catalog(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    mine = _my_game_ids(db, ctx)
    rows = db.scalars(select(Game).where(Game.guild_id == ctx.guild_id).order_by(Game.name)).all()
    return [_out(g, mine) for g in rows]


@router.post("", response_model=GameOut, status_code=201)
def create_game(body: GameIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database)):
    g = Game(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **body.model_dump())
    db.add(g)
    db.flush()
    return _out(g, set())


# ── The personal layer ───────────────────────────────────────────────────────
# Literal paths (/ranked, /reorder, /comparisons...) must be registered before
# /{gid} — Starlette matches routes in registration order, so a param route
# declared first would swallow these as gid="ranked" etc.
@router.get("/ranked", response_model=list[RankedGameOut])
def ranked(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    mine = _my_game_ids(db, ctx)
    rows = db.scalars(
        select(UserGameRank)
        .where(UserGameRank.user_id == uid, UserGameRank.guild_id == ctx.guild_id)
        .order_by(UserGameRank.rank, UserGameRank.game_id)
    ).all()
    return [
        RankedGameOut(position=i, rank=r.rank, hours_played=r.hours_played,
                     notes=r.notes if uid == ctx.user_id else None,
                     game=_out(db.get(Game, r.game_id), mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/reorder", status_code=204)
def reorder(body: ReorderBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    rows = db.scalars(
        select(UserGameRank).where(UserGameRank.user_id == ctx.user_id, UserGameRank.guild_id == ctx.guild_id)
    ).all()
    check_reorder_ids(body.ids, [r.game_id for r in rows])
    apply_order(db, {r.game_id: r for r in rows}, body.ids)


# ── Comparisons ──────────────────────────────────────────────────────────────
def _scope(ctx: GuildContext, user_id: int):
    return (GameComparison.user_id == user_id) & (GameComparison.guild_id == ctx.guild_id)


@router.get("/comparisons", response_model=list[ComparisonOut])
def list_cmp(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return list_comparisons(db, GameComparison, scope=_scope(ctx, _target_user(db, ctx, user_id)))


@router.put("/comparisons", response_model=ComparisonOut)
def upsert_cmp(body: ComparisonIn, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    _game(db, ctx, body.winner_id)
    _game(db, ctx, body.loser_id)
    return upsert_comparison(db, GameComparison, body.winner_id, body.loser_id,
                             scope=_scope(ctx, ctx.user_id), extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id})


@router.delete("/comparisons", status_code=204)
def clear_cmp(ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    clear_comparisons(db, GameComparison, scope=_scope(ctx, ctx.user_id))


@router.delete("/comparisons/{a}/{b}", status_code=204)
def delete_cmp(a: int, b: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    delete_comparison(db, GameComparison, a, b, scope=_scope(ctx, ctx.user_id))


@router.get("/{gid}", response_model=GameOut)
def get_game(gid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return _out(_game(db, ctx, gid), _my_game_ids(db, ctx))


@router.patch("/{gid}", response_model=GameOut)
def update_game(gid: int, body: GamePatch, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    g = _game(db, ctx, gid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(g, k, v)
    g.updated_by_user_id = ctx.user_id
    return _out(g, _my_game_ids(db, ctx))


@router.get("/{gid}/impact")
def delete_impact(gid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    _game(db, ctx, gid)
    return {"rankings_destroyed": db.scalar(
        select(func.count()).select_from(UserGameRank).where(UserGameRank.game_id == gid)
    )}


@router.delete("/{gid}", status_code=204)
def delete_game(gid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database)):
    db.delete(_game(db, ctx, gid))


# ── People & genres & platforms ───────────────────────────────────────────────
@router.get("/{gid}/persons", response_model=list[GamePersonRef])
def game_persons(gid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    g = _game(db, ctx, gid)
    return sorted(
        (GamePersonRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role) for l in g.person_links),
        key=lambda p: p.name,
    )


@router.put("/{gid}/persons/{person_id}/{role}", status_code=204)
def link_person(gid: int, person_id: int, role: GameRole, ctx: GuildContext = Depends(EDIT),
                db: DbSession = Depends(get_database)):
    _game(db, ctx, gid)
    person = db.get(Person, person_id)
    if person is None or person.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")
    if not db.get(GamePerson, (gid, person_id, role)):
        db.add(GamePerson(game_id=gid, person_id=person_id, role=role, guild_id=ctx.guild_id))


@router.delete("/{gid}/persons/{person_id}/{role}", status_code=204)
def unlink_person(gid: int, person_id: int, role: GameRole, ctx: GuildContext = Depends(EDIT),
                  db: DbSession = Depends(get_database)):
    link = db.get(GamePerson, (gid, person_id, role))
    if link:
        db.delete(link)


@router.get("/{gid}/genres")
def game_genres(gid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return [{"id": g.id, "name": g.name} for g in sorted(_game(db, ctx, gid).genres, key=lambda g: g.name)]


@router.put("/{gid}/genres/{genre_id}", status_code=204)
def add_genre(gid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    g = _game(db, ctx, gid)
    genre = db.get(Genre, genre_id)
    if genre is None or genre.guild_id != ctx.guild_id:
        raise HTTPException(404, "Genre not found")
    if not genre.is_game:
        raise HTTPException(422, "Genre is not applicable to games")
    if genre not in g.genres:
        link_guild_scoped(db, g, Game.genres, genre, guild_id=ctx.guild_id)


@router.delete("/{gid}/genres/{genre_id}", status_code=204)
def remove_genre(gid: int, genre_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    g = _game(db, ctx, gid)
    genre = db.get(Genre, genre_id)
    if genre is not None and genre in g.genres:
        g.genres.remove(genre)


@router.get("/{gid}/platforms")
def game_platforms_list(gid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return [{"id": p.id, "name": p.name} for p in sorted(_game(db, ctx, gid).platforms, key=lambda p: p.name)]


@router.put("/{gid}/platforms/{platform_id}", status_code=204)
def add_platform(gid: int, platform_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    g = _game(db, ctx, gid)
    platform = db.get(GamePlatform, platform_id)
    if platform is None or platform.guild_id != ctx.guild_id:
        raise HTTPException(404, "Platform not found")
    if platform not in g.platforms:
        link_guild_scoped(db, g, Game.platforms, platform, guild_id=ctx.guild_id)


@router.delete("/{gid}/platforms/{platform_id}", status_code=204)
def remove_platform(gid: int, platform_id: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    g = _game(db, ctx, gid)
    platform = db.get(GamePlatform, platform_id)
    if platform is not None and platform in g.platforms:
        g.platforms.remove(platform)


# ── The personal layer ───────────────────────────────────────────────────────
@router.get("/{gid}/entry", response_model=GameEntryOut | None)
def get_entry(gid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserGameRank, {"user_id": ctx.user_id, "game_id": gid})
    return GameEntryOut(hours_played=row.hours_played, notes=row.notes) if row else None


@router.put("/{gid}/entry", status_code=204)
def upsert_entry(gid: int, body: GameEntryIn, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    _game(db, ctx, gid)
    row = db.get(UserGameRank, {"user_id": ctx.user_id, "game_id": gid})
    if row is None:
        row = UserGameRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, game_id=gid,
            rank=rank_at(db, UserGameRank, user_id=ctx.user_id, guild_id=ctx.guild_id, position=body.position),
        )
        db.add(row)
    data = body.model_dump(exclude_unset=True, exclude={"position"})
    for k, v in data.items():
        setattr(row, k, v)


@router.delete("/{gid}/entry", status_code=204)
def remove_entry(gid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserGameRank, {"user_id": ctx.user_id, "game_id": gid})
    if row:
        db.delete(row)


@router.put("/{gid}/position", status_code=204)
def move(gid: int, body: PositionBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserGameRank, {"user_id": ctx.user_id, "game_id": gid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserGameRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                       position=body.position, exclude_col=UserGameRank.game_id, exclude=gid)
