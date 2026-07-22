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

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .api_models.igdb_import import (
    DbPersonMatchOut,
    IgdbGenreOut,
    IgdbImportIn,
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
)
from .igdb_client import TTL_DETAILS, TTL_SEARCH, IgdbClient, get_sidecar
from .ranking import rank_between

_KNOWN_NATIONALITIES = set(NATIONALITIES)

# Publishers are a distinct credit in IGDB. If GameRole doesn't model
# publishing separately, degrade to `developer` rather than 500-ing.
_PUBLISHER_ROLE = GameRole.__members__.get("publisher", GameRole.developer)

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
    names: set[str],
) -> dict[str, list[Person]]:
    """Single query for all candidate persons, with eager-loaded relations."""
    if not names:
        return {}
    rows = (
        db.query(Person)
        .filter(Person.name.in_(names) | Person.name_en.in_(names))
        .options(
            selectinload(Person.game_links).joinedload(GamePerson.game),
            selectinload(Person.artist_links)
            .joinedload(ArtistPerson.artist)
            .selectinload(Artist.album_links)
            .joinedload(AlbumArtist.album),
        )
        .all()
    )
    by_name: dict[str, list[Person]] = {}
    for p in rows:
        by_name.setdefault(p.name, []).append(p)
        if p.name_en and p.name_en != p.name:
            by_name.setdefault(p.name_en, []).append(p)
    return by_name


# ── DB matching (operates on pre-loaded data) ────────────────────────


def _filmography_overlaps(person: Person, title: str, year: int | None) -> bool:
    needle = title.strip().lower()
    for link in person.game_links:
        game = link.game
        if game is None:
            continue
        names = [game.name] + ([game.name_en] if game.name_en else [])
        if any(n.strip().lower() == needle for n in names):
            if year is None or game.release_year == year:
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
    title: str,
    year: int | None,
    persons_by_name: dict[str, list[Person]],
) -> list[DbPersonMatchOut]:
    seen: set[int] = set()
    out: list[DbPersonMatchOut] = []
    for c in persons_by_name.get(name, []):
        if c.id in seen:
            continue
        seen.add(c.id)
        has_games = bool(c.game_links)
        if has_games and not _filmography_overlaps(c, title, year):
            continue
        out.append(
            DbPersonMatchOut(
                person_id=c.id,
                person_name=c.name,
                has_game_entries=has_games,
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


def igdb_lookup(db: Session, title: str, year: int | None) -> IgdbLookupOut | None:
    client = IgdbClient(get_sidecar())

    escaped = title.replace('"', '\\"')
    search_query = (
        f'search "{escaped}"; '
        "fields name,first_release_date,summary,genres.name,platforms.name,total_rating,"
        "involved_companies.company.name,involved_companies.company.country,"
        "involved_companies.developer,involved_companies.publisher; "
        "limit 10;"
    )
    results = client.post("games", search_query, ttl=TTL_SEARCH)
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

    release_year = _release_year(best.get("first_release_date"))

    # ── Collect every developer/publisher-company credit ──────────────
    involved = best.get("involved_companies", [])
    all_names: set[str] = set()
    for ic in involved:
        company = ic.get("company") or {}
        name = company.get("name")
        if name and (ic.get("developer") or ic.get("publisher")):
            all_names.add(name)
    persons_by_name = _batch_load_persons(db, all_names)

    # ── Build enriched people list (company-level credits) ────────────
    people: list[IgdbPersonOut] = []
    seen_companies: set[str] = set()
    for ic in involved:
        company = ic.get("company") or {}
        name = company.get("name")
        if not name or name in seen_companies:
            continue
        is_dev = bool(ic.get("developer"))
        is_pub = bool(ic.get("publisher"))
        if not (is_dev or is_pub):
            continue
        seen_companies.add(name)

        role = GameRole.developer if is_dev else _PUBLISHER_ROLE
        reason = "developer" if is_dev else "publisher"

        people.append(
            IgdbPersonOut(
                igdb_id=company.get("id", ic.get("id")),
                name=name,
                source="company",
                suggested_role=role,
                suggestion_reason=reason,
                top_credits=[],
                nationality_guess=_nationality_from_country(company.get("country")),
                birth_place=None,  # IGDB has no per-credit locality, only country
                db_matches=_find_db_matches(name, best.get("name", title), release_year, persons_by_name),
            )
        )

    # ── Top credits: one extra batched call for the companies we kept ──
    company_ids = sorted({p.igdb_id for p in people if p.source == "company"})
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
        credits_by_id: dict[int, list[str]] = {
            r["id"]: [
                g["name"]
                for g in sorted(
                    r.get("developed", []),
                    key=lambda g: g.get("total_rating", 0) or 0,
                    reverse=True,
                )[:3]
            ]
            for r in rows
        }
        for p in people:
            if p.source == "company":
                p.top_credits = credits_by_id.get(p.igdb_id, [])

    # ── Genres ───────────────────────────────────────────────────────
    db_genres = db.query(Genre).filter(Genre.is_game.is_(True)).order_by(Genre.name).all()
    genres = [
        IgdbGenreOut(
            igdb_id=g["id"],
            igdb_name=g["name"],
            db_genre_id=_match_named(g["name"], db_genres),
        )
        for g in best.get("genres", [])
    ]

    # ── Platforms ────────────────────────────────────────────────────
    db_platforms = db.query(GamePlatform).order_by(GamePlatform.name).all()
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
        people=people,
        genres=genres,
        platforms=platforms,
        ambiguous=ambiguous,
    )


# ── Public: import ───────────────────────────────────────────────────


def igdb_import_game(db: Session, body: IgdbImportIn) -> IgdbImportOut:
    existing = (
        db.query(Game)
        .filter(
            (Game.name == body.title) | (Game.name_en == body.title),
            Game.release_year == body.release_year,
        )
        .first()
    )
    if existing:
        raise ValueError(f"Game '{body.title}' ({body.release_year}) already exists" f" (id={existing.id})")

    max_rank = db.scalar(select(func.max(Game.global_rank)))
    new_rank = rank_between(max_rank, None)

    game = Game(
        name=body.title,
        name_en=None,
        release_year=body.release_year,
        global_rank=new_rank,
    )
    db.add(game)
    db.flush()

    created: list[IgdbImportPersonResult] = []
    reused: list[IgdbImportPersonResult] = []
    person_cache: dict[tuple[str, int], int] = {}  # (source, igdb_id) → person.id
    linked: set[tuple[int, GameRole]] = set()
    seen_ids: set[int] = set()

    for p in body.people:
        is_new = False
        cache_key = (p.source, p.igdb_id)

        if cache_key in person_cache:
            person = db.get(Person, person_cache[cache_key])
        elif p.existing_person_id is not None:
            person = db.get(Person, p.existing_person_id)
            if person is None:
                raise ValueError(f"Person id={p.existing_person_id} not found")
        else:
            nat = p.nationality if p.nationality in _KNOWN_NATIONALITIES else "Unknown"
            person = Person(
                name=p.name,
                name_en=None,
                birth_nationality=nat,
                core_nationality=nat,
            )
            db.add(person)
            db.flush()
            is_new = True

        person_cache[cache_key] = person.id

        key = (person.id, p.role)
        if key not in linked:
            linked.add(key)
            db.add(GamePerson(game_id=game.id, person_id=person.id, role=p.role))

        if person.id not in seen_ids:
            seen_ids.add(person.id)
            item = IgdbImportPersonResult(
                person_id=person.id,
                name=person.name,
                nationality=person.birth_nationality,
                created=is_new,
            )
            (created if is_new else reused).append(item)

    if body.genre_ids:
        game.genres = db.query(Genre).filter(Genre.id.in_(body.genre_ids), Genre.is_game.is_(True)).all()
    if body.platform_ids:
        game.platforms = db.query(GamePlatform).filter(GamePlatform.id.in_(body.platform_ids)).all()

    db.flush()
    return IgdbImportOut(
        game_id=game.id,
        created_people=created,
        reused_people=reused,
    )
