from ..database_models import (
    TELEVISION_EPISODE_ROLES,
    TELEVISION_SEASON_ROLES,
    TELEVISION_SHOW_ROLES,
    CastRole,
    TelevisionEpisode,
    TelevisionEpisodePerson,
    TelevisionSeason,
    TelevisionSeasonPerson,
    TelevisionShow,
    TelevisionShowPerson,
)
from ..tmdb_client import get_sidecar
from ..tmdb_tv_scan import REGISTRY, SCOPES, run_scan
from .person_scan import EntityKind, make_router

router = make_router(
    prefix="television-person-scan",
    tag="television-person-scan",
    registry=REGISTRY,
    run_scan=run_scan,
    root=TelevisionShow,
    kinds={
        "show": EntityKind(
            TelevisionShow, TelevisionShowPerson, "show_id", CastRole, TELEVISION_SHOW_ROLES, SCOPES["show"]
        ),
        "season": EntityKind(
            TelevisionSeason, TelevisionSeasonPerson, "season_id", CastRole, TELEVISION_SEASON_ROLES, SCOPES["season"]
        ),
        "episode": EntityKind(
            TelevisionEpisode,
            TelevisionEpisodePerson,
            "episode_id",
            CastRole,
            TELEVISION_EPISODE_ROLES,
            SCOPES["episode"],
        ),
    },
    sidecar=get_sidecar,
)
