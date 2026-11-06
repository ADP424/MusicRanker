"""Search across everything in a guild, for the command palette and pickers.

Matches on the normalised names (`name_norm` / `name_en_norm`), so accents and
case don't matter, and ranks prefix matches above substring ones. A guild's
catalog is thousands of rows, not millions: a substring scan per table is fast
enough without a trigram index.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import case, func, literal, or_, select
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import (
    Album, AlbumArtist, Artist, Book, Game, Genre, Movie, Person, TelevisionEpisode, TelevisionSeason, TelevisionShow,
)
from ..deps import GuildContext, guild_ctx
from ..normalize import norm

router = APIRouter(prefix="/guilds/{guild_id}/search", tags=["search"])
VIEW = guild_ctx(Capability.VIEW)

Kind = Literal["artist", "album", "book", "movie", "game", "show", "season", "episode", "person", "genre"]
KINDS: tuple[str, ...] = Kind.__args__  # type: ignore[attr-defined]


class SearchHit(BaseModel):
    kind: Kind
    id: int
    name: str
    name_en: str | None
    year: int | None
    context: str | None  # the show of a season/episode, the artist of an album, a genre's media


def _year(model):
    return model.release_year if hasattr(model, "release_year") else literal(None)


_GENRE_MEDIA = (("is_music", "music"), ("is_book", "books"), ("is_movie", "movies"),
                ("is_television", "TV"), ("is_game", "games"))


@router.get("", response_model=list[SearchHit])
def search(
    q: str = Query(min_length=1, max_length=100),
    kinds: list[Kind] | None = Query(default=None, description="Limit to these kinds"),
    limit: int = Query(default=8, ge=1, le=50, description="Per kind"),
    ctx: GuildContext = Depends(VIEW),
    db: DbSession = Depends(get_database, scope="function"),
):
    needle = norm(q)
    if not needle:
        return []
    wanted = set(kinds or KINDS)
    sources = [
        ("artist", Artist), ("album", Album), ("book", Book), ("movie", Movie), ("game", Game),
        ("show", TelevisionShow), ("season", TelevisionSeason), ("episode", TelevisionEpisode),
        ("person", Person), ("genre", Genre),
    ]
    hits: list[SearchHit] = []
    for kind, model in sources:
        if kind not in wanted:
            continue
        match = or_(model.name_norm.contains(needle, autoescape=True),
                    model.name_en_norm.contains(needle, autoescape=True))
        prefix = or_(model.name_norm.startswith(needle, autoescape=True),
                     model.name_en_norm.startswith(needle, autoescape=True))
        rows = db.execute(
            select(model.id, model.name, model.name_en, _year(model))
            .where(model.guild_id == ctx.guild_id, match)
            .order_by(case((prefix, 0), else_=1), func.length(model.name), model.name)
            .limit(limit)
        ).all()
        context = _contexts(db, kind, [r[0] for r in rows])
        hits += [SearchHit(kind=kind, id=i, name=n, name_en=ne, year=y, context=context.get(i)) for i, n, ne, y in rows]
    return hits


def _contexts(db: DbSession, kind: str, ids: list[int]) -> dict[int, str]:
    """One query per kind for the line under a hit: what it belongs to."""
    if not ids:
        return {}
    if kind in ("season", "episode"):
        model = TelevisionSeason if kind == "season" else TelevisionEpisode
        return dict(db.execute(
            select(model.id, TelevisionShow.name).join(TelevisionShow, TelevisionShow.id == model.show_id)
            .where(model.id.in_(ids))
        ).all())
    if kind == "album":
        out: dict[int, str] = {}
        for album_id, artist in db.execute(
            select(AlbumArtist.album_id, Artist.name).join(Artist, Artist.id == AlbumArtist.artist_id)
            .where(AlbumArtist.album_id.in_(ids)).order_by(Artist.name)
        ).all():
            out[album_id] = f"{out[album_id]}, {artist}" if album_id in out else artist
        return out
    if kind == "genre":
        out = {}
        for g in db.scalars(select(Genre).where(Genre.id.in_(ids))):
            out[g.id] = ", ".join(label for flag, label in _GENRE_MEDIA if getattr(g, flag))
        return out
    return {}
