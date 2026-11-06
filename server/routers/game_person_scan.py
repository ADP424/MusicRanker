from ..database_models import Game, GamePerson, GameRole, JobLane
from ..igdb_client import get_sidecar
from ..igdb_scan import GAME, NAME, SCOPE
from .person_scan import EntityKind, make_router

router = make_router(
    prefix="game-person-scan",
    tag="game-person-scan",
    scan=NAME,
    lane=JobLane.igdb,
    roots={GAME: Game},
    # The scan only ever suggests `developer`, but the user may not pick
    # anything a game link can't hold either way.
    kinds={GAME: EntityKind(Game, GamePerson, "game_id", GameRole, frozenset(GameRole), SCOPE)},
    sidecar=get_sidecar,
)
