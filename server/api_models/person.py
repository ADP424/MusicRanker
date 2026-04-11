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


class GraphPersonNode(BaseModel):
    id: int
    name: str
    artist_ids: list[int] = []
    movie_roles: list[str] = []  # distinct roles across all movies


class GraphMovieNode(BaseModel):
    id: int
    name: str


class GraphArtistNode(BaseModel):
    id: int
    name: str


class GraphEdge(BaseModel):
    # source is always a person id; target is a movie or artist id (prefixed in frontend)
    person_id: int
    target_id: int
    target_type: str  # "movie" | "artist"


class PersonGraphOut(BaseModel):
    persons: list[GraphPersonNode] = []
    movies: list[GraphMovieNode] = []
    artists: list[GraphArtistNode] = []
    edges: list[GraphEdge] = []  # id → name
