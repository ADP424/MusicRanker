"""IGDB game lookup + import service.

``igdb_lookup`` searches IGDB, enriches every credited developer/publisher
company (and any individually named person IGDB exposes) with a DB match
check so the frontend can show a fully-informed review list.

``igdb_import_game`` takes the user's selections and creates the game,
persons, genre links, platform links, and person-game links in one
transaction.

Mirrors server/tmdb_import.py's structure exactly; see that file for the
movie/TMDB equivalent this was ported from. Deliberate differences from
TMDB, all driven by what IGDB's API actually returns:

  * IGDB has no per-person birthplace data. Credits here are companies, and
    a company does carry a `country` field (ISO 3166-1 numeric), so the
    nationality guess is derived from that instead of being hardcoded —
    same "editable guess" contract as TMDB's birth_place-derived guess,
    just falling back to "Unknown" for unmapped/unknown codes.
  * IGDB's rich credit data is at the company level (developer/publisher),
    not a per-actor cast list, so "people" here are frequently studio
    names imported as Person rows with role=developer or role=publisher,
    matching this app's existing pattern of Person representing any
    credited party. `source` ("company"|"person") namespaces `igdb_id`,
    since IGDB company ids and person ids are unrelated id spaces.
  * Games have a platforms taxonomy TMDB has no analogue for, and IGDB
    returns it for free, so the importer also surfaces + applies platforms.
"""

from __future__ import annotations

import re

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import nationalities
from .api_models.igdb_import import (
    IgdbCreditsIn,
    IgdbCreditsOut,
    DbPersonMatchOut,
    IgdbGenreOut,
    IgdbImportIn,
    IgdbCandidateOut,
    IgdbImportOut,
    IgdbImportPersonResult,
    IgdbLookupOut,
    IgdbPersonOut,
    IgdbPlatformOut,
)
from .database_models import (
    NATIONALITIES,
    AlbumArtist,
    Artist,
    ArtistPerson,
    Game,
    GamePerson,
    GamePlatform,
    GameRole,
    Genre,
    Person,
    UserGameRank,
)
from .ranking import next_rank
from .igdb_client import TTL_DETAILS, TTL_SEARCH, IgdbClient, get_sidecar
from .normalize import norm

_KNOWN_NATIONALITIES = set(NATIONALITIES)

# Publishers are a distinct credit in IGDB, but GameRole doesn't model
# publishing, so publisher-only companies aren't offered at all (crediting
# them as `developer` would be wrong). Add a `publisher` role to offer them.
_PUBLISHER_ROLE = GameRole.__members__.get("publisher")

# IGDB exposes company.country as an ISO 3166-1 *numeric* code. Only the
# countries with meaningful game-industry presence are mapped; anything else
# (and any demonym this app's NATIONALITIES doesn't know) degrades to
# "Unknown", the same contract TMDB's birth_place guess has.
_COUNTRY_CODE_TO_NATIONALITY: dict[int, str] = {
    36: "Australian",
    76: "Brazilian",
    124: "Canadian",
    156: "Chinese",
    203: "Czech",
    208: "Danish",
    246: "Finnish",
    250: "French",
    276: "German",
    348: "Hungarian",
    372: "Irish",
    376: "Israeli",
    380: "Italian",
    392: "Japanese",
    410: "South Korean",
    528: "Dutch",
    554: "New Zealander",
    578: "Norwegian",
    616: "Polish",
    620: "Portuguese",
    643: "Russian",
    724: "Spanish",
    752: "Swedish",
    756: "Swiss",
    804: "Ukrainian",
    826: "British",
    840: "American",
}


# ── IGDB helpers ─────────────────────────────────────────────────────


def _release_year(unix_ts: int | None) -> int | None:
    if unix_ts is None:
        return None
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).year


def _release_date_str(unix_ts: int | None) -> str | None:
    if unix_ts is None:
        return None
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).date().isoformat()


def _nationality_from_country(code: int | None) -> str:
    nat = _COUNTRY_CODE_TO_NATIONALITY.get(code or 0)
    return nat if nat in _KNOWN_NATIONALITIES else "Unknown"


# ── Batched DB lookup ────────────────────────────────────────────────


def _batch_load_persons(
    db: Session,
    guild_id: int,
    names: set[str],
) -> dict[str, list[Person]]:
    """Single query for all candidate persons in this guild, with eager-loaded
    relations. Keyed by normalised name, the same matching the scans use."""
    norms = {norm(n) for n in names} - {""}
    if not norms:
        return {}
    rows = db.scalars(
        select(Person)
        .where(Person.guild_id == guild_id, Person.name_norm.in_(norms) | Person.name_en_norm.in_(norms))
        .options(
            selectinload(Person.game_links).joinedload(GamePerson.game),
            selectinload(Person.artist_links)
            .joinedload(ArtistPerson.artist)
            .selectinload(Artist.album_links)
            .joinedload(AlbumArtist.album),
        )
    ).all()
    by_name: dict[str, list[Person]] = {}
    for p in rows:
        by_name.setdefault(p.name_norm, []).append(p)
        if p.name_en_norm and p.name_en_norm != p.name_norm:
            by_name.setdefault(p.name_en_norm, []).append(p)
    return by_name


# ── DB matching (operates on pre-loaded data) ────────────────────────


def _filmography_overlaps(person: Person, developed: set[str]) -> bool:
    """Does this local person already have a game the IGDB company developed?
    That is identity evidence; matching against the game being imported isn't,
    since a brand-new game is never in anyone's credits yet."""
    for link in person.game_links:
        game = link.game
        if game is not None and ({game.name_norm, game.name_en_norm} & developed):
            return True
    return False


def _artist_summary(person: Person) -> str:
    if not person.artist_links:
        return "(no music entries)"
    parts: list[str] = []
    for link in person.artist_links:
        artist = link.artist
        role = link.role.value.replace("_", " ")
        albums = artist.album_links
        previews = [f"{a.album.name} ({a.album.release_year})" for a in albums[:3]]
        detail = ", ".join(previews)
        if len(albums) > 3:
            detail += f" +{len(albums) - 3} more"
        count = len(albums)
        parts.append(
            f"{artist.name} ({role}, {count} album{'s' if count != 1 else ''})" + (f" — {detail}" if detail else "")
        )
    return "; ".join(parts)


def _find_db_matches(
    name: str,
    developed: set[str],
    persons_by_name: dict[str, list[Person]],
) -> list[DbPersonMatchOut]:
    """Existing people with this name who could plausibly be this IGDB person.
    Someone with game credits that share nothing with this title is still
    surfaced (it's a real name match), just flagged as unverified so the
    caller can warn that it's a name-only match against a differing catalog."""
    seen: set[int] = set()
    out: list[DbPersonMatchOut] = []
    for c in persons_by_name.get(norm(name), []):
        if c.id in seen:
            continue
        seen.add(c.id)
        has_games = bool(c.game_links)
        overlap = _filmography_overlaps(c, developed) if has_games else False
        out.append(
            DbPersonMatchOut(
                person_id=c.id,
                person_name=c.name,
                has_game_entries=has_games,
                filmography_overlap=overlap,
                artist_summary=_artist_summary(c),
            )
        )
    return out


def _match_named(needle: str, rows: list) -> int | None:
    """Exact (case-insensitive) name-or-synonym match against a taxonomy table."""
    n = needle.strip().lower()
    for r in rows:
        if n == r.name.lower() or any(n == s.lower() for s in (r.synonyms or [])):
            return r.id
    return None


# ── Public: lookup ───────────────────────────────────────────────────


def cover_url(image_id: str | None) -> str | None:
    """An IGDB cover image id as its CDN URL (hotlinked, never stored locally)."""
    return f"https://images.igdb.com/igdb/image/upload/t_cover_big/{image_id}.jpg" if image_id else None


def _existing_game(db: Session, guild_id: int, result: dict) -> int | None:
    """The catalog's copy of an IGDB result: by IGDB id, else by title and year."""
    found = db.scalar(select(Game.id).where(Game.guild_id == guild_id, Game.igdb_id == result["id"]))
    if found is not None:
        return found
    year = _release_date_str(result.get("first_release_date"))
    if not year:
        return None
    t = norm(result.get("name") or "")
    return db.scalar(select(Game.id).where(
        Game.guild_id == guild_id, Game.release_year == int(year[:4]),
        (Game.name_norm == t) | (Game.name_en_norm == t),
    ).limit(1))


_LOOKUP_FIELDS = (
    "fields name,first_release_date,summary,cover.image_id,genres.name,platforms.name,total_rating,"
    "involved_companies.company.name,involved_companies.company.country,"
    "involved_companies.developer,involved_companies.publisher;"
)


def igdb_lookup(
    db: Session, guild_id: int, title: str, year: int | None, igdb_id: int | None = None,
) -> IgdbLookupOut | None:
    client = IgdbClient(get_sidecar())

    if igdb_id is None and (m := re.fullmatch(r"\s*igdb:(\d+)\s*", title)):
        igdb_id = int(m.group(1))
    if igdb_id is not None:
        results = client.post("games", f"{_LOOKUP_FIELDS} where id = {igdb_id};", ttl=TTL_SEARCH)
        if not results:
            return None
        title = results[0].get("name") or title
    else:
        escaped = title.replace('"', '\\"')
        results = client.post("games", f'search "{escaped}"; {_LOOKUP_FIELDS} limit 10;', ttl=TTL_SEARCH)
    if not results:
        return None

    exact = [r for r in results if r.get("name", "").lower() == title.lower()]
    pool = exact or results
    if year is not None:
        # Narrow by release year when the user gave one; if nothing in the
        # pool matches, keep the wider pool rather than 404ing on a bad year.
        dated = [r for r in pool if _release_year(r.get("first_release_date")) == year]
        if dated:
            pool = dated
    ambiguous = len(pool) > 1
    best = max(pool, key=lambda r: r.get("total_rating", 0) or 0)

    # ── Collect the credited companies we can represent ───────────────
    involved = best.get("involved_companies", [])
    companies: dict[str, tuple[dict, GameRole, str]] = {}  # name -> (company, role, reason)
    for ic in involved:
        company = ic.get("company") or {}
        name = company.get("name")
        if not name or name in companies:
            continue
        if ic.get("developer"):
            companies[name] = (company, GameRole.developer, "developer")
        elif ic.get("publisher") and _PUBLISHER_ROLE is not None:
            companies[name] = (company, _PUBLISHER_ROLE, "publisher")
    persons_by_name = _batch_load_persons(db, guild_id, set(companies))
    db.commit()  # loaded eagerly; release the connection before the next network calls

    # ── Each company's other games: top credits, and identity evidence ─
    company_ids = sorted({c.get("id") for c, _, _ in companies.values() if c.get("id") is not None})
    developed_by_id: dict[int, list[dict]] = {}
    if company_ids:
        ids = ",".join(str(i) for i in company_ids)
        rows = (
            client.post(
                "companies",
                f"fields name,developed.name,developed.total_rating; where id = ({ids}); limit {len(company_ids)};",
                ttl=TTL_DETAILS,
            )
            or []
        )
        developed_by_id = {r["id"]: r.get("developed", []) for r in rows}

    # ── Build enriched people list (company-level credits) ────────────
    people: list[IgdbPersonOut] = []
    for name, (company, role, reason) in companies.items():
        developed = developed_by_id.get(company.get("id"), [])
        top = sorted(developed, key=lambda g: g.get("total_rating", 0) or 0, reverse=True)[:3]
        people.append(
            IgdbPersonOut(
                igdb_id=company.get("id"),
                name=name,
                source="company",
                suggested_role=role,
                suggestion_reason=reason,
                top_credits=[g["name"] for g in top],
                nationality_guess=_nationality_from_country(company.get("country")),
                birth_place=None,  # IGDB has no per-credit locality, only country
                db_matches=_find_db_matches(
                    name, {norm(g["name"]) for g in developed if g.get("name")}, persons_by_name,
                ),
            )
        )

    # ── Genres ───────────────────────────────────────────────────────
    db_genres = list(db.scalars(
        select(Genre).where(Genre.guild_id == guild_id, Genre.is_game.is_(True)).order_by(Genre.name)
    ).all())
    genres = [
        IgdbGenreOut(
            igdb_id=g["id"],
            igdb_name=g["name"],
            db_genre_id=_match_named(g["name"], db_genres),
        )
        for g in best.get("genres", [])
    ]

    # ── Platforms ────────────────────────────────────────────────────
    db_platforms = list(db.scalars(
        select(GamePlatform).where(GamePlatform.guild_id == guild_id).order_by(GamePlatform.name)
    ).all())
    platforms = [
        IgdbPlatformOut(
            igdb_id=p["id"],
            igdb_name=p["name"],
            db_platform_id=_match_named(p["name"], db_platforms),
        )
        for p in best.get("platforms", [])
    ]

    return IgdbLookupOut(
        igdb_id=best["id"],
        title=best.get("name", title),
        release_date=_release_date_str(best.get("first_release_date")),
        summary=best.get("summary"),
        cover_url=cover_url((best.get("cover") or {}).get("image_id")),
        existing_game_id=_existing_game(db, guild_id, best),
        candidates=[
            IgdbCandidateOut(igdb_id=r["id"], title=r.get("name") or "", year=_release_year(r.get("first_release_date")),
                             cover_url=cover_url((r.get("cover") or {}).get("image_id")))
            for r in results if r["id"] != best["id"]
        ] if igdb_id is None else [],
        people=people,
        genres=genres,
        platforms=platforms,
        ambiguous=ambiguous,
    )


# ── Public: import ───────────────────────────────────────────────────


def _link_people(
    db: Session, guild_id: int, user_id: int, game: Game, people: list,
) -> tuple[list[IgdbImportPersonResult], list[IgdbImportPersonResult], int]:
    """Credit `people` on `game`, skipping any it already has. -> (created, reused, credits added)."""
    created: list[IgdbImportPersonResult] = []
    reused: list[IgdbImportPersonResult] = []
    person_cache: dict[tuple[str, int], int] = {}  # (source, igdb_id) → person.id
    linked = set(db.execute(
        select(GamePerson.person_id, GamePerson.role).where(GamePerson.game_id == game.id)
    ).tuples().all())
    added = 0
    seen_ids: set[int] = set()

    for p in people:
        is_new = False
        cache_key = (p.source, p.igdb_id)

        if cache_key in person_cache:
            person = db.get(Person, person_cache[cache_key])
        elif p.existing_person_id is not None:
            person = db.get(Person, p.existing_person_id)
            if person is None or person.guild_id != guild_id:
                raise ValueError(f"Person id={p.existing_person_id} not found")
        elif p.source == "company" and (known := db.scalar(
            select(Person).where(Person.guild_id == guild_id, Person.igdb_id == p.igdb_id)
        )) is not None:
            person = known  # this studio was imported before
        else:
            nat = nationalities.resolve(db, guild_id, p.nationality)
            person = Person(
                guild_id=guild_id, created_by_user_id=user_id,
                name=p.name,
                name_en=None,
                birth_nationality=nat,
                core_nationality=nat,
            )
            db.add(person)
            db.flush()
            is_new = True

        person_cache[cache_key] = person.id
        # Only companies: IGDB person ids live in a different id space.
        if p.source == "company" and person.igdb_id is None and not db.scalar(
            select(Person.id).where(Person.guild_id == guild_id, Person.igdb_id == p.igdb_id)
        ):
            person.igdb_id = p.igdb_id

        key = (person.id, p.role)
        if key not in linked:
            linked.add(key)
            added += 1
            db.add(GamePerson(game_id=game.id, person_id=person.id, role=p.role, guild_id=guild_id))

        if person.id not in seen_ids:
            seen_ids.add(person.id)
            item = IgdbImportPersonResult(
                person_id=person.id,
                name=person.name,
                nationality=person.birth_nationality,
                created=is_new,
            )
            (created if is_new else reused).append(item)

    return created, reused, added


def igdb_import_game(db: Session, guild_id: int, user_id: int, body: IgdbImportIn) -> IgdbImportOut:
    title_norm = norm(body.title)
    existing = db.scalar(
        select(Game).where(
            Game.guild_id == guild_id,
            (Game.name_norm == title_norm) | (Game.name_en_norm == title_norm),
            Game.release_year == body.release_year,
        )
    )
    if existing is None and body.igdb_id is not None:
        existing = db.scalar(select(Game).where(Game.guild_id == guild_id, Game.igdb_id == body.igdb_id))
    if existing:
        raise ValueError(f"Game '{body.title}' ({body.release_year}) already exists" f" (id={existing.id})")

    game = Game(guild_id=guild_id, created_by_user_id=user_id, name=body.title, name_en=None,
               release_year=body.release_year, igdb_id=body.igdb_id, overview=body.summary,
               image_url=body.cover_url)
    db.add(game)
    db.flush()

    created, reused, _ = _link_people(db, guild_id, user_id, game, body.people)

    if body.genre_ids:
        game.genres = list(db.scalars(
            select(Genre).where(Genre.guild_id == guild_id, Genre.id.in_(body.genre_ids), Genre.is_game.is_(True))
        ).all())
    if body.platform_ids:
        game.platforms = list(db.scalars(
            select(GamePlatform).where(GamePlatform.guild_id == guild_id, GamePlatform.id.in_(body.platform_ids))
        ).all())

    if body.add_to_list:
        db.add(UserGameRank(user_id=user_id, guild_id=guild_id, game_id=game.id,
                            rank=next_rank(db, UserGameRank, user_id=user_id, guild_id=guild_id)))
    db.flush()
    return IgdbImportOut(
        game_id=game.id,
        created_people=created,
        reused_people=reused,
    )


def igdb_merge_credits(db: Session, guild_id: int, user_id: int, game_id: int, body: IgdbCreditsIn) -> IgdbCreditsOut:
    """Add IGDB's credits to a game already in the catalog. Nothing existing is
    removed or overwritten: only missing credits, genres, platforms and blank metadata."""
    game = db.get(Game, game_id)
    if game is None or game.guild_id != guild_id:
        raise LookupError(f"Game {game_id} not found")
    if game.igdb_id is None and body.igdb_id is not None and not db.scalar(
        select(Game.id).where(Game.guild_id == guild_id, Game.igdb_id == body.igdb_id)
    ):
        game.igdb_id = body.igdb_id
    game.overview = game.overview or body.summary
    game.image_url = game.image_url or body.cover_url

    created, reused, added = _link_people(db, guild_id, user_id, game, body.people)
    new_genres = set(body.genre_ids) - {g.id for g in game.genres}
    if new_genres:
        game.genres = list(game.genres) + list(db.scalars(
            select(Genre).where(Genre.guild_id == guild_id, Genre.id.in_(new_genres), Genre.is_game.is_(True))
        ).all())
    new_platforms = set(body.platform_ids) - {p.id for p in game.platforms}
    if new_platforms:
        game.platforms = list(game.platforms) + list(db.scalars(
            select(GamePlatform).where(GamePlatform.guild_id == guild_id, GamePlatform.id.in_(new_platforms))
        ).all())
    db.flush()
    return IgdbCreditsOut(people_linked=added, created_people=created, reused_people=reused)
