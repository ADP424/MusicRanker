from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import Artist, Movie, MoviePerson, Person
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
    movie_names: list[str] = []
    game_names: list[str] = []
    television_names: list[str] = []


class PersonArtistDetail(BaseModel):
    id: int
    name: str
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


class PersonEpisodeRoleDetail(BaseModel):
    show_id: int
    show_name: str
    episode_id: int
    episode_name: str
    role: str


class PersonDetailOut(PersonOut):
    artists: list[PersonArtistDetail] = []
    movie_roles: list[PersonMovieRoleDetail] = []
    game_roles: list[PersonGameRoleDetail] = []
    television_roles: list[PersonShowRoleDetail] = []
    television_episode_roles: list[PersonEpisodeRoleDetail] = []


# ── People graph ─────────────────────────────────────────────────────────────
# A bipartite graph: people on one side, movies/artists (the "hubs" they share)
# on the other. Guild-scoped, so unlike the old cross-catalog version this
# never needs pagination — a guild's catalog is the natural size bound.
class GraphPerson(BaseModel):
    id: int
    name: str
    name_en: str | None
    artist_ids: list[int] = []
    movie_roles: list[str] = []


class GraphMovie(BaseModel):
    id: int
    name: str


class GraphArtist(BaseModel):
    id: int
    name: str


class GraphEdge(BaseModel):
    person_id: int
    target_type: Literal["movie", "artist"]
    target_id: int


class PersonGraphOut(BaseModel):
    persons: list[GraphPerson]
    movies: list[GraphMovie]
    artists: list[GraphArtist]
    edges: list[GraphEdge]


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
    for link in p.television_episode_links:
        show = link.episode.show
        if show.id not in seen:
            seen.add(show.id)
            names.append(show.name)
    return names


def _out(p: Person) -> PersonOut:
    return PersonOut(
        id=p.id, name=p.name, name_en=p.name_en,
        birth_nationality=p.birth_nationality, core_nationality=p.core_nationality, notes=p.notes,
        artist_names=[l.artist.name for l in p.artist_links],
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
    people = db.scalars(select(Person).where(Person.guild_id == ctx.guild_id)).all()
    movie_links = db.scalars(select(MoviePerson).where(MoviePerson.guild_id == ctx.guild_id)).all()
    artists = db.scalars(select(Artist).where(Artist.guild_id == ctx.guild_id)).all()

    movie_ids_by_person: dict[int, set[int]] = {}
    roles_by_person: dict[int, list[str]] = {}
    for link in movie_links:
        movie_ids_by_person.setdefault(link.person_id, set()).add(link.movie_id)
        roles_by_person.setdefault(link.person_id, []).append(
            link.role.value if hasattr(link.role, "value") else link.role
        )

    artist_ids_by_person: dict[int, set[int]] = {}
    for artist in artists:
        for link in artist.person_links:
            artist_ids_by_person.setdefault(link.person_id, set()).add(artist.id)

    persons_out = [
        GraphPerson(
            id=p.id, name=p.name, name_en=p.name_en,
            artist_ids=sorted(artist_ids_by_person.get(p.id, set())),
            movie_roles=roles_by_person.get(p.id, []),
        )
        for p in people
    ]

    movie_ids = {mid for ids in movie_ids_by_person.values() for mid in ids}
    movies_out = [
        GraphMovie(id=m.id, name=m.name)
        for m in (db.scalars(select(Movie).where(Movie.id.in_(movie_ids))).all() if movie_ids else [])
    ]
    used_artist_ids = {aid for ids in artist_ids_by_person.values() for aid in ids}
    artists_out = [GraphArtist(id=a.id, name=a.name) for a in artists if a.id in used_artist_ids]

    edges: list[GraphEdge] = []
    for pid, mids in movie_ids_by_person.items():
        for mid in mids:
            edges.append(GraphEdge(person_id=pid, target_type="movie", target_id=mid))
    for pid, aids in artist_ids_by_person.items():
        for aid in aids:
            edges.append(GraphEdge(person_id=pid, target_type="artist", target_id=aid))

    return PersonGraphOut(persons=persons_out, movies=movies_out, artists=artists_out, edges=edges)


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
