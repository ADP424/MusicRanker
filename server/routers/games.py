from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..api_models import (
    GameGenreOut,
    GameIn,
    GameIndex,
    GameOut,
    GamePatch,
    GamePersonRef,
    GamePlatformOut,
    GameSoundtrackAlbumRef,
    PositionBody,
)
from ..database import get_database
from ..database_models import (
    Album,
    Game,
    GamePerson,
    GamePlatform,
    Genre,
    Person,
)
from ..database_models.game_credit import GameRole
from ..ranking import rank_at

router = APIRouter(prefix="/games", tags=["games"])


# ── helpers ─────────────────────────────────────────────────────────────


def _get(db: Session, gid: int) -> Game:
    if g := db.get(Game, gid):
        return g
    raise HTTPException(404, "Game not found")


def _attach_persons(game: Game) -> list[GamePersonRef]:
    return [
        GamePersonRef(
            id=link.person.id,
            name=link.person.name,
            name_en=link.person.name_en,
            role=link.role,
        )
        for link in game.person_links
    ]


def _attach_soundtrack_albums(game: Game) -> list[GameSoundtrackAlbumRef]:
    return [GameSoundtrackAlbumRef(id=a.id, name=a.name, name_en=a.name_en) for a in game.soundtrack_albums]


def _decorate(game: Game) -> Game:
    """Populate the virtual (non-column) fields GameOut expects.

    ``soundtrack_album_refs`` (not ``soundtrack_albums``) because the latter
    name collides with the real ``Game.soundtrack_albums`` ORM relationship —
    assigning a list of Pydantic objects to it corrupts SQLAlchemy's collection
    machinery. GameOut aliases it back to "soundtrack_albums" on the wire, same
    trick as MovieOut.soundtrack_album_refs.
    """
    game.persons = _attach_persons(game)
    game.genre_ids = [g.id for g in game.genres]
    game.platform_ids = [p.id for p in game.platforms]
    game.soundtrack_album_refs = _attach_soundtrack_albums(game)
    return game


def _rank_at_position(
    db: Session,
    position: int | None,
    exclude: int | None,
) -> Decimal:
    return rank_at(
        db,
        Game.global_rank,
        position,
        exclude_col=Game.id,
        exclude=exclude,
    )


# ── CRUD ────────────────────────────────────────────────────────────────


@router.get("", response_model=list[GameIndex])
def list_games(db: Session = Depends(get_database)):
    games = db.scalars(select(Game)).all()
    return [
        GameIndex(
            id=g.id,
            name=g.name,
            name_en=g.name_en,
            person_ids=[link.person_id for link in g.person_links],
            genre_ids=[genre.id for genre in g.genres],
            platform_ids=[p.id for p in g.platforms],
        )
        for g in games
    ]


@router.get("/ranked", response_model=list[GameOut], response_model_by_alias=True)
def list_games_ranked(db: Session = Depends(get_database)):
    rows = db.scalars(select(Game).order_by(Game.global_rank)).all()
    result: list[Game] = []
    for i, game in enumerate(rows, start=1):
        game.position = i
        result.append(_decorate(game))
    return result


@router.get("/{gid}", response_model=GameOut, response_model_by_alias=True)
def get_game(gid: int, db: Session = Depends(get_database)):
    game = _decorate(_get(db, gid))
    if game.global_rank is not None:
        game.position = 1 + db.scalar(
            select(func.count()).select_from(Game).where(Game.global_rank < game.global_rank),
        )
    return game


@router.post(
    "",
    response_model=GameOut,
    status_code=201,
    response_model_by_alias=True,
)
def create_game(body: GameIn, db: Session = Depends(get_database)):
    rank = _rank_at_position(db, body.position, exclude=None)
    game = Game(**body.model_dump(exclude={"position"}), global_rank=rank)
    db.add(game)
    db.flush()
    return _decorate(game)


@router.patch("/{gid}", response_model=GameOut, response_model_by_alias=True)
def update_game(gid: int, body: GamePatch, db: Session = Depends(get_database)):
    game = _get(db, gid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(game, k, v)
    return _decorate(game)


@router.delete("/{gid}", status_code=204)
def delete_game(gid: int, db: Session = Depends(get_database)):
    db.delete(_get(db, gid))


# ── ranking ─────────────────────────────────────────────────────────────


@router.put("/{gid}/position", response_model=GameOut, response_model_by_alias=True)
def move_game(gid: int, body: PositionBody, db: Session = Depends(get_database)):
    game = _get(db, gid)
    game.global_rank = _rank_at_position(db, body.position, exclude=gid)
    db.flush()
    _decorate(game)
    game.position = body.position
    return game


# ── person credits ──────────────────────────────────────────────────────


@router.put("/{gid}/persons/{person_id}/{role}", status_code=204)
def link_game_person(
    gid: int,
    person_id: int,
    role: GameRole,
    db: Session = Depends(get_database),
):
    _get(db, gid)
    if not db.get(Person, person_id):
        raise HTTPException(404, "Person not found")
    if not db.get(GamePerson, (gid, person_id, role)):
        db.add(GamePerson(game_id=gid, person_id=person_id, role=role))


@router.delete("/{gid}/persons/{person_id}/{role}", status_code=204)
def unlink_game_person(
    gid: int,
    person_id: int,
    role: GameRole,
    db: Session = Depends(get_database),
):
    if link := db.get(GamePerson, (gid, person_id, role)):
        db.delete(link)


# ── genres ──────────────────────────────────────────────────────────────


@router.get("/{gid}/genres", response_model=list[GameGenreOut])
def game_genre_list(gid: int, db: Session = Depends(get_database)):
    return sorted(_get(db, gid).genres, key=lambda g: g.name)


@router.put("/{gid}/genres/{genre_id}", status_code=204)
def add_game_genre(gid: int, genre_id: int, db: Session = Depends(get_database)):
    game = _get(db, gid)
    genre = db.get(Genre, genre_id)
    if not genre:
        raise HTTPException(404, "Game genre not found")
    if not genre.is_game:
        raise HTTPException(422, "Genre is not applicable to games")
    if genre not in game.genres:
        game.genres.append(genre)


@router.delete("/{gid}/genres/{genre_id}", status_code=204)
def remove_game_genre(gid: int, genre_id: int, db: Session = Depends(get_database)):
    game = _get(db, gid)
    if (genre := db.get(Genre, genre_id)) and genre in game.genres:
        game.genres.remove(genre)


# ── platforms ───────────────────────────────────────────────────────────


@router.get("/{gid}/platforms", response_model=list[GamePlatformOut])
def game_platform_list(gid: int, db: Session = Depends(get_database)):
    return sorted(_get(db, gid).platforms, key=lambda p: p.name)


@router.put("/{gid}/platforms/{platform_id}", status_code=204)
def add_game_platform(
    gid: int,
    platform_id: int,
    db: Session = Depends(get_database),
):
    game = _get(db, gid)
    platform = db.get(GamePlatform, platform_id)
    if not platform:
        raise HTTPException(404, "Game platform not found")
    if platform not in game.platforms:
        game.platforms.append(platform)


@router.delete("/{gid}/platforms/{platform_id}", status_code=204)
def remove_game_platform(
    gid: int,
    platform_id: int,
    db: Session = Depends(get_database),
):
    game = _get(db, gid)
    if (p := db.get(GamePlatform, platform_id)) and p in game.platforms:
        game.platforms.remove(p)


# ── soundtrack links ───────────────────────────────────────────────────────────


@router.put("/{gid}/soundtrack/{aid}", status_code=204)
def link_soundtrack(gid: int, aid: int, db: Session = Depends(get_database)):
    game = _get(db, gid)
    album = db.get(Album, aid)
    if not album:
        raise HTTPException(404, "Album not found")
    if album not in game.soundtrack_albums:
        game.soundtrack_albums.append(album)


@router.delete("/{gid}/soundtrack/{aid}", status_code=204)
def unlink_soundtrack(gid: int, aid: int, db: Session = Depends(get_database)):
    game = _get(db, gid)
    album = db.get(Album, aid)
    if album and album in game.soundtrack_albums:
        game.soundtrack_albums.remove(album)
