from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

from ..database_models.guild_role import GuildRole
from ..merge.spec import MergeAction, SECTIONS

GuildName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class GuildNameIn(BaseModel):
    name: GuildName


class TransferIn(BaseModel):
    user_id: int


class RoleIn(BaseModel):
    role: GuildRole


class InviteIn(BaseModel):
    identifier: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=320)]
    role: GuildRole = GuildRole.ranker


class MergePreviewIn(BaseModel):
    source_guild_id: int


class MergeDecisionIn(BaseModel):
    action: MergeAction
    target_id: int | None = None


class MergeStartIn(BaseModel):
    source_guild_id: int
    #: section -> source id (as a string, JSON keys) -> decision
    decisions: dict[str, dict[str, MergeDecisionIn]] = Field(default_factory=dict)
    copy_my_ranking: bool = True

    @field_validator("decisions")
    @classmethod
    def _known_sections(cls, v: dict) -> dict:
        unknown = set(v) - set(SECTIONS)
        if unknown:
            raise ValueError(f"Unknown merge sections: {', '.join(sorted(unknown))}")
        return v
