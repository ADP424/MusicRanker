from typing import Literal, Optional

from pydantic import BaseModel, Field

from ..database_models import CastRole
from .base import ORMSchema

Slot = Literal["cast", "director", "composer"]


class ScanStartIn(BaseModel):
    movie_ids: Optional[list[int]] = Field(default=None, min_length=1)
    force_refresh: bool = False


class ScanStatsOut(ORMSchema):
    movies_total: int
    movies_in_scope: int
    movies_resolved: int
    movies_unresolved: int
    network_calls: int
    cache_hits: int
    revalidated: int


class ScanJobOut(ORMSchema):
    id: str
    status: Literal["pending", "running", "done", "cancelled", "error"]
    phase: Literal["queued", "loading", "fetching", "matching", "finished"]
    processed: int
    total: int
    last_movie: Optional[str] = None
    error: Optional[str] = None
    candidate_count: Optional[int] = None
    stats: Optional[ScanStatsOut] = None


class ScanCandidateOut(ORMSchema):
    key: str
    person_id: int
    person_name: str
    movie_id: int
    movie_name: str
    movie_year: Optional[int]
    credit_type: Literal["cast", "crew"]
    slot: Slot
    character: Optional[str]
    billing_order: Optional[int]
    job: Optional[str]
    suggested_role: CastRole
    suggestion_reason: str
    match: Literal["verified", "name_only"]
    overlap: int
    tmdb_person_id: int
    tmdb_popularity: float
    suppressed: bool


class UnresolvedMovieOut(ORMSchema):
    id: int
    name: str
    release_year: Optional[int]


class ScanResultsOut(ORMSchema):
    job_id: str
    candidates: list[ScanCandidateOut]
    unresolved_movies: list[UnresolvedMovieOut]


class ScanLinkIn(BaseModel):
    movie_id: int
    person_id: int
    role: CastRole


class ScanSlotIn(BaseModel):
    movie_id: int
    person_id: int
    slot: Slot


class ScanApplyIn(BaseModel):
    links: list[ScanLinkIn] = []
    suppress: list[ScanSlotIn] = []
    unsuppress: list[ScanSlotIn] = []


class ScanApplyOut(BaseModel):
    created: int
    skipped: int  # link already existed
    invalid: list[ScanLinkIn]  # movie_id / person_id no longer exists
    suppressed: int
    unsuppressed: int


class SuppressionOut(ORMSchema):
    person_id: int
    person_name: Optional[str]
    movie_id: int
    movie_name: Optional[str]
    slot: Slot


class SuppressionListOut(BaseModel):
    count: int
    items: list[SuppressionOut]
