from ..database_models import (
    MOVIE_ROLES,
    TELEVISION_EPISODE_ROLES,
    TELEVISION_SEASON_ROLES,
    TELEVISION_SHOW_ROLES,
    CastRole,
    JobLane,
    Movie,
    MoviePerson,
    TelevisionEpisode,
    TelevisionEpisodePerson,
    TelevisionSeason,
    TelevisionSeasonPerson,
    TelevisionShow,
    TelevisionShowPerson,
)
from ..tmdb_client import get_sidecar
from ..tmdb_person_scan import NAME, SCOPES
from .person_scan import EntityKind, make_router

router = make_router(
    prefix="tmdb-person-scan",
    tag="tmdb-person-scan",
    scan=NAME,
    lane=JobLane.tmdb,
    roots={"movie": Movie, "show": TelevisionShow},
    kinds={
        "movie": EntityKind(Movie, MoviePerson, "movie_id", CastRole, MOVIE_ROLES, SCOPES["movie"]),
        "show": EntityKind(
            TelevisionShow, TelevisionShowPerson, "show_id", CastRole, TELEVISION_SHOW_ROLES, SCOPES["show"]
        ),
        "season": EntityKind(
            TelevisionSeason, TelevisionSeasonPerson, "season_id", CastRole, TELEVISION_SEASON_ROLES, SCOPES["season"]
        ),
        "episode": EntityKind(
            TelevisionEpisode, TelevisionEpisodePerson, "episode_id", CastRole, TELEVISION_EPISODE_ROLES,
            SCOPES["episode"],
        ),
    },
    sidecar=get_sidecar,
)
