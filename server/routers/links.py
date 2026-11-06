from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..api_models.music import LinkIn, LinkOut
from ..authz import Capability
from ..database import get_database
from ..deps import GuildContext, guild_ctx


def make_links_router(*, owner_model, link_model, owner_fk: str, prefix: str, tag: str) -> APIRouter:
    """A3: every catalog entity carries a labelled, ordered list of links
    ({"Discogs": "…"}, {"YouTube": "…"}) instead of one fixed `*_link` column."""
    router = APIRouter(prefix=f"/guilds/{{guild_id}}{prefix}/{{owner_id}}/links", tags=[tag])
    VIEW = guild_ctx(Capability.VIEW)
    EDIT = guild_ctx(Capability.CATALOG_EDIT)

    def _owner(db: Session, ctx: GuildContext, owner_id: int):
        row = db.get(owner_model, owner_id)
        if row is None or row.guild_id != ctx.guild_id:
            raise HTTPException(404, "Not found")
        return row

    @router.get("", response_model=list[LinkOut])
    def list_links(owner_id: int, ctx: GuildContext = Depends(VIEW), db: Session = Depends(get_database, scope="function")):
        _owner(db, ctx, owner_id)
        return db.scalars(
            select(link_model).where(getattr(link_model, owner_fk) == owner_id).order_by(link_model.position)
        ).all()

    @router.post("", response_model=LinkOut, status_code=201)
    def add_link(owner_id: int, body: LinkIn, ctx: GuildContext = Depends(EDIT),
                 db: Session = Depends(get_database, scope="function")):
        _owner(db, ctx, owner_id)
        link = link_model(guild_id=ctx.guild_id, **{owner_fk: owner_id}, **body.model_dump())
        db.add(link)
        db.flush()
        return link

    @router.patch("/{link_id}", response_model=LinkOut)
    def update_link(owner_id: int, link_id: int, body: LinkIn, ctx: GuildContext = Depends(EDIT),
                    db: Session = Depends(get_database, scope="function")):
        link = db.get(link_model, link_id)
        if link is None or link.guild_id != ctx.guild_id or getattr(link, owner_fk) != owner_id:
            raise HTTPException(404, "Link not found")
        for k, v in body.model_dump().items():
            setattr(link, k, v)
        return link

    @router.delete("/{link_id}", status_code=204)
    def delete_link(owner_id: int, link_id: int, ctx: GuildContext = Depends(EDIT),
                    db: Session = Depends(get_database, scope="function")):
        link = db.get(link_model, link_id)
        if link is not None and link.guild_id == ctx.guild_id and getattr(link, owner_fk) == owner_id:
            db.delete(link)

    return router
