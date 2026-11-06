"""What's in a genre (or a platform): the titles tagged with it or with any
genre beneath it, each with where it sits in your own list.

One route for every taxonomy, keyed by the same domain names the genre pages
use ("movie-genres", "game-platforms"...).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import (
    Album, AlbumArtist, Artist, Book, Game, GamePlatform, Genre, Movie, TelevisionShow, UserAlbumRank, UserBookRank,
    UserGameRank, UserMovieRank, UserTelevisionShowRank,
)
from ..database_models.genre_parent import genre_parents
from ..database_models.junctions import (
    album_genres, book_genres, game_genres_junction, game_platform_parents, game_platforms_junction,
    movie_genres_junction, television_show_genres_junction,
)
from ..deps import GuildContext, guild_ctx

router = APIRouter(prefix="/guilds/{guild_id}/taxonomy-items", tags=["genres"])
VIEW = guild_ctx(Capability.VIEW)

Domain = Literal["genres", "movie-genres", "game-genres", "television-genres", "book-genres", "game-platforms"]

#: domain -> (taxonomy model, its parent table + columns, entity, tag table + columns, rank model + column)
_DOMAINS = {
    "genres": (Genre, (genre_parents, "genre_id", "parent_genre_id"), Album, (album_genres, "album_id", "genre_id"),
               UserAlbumRank, "album_id"),
    "movie-genres": (Genre, (genre_parents, "genre_id", "parent_genre_id"), Movie,
                     (movie_genres_junction, "movie_id", "genre_id"), UserMovieRank, "movie_id"),
    "game-genres": (Genre, (genre_parents, "genre_id", "parent_genre_id"), Game,
                    (game_genres_junction, "game_id", "genre_id"), UserGameRank, "game_id"),
    "television-genres": (Genre, (genre_parents, "genre_id", "parent_genre_id"), TelevisionShow,
                          (television_show_genres_junction, "show_id", "genre_id"), UserTelevisionShowRank, "show_id"),
    "book-genres": (Genre, (genre_parents, "genre_id", "parent_genre_id"), Book, (book_genres, "book_id", "genre_id"),
                    UserBookRank, "book_id"),
    "game-platforms": (GamePlatform, (game_platform_parents, "platform_id", "parent_platform_id"), Game,
                       (game_platforms_junction, "game_id", "platform_id"), UserGameRank, "game_id"),
}


class TaggedItem(BaseModel):
    id: int
    name: str
    name_en: str | None
    year: int | None
    context: str | None = None  # an album's artists
    in_my_list: bool
    my_position: int | None = None  # albums rank within their artist, so they have none here
    direct: bool  # tagged with this genre itself, not only a sub-genre


class TaggedOut(BaseModel):
    sub_genres: int  # how many genres beneath this one were included
    items: list[TaggedItem]


@router.get("/{domain}/{gid}", response_model=TaggedOut)
def tagged_items(domain: Domain, gid: int, ctx: GuildContext = Depends(VIEW),
                 db: DbSession = Depends(get_database, scope="function")):
    taxon, (parents, child_col, parent_col), entity, (tags, entity_col, taxon_col), rank, rank_col = _DOMAINS[domain]
    found = db.get(taxon, gid)
    if found is None or found.guild_id != ctx.guild_id:
        raise HTTPException(404, "Not found")

    # This genre and everything beneath it (the graph may have cycles).
    children: dict[int, set[int]] = defaultdict(set)
    for child, parent in db.execute(
        select(parents.c[child_col], parents.c[parent_col]).where(parents.c.guild_id == ctx.guild_id)
    ).all():
        children[parent].add(child)
    scope, queue = {gid}, [gid]
    while queue:
        for c in children.get(queue.pop(), ()):
            if c not in scope:
                scope.add(c)
                queue.append(c)

    direct = set(db.scalars(select(tags.c[entity_col]).where(tags.c[taxon_col] == gid, tags.c.guild_id == ctx.guild_id)))
    ids = set(db.scalars(
        select(tags.c[entity_col]).where(tags.c[taxon_col].in_(scope), tags.c.guild_id == ctx.guild_id)
    ))
    if not ids:
        return TaggedOut(sub_genres=len(scope) - 1, items=[])

    rcol = getattr(rank, rank_col)
    mine = list(db.scalars(
        select(rcol).where(rank.user_id == ctx.user_id, rank.guild_id == ctx.guild_id).order_by(rank.rank, rcol)
    ))
    in_list = set(mine)
    position = {} if rank is UserAlbumRank else {e: i + 1 for i, e in enumerate(mine)}

    context: dict[int, str] = {}
    if entity is Album:
        for album_id, artist in db.execute(
            select(AlbumArtist.album_id, Artist.name).join(Artist, Artist.id == AlbumArtist.artist_id)
            .where(AlbumArtist.album_id.in_(ids)).order_by(Artist.name)
        ).all():
            context[album_id] = f"{context[album_id]}, {artist}" if album_id in context else artist

    rows = db.execute(
        select(entity.id, entity.name, entity.name_en, entity.release_year).where(entity.id.in_(ids))
    ).all()
    items = [
        TaggedItem(id=i, name=n, name_en=ne, year=y, context=context.get(i), in_my_list=i in in_list,
                   my_position=position.get(i), direct=i in direct)
        for i, n, ne, y in rows
    ]
    # Your ranked ones first, in your order; then the rest, newest first.
    items.sort(key=lambda t: (t.my_position is None and not t.in_my_list, t.my_position or 0, -(t.year or 0), t.name))
    return TaggedOut(sub_genres=len(scope) - 1, items=items)
