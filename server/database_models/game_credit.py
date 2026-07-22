import enum

from sqlalchemy import Enum


class GameRole(str, enum.Enum):
    director = "director"
    developer = "developer"
    composer = "composer"
    writer = "writer"
    lead_actor = "lead_actor"
    actor = "actor"
    cameo_actor = "cameo_actor"


game_role_type = Enum(GameRole, name="game_role")
