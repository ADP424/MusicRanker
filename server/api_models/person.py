from pydantic import BaseModel

from .base import ORMSchema


class PersonIn(BaseModel):
    name: str
    name_en: str | None = None
    birth_nationality: str = "Unknown"  # the other one is copied in when only one is given
    core_nationality: str = "Unknown"
    notes: str | None = None


class PersonPatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    birth_nationality: str | None = None
    core_nationality: str | None = None
    notes: str | None = None


class PersonOut(ORMSchema):
    id: int
    name: str
    name_en: str | None
    birth_nationality: str
    core_nationality: str
    notes: str | None
    artist_ids: list[int] = []
    artist_names: list[str] = []
    movie_names: list[str] = []
    game_names: list[str] = []
    television_names: list[str] = []


class PersonArtistRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    discography_link: str
    role: str


class PersonMovieRoleRef(BaseModel):
    movie_id: int
    movie_name: str
    role: str


class PersonGameRoleRef(BaseModel):
    game_id: int
    game_name: str
    role: str


class PersonTelevisionRoleRef(BaseModel):
    show_id: int
    show_name: str
    role: str


class PersonTelevisionEpisodeRoleRef(BaseModel):
    episode_id: int
    episode_name: str
    show_id: int
    show_name: str
    role: str


class PersonDetail(BaseModel):
    id: int
    name: str
    name_en: str | None
    birth_nationality: str
    core_nationality: str
    notes: str | None
    artists: list[PersonArtistRef] = []
    movie_roles: list[PersonMovieRoleRef] = []
    game_roles: list[PersonGameRoleRef] = []
    television_roles: list[PersonTelevisionRoleRef] = []
    television_episode_roles: list[PersonTelevisionEpisodeRoleRef] = []


class GraphPersonNode(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    artist_ids: list[int] = []
    artist_roles: list[str] = []  # distinct band roles across all artists
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
