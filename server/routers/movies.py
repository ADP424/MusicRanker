from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..api_models.base import PositionBody, ReorderBody
from ..api_models.comparison import ComparisonIn, ComparisonOut
from ..api_models.movie import MovieEntryIn, MovieEntryOut, MovieIn, MovieOut, MoviePatch, MoviePersonRef, RankedMovieOut
from ..api_models.music import NamedRef
from ..authz import Capability
from ..comparisons import clear_comparisons, delete_comparison, list_comparisons, upsert_comparison
from ..database import get_database
from ..database_models import MOVIE_ROLES, Genre, GuildMember, Movie, MovieComparison, MovieLink, MoviePerson, Person
from ..database_models.movie_cast_member import CastRole
from ..database_models.ranking import UserMovieRank
from ..deps import GuildContext, guild_ctx
from ..guild_junction_helpers import link_guild_scoped
from ..ranking import apply_order, check_reorder_ids, rank_at
from .links import make_links_router

links_router = make_links_router(
    owner_model=Movie, link_model=MovieLink, owner_fk="movie_id", prefix="/movies", tag="movies"
)

router = APIRouter(prefix="/guilds/{guild_id}/movies", tags=["movies"])

VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)
RANK = guild_ctx(Capability.RANK)


def _movie(db: DbSession, ctx: GuildContext, mid: int) -> Movie:
    m = db.get(Movie, mid)
    if m is None or m.guild_id != ctx.guild_id:  # belt and braces; the composite FKs already prevent leakage
        raise HTTPException(404, "Movie not found")
    return m


def _target_user(db: DbSession, ctx: GuildContext, user_id: int | None) -> int:
    """E1/E3: anyone may *view* any member's ranking; only the owner of a
    ranking may write to it. There is no path by which `user_id` reaches a
    mutating endpoint."""
    if user_id is None or user_id == ctx.user_id:
        return ctx.user_id
    if db.get(GuildMember, (ctx.guild_id, user_id)) is None:
        raise HTTPException(404, "Not a member of this guild")
    return user_id


def _my_movie_ids(db: DbSession, ctx: GuildContext) -> set[int]:
    return set(db.scalars(
        select(UserMovieRank.movie_id).where(
            UserMovieRank.user_id == ctx.user_id, UserMovieRank.guild_id == ctx.guild_id
        )
    ))


def _out(m: Movie, mine: set[int]) -> MovieOut:
    out = MovieOut.model_validate(m)
    out.persons = [
        MoviePersonRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role)
        for l in m.person_links
    ]
    out.genre_ids = [g.id for g in m.genres]
    out.soundtrack_albums = [NamedRef(id=a.id, name=a.name, name_en=a.name_en) for a in m.soundtrack_albums]
    out.source_books = [NamedRef(id=b.id, name=b.name, name_en=b.name_en) for b in m.source_books]
    out.in_my_list = m.id in mine
    return out


# ── Catalog ──────────────────────────────────────────────────────────────────
@router.get("", response_model=list[MovieOut])
def list_catalog(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    mine = _my_movie_ids(db, ctx)
    rows = db.scalars(select(Movie).where(Movie.guild_id == ctx.guild_id).order_by(Movie.name)).all()
    return [_out(m, mine) for m in rows]


@router.post("", response_model=MovieOut, status_code=201)
def create_movie(body: MovieIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database)):
    movie = Movie(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **body.model_dump())
    db.add(movie)
    db.flush()
    return _out(movie, set())


# ── The personal layer ───────────────────────────────────────────────────────
# Literal paths (/ranked, /reorder, /comparisons...) must be registered before
# /{mid} — Starlette matches routes in registration order, so a param route
# declared first would swallow these as mid="ranked" etc.
@router.get("/ranked", response_model=list[RankedMovieOut])
def ranked(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
           db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    mine = _my_movie_ids(db, ctx)
    rows = db.scalars(
        select(UserMovieRank)
        .where(UserMovieRank.user_id == uid, UserMovieRank.guild_id == ctx.guild_id)
        .order_by(UserMovieRank.rank, UserMovieRank.movie_id)
    ).all()
    return [
        RankedMovieOut(position=i, rank=r.rank, watches=r.watches,
                       notes=r.notes if uid == ctx.user_id else None,
                       movie=_out(db.get(Movie, r.movie_id), mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/reorder", status_code=204)
def reorder(body: ReorderBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    rows = db.scalars(
        select(UserMovieRank).where(UserMovieRank.user_id == ctx.user_id, UserMovieRank.guild_id == ctx.guild_id)
    ).all()
    check_reorder_ids(body.ids, [r.movie_id for r in rows])
    apply_order(db, {r.movie_id: r for r in rows}, body.ids)


# ── Comparisons (always the caller's own) ────────────────────────────────────
def _scope(ctx: GuildContext, user_id: int):
    return (MovieComparison.user_id == user_id) & (MovieComparison.guild_id == ctx.guild_id)


@router.get("/comparisons", response_model=list[ComparisonOut])
def list_cmp(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
             db: DbSession = Depends(get_database)):
    return list_comparisons(db, MovieComparison, scope=_scope(ctx, _target_user(db, ctx, user_id)))


@router.put("/comparisons", response_model=ComparisonOut)
def upsert_cmp(body: ComparisonIn, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    _movie(db, ctx, body.winner_id)
    _movie(db, ctx, body.loser_id)
    return upsert_comparison(db, MovieComparison, body.winner_id, body.loser_id,
                             scope=_scope(ctx, ctx.user_id),
                             extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id})


@router.delete("/comparisons", status_code=204)
def clear_cmp(ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    clear_comparisons(db, MovieComparison, scope=_scope(ctx, ctx.user_id))


@router.delete("/comparisons/{a}/{b}", status_code=204)
def delete_cmp(a: int, b: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    delete_comparison(db, MovieComparison, a, b, scope=_scope(ctx, ctx.user_id))


@router.get("/{mid}", response_model=MovieOut)
def get_movie(mid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return _out(_movie(db, ctx, mid), _my_movie_ids(db, ctx))


@router.patch("/{mid}", response_model=MovieOut)
def update_movie(mid: int, body: MoviePatch, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    movie = _movie(db, ctx, mid)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(movie, k, v)
    movie.updated_by_user_id = ctx.user_id
    return _out(movie, _my_movie_ids(db, ctx))


@router.delete("/{mid}", status_code=204)
def delete_movie(mid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database)):
    """F1: hard delete, and it takes every member's ranking of this movie with it.
    The client calls /impact first and shows the count in the confirm dialog."""
    db.delete(_movie(db, ctx, mid))


@router.get("/{mid}/impact")
def delete_impact(mid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    n = db.scalar(select(func.count()).select_from(UserMovieRank).where(UserMovieRank.movie_id == mid))
    return {"rankings_destroyed": n}


# ── Person & genre links (CATALOG_EDIT) ──────────────────────────────────────
@router.put("/{mid}/persons/{person_id}/{role}", status_code=204)
def link_person(mid: int, person_id: int, role: CastRole,
                ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    if role not in MOVIE_ROLES:
        raise HTTPException(422, "The creator role only applies to television shows")
    _movie(db, ctx, mid)
    person = db.get(Person, person_id)
    if person is None or person.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")
    if not db.get(MoviePerson, (mid, person_id, role)):
        db.add(MoviePerson(movie_id=mid, person_id=person_id, role=role, guild_id=ctx.guild_id))


@router.delete("/{mid}/persons/{person_id}/{role}", status_code=204)
def unlink_person(mid: int, person_id: int, role: CastRole,
                  ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    link = db.get(MoviePerson, (mid, person_id, role))
    if link:
        db.delete(link)


@router.get("/{mid}/genres")
def movie_genres(mid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return [{"id": g.id, "name": g.name} for g in sorted(_movie(db, ctx, mid).genres, key=lambda g: g.name)]


@router.put("/{mid}/genres/{gid}", status_code=204)
def add_genre(mid: int, gid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    movie = _movie(db, ctx, mid)
    genre = db.get(Genre, gid)
    if genre is None or genre.guild_id != ctx.guild_id:
        raise HTTPException(404, "Genre not found")
    if not genre.is_movie:
        raise HTTPException(422, "Genre is not applicable to movies")
    if genre not in movie.genres:
        link_guild_scoped(db, movie, Movie.genres, genre, guild_id=ctx.guild_id)


@router.delete("/{mid}/genres/{gid}", status_code=204)
def remove_genre(mid: int, gid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    movie = _movie(db, ctx, mid)
    genre = db.get(Genre, gid)
    if genre is not None and genre in movie.genres:
        movie.genres.remove(genre)


# ── The personal layer ───────────────────────────────────────────────────────
@router.get("/{mid}/entry", response_model=MovieEntryOut | None)
def get_entry(mid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserMovieRank, {"user_id": ctx.user_id, "movie_id": mid})
    return MovieEntryOut(watches=row.watches, notes=row.notes) if row else None


@router.put("/{mid}/entry", status_code=204)
def upsert_entry(mid: int, body: MovieEntryIn, ctx: GuildContext = Depends(RANK),
                 db: DbSession = Depends(get_database)):
    _movie(db, ctx, mid)
    row = db.get(UserMovieRank, {"user_id": ctx.user_id, "movie_id": mid})
    if row is None:
        row = UserMovieRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, movie_id=mid, watches=1,
            rank=rank_at(db, UserMovieRank, user_id=ctx.user_id, guild_id=ctx.guild_id, position=body.position),
        )
        db.add(row)
    data = body.model_dump(exclude_unset=True, exclude={"position"})
    for k, v in data.items():
        setattr(row, k, v)


@router.delete("/{mid}/entry", status_code=204)
def remove_entry(mid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserMovieRank, {"user_id": ctx.user_id, "movie_id": mid})
    if row:
        db.delete(row)


@router.put("/{mid}/position", status_code=204)
def move(mid: int, body: PositionBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserMovieRank, {"user_id": ctx.user_id, "movie_id": mid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserMovieRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                       position=body.position, exclude_col=UserMovieRank.movie_id, exclude=mid)
