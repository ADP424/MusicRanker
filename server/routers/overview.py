"""The guild home page: per-section counts, and the activity feed (catalog
additions and members adding things to their lists)."""
from __future__ import annotations

from datetime import datetime, timedelta

from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, literal, select, union_all
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import (
    Album, Artist, Book, Game, GuildMember, Movie, Person, TelevisionEpisode, TelevisionShow, User, UserAlbumRank,
    UserArtistRank, UserBookRank, UserGameRank, UserMovieRank, UserTelevisionEpisodeRank, UserTelevisionShowRank,
)
from ..deps import GuildContext, guild_ctx

router = APIRouter(prefix="/guilds/{guild_id}/overview", tags=["overview"])
VIEW = guild_ctx(Capability.VIEW)

#: section -> (catalog model, my-list rank model, frontend path for an item, the rank's entity column)
_SECTIONS = {
    "music": (Artist, UserArtistRank, "music/artists", UserArtistRank.artist_id),
    "books": (Book, UserBookRank, "books", UserBookRank.book_id),
    "movies": (Movie, UserMovieRank, "movies", UserMovieRank.movie_id),
    "television": (TelevisionShow, UserTelevisionShowRank, "television/shows", UserTelevisionShowRank.show_id),
    "games": (Game, UserGameRank, "games", UserGameRank.game_id),
}


class SectionCounts(BaseModel):
    catalog: int
    mine: int


class OverviewOut(BaseModel):
    sections: dict[str, SectionCounts]
    people: int
    members: int


@router.get("", response_model=OverviewOut)
def overview(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    g = ctx.guild_id
    sections = {}
    for key, (model, rank, _, _) in _SECTIONS.items():
        catalog = db.scalar(select(func.count()).select_from(model).where(model.guild_id == g))
        mine = db.scalar(select(func.count()).select_from(rank).where(rank.guild_id == g, rank.user_id == ctx.user_id))
        sections[key] = SectionCounts(catalog=catalog, mine=mine)

    return OverviewOut(
        sections=sections,
        people=db.scalar(select(func.count()).select_from(Person).where(Person.guild_id == g)),
        members=db.scalar(select(func.count()).select_from(GuildMember).where(GuildMember.guild_id == g)),
    )


class TopTitle(BaseModel):
    id: int
    name: str
    holders: int


class SectionStats(BaseModel):
    catalog: int
    in_any_list: int
    mine: int
    path: str
    top: list[TopTitle]  # most members have it


class MemberStats(BaseModel):
    user_id: int
    username: str
    counts: dict[str, int]


class MyTime(BaseModel):
    movie_minutes: int
    episode_minutes: int
    album_minutes: int
    game_hours: float
    book_words: int


class GuildStatsOut(BaseModel):
    sections: dict[str, SectionStats]
    members: list[MemberStats]
    me: MyTime


@router.get("/stats", response_model=GuildStatsOut)
def guild_stats(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    """The whole guild at a glance, across every medium, and what the caller's lists add up to."""
    g = ctx.guild_id
    names = dict(db.execute(
        select(User.id, User.username).join(GuildMember, GuildMember.user_id == User.id).where(GuildMember.guild_id == g)
    ).tuples().all())
    counts: dict[int, dict[str, int]] = {uid: {} for uid in names}
    sections = {}
    for key, (model, rank, path, col) in _SECTIONS.items():
        members = rank.user_id.in_(names.keys())
        holders = func.count(rank.user_id).label("holders")
        top = db.execute(
            select(model.id, model.name, holders).join(rank, col == model.id)
            .where(rank.guild_id == g, members).group_by(model.id, model.name)
            .order_by(holders.desc(), model.name).limit(5)
        ).all()
        for uid, n in db.execute(
            select(rank.user_id, func.count()).where(rank.guild_id == g, members).group_by(rank.user_id)
        ).tuples():
            counts[uid][key] = n
        sections[key] = SectionStats(
            catalog=db.scalar(select(func.count()).select_from(model).where(model.guild_id == g)),
            in_any_list=db.scalar(select(func.count(func.distinct(col))).where(rank.guild_id == g, members)),
            mine=counts.get(ctx.user_id, {}).get(key, 0),
            path=path,
            top=[TopTitle(id=i, name=n, holders=h) for i, n, h in top],
        )

    u = ctx.user_id
    me = MyTime(
        movie_minutes=db.scalar(
            select(func.coalesce(func.sum(Movie.runtime_minutes * UserMovieRank.watches), 0))
            .join(UserMovieRank, UserMovieRank.movie_id == Movie.id)
            .where(UserMovieRank.guild_id == g, UserMovieRank.user_id == u)
        ),
        episode_minutes=db.scalar(
            select(func.coalesce(func.sum(TelevisionEpisode.runtime_minutes * UserTelevisionEpisodeRank.watches), 0))
            .join(UserTelevisionEpisodeRank, UserTelevisionEpisodeRank.episode_id == TelevisionEpisode.id)
            .where(UserTelevisionEpisodeRank.guild_id == g, UserTelevisionEpisodeRank.user_id == u)
        ),
        # An album can be ranked under several artists: count it once.
        album_minutes=int((db.scalar(
            select(func.coalesce(func.sum(Album.runtime), timedelta(0))).where(Album.id.in_(
                select(UserAlbumRank.album_id).where(UserAlbumRank.guild_id == g, UserAlbumRank.user_id == u)
            ))
        ) or timedelta(0)).total_seconds() // 60),
        game_hours=float(db.scalar(
            select(func.coalesce(func.sum(UserGameRank.hours_played), 0))
            .where(UserGameRank.guild_id == g, UserGameRank.user_id == u)
        )),
        book_words=db.scalar(
            select(func.coalesce(func.sum(Book.word_count * UserBookRank.reads), 0))
            .join(UserBookRank, UserBookRank.book_id == Book.id)
            .where(UserBookRank.guild_id == g, UserBookRank.user_id == u)
        ),
    )
    return GuildStatsOut(
        sections=sections,
        members=sorted(
            (MemberStats(user_id=uid, username=names[uid], counts=c) for uid, c in counts.items()),
            key=lambda m: (-sum(m.counts.values()), m.username),
        ),
        me=me,
    )


@router.get("/list-counts/{section}", response_model=dict[int, int])
def list_counts(section: Literal["music", "books", "movies", "television", "games"], ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    """How many current members have each title in their list, for "most popular" sorting."""
    _, rank, _, col = _SECTIONS[section]
    return dict(db.execute(
        select(col, func.count()).where(
            rank.guild_id == ctx.guild_id,
            rank.user_id.in_(select(GuildMember.user_id).where(GuildMember.guild_id == ctx.guild_id)),
        ).group_by(col)
    ).tuples().all())


class ActivityItem(BaseModel):
    kind: Literal["catalog", "list"]  # added to the catalog / added to someone's list
    section: str
    path: str
    id: int
    name: str
    at: datetime
    user_id: int | None
    username: str | None


class ActivityOut(BaseModel):
    items: list[ActivityItem]
    next_before: datetime | None  # pass back as `before` for the next page


@router.get("/activity", response_model=ActivityOut)
def activity(
    kind: Literal["all", "catalog", "list"] = "all",
    before: datetime | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    ctx: GuildContext = Depends(VIEW),
    db: DbSession = Depends(get_database, scope="function"),
):
    """Newest first. List additions only for current members, and never notes or
    positions — only that it went in. Rows from before tracking began have no
    timestamp and don't appear."""
    g = ctx.guild_id
    parts = []
    for key, (model, rank, path, col) in _SECTIONS.items():
        if kind in ("all", "catalog"):
            parts.append(select(
                literal("catalog").label("kind"), literal(key).label("section"), literal(path).label("path"),
                model.id.label("id"), model.name.label("name"), model.created_at.label("at"),
                model.created_by_user_id.label("uid"),
            ).where(model.guild_id == g))
        if kind in ("all", "list"):
            parts.append(select(
                literal("list").label("kind"), literal(key).label("section"), literal(path).label("path"),
                model.id.label("id"), model.name.label("name"), rank.added_at.label("at"), rank.user_id.label("uid"),
            ).join(model, model.id == col).where(
                rank.guild_id == g, rank.added_at.is_not(None),
                rank.user_id.in_(select(GuildMember.user_id).where(GuildMember.guild_id == g)),
            ))
    feed = union_all(*parts).subquery()
    q = select(feed, User.username).outerjoin(User, User.id == feed.c.uid)
    if before is not None:
        q = q.where(feed.c.at < before)
    rows = db.execute(q.order_by(feed.c.at.desc()).limit(limit + 1)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    return ActivityOut(
        items=[
            ActivityItem(kind=r.kind, section=r.section, path=r.path, id=r.id, name=r.name, at=r.at,
                         user_id=r.uid, username=r.username)
            for r in rows
        ],
        next_before=rows[-1].at if more and rows else None,
    )
