"""Schemas for the generic person-link scans (television, games). The movie
scan keeps its own, movie-shaped ones in `movie_person_scan.py`."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from .base import ORMSchema

EntityKind = Literal["show", "season", "episode", "game"]


class PersonScanStartIn(BaseModel):
    # Shows for the television scan, games for the game scan.
    entity_ids: Optional[list[int]] = Field(default=None, min_length=1)
    force_refresh: bool = False


class PersonScanStatsOut(ORMSchema):
    items_total: int
    items_in_scope: int
    items_resolved: int
    items_unresolved: int
    network_calls: int
    cache_hits: int


class PersonScanJobOut(ORMSchema):
    id: str
    status: Literal["pending", "running", "done", "cancelled", "error"]
    phase: Literal["queued", "loading", "fetching", "matching", "finished"]
    processed: int
    total: int
    last_item: Optional[str] = None
    error: Optional[str] = None
    candidate_count: Optional[int] = None
    stats: Optional[PersonScanStatsOut] = None


class PersonScanCandidateOut(ORMSchema):
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


class PersonScanUnresolvedOut(ORMSchema):
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
