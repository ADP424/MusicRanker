"""
Television stats router — mirrors movie_stats, adapted to the show/episode split.

Television score formulas
-------------------------
Each show has its own global_rank:      show_score    = 1 / show position
Each episode is ranked within its show: episode_score = 1 / position in show
Combining the two gives a cross-show episode score:
                                        episode_global_score = show_score * episode_score

Person score = mean over every item they are credited on, where an item scores
``show_score`` for a show-level credit and ``episode_global_score`` for an
episode-level credit.
"""

from __future__ import annotations

from collections import defaultdict
from statistics import mean
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_database
from ..database_models import (
    Genre,
    Person,
    TelevisionEpisode,
    TelevisionEpisodePerson,
    TelevisionShow,
    TelevisionShowPerson,
)
from ..database_models.genre_parent import genre_parents
from ..database_models.movie_cast_member import CastRole
from ..database_models.television import television_show_genres_junction
from ..database_models.television_episode import television_episode_genres_junction

router = APIRouter(prefix="/television-stats", tags=["television-stats"])


# ---------------------------------------------------------------------------
# Shared data loader
# ---------------------------------------------------------------------------
class TvData:
    def __init__(self, db: Session):
        self.shows: list[TelevisionShow] = list(
            db.scalars(select(TelevisionShow).order_by(TelevisionShow.global_rank)).all()
        )
        self.show_score: dict[int, float] = {s.id: 1.0 / pos for pos, s in enumerate(self.shows, start=1)}

        self.episodes: list[TelevisionEpisode] = []
        self.episode_score: dict[int, float] = {}  # local (within show)
        self.episode_global_score: dict[int, float] = {}  # show_score * local
        self.show_episodes: dict[int, list[TelevisionEpisode]] = {}
        for show in self.shows:
            eps = sorted(show.episodes, key=lambda e: (e.episode_rank is None, e.episode_rank, e.id))
            self.show_episodes[show.id] = eps
            for pos, ep in enumerate(eps, start=1):
                self.episodes.append(ep)
                self.episode_score[ep.id] = 1.0 / pos
                self.episode_global_score[ep.id] = self.show_score[show.id] * (1.0 / pos)

        show_by_id = {s.id: s for s in self.shows}
        ep_by_id = {e.id: e for e in self.episodes}
        self.show_by_id = show_by_id
        self.episode_by_id = ep_by_id

        self.person_shows: dict[int, list[tuple[TelevisionShow, float]]] = defaultdict(list)
        for link in db.scalars(select(TelevisionShowPerson)).all():
            s = show_by_id.get(link.show_id)
            if s is not None:
                self.person_shows[link.person_id].append((s, self.show_score[s.id]))

        self.person_episodes: dict[int, list[tuple[TelevisionEpisode, float]]] = defaultdict(list)
        for link in db.scalars(select(TelevisionEpisodePerson)).all():
            e = ep_by_id.get(link.episode_id)
            if e is not None:
                self.person_episodes[link.person_id].append((e, self.episode_global_score[e.id]))

        self.person_by_id: dict[int, Person] = {p.id: p for p in db.scalars(select(Person)).all()}

        # A show's "primary" person for nationality stats: its first show-level
        # creator, falling back to the first director credited on any episode.
        self.show_director: dict[int, Person] = {}
        for link in db.scalars(
            select(TelevisionShowPerson).where(TelevisionShowPerson.role == CastRole.creator)
        ).all():
            if link.show_id not in self.show_director:
                if p := self.person_by_id.get(link.person_id):
                    self.show_director[link.show_id] = p
        for link in db.scalars(
            select(TelevisionEpisodePerson).where(TelevisionEpisodePerson.role == CastRole.director)
        ).all():
            ep = ep_by_id.get(link.episode_id)
            if ep is None or ep.show_id in self.show_director:
                continue
            if p := self.person_by_id.get(link.person_id):
                self.show_director[ep.show_id] = p

    def credited_person_ids(self) -> set[int]:
        return set(self.person_shows) | set(self.person_episodes)

    def person_items(self, pid: int) -> list[float]:
        return [score for _, score in self.person_shows.get(pid, [])] + [
            score for _, score in self.person_episodes.get(pid, [])
        ]

    def episode_director(self, ep: TelevisionEpisode) -> Person | None:
        return self.show_director.get(ep.show_id)


def _load(db: Session) -> TvData:
    return TvData(db)


# ---------------------------------------------------------------------------
# Helpers (same shapes as movie_stats)
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


def _genre_ancestors(db: Session) -> dict[int, set[int]]:
    rows = db.execute(select(genre_parents.c.genre_id, genre_parents.c.parent_genre_id)).all()
    parent_of: dict[int, set[int]] = defaultdict(set)
    for child_id, parent_id in rows:
        parent_of[child_id].add(parent_id)
    all_genre_ids = {gid for gid, _ in rows} | {pid for _, pid in rows}
    ancestors: dict[int, set[int]] = {}
    for gid in all_genre_ids:
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
    return ancestors


def _root_genre_ids(db: Session) -> set[int]:
    """IDs of television genres with no parents."""
    has_parent = select(genre_parents.c.genre_id)
    return {
        g.id for g in db.scalars(select(Genre).where(Genre.id.not_in(has_parent), Genre.is_television.is_(True))).all()
    }


def _fmt(minutes: float) -> str:
    h = int(minutes // 60)
    m = int(minutes % 60)
    return f"{h}:{m:02d}"


def _decade(y: int) -> int:
    return (y // 10) * 10


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/summary")
def summary(db: Session = Depends(get_database)):
    d = _load(db)
    total_shows = len(d.shows)
    total_episodes = len(d.episodes)
    credited = d.credited_person_ids()

    unique_runtime_h = sum(e.runtime_minutes for e in d.episodes) / 60
    total_watched_h = sum(e.runtime_minutes * e.watches for e in d.episodes) / 60

    avg_episodes_per_show = total_episodes / total_shows if total_shows else 0
    avg_shows_per_person = mean(len(v) for v in d.person_shows.values()) if d.person_shows else 0
    avg_eps_per_person = mean(len(v) for v in d.person_episodes.values()) if d.person_episodes else 0

    best_year_shows, worst_year_shows = _best_worst(
        d.shows, lambda s: s.release_year, lambda g: mean(d.show_score[s.id] for s in g)
    )
    best_year_eps, worst_year_eps = _best_worst(
        d.episodes, lambda e: e.release_year, lambda g: mean(d.episode_global_score[e.id] for e in g)
    )
    best_decade_shows, worst_decade_shows = _best_worst(
        d.shows, lambda s: _decade(s.release_year), lambda g: mean(d.show_score[s.id] for s in g)
    )
    best_decade_eps, worst_decade_eps = _best_worst(
        d.episodes, lambda e: _decade(e.release_year), lambda g: mean(d.episode_global_score[e.id] for e in g)
    )

    shows_with_director = [s for s in d.shows if s.id in d.show_director]
    best_core_nat_shows, worst_core_nat_shows = _best_worst(
        shows_with_director,
        lambda s: d.show_director[s.id].core_nationality,
        lambda g: mean(d.show_score[s.id] for s in g),
    )
    best_birth_nat_shows, worst_birth_nat_shows = _best_worst(
        shows_with_director,
        lambda s: d.show_director[s.id].birth_nationality,
        lambda g: mean(d.show_score[s.id] for s in g),
    )

    persons_with_items = [
        (p, d.person_items(pid))
        for pid in credited
        if (p := d.person_by_id.get(pid)) is not None and d.person_items(pid)
    ]
    best_core_nat_cast, worst_core_nat_cast = _best_worst(
        persons_with_items,
        lambda t: t[0].core_nationality,
        lambda g: mean(mean(t[1]) for t in g),
    )
    best_birth_nat_cast, worst_birth_nat_cast = _best_worst(
        persons_with_items,
        lambda t: t[0].birth_nationality,
        lambda g: mean(mean(t[1]) for t in g),
    )

    most_eps_show = max(d.shows, key=lambda s: len(d.show_episodes[s.id]), default=None)

    return {
        "total_cast_members": len(credited),
        "total_shows": total_shows,
        "total_episodes": total_episodes,
        "avg_episodes_per_show": round(avg_episodes_per_show, 2),
        "avg_shows_per_cast_member": round(avg_shows_per_person, 2),
        "avg_episodes_per_cast_member": round(avg_eps_per_person, 2),
        "unique_runtime_hours": round(unique_runtime_h, 2),
        "unique_runtime_days": round(unique_runtime_h / 24, 2),
        "avg_episode_runtime_hours": round(unique_runtime_h / total_episodes, 2) if total_episodes else 0,
        "avg_show_runtime_hours": round(unique_runtime_h / total_shows, 2) if total_shows else 0,
        "total_watched_hours": round(total_watched_h, 2),
        "total_watched_days": round(total_watched_h / 24, 2),
        "avg_watched_hours_per_show": round(total_watched_h / total_shows, 2) if total_shows else 0,
        "avg_watched_hours_per_episode": round(total_watched_h / total_episodes, 2) if total_episodes else 0,
        "most_episodes_show": most_eps_show.name if most_eps_show else None,
        "most_episodes_count": len(d.show_episodes[most_eps_show.id]) if most_eps_show else None,
        "best_year_shows": best_year_shows,
        "worst_year_shows": worst_year_shows,
        "best_year_episodes": best_year_eps,
        "worst_year_episodes": worst_year_eps,
        "best_decade_shows": best_decade_shows,
        "worst_decade_shows": worst_decade_shows,
        "best_decade_episodes": best_decade_eps,
        "worst_decade_episodes": worst_decade_eps,
        "best_core_nationality_shows": best_core_nat_shows,
        "worst_core_nationality_shows": worst_core_nat_shows,
        "best_birth_nationality_shows": best_birth_nat_shows,
        "worst_birth_nationality_shows": worst_birth_nat_shows,
        "best_core_nationality_cast": best_core_nat_cast,
        "worst_core_nationality_cast": worst_core_nat_cast,
        "best_birth_nationality_cast": best_birth_nat_cast,
        "worst_birth_nationality_cast": worst_birth_nat_cast,
    }


def _bucket_rows(d: TvData, bucket_fn) -> list[dict]:
    buckets: dict[int, dict[str, list[float]]] = defaultdict(lambda: {"shows": [], "episodes": []})
    for s in d.shows:
        buckets[bucket_fn(s.release_year)]["shows"].append(d.show_score[s.id])
    for e in d.episodes:
        buckets[bucket_fn(e.release_year)]["episodes"].append(d.episode_global_score[e.id])
    rows = []
    for key, vals in buckets.items():
        rows.append(
            {
                "key": key,
                "show_count": len(vals["shows"]),
                "avg_show_score": round(mean(vals["shows"]), 6) if vals["shows"] else None,
                "episode_count": len(vals["episodes"]),
                "avg_episode_score": round(mean(vals["episodes"]), 6) if vals["episodes"] else None,
            }
        )
    return sorted(rows, key=lambda r: r["key"])


@router.get("/by-year")
def by_year(db: Session = Depends(get_database)):
    rows = _bucket_rows(_load(db), lambda y: y)
    for r in rows:
        r["year"] = r.pop("key")
    return rows


@router.get("/by-decade")
def by_decade(db: Session = Depends(get_database)):
    rows = _bucket_rows(_load(db), _decade)
    for r in rows:
        r["decade"] = r.pop("key")
    return rows


@router.get("/by-nationality")
def by_nationality(db: Session = Depends(get_database)):
    d = _load(db)
    result: dict[str, list[dict]] = {}
    for nat_type in ("core_nationality", "birth_nationality"):
        groups: dict[str, dict[str, list[float]]] = defaultdict(lambda: {"shows": [], "episodes": []})
        for s in d.shows:
            p = d.show_director.get(s.id)
            if p is None:
                continue
            groups[getattr(p, nat_type)]["shows"].append(d.show_score[s.id])
        for e in d.episodes:
            p = d.episode_director(e)
            if p is None:
                continue
            groups[getattr(p, nat_type)]["episodes"].append(d.episode_global_score[e.id])
        result[nat_type] = sorted(
            (
                {
                    "nationality": nat,
                    "show_count": len(v["shows"]),
                    "avg_show_score": round(mean(v["shows"]), 6) if v["shows"] else None,
                    "episode_count": len(v["episodes"]),
                    "avg_episode_score": round(mean(v["episodes"]), 6) if v["episodes"] else None,
                }
                for nat, v in groups.items()
            ),
            key=lambda r: r["nationality"],
        )
    return result


@router.get("/by-genre")
def by_genre(db: Session = Depends(get_database)):
    d = _load(db)
    genre_by_id: dict[int, Genre] = {
        g.id: g for g in db.scalars(select(Genre).where(Genre.is_television.is_(True))).all()
    }
    roots = _root_genre_ids(db)
    ancestors = _genre_ancestors(db)

    show_gids: dict[int, list[int]] = defaultdict(list)
    for show_id, genre_id in db.execute(
        select(television_show_genres_junction.c.show_id, television_show_genres_junction.c.genre_id)
    ).all():
        show_gids[show_id].append(genre_id)
    ep_gids: dict[int, list[int]] = defaultdict(list)
    for ep_id, genre_id in db.execute(
        select(television_episode_genres_junction.c.episode_id, television_episode_genres_junction.c.genre_id)
    ).all():
        ep_gids[ep_id].append(genre_id)

    genre_shows: dict[int, list[float]] = defaultdict(list)
    genre_shows_direct: dict[int, int] = defaultdict(int)
    genre_eps: dict[int, list[float]] = defaultdict(list)
    genre_eps_direct: dict[int, int] = defaultdict(int)

    def _expand(gids: list[int]) -> set[int]:
        out: set[int] = set(gids)
        for gid in gids:
            out |= ancestors.get(gid, set())
        return out

    for show_id, gids in show_gids.items():
        if show_id not in d.show_by_id:
            continue
        score = d.show_score[show_id]
        for gid in _expand(gids):
            genre_shows[gid].append(score)
        for gid in set(gids):
            genre_shows_direct[gid] += 1
    for ep_id, gids in ep_gids.items():
        if ep_id not in d.episode_by_id:
            continue
        score = d.episode_global_score[ep_id]
        for gid in _expand(gids):
            genre_eps[gid].append(score)
        for gid in set(gids):
            genre_eps_direct[gid] += 1

    def _build(candidate_gids):
        result = []
        for gid in candidate_gids:
            g = genre_by_id.get(gid)
            if g is None:
                continue
            s, e = genre_shows.get(gid, []), genre_eps.get(gid, [])
            result.append(
                {
                    "genre_id": gid,
                    "genre_name": g.name,
                    "show_count": len(s),
                    "show_count_direct": genre_shows_direct.get(gid, 0),
                    "avg_show_score": round(mean(s), 6) if s else None,
                    "episode_count": len(e),
                    "episode_count_direct": genre_eps_direct.get(gid, 0),
                    "avg_episode_score": round(mean(e), 6) if e else None,
                }
            )
        return sorted(result, key=lambda r: r["genre_name"])

    return {
        "by_genre": _build(set(genre_by_id.keys())),
        "by_root_genre": _build(roots),
    }


@router.get("/by-show")
def by_show(db: Session = Depends(get_database)):
    """TV-specific: one row per show, rolling up its episodes."""
    d = _load(db)
    rows = []
    for pos, show in enumerate(d.shows, start=1):
        eps = d.show_episodes[show.id]
        runtime = sum(e.runtime_minutes for e in eps)
        watched = sum(e.runtime_minutes * e.watches for e in eps)
        rows.append(
            {
                "show_id": show.id,
                "show_name": show.name,
                "position": pos,
                "show_score": round(d.show_score[show.id], 6),
                "release_year": show.release_year,
                "episode_count": len(eps),
                "total_watches": sum(e.watches for e in eps),
                "total_runtime_minutes": runtime,
                "total_watched_minutes": watched,
                "avg_episode_runtime_minutes": round(runtime / len(eps), 2) if eps else None,
            }
        )
    return rows


@router.get("/scatter")
def scatter(db: Session = Depends(get_database)):
    d = _load(db)
    show_scatter = [
        {
            "show_id": s.id,
            "name": s.name,
            "score": round(d.show_score[s.id], 6),
            "episode_count": len(d.show_episodes[s.id]),
            "runtime_minutes": sum(e.runtime_minutes for e in d.show_episodes[s.id]),
        }
        for s in d.shows
    ]
    episode_scatter = [
        {
            "episode_id": e.id,
            "name": e.name,
            "show_name": d.show_by_id[e.show_id].name,
            "score": round(d.episode_global_score[e.id], 6),
            "local_score": round(d.episode_score[e.id], 6),
            "runtime_minutes": e.runtime_minutes,
        }
        for e in d.episodes
    ]
    cast_scatter = []
    for pid in d.credited_person_ids():
        p = d.person_by_id.get(pid)
        scores = d.person_items(pid)
        eps = d.person_episodes.get(pid, [])
        if not p or not scores:
            continue
        cast_scatter.append(
            {
                "cast_member_id": pid,
                "name": p.name,
                "avg_score": round(mean(scores), 6),
                "episode_count": len(eps),
                "avg_runtime_minutes": round(mean(e.runtime_minutes for e, _ in eps), 2) if eps else 0,
            }
        )
    return {
        "show_score_vs_runtime": show_scatter,
        "episode_score_vs_runtime": episode_scatter,
        "cast_member_score_vs_runtime": cast_scatter,
    }


@router.get("/cast-member-detail/{pid}")
def cast_member_detail(pid: int, db: Session = Depends(get_database)):
    d = _load(db)
    p = d.person_by_id.get(pid)
    if p is None:
        raise HTTPException(404, "Person not found")

    show_pairs = d.person_shows.get(pid, [])
    ep_pairs = d.person_episodes.get(pid, [])
    total_runtime_m = sum(e.runtime_minutes for e, _ in ep_pairs)
    total_watched_m = sum(e.runtime_minutes * e.watches for e, _ in ep_pairs)
    avg_runtime_m = total_runtime_m / len(ep_pairs) if ep_pairs else 0

    show_ids = {s.id for s, _ in show_pairs} | {e.show_id for e, _ in ep_pairs}
    ep_ids = [e.id for e, _ in ep_pairs]

    gids: set[int] = set()
    if show_ids:
        gids.update(
            db.execute(
                select(television_show_genres_junction.c.genre_id).where(
                    television_show_genres_junction.c.show_id.in_(show_ids)
                )
            )
            .scalars()
            .all()
        )
    if ep_ids:
        gids.update(
            db.execute(
                select(television_episode_genres_junction.c.genre_id).where(
                    television_episode_genres_junction.c.episode_id.in_(ep_ids)
                )
            )
            .scalars()
            .all()
        )
    genre_names = sorted(g.name for g in db.scalars(select(Genre).where(Genre.id.in_(gids))).all()) if gids else []

    collaborator_ids: set[int] = set()
    if show_ids:
        collaborator_ids.update(
            db.scalars(
                select(TelevisionShowPerson.person_id).where(
                    TelevisionShowPerson.show_id.in_(show_ids), TelevisionShowPerson.person_id != pid
                )
            ).all()
        )
    if ep_ids:
        collaborator_ids.update(
            db.scalars(
                select(TelevisionEpisodePerson.person_id).where(
                    TelevisionEpisodePerson.episode_id.in_(ep_ids), TelevisionEpisodePerson.person_id != pid
                )
            ).all()
        )
    collaborator_names = (
        sorted(p2.name for p2 in db.scalars(select(Person).where(Person.id.in_(collaborator_ids))).all())
        if collaborator_ids
        else []
    )

    return {
        "show_count": len(show_ids),
        "show_credit_count": len(show_pairs),
        "episode_count": len(ep_pairs),
        "total_runtime": _fmt(total_runtime_m),
        "total_runtime_minutes": int(total_runtime_m),
        "total_watched_runtime": _fmt(total_watched_m),
        "total_watched_minutes": int(total_watched_m),
        "avg_runtime": _fmt(avg_runtime_m),
        "avg_runtime_minutes": int(avg_runtime_m),
        "genres": genre_names,
        "collaborators": collaborator_names,
        "avg_show_score": round(mean(score for _, score in show_pairs), 6) if show_pairs else None,
        "avg_episode_score": round(mean(score for _, score in ep_pairs), 6) if ep_pairs else None,
    }
