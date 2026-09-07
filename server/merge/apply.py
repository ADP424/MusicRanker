from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database_models import (
    Album, AlbumArtist, Artist, ArtistPerson, Game, GamePerson, GamePlatform, Genre,
    Movie, MoviePerson, Person, TelevisionEpisode, TelevisionEpisodePerson,
    TelevisionShow, TelevisionShowPerson,
)
from ..database_models.job import Job
from ..database_models.ranking import (
    UserAlbumRank, UserArtistRank, UserGameRank, UserMovieRank,
    UserTelevisionEpisodeRank, UserTelevisionShowRank,
)
from ..guild_junction_helpers import link_guild_scoped
from ..jobs import JobContext, handler
from ..normalize import norm
from .spec import MergeAction, Decision, SECTIONS

Cancelled = type("Cancelled", (RuntimeError,), {})


class _IdMap:
    """source id -> target id, per section. `None` means "skipped": any link
    through it is silently dropped rather than dangling."""

    def __init__(self):
        self._m: dict[tuple[str, int], int | None] = {}

    def set(self, section: str, src: int, tgt: int | None) -> None:
        self._m[(section, src)] = tgt

    def get(self, section: str, src: int) -> int | None:
        return self._m.get((section, src))

    def alive(self, section: str, src_ids) -> list[int]:
        return [t for t in (self.get(section, s) for s in src_ids) if t is not None]


def _decisions(payload: dict, section: str) -> dict[int, Decision]:
    return {
        int(sid): Decision(MergeAction(d["action"]), d.get("target_id"))
        for sid, d in payload.get("decisions", {}).get(section, {}).items()
    }


def _next_rank(db: Session, model, *, user_id: int, guild_id: int, **scope) -> Decimal:
    q = select(model.rank).where(model.user_id == user_id, model.guild_id == guild_id)
    for k, v in scope.items():
        q = q.where(getattr(model, k) == v)
    ranks = db.scalars(q).all()
    return Decimal(max(ranks)) + 1 if ranks else Decimal(1)


@handler("guild_merge")
def run_merge(db: Session, job: Job, ctx: JobContext) -> dict:
    src_guild: int = job.payload["source_guild_id"]
    tgt_guild: int = job.guild_id
    user_id: int = job.user_id
    copy_ranking: bool = job.payload.get("copy_my_ranking", True)
    idmap = _IdMap()
    created = {s: 0 for s in SECTIONS}
    merged = {s: 0 for s in SECTIONS}

    def tick(section: str, i: int, n: int) -> None:
        if ctx.cancelled():
            raise Cancelled()
        ctx.progress(phase=section, processed=i, total=n)

    def resolve_simple(section: str, model, copy_cols: tuple[str, ...]):
        decisions = _decisions(job.payload, section)
        rows = db.scalars(select(model).where(model.guild_id == src_guild)).all()
        for i, src in enumerate(rows, 1):
            tick(section, i, len(rows))
            d = decisions.get(src.id, Decision(MergeAction.skip))
            if d.action is MergeAction.skip:
                idmap.set(section, src.id, None)
            elif d.action is MergeAction.merge and d.target_id:
                idmap.set(section, src.id, d.target_id)
                merged[section] += 1
            else:
                new = model(guild_id=tgt_guild, created_by_user_id=user_id,
                            **{c: getattr(src, c) for c in copy_cols})
                db.add(new)
                db.flush()
                idmap.set(section, src.id, new.id)
                created[section] += 1
        db.flush()

    # ── 1. Leaves ────────────────────────────────────────────────────────────
    resolve_simple("genres", Genre,
                   ("name", "name_en", "synonyms", "notes", "is_music", "is_movie", "is_game", "is_television"))
    resolve_simple("platforms", GamePlatform, ("name", "synonyms", "notes"))
    resolve_simple("people", Person, ("name", "name_en", "birth_nationality", "core_nationality", "notes"))
    resolve_simple("artists", Artist, ("name", "name_en", "birth_nationality", "core_nationality", "notes"))

    # Parentage for the two taxonomies, *after* all ids exist.
    for section, model, assoc in (("genres", Genre, "parents"), ("platforms", GamePlatform, "parents")):
        for src in db.scalars(select(model).where(model.guild_id == src_guild)).all():
            tid = idmap.get(section, src.id)
            if tid is None:
                continue
            tgt = db.get(model, tid)
            have = {p.id for p in getattr(tgt, assoc)}
            for pid in idmap.alive(section, [p.id for p in getattr(src, assoc)]):
                if pid not in have:
                    link_guild_scoped(db, tgt, getattr(model, assoc), db.get(model, pid), guild_id=tgt_guild)

    # Band membership
    for link in db.scalars(select(ArtistPerson).join(Artist).where(Artist.guild_id == src_guild)).all():
        a, p = idmap.get("artists", link.artist_id), idmap.get("people", link.person_id)
        if a and p and not db.get(ArtistPerson, (a, p, link.role)):
            db.add(ArtistPerson(artist_id=a, person_id=p, role=link.role))

    # ── 2. Media ─────────────────────────────────────────────────────────────
    def attach(tgt, src, *, genres=True, persons: tuple | None = None):
        if genres:
            have = {g.id for g in tgt.genres}
            for gid in idmap.alive("genres", [g.id for g in src.genres]):
                if gid not in have:
                    link_guild_scoped(db, tgt, type(tgt).genres, db.get(Genre, gid), guild_id=tgt_guild)
        if persons:
            link_model, fk = persons
            have = {(l.person_id, l.role) for l in tgt.person_links}
            for l in src.person_links:
                pid = idmap.get("people", l.person_id)
                if pid and (pid, l.role) not in have:
                    db.add(link_model(**{fk: tgt.id}, person_id=pid, role=l.role, guild_id=tgt_guild))

    def resolve_media(section, model, copy_cols, *, persons=None, after=None):
        decisions = _decisions(job.payload, section)
        rows = db.scalars(select(model).where(model.guild_id == src_guild)).all()
        for i, src in enumerate(rows, 1):
            tick(section, i, len(rows))
            d = decisions.get(src.id, Decision(MergeAction.skip))
            if d.action is MergeAction.skip:
                idmap.set(section, src.id, None)
                continue
            if d.action is MergeAction.merge and d.target_id:
                tgt = db.get(model, d.target_id)
                merged[section] += 1
            else:
                tgt = model(guild_id=tgt_guild, created_by_user_id=user_id,
                            **{c: getattr(src, c) for c in copy_cols})
                db.add(tgt)
                db.flush()
                created[section] += 1
            idmap.set(section, src.id, tgt.id)
            attach(tgt, src, persons=persons)
            if after:
                after(src, tgt)
            db.flush()

    resolve_media("albums", Album, ("name", "name_en", "runtime", "release_year", "alias", "notes"),
                  after=lambda s, t: [
                      db.add(AlbumArtist(album_id=t.id, artist_id=aid, guild_id=tgt_guild))
                      for aid in idmap.alive("artists", [l.artist_id for l in s.artist_links])
                      if not db.get(AlbumArtist, (t.id, aid))
                  ])

    resolve_media("movies", Movie, ("name", "name_en", "runtime_minutes", "release_year", "notes"),
                  persons=(MoviePerson, "movie_id"))
    resolve_media("games", Game, ("name", "name_en", "release_year", "notes"),
                  persons=(GamePerson, "game_id"),
                  after=lambda s, t: [
                      link_guild_scoped(db, t, Game.platforms, db.get(GamePlatform, pid), guild_id=tgt_guild)
                      for pid in idmap.alive("platforms", [p.id for p in s.platforms])
                      if pid not in {p.id for p in t.platforms}
                  ])

    def copy_episodes(src_show: TelevisionShow, tgt_show: TelevisionShow):
        """Merging a show maps it onto the target show and creates only the
        episodes the target is missing (matched on normalised title). Duplicating
        copies the whole run."""
        existing = {norm(e.name): e for e in tgt_show.episodes}
        for rank, se in enumerate(src_show.episodes, 1):
            te = existing.get(norm(se.name))
            if te is None:
                te = TelevisionEpisode(
                    guild_id=tgt_guild, show_id=tgt_show.id, created_by_user_id=user_id,
                    name=se.name, name_en=se.name_en, runtime_minutes=se.runtime_minutes,
                    release_year=se.release_year, notes=se.notes, episode_rank=Decimal(rank),
                )
                db.add(te)
                db.flush()
            idmap.set("episodes", se.id, te.id)
            attach(te, se, persons=(TelevisionEpisodePerson, "episode_id"))

    resolve_media("television_shows", TelevisionShow, ("name", "name_en", "release_year", "notes"),
                  persons=(TelevisionShowPerson, "show_id"), after=copy_episodes)

    # Soundtrack cross-links, once every media id exists.
    for src in db.scalars(select(Album).where(Album.guild_id == src_guild)).all():
        tid = idmap.get("albums", src.id)
        if tid is None:
            continue
        tgt = db.get(Album, tid)
        for section, rel, model in (("movies", "soundtrack_movies", Movie),
                                    ("games", "soundtrack_games", Game),
                                    ("television_shows", "soundtrack_television_shows", TelevisionShow)):
            have = {m.id for m in getattr(tgt, rel)}
            for mid in idmap.alive(section, [m.id for m in getattr(src, rel)]):
                if mid not in have:
                    link_guild_scoped(db, tgt, getattr(Album, rel), db.get(model, mid), guild_id=tgt_guild)

    # ── 3. D7: bring the merging user's ranking across ───────────────────────
    if copy_ranking:
        ctx.progress(phase="ranking", processed=0, total=0)
        plan = [
            (UserArtistRank, "artists", "artist_id", ()),
            (UserMovieRank, "movies", "movie_id", ("watches",)),
            (UserGameRank, "games", "game_id", ("hours_played",)),
            (UserTelevisionShowRank, "television_shows", "show_id", ()),
        ]
        for model, section, fk, extra in plan:
            rows = db.scalars(
                select(model)
                .where(model.user_id == user_id, model.guild_id == src_guild)
                .order_by(model.rank)
            ).all()
            for r in rows:
                tid = idmap.get(section, getattr(r, fk))
                if tid is None or db.get(model, {"user_id": user_id, fk: tid}):
                    continue  # never overwrite a rank the user already has in the target
                db.add(model(
                    user_id=user_id, guild_id=tgt_guild, **{fk: tid},
                    rank=_next_rank(db, model, user_id=user_id, guild_id=tgt_guild),
                    notes=r.notes, **{c: getattr(r, c) for c in extra},
                ))
                db.flush()

        for r in db.scalars(
            select(UserAlbumRank).where(UserAlbumRank.user_id == user_id, UserAlbumRank.guild_id == src_guild)
            .order_by(UserAlbumRank.rank)
        ).all():
            aid, alid = idmap.get("artists", r.artist_id), idmap.get("albums", r.album_id)
            if not (aid and alid) or db.get(UserAlbumRank, {"user_id": user_id, "artist_id": aid, "album_id": alid}):
                continue
            db.add(UserAlbumRank(
                user_id=user_id, guild_id=tgt_guild, artist_id=aid, album_id=alid, listens=r.listens, notes=r.notes,
                rank=_next_rank(db, UserAlbumRank, user_id=user_id, guild_id=tgt_guild, artist_id=aid),
            ))
            db.flush()

        for r in db.scalars(
            select(UserTelevisionEpisodeRank)
            .where(UserTelevisionEpisodeRank.user_id == user_id, UserTelevisionEpisodeRank.guild_id == src_guild)
            .order_by(UserTelevisionEpisodeRank.rank)
        ).all():
            eid, sid = idmap.get("episodes", r.episode_id), idmap.get("television_shows", r.show_id)
            if not (eid and sid) or db.get(UserTelevisionEpisodeRank, {"user_id": user_id, "episode_id": eid}):
                continue
            db.add(UserTelevisionEpisodeRank(
                user_id=user_id, guild_id=tgt_guild, episode_id=eid, show_id=sid, watches=r.watches, notes=r.notes,
                rank=_next_rank(db, UserTelevisionEpisodeRank, user_id=user_id, guild_id=tgt_guild, show_id=sid),
            ))
            db.flush()

    db.commit()
    return {"created": created, "merged": merged}
