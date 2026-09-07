from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..api_models.base import PositionBody, ReorderBody
from ..api_models.comparison import ComparisonIn, ComparisonOut
from ..api_models.music import (
    AlbumEntryIn, AlbumEntryOut, AlbumOut, AlbumRef, ArtistIn, ArtistOut, ArtistPatch, EntryIn,
    NamedRef, PersonArtistRef, RankedAlbumOut, RankedArtistOut,
)
from ..authz import Capability
from ..comparisons import clear_comparisons, delete_comparison, list_comparisons, upsert_comparison
from ..database import get_database
from ..database_models import (
    Album, AlbumArtist, AlbumComparison, Artist, ArtistComparison, ArtistLink, ArtistPerson,
    BandRole, Genre, GuildMember, Person, UserAlbumRank, UserArtistRank,
)
from ..deps import GuildContext, guild_ctx
from ..ranking import apply_order, check_reorder_ids, rank_at
from .links import make_links_router

router = APIRouter(prefix="/guilds/{guild_id}/artists", tags=["artists"])

VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)
RANK = guild_ctx(Capability.RANK)

links_router = make_links_router(
    owner_model=Artist, link_model=ArtistLink, owner_fk="artist_id", prefix="/artists", tag="artists"
)


# ── helpers ──────────────────────────────────────────────────────────────────
def _artist(db: DbSession, ctx: GuildContext, aid: int) -> Artist:
    a = db.get(Artist, aid)
    if a is None or a.guild_id != ctx.guild_id:
        raise HTTPException(404, "Artist not found")
    return a


def _album(db: DbSession, ctx: GuildContext, alid: int) -> Album:
    a = db.get(Album, alid)
    if a is None or a.guild_id != ctx.guild_id:
        raise HTTPException(404, "Album not found")
    return a


def _target_user(db: DbSession, ctx: GuildContext, user_id: int | None) -> int:
    """E1/E3: anyone may *view* any member's ranking; only its owner may write
    to it. `user_id` never reaches a mutating endpoint."""
    if user_id is None or user_id == ctx.user_id:
        return ctx.user_id
    if db.get(GuildMember, (ctx.guild_id, user_id)) is None:
        raise HTTPException(404, "Not a member of this guild")
    return user_id


def _artist_out(db: DbSession, ctx: GuildContext, a: Artist, mine: set[int]) -> ArtistOut:
    out = ArtistOut.model_validate(a)
    out.persons = [
        PersonArtistRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role)
        for l in a.person_links
    ]
    out.albums = [
        AlbumRef(id=l.album.id, name=l.album.name, name_en=l.album.name_en, alias=l.album.alias,
                 genre_ids=[g.id for g in l.album.genres])
        for l in a.album_links
    ]
    out.album_count = len(a.album_links)
    out.in_my_list = a.id in mine
    return out


def _my_artist_ids(db: DbSession, ctx: GuildContext) -> set[int]:
    return set(db.scalars(
        select(UserArtistRank.artist_id).where(
            UserArtistRank.user_id == ctx.user_id, UserArtistRank.guild_id == ctx.guild_id
        )
    ))


def _album_out(a: Album, mine: set[int]) -> AlbumOut:
    out = AlbumOut.model_validate(a)
    out.runtime_seconds = a.runtime_seconds
    out.artists = [NamedRef(id=l.artist.id, name=l.artist.name, name_en=l.artist.name_en) for l in a.artist_links]
    out.genre_ids = [g.id for g in a.genres]
    out.soundtrack_movies = [NamedRef(id=m.id, name=m.name, name_en=m.name_en) for m in a.soundtrack_movies]
    out.soundtrack_games = [NamedRef(id=g.id, name=g.name, name_en=g.name_en) for g in a.soundtrack_games]
    out.soundtrack_television_shows = [
        NamedRef(id=s.id, name=s.name, name_en=s.name_en) for s in a.soundtrack_television_shows
    ]
    out.in_my_list = a.id in mine
    return out


# ── catalog ──────────────────────────────────────────────────────────────────
@router.get("", response_model=list[ArtistOut])
def list_catalog(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    mine = _my_artist_ids(db, ctx)
    rows = db.scalars(select(Artist).where(Artist.guild_id == ctx.guild_id).order_by(Artist.name)).all()
    return [_artist_out(db, ctx, a, mine) for a in rows]


@router.post("", response_model=ArtistOut, status_code=201)
def create_artist(body: ArtistIn, ctx: GuildContext = Depends(CREATE), db: DbSession = Depends(get_database)):
    if body.primary_genre is not None:
        g = db.get(Genre, body.primary_genre)
        if g is None or g.guild_id != ctx.guild_id or not g.is_music:
            raise HTTPException(422, "Primary genre must be a music genre in this guild")
    a = Artist(guild_id=ctx.guild_id, created_by_user_id=ctx.user_id, **body.model_dump())
    db.add(a)
    db.flush()
    return _artist_out(db, ctx, a, set())


# ── comparisons (literal path — must precede /{aid}) ─────────────────────────
def _artist_scope(ctx: GuildContext, uid: int):
    return (ArtistComparison.user_id == uid) & (ArtistComparison.guild_id == ctx.guild_id)


@router.get("/comparisons", response_model=list[ComparisonOut])
def list_artist_comparisons(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                            db: DbSession = Depends(get_database)):
    return list_comparisons(db, ArtistComparison, scope=_artist_scope(ctx, _target_user(db, ctx, user_id)))


@router.put("/comparisons", response_model=ComparisonOut)
def upsert_artist_comparison(body: ComparisonIn, ctx: GuildContext = Depends(RANK),
                             db: DbSession = Depends(get_database)):
    _artist(db, ctx, body.winner_id)
    _artist(db, ctx, body.loser_id)
    return upsert_comparison(db, ArtistComparison, body.winner_id, body.loser_id,
                             scope=_artist_scope(ctx, ctx.user_id),
                             extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id})


@router.delete("/comparisons", status_code=204)
def clear_artist_comparisons(ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    clear_comparisons(db, ArtistComparison, scope=_artist_scope(ctx, ctx.user_id))


@router.delete("/comparisons/{a}/{b}", status_code=204)
def delete_artist_comparison(a: int, b: int, ctx: GuildContext = Depends(RANK),
                             db: DbSession = Depends(get_database)):
    delete_comparison(db, ArtistComparison, a, b, scope=_artist_scope(ctx, ctx.user_id))


@router.get("/ranked", response_model=list[RankedArtistOut])
def ranked(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
           db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    mine = _my_artist_ids(db, ctx)
    rows = db.scalars(
        select(UserArtistRank)
        .where(UserArtistRank.user_id == uid, UserArtistRank.guild_id == ctx.guild_id)
        .order_by(UserArtistRank.rank, UserArtistRank.artist_id)
    ).all()
    return [
        RankedArtistOut(position=i, rank=r.rank,
                        notes=r.notes if uid == ctx.user_id else None,
                        artist=_artist_out(db, ctx, db.get(Artist, r.artist_id), mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/reorder", status_code=204)
def reorder(body: ReorderBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    rows = db.scalars(
        select(UserArtistRank).where(UserArtistRank.user_id == ctx.user_id, UserArtistRank.guild_id == ctx.guild_id)
    ).all()
    check_reorder_ids(body.ids, [r.artist_id for r in rows])
    apply_order(db, {r.artist_id: r for r in rows}, body.ids)


# ── single artist ────────────────────────────────────────────────────────────
@router.get("/{aid}", response_model=ArtistOut)
def get_artist(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    return _artist_out(db, ctx, _artist(db, ctx, aid), _my_artist_ids(db, ctx))


@router.patch("/{aid}", response_model=ArtistOut)
def update_artist(aid: int, body: ArtistPatch, ctx: GuildContext = Depends(EDIT),
                  db: DbSession = Depends(get_database)):
    a = _artist(db, ctx, aid)
    data = body.model_dump(exclude_unset=True)
    if data.get("primary_genre") is not None:
        g = db.get(Genre, data["primary_genre"])
        if g is None or g.guild_id != ctx.guild_id or not g.is_music:
            raise HTTPException(422, "Primary genre must be a music genre in this guild")
    for k, v in data.items():
        setattr(a, k, v)
    a.updated_by_user_id = ctx.user_id
    return _artist_out(db, ctx, a, _my_artist_ids(db, ctx))


@router.get("/{aid}/impact")
def delete_impact(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    """F1: hard delete takes every member's ranking with it. The confirm dialog
    shows this count before the user commits."""
    _artist(db, ctx, aid)
    return {
        "rankings_destroyed": db.scalar(
            select(func.count()).select_from(UserArtistRank).where(UserArtistRank.artist_id == aid)
        )
    }


@router.delete("/{aid}", status_code=204)
def delete_artist(aid: int, ctx: GuildContext = Depends(DELETE), db: DbSession = Depends(get_database)):
    db.delete(_artist(db, ctx, aid))


# ── my entry ─────────────────────────────────────────────────────────────────
@router.put("/{aid}/entry", status_code=204)
def upsert_entry(aid: int, body: EntryIn, ctx: GuildContext = Depends(RANK),
                 db: DbSession = Depends(get_database)):
    _artist(db, ctx, aid)
    row = db.get(UserArtistRank, {"user_id": ctx.user_id, "artist_id": aid})
    if row is None:
        row = UserArtistRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, artist_id=aid,
            rank=rank_at(db, UserArtistRank, user_id=ctx.user_id, guild_id=ctx.guild_id, position=body.position),
        )
        db.add(row)
    row.notes = body.notes


@router.delete("/{aid}/entry", status_code=204)
def remove_entry(aid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserArtistRank, {"user_id": ctx.user_id, "artist_id": aid})
    if row:
        db.delete(row)


@router.put("/{aid}/position", status_code=204)
def move(aid: int, body: PositionBody, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserArtistRank, {"user_id": ctx.user_id, "artist_id": aid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserArtistRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                       position=body.position, exclude_col=UserArtistRank.artist_id, exclude=aid)


# ── band members ─────────────────────────────────────────────────────────────
@router.get("/{aid}/persons", response_model=list[PersonArtistRef])
def artist_persons(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    _artist(db, ctx, aid)
    rows = db.scalars(select(ArtistPerson).where(ArtistPerson.artist_id == aid)).all()
    return sorted(
        (PersonArtistRef(id=l.person.id, name=l.person.name, name_en=l.person.name_en, role=l.role) for l in rows),
        key=lambda p: p.name,
    )


@router.put("/{aid}/persons/{pid}/{role}", status_code=204)
def link_person(aid: int, pid: int, role: BandRole, ctx: GuildContext = Depends(EDIT),
                db: DbSession = Depends(get_database)):
    _artist(db, ctx, aid)
    p = db.get(Person, pid)
    if p is None or p.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")
    if not db.get(ArtistPerson, (aid, pid, role)):
        db.add(ArtistPerson(artist_id=aid, person_id=pid, role=role, guild_id=ctx.guild_id))


@router.delete("/{aid}/persons/{pid}/{role}", status_code=204)
def unlink_person(aid: int, pid: int, role: BandRole, ctx: GuildContext = Depends(EDIT),
                  db: DbSession = Depends(get_database)):
    link = db.get(ArtistPerson, (aid, pid, role))
    if link:
        db.delete(link)


# ── this artist's discography (catalog) and my ranking of it ─────────────────
@router.get("/{aid}/albums", response_model=list[AlbumOut])
def artist_albums(aid: int, ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    _artist(db, ctx, aid)
    mine = set(db.scalars(
        select(UserAlbumRank.album_id).where(
            UserAlbumRank.user_id == ctx.user_id, UserAlbumRank.guild_id == ctx.guild_id,
            UserAlbumRank.artist_id == aid,
        )
    ))
    rows = db.scalars(
        select(Album).join(AlbumArtist, AlbumArtist.album_id == Album.id)
        .where(AlbumArtist.artist_id == aid).order_by(Album.release_year, Album.name)
    ).all()
    return [_album_out(a, mine) for a in rows]


@router.get("/{aid}/albums/ranked", response_model=list[RankedAlbumOut])
def artist_albums_ranked(aid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                         db: DbSession = Depends(get_database)):
    _artist(db, ctx, aid)
    uid = _target_user(db, ctx, user_id)
    rows = db.scalars(
        select(UserAlbumRank)
        .where(UserAlbumRank.user_id == uid, UserAlbumRank.guild_id == ctx.guild_id, UserAlbumRank.artist_id == aid)
        .order_by(UserAlbumRank.rank, UserAlbumRank.album_id)
    ).all()
    mine = {r.album_id for r in rows} if uid == ctx.user_id else set()
    return [
        RankedAlbumOut(position=i, rank=r.rank, listens=r.listens,
                       notes=r.notes if uid == ctx.user_id else None,
                       album=_album_out(db.get(Album, r.album_id), mine))
        for i, r in enumerate(rows, 1)
    ]


@router.put("/{aid}/albums/reorder", status_code=204)
def reorder_albums(aid: int, body: ReorderBody, ctx: GuildContext = Depends(RANK),
                   db: DbSession = Depends(get_database)):
    _artist(db, ctx, aid)
    rows = db.scalars(
        select(UserAlbumRank).where(
            UserAlbumRank.user_id == ctx.user_id, UserAlbumRank.guild_id == ctx.guild_id,
            UserAlbumRank.artist_id == aid,
        )
    ).all()
    check_reorder_ids(body.ids, [r.album_id for r in rows])
    apply_order(db, {r.album_id: r for r in rows}, body.ids)


@router.get("/{aid}/albums/{alid}/entry", response_model=AlbumEntryOut | None)
def get_album_entry(aid: int, alid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    row = db.get(UserAlbumRank, {"user_id": ctx.user_id, "artist_id": aid, "album_id": alid})
    return AlbumEntryOut(listens=row.listens, notes=row.notes) if row else None


@router.put("/{aid}/albums/{alid}/entry", status_code=204)
def upsert_album_entry(aid: int, alid: int, body: AlbumEntryIn, ctx: GuildContext = Depends(RANK),
                       db: DbSession = Depends(get_database)):
    _artist(db, ctx, aid)
    _album(db, ctx, alid)
    if not db.get(AlbumArtist, (alid, aid)):
        raise HTTPException(422, "That album is not credited to this artist")
    row = db.get(UserAlbumRank, {"user_id": ctx.user_id, "artist_id": aid, "album_id": alid})
    if row is None:
        row = UserAlbumRank(
            user_id=ctx.user_id, guild_id=ctx.guild_id, artist_id=aid, album_id=alid, listens=1,
            rank=rank_at(db, UserAlbumRank, user_id=ctx.user_id, guild_id=ctx.guild_id,
                         position=body.position, scope=UserAlbumRank.artist_id == aid),
        )
        db.add(row)
    data = body.model_dump(exclude_unset=True, exclude={"position"})
    for k, v in data.items():
        setattr(row, k, v)


@router.delete("/{aid}/albums/{alid}/entry", status_code=204)
def remove_album_entry(aid: int, alid: int, ctx: GuildContext = Depends(RANK),
                       db: DbSession = Depends(get_database)):
    row = db.get(UserAlbumRank, {"user_id": ctx.user_id, "artist_id": aid, "album_id": alid})
    if row:
        db.delete(row)


@router.put("/{aid}/albums/{alid}/position", status_code=204)
def move_album(aid: int, alid: int, body: PositionBody, ctx: GuildContext = Depends(RANK),
               db: DbSession = Depends(get_database)):
    row = db.get(UserAlbumRank, {"user_id": ctx.user_id, "artist_id": aid, "album_id": alid})
    if row is None:
        raise HTTPException(404, "Not in your list")
    row.rank = rank_at(db, UserAlbumRank, user_id=ctx.user_id, guild_id=ctx.guild_id, position=body.position,
                       exclude_col=UserAlbumRank.album_id, exclude=alid, scope=UserAlbumRank.artist_id == aid)


# ── album comparisons, scoped to this artist's discography ───────────────────
def _album_scope(ctx: GuildContext, uid: int, aid: int):
    return ((AlbumComparison.user_id == uid) & (AlbumComparison.guild_id == ctx.guild_id)
            & (AlbumComparison.artist_id == aid))


@router.get("/{aid}/albums/comparisons", response_model=list[ComparisonOut])
def list_album_comparisons(aid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                           db: DbSession = Depends(get_database)):
    _artist(db, ctx, aid)
    return list_comparisons(db, AlbumComparison, scope=_album_scope(ctx, _target_user(db, ctx, user_id), aid))


@router.put("/{aid}/albums/comparisons", response_model=ComparisonOut)
def upsert_album_comparison(aid: int, body: ComparisonIn, ctx: GuildContext = Depends(RANK),
                            db: DbSession = Depends(get_database)):
    _artist(db, ctx, aid)
    for album_id in (body.winner_id, body.loser_id):
        if not db.get(AlbumArtist, (album_id, aid)):
            raise HTTPException(404, "Album is not in this artist's discography")
    return upsert_comparison(db, AlbumComparison, body.winner_id, body.loser_id,
                             scope=_album_scope(ctx, ctx.user_id, aid),
                             extra={"user_id": ctx.user_id, "guild_id": ctx.guild_id, "artist_id": aid})


@router.delete("/{aid}/albums/comparisons", status_code=204)
def clear_album_comparisons(aid: int, ctx: GuildContext = Depends(RANK), db: DbSession = Depends(get_database)):
    clear_comparisons(db, AlbumComparison, scope=_album_scope(ctx, ctx.user_id, aid))


@router.delete("/{aid}/albums/comparisons/{a}/{b}", status_code=204)
def delete_album_comparison(aid: int, a: int, b: int, ctx: GuildContext = Depends(RANK),
                            db: DbSession = Depends(get_database)):
    delete_comparison(db, AlbumComparison, a, b, scope=_album_scope(ctx, ctx.user_id, aid))
