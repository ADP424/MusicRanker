from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import (
    Album, AlbumArtist, Artist, ArtistPerson, Book, BookPerson, Game, GamePerson, Movie,
    MoviePerson, Person, TelevisionEpisode, TelevisionEpisodePerson, TelevisionShow, TelevisionShowPerson,
)
from ..deps import GuildContext, guild_ctx

router = APIRouter(prefix="/guilds/{guild_id}/persons", tags=["persons"])
VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)


class PersonIn(BaseModel):
    name: str
    name_en: str | None = None
    birth_nationality: str
    core_nationality: str
    notes: str | None = None


class PersonPatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    birth_nationality: str | None = None
    core_nationality: str | None = None
    notes: str | None = None


class PersonOut(BaseModel):
    id: int
    name: str
    name_en: str | None
    birth_nationality: str
    core_nationality: str
    notes: str | None
    artist_names: list[str] = []
    book_names: list[str] = []
    movie_names: list[str] = []
    game_names: list[str] = []
    television_names: list[str] = []


class PersonArtistDetail(BaseModel):
    id: int
    name: str
    role: str


class PersonBookRoleDetail(BaseModel):
    book_id: int
    book_name: str
    role: str


class PersonMovieRoleDetail(BaseModel):
    movie_id: int
    movie_name: str
    role: str


class PersonGameRoleDetail(BaseModel):
    game_id: int
    game_name: str
    role: str


class PersonShowRoleDetail(BaseModel):
    show_id: int
    show_name: str
    role: str


class PersonSeasonRoleDetail(BaseModel):
    show_id: int
    show_name: str
    season_id: int
    season_name: str
    role: str


class PersonEpisodeRoleDetail(BaseModel):
    show_id: int
    show_name: str
    episode_id: int
    episode_name: str
    role: str


class PersonDetailOut(PersonOut):
    artists: list[PersonArtistDetail] = []
    book_roles: list[PersonBookRoleDetail] = []
    movie_roles: list[PersonMovieRoleDetail] = []
    game_roles: list[PersonGameRoleDetail] = []
    television_roles: list[PersonShowRoleDetail] = []
    television_season_roles: list[PersonSeasonRoleDetail] = []
    television_episode_roles: list[PersonEpisodeRoleDetail] = []


# ── People graph ─────────────────────────────────────────────────────────────
# A bipartite graph: people on one side, the entries they're credited on (the
# "hubs" — artists, books, movies, games, TV shows, TV episodes) on the other,
# plus albums hanging off artists. Every
# hub with at least one credited person is included. Guild-scoped, so it never
# needs pagination — a guild's catalog is the natural size bound.
HubKind = Literal["artist", "album", "book", "movie", "game", "show", "episode"]


class GraphPerson(BaseModel):
    id: int
    name: str
    name_en: str | None
    roles: dict[HubKind, list[str]] = {}  # distinct roles per hub kind


class GraphHub(BaseModel):
    kind: HubKind
    id: int
    name: str
    show_id: int | None = None  # episodes only
    show_name: str | None = None  # episodes only


class GraphEdge(BaseModel):
    person_id: int
    kind: HubKind
    target_id: int
    roles: list[str]


class GraphAlbumArtist(BaseModel):
    # Hub-to-hub link: albums attach to artists, not people (see person_graph).
    album_id: int
    artist_id: int


class PersonGraphOut(BaseModel):
    persons: list[GraphPerson]
    hubs: list[GraphHub]
    edges: list[GraphEdge]  # person → hub (never album)
    album_artists: list[GraphAlbumArtist]


def _person(db: DbSession, ctx: GuildContext, pid: int) -> Person:
    p = db.get(Person, pid)
    if p is None or p.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")
    return p


def _tv_names(p: Person) -> list[str]:
    names, seen = [], set()
    for link in p.television_links:
        if link.show_id not in seen:
            seen.add(link.show_id)
            names.append(link.show.name)
    for show in [l.season.show for l in p.television_season_links] + [l.episode.show for l in p.television_episode_links]:
        if show.id not in seen:
            seen.add(show.id)
            names.append(show.name)
    return names


def _out(p: Person) -> PersonOut:
    return PersonOut(
        id=p.id, name=p.name, name_en=p.name_en,
        birth_nationality=p.birth_nationality, core_nationality=p.core_nationality, notes=p.notes,
        artist_names=[l.artist.name for l in p.artist_links],
        book_names=[l.book.name for l in p.book_links],
        movie_names=[l.movie.name for l in p.movie_links],
        game_names=[l.game.name for l in p.game_links],
        television_names=_tv_names(p),
    )


@router.get("", response_model=list[PersonOut])
def list_persons(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    rows = db.scalars(select(Person).where(Person.guild_id == ctx.guild_id).order_by(Person.name)).all()
    return [_out(p) for p in rows]


@router.post("", response_model=PersonOut, status_code=201)
def create_person(body: PersonIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database)):
    p = Person(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **body.model_dump())
    db.add(p)
    db.flush()
    return _out(p)


@router.get("/graph", response_model=PersonGraphOut)
def person_graph(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    gid = ctx.guild_id
    people = db.scalars(select(Person).where(Person.guild_id == gid)).all()

    # (kind, link table, link's hub-id column, hub table) — one row per vertical.
    # Each query yields (person_id, hub_id, role, hub_name) for every credit.
    sources = [
        ("artist", ArtistPerson, ArtistPerson.artist_id, Artist),
        ("book", BookPerson, BookPerson.book_id, Book),
        ("movie", MoviePerson, MoviePerson.movie_id, Movie),
        ("game", GamePerson, GamePerson.game_id, Game),
        ("show", TelevisionShowPerson, TelevisionShowPerson.show_id, TelevisionShow),
        ("episode", TelevisionEpisodePerson, TelevisionEpisodePerson.episode_id, TelevisionEpisode),
    ]

    hubs: dict[tuple[str, int], GraphHub] = {}
    edge_roles: dict[tuple[int, str, int], list[str]] = {}
    person_roles: dict[int, dict[str, list[str]]] = {}

    for kind, link, hub_col, hub in sources:
        rows = db.execute(
            select(link.person_id, hub_col, link.role, hub.name)
            .join(hub, (hub.id == hub_col) & (hub.guild_id == link.guild_id))
            .where(link.guild_id == gid)
        ).all()
        for pid, hid, role, name in rows:
            role = role.value if hasattr(role, "value") else role
            hubs.setdefault((kind, hid), GraphHub(kind=kind, id=hid, name=name))
            roles = edge_roles.setdefault((pid, kind, hid), [])
            if role not in roles:
                roles.append(role)
            kind_roles = person_roles.setdefault(pid, {}).setdefault(kind, [])
            if role not in kind_roles:
                kind_roles.append(role)

    # Albums have no person credits of their own, so they hang off artists rather
    # than people: every album credited to an artist that's on the graph (i.e.
    # has at least one person) is included, linked to each such artist. A
    # collaboration album is then what connects members of different artists.
    album_artists: list[GraphAlbumArtist] = []
    for album_id, artist_id, name in db.execute(
        select(AlbumArtist.album_id, AlbumArtist.artist_id, Album.name)
        .join(Album, (Album.id == AlbumArtist.album_id) & (Album.guild_id == AlbumArtist.guild_id))
        .where(AlbumArtist.guild_id == gid)
    ).all():
        if ("artist", artist_id) not in hubs:
            continue
        hubs.setdefault(("album", album_id), GraphHub(kind="album", id=album_id, name=name))
        album_artists.append(GraphAlbumArtist(album_id=album_id, artist_id=artist_id))

    # Episodes are labelled with their show, so fill that in for the ones in use.
    episode_ids = [hid for (kind, hid) in hubs if kind == "episode"]
    if episode_ids:
        for eid, sid, sname in db.execute(
            select(TelevisionEpisode.id, TelevisionShow.id, TelevisionShow.name)
            .join(TelevisionShow, (TelevisionShow.id == TelevisionEpisode.show_id)
                  & (TelevisionShow.guild_id == TelevisionEpisode.guild_id))
            .where(TelevisionEpisode.id.in_(episode_ids))
        ).all():
            h = hubs[("episode", eid)]
            h.show_id, h.show_name = sid, sname

    return PersonGraphOut(
        persons=[
            GraphPerson(id=p.id, name=p.name, name_en=p.name_en, roles=person_roles.get(p.id, {}))
            for p in people
        ],
        hubs=list(hubs.values()),
        edges=[
            GraphEdge(person_id=pid, kind=kind, target_id=hid, roles=roles)
            for (pid, kind, hid), roles in edge_roles.items()
        ],
        album_artists=album_artists,
    )


@router.get("/{pid}", response_model=PersonOut)
def get_person(pid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return _out(_person(db, ctx, pid))


@router.get("/{pid}/detail", response_model=PersonDetailOut)
def get_person_detail(pid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    p = _person(db, ctx, pid)
    base = _out(p)
    return PersonDetailOut(
        **base.model_dump(),
        artists=[
            PersonArtistDetail(id=l.artist.id, name=l.artist.name, role=l.role.value if hasattr(l.role, "value") else l.role)
            for l in p.artist_links
        ],
        book_roles=[
            PersonBookRoleDetail(book_id=l.book.id, book_name=l.book.name,
                                 role=l.role.value if hasattr(l.role, "value") else l.role)
            for l in p.book_links
        ],
        movie_roles=[
            PersonMovieRoleDetail(movie_id=l.movie.id, movie_name=l.movie.name,
                                  role=l.role.value if hasattr(l.role, "value") else l.role)
            for l in p.movie_links
        ],
        game_roles=[
            PersonGameRoleDetail(game_id=l.game.id, game_name=l.game.name,
                                 role=l.role.value if hasattr(l.role, "value") else l.role)
            for l in p.game_links
        ],
        television_roles=[
            PersonShowRoleDetail(show_id=l.show.id, show_name=l.show.name,
                                 role=l.role.value if hasattr(l.role, "value") else l.role)
            for l in p.television_links
        ],
        television_season_roles=[
            PersonSeasonRoleDetail(show_id=l.season.show.id, show_name=l.season.show.name,
                                   season_id=l.season.id, season_name=l.season.name,
                                   role=l.role.value if hasattr(l.role, "value") else l.role)
            for l in p.television_season_links
        ],
        television_episode_roles=[
            PersonEpisodeRoleDetail(show_id=l.episode.show.id, show_name=l.episode.show.name,
                                    episode_id=l.episode.id, episode_name=l.episode.name,
                                    role=l.role.value if hasattr(l.role, "value") else l.role)
            for l in p.television_episode_links
        ],
    )


@router.patch("/{pid}", response_model=PersonOut)
def update_person(pid: int, body: PersonPatch, ctx: GuildContext = Depends(EDIT),
                  db: DbSession = Depends(get_database)):
    p = _person(db, ctx, pid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    p.updated_by_user_id = ctx.user_id
    return _out(p)


@router.delete("/{pid}", status_code=204)
def delete_person(pid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database)):
    db.delete(_person(db, ctx, pid))
