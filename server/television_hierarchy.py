"""Shared show → season → episode plumbing, used by both the television router
and the TMDB importer:

  * canonical airing order (`season_rank` within a show, `episode_rank` within a
    season) — always appended, so the per-parent UNIQUE constraints hold;
  * moving an episode between seasons of the same show;
  * merging people onto a show/season/episode, and "populating down" a parent's
    people onto everything beneath it.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Iterable

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .database_models import (
    ACTING_ROLES,
    TELEVISION_EPISODE_ROLES,
    TELEVISION_SEASON_ROLES,
    CastRole,
    TelevisionEpisode,
    TelevisionEpisodeComparison,
    TelevisionEpisodePerson,
    TelevisionSeason,
    TelevisionSeasonPerson,
    TelevisionShow,
    TelevisionShowEpisodeComparison,
    UserTelevisionEpisodeRank,
)
from .ranking import next_rank


def next_season_rank(db: Session, show_id: int) -> Decimal:
    # Query rather than read `show.seasons`: that collection is loaded once and
    # doesn't see seasons created earlier in the same request.
    top = db.scalar(select(func.max(TelevisionSeason.season_rank)).where(TelevisionSeason.show_id == show_id))
    return (top + 1) if top is not None else Decimal(1)


def next_episode_rank(db: Session, season_id: int) -> Decimal:
    top = db.scalar(select(func.max(TelevisionEpisode.episode_rank)).where(TelevisionEpisode.season_id == season_id))
    return (top + 1) if top is not None else Decimal(1)


def move_episode(db: Session, episode: TelevisionEpisode, season: TelevisionSeason) -> None:
    """Re-home `episode` at the end of `season` (same show). Every member's
    personal rank of it moves to the end of their list for the new season (its
    show-wide position is untouched), and their pairwise answers involving it
    follow it: a pair now within one season lives in that season's table, a pair
    across seasons in the show-wide one."""
    if episode.season_id == season.id:
        return
    if season.show_id != episode.show_id:
        raise ValueError("An episode can only move between seasons of its own show")
    episode.episode_rank = next_episode_rank(db, season.id)
    episode.season_id = season.id
    for row in db.scalars(select(UserTelevisionEpisodeRank).where(UserTelevisionEpisodeRank.episode_id == episode.id)):
        row.rank = next_rank(
            db, UserTelevisionEpisodeRank, user_id=row.user_id, guild_id=row.guild_id,
            scope=UserTelevisionEpisodeRank.season_id == season.id,
        )
        row.season_id = season.id

    answers = []
    for model in (TelevisionEpisodeComparison, TelevisionShowEpisodeComparison):
        for cmp in db.scalars(select(model).where(or_(model.winner_id == episode.id, model.loser_id == episode.id))):
            answers.append((cmp.user_id, cmp.guild_id, cmp.winner_id, cmp.loser_id, cmp.created_at))
            db.delete(cmp)
    db.flush()
    others = {w if l == episode.id else l for _, _, w, l, _ in answers}
    season_of = dict(db.execute(
        select(TelevisionEpisode.id, TelevisionEpisode.season_id).where(TelevisionEpisode.id.in_(others))
    ).all()) if others else {}
    for user_id, guild_id, w, l, at in answers:
        other = w if l == episode.id else l
        common = {"user_id": user_id, "guild_id": guild_id, "winner_id": w, "loser_id": l, "created_at": at}
        if season_of.get(other) == season.id:
            db.add(TelevisionEpisodeComparison(season_id=season.id, **common))
        else:
            db.add(TelevisionShowEpisodeComparison(show_id=episode.show_id, **common))
    db.flush()
    db.expire(episode, ["season"])


def merge_people(
    db: Session,
    target: TelevisionSeason | TelevisionEpisode,
    people: Iterable[tuple[int, CastRole]],
) -> int:
    """Add (person_id, role) credits to a season or episode, idempotently.
    Roles the target can't hold (``creator``) are skipped rather than refused —
    this is what lets a show's people flow down without special-casing. An
    actor already on the target isn't double-billed under a second acting role.
    -> links added."""
    if isinstance(target, TelevisionSeason):
        link_model, fk, allowed = TelevisionSeasonPerson, "season_id", TELEVISION_SEASON_ROLES
    else:
        link_model, fk, allowed = TelevisionEpisodePerson, "episode_id", TELEVISION_EPISODE_ROLES
    existing = {(l.person_id, l.role) for l in target.person_links}
    acting = {l.person_id for l in target.person_links if l.role in ACTING_ROLES}
    added = 0
    for person_id, role in people:
        if role not in allowed or (person_id, role) in existing:
            continue
        if role in ACTING_ROLES:
            if person_id in acting:
                continue
            acting.add(person_id)
        existing.add((person_id, role))
        db.add(link_model(**{fk: target.id}, person_id=person_id, role=role, guild_id=target.guild_id))
        added += 1
    if added:
        db.flush()
        db.expire(target, ["person_links"])
    return added


def _credits(links) -> list[tuple[int, CastRole]]:
    return [(l.person_id, l.role) for l in links]


def populate_season_down(db: Session, season: TelevisionSeason) -> int:
    """Copy the season's people onto every one of its episodes. -> links added."""
    # Callers create/move episodes by id, so the loaded collections may be stale.
    db.expire(season, ["person_links", "episodes"])
    people = _credits(season.person_links)
    return sum(merge_people(db, e, people) for e in season.episodes)


def populate_show_down(db: Session, show: TelevisionShow) -> int:
    """Copy the show's people onto every season and every episode (``creator``
    stays show-only). -> links added."""
    db.expire(show, ["person_links", "seasons"])
    people = _credits(show.person_links)
    added = 0
    for season in show.seasons:
        db.expire(season, ["episodes"])
        added += merge_people(db, season, people)
        for e in season.episodes:
            added += merge_people(db, e, people)
    return added
