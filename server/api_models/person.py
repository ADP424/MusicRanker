from pydantic import BaseModel

from .base import ORMSchema


class PersonIn(BaseModel):
    name: str
    birth_nationality: str
    core_nationality: str
    notes: str | None = None


class PersonPatch(BaseModel):
    name: str | None = None
    birth_nationality: str | None = None
    core_nationality: str | None = None
    notes: str | None = None


class PersonOut(ORMSchema):
    id: int
    name: str
    birth_nationality: str
    core_nationality: str
    notes: str | None
    artist_ids: list[int] = []


class PersonArtistRef(BaseModel):
    id: int
    name: str
    discography_link: str


class PersonMovieRoleRef(BaseModel):
    movie_id: int
    movie_name: str
    role: str


class PersonDetail(BaseModel):
    id: int
    name: str
    birth_nationality: str
    core_nationality: str
    notes: str | None
    artists: list[PersonArtistRef] = []
    movie_roles: list[PersonMovieRoleRef] = []


class GraphEdge(BaseModel):
    person_a: int
    person_b: int
    via_movie_ids: list[int] = []
    via_artist_ids: list[int] = []


class GraphPersonOut(BaseModel):
    id: int
    name: str
    artist_ids: list[int] = []
    movie_roles: list[str] = []  # distinct roles across all movies


class PersonGraphOut(BaseModel):
    persons: list[GraphPersonOut] = []
    edges: list[GraphEdge] = []
    movies: dict[int, str] = {}  # id → name
    artists: dict[int, str] = {}  # id → name
