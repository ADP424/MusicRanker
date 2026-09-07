from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database_models import (
    Album, Artist, Game, GamePlatform, Genre, Movie, Person, TelevisionShow,
)
from ..normalize import norm, norm_or_none
from .spec import Candidate, Item, MergeAction

# Which entity carries a year in its conflict key (D4).
_YEARED = {Album, Movie, Game, TelevisionShow}


def _keys(row) -> set[str]:
    return {k for k in (norm(row.name), norm_or_none(getattr(row, "name_en", None))) if k}


def _index(rows) -> dict[str, list]:
    idx: dict[str, list] = defaultdict(list)
    for r in rows:
        for k in _keys(r):
            idx[k].append(r)
    return idx


def _media_titles(person: Person) -> set[str]:
    """Every normalised media title this person is credited on — the evidence
    used to promote a name collision to a verified identity match."""
    out: set[str] = set()
    for link in person.movie_links:
        out |= _keys(link.movie)
    for link in person.television_links:
        out |= _keys(link.show)
    for link in person.game_links:
        out |= _keys(link.game)
    for link in person.artist_links:
        out |= _keys(link.artist)
    return out


def _person_candidates(src: Person, idx: dict[str, list]) -> list[Candidate]:
    seen: dict[int, Candidate] = {}
    src_titles = _media_titles(src)
    for k in _keys(src):
        for tgt in idx.get(k, ()):
            if tgt.id in seen:
                continue
            shared = src_titles & _media_titles(tgt)
            if shared:
                seen[tgt.id] = Candidate(
                    tgt.id, tgt.name, tgt.name_en, "verified",
                    f"{len(shared)} shared credit(s): " + ", ".join(sorted(shared)[:3]),
                )
            else:
                seen[tgt.id] = Candidate(tgt.id, tgt.name, tgt.name_en, "name_only", "Name matches; nothing corroborates it")
    return list(seen.values())


def _simple_candidates(src, idx: dict[str, list], *, match_year: bool) -> list[Candidate]:
    out: dict[int, Candidate] = {}
    for k in _keys(src):
        for tgt in idx.get(k, ()):
            if tgt.id in out:
                continue
            if match_year and getattr(src, "release_year", None) != getattr(tgt, "release_year", None):
                continue  # "Dune (1984)" and "Dune (2021)" are not the same film
            out[tgt.id] = Candidate(tgt.id, tgt.name, tgt.name_en, "name_only", "Name (and year) match")
    return list(out.values())


def _fetch(db: Session, model, guild_id: int):
    return db.scalars(select(model).where(model.guild_id == guild_id)).all()


def build_preview(db: Session, source_guild_id: int, target_guild_id: int) -> dict[str, list[Item]]:
    out: dict[str, list[Item]] = {}

    # ── Genres & platforms: name-only, default to MERGE (D5). Their entire
    #    identity is a name plus parentage, so duplicating "Rock" is a bug, not a
    #    feature. They get their own wizard sections rather than being asked about
    #    once per media entry.
    for key, model in (("genres", Genre), ("platforms", GamePlatform)):
        idx = _index(_fetch(db, model, target_guild_id))
        items = []
        for src in _fetch(db, model, source_guild_id):
            cands = _simple_candidates(src, idx, match_year=False)
            items.append(
                Item(
                    src.id, src.name, getattr(src, "name_en", None), None, "",
                    cands,
                    MergeAction.merge if cands else MergeAction.duplicate,
                    cands[0].target_id if cands else None,
                )
            )
        out[key] = items

    # ── People: verified vs name_only, exactly like the TMDB importer. A decision
    #    is made once and then reused for every media entry that credits them.
    idx = _index(_fetch(db, Person, target_guild_id))
    items = []
    for src in _fetch(db, Person, source_guild_id):
        cands = _person_candidates(src, idx)
        verified = next((c for c in cands if c.match == "verified"), None)
        items.append(
            Item(
                src.id, src.name, src.name_en, None, src.core_nationality, cands,
                MergeAction.merge if verified else MergeAction.duplicate,
                verified.target_id if verified else None,
            )
        )
    out["people"] = items

    for key, model, sub in (
        ("artists", Artist, lambda r: r.core_nationality),
        ("albums", Album, lambda r: f"{r.release_year}"),
        ("movies", Movie, lambda r: f"{r.release_year} · {r.runtime_minutes} min"),
        ("games", Game, lambda r: f"{r.release_year}"),
        ("television_shows", TelevisionShow, lambda r: f"{r.release_year} · {len(r.episodes)} episodes"),
    ):
        idx = _index(_fetch(db, model, target_guild_id))
        out[key] = [
            Item(
                src.id, src.name, src.name_en, getattr(src, "release_year", None), sub(src),
                _simple_candidates(src, idx, match_year=model in _YEARED),
                MergeAction.duplicate, None,
            )
            for src in _fetch(db, model, source_guild_id)
        ]
    return out
