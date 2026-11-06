from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete, func, literal, select, update as sa_update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import (
    Album, AlbumArtist, Artist, ArtistPerson, Book, BookPerson, Game, GamePerson, Movie,
    MoviePerson, Person, TelevisionEpisode, TelevisionEpisodePerson, TelevisionSeason, TelevisionSeasonPerson,
    TelevisionShow, TelevisionShowPerson, UserAlbumRank, UserArtistRank, UserBookRank, UserGameRank, UserMovieRank,
    UserTelevisionEpisodeRank, UserTelevisionSeasonRank, UserTelevisionShowRank,
)
from ..database_models.junctions import (
    album_game_soundtrack, album_movie_soundtrack, album_television_show_soundtrack, book_game_adaptations,
    book_movie_adaptations, book_television_show_adaptations,
)
from .. import loading
from ..deps import GuildContext, guild_ctx

router = APIRouter(prefix="/guilds/{guild_id}/persons", tags=["persons"])
VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)


class PersonIn(BaseModel):
    name: str
    name_en: str | None = None
    birth_nationality: str = "Unknown"  # the other one is copied in when only one is given
    core_nationality: str = "Unknown"
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
    tmdb_id: int | None = None
    igdb_id: int | None = None
    image_url: str | None = None
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
# People on one side, the entries they're credited on (the "hubs" — artists,
# books, movies, games, TV shows, seasons, episodes) on the other. Hubs also
# link to each other: albums hang off artists, episodes off seasons off shows,
# and adaptations / soundtracks join different media. Guild-scoped, so it never
# needs pagination — a guild's catalog is the natural size bound.
HubKind = Literal["artist", "album", "book", "movie", "game", "show", "season", "episode"]
HubRelation = Literal["album_artist", "season_show", "episode_season", "adaptation", "soundtrack"]


class GraphPerson(BaseModel):
    id: int
    name: str
    name_en: str | None
    roles: dict[HubKind, list[str]] = {}  # distinct roles per hub kind


class GraphHub(BaseModel):
    kind: HubKind
    id: int
    name: str
    show_id: int | None = None  # seasons and episodes
    show_name: str | None = None  # seasons and episodes
    season_number: int | None = None  # seasons and episodes


class GraphEdge(BaseModel):
    person_id: int
    kind: HubKind
    target_id: int
    roles: list[str]
    # Roles the person already holds on this season's show / episode's season
    # or show — populate-down repeats. The page hides them unless asked, so a
    # show's cast is one edge to the show rather than one per episode.
    inherited: list[str] = []


class GraphHubLink(BaseModel):
    relation: HubRelation
    from_kind: HubKind
    from_id: int
    to_kind: HubKind
    to_id: int


class GraphMine(BaseModel):
    kind: HubKind
    id: int


class PersonGraphOut(BaseModel):
    #: Everything in the caller's own lists, for the "only what I've ranked" focus.
    mine: list[GraphMine] = []
    persons: list[GraphPerson]
    hubs: list[GraphHub]
    edges: list[GraphEdge]  # person → hub (never album)
    hub_links: list[GraphHubLink]


def _person(db: DbSession, ctx: GuildContext, pid: int) -> Person:
    p = loading.get(db, Person, pid, loading.PERSON)
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
        tmdb_id=p.tmdb_id, igdb_id=p.igdb_id, image_url=p.image_url,
        artist_names=[l.artist.name for l in p.artist_links],
        book_names=[l.book.name for l in p.book_links],
        movie_names=[l.movie.name for l in p.movie_links],
        game_names=[l.game.name for l in p.game_links],
        television_names=_tv_names(p),
    )


@router.get("", response_model=list[PersonOut])
def list_persons(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    rows = db.scalars(
        select(Person).where(Person.guild_id == ctx.guild_id).order_by(Person.name).options(*loading.PERSON)
    ).all()
    return [_out(p) for p in rows]


@router.post("", response_model=PersonOut, status_code=201)
def create_person(body: PersonIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database, scope="function")):
    p = Person(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **body.model_dump())
    db.add(p)
    db.flush()
    return _out(p)


def _my_hubs(db: DbSession, ctx: GuildContext) -> list[GraphMine]:
    out = []
    for kind, rank, col in (
        ("artist", UserArtistRank, UserArtistRank.artist_id), ("album", UserAlbumRank, UserAlbumRank.album_id),
        ("book", UserBookRank, UserBookRank.book_id), ("movie", UserMovieRank, UserMovieRank.movie_id),
        ("game", UserGameRank, UserGameRank.game_id), ("show", UserTelevisionShowRank, UserTelevisionShowRank.show_id),
        ("season", UserTelevisionSeasonRank, UserTelevisionSeasonRank.season_id),
        ("episode", UserTelevisionEpisodeRank, UserTelevisionEpisodeRank.episode_id),
    ):
        ids = db.scalars(select(col).distinct().where(rank.guild_id == ctx.guild_id, rank.user_id == ctx.user_id))
        out += [GraphMine(kind=kind, id=i) for i in ids]
    return out


@router.get("/graph", response_model=PersonGraphOut)
def person_graph(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
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
        ("season", TelevisionSeasonPerson, TelevisionSeasonPerson.season_id, TelevisionSeason),
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

    hub_links: list[GraphHubLink] = []

    def link(relation: str, from_kind: str, from_id: int, to_kind: str, to_id: int) -> None:
        hub_links.append(GraphHubLink(relation=relation, from_kind=from_kind, from_id=from_id,
                                      to_kind=to_kind, to_id=to_id))

    # Albums have no person credits of their own, so they hang off artists rather
    # than people: every album credited to an artist that's on the graph (i.e.
    # has at least one person) is included, linked to each such artist. A
    # collaboration album is then what connects members of different artists.
    for album_id, artist_id, name in db.execute(
        select(AlbumArtist.album_id, AlbumArtist.artist_id, Album.name)
        .join(Album, (Album.id == AlbumArtist.album_id) & (Album.guild_id == AlbumArtist.guild_id))
        .where(AlbumArtist.guild_id == gid)
    ).all():
        if ("artist", artist_id) not in hubs:
            continue
        hubs.setdefault(("album", album_id), GraphHub(kind="album", id=album_id, name=name))
        link("album_artist", "album", album_id, "artist", artist_id)

    # The TV tree: every credited episode hangs off its season, every season off
    # its show, adding the parent hubs where nobody is credited on them directly.
    episode_ids = [hid for (kind, hid) in hubs if kind == "episode"]
    episode_parent: dict[int, tuple[int, int]] = {}  # episode -> (show, season)
    if episode_ids:
        for eid, sid, season_id in db.execute(
            select(TelevisionEpisode.id, TelevisionEpisode.show_id, TelevisionEpisode.season_id)
            .where(TelevisionEpisode.guild_id == gid, TelevisionEpisode.id.in_(episode_ids))
        ).all():
            episode_parent[eid] = (sid, season_id)
    season_ids = {hid for (kind, hid) in hubs if kind == "season"} | {s for _, s in episode_parent.values()}
    season_info: dict[int, tuple[int, str, int | None]] = {}  # season -> (show, name, number)
    if season_ids:
        for season_id, sid, name, number in db.execute(
            select(TelevisionSeason.id, TelevisionSeason.show_id, TelevisionSeason.name, TelevisionSeason.season_number)
            .where(TelevisionSeason.guild_id == gid, TelevisionSeason.id.in_(season_ids))
        ).all():
            season_info[season_id] = (sid, name, number)
    show_ids = {hid for (kind, hid) in hubs if kind == "show"} | {sid for sid, _, _ in season_info.values()}
    show_names = dict(db.execute(
        select(TelevisionShow.id, TelevisionShow.name)
        .where(TelevisionShow.guild_id == gid, TelevisionShow.id.in_(show_ids))
    ).all()) if show_ids else {}

    for sid, name in show_names.items():
        hubs.setdefault(("show", sid), GraphHub(kind="show", id=sid, name=name))
    for season_id, (sid, name, number) in season_info.items():
        h = hubs.setdefault(("season", season_id), GraphHub(kind="season", id=season_id, name=name))
        h.show_id, h.show_name, h.season_number = sid, show_names.get(sid), number
        link("season_show", "season", season_id, "show", sid)
    for eid, (sid, season_id) in episode_parent.items():
        h = hubs[("episode", eid)]
        h.show_id, h.show_name = sid, show_names.get(sid)
        h.season_number = season_info.get(season_id, (None, None, None))[2]
        link("episode_season", "episode", eid, "season", season_id)

    # Cross-media links, only between hubs that are already on the graph.
    cross = [
        ("adaptation", book_movie_adaptations, "book", "book_id", "movie", "movie_id"),
        ("adaptation", book_game_adaptations, "book", "book_id", "game", "game_id"),
        ("adaptation", book_television_show_adaptations, "book", "book_id", "show", "show_id"),
        ("soundtrack", album_movie_soundtrack, "album", "album_id", "movie", "movie_id"),
        ("soundtrack", album_game_soundtrack, "album", "album_id", "game", "game_id"),
        ("soundtrack", album_television_show_soundtrack, "album", "album_id", "show", "show_id"),
    ]
    for relation, table, from_kind, from_col, to_kind, to_col in cross:
        for a, b in db.execute(select(table.c[from_col], table.c[to_col]).where(table.c.guild_id == gid)).all():
            if (from_kind, a) in hubs and (to_kind, b) in hubs:
                link(relation, from_kind, a, to_kind, b)

    # What each person already holds higher up the tree, for `inherited`.
    held: dict[tuple[int, str, int], set[str]] = {
        key: set(roles) for key, roles in edge_roles.items() if key[1] in ("show", "season")
    }

    def inherited(pid: int, kind: str, hid: int, roles: list[str]) -> list[str]:
        if kind == "season" and hid in season_info:
            above = held.get((pid, "show", season_info[hid][0]), set())
        elif kind == "episode" and hid in episode_parent:
            sid, season_id = episode_parent[hid]
            above = held.get((pid, "show", sid), set()) | held.get((pid, "season", season_id), set())
        else:
            return []
        return [r for r in roles if r in above]

    return PersonGraphOut(mine=_my_hubs(db, ctx), 
        persons=[
            GraphPerson(id=p.id, name=p.name, name_en=p.name_en, roles=person_roles.get(p.id, {}))
            for p in people
        ],
        hubs=list(hubs.values()),
        edges=[
            GraphEdge(person_id=pid, kind=kind, target_id=hid, roles=roles,
                      inherited=inherited(pid, kind, hid, roles))
            for (pid, kind, hid), roles in edge_roles.items()
        ],
        hub_links=hub_links,
    )


@router.get("/{pid}", response_model=PersonOut)
def get_person(pid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    return _out(_person(db, ctx, pid))


@router.get("/{pid}/detail", response_model=PersonDetailOut)
def get_person_detail(pid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
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
                  db: DbSession = Depends(get_database, scope="function")):
    p = _person(db, ctx, pid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    p.updated_by_user_id = ctx.user_id
    db.flush()  # runs the before-flush hook (a lone Unknown nationality takes the other)
    return _out(p)


@router.delete("/{pid}", status_code=204)
def delete_person(pid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database, scope="function")):
    db.delete(_person(db, ctx, pid))


# ── Merging duplicates ───────────────────────────────────────────────────────
class MergeIn(BaseModel):
    duplicate_id: int  # merged into the person in the path, then deleted


class MergeOut(BaseModel):
    moved: int  # credits re-pointed to the kept person
    already_had: int  # credits the kept person already held, dropped with the duplicate


#: Every table that credits a person: (table, its entity column).
_CREDIT_TABLES = (
    (ArtistPerson, "artist_id"), (BookPerson, "book_id"), (MoviePerson, "movie_id"), (GamePerson, "game_id"),
    (TelevisionShowPerson, "show_id"), (TelevisionSeasonPerson, "season_id"),
    (TelevisionEpisodePerson, "episode_id"),
)


@router.post("/{pid}/merge", response_model=MergeOut)
def merge_person(pid: int, body: MergeIn, ctx: GuildContext = Depends(EDIT),
                 db: DbSession = Depends(get_database, scope="function")):
    """Folds a duplicate into this person: every credit moves over (a credit
    both already hold is kept once), blank fields are filled from the
    duplicate, and the duplicate is deleted."""
    if body.duplicate_id == pid:
        raise HTTPException(422, "That's the same person.")
    keep, dup = _person(db, ctx, pid), _person(db, ctx, body.duplicate_id)
    moved = already = 0
    for model, col in _CREDIT_TABLES:
        t = model.__table__
        total = db.scalar(select(func.count()).select_from(t).where(t.c.person_id == dup.id)) or 0
        if not total:
            continue
        moved += len(db.execute(
            pg_insert(t).from_select(
                [col, "person_id", "role", "guild_id"],
                select(t.c[col], literal(keep.id), t.c.role, t.c.guild_id).where(t.c.person_id == dup.id),
            ).on_conflict_do_nothing().returning(t.c.person_id)
        ).all())
        already += total
        db.execute(sa_delete(t).where(t.c.person_id == dup.id))
    already -= moved
    db.expire(keep)  # their eagerly loaded credit lists are stale after the bulk SQL
    db.expire(dup)
    keep.name_en = keep.name_en or dup.name_en or (dup.name if dup.name != keep.name else None)
    if dup.notes and dup.notes not in (keep.notes or ""):
        keep.notes = f"{keep.notes}\n\n{dup.notes}" if keep.notes else dup.notes
    db.delete(dup)
    return MergeOut(moved=moved, already_had=already)


# ── Splitting one person into two ─────────────────────────────────────────────
_CREDIT_KINDS = dict(zip(("artist", "book", "movie", "game", "show", "season", "episode"), _CREDIT_TABLES))


class SplitCredit(BaseModel):
    kind: Literal["artist", "book", "movie", "game", "show", "season", "episode"]
    id: int  # the artist / book / movie / ... credited
    role: str


class SplitIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    name_en: str | None = None
    credits: list[SplitCredit] = Field(min_length=1)


class SplitOut(BaseModel):
    person_id: int  # the new person
    moved: int


@router.post("/{pid}/split", response_model=SplitOut, status_code=201)
def split_person(pid: int, body: SplitIn, ctx: GuildContext = Depends(EDIT),
                 db: DbSession = Depends(get_database, scope="function")):
    """The undo of a wrong merge or a same-name mix-up: the chosen credits move
    to a new person (same nationality, to be corrected); everything else stays.
    The TMDB / IGDB ids stay with the original, since they can't be on both."""
    src = _person(db, ctx, pid)
    new = Person(guild_id=ctx.guild_id, name=body.name.strip(), name_en=body.name_en or None,
                 birth_nationality=src.birth_nationality, core_nationality=src.core_nationality,
                 created_by_user_id=ctx.user_id)
    db.add(new)
    db.flush()
    moved = 0
    for c in body.credits:
        model, col = _CREDIT_KINDS[c.kind]
        t = model.__table__
        hit = db.execute(
            sa_update(t).where(t.c.person_id == src.id, t.c[col] == c.id, t.c.role == c.role)
            .values(person_id=new.id).returning(t.c.person_id)
        ).all()
        if not hit:
            raise HTTPException(422, f"{src.name} has no {c.role} credit on {c.kind} {c.id}")
        moved += len(hit)
    db.expire(src)
    db.expire(new)
    return SplitOut(person_id=new.id, moved=moved)
