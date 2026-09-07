import enum

from sqlalchemy import Enum


class GuildRole(str, enum.Enum):
    ranker = "ranker"
    maintainer = "maintainer"                    # create
    maintainer_plus = "maintainer_plus"          # create + edit
    maintainer_plus_plus = "maintainer_plus_plus"  # create + edit + delete
    manager = "manager"                          # + member management
    owner = "owner"                              # founder; exactly one per guild


guild_role_type = Enum(GuildRole, name="guild_role")

#: Seniority. A manager may only assign roles strictly below `manager`; only the
#: owner may grant or revoke `manager` (B3).
ROLE_ORDER: dict[GuildRole, int] = {
    GuildRole.ranker: 0,
    GuildRole.maintainer: 1,
    GuildRole.maintainer_plus: 2,
    GuildRole.maintainer_plus_plus: 3,
    GuildRole.manager: 4,
    GuildRole.owner: 5,
}

#: Roles a newly invited member may be given.
INVITABLE_ROLES = frozenset(ROLE_ORDER) - {GuildRole.owner}
