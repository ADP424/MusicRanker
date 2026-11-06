"""Schemas for the person-link scans: TMDB (movies + television) and IGDB."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

EntityKind = Literal["movie", "show", "season", "episode", "game"]
Verdict = Literal["verified", "name_only", "conflict", ""]


class PersonScanStartIn(BaseModel):
    # Scope the scan to these entities (all of them when omitted). Which kind
    # they are: "movie" or "show" for the TMDB scan, "game" for IGDB; defaults
    # to the scan's first.
    entity_ids: Optional[list[int]] = Field(default=None, min_length=1)
    entity_kind: Optional[EntityKind] = None
    force_refresh: bool = False


class PersonScanStatsOut(BaseModel):
    items_total: int
    items_in_scope: int
    items_resolved: int
    items_unresolved: int
    network_calls: int
    cache_hits: int


class PersonScanJobOut(BaseModel):
    id: str
    status: Literal["pending", "running", "done", "cancelled", "error"]
    phase: Literal["queued", "loading", "fetching", "matching", "finished"]
    processed: int
    total: int
    last_item: Optional[str] = None
    error: Optional[str] = None
    candidate_count: Optional[int] = None
    stats: Optional[PersonScanStatsOut] = None
    scoped: bool = False  # limited to some entities, not a full scan
    created_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class PersonScanCandidateOut(BaseModel):
    key: str
    person_id: int
    person_name: str
    entity_kind: EntityKind
    entity_id: int
    entity_name: str
    entity_year: Optional[int]
    context: Optional[str]
    credit_type: Literal["cast", "guest", "crew", "company"]
    slot: str
    character: Optional[str]
    billing_order: Optional[int]
    job: Optional[str]
    episode_count: Optional[int]
    suggested_role: str
    roles: list[str]
    suggestion_reason: str
    match: Literal["verified", "name_only"]
    overlap: int
    source_person_id: int
    source_popularity: float
    suppressed: bool
    verdict: Verdict = ""
    # medium ("movie" / "show") -> [linked works that corroborate, linked works checked]
    evidence: dict[str, tuple[int, int]] = {}


class PersonScanUnresolvedOut(BaseModel):
    entity_kind: EntityKind
    id: int
    name: str
    release_year: Optional[int]
    reason: str


class PersonScanResultsOut(BaseModel):
    job_id: str
    candidates: list[PersonScanCandidateOut]
    unresolved: list[PersonScanUnresolvedOut]


class PersonScanLinkIn(BaseModel):
    entity_kind: EntityKind
    entity_id: int
    person_id: int
    role: str


class PersonScanSlotIn(BaseModel):
    entity_kind: EntityKind
    entity_id: int
    person_id: int
    slot: str


class PersonScanApplyIn(BaseModel):
    links: list[PersonScanLinkIn] = []
    suppress: list[PersonScanSlotIn] = []
    unsuppress: list[PersonScanSlotIn] = []


class PersonScanApplyOut(BaseModel):
    created: int
    skipped: int  # link already existed
    invalid: list[PersonScanLinkIn]  # entity/person gone, or a role that kind can't hold
    suppressed: int
    unsuppressed: int


class PersonScanSuppressionOut(BaseModel):
    entity_kind: EntityKind
    entity_id: int
    entity_name: Optional[str]
    person_id: int
    person_name: Optional[str]
    slot: str


class PersonScanSuppressionListOut(BaseModel):
    count: int
    items: list[PersonScanSuppressionOut]
