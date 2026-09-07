from __future__ import annotations

import enum
from dataclasses import dataclass, field


class MergeAction(str, enum.Enum):
    duplicate = "duplicate"  # create a brand-new entry in the target
    merge = "merge"          # reuse the matched target entry
    skip = "skip"            # do not bring this over at all


@dataclass(frozen=True)
class Candidate:
    target_id: int
    name: str
    name_en: str | None
    #: "verified" — corroborated by shared catalogue evidence (same trick the
    #: TMDB importer uses: a shared, normalised media title). "name_only" — the
    #: names merely collide. Surfaced verbatim in the wizard (D5).
    match: str
    evidence: str


@dataclass
class Item:
    source_id: int
    name: str
    name_en: str | None
    year: int | None
    subtitle: str  # "1999 · 136 min", "12 episodes", …
    candidates: list[Candidate] = field(default_factory=list)
    default_action: MergeAction = MergeAction.duplicate
    default_target_id: int | None = None


@dataclass
class Decision:
    action: MergeAction
    target_id: int | None = None


#: Order matters: leaves first, then the media that reference them.
SECTIONS = ("genres", "platforms", "people", "artists", "albums", "movies", "games", "television_shows")
