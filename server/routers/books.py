from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..api_models.base import PositionBody, ReorderBody
from ..api_models.books import BookEntryIn, BookEntryOut, BookIn, BookOut, BookPatch, BookPersonRef, RankedBookOut
from ..api_models.comparison import ComparisonIn, ComparisonOut
from ..api_models.music import NamedRef
from ..authz import Capability
from ..comparisons import clear_comparisons, delete_comparison, list_comparisons, upsert_comparison
from ..database import get_database
from ..database_models import (
    Book, BookComparison, BookLink, BookPerson, BookRole, Game, Genre, GuildMember, Movie, Person, TelevisionShow,
    UserBookRank,
)
from ..deps import GuildContext, guild_ctx
from ..guild_junction_helpers import link_guild_scoped
from ..ranking import apply_order, check_reorder_ids, rank_at
from .links import make_links_router

links_router = make_links_router(
    owner_model=Book, link_model=BookLink, owner_fk="book_id", prefix="/books", tag="books"
)

router = APIRouter(prefix="/guilds/{guild_id}/books", tags=["books"])

VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)
RANK = guild_ctx(Capability.RANK)

AdaptationKind = Literal["movie", "game", "television_show"]
# kind -> (adapted media model, Book relationship)
_ADAPTATIONS = {
    "movie": (Movie, Book.adaptation_movies),
    "game": (Game, Book.adaptation_games),
    "television_show": (TelevisionShow, Book.adaptation_television_shows),
}


def _book(db: DbSession, ctx: GuildContext, bid: int) -> Book:
    b = db.get(Book, bid)
    if b is None or b.guild_id != ctx.guild_id:
        raise HTTPException(404, "Book not found")
    return b


def _target_user(db: DbSession, ctx: GuildContext, user_id: int | None) -> int:
    """E1/E3: anyone may *view* any member's ranking; only its owner may write
    to it. `user_id` never reaches a mutating endpoint."""
    if user_id is None or user_id == ctx.user_id:
        return ctx.user_id
    if db.get(GuildMember, (ctx.guild_id, user_id)) is None:
        raise HTTPException(404, "Not a member of this guild")
    return user_id


def _my_book_ids(db: DbSession, ctx: GuildContext) -> set[int]:
    return set(db.scalars(
        select(UserBookRank.book_id).where(
            UserBookRank.user_id == ctx.user_id, UserBookRank.guild_id == ctx.guild_id
        )
    ))


def _refs(rows) -> list[NamedRef]:
    return [NamedRef(id=r.id, name=r.name, name_en=r.name_en) for r in rows]


def _out(b: Book, mine: set[int]) -> BookOut:
    out = BookOut.model_validate(b)
    out.persons = [
        BookPersonRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role)
        for l in b.person_links
    ]
    out.genre_ids = [g.id for g in b.genres]
    out.adaptation_movies = _refs(b.adaptation_movies)
    out.adaptation_games = _refs(b.adaptation_games)
    out.adaptation_television_shows = _refs(b.adaptation_television_shows)
    out.in_my_list = b.id in mine
    return out


# ── Catalog ──────────────────────────────────────────────────────────────────
@router.get("", response_model=list[BookOut])
def list_catalog(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    mine = _my_book_ids(db, ctx)
    rows = db.scalars(select(Book).where(Book.guild_id == ctx.guild_id).order_by(Book.name)).all()
    return [_out(b, mine) for b in rows]


@router.post("", response_model=BookOut, status_code=201)
def create_book(body: BookIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database)):
    book = Book(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **body.model_dump())
    db.add(book)
    db.flush()
    return _out(book, set())


# ── The personal layer ───────────────────────────────────────────────────────
# Literal paths (/ranked, /reorder, /comparisons...) must be registered before
# /{bid} — Starlette matches routes in registration order.
@router.get("/ranked", response_model=list[RankedBookOut])
def ranked(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
           db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    mine = _my_book_ids(db, ctx)
    rows = db.scalars(
        select(UserBookRank)
        .where(UserBookRank.user_id == uid, UserBookRank.guild_id == ctx.guild_id)
        .order_by(UserBookRank.rank, UserBookRank.book_id)
    ).all()
    return [
        RankedBookOut(position=i, rank=r.rank, reads=r.reads,
                      notes=r.notes if uid == ctx.user_id else None,
                      book=_out(db.get(Book, r.book_id), mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/reorder", status_code=204)
def reorder(body: ReorderBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    rows = db.scalars(
        select(UserBookRank).where(UserBookRank.user_id == ctx.user_id, UserBookRank.guild_id == ctx.guild_id)
    ).all()
    check_reorder_ids(body.ids, [r.book_id for r in rows])
    apply_order(db, {r.book_id: r for r in rows}, body.ids)


# ── Comparisons (always the caller's own) ────────────────────────────────────
def _scope(ctx: GuildContext, user_id: int):
    return (BookComparison.user_id == user_id) & (BookComparison.guild_id == ctx.guild_id)


@router.get("/comparisons", response_model=list[ComparisonOut])
def list_cmp(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
             db: DbSession = Depends(get_database)):
    return list_comparisons(db, BookComparison, scope=_scope(ctx, _target_user(db, ctx, user_id)))


@router.put("/comparisons", response_model=ComparisonOut)
def upsert_cmp(body: ComparisonIn, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    _book(db, ctx, body.winner_id)
    _book(db, ctx, body.loser_id)
    return upsert_comparison(db, BookComparison, body.winner_id, body.loser_id,
                             scope=_scope(ctx, ctx.user_id),
                             extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id})


@router.delete("/comparisons", status_code=204)
def clear_cmp(ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    clear_comparisons(db, BookComparison, scope=_scope(ctx, ctx.user_id))


@router.delete("/comparisons/{a}/{b}", status_code=204)
def delete_cmp(a: int, b: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    delete_comparison(db, BookComparison, a, b, scope=_scope(ctx, ctx.user_id))


@router.get("/{bid}", response_model=BookOut)
def get_book(bid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return _out(_book(db, ctx, bid), _my_book_ids(db, ctx))


@router.patch("/{bid}", response_model=BookOut)
def update_book(bid: int, body: BookPatch, ctx: GuildContext = Depends(EDIT),
                db: DbSession = Depends(get_database)):
    book = _book(db, ctx, bid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(book, k, v)
    book.updated_by_user_id = ctx.user_id
    return _out(book, _my_book_ids(db, ctx))


@router.delete("/{bid}", status_code=204)
def delete_book(bid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database)):
    """F1: hard delete, and it takes every member's ranking of this book with it.
    The client calls /impact first and shows the count in the confirm dialog."""
    db.delete(_book(db, ctx, bid))


@router.get("/{bid}/impact")
def delete_impact(bid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    _book(db, ctx, bid)
    return {"rankings_destroyed": db.scalar(
        select(func.count()).select_from(UserBookRank).where(UserBookRank.book_id == bid)
    )}


# ── Person & genre links (CATALOG_EDIT) ──────────────────────────────────────
@router.put("/{bid}/persons/{person_id}/{role}", status_code=204)
def link_person(bid: int, person_id: int, role: BookRole,
                ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    _book(db, ctx, bid)
    person = db.get(Person, person_id)
    if person is None or person.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")
    if not db.get(BookPerson, (bid, person_id, role)):
        db.add(BookPerson(book_id=bid, person_id=person_id, role=role, guild_id=ctx.guild_id))


@router.delete("/{bid}/persons/{person_id}/{role}", status_code=204)
def unlink_person(bid: int, person_id: int, role: BookRole,
                  ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    _book(db, ctx, bid)
    link = db.get(BookPerson, (bid, person_id, role))
    if link:
        db.delete(link)


@router.get("/{bid}/genres", response_model=list[dict])
def book_genres(bid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return [{"id": g.id, "name": g.name} for g in sorted(_book(db, ctx, bid).genres, key=lambda g: g.name)]


@router.put("/{bid}/genres/{gid}", status_code=204)
def add_genre(bid: int, gid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    book = _book(db, ctx, bid)
    genre = db.get(Genre, gid)
    if genre is None or genre.guild_id != ctx.guild_id:
        raise HTTPException(404, "Genre not found")
    if not genre.is_book:
        raise HTTPException(422, "Genre is not applicable to books")
    if genre not in book.genres:
        link_guild_scoped(db, book, Book.genres, genre, guild_id=ctx.guild_id)


@router.delete("/{bid}/genres/{gid}", status_code=204)
def remove_genre(bid: int, gid: int, ctx: GuildContext = Depends(EDIT), db: DbSession = Depends(get_database)):
    book = _book(db, ctx, bid)
    genre = db.get(Genre, gid)
    if genre is not None and genre in book.genres:
        book.genres.remove(genre)


# ── adaptations: the movies / games / TV shows made from this book ───────────
@router.put("/{bid}/adaptations/{kind}/{target_id}", status_code=204)
def link_adaptation(bid: int, kind: AdaptationKind, target_id: int, ctx: GuildContext = Depends(EDIT),
                    db: DbSession = Depends(get_database)):
    book = _book(db, ctx, bid)
    model, rel = _ADAPTATIONS[kind]
    target = db.get(model, target_id)
    if target is None or target.guild_id != ctx.guild_id:
        raise HTTPException(404, f"{model.__name__} not found")
    if target not in getattr(book, rel.key):
        link_guild_scoped(db, book, rel, target, guild_id=ctx.guild_id)


@router.delete("/{bid}/adaptations/{kind}/{target_id}", status_code=204)
def unlink_adaptation(bid: int, kind: AdaptationKind, target_id: int, ctx: GuildContext = Depends(EDIT),
                      db: DbSession = Depends(get_database)):
    book = _book(db, ctx, bid)
    model, rel = _ADAPTATIONS[kind]
    target = db.get(model, target_id)
    if target is not None and target in getattr(book, rel.key):
        getattr(book, rel.key).remove(target)


# ── My entry ─────────────────────────────────────────────────────────────────
@router.get("/{bid}/entry", response_model=BookEntryOut | None)
def get_entry(bid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserBookRank, {"user_id": ctx.user_id, "book_id": bid})
    return BookEntryOut(reads=row.reads, notes=row.notes) if row else None


@router.put("/{bid}/entry", status_code=204)
def upsert_entry(bid: int, body: BookEntryIn, ctx: GuildContext = Depends(RANK),
                 db: DbSession = Depends(get_database)):
    _book(db, ctx, bid)
    row = db.get(UserBookRank, {"user_id": ctx.user_id, "book_id": bid})
    if row is None:
        row = UserBookRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, book_id=bid, reads=1,
            rank=rank_at(db, UserBookRank, user_id=ctx.user_id, guild_id=ctx.guild_id, position=body.position),
        )
        db.add(row)
    data = body.model_dump(exclude_unset=True, exclude={"position"})
    for k, v in data.items():
        setattr(row, k, v)


@router.delete("/{bid}/entry", status_code=204)
def remove_entry(bid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserBookRank, {"user_id": ctx.user_id, "book_id": bid})
    if row:
        db.delete(row)


@router.put("/{bid}/position", status_code=204)
def move(bid: int, body: PositionBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserBookRank, {"user_id": ctx.user_id, "book_id": bid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserBookRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                       position=body.position, exclude_col=UserBookRank.book_id, exclude=bid)
