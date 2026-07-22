"""TMDB movie lookup + import service.

``tmdb_lookup`` searches TMDB, enriches every credit with filmography /
nationality data **and** checks the local DB for matching persons so the
frontend can show a fully-informed review list.

``tmdb_import_movie`` takes the user's selections and creates the movie,
persons, genre links, and person-movie links in one transaction.
"""

from __future__ import annotations

import re
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .api_models.tmdb_import import (
    DbPersonMatchOut,
    TmdbGenreOut,
    TmdbImportIn,
    TmdbImportOut,
    TmdbImportPersonResult,
    TmdbLookupOut,
    TmdbPersonOut,
)
from .database_models import (
    NATIONALITIES,
    AlbumArtist,
    Artist,
    ArtistPerson,
    CastRole,
    Genre,
    Movie,
    MoviePerson,
    Person,
)
from .ranking import rank_between
from .tmdb_client import TTL_SEARCH, TmdbClient, get_sidecar

_KNOWN_NATIONALITIES = set(NATIONALITIES)

TOP_CREDITS = 5

CATEGORY_TO_ROLE = {
    "Lead Actor": CastRole.lead_actor,
    "Actor": CastRole.actor,
    "Cameo Actor": CastRole.cameo_actor,
}

COUNTRY_TO_NATIONALITY: dict[str, str] = {
    "usa": "American",
    "u.s.a.": "American",
    "us": "American",
    "united states": "American",
    "united states of america": "American",
    "andorra": "Andorran",
    "argentina": "Argentinian",
    "armenia": "Armenian",
    "australia": "Australian",
    "austria": "Austrian",
    "belgium": "Belgian",
    "benin": "Beninois",
    "brazil": "Brazilian",
    "canada": "Canadian",
    "chile": "Chilean",
    "china": "Chinese",
    "colombia": "Colombian",
    "croatia": "Croatian",
    "cuba": "Cuban",
    "cyprus": "Cypriot",
    "czech republic": "Czech",
    "czechia": "Czech",
    "czechoslovakia": "Czech",
    "denmark": "Danish",
    "netherlands": "Dutch",
    "the netherlands": "Dutch",
    "egypt": "Egyptian",
    "england": "English",
    "philippines": "Filipino",
    "finland": "Finnish",
    "france": "French",
    "germany": "German",
    "west germany": "German",
    "east germany": "German",
    "ghana": "Ghanaian",
    "greece": "Greek",
    "guatemala": "Guatemalan",
    "guyana": "Guyanese",
    "hong kong": "Hongkongese",
    "hungary": "Hungarian",
    "iceland": "Icelandic",
    "india": "Indian",
    "indonesia": "Indonesian",
    "iran": "Iranian",
    "ireland": "Irish",
    "israel": "Israeli",
    "italy": "Italian",
    "jamaica": "Jamaican",
    "japan": "Japanese",
    "kenya": "Kenyan",
    "south korea": "Korean",
    "north korea": "Korean",
    "korea": "Korean",
    "latvia": "Latvian",
    "lebanon": "Lebanese",
    "liberia": "Liberian",
    "lithuania": "Lithuanian",
    "luxembourg": "Luxembourgish",
    "malaysia": "Malaysian",
    "mali": "Malian",
    "mexico": "Mexican",
    "new zealand": "New Zealander",
    "nigeria": "Nigerian",
    "northern ireland": "Northern Irish",
    "norway": "Norwegian",
    "oman": "Omani",
    "panama": "Panamanian",
    "poland": "Polish",
    "portugal": "Portuguese",
    "romania": "Romanian",
    "russia": "Russian",
    "soviet union": "Russian",
    "ussr": "Russian",
    "saudi arabia": "Saudi",
    "scotland": "Scottish",
    "serbia": "Serbian",
    "singapore": "Singaporean",
    "somalia": "Somalian",
    "south africa": "South African",
    "spain": "Spanish",
    "swaziland": "Swazi",
    "eswatini": "Swazi",
    "sweden": "Swedish",
    "switzerland": "Swiss",
    "taiwan": "Taiwanese",
    "thailand": "Thai",
    "trinidad and tobago": "Trinidadian and Tobagonian",
    "ukraine": "Ukrainian",
    "uruguay": "Uruguayan",
    "venezuela": "Venezuelan",
    "vietnam": "Vietnamese",
    "wales": "Welsh",
    "yugoslavia": "Yugoslav",
    "zimbabwe": "Zimbabwean",
    "uk": "English",
    "u.k.": "English",
    "great britain": "English",
    "britain": "English",
    "united kingdom": "English",
    "gb": "English",
    "g.b.": "English",
    "великобритания": "English",
    "сша": "American",
    "франция": "French",
    "германия": "German",
    "испания": "Spanish",
    "италия": "Italian",
    "австралия": "Australian",
    "канада": "Canadian",
    "япония": "Japanese",
    "китай": "Chinese",
    "южная корея": "Korean",
    "бразилия": "Brazilian",
    "мексика": "Mexican",
    "австрия": "Austrian",
    "швеция": "Swedish",
    "норвегия": "Norwegian",
    "дания": "Danish",
    "финляндия": "Finnish",
    "нидерланды": "Dutch",
    "швейцария": "Swiss",
    "польша": "Polish",
    "чехия": "Czech",
    "венгрия": "Hungarian",
    "израиль": "Israeli",
    "индия": "Indian",
    "ирландия": "Irish",
    "аргентина": "Argentinian",
    "португалия": "Portuguese",
    "румыния": "Romanian",
    "украина": "Ukrainian",
    "бельгия": "Belgian",
}

_CAMEO_RE = re.compile(
    r"(uncredited|himself|herself|themselves|self\b|cameo|"
    r"^(man|woman|guy|girl|guest|patron|customer|waiter|waitress|"
    r"bartender|cop|officer|nurse|doctor|reporter)\b.*(#\d+|at |in |on )?)",
    re.IGNORECASE,
)


# ── TMDB helpers ─────────────────────────────────────────────────────


def _suggest_category(member: dict) -> tuple[str, str]:
    order = member.get("order", 99)
    popularity = member.get("popularity", 0)
    character = member.get("character") or ""
    if _CAMEO_RE.search(character):
        return "Cameo Actor", f'character "{character}" looks like a bit part/cameo'
    if order >= 10 and popularity >= 20:
        return "Cameo Actor", (f"high-profile actor (popularity {popularity:.0f}) billed low (#{order + 1})")
    if order <= 2:
        return "Lead Actor", f"billed #{order + 1} in the credits"
    if order >= 12:
        return "Cameo Actor", f"billed #{order + 1} (deep in the credits)"
    return "Actor", f"billed #{order + 1} (supporting range)"


def _parse_filmography(data: dict | None) -> list[tuple[dict, str]]:
    if not data:
        return []
    seen: set[int] = set()
    out: list[tuple[dict, str]] = []
    for c in data.get("cast", []):
        if c["id"] not in seen:
            seen.add(c["id"])
            out.append((c, c.get("character") or "Unknown role"))
    for c in data.get("crew", []):
        if c["id"] not in seen:
            seen.add(c["id"])
            out.append((c, c.get("job") or "Crew"))
    return out


def _format_top_credits(filmography: list[tuple[dict, str]]) -> list[str]:
    by_pop = sorted(filmography, key=lambda p: p[0].get("popularity", 0), reverse=True)
    entries: list[str] = []
    for c, role in by_pop[:TOP_CREDITS]:
        year = (c.get("release_date") or "")[:4]
        title = c.get("title", "?")
        entries.append(f"{title} ({year}) — {role}" if year else f"{title} — {role}")
    return entries


def _filmography_keys(
    filmography: list[tuple[dict, str]],
) -> set[tuple[str, str | None]]:
    keys: set[tuple[str, str | None]] = set()
    for c, _ in filmography:
        title = (c.get("title") or "").strip().lower()
        year = (c.get("release_date") or "")[:4]
        if title:
            keys.add((title, year))
            keys.add((title, None))
    return keys


def _derive_nationality(details: dict) -> tuple[str, str | None]:
    place = (details.get("place_of_birth") or "").strip()
    if not place:
        return "Unknown", None
    segments = [s.strip().lower() for s in place.split(",") if s.strip()]
    for seg in segments:
        if seg in COUNTRY_TO_NATIONALITY:
            return COUNTRY_TO_NATIONALITY[seg], place
    if place.strip().lower() in COUNTRY_TO_NATIONALITY:
        return COUNTRY_TO_NATIONALITY[place.strip().lower()], place
    country = segments[-1].title() if segments else "Unknown"
    if country in _KNOWN_NATIONALITIES:
        return country, place
    return "Unknown", place


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
            selectinload(Person.movie_links).joinedload(MoviePerson.movie),
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


def _filmography_overlaps(
    person: Person,
    film_keys: set[tuple[str, str | None]],
) -> bool:
    for link in person.movie_links:
        movie = link.movie
        if movie is None:
            continue
        names = [movie.name] + ([movie.name_en] if movie.name_en else [])
        year = str(movie.release_year) if movie.release_year else ""
        if any((n.strip().lower(), year) in film_keys or (n.strip().lower(), None) in film_keys for n in names):
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
    film_keys: set[tuple[str, str | None]],
    persons_by_name: dict[str, list[Person]],
) -> list[DbPersonMatchOut]:
    seen: set[int] = set()
    out: list[DbPersonMatchOut] = []
    for c in persons_by_name.get(name, []):
        if c.id in seen:
            continue
        seen.add(c.id)
        has_movies = bool(c.movie_links)
        if has_movies and not _filmography_overlaps(c, film_keys):
            continue
        out.append(
            DbPersonMatchOut(
                person_id=c.id,
                person_name=c.name,
                has_movie_entries=has_movies,
                artist_summary=_artist_summary(c),
            )
        )
    return out


def _match_genre(tmdb_name: str, db_genres: list[Genre]) -> int | None:
    needle = tmdb_name.strip().lower()
    for g in db_genres:
        if needle == g.name.lower():
            return g.id
        for s in g.synonyms or []:
            if needle == s.lower():
                return g.id
    return None


# ── Per-person TMDB enrichment ───────────────────────────────────────


def _enrich_person(
    client: TmdbClient,
    member: dict,
    credit_type: Literal["cast", "crew"],
    suggested_role: CastRole,
    persons_by_name: dict[str, list[Person]],
    *,
    character: str | None = None,
    billing_order: int | None = None,
    job: str | None = None,
    suggestion_reason: str = "",
) -> TmdbPersonOut:
    film_data = client.get(f"/person/{member['id']}/movie_credits")
    filmography = _parse_filmography(film_data)
    film_keys = _filmography_keys(filmography)

    details = client.get(f"/person/{member['id']}")
    nat_guess, birth_place = _derive_nationality(details or {})

    return TmdbPersonOut(
        tmdb_id=member["id"],
        name=member["name"],
        credit_type=credit_type,
        character=character,
        billing_order=billing_order,
        job=job,
        suggested_role=suggested_role,
        suggestion_reason=suggestion_reason,
        top_credits=_format_top_credits(filmography),
        nationality_guess=nat_guess,
        birth_place=birth_place,
        db_matches=_find_db_matches(member["name"], film_keys, persons_by_name),
    )


# ── Public: lookup ───────────────────────────────────────────────────


def tmdb_lookup(db: Session, title: str, year: int | None) -> TmdbLookupOut | None:
    client = TmdbClient(get_sidecar())

    params: dict[str, str] = {"query": title}
    if year is not None:
        params["primary_release_year"] = str(year)
    data = client.get("/search/movie", params=params, ttl=TTL_SEARCH)
    if not data or not data.get("results"):
        return None

    results = data["results"]
    exact = [r for r in results if r.get("title", "").lower() == title.lower()]
    pool = exact or results
    ambiguous = len(pool) > 1
    best = max(pool, key=lambda r: r.get("popularity", 0))

    details = client.get(f"/movie/{best['id']}")
    credits_data = client.get(f"/movie/{best['id']}/credits")
    if details is None or credits_data is None:
        return None

    # ── Collect every name we will check, then batch-load from DB ────
    all_names: set[str] = set()
    for m in credits_data.get("crew", []):
        if m.get("job") in ("Director", "Original Music Composer"):
            all_names.add(m["name"])
    for m in credits_data.get("cast", []):
        all_names.add(m["name"])
    persons_by_name = _batch_load_persons(db, all_names)

    # ── Build enriched people list ───────────────────────────────────
    people: list[TmdbPersonOut] = []
    seen_crew: set[tuple[int, str]] = set()

    for m in credits_data.get("crew", []):
        if m.get("job") not in ("Director", "Original Music Composer"):
            continue
        key = (m["id"], m["job"])
        if key in seen_crew:
            continue
        seen_crew.add(key)
        role = CastRole.director if m["job"] == "Director" else CastRole.composer
        people.append(
            _enrich_person(
                client,
                m,
                "crew",
                role,
                persons_by_name,
                job=m["job"],
                suggestion_reason=m["job"],
            )
        )

    for m in credits_data.get("cast", []):
        cat, reason = _suggest_category(m)
        people.append(
            _enrich_person(
                client,
                m,
                "cast",
                CATEGORY_TO_ROLE[cat],
                persons_by_name,
                character=m.get("character"),
                billing_order=m.get("order"),
                suggestion_reason=reason,
            )
        )

    # ── Genres ───────────────────────────────────────────────────────
    db_genres = db.query(Genre).filter(Genre.is_movie.is_(True)).order_by(Genre.name).all()
    genres = [
        TmdbGenreOut(
            tmdb_id=tg["id"],
            tmdb_name=tg["name"],
            db_genre_id=_match_genre(tg["name"], db_genres),
        )
        for tg in details.get("genres", [])
    ]

    return TmdbLookupOut(
        tmdb_id=best["id"],
        title=best.get("title", title),
        original_title=best.get("original_title"),
        release_date=best.get("release_date"),
        runtime=details.get("runtime") or 0,
        overview=best.get("overview"),
        people=people,
        genres=genres,
        ambiguous=ambiguous,
    )


# ── Public: import ───────────────────────────────────────────────────


def tmdb_import_movie(db: Session, body: TmdbImportIn) -> TmdbImportOut:
    existing = (
        db.query(Movie)
        .filter(
            (Movie.name == body.title) | (Movie.name_en == body.title),
            Movie.release_year == body.release_year,
        )
        .first()
    )
    if existing:
        raise ValueError(f"Movie '{body.title}' ({body.release_year}) already exists" f" (id={existing.id})")

    max_rank = db.scalar(select(func.max(Movie.global_rank)))
    new_rank = rank_between(max_rank, None)

    name_en = body.title if body.original_title and body.original_title != body.title else None
    movie = Movie(
        name=body.title,
        name_en=name_en,
        runtime_minutes=body.runtime_minutes,
        release_year=body.release_year,
        global_rank=new_rank,
    )
    db.add(movie)
    db.flush()

    created: list[TmdbImportPersonResult] = []
    reused: list[TmdbImportPersonResult] = []
    person_cache: dict[int, int] = {}  # tmdb_id → person.id
    linked: set[tuple[int, CastRole]] = set()
    seen_ids: set[int] = set()

    for p in body.people:
        is_new = False

        if p.tmdb_id in person_cache:
            person = db.get(Person, person_cache[p.tmdb_id])
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

        person_cache[p.tmdb_id] = person.id

        key = (person.id, p.role)
        if key not in linked:
            linked.add(key)
            db.add(MoviePerson(movie_id=movie.id, person_id=person.id, role=p.role))

        if person.id not in seen_ids:
            seen_ids.add(person.id)
            item = TmdbImportPersonResult(
                person_id=person.id,
                name=person.name,
                nationality=person.birth_nationality,
                created=is_new,
            )
            (created if is_new else reused).append(item)

    if body.genre_ids:
        movie.genres = db.query(Genre).filter(Genre.id.in_(body.genre_ids), Genre.is_movie.is_(True)).all()

    db.flush()
    return TmdbImportOut(
        movie_id=movie.id,
        created_people=created,
        reused_people=reused,
    )
