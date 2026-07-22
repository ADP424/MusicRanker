"""
Game stats router — all aggregate / analytical endpoints.

Game score formula
-------------------
Each game has its own global_rank. Score = 1 / position (1-based rank order).
Person score = mean of scores of all their games.

Differences from movie stats
-----------------------------
* Movies have a fixed ``runtime_minutes`` plus a ``watches`` multiplier; games
  have a single nullable ``hours_played`` that already *is* the total time
  invested. So there is no "unique vs total" runtime split — instead there is a
  tracked/untracked split, and every hours aggregate ignores untracked games
  rather than treating them as zero.
* Games carry a second hierarchical taxonomy (platforms) alongside genres, so
  there is a ``/by-platform`` endpoint shaped exactly like ``/by-genre``.
"""

from __future__ import annotations

from collections import defaultdict
from statistics import mean
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_database
from ..database_models import Game, GamePerson, GamePlatform, Genre, Person
from ..database_models.game_credit import GameRole

router = APIRouter(prefix="/game-stats", tags=["game-stats"])


# ---------------------------------------------------------------------------
# Shared data loader
# ---------------------------------------------------------------------------
def _load(db: Session):
    """
    Returns:
        games:        list of Game in global_rank order
        game_score:   dict[game_id, float]
        person_games: dict[person_id, list[(Game, score)]]
        person_by_id: dict[int, Person]
    """
    games: list[Game] = list(db.scalars(select(Game).order_by(Game.global_rank)).all())
    game_score: dict[int, float] = {g.id: 1.0 / pos for g, pos in zip(games, range(1, len(games) + 1))}

    links: list[GamePerson] = list(db.scalars(select(GamePerson)).all())
    game_by_id: dict[int, Game] = {g.id: g for g in games}
    person_games: dict[int, list[tuple[Game, float]]] = defaultdict(list)
    for link in links:
        g = game_by_id.get(link.game_id)
        if g is not None:
            person_games[link.person_id].append((g, game_score[g.id]))

    persons: list[Person] = list(db.scalars(select(Person)).all())
    person_by_id: dict[int, Person] = {p.id: p for p in persons}
    return games, game_score, person_games, person_by_id


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _hours(game: Game) -> float | None:
    """hours_played is NUMERIC and nullable — None means 'never tracked'."""
    return float(game.hours_played) if game.hours_played is not None else None


def _tracked(games: list[Game]) -> list[Game]:
    return [g for g in games if g.hours_played is not None]


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


def _decade(y: int) -> int:
    return (y // 10) * 10


def _directors(db: Session, person_by_id: dict[int, Person]) -> dict[int, Person]:
    """game_id -> first-linked director, for nationality attribution."""
    links = list(db.scalars(select(GamePerson).where(GamePerson.role == GameRole.director)).all())
    out: dict[int, Person] = {}
    for link in links:
        if link.game_id not in out:
            if p := person_by_id.get(link.person_id):
                out[link.game_id] = p
    return out


# --- taxonomy (genre / platform) helpers -----------------------------------
# Both walk ORM `parents`/`children` rather than junction columns, so they are
# immune to the two junction tables naming their columns differently.


def _ancestors(nodes: list[Any]) -> dict[int, set[int]]:
    parent_of: dict[int, set[int]] = {n.id: {p.id for p in n.parents} for n in nodes}
    ancestors: dict[int, set[int]] = {}
    for nid in parent_of:
        seen: set[int] = set()
        queue = list(parent_of.get(nid, []))
        while queue:
            pid = queue.pop()
            if pid in seen:
                continue
            seen.add(pid)
            queue.extend(parent_of.get(pid, []))
        ancestors[nid] = seen
    return ancestors


def _taxonomy_rows(
    games: list[Game],
    game_score: dict[int, float],
    nodes: list[Any],
    member_fn,
    id_key: str,
    name_key: str,
    count_key: str,
) -> dict[str, list[dict]]:
    """Build the {by_x, by_root_x} payload for a hierarchical taxonomy.

    `member_fn(game)` returns that game's directly-assigned nodes. Counts roll
    up: a game tagged "JRPG" also counts toward "RPG" and every further
    ancestor, matching movie /by-genre semantics.
    """
    by_id = {n.id: n for n in nodes}
    ancestors = _ancestors(nodes)
    roots = {n.id for n in nodes if not n.parents}

    rolled: dict[int, list[Game]] = defaultdict(list)
    direct: dict[int, list[Game]] = defaultdict(list)
    for game in games:
        direct_ids = {n.id for n in member_fn(game)}
        all_ids = set(direct_ids)
        for nid in direct_ids:
            all_ids |= ancestors.get(nid, set())
        for nid in direct_ids:
            direct[nid].append(game)
        for nid in all_ids:
            rolled[nid].append(game)

    def _build(candidate_ids):
        out = []
        for nid in candidate_ids:
            node = by_id.get(nid)
            if node is None:
                continue
            members = rolled.get(nid, [])
            tracked = _tracked(members)
            out.append(
                {
                    id_key: nid,
                    name_key: node.name,
                    count_key: len(members),
                    f"{count_key}_direct": len(direct.get(nid, [])),
                    "avg_game_score": (round(mean(game_score[g.id] for g in members), 6) if members else None),
                    "total_hours": (round(sum(_hours(g) for g in tracked), 1) if tracked else None),
                }
            )
        return sorted(out, key=lambda r: r[name_key])

    return {"all": _build(by_id.keys()), "roots": _build(roots)}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/summary")
def summary(db: Session = Depends(get_database)):
    games, game_score, person_games, person_by_id = _load(db)

    total_games = len(games)
    tracked = _tracked(games)
    total_hours = sum(_hours(g) for g in tracked)
    avg_hours = total_hours / len(tracked) if tracked else 0

    # Only people who actually have a game credit — counting every Person row
    # would report the whole shared people table, which says nothing about games.
    people_credited = len(person_games)
    avg_games_per_person = mean(len(v) for v in person_games.values()) if person_games else 0

    best_year, worst_year = _best_worst(
        games, lambda g: g.release_year, lambda grp: mean(game_score[g.id] for g in grp)
    )
    best_decade, worst_decade = _best_worst(
        games, lambda g: _decade(g.release_year), lambda grp: mean(game_score[g.id] for g in grp)
    )

    game_director = _directors(db, person_by_id)
    games_with_director = [g for g in games if g.id in game_director]
    best_core_nat_games, worst_core_nat_games = _best_worst(
        games_with_director,
        lambda g: game_director[g.id].core_nationality,
        lambda grp: mean(game_score[g.id] for g in grp),
    )
    best_birth_nat_games, worst_birth_nat_games = _best_worst(
        games_with_director,
        lambda g: game_director[g.id].birth_nationality,
        lambda grp: mean(game_score[g.id] for g in grp),
    )

    persons_with_games = [(p, pairs) for pid, pairs in person_games.items() if (p := person_by_id.get(pid)) is not None]
    best_core_nat_people, worst_core_nat_people = _best_worst(
        persons_with_games,
        lambda t: t[0].core_nationality,
        lambda grp: mean(mean(s for _, s in t[1]) for t in grp),
    )
    best_birth_nat_people, worst_birth_nat_people = _best_worst(
        persons_with_games,
        lambda t: t[0].birth_nationality,
        lambda grp: mean(mean(s for _, s in t[1]) for t in grp),
    )

    # Platform is the game-only axis, so it gets a best/worst pair of its own.
    platform_pairs = [(g, p) for g in games for p in g.platforms]
    best_platform, worst_platform = _best_worst(
        platform_pairs,
        lambda t: t[1].name,
        lambda grp: mean(game_score[t[0].id] for t in grp),
    )
    most_played = max(tracked, key=lambda g: _hours(g)) if tracked else None

    return {
        "total_games": total_games,
        "total_people_credited": people_credited,
        "avg_games_per_person": round(avg_games_per_person, 2),
        "games_with_hours_tracked": len(tracked),
        "games_without_hours_tracked": total_games - len(tracked),
        "total_hours_played": round(total_hours, 1),
        "total_days_played": round(total_hours / 24, 2),
        "avg_hours_played": round(avg_hours, 2),
        "most_played_game": most_played.name if most_played else None,
        "most_played_hours": round(_hours(most_played), 1) if most_played else None,
        "best_year_games": best_year,
        "worst_year_games": worst_year,
        "best_decade_games": best_decade,
        "worst_decade_games": worst_decade,
        "best_platform": best_platform,
        "worst_platform": worst_platform,
        "best_core_nationality_games": best_core_nat_games,
        "worst_core_nationality_games": worst_core_nat_games,
        "best_birth_nationality_games": best_birth_nat_games,
        "worst_birth_nationality_games": worst_birth_nat_games,
        "best_core_nationality_people": best_core_nat_people,
        "worst_core_nationality_people": worst_core_nat_people,
        "best_birth_nationality_people": best_birth_nat_people,
        "worst_birth_nationality_people": worst_birth_nat_people,
    }


@router.get("/by-year")
def by_year(db: Session = Depends(get_database)):
    games, game_score, _, _ = _load(db)
    rows = _group_stats(games, key_fn=lambda g: g.release_year, score_fn=lambda g: game_score[g.id])
    for row in rows:
        row["game_count"] = row.pop("count")
        row["year"] = row.pop("key")
    return sorted(rows, key=lambda r: r["year"])


@router.get("/by-decade")
def by_decade(db: Session = Depends(get_database)):
    games, game_score, _, _ = _load(db)
    rows = _group_stats(games, key_fn=lambda g: _decade(g.release_year), score_fn=lambda g: game_score[g.id])
    for row in rows:
        row["game_count"] = row.pop("count")
        row["decade"] = row.pop("key")
    return sorted(rows, key=lambda r: r["decade"])


@router.get("/by-nationality")
def by_nationality(db: Session = Depends(get_database)):
    games, game_score, _, person_by_id = _load(db)
    game_director = _directors(db, person_by_id)
    games_with_director = [g for g in games if g.id in game_director]

    result = {}
    for nat_type in ("core_nationality", "birth_nationality"):
        rows = _group_stats(
            games_with_director,
            key_fn=lambda g, nt=nat_type: getattr(game_director[g.id], nt),
            score_fn=lambda g: game_score[g.id],
        )
        result[nat_type] = [
            {
                "nationality": r["key"],
                "game_count": r["count"],
                "avg_game_score": r.get("avg_score"),
            }
            for r in rows
        ]
    return result


@router.get("/by-genre")
def by_genre(db: Session = Depends(get_database)):
    games, game_score, _, _ = _load(db)
    genres = list(db.scalars(select(Genre).where(Genre.is_game.is_(True))).all())
    built = _taxonomy_rows(
        games,
        game_score,
        genres,
        member_fn=lambda g: g.genres,
        id_key="genre_id",
        name_key="genre_name",
        count_key="game_count",
    )
    return {"by_genre": built["all"], "by_root_genre": built["roots"]}


@router.get("/by-platform")
def by_platform(db: Session = Depends(get_database)):
    games, game_score, _, _ = _load(db)
    platforms = list(db.scalars(select(GamePlatform)).all())
    built = _taxonomy_rows(
        games,
        game_score,
        platforms,
        member_fn=lambda g: g.platforms,
        id_key="platform_id",
        name_key="platform_name",
        count_key="game_count",
    )
    return {"by_platform": built["all"], "by_root_platform": built["roots"]}


@router.get("/scatter")
def scatter(db: Session = Depends(get_database)):
    games, game_score, person_games, person_by_id = _load(db)

    game_scatter = [
        {
            "game_id": g.id,
            "name": g.name,
            "score": round(game_score[g.id], 6),
            "hours_played": _hours(g),
        }
        for g in _tracked(games)
    ]

    person_scatter = []
    for pid, pairs in person_games.items():
        p = person_by_id.get(pid)
        if not p or not pairs:
            continue
        tracked = [(g, s) for g, s in pairs if g.hours_played is not None]
        if not tracked:
            continue
        person_scatter.append(
            {
                "person_id": pid,
                "name": p.name,
                "avg_score": round(mean(s for _, s in tracked), 6),
                "avg_hours_played": round(mean(_hours(g) for g, _ in tracked), 2),
            }
        )

    return {
        "game_score_vs_hours": game_scatter,
        "person_score_vs_hours": person_scatter,
    }


@router.get("/person-detail/{pid}")
def person_detail(pid: int, db: Session = Depends(get_database)):
    _, game_score, person_games, person_by_id = _load(db)
    if person_by_id.get(pid) is None:
        raise HTTPException(404, "Person not found")

    pairs = person_games.get(pid, [])
    games = [g for g, _ in pairs]
    tracked = _tracked(games)
    total_hours = sum(_hours(g) for g in tracked)

    genre_names = sorted({genre.name for g in games for genre in g.genres})
    platform_names = sorted({p.name for g in games for p in g.platforms})

    collaborator_ids: set[int] = set()
    for game in games:
        collaborator_ids.update(
            db.scalars(
                select(GamePerson.person_id).where(
                    GamePerson.game_id == game.id,
                    GamePerson.person_id != pid,
                )
            ).all()
        )
    collaborator_names = (
        sorted(p.name for p in db.scalars(select(Person).where(Person.id.in_(collaborator_ids))).all())
        if collaborator_ids
        else []
    )

    return {
        "game_count": len(pairs),
        "games_with_hours_tracked": len(tracked),
        "total_hours_played": round(total_hours, 1),
        "avg_hours_played": round(total_hours / len(tracked), 2) if tracked else None,
        "genres": genre_names,
        "platforms": platform_names,
        "collaborators": collaborator_names,
        "avg_game_score": (round(mean(s for _, s in pairs), 6) if pairs else None),
    }
