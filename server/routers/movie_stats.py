"""
Movie stats router — aggregate / analytical endpoints, computed from one guild
member's personal ranking (defaults to the caller).

Movie score formula
--------------------
Score = 1 / position (1-based, per the viewing member's own ranking).
Person score = mean of scores of all their (ranked) movies.
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
from ..database_models import Genre, GuildMember, Movie, MoviePerson, Person, UserMovieRank
from ..database_models.genre_parent import genre_parents
from ..database_models.junctions import movie_genres_junction
from ..database_models.movie_cast_member import CastRole
from ..deps import GuildContext, guild_ctx

router = APIRouter(prefix="/guilds/{guild_id}/movie-stats", tags=["movie-stats"])
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
        movies: list of Movie in the viewing member's rank order
        movie_score: dict[movie_id, float]
        watches_by_movie: dict[movie_id, int]
        person_movies: dict[person_id, list[(Movie, score)]]
        person_by_id: dict[int, Person]
    """
    rank_rows = list(db.scalars(
        select(UserMovieRank)
        .where(UserMovieRank.user_id == uid, UserMovieRank.guild_id == ctx.guild_id)
        .order_by(UserMovieRank.rank, UserMovieRank.movie_id)
    ).all())
    movie_ids = [r.movie_id for r in rank_rows]
    movie_by_id: dict[int, Movie] = {m.id: m for m in db.scalars(
        select(Movie).where(Movie.id.in_(movie_ids))
    ).all()} if movie_ids else {}
    movies = [movie_by_id[mid] for mid in movie_ids if mid in movie_by_id]
    movie_score: dict[int, float] = {m.id: 1.0 / pos for m, pos in zip(movies, range(1, len(movies) + 1))}
    watches_by_movie: dict[int, int] = {r.movie_id: r.watches for r in rank_rows}

    links: list[MoviePerson] = list(db.scalars(
        select(MoviePerson).where(MoviePerson.movie_id.in_(movie_ids))
    ).all()) if movie_ids else []

    person_movies: dict[int, list[tuple[Movie, float]]] = defaultdict(list)
    for link in links:
        m = movie_by_id.get(link.movie_id)
        if m is not None:
            person_movies[link.person_id].append((m, movie_score[m.id]))

    person_ids = set(person_movies.keys())
    person_by_id: dict[int, Person] = {p.id: p for p in db.scalars(
        select(Person).where(Person.id.in_(person_ids))
    ).all()} if person_ids else {}

    return movies, movie_score, watches_by_movie, person_movies, person_by_id


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
            select(Genre).where(Genre.guild_id == ctx.guild_id, Genre.id.not_in(has_parent), Genre.is_movie.is_(True))
        ).all()
    }


def _fmt(minutes: float) -> str:
    h = int(minutes // 60)
    m = int(minutes % 60)
    return f"{h}:{m:02d}"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/summary")
def summary(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    movies, movie_score, watches_by_movie, person_movies, person_by_id = _load(db, ctx, uid)

    total_movies = len(movies)
    total_persons = len(person_movies)
    unique_runtime_h = sum(m.runtime_minutes for m in movies) / 60
    avg_runtime_h = unique_runtime_h / total_movies if total_movies else 0
    total_watched_h = sum(m.runtime_minutes * watches_by_movie.get(m.id, 1) for m in movies) / 60
    avg_watched_h = total_watched_h / total_movies if total_movies else 0

    avg_movies_per_person = mean(len(v) for v in person_movies.values()) if person_movies else 0

    best_year_movies, worst_year_movies = _best_worst(
        movies, lambda m: m.release_year, lambda g: mean(movie_score[m.id] for m in g)
    )

    def _decade(y):
        return (y // 10) * 10

    best_decade_movies, worst_decade_movies = _best_worst(
        movies, lambda m: _decade(m.release_year), lambda g: mean(movie_score[m.id] for m in g)
    )

    director_links = list(db.scalars(
        select(MoviePerson).where(MoviePerson.movie_id.in_([m.id for m in movies]), MoviePerson.role == CastRole.director)
    ).all()) if movies else []
    movie_director: dict[int, Person] = {}
    for link in director_links:
        if link.movie_id not in movie_director:
            p = person_by_id.get(link.person_id) or db.get(Person, link.person_id)
            if p:
                movie_director[link.movie_id] = p

    movies_with_director = [m for m in movies if m.id in movie_director]

    best_core_nat_movies, worst_core_nat_movies = _best_worst(
        movies_with_director, lambda m: movie_director[m.id].core_nationality,
        lambda g: mean(movie_score[m.id] for m in g),
    )
    best_birth_nat_movies, worst_birth_nat_movies = _best_worst(
        movies_with_director, lambda m: movie_director[m.id].birth_nationality,
        lambda g: mean(movie_score[m.id] for m in g),
    )

    persons_with_movies = [
        (p, pairs) for pid, pairs in person_movies.items() if (p := person_by_id.get(pid)) is not None
    ]
    best_core_nat_cast, worst_core_nat_cast = _best_worst(
        persons_with_movies, lambda t: t[0].core_nationality,
        lambda g: mean(mean(score for _, score in t[1]) for t in g),
    )
    best_birth_nat_cast, worst_birth_nat_cast = _best_worst(
        persons_with_movies, lambda t: t[0].birth_nationality,
        lambda g: mean(mean(score for _, score in t[1]) for t in g),
    )

    return {
        "total_cast_members": total_persons,
        "total_movies": total_movies,
        "avg_movies_per_cast_member": round(avg_movies_per_person, 2),
        "unique_runtime_hours": round(unique_runtime_h, 2),
        "unique_runtime_days": round(unique_runtime_h / 24, 2),
        "avg_movie_runtime_hours": round(avg_runtime_h, 2),
        "total_watched_hours": round(total_watched_h, 2),
        "total_watched_days": round(total_watched_h / 24, 2),
        "avg_watched_hours": round(avg_watched_h, 2),
        "best_year_movies": best_year_movies,
        "worst_year_movies": worst_year_movies,
        "best_decade_movies": best_decade_movies,
        "worst_decade_movies": worst_decade_movies,
        "best_core_nationality_movies": best_core_nat_movies,
        "worst_core_nationality_movies": worst_core_nat_movies,
        "best_birth_nationality_movies": best_birth_nat_movies,
        "worst_birth_nationality_movies": worst_birth_nat_movies,
        "best_core_nationality_cast": best_core_nat_cast,
        "worst_core_nationality_cast": worst_core_nat_cast,
        "best_birth_nationality_cast": best_birth_nat_cast,
        "worst_birth_nationality_cast": worst_birth_nat_cast,
    }


@router.get("/by-year")
def by_year(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    movies, movie_score, *_ = _load(db, ctx, uid)

    rows = _group_stats(movies, key_fn=lambda m: m.release_year, score_fn=lambda m: movie_score[m.id])
    for row in rows:
        row["movie_count"] = row.pop("count")
        row["year"] = row.pop("key")
    return sorted(rows, key=lambda r: r["year"])


@router.get("/by-decade")
def by_decade(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    movies, movie_score, *_ = _load(db, ctx, uid)

    def _decade(y):
        return (y // 10) * 10

    rows = _group_stats(movies, key_fn=lambda m: _decade(m.release_year), score_fn=lambda m: movie_score[m.id])
    for row in rows:
        row["movie_count"] = row.pop("count")
        row["decade"] = row.pop("key")
    return sorted(rows, key=lambda r: r["decade"])


@router.get("/by-nationality")
def by_nationality(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                   db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    movies, movie_score, _, person_movies, person_by_id = _load(db, ctx, uid)

    director_links = list(db.scalars(
        select(MoviePerson).where(MoviePerson.movie_id.in_([m.id for m in movies]), MoviePerson.role == CastRole.director)
    ).all()) if movies else []
    movie_director: dict[int, Person] = {}
    for link in director_links:
        if link.movie_id not in movie_director:
            p = person_by_id.get(link.person_id) or db.get(Person, link.person_id)
            if p:
                movie_director[link.movie_id] = p

    movies_with_director = [m for m in movies if m.id in movie_director]
    result = {}
    for nat_type in ("core_nationality", "birth_nationality"):
        rows = _group_stats(
            movies_with_director, key_fn=lambda m, nt=nat_type: getattr(movie_director[m.id], nt),
            score_fn=lambda m: movie_score[m.id],
        )
        result[nat_type] = [
            {"nationality": r["key"], "movie_count": r["count"], "avg_movie_score": r.get("avg_score")}
            for r in rows
        ]
    return result


@router.get("/by-genre")
def by_genre(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    movies, movie_score, *_ = _load(db, ctx, uid)

    movie_ids = [m.id for m in movies]
    rows = db.execute(
        select(movie_genres_junction.c.movie_id, movie_genres_junction.c.genre_id)
        .where(movie_genres_junction.c.movie_id.in_(movie_ids))
    ).all() if movie_ids else []
    movie_genre_ids: dict[int, list[int]] = defaultdict(list)
    for movie_id, genre_id in rows:
        movie_genre_ids[movie_id].append(genre_id)

    genre_by_id: dict[int, Genre] = {
        g.id: g for g in db.scalars(select(Genre).where(Genre.guild_id == ctx.guild_id, Genre.is_movie.is_(True))).all()
    }
    roots = _root_genre_ids(db, ctx)
    ancestors = _genre_ancestors(db)

    genre_movies: dict[int, list[Movie]] = defaultdict(list)
    root_genre_movies: dict[int, list[Movie]] = defaultdict(list)
    genre_movies_direct: dict[int, list[Movie]] = defaultdict(list)

    movie_by_id = {m.id: m for m in movies}
    for movie_id, gids in movie_genre_ids.items():
        m = movie_by_id.get(movie_id)
        if m is None:
            continue
        all_gids: set[int] = set(gids)
        for gid in gids:
            all_gids |= ancestors.get(gid, set())
        for gid in all_gids:
            genre_movies[gid].append(m)
        for gid in all_gids:
            if gid in roots:
                root_genre_movies[gid].append(m)
        for gid in gids:
            genre_movies_direct[gid].append(m)

    def _build(genre_mov, genre_mov_direct, candidate_gids):
        result = []
        for gid in candidate_gids:
            g = genre_by_id.get(gid)
            if g is None:
                continue
            mov = genre_mov.get(gid, [])
            result.append({
                "genre_id": gid,
                "genre_name": g.name,
                "movie_count": len(mov),
                "movie_count_direct": len(genre_mov_direct.get(gid, [])),
                "avg_movie_score": (round(mean(movie_score[m.id] for m in mov), 6) if mov else None),
            })
        return sorted(result, key=lambda r: r["genre_name"])

    all_gids = set(genre_by_id.keys())
    return {
        "by_genre": _build(genre_movies, genre_movies_direct, all_gids),
        "by_root_genre": _build(root_genre_movies, genre_movies_direct, roots),
    }


@router.get("/scatter")
def scatter(user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    movies, movie_score, _, person_movies, person_by_id = _load(db, ctx, uid)

    movie_scatter = [
        {"movie_id": m.id, "name": m.name, "score": round(movie_score[m.id], 6), "runtime_minutes": m.runtime_minutes}
        for m in movies
    ]

    cast_scatter = []
    for pid, pairs in person_movies.items():
        p = person_by_id.get(pid)
        if not p or not pairs:
            continue
        avg_score = mean(score for _, score in pairs)
        avg_rt = mean(m.runtime_minutes for m, _ in pairs)
        cast_scatter.append({
            "cast_member_id": pid, "name": p.name,
            "avg_score": round(avg_score, 6), "avg_runtime_minutes": round(avg_rt, 2),
        })

    return {"movie_score_vs_runtime": movie_scatter, "cast_member_score_vs_runtime": cast_scatter}


@router.get("/cast-member-detail/{pid}")
def cast_member_detail(pid: int, user_id: int | None = Query(None), ctx: GuildContext = Depends(VIEW),
                       db: DbSession = Depends(get_database)):
    uid = _target_user(db, ctx, user_id)
    movies, movie_score, watches_by_movie, person_movies, person_by_id = _load(db, ctx, uid)

    p = person_by_id.get(pid) or db.get(Person, pid)
    if p is None or p.guild_id != ctx.guild_id:
        raise HTTPException(404, "Person not found")

    pairs = person_movies.get(pid, [])
    movie_ids = [m.id for m, _ in pairs]

    total_runtime_m = sum(m.runtime_minutes for m, _ in pairs)
    total_watched_m = sum(m.runtime_minutes * watches_by_movie.get(m.id, 1) for m, _ in pairs)
    avg_runtime_m = total_runtime_m / len(pairs) if pairs else 0

    genre_rows = db.execute(
        select(movie_genres_junction.c.genre_id).where(movie_genres_junction.c.movie_id.in_(movie_ids))
    ).scalars().all() if movie_ids else []
    unique_genre_ids = set(genre_rows)
    genre_names = sorted(g.name for g in db.scalars(select(Genre).where(Genre.id.in_(unique_genre_ids))).all()) \
        if unique_genre_ids else []

    collaborator_ids: set[int] = set()
    for movie_id in movie_ids:
        other_links = db.scalars(
            select(MoviePerson.person_id).where(MoviePerson.movie_id == movie_id, MoviePerson.person_id != pid)
        ).all()
        collaborator_ids.update(other_links)
    collaborator_names = (
        sorted(p2.name for p2 in db.scalars(select(Person).where(Person.id.in_(collaborator_ids))).all())
        if collaborator_ids else []
    )

    return {
        "movie_count": len(pairs),
        "total_runtime": _fmt(total_runtime_m),
        "total_runtime_minutes": int(total_runtime_m),
        "total_watched_runtime": _fmt(total_watched_m),
        "total_watched_minutes": int(total_watched_m),
        "avg_runtime": _fmt(avg_runtime_m),
        "avg_runtime_minutes": int(avg_runtime_m),
        "genres": genre_names,
        "collaborators": collaborator_names,
        "avg_movie_score": (round(mean(score for _, score in pairs), 6) if pairs else None),
    }
