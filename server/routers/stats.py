"""
Stats router — aggregate / analytical endpoints, computed from one guild
member's personal ranking (defaults to the caller; anyone may view another
member's stats the same way the ranking pages let you view their list).

Album score formula
-------------------
For each (album, artist) link, using the viewing member's own ranks:
    contribution = 1 / (artist_position × album_position_within_artist)

For albums with multiple artists the contributions are averaged:
    album_score = mean(contributions)

This means a collaborative album scores the same order of magnitude as a solo
album by either artist — it doesn't get a free boost just for having more links.

Only artists/albums the viewing member has actually ranked are included: an
unranked catalog item has no position, so it contributes nothing.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from statistics import mean
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..authz import Capability
from ..database import get_database
from ..database_models import Album, AlbumArtist, Artist, Genre, GuildMember, UserAlbumRank, UserArtistRank
from ..database_models.album_genre import album_genres
from ..database_models.genre_parent import genre_parents
from ..deps import GuildContext, guild_ctx

router = APIRouter(prefix="/guilds/{guild_id}/stats", tags=["stats"])
VIEW = guild_ctx(Capability.VIEW)


def _target_user(db: DbSession, ctx: GuildContext, user_id: int | None) -> int:
    if user_id is None or user_id == ctx.user_id:
        return ctx.user_id
    if db.get(GuildMember, (ctx.guild_id, user_id)) is None:
        raise HTTPException(404, "Not a member of this guild")
    return user_id


# ---------------------------------------------------------------------------
# Core data model
# ---------------------------------------------------------------------------


@dataclass
class ScoredAlbum:
    album: Album
    score: float
    listens: int
    artist_links: list[tuple[Artist, int]]  # (artist, artist_position)


@dataclass
class ArtistDetail:
    artist: Artist
    position: int
    albums: list[tuple[Album, int, float]]  # (album, album_position, album_score)


# ---------------------------------------------------------------------------
# Shared data loader — runs once per request, shared by all stat calculations
# ---------------------------------------------------------------------------


def _load(db: DbSession, ctx: GuildContext, uid: int) -> tuple[list[ArtistDetail], list[ScoredAlbum]]:
    """Returns (artist_details, scored_albums) for `uid`'s personal ranking
    within this guild. All positions are 1-based; only ranked items appear."""
    artist_rank_rows = list(db.scalars(
        select(UserArtistRank)
        .where(UserArtistRank.user_id == uid, UserArtistRank.guild_id == ctx.guild_id)
        .order_by(UserArtistRank.rank, UserArtistRank.artist_id)
    ).all())
    artist_pos: dict[int, int] = {r.artist_id: i for i, r in enumerate(artist_rank_rows, 1)}
    artists_by_id: dict[int, Artist] = {a.id: a for a in db.scalars(
        select(Artist).where(Artist.id.in_(artist_pos.keys()))
    ).all()} if artist_pos else {}

    album_rank_rows = list(db.scalars(
        select(UserAlbumRank)
        .where(UserAlbumRank.user_id == uid, UserAlbumRank.guild_id == ctx.guild_id)
        .order_by(UserAlbumRank.artist_id, UserAlbumRank.rank, UserAlbumRank.album_id)
    ).all())
    album_pos_for_artist: dict[tuple[int, int], int] = {}
    _counter: dict[int, int] = defaultdict(int)
    for r in album_rank_rows:
        _counter[r.artist_id] += 1
        album_pos_for_artist[(r.album_id, r.artist_id)] = _counter[r.artist_id]

    album_ids = {r.album_id for r in album_rank_rows}
    albums: dict[int, Album] = {a.id: a for a in db.scalars(
        select(Album).where(Album.id.in_(album_ids))
    ).all()} if album_ids else {}
    listens_by_album: dict[int, int] = {}
    for r in album_rank_rows:
        listens_by_album[r.album_id] = max(listens_by_album.get(r.album_id, 0), r.listens)

    links: list[AlbumArtist] = list(db.scalars(
        select(AlbumArtist).where(AlbumArtist.album_id.in_(album_ids))
    ).all()) if album_ids else []

    album_links: dict[int, list[tuple[Artist, int, int]]] = defaultdict(list)
    for link in links:
        a_pos = artist_pos.get(link.artist_id)
        al_pos = album_pos_for_artist.get((link.album_id, link.artist_id))
        if a_pos is not None and al_pos is not None:
            artist = artists_by_id.get(link.artist_id)
            if artist is not None:
                album_links[link.album_id].append((artist, a_pos, al_pos))

    scored_albums: list[ScoredAlbum] = []
    for album_id, album in albums.items():
        links_for_album = album_links.get(album_id, [])
        if not links_for_album:
            continue
        contributions = [1.0 / (a_pos * al_pos) for (_, a_pos, al_pos) in links_for_album]
        score = mean(contributions)
        scored_albums.append(ScoredAlbum(
            album=album, score=score, listens=listens_by_album.get(album_id, 1),
            artist_links=[(artist, a_pos) for (artist, a_pos, _) in links_for_album],
        ))

    artist_albums: dict[int, list[tuple[Album, int, float]]] = defaultdict(list)
    for sa in scored_albums:
        for artist, a_pos in sa.artist_links:
            al_pos = album_pos_for_artist.get((sa.album.id, artist.id), 0)
            artist_albums[artist.id].append((sa.album, al_pos, sa.score))
    for aid in artist_albums:
        artist_albums[aid].sort(key=lambda t: t[1])

    artist_details: list[ArtistDetail] = [
        ArtistDetail(artist=artists_by_id[aid], position=pos, albums=artist_albums.get(aid, []))
        for aid, pos in artist_pos.items()
    ]
    artist_details.sort(key=lambda ad: ad.position)

    return artist_details, scored_albums


# ---------------------------------------------------------------------------
# Helper aggregators
# ---------------------------------------------------------------------------


def _runtime_hours(albums: list[Album]) -> float:
    return sum(a.runtime.total_seconds() for a in albums) / 3600


def _best_worst(items: list[Any], key_fn, val_fn, higher_is_better: bool = True) -> tuple[Any, Any]:
    groups: dict[Any, list] = defaultdict(list)
    for item in items:
        groups[key_fn(item)].append(item)
    if not groups:
        return None, None
    scored = {k: val_fn(v) for k, v in groups.items()}
    ordered = sorted(scored.items(), key=lambda kv: kv[1], reverse=higher_is_better)
    return ordered[0][0], ordered[-1][0]


def _group_stats(items: list[Any], key_fn, score_fn=None, rank_fn=None) -> list[dict]:
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
        if rank_fn:
            ranks = [rank_fn(m) for m in members if rank_fn(m) is not None]
            entry["avg_rank"] = mean(ranks) if ranks else None
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
            select(Genre).where(Genre.guild_id == ctx.guild_id, Genre.id.not_in(has_parent), Genre.is_music.is_(True))
        ).all()
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/summary")
def summary(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    artist_details, scored_albums = _load(db, ctx, uid)

    total_artists = len(artist_details)
    total_albums = len(scored_albums)
    avg_albums_per_artist = mean(len(ad.albums) for ad in artist_details) if artist_details else 0

    unique_albums = [sa.album for sa in scored_albums]
    unique_runtime_h = _runtime_hours(unique_albums)
    avg_runtime_h = unique_runtime_h / total_albums if total_albums else 0

    total_listened_h = sum(sa.album.runtime.total_seconds() * sa.listens for sa in scored_albums) / 3600
    avg_listened_h = total_listened_h / total_albums if total_albums else 0

    def _year(sa: ScoredAlbum):
        return sa.album.release_year

    best_album_year, worst_album_year = _best_worst(
        scored_albums, _year, lambda group: mean(sa.score for sa in group),
    )
    artist_details_with_year = [ad for ad in artist_details if ad.albums]
    best_artist_year, worst_artist_year = _best_worst(
        artist_details_with_year,
        lambda ad: ad.albums[0][0].release_year,
        lambda group: mean(1.0 / ad.position for ad in group),
    )

    def _decade(year):
        return (year // 10) * 10

    best_album_decade, worst_album_decade = _best_worst(
        scored_albums, lambda sa: _decade(sa.album.release_year), lambda group: mean(sa.score for sa in group),
    )
    best_artist_decade, worst_artist_decade = _best_worst(
        artist_details_with_year,
        lambda ad: _decade(ad.albums[0][0].release_year),
        lambda group: mean(1.0 / ad.position for ad in group),
    )

    best_core_nat_albums, worst_core_nat_albums = _best_worst(
        scored_albums,
        lambda sa: sa.artist_links[0][0].core_nationality if sa.artist_links else None,
        lambda group: mean(sa.score for sa in group),
    )
    best_core_nat_artists, worst_core_nat_artists = _best_worst(
        artist_details, lambda ad: ad.artist.core_nationality, lambda group: mean(1.0 / ad.position for ad in group),
    )
    best_birth_nat_albums, worst_birth_nat_albums = _best_worst(
        scored_albums,
        lambda sa: sa.artist_links[0][0].birth_nationality if sa.artist_links else None,
        lambda group: mean(sa.score for sa in group),
    )
    best_birth_nat_artists, worst_birth_nat_artists = _best_worst(
        artist_details, lambda ad: ad.artist.birth_nationality, lambda group: mean(1.0 / ad.position for ad in group),
    )

    return {
        "total_artists": total_artists,
        "total_albums": total_albums,
        "avg_albums_per_artist": round(avg_albums_per_artist, 2),
        "unique_runtime_hours": round(unique_runtime_h, 2),
        "unique_runtime_days": round(unique_runtime_h / 24, 2),
        "avg_album_runtime_hours": round(avg_runtime_h, 2),
        "total_listened_hours": round(total_listened_h, 2),
        "total_listened_days": round(total_listened_h / 24, 2),
        "avg_listened_hours": round(avg_listened_h, 2),
        "best_year_artists": best_artist_year,
        "worst_year_artists": worst_artist_year,
        "best_year_albums": best_album_year,
        "worst_year_albums": worst_album_year,
        "best_decade_artists": best_artist_decade,
        "worst_decade_artists": worst_artist_decade,
        "best_decade_albums": best_album_decade,
        "worst_decade_albums": worst_album_decade,
        "best_core_nationality_artists": best_core_nat_artists,
        "worst_core_nationality_artists": worst_core_nat_artists,
        "best_core_nationality_albums": best_core_nat_albums,
        "worst_core_nationality_albums": worst_core_nat_albums,
        "best_birth_nationality_artists": best_birth_nat_artists,
        "worst_birth_nationality_artists": worst_birth_nat_artists,
        "best_birth_nationality_albums": best_birth_nat_albums,
        "worst_birth_nationality_albums": worst_birth_nat_albums,
    }


@router.get("/by-year")
def by_year(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    artist_details, scored_albums = _load(db, ctx, uid)

    album_rows = _group_stats(scored_albums, key_fn=lambda sa: sa.album.release_year, score_fn=lambda sa: sa.score)
    artist_rows = _group_stats(
        [ad for ad in artist_details if ad.albums],
        key_fn=lambda ad: ad.albums[0][0].release_year, rank_fn=lambda ad: ad.position,
    )
    artist_by_year = {r["key"]: r for r in artist_rows}
    for row in album_rows:
        ar = artist_by_year.get(row["key"], {})
        row["artist_count"] = ar.get("count", 0)
        row["avg_artist_rank"] = ar.get("avg_rank")
        row["album_count"] = row.pop("count")
        row["year"] = row.pop("key")
    return sorted(album_rows, key=lambda r: r["year"])


@router.get("/by-decade")
def by_decade(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    artist_details, scored_albums = _load(db, ctx, uid)

    def _decade(year):
        return (year // 10) * 10

    album_rows = _group_stats(
        scored_albums, key_fn=lambda sa: _decade(sa.album.release_year), score_fn=lambda sa: sa.score,
    )
    artist_rows = _group_stats(
        [ad for ad in artist_details if ad.albums],
        key_fn=lambda ad: _decade(ad.albums[0][0].release_year), rank_fn=lambda ad: ad.position,
    )
    artist_by_decade = {r["key"]: r for r in artist_rows}
    for row in album_rows:
        ar = artist_by_decade.get(row["key"], {})
        row["artist_count"] = ar.get("count", 0)
        row["avg_artist_rank"] = ar.get("avg_rank")
        row["album_count"] = row.pop("count")
        row["decade"] = row.pop("key")
    return sorted(album_rows, key=lambda r: r["decade"])


@router.get("/by-nationality")
def by_nationality(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                   db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    artist_details, scored_albums = _load(db, ctx, uid)

    def _nat_album_score_key(nat_type: str):
        def fn(sa: ScoredAlbum):
            if not sa.artist_links:
                return None
            return getattr(sa.artist_links[0][0], nat_type)
        return fn

    result = {}
    for nat_type in ("core_nationality", "birth_nationality"):
        album_rows = _group_stats(scored_albums, key_fn=_nat_album_score_key(nat_type), score_fn=lambda sa: sa.score)
        artist_rows = _group_stats(
            artist_details, key_fn=lambda ad, nt=nat_type: getattr(ad.artist, nt), rank_fn=lambda ad: ad.position,
        )
        artist_by_nat = {r["key"]: r for r in artist_rows}
        merged = []
        for row in album_rows:
            ar = artist_by_nat.get(row["key"], {})
            merged.append({
                "nationality": row["key"],
                "album_count": row["count"],
                "avg_album_score": row.get("avg_score"),
                "artist_count": ar.get("count", 0),
                "avg_artist_rank": ar.get("avg_rank"),
            })
        result[nat_type] = sorted(merged, key=lambda r: r["nationality"] or "")
    return result


@router.get("/by-genre")
def by_genre(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    artist_details, scored_albums = _load(db, ctx, uid)

    album_ids = [sa.album.id for sa in scored_albums]
    rows = db.execute(
        select(album_genres.c.album_id, album_genres.c.genre_id).where(album_genres.c.album_id.in_(album_ids))
    ).all() if album_ids else []
    album_genre_ids: dict[int, list[int]] = defaultdict(list)
    for album_id, genre_id in rows:
        album_genre_ids[album_id].append(genre_id)

    genre_by_id: dict[int, Genre] = {
        g.id: g for g in db.scalars(select(Genre).where(Genre.guild_id == ctx.guild_id, Genre.is_music.is_(True))).all()
    }
    roots = _root_genre_ids(db, ctx)
    ancestors = _genre_ancestors(db)

    genre_albums: dict[int, list[ScoredAlbum]] = defaultdict(list)
    root_genre_albums: dict[int, list[ScoredAlbum]] = defaultdict(list)
    genre_albums_direct: dict[int, list[ScoredAlbum]] = defaultdict(list)

    for sa in scored_albums:
        gids = album_genre_ids.get(sa.album.id, [])
        all_gids: set[int] = set(gids)
        for gid in gids:
            all_gids |= ancestors.get(gid, set())
        for gid in all_gids:
            genre_albums[gid].append(sa)
        for gid in all_gids:
            if gid in roots:
                root_genre_albums[gid].append(sa)
        for gid in gids:
            genre_albums_direct[gid].append(sa)

    artist_genre: dict[int, list[ArtistDetail]] = defaultdict(list)
    root_artist_genre: dict[int, list[ArtistDetail]] = defaultdict(list)
    artist_genre_direct: dict[int, list[ArtistDetail]] = defaultdict(list)
    for ad in artist_details:
        gid = ad.artist.primary_genre
        if gid is None:
            continue
        all_gids = {gid} | ancestors.get(gid, set())
        for g in all_gids:
            artist_genre[g].append(ad)
        for g in all_gids:
            if g in roots:
                root_artist_genre[g].append(ad)
        artist_genre_direct[gid].append(ad)

    def _build(genre_alb, genre_art, genre_alb_direct, genre_art_direct, candidate_gids):
        result = []
        for gid in candidate_gids:
            g = genre_by_id.get(gid)
            if g is None:
                continue
            alb = genre_alb.get(gid, [])
            art = genre_art.get(gid, [])
            result.append({
                "genre_id": gid,
                "genre_name": g.name,
                "album_count": len(alb),
                "album_count_direct": len(genre_alb_direct.get(gid, [])),
                "avg_album_score": (round(mean(sa.score for sa in alb), 6) if alb else None),
                "artist_count": len(art),
                "artist_count_direct": len(genre_art_direct.get(gid, [])),
                "avg_artist_rank": (round(mean(ad.position for ad in art), 2) if art else None),
            })
        return sorted(result, key=lambda r: r["genre_name"])

    all_gids = set(genre_by_id.keys())
    return {
        "by_genre": _build(genre_albums, artist_genre, genre_albums_direct, artist_genre_direct, all_gids),
        "by_root_genre": _build(root_genre_albums, root_artist_genre, genre_albums_direct, artist_genre_direct, roots),
    }


@router.get("/scatter")
def scatter(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    """
    Data for three scatter plots:
      1. Artist rank vs average artist album runtime (minutes)
      2. Album score vs album runtime (minutes)
      3. Album rank (within artist) vs album runtime (minutes)
    """
    uid = _target_user(db, ctx, user_id)
    artist_details, scored_albums = _load(db, ctx, uid)

    artist_scatter = []
    for ad in artist_details:
        if not ad.albums:
            continue
        avg_rt = mean(alb.runtime.total_seconds() / 60 for (alb, _, _) in ad.albums)
        artist_scatter.append({
            "artist_id": ad.artist.id, "name": ad.artist.name,
            "rank": ad.position, "avg_runtime_minutes": round(avg_rt, 2),
        })

    album_score_scatter = [
        {
            "album_id": sa.album.id, "name": sa.album.name,
            "score": round(sa.score, 6), "runtime_minutes": round(sa.album.runtime.total_seconds() / 60, 2),
        }
        for sa in scored_albums
    ]

    ad_by_id = {ad.artist.id: ad for ad in artist_details}
    album_rank_scatter = []
    for sa in scored_albums:
        for artist, a_pos in sa.artist_links:
            ad = ad_by_id.get(artist.id)
            if ad is None:
                continue
            al_pos_rows = [t for t in ad.albums if t[0].id == sa.album.id]
            if al_pos_rows:
                al_pos = al_pos_rows[0][1]
                album_rank_scatter.append({
                    "album_id": sa.album.id, "name": sa.album.name, "artist_name": artist.name,
                    "album_rank": al_pos, "runtime_minutes": round(sa.album.runtime.total_seconds() / 60, 2),
                })

    return {
        "artist_rank_vs_runtime": artist_scatter,
        "album_score_vs_runtime": album_score_scatter,
        "album_rank_vs_runtime": album_rank_scatter,
    }
