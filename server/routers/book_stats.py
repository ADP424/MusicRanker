"""
Book stats router — aggregate / analytical endpoints, computed from one guild
member's personal ranking (defaults to the caller).

Word count is optional on a book, so every word-based figure (totals, averages,
scatter plots) covers only the books that have one.

Book score formula
------------------
Score = 1 / position (1-based, per the viewing member's own ranking).
Author score = mean of scores of all their (ranked) books they're credited as
author on. A book's nationality is its first-credited author's.
"""

from __future__ import annotations

from collections import defaultdict
from statistics import mean
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import Book, BookPerson, BookRole, Genre, GuildMember, Person, UserBookRank
from ..database_models.genre_parent import genre_parents
from ..database_models.junctions import book_genres
from ..deps import GuildContext, guild_ctx

router = APIRouter(prefix="/guilds/{guild_id}/book-stats", tags=["book-stats"])
VIEW = guild_ctx(Capability.VIEW)


def _target_user(db: DbSession, ctx: GuildContext, user_id: int | None) -> int:
    if user_id is None or user_id == ctx.user_id:
        return ctx.user_id
    if db.get(GuildMember, (ctx.guild_id, user_id)) is None:
        raise HTTPException(404, "Not a member of this guild")
    return user_id


# ---------------------------------------------------------------------------
# Shared data loader
# ---------------------------------------------------------------------------


def _load(db: DbSession, ctx: GuildContext, uid: int):
    """
    Returns:
        books: list of Book in the viewing member's rank order
        book_score: dict[book_id, float]
        reads_by_book: dict[book_id, int]
        author_books: dict[person_id, list[(Book, score)]]  (role = author only)
        book_author: dict[book_id, Person]  (first-credited author)
        person_by_id: dict[int, Person]
    """
    rank_rows = list(db.scalars(
        select(UserBookRank)
        .where(UserBookRank.user_id == uid, UserBookRank.guild_id == ctx.guild_id)
        .order_by(UserBookRank.rank, UserBookRank.book_id)
    ).all())
    book_ids = [r.book_id for r in rank_rows]
    book_by_id: dict[int, Book] = {b.id: b for b in db.scalars(
        select(Book).where(Book.id.in_(book_ids))
    ).all()} if book_ids else {}
    books = [book_by_id[bid] for bid in book_ids if bid in book_by_id]
    book_score: dict[int, float] = {b.id: 1.0 / pos for pos, b in enumerate(books, 1)}
    reads_by_book: dict[int, int] = {r.book_id: r.reads for r in rank_rows}

    links: list[BookPerson] = list(db.scalars(
        select(BookPerson)
        .where(BookPerson.book_id.in_(book_ids), BookPerson.role == BookRole.author)
        .order_by(BookPerson.book_id, BookPerson.person_id)
    ).all()) if book_ids else []

    person_ids = {l.person_id for l in links}
    person_by_id: dict[int, Person] = {p.id: p for p in db.scalars(
        select(Person).where(Person.id.in_(person_ids))
    ).all()} if person_ids else {}

    author_books: dict[int, list[tuple[Book, float]]] = defaultdict(list)
    book_author: dict[int, Person] = {}
    for link in links:
        b, p = book_by_id.get(link.book_id), person_by_id.get(link.person_id)
        if b is None or p is None:
            continue
        author_books[p.id].append((b, book_score[b.id]))
        book_author.setdefault(b.id, p)

    return books, book_score, reads_by_book, author_books, book_author, person_by_id


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _best_worst(items: list[Any], key_fn, val_fn, higher_is_better: bool = True):
    groups: dict[Any, list] = defaultdict(list)
    for item in items:
        k = key_fn(item)
        if k is not None:
            groups[k].append(item)
    if not groups:
        return None, None
    scored = {k: val_fn(v) for k, v in groups.items()}
    ordered = sorted(scored.items(), key=lambda kv: kv[1], reverse=higher_is_better)
    return ordered[0][0], ordered[-1][0]


def _group_stats(items: list[Any], key_fn, score_fn=None) -> list[dict]:
    groups: dict[Any, list] = defaultdict(list)
    for item in items:
        k = key_fn(item)
        if k is not None:
            groups[k].append(item)
    result = []
    for k, members in sorted(groups.items(), key=lambda kv: kv[0]):
        entry: dict = {"key": k, "count": len(members)}
        if score_fn:
            scores = [score_fn(m) for m in members]
            entry["avg_score"] = mean(scores) if scores else None
        result.append(entry)
    return result


def _genre_ancestors(db: DbSession) -> dict[int, set[int]]:
    rows = db.execute(select(genre_parents.c.genre_id, genre_parents.c.parent_genre_id)).all()
    parent_of: dict[int, set[int]] = defaultdict(set)
    for child_id, parent_id in rows:
        parent_of[child_id].add(parent_id)
    all_genre_ids = {gid for gid, _ in rows} | {pid for _, pid in rows}
    ancestors: dict[int, set[int]] = {}

    def get_ancestors(gid: int) -> set[int]:
        if gid in ancestors:
            return ancestors[gid]
        result: set[int] = set()
        queue = list(parent_of.get(gid, []))
        visited: set[int] = set()
        while queue:
            pid = queue.pop()
            if pid in visited:
                continue
            visited.add(pid)
            result.add(pid)
            queue.extend(parent_of.get(pid, []))
        ancestors[gid] = result
        return result

    for gid in list(all_genre_ids):
        get_ancestors(gid)
    return ancestors


def _root_genre_ids(db: DbSession, ctx: GuildContext) -> set[int]:
    has_parent = select(genre_parents.c.genre_id)
    return {
        g.id for g in db.scalars(
            select(Genre).where(Genre.guild_id == ctx.guild_id, Genre.id.not_in(has_parent), Genre.is_book.is_(True))
        ).all()
    }


def _decade(year: int) -> int:
    return (year // 10) * 10


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/summary")
def summary(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    books, book_score, reads_by_book, author_books, book_author, person_by_id = _load(db, ctx, uid)

    counted = [b for b in books if b.word_count is not None]
    unique_words = sum(b.word_count for b in counted)
    total_words_read = sum(b.word_count * reads_by_book.get(b.id, 1) for b in counted)

    best_year_books, worst_year_books = _best_worst(
        books, lambda b: b.release_year, lambda g: mean(book_score[b.id] for b in g)
    )
    best_decade_books, worst_decade_books = _best_worst(
        books, lambda b: _decade(b.release_year), lambda g: mean(book_score[b.id] for b in g)
    )

    books_with_author = [b for b in books if b.id in book_author]
    best_core_nat_books, worst_core_nat_books = _best_worst(
        books_with_author, lambda b: book_author[b.id].core_nationality,
        lambda g: mean(book_score[b.id] for b in g),
    )
    best_birth_nat_books, worst_birth_nat_books = _best_worst(
        books_with_author, lambda b: book_author[b.id].birth_nationality,
        lambda g: mean(book_score[b.id] for b in g),
    )

    authors = [(person_by_id[pid], pairs) for pid, pairs in author_books.items()]
    best_core_nat_authors, worst_core_nat_authors = _best_worst(
        authors, lambda t: t[0].core_nationality,
        lambda g: mean(mean(score for _, score in t[1]) for t in g),
    )
    best_birth_nat_authors, worst_birth_nat_authors = _best_worst(
        authors, lambda t: t[0].birth_nationality,
        lambda g: mean(mean(score for _, score in t[1]) for t in g),
    )

    return {
        "total_books": len(books),
        "total_authors": len(author_books),
        "avg_books_per_author": round(mean(len(v) for v in author_books.values()), 2) if author_books else 0,
        "books_with_word_count": len(counted),
        "unique_words": unique_words,
        "avg_book_words": round(unique_words / len(counted)) if counted else 0,
        "total_words_read": total_words_read,
        "avg_words_read": round(total_words_read / len(counted)) if counted else 0,
        "best_year_books": best_year_books,
        "worst_year_books": worst_year_books,
        "best_decade_books": best_decade_books,
        "worst_decade_books": worst_decade_books,
        "best_core_nationality_books": best_core_nat_books,
        "worst_core_nationality_books": worst_core_nat_books,
        "best_birth_nationality_books": best_birth_nat_books,
        "worst_birth_nationality_books": worst_birth_nat_books,
        "best_core_nationality_authors": best_core_nat_authors,
        "worst_core_nationality_authors": worst_core_nat_authors,
        "best_birth_nationality_authors": best_birth_nat_authors,
        "worst_birth_nationality_authors": worst_birth_nat_authors,
    }


@router.get("/by-year")
def by_year(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    books, book_score, *_ = _load(db, ctx, uid)

    rows = _group_stats(books, key_fn=lambda b: b.release_year, score_fn=lambda b: book_score[b.id])
    for row in rows:
        row["book_count"] = row.pop("count")
        row["year"] = row.pop("key")
    return sorted(rows, key=lambda r: r["year"])


@router.get("/by-decade")
def by_decade(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    books, book_score, *_ = _load(db, ctx, uid)

    rows = _group_stats(books, key_fn=lambda b: _decade(b.release_year), score_fn=lambda b: book_score[b.id])
    for row in rows:
        row["book_count"] = row.pop("count")
        row["decade"] = row.pop("key")
    return sorted(rows, key=lambda r: r["decade"])


@router.get("/by-nationality")
def by_nationality(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                   db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    books, book_score, _, _, book_author, _ = _load(db, ctx, uid)

    books_with_author = [b for b in books if b.id in book_author]
    result = {}
    for nat_type in ("core_nationality", "birth_nationality"):
        rows = _group_stats(
            books_with_author, key_fn=lambda b, nt=nat_type: getattr(book_author[b.id], nt),
            score_fn=lambda b: book_score[b.id],
        )
        result[nat_type] = [
            {"nationality": r["key"], "book_count": r["count"], "avg_book_score": r.get("avg_score")}
            for r in rows
        ]
    return result


@router.get("/by-genre")
def by_genre(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    books, book_score, *_ = _load(db, ctx, uid)

    book_ids = [b.id for b in books]
    rows = db.execute(
        select(book_genres.c.book_id, book_genres.c.genre_id).where(book_genres.c.book_id.in_(book_ids))
    ).all() if book_ids else []
    book_genre_ids: dict[int, list[int]] = defaultdict(list)
    for book_id, genre_id in rows:
        book_genre_ids[book_id].append(genre_id)

    genre_by_id: dict[int, Genre] = {
        g.id: g for g in db.scalars(select(Genre).where(Genre.guild_id == ctx.guild_id, Genre.is_book.is_(True))).all()
    }
    roots = _root_genre_ids(db, ctx)
    ancestors = _genre_ancestors(db)

    genre_books: dict[int, list[Book]] = defaultdict(list)
    root_genre_books: dict[int, list[Book]] = defaultdict(list)
    genre_books_direct: dict[int, list[Book]] = defaultdict(list)

    book_by_id = {b.id: b for b in books}
    for book_id, gids in book_genre_ids.items():
        b = book_by_id.get(book_id)
        if b is None:
            continue
        all_gids: set[int] = set(gids)
        for gid in gids:
            all_gids |= ancestors.get(gid, set())
        for gid in all_gids:
            genre_books[gid].append(b)
            if gid in roots:
                root_genre_books[gid].append(b)
        for gid in gids:
            genre_books_direct[gid].append(b)

    def _build(genre_bks, genre_bks_direct, candidate_gids):
        result = []
        for gid in candidate_gids:
            g = genre_by_id.get(gid)
            if g is None:
                continue
            bks = genre_bks.get(gid, [])
            result.append({
                "genre_id": gid,
                "genre_name": g.name,
                "book_count": len(bks),
                "book_count_direct": len(genre_bks_direct.get(gid, [])),
                "avg_book_score": (round(mean(book_score[b.id] for b in bks), 6) if bks else None),
            })
        return sorted(result, key=lambda r: r["genre_name"])

    return {
        "by_genre": _build(genre_books, genre_books_direct, set(genre_by_id.keys())),
        "by_root_genre": _build(root_genre_books, genre_books_direct, roots),
    }


@router.get("/scatter")
def scatter(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    """Books without a word count are left out of both plots."""
    uid = _target_user(db, ctx, user_id)
    books, book_score, _, author_books, _, person_by_id = _load(db, ctx, uid)

    book_scatter = [
        {"book_id": b.id, "name": b.name, "score": round(book_score[b.id], 6), "word_count": b.word_count}
        for b in books if b.word_count is not None
    ]

    author_scatter = []
    for pid, pairs in author_books.items():
        counted = [(b, score) for b, score in pairs if b.word_count is not None]
        if not counted:
            continue
        author_scatter.append({
            "person_id": pid, "name": person_by_id[pid].name,
            "avg_score": round(mean(score for _, score in pairs), 6),
            "avg_word_count": round(mean(b.word_count for b, _ in counted)),
        })

    return {"book_score_vs_words": book_scatter, "author_score_vs_words": author_scatter}
