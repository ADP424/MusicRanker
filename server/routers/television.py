"""Television CRUD: shows (globally ranked) and their nested episodes
(ranked within their show, the way albums are ranked within an artist).

Shows carry the *default* name/name_en/release_year/people/genres; episodes
copy them on creation (``inherit_from_show``) and may then diverge freely —
every per-episode link has its own add/remove endpoint. Soundtrack albums are
show-level only (as with movies and games), and the link is also navigable
from the album side via ``Album.soundtrack_television_shows`` /
``/albums/{aid}/soundtrack-television/{sid}``.
"""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..api_models import (
    PositionBody,
    TelevisionEpisodeIn,
    TelevisionEpisodeIndex,
    TelevisionEpisodeOut,
    TelevisionEpisodePatch,
    TelevisionGenreOut,
    TelevisionPersonRef,
    TelevisionPropagateIn,
    TelevisionPropagateOut,
    TelevisionShowIn,
    TelevisionShowIndex,
    TelevisionShowOut,
    TelevisionShowPatch,
    TelevisionSoundtrackAlbumRef,
)
from ..api_models.base import ReorderBody
from ..api_models.comparison import ComparisonIn, ComparisonOut
from ..comparisons import (
    clear_comparisons,
    delete_comparison,
    list_comparisons,
    upsert_comparison,
)
from ..database import get_database
from ..database_models import (
    TELEVISION_EPISODE_ROLES,
    TELEVISION_SHOW_ROLES,
    Album,
    Genre,
    Person,
    TelevisionEpisode,
    TelevisionEpisodeComparison,
    TelevisionEpisodePerson,
    TelevisionShow,
    TelevisionShowComparison,
    TelevisionShowPerson,
)
from ..database_models.movie_cast_member import CastRole
from ..ranking import apply_sequential_ranks, check_reorder_ids, rank_at

router = APIRouter(prefix="/television", tags=["television"])

# A show is authored (creator), an episode is directed (director).
ROLE_ORDER = [
    CastRole.creator,
    CastRole.director,
    CastRole.composer,
    CastRole.lead_actor,
    CastRole.actor,
    CastRole.cameo_actor,
]


# ── Fetch helpers ──────────────────────────────────────────────────────────────
def _get_show(db: Session, sid: int) -> TelevisionShow:
    if s := db.get(TelevisionShow, sid):
        return s
    raise HTTPException(404, "Television show not found")


def _get_episode(db: Session, eid: int) -> TelevisionEpisode:
    if e := db.get(TelevisionEpisode, eid):
        return e
    raise HTTPException(404, "Television episode not found")


# ── Shape helpers ──────────────────────────────────────────────────────────────
def _persons(links) -> list[TelevisionPersonRef]:
    refs = [
        TelevisionPersonRef(
            id=link.person.id,
            name=link.person.name,
            name_en=link.person.name_en,
            role=link.role,
        )
        for link in links
    ]
    refs.sort(key=lambda r: (ROLE_ORDER.index(r.role) if r.role in ROLE_ORDER else 99, r.name))
    return refs


def _soundtracks(albums) -> list[TelevisionSoundtrackAlbumRef]:
    return [
        TelevisionSoundtrackAlbumRef(
            id=album.id,
            name=album.name,
            name_en=album.name_en,
            artist_ids=[link.artist_id for link in album.artist_links],
        )
        for album in albums
    ]


def _ordered_episodes(show: TelevisionShow) -> list[TelevisionEpisode]:
    return sorted(show.episodes, key=lambda e: (e.episode_rank is None, e.episode_rank or Decimal(0), e.id))


def _episode_out(ep: TelevisionEpisode, position: int | None) -> TelevisionEpisodeOut:
    return TelevisionEpisodeOut(
        id=ep.id,
        show_id=ep.show_id,
        show_name=ep.show.name,
        name=ep.name,
        name_en=ep.name_en,
        runtime_minutes=ep.runtime_minutes,
        release_year=ep.release_year,
        watches=ep.watches,
        watch_link=ep.watch_link,
        notes=ep.notes,
        episode_rank=ep.episode_rank,
        position=position,
        persons=_persons(ep.person_links),
        genre_ids=[g.id for g in ep.genres],
    )


def _episode_position(db: Session, ep: TelevisionEpisode) -> int | None:
    if ep.episode_rank is None:
        return None
    return 1 + db.scalar(
        select(func.count())
        .select_from(TelevisionEpisode)
        .where(
            TelevisionEpisode.show_id == ep.show_id,
            TelevisionEpisode.episode_rank < ep.episode_rank,
        )
    )


def _show_out(db: Session, show: TelevisionShow, position: int | None = None) -> TelevisionShowOut:
    eps = _ordered_episodes(show)
    if position is None and show.global_rank is not None:
        position = 1 + db.scalar(
            select(func.count()).select_from(TelevisionShow).where(TelevisionShow.global_rank < show.global_rank)
        )
    return TelevisionShowOut(
        id=show.id,
        name=show.name,
        name_en=show.name_en,
        release_year=show.release_year,
        watch_link=show.watch_link,
        notes=show.notes,
        global_rank=show.global_rank,
        position=position,
        persons=_persons(show.person_links),
        genre_ids=[g.id for g in show.genres],
        soundtrack_album_refs=_soundtracks(show.soundtrack_albums),
        episodes=[_episode_out(e, i) for i, e in enumerate(eps, start=1)],
        episode_count=len(eps),
        total_runtime_minutes=sum(e.runtime_minutes for e in eps),
        total_watched_minutes=sum(e.runtime_minutes * e.watches for e in eps),
        total_watches=sum(e.watches for e in eps),
    )


# ── Ranking helpers ────────────────────────────────────────────────────────────
def _show_rank_at(db: Session, position: int | None, exclude: int | None) -> Decimal:
    return rank_at(db, TelevisionShow.global_rank, position, exclude_col=TelevisionShow.id, exclude=exclude)


def _episode_rank_at(db: Session, show_id: int, position: int | None, exclude: int | None) -> Decimal:
    return rank_at(
        db,
        TelevisionEpisode.episode_rank,
        position,
        exclude_col=TelevisionEpisode.id,
        exclude=exclude,
        scope=TelevisionEpisode.show_id == show_id,
    )


# ── Show collection ────────────────────────────────────────────────────────────
@router.get("/shows", response_model=list[TelevisionShowIndex])
def list_shows(db: Session = Depends(get_database)):
    shows = db.scalars(select(TelevisionShow)).all()
    result = []
    for show in shows:
        person_ids = {link.person_id for link in show.person_links}
        genre_ids = {g.id for g in show.genres}
        episode_names = []
        for ep in _ordered_episodes(show):
            episode_names.append(ep.name)
            person_ids.update(link.person_id for link in ep.person_links)
            genre_ids.update(g.id for g in ep.genres)
        result.append(
            TelevisionShowIndex(
                id=show.id,
                name=show.name,
                name_en=show.name_en,
                person_ids=sorted(person_ids),
                genre_ids=sorted(genre_ids),
                episode_names=episode_names,
            )
        )
    return result


@router.get("/shows/ranked", response_model=list[TelevisionShowOut], response_model_by_alias=True)
def list_shows_ranked(db: Session = Depends(get_database)):
    rows = db.scalars(select(TelevisionShow).order_by(TelevisionShow.global_rank)).all()
    return [_show_out(db, show, position=i) for i, show in enumerate(rows, start=1)]


@router.put("/shows/reorder", status_code=204)
def reorder_shows(body: ReorderBody, db: Session = Depends(get_database)):
    """Rewrite the whole television show order by setting sequential global_rank values."""
    rows = db.scalars(select(TelevisionShow)).all()
    check_reorder_ids(body.ids, [s.id for s in rows])
    apply_sequential_ranks(db, {s.id: s for s in rows}, body.ids, "global_rank")


# ── Pairwise comparisons: shows ────────────────────────────────────────────────
@router.get("/shows/comparisons", response_model=list[ComparisonOut])
def list_show_comparisons(db: Session = Depends(get_database)):
    return list_comparisons(db, TelevisionShowComparison)


@router.put("/shows/comparisons", response_model=ComparisonOut)
def upsert_show_comparison(body: ComparisonIn, db: Session = Depends(get_database)):
    _get_show(db, body.winner_id)
    _get_show(db, body.loser_id)
    return upsert_comparison(db, TelevisionShowComparison, body.winner_id, body.loser_id)


@router.delete("/shows/comparisons", status_code=204)
def clear_show_comparisons(db: Session = Depends(get_database)):
    clear_comparisons(db, TelevisionShowComparison)


@router.delete("/shows/comparisons/{a}/{b}", status_code=204)
def delete_show_comparison(a: int, b: int, db: Session = Depends(get_database)):
    delete_comparison(db, TelevisionShowComparison, a, b)


@router.post("/shows", response_model=TelevisionShowOut, status_code=201, response_model_by_alias=True)
def create_show(body: TelevisionShowIn, db: Session = Depends(get_database)):
    rank = _show_rank_at(db, body.position, exclude=None)
    show = TelevisionShow(**body.model_dump(exclude={"position"}), global_rank=rank)
    db.add(show)
    db.flush()
    return _show_out(db, show)


@router.get("/shows/{sid}", response_model=TelevisionShowOut, response_model_by_alias=True)
def get_show(sid: int, db: Session = Depends(get_database)):
    return _show_out(db, _get_show(db, sid))


@router.patch("/shows/{sid}", response_model=TelevisionShowOut, response_model_by_alias=True)
def update_show(sid: int, body: TelevisionShowPatch, db: Session = Depends(get_database)):
    show = _get_show(db, sid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(show, k, v)
    db.flush()
    return _show_out(db, show)


@router.delete("/shows/{sid}", status_code=204)
def delete_show(sid: int, db: Session = Depends(get_database)):
    db.delete(_get_show(db, sid))


@router.put("/shows/{sid}/position", response_model=TelevisionShowOut, response_model_by_alias=True)
def move_show(sid: int, body: PositionBody, db: Session = Depends(get_database)):
    show = _get_show(db, sid)
    show.global_rank = _show_rank_at(db, body.position, exclude=sid)
    db.flush()
    return _show_out(db, show)


# ── Episodes ───────────────────────────────────────────────────────────────────
@router.get("/episodes", response_model=list[TelevisionEpisodeIndex])
def list_episodes(db: Session = Depends(get_database)):
    eps = db.scalars(select(TelevisionEpisode)).all()
    return [
        TelevisionEpisodeIndex(
            id=ep.id,
            show_id=ep.show_id,
            show_name=ep.show.name,
            name=ep.name,
            name_en=ep.name_en,
            person_ids=[link.person_id for link in ep.person_links],
            genre_ids=[g.id for g in ep.genres],
        )
        for ep in eps
    ]


@router.get("/shows/{sid}/episodes", response_model=list[TelevisionEpisodeOut], response_model_by_alias=True)
def list_show_episodes(sid: int, db: Session = Depends(get_database)):
    show = _get_show(db, sid)
    return [_episode_out(e, i) for i, e in enumerate(_ordered_episodes(show), start=1)]


@router.put("/shows/{sid}/episodes/reorder", status_code=204)
def reorder_episodes(sid: int, body: ReorderBody, db: Session = Depends(get_database)):
    """Rewrite one show's episode order (episodes are ranked within their show)."""
    show = _get_show(db, sid)
    check_reorder_ids(body.ids, [e.id for e in show.episodes])
    apply_sequential_ranks(db, {e.id: e for e in show.episodes}, body.ids, "episode_rank")


# ── Pairwise comparisons: episodes, scoped to one show ─────────────────────────
def _episode_scope(sid: int):
    # Both sides of a row are episodes of the same show (validated on write),
    # so constraining the winner is enough.
    return TelevisionEpisodeComparison.winner_id.in_(
        select(TelevisionEpisode.id).where(TelevisionEpisode.show_id == sid)
    )


@router.get("/shows/{sid}/episodes/comparisons", response_model=list[ComparisonOut])
def list_episode_comparisons(sid: int, db: Session = Depends(get_database)):
    _get_show(db, sid)
    return list_comparisons(db, TelevisionEpisodeComparison, scope=_episode_scope(sid))


@router.put("/shows/{sid}/episodes/comparisons", response_model=ComparisonOut)
def upsert_episode_comparison(sid: int, body: ComparisonIn, db: Session = Depends(get_database)):
    show = _get_show(db, sid)
    live = {e.id for e in show.episodes}
    if body.winner_id not in live or body.loser_id not in live:
        raise HTTPException(404, "Episode is not part of this show")
    return upsert_comparison(db, TelevisionEpisodeComparison, body.winner_id, body.loser_id)


@router.delete("/shows/{sid}/episodes/comparisons", status_code=204)
def clear_episode_comparisons(sid: int, db: Session = Depends(get_database)):
    _get_show(db, sid)
    clear_comparisons(db, TelevisionEpisodeComparison, scope=_episode_scope(sid))


@router.delete("/shows/{sid}/episodes/comparisons/{a}/{b}", status_code=204)
def delete_episode_comparison(sid: int, a: int, b: int, db: Session = Depends(get_database)):
    _get_show(db, sid)
    delete_comparison(db, TelevisionEpisodeComparison, a, b, scope=_episode_scope(sid))


@router.post(
    "/shows/{sid}/episodes", response_model=TelevisionEpisodeOut, status_code=201, response_model_by_alias=True
)
def create_episode(sid: int, body: TelevisionEpisodeIn, db: Session = Depends(get_database)):
    """Unspecified inheritable scalars fall back to the show's values; with
    ``inherit_from_show`` the show's people and genres are copied too. The
    soundtrack stays on the show."""
    show = _get_show(db, sid)
    rank = _episode_rank_at(db, sid, body.position, exclude=None)
    ep = TelevisionEpisode(
        show_id=sid,
        name=body.name if body.name is not None else show.name,
        name_en=body.name_en if body.name_en is not None else show.name_en,
        runtime_minutes=body.runtime_minutes,
        release_year=body.release_year if body.release_year is not None else show.release_year,
        watches=body.watches,
        watch_link=body.watch_link,
        notes=body.notes,
        episode_rank=rank,
    )
    if body.inherit_from_show:
        ep.genres = list(show.genres)
    db.add(ep)
    db.flush()
    if body.inherit_from_show:
        for link in show.person_links:
            # `creator` is show-only, so it never descends to an episode.
            if link.role in TELEVISION_EPISODE_ROLES:
                db.add(TelevisionEpisodePerson(episode_id=ep.id, person_id=link.person_id, role=link.role))
        db.flush()
    return _episode_out(ep, _episode_position(db, ep))


@router.get("/episodes/{eid}", response_model=TelevisionEpisodeOut, response_model_by_alias=True)
def get_episode(eid: int, db: Session = Depends(get_database)):
    ep = _get_episode(db, eid)
    return _episode_out(ep, _episode_position(db, ep))


@router.patch("/episodes/{eid}", response_model=TelevisionEpisodeOut, response_model_by_alias=True)
def update_episode(eid: int, body: TelevisionEpisodePatch, db: Session = Depends(get_database)):
    ep = _get_episode(db, eid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ep, k, v)
    db.flush()
    return _episode_out(ep, _episode_position(db, ep))


@router.delete("/episodes/{eid}", status_code=204)
def delete_episode(eid: int, db: Session = Depends(get_database)):
    db.delete(_get_episode(db, eid))


@router.put("/episodes/{eid}/position", response_model=TelevisionEpisodeOut, response_model_by_alias=True)
def move_episode(eid: int, body: PositionBody, db: Session = Depends(get_database)):
    """Reorder an episode within its own show."""
    ep = _get_episode(db, eid)
    ep.episode_rank = _episode_rank_at(db, ep.show_id, body.position, exclude=eid)
    db.flush()
    return _episode_out(ep, _episode_position(db, ep))


# ── Show person links ──────────────────────────────────────────────────────────
@router.put("/shows/{sid}/persons/{person_id}/{role}", status_code=204)
def link_show_person(sid: int, person_id: int, role: CastRole, db: Session = Depends(get_database)):
    if role not in TELEVISION_SHOW_ROLES:
        raise HTTPException(422, "Shows are credited with the creator role, not director")
    _get_show(db, sid)
    if not db.get(Person, person_id):
        raise HTTPException(404, "Person not found")
    if not db.get(TelevisionShowPerson, (sid, person_id, role)):
        db.add(TelevisionShowPerson(show_id=sid, person_id=person_id, role=role))


@router.delete("/shows/{sid}/persons/{person_id}/{role}", status_code=204)
def unlink_show_person(sid: int, person_id: int, role: CastRole, db: Session = Depends(get_database)):
    if link := db.get(TelevisionShowPerson, (sid, person_id, role)):
        db.delete(link)


# ── Episode person links ───────────────────────────────────────────────────────
@router.put("/episodes/{eid}/persons/{person_id}/{role}", status_code=204)
def link_episode_person(eid: int, person_id: int, role: CastRole, db: Session = Depends(get_database)):
    if role not in TELEVISION_EPISODE_ROLES:
        raise HTTPException(422, "The creator role only applies to shows, not episodes")
    _get_episode(db, eid)
    if not db.get(Person, person_id):
        raise HTTPException(404, "Person not found")
    if not db.get(TelevisionEpisodePerson, (eid, person_id, role)):
        db.add(TelevisionEpisodePerson(episode_id=eid, person_id=person_id, role=role))


@router.delete("/episodes/{eid}/persons/{person_id}/{role}", status_code=204)
def unlink_episode_person(eid: int, person_id: int, role: CastRole, db: Session = Depends(get_database)):
    if link := db.get(TelevisionEpisodePerson, (eid, person_id, role)):
        db.delete(link)


# ── Genre links ────────────────────────────────────────────────────────────────
def _tv_genre(db: Session, gid: int) -> Genre:
    genre = db.get(Genre, gid)
    if not genre:
        raise HTTPException(404, "Television genre not found")
    if not genre.is_television:
        raise HTTPException(422, "Genre is not applicable to television")
    return genre


@router.get("/shows/{sid}/genres", response_model=list[TelevisionGenreOut])
def show_genre_list(sid: int, db: Session = Depends(get_database)):
    return sorted(_get_show(db, sid).genres, key=lambda g: g.name)


@router.put("/shows/{sid}/genres/{gid}", status_code=204)
def add_show_genre(sid: int, gid: int, db: Session = Depends(get_database)):
    show = _get_show(db, sid)
    genre = _tv_genre(db, gid)
    if genre not in show.genres:
        show.genres.append(genre)


@router.delete("/shows/{sid}/genres/{gid}", status_code=204)
def remove_show_genre(sid: int, gid: int, db: Session = Depends(get_database)):
    show = _get_show(db, sid)
    if (genre := db.get(Genre, gid)) and genre in show.genres:
        show.genres.remove(genre)


@router.get("/episodes/{eid}/genres", response_model=list[TelevisionGenreOut])
def episode_genre_list(eid: int, db: Session = Depends(get_database)):
    return sorted(_get_episode(db, eid).genres, key=lambda g: g.name)


@router.put("/episodes/{eid}/genres/{gid}", status_code=204)
def add_episode_genre(eid: int, gid: int, db: Session = Depends(get_database)):
    ep = _get_episode(db, eid)
    genre = _tv_genre(db, gid)
    if genre not in ep.genres:
        ep.genres.append(genre)


@router.delete("/episodes/{eid}/genres/{gid}", status_code=204)
def remove_episode_genre(eid: int, gid: int, db: Session = Depends(get_database)):
    ep = _get_episode(db, eid)
    if (genre := db.get(Genre, gid)) and genre in ep.genres:
        ep.genres.remove(genre)


# ── Soundtrack links (show-level only) ─────────────────────────────────────────
def _album(db: Session, aid: int) -> Album:
    if album := db.get(Album, aid):
        return album
    raise HTTPException(404, "Album not found")


@router.put("/shows/{sid}/soundtrack/{aid}", status_code=204)
def link_show_soundtrack(sid: int, aid: int, db: Session = Depends(get_database)):
    show = _get_show(db, sid)
    album = _album(db, aid)
    if album not in show.soundtrack_albums:
        show.soundtrack_albums.append(album)


@router.delete("/shows/{sid}/soundtrack/{aid}", status_code=204)
def unlink_show_soundtrack(sid: int, aid: int, db: Session = Depends(get_database)):
    show = _get_show(db, sid)
    album = db.get(Album, aid)
    if album and album in show.soundtrack_albums:
        show.soundtrack_albums.remove(album)


# ── Propagation ────────────────────────────────────────────────────────────────
@router.post("/shows/{sid}/propagate", response_model=TelevisionPropagateOut)
def propagate_show_defaults(sid: int, body: TelevisionPropagateIn, db: Session = Depends(get_database)):
    """Re-apply the show's people/genres to every episode. Episodes normally
    inherit at creation time; this is the explicit 'I changed the show and
    want the episodes to match' action. ``overwrite`` replaces each episode's
    set instead of unioning into it. Soundtracks are show-level only, so
    there's nothing to propagate."""
    show = _get_show(db, sid)
    added_p = added_g = 0
    touched: set[int] = set()
    for ep in show.episodes:
        if body.genres:
            before = {g.id for g in ep.genres}
            if body.overwrite:
                ep.genres = list(show.genres)
            else:
                for g in show.genres:
                    if g not in ep.genres:
                        ep.genres.append(g)
            after = {g.id for g in ep.genres}
            added_g += len(after - before)
            if after != before:
                touched.add(ep.id)
        if body.persons:
            existing = {(link.person_id, link.role) for link in ep.person_links}
            # `creator` is show-only and never propagates down.
            wanted = {
                (link.person_id, link.role) for link in show.person_links if link.role in TELEVISION_EPISODE_ROLES
            }
            if body.overwrite:
                for link in list(ep.person_links):
                    if (link.person_id, link.role) not in wanted:
                        db.delete(link)
                        touched.add(ep.id)
            for person_id, role in wanted - existing:
                db.add(TelevisionEpisodePerson(episode_id=ep.id, person_id=person_id, role=role))
                added_p += 1
                touched.add(ep.id)
    db.flush()
    return TelevisionPropagateOut(
        episodes_updated=len(touched),
        person_links_added=added_p,
        genre_links_added=added_g,
    )
