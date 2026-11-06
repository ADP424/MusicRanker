"""Rankings side by side: how two members' lists compare, and what the guild
as a whole thinks.

Nothing here is stored. Both are computed from members' personal ranks, as
fractions of each list (a percentile: 1.0 is someone's #1, 0.0 their last), so
a 10-item list and a 500-item list can be compared fairly.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import (
    Artist, Book, Game, GuildMember, Movie, TelevisionShow, User, UserArtistRank, UserBookRank, UserGameRank,
    UserMovieRank, UserTelevisionShowRank,
)
from ..deps import GuildContext, guild_ctx

router = APIRouter(prefix="/guilds/{guild_id}/social", tags=["social"])
VIEW = guild_ctx(Capability.VIEW)

Vertical = Literal["artists", "books", "movies", "games", "television"]

#: vertical -> (rank table, its entity column, entity table)
_VERTICALS = {
    "artists": (UserArtistRank, UserArtistRank.artist_id, Artist),
    "books": (UserBookRank, UserBookRank.book_id, Book),
    "movies": (UserMovieRank, UserMovieRank.movie_id, Movie),
    "games": (UserGameRank, UserGameRank.game_id, Game),
    "television": (UserTelevisionShowRank, UserTelevisionShowRank.show_id, TelevisionShow),
}


class Item(BaseModel):
    id: int
    name: str
    year: int | None


class SharedItem(Item):
    mine: int  # position in my list
    theirs: int
    gap: float  # percentile difference, positive = I rank it higher


class CompareOut(BaseModel):
    me: int
    other: int
    other_name: str
    my_count: int
    their_count: int
    shared: int
    agreement: float | None  # 0..100, from Kendall's tau over shared items; None under 2 shared
    shared_items: list[SharedItem]  # by my position
    disagreements: list[SharedItem]  # largest gaps first
    only_mine: list[Item]  # best first
    only_theirs: list[Item]


class ConsensusItem(Item):
    score: float  # 0..100: mean percentile across members who ranked it
    members: int
    top_of: list[str]  # members who have it as their #1


class ConsensusOut(BaseModel):
    members: int  # with a non-empty list
    items: list[ConsensusItem]


def _positions(db: DbSession, ctx: GuildContext, vertical: str) -> dict[int, list[int]]:
    """user id -> entity ids, best first."""
    rank, col, _ = _VERTICALS[vertical]
    out: dict[int, list[int]] = defaultdict(list)
    for uid, eid in db.execute(
        select(rank.user_id, col).where(rank.guild_id == ctx.guild_id).order_by(rank.user_id, rank.rank, col)
    ).all():
        out[uid].append(eid)
    return out


def _items(db: DbSession, vertical: str, ids) -> dict[int, Item]:
    _, _, model = _VERTICALS[vertical]
    ids = list(ids)
    if not ids:
        return {}
    return {
        i: Item(id=i, name=n, year=y)
        for i, n, y in db.execute(select(model.id, model.name, model.release_year).where(model.id.in_(ids))).all()
    } if hasattr(model, "release_year") else {
        i: Item(id=i, name=n, year=None) for i, n in db.execute(select(model.id, model.name).where(model.id.in_(ids))).all()
    }


def _pct(pos: int, n: int) -> float:
    return 1.0 if n <= 1 else 1 - (pos - 1) / (n - 1)


def _inversions(seq: list[int]) -> int:
    """Discordant pairs, by merge sort: O(n log n)."""
    if len(seq) < 2:
        return 0
    mid = len(seq) // 2
    left, right = seq[:mid], seq[mid:]
    inv = _inversions(left) + _inversions(right)
    left.sort()
    right.sort()
    j = 0
    for x in left:
        while j < len(right) and right[j] < x:
            j += 1
        inv += j
    return inv


def _member_names(db: DbSession, guild_id: int) -> dict[int, str]:
    return dict(db.execute(
        select(User.id, User.username).join(GuildMember, GuildMember.user_id == User.id)
        .where(GuildMember.guild_id == guild_id)
    ).all())


@router.get("/compare", response_model=CompareOut)
def compare(
    vertical: Vertical,
    other: int,
    limit: int = Query(default=25, ge=1, le=500),
    ctx: GuildContext = Depends(VIEW),
    db: DbSession = Depends(get_database, scope="function"),
):
    names = _member_names(db, ctx.guild_id)
    if other not in names:
        raise HTTPException(404, "Not a member of this guild")
    lists = _positions(db, ctx, vertical)
    mine, theirs = lists.get(ctx.user_id, []), lists.get(other, [])
    my_pos = {e: i + 1 for i, e in enumerate(mine)}
    their_pos = {e: i + 1 for i, e in enumerate(theirs)}
    shared_ids = [e for e in mine if e in their_pos]

    agreement = None
    if len(shared_ids) >= 2:
        # Shared items in my order; how many pairs does their order flip?
        seq = [their_pos[e] for e in shared_ids]
        n = len(seq)
        tau = 1 - 4 * _inversions(seq) / (n * (n - 1))
        agreement = round((tau + 1) * 50, 1)

    info = _items(db, vertical, set(mine) | set(theirs))
    # Percentiles within the shared items, so two lists that agree on the
    # order of what they share read as agreeing, whatever else each holds.
    shared_rank_mine = {e: i + 1 for i, e in enumerate(shared_ids)}
    shared_rank_theirs = {e: i + 1 for i, e in enumerate(sorted(shared_ids, key=their_pos.get))}
    n = len(shared_ids)
    shared = [
        SharedItem(**info[e].model_dump(), mine=my_pos[e], theirs=their_pos[e],
                   gap=round(_pct(shared_rank_mine[e], n) - _pct(shared_rank_theirs[e], n), 3))
        for e in shared_ids if e in info
    ]
    return CompareOut(
        me=ctx.user_id, other=other, other_name=names[other],
        my_count=len(mine), their_count=len(theirs), shared=n, agreement=agreement,
        shared_items=shared[:limit],
        disagreements=sorted(shared, key=lambda s: -abs(s.gap))[:limit],
        only_mine=[info[e] for e in mine if e not in their_pos and e in info][:limit],
        only_theirs=[info[e] for e in theirs if e not in my_pos and e in info][:limit],
    )


@router.get("/consensus", response_model=ConsensusOut)
def consensus(
    vertical: Vertical,
    min_members: int = Query(default=1, ge=1, description="Only items at least this many members ranked"),
    limit: int = Query(default=100, ge=1, le=1000),
    ctx: GuildContext = Depends(VIEW),
    db: DbSession = Depends(get_database, scope="function"),
):
    names = _member_names(db, ctx.guild_id)
    lists = {u: l for u, l in _positions(db, ctx, vertical).items() if u in names and l}
    scores: dict[int, list[float]] = defaultdict(list)
    top_of: dict[int, list[str]] = defaultdict(list)
    for uid, ids in lists.items():
        for i, e in enumerate(ids):
            scores[e].append(_pct(i + 1, len(ids)))
        top_of[ids[0]].append(names[uid])
    ranked = sorted(
        ((e, sum(s) / len(s), len(s)) for e, s in scores.items() if len(s) >= min_members),
        # More members agreeing breaks ties: a lone #1 shouldn't top a shared favourite.
        key=lambda t: (-t[1], -t[2]),
    )[:limit]
    info = _items(db, vertical, [e for e, _, _ in ranked])
    return ConsensusOut(
        members=len(lists),
        items=[
            ConsensusItem(**info[e].model_dump(), score=round(avg * 100, 1), members=m, top_of=top_of.get(e, []))
            for e, avg, m in ranked if e in info
        ],
    )


class Holder(BaseModel):
    user_id: int
    username: str
    position: int
    of: int  # how long their list is


@router.get("/holders", response_model=list[Holder])
def holders(
    vertical: Vertical,
    id: int,
    ctx: GuildContext = Depends(VIEW),
    db: DbSession = Depends(get_database, scope="function"),
):
    """Who in the guild has this in their list, and where — best placed first."""
    names = _member_names(db, ctx.guild_id)
    out = []
    for uid, ids in _positions(db, ctx, vertical).items():
        if uid in names and id in ids:
            out.append(Holder(user_id=uid, username=names[uid], position=ids.index(id) + 1, of=len(ids)))
    # 0.0 = their #1, 1.0 = their last, so lists of different lengths compare fairly.
    return sorted(out, key=lambda h: ((h.position - 1) / max(h.of - 1, 1), h.username))
