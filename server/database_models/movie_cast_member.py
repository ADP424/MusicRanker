import enum

from sqlalchemy import Enum


class CastRole(str, enum.Enum):
    director = "director"
    composer = "composer"
    actor = "actor"
    lead_actor = "lead_actor"


cast_role_type = Enum(CastRole, name="cast_role")
