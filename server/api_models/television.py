from decimal import Decimal

from pydantic import BaseModel, Field

from ..database_models.movie_cast_member import CastRole
from .base import ORMSchema


class TelevisionPersonRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    role: CastRole


class TelevisionSoundtrackAlbumRef(BaseModel):
    id: int
    name: str
    name_en: str | None = None
    artist_ids: list[int] = []


class TelevisionShowIn(BaseModel):
    name: str
    name_en: str | None = None
    release_year: int
    watch_link: str | None = None
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)


class TelevisionShowPatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    release_year: int | None = None
    watch_link: str | None = None
    notes: str | None = None


class TelevisionEpisodeIn(BaseModel):
    """Inheritable scalars are optional: omitting one copies the parent show's
    value. ``inherit_from_show`` additionally copies the show's people and
    genres onto the new episode (both editable afterwards). Soundtracks are
    show-level only — see ``TelevisionShowOut.soundtrack_album_refs``."""

    name: str | None = None
    name_en: str | None = None
    runtime_minutes: int = Field(default=0, ge=0)
    release_year: int | None = None
    watches: int = Field(default=1, ge=1)
    watch_link: str | None = None
    notes: str | None = None
    position: int | None = Field(default=None, ge=1)
    inherit_from_show: bool = True


class TelevisionEpisodePatch(BaseModel):
    name: str | None = None
    name_en: str | None = None
    runtime_minutes: int | None = Field(default=None, ge=0)
    release_year: int | None = None
    watches: int | None = Field(default=None, ge=1)
    watch_link: str | None = None
    notes: str | None = None


class TelevisionEpisodeOut(ORMSchema):
    model_config = ORMSchema.model_config.copy()
    model_config["populate_by_name"] = True

    id: int
    show_id: int
    show_name: str
    name: str
    name_en: str | None
    runtime_minutes: int
    release_year: int
    watches: int
    watch_link: str | None
    notes: str | None
    episode_rank: Decimal | None
    position: int | None = None
    persons: list[TelevisionPersonRef] = []
    genre_ids: list[int] = []


class TelevisionShowOut(ORMSchema):
    model_config = ORMSchema.model_config.copy()
    model_config["populate_by_name"] = True

    id: int
    name: str
    name_en: str | None
    release_year: int
    watch_link: str | None
    notes: str | None
    global_rank: Decimal | None
    position: int | None = None
    persons: list[TelevisionPersonRef] = []
    genre_ids: list[int] = []
    soundtrack_album_refs: list[TelevisionSoundtrackAlbumRef] = Field(
        default=[], serialization_alias="soundtrack_albums"
    )
    episodes: list[TelevisionEpisodeOut] = []
    # Aggregates rolled up from the episodes (the show itself has no runtime).
    episode_count: int = 0
    total_runtime_minutes: int = 0
    total_watched_minutes: int = 0
    total_watches: int = 0


class TelevisionShowIndex(ORMSchema):
    """Slim show shape for global cache / search."""

    id: int
    name: str
    name_en: str | None = None
    person_ids: list[int] = []
    genre_ids: list[int] = []
    episode_names: list[str] = []


class TelevisionEpisodeIndex(ORMSchema):
    id: int
    show_id: int
    show_name: str
    name: str
    name_en: str | None = None
    person_ids: list[int] = []
    genre_ids: list[int] = []


class TelevisionPropagateIn(BaseModel):
    persons: bool = True
    genres: bool = True
    overwrite: bool = False  # True: replace each episode's set, False: union


class TelevisionPropagateOut(BaseModel):
    episodes_updated: int
    person_links_added: int
    genre_links_added: int
