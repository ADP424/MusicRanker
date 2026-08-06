import enum

from sqlalchemy import Enum


class CastRole(str, enum.Enum):
    """Shared cast/crew roles. Not every role applies to every media type —
    see the ``*_ROLES`` frozensets below, which the routers enforce as 422s and
    the tables enforce as CHECK constraints."""

    creator = "creator"  # television shows only (replaces director at show level)
    director = "director"  # movies and television *episodes*
    composer = "composer"
    actor = "actor"
    lead_actor = "lead_actor"
    cameo_actor = "cameo_actor"


cast_role_type = Enum(CastRole, name="cast_role")

#: A show is authored, not directed: `creator` stands in for `director` at show
#: level, while each episode keeps its own director.
MOVIE_ROLES = frozenset(CastRole) - {CastRole.creator}
TELEVISION_SHOW_ROLES = frozenset(CastRole) - {CastRole.director}
TELEVISION_EPISODE_ROLES = frozenset(CastRole) - {CastRole.creator}

#: Roles where a person holding two of them on the same entry is noise rather
#: than signal (you're a lead *or* a bit part, not both).
ACTING_ROLES = frozenset({CastRole.lead_actor, CastRole.actor, CastRole.cameo_actor})
