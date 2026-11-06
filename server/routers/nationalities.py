"""A guild's nationality list. "Unknown" isn't in it: it is always available,
can't be renamed or removed, and isn't returned here (the frontend shows it
on its own, first)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, func, literal, select, union_all, update as sa_update
from sqlalchemy.orm import Session as DbSession

from .. import nationalities
from ..authz import Capability
from ..database import get_database
from ..database_models import Artist, Nationality, Person, UNKNOWN
from ..deps import GuildContext, guild_ctx
from ..normalize import norm

router = APIRouter(prefix="/guilds/{guild_id}/nationalities", tags=["nationalities"])
VIEW = guild_ctx(Capability.VIEW)
CREATE = guild_ctx(Capability.CATALOG_CREATE)
EDIT = guild_ctx(Capability.CATALOG_EDIT)
DELETE = guild_ctx(Capability.CATALOG_DELETE)


class NationalityIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("A name is required")
        if norm(v) == norm(UNKNOWN):
            raise ValueError(f'"{UNKNOWN}" is always available and can\'t be added or renamed to')
        return v


class NationalityOut(BaseModel):
    id: int
    name: str
    people_count: int = 0
    artist_count: int = 0


def _usage(db: DbSession, guild_id: int) -> dict[tuple[str, str], int]:
    """(kind, name) -> how many people/artists hold it (birth or core), in one query."""
    parts = []
    for kind, model in (("person", Person), ("artist", Artist)):
        for col in ("birth_nationality", "core_nationality"):
            c = model.__table__.c[col]
            parts.append(select(literal(kind).label("kind"), model.__table__.c.id, c.label("name"))
                         .where(model.__table__.c.guild_id == guild_id, c.is_not(None)))
    u = union_all(*parts).subquery()  # birth == core counts the entity once, below
    rows = db.execute(
        select(u.c.kind, u.c.name, func.count(func.distinct(u.c.id))).group_by(u.c.kind, u.c.name)
    ).all()
    return {(k, n): c for k, n, c in rows}


def _out(n: Nationality, usage: dict[tuple[str, str], int]) -> NationalityOut:
    return NationalityOut(id=n.id, name=n.name, people_count=usage.get(("person", n.name), 0),
                          artist_count=usage.get(("artist", n.name), 0))


def _get(db: DbSession, ctx: GuildContext, nid: int) -> Nationality:
    n = db.get(Nationality, nid)
    if n is None or n.guild_id != ctx.guild_id:
        raise HTTPException(404, "Nationality not found")
    return n


@router.get("", response_model=list[NationalityOut])
def list_nationalities(ctx: GuildContext = Depends(VIEW), db: DbSession = Depends(get_database, scope="function")):
    rows = db.scalars(
        select(Nationality).where(Nationality.guild_id == ctx.guild_id).order_by(Nationality.name_norm)
    ).all()
    usage = _usage(db, ctx.guild_id)
    return [_out(n, usage) for n in rows]


@router.post("", response_model=NationalityOut, status_code=201)
def create_nationality(body: NationalityIn, ctx: GuildContext = Depends(CREATE),
                       db: DbSession = Depends(get_database, scope="function")):
    n = Nationality(guild_id=ctx.guild_id, name=body.name)
    db.add(n)
    db.flush()
    nationalities.forget(db, ctx.guild_id)
    return _out(n, {})


@router.patch("/{nid}", response_model=NationalityOut)
def rename_nationality(nid: int, body: NationalityIn, ctx: GuildContext = Depends(EDIT),
                       db: DbSession = Depends(get_database, scope="function")):
    """Renames everywhere at once: the foreign keys cascade the new name."""
    n = _get(db, ctx, nid)
    n.name = body.name
    db.flush()
    # People/artists already in the session still hold the old name.
    for obj in list(db.identity_map.values()):
        if isinstance(obj, (Person, Artist)):
            db.expire(obj, ["birth_nationality", "core_nationality"])
    nationalities.forget(db, ctx.guild_id)
    return _out(n, _usage(db, ctx.guild_id))


@router.delete("/{nid}", status_code=204)
def delete_nationality(nid: int, ctx: GuildContext = Depends(DELETE),
                       db: DbSession = Depends(get_database, scope="function")):
    """Whoever held it falls back to their other nationality, else Unknown."""
    n = _get(db, ctx, nid)
    db.flush()
    for model in (Person, Artist):
        t = model.__table__
        birth, core = t.c.birth_nationality, t.c.core_nationality
        db.execute(
            sa_update(t)
            .where(t.c.guild_id == ctx.guild_id, (birth == n.name) | (core == n.name))
            .values(
                birth_nationality=case((birth == n.name, func.nullif(core, n.name)), else_=birth),
                core_nationality=case((core == n.name, func.nullif(birth, n.name)), else_=core),
            )
        )
    db.expire_all()
    db.delete(n)
    nationalities.forget(db, ctx.guild_id)
