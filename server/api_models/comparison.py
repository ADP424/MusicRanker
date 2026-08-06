from datetime import datetime

from pydantic import BaseModel

from .base import ORMSchema


class ComparisonIn(BaseModel):
    winner_id: int
    loser_id: int


class ComparisonOut(ORMSchema):
    winner_id: int
    loser_id: int
    created_at: datetime | None = None
