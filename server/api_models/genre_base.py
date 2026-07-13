from pydantic import BaseModel

from .base import ORMSchema


class GenreInBase(BaseModel):
    name: str
    synonyms: list[str] | None = None
    notes: str | None = None


class GenrePatchBase(BaseModel):
    name: str | None = None
    synonyms: list[str] | None = None
    notes: str | None = None


class GenreOutBase(ORMSchema):
    id: int
    name: str
    synonyms: list[str] | None
    notes: str | None
    parent_ids: list[int] = []
