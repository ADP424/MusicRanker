from pydantic import BaseModel

from .base import ORMSchema


class GenreIn(BaseModel):
    name: str
    synonyms: list[str] | None = None
    notes: str | None = None


class GenrePatch(BaseModel):
    name: str | None = None
    synonyms: list[str] | None = None
    notes: str | None = None


class GenreOut(ORMSchema):
    id: int
    name: str
    synonyms: list[str] | None
    notes: str | None
    parent_ids: list[int] = []
