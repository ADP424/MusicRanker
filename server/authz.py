from __future__ import annotations

import enum

from .database_models.guild_role import ROLE_ORDER, GuildRole


class Capability(str, enum.Enum):
    VIEW = "view"                         # see the catalog and every member's rankings
    RANK = "rank"                         # manage *my own* ranking
    CATALOG_CREATE = "catalog_create"
    CATALOG_EDIT = "catalog_edit"
    CATALOG_DELETE = "catalog_delete"
    MERGE_IN = "merge_in"                 # D3: maintainer and up
    MANAGE_MEMBERS = "manage_members"     # invite / remove / set roles below manager
    MANAGE_MANAGERS = "manage_managers"   # B3: owner only — grant/revoke/kick managers
    GUILD_SETTINGS = "guild_settings"     # rename
    GUILD_DELETE = "guild_delete"         # owner only
    TRANSFER_OWNERSHIP = "transfer_ownership"


C = Capability

_RANKER = {C.VIEW, C.RANK}
_MAINTAINER = _RANKER | {C.CATALOG_CREATE, C.MERGE_IN}
_MAINTAINER_P = _MAINTAINER | {C.CATALOG_EDIT}
_MAINTAINER_PP = _MAINTAINER_P | {C.CATALOG_DELETE}
_MANAGER = _MAINTAINER_PP | {C.MANAGE_MEMBERS, C.GUILD_SETTINGS}
_OWNER = _MANAGER | {C.MANAGE_MANAGERS, C.GUILD_DELETE, C.TRANSFER_OWNERSHIP}

#: Adding a role is one entry here. There is no `if role == "owner"` anywhere else.
ROLE_CAPS: dict[GuildRole, frozenset[Capability]] = {
    GuildRole.ranker: frozenset(_RANKER),
    GuildRole.maintainer: frozenset(_MAINTAINER),
    GuildRole.maintainer_plus: frozenset(_MAINTAINER_P),
    GuildRole.maintainer_plus_plus: frozenset(_MAINTAINER_PP),
    GuildRole.manager: frozenset(_MANAGER),
    GuildRole.owner: frozenset(_OWNER),
}

MAX_OWNED_GUILDS = 3


def can_assign(actor: GuildRole, target_role: GuildRole) -> bool:
    """B3. A manager may only hand out roles strictly below `manager`; only the
    owner may grant or revoke `manager`. `owner` is never assignable — it moves
    exclusively via /transfer-ownership."""
    if target_role is GuildRole.owner:
        return False
    if target_role is GuildRole.manager:
        return actor is GuildRole.owner
    return ROLE_ORDER[actor] >= ROLE_ORDER[GuildRole.manager]


def can_manage_member(actor: GuildRole, subject: GuildRole) -> bool:
    if subject is GuildRole.owner:
        return False  # the owner is untouchable; they must transfer or delete
    if subject is GuildRole.manager:
        return actor is GuildRole.owner
    return ROLE_ORDER[actor] >= ROLE_ORDER[GuildRole.manager]
