import enum

from sqlalchemy import Enum


class BandRole(str, enum.Enum):
    core_member = "core_member"
    member = "member"


band_role_type = Enum(BandRole, name="band_role")
