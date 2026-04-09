from pydantic import BaseModel

from .base import ORMSchema


class MovieGenreIn(BaseModel):
    name: str
    synonyms: list[str] | None = None
    notes: str | None = None


class MovieGenrePatch(BaseModel):
    name: str | None = None
    synonyms: list[str] | None = None
    notes: str | None = None


class MovieGenreOut(ORMSchema):
    id: int
    name: str
    synonyms: list[str] | None
    notes: str | None
    parent_ids: list[int] = []
