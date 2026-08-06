"""Media-agnostic TMDB logic, shared by `tmdb_import` (movies),
`tmdb_tv_import` (television) and `tmdb_scan` (movie/person link scan).

All three need the same primitives: search-and-pick-best, the billing-order
cast-role heuristic, the cameo regex, `place_of_birth` -> our `nationality`
enum, the batched "is this existing Person the same human?" filmography-overlap
matcher, genre name/synonym mapping, and create-or-reuse person resolution.
They must agree: the same TMDB person imported from a movie and from a show has
to land on the same `people` row, and the scan's role suggestion has to match
the importer's or the two disagree about the same credit.

Person matching is media-agnostic: identity is a *person* question, not a
per-media one, so both importers read `/person/{id}/combined_credits` and
corroborate against the person's movies *and* shows.
"""

from __future__ import annotations

import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterator, Optional, Sequence

from sqlalchemy.orm import Session, selectinload

from .database_models import (
    NATIONALITIES,
    AlbumArtist,
    Artist,
    ArtistPerson,
    CastRole,
    GamePerson,
    Genre,
    MoviePerson,
    Person,
    TelevisionEpisode,
    TelevisionEpisodePerson,
    TelevisionShowPerson,
)
from .ranking import rank_at
from .tmdb_client import TTL_SEARCH, WORKERS, TmdbClient, get_sidecar

#: One call per person covers both media types, and identity is a *person*
#: question, not a per-media one: a TMDB "Bryan Cranston" is the same human
#: whether our row for him currently holds movie credits, TV credits or both.
#: So both importers read combined credits and corroborate against the person's
#: movies *and* shows. (This is why there's no longer a per-media `MediaKind`.)
PERSON_CREDITS_PATH = "/person/{pid}/combined_credits"

KNOWN_NATIONALITIES = set(NATIONALITIES)
TOP_CREDITS = 5

#: TMDB crew `job` -> role, for the two jobs a film credits at the top level.
#: Television has its own (larger, aggregate-aware) map — see `tmdb_tv_import`.
CREW_JOB_ROLES: dict[str, CastRole] = {
    "Director": CastRole.director,
    "Original Music Composer": CastRole.composer,
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

CAMEO_RE = re.compile(
    r"(uncredited|himself|herself|themselves|self\b|cameo|"
    r"^(man|woman|guy|girl|guest|patron|customer|waiter|waitress|"
    r"bartender|cop|officer|nurse|doctor|reporter)\b.*(#\d+|at |in |on )?)",
    re.IGNORECASE,
)

_PUNCT_RE = re.compile(r"[:\-–—,.'\"\[\]!?()&/]+")
_WS_RE = re.compile(r"\s+")

#: Television-only refinements to the billing-order heuristic: a 4th-billed
#: actor in 90% of episodes is a lead; a 1st-billed guest in one episode isn't.
LEAD_EPISODE_SHARE = 0.5
CAMEO_EPISODE_SHARE = 0.15


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(s: str) -> str:
    return _WS_RE.sub(" ", _PUNCT_RE.sub(" ", strip_accents(s).lower())).strip()


def client(*, force_refresh: bool = False) -> TmdbClient:
    return TmdbClient(get_sidecar(), force_refresh=force_refresh)


# ── Search ───────────────────────────────────────────────────────────
def search_best(
    c: TmdbClient,
    path: str,
    query: str,
    *,
    year: int | None,
    year_param: str,
    title_keys: Sequence[str],
) -> tuple[Optional[dict], bool]:
    """-> (best result | None, ambiguous). An exact title match (on any of
    ``title_keys``) wins outright; otherwise popularity breaks the tie."""
    params: dict[str, str] = {"query": query}
    if year is not None:
        params[year_param] = str(year)
    data = c.get(path, params=params, ttl=TTL_SEARCH)
    if not data or not data.get("results"):
        return None, False

    results = data["results"]
    needle = query.lower()
    exact = [r for r in results if any((r.get(k) or "").lower() == needle for k in title_keys)]
    pool = exact or results
    return max(pool, key=lambda r: r.get("popularity", 0)), len(pool) > 1


# ── Cast-role heuristic ──────────────────────────────────────────────
def suggest_cast_role(
    *,
    order: int | None,
    popularity: float = 0.0,
    character: str = "",
    episode_count: int | None = None,
    total_episodes: int | None = None,
) -> tuple[CastRole, str]:
    """The single cast-role suggestion used by the movie importer, the movie
    scan and the television importer.

    Billing order is the primary signal. When episode counts are supplied
    (television aggregate credits), episode share refines it."""
    o = 99 if order is None else order

    if character and CAMEO_RE.search(character):
        return CastRole.cameo_actor, f'character "{character}" looks like a bit part/cameo'

    share = (episode_count / total_episodes) if (episode_count and total_episodes) else None
    if share is not None:
        if share >= LEAD_EPISODE_SHARE and o <= 4:
            return CastRole.lead_actor, f"billed #{o + 1}, in {episode_count}/{total_episodes} episodes"
        if share < CAMEO_EPISODE_SHARE:
            return CastRole.cameo_actor, f"only in {episode_count}/{total_episodes} episodes"
        if o <= 2:
            return CastRole.lead_actor, f"billed #{o + 1}, in {episode_count}/{total_episodes} episodes"
        return CastRole.actor, f"billed #{o + 1}, in {episode_count}/{total_episodes} episodes"

    if o >= 10 and popularity >= 20:
        return CastRole.cameo_actor, f"high-profile actor (popularity {popularity:.0f}) billed low (#{o + 1})"
    if o <= 2:
        return CastRole.lead_actor, f"billed #{o + 1} in the credits"
    if o >= 12:
        return CastRole.cameo_actor, f"billed #{o + 1} (deep in the credits)"
    return CastRole.actor, f"billed #{o + 1} (supporting range)"


# ── Nationality ──────────────────────────────────────────────────────
def derive_nationality(details: dict) -> tuple[str, str | None]:
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
    if country in KNOWN_NATIONALITIES:
        return country, place
    return "Unknown", place


# ── Filmography (movies + television, from /combined_credits) ─────────
def _credit_title_year(c: dict) -> tuple[str, str, bool]:
    """-> (title, 4-digit year or "", is_tv). TMDB keys movies on
    title/release_date and shows on name/first_air_date."""
    is_tv = (c.get("media_type") or "").lower() == "tv" or (not c.get("title") and bool(c.get("name")))
    title = (c.get("name") if is_tv else c.get("title")) or c.get("title") or c.get("name") or ""
    date = (c.get("first_air_date") if is_tv else c.get("release_date")) or ""
    return title, date[:4], is_tv


def parse_filmography(data: dict | None) -> list[tuple[dict, str]]:
    if not data:
        return []
    seen: set[int] = set()
    out: list[tuple[dict, str]] = []
    for c in data.get("cast", []):
        if c.get("id") and c["id"] not in seen:
            seen.add(c["id"])
            out.append((c, c.get("character") or "Unknown role"))
    for c in data.get("crew", []):
        if c.get("id") and c["id"] not in seen:
            seen.add(c["id"])
            out.append((c, c.get("job") or "Crew"))
    return out


def format_top_credits(filmography: list[tuple[dict, str]]) -> list[str]:
    by_pop = sorted(filmography, key=lambda p: p[0].get("popularity", 0), reverse=True)
    entries: list[str] = []
    for c, role in by_pop[:TOP_CREDITS]:
        title, year, is_tv = _credit_title_year(c)
        head = f"{title} ({year})" if year else (title or "?")
        entries.append(f"{head} — {role}" + (" [TV]" if is_tv else ""))
    return entries


def filmography_keys(filmography: list[tuple[dict, str]]) -> set[tuple[str, str | None]]:
    keys: set[tuple[str, str | None]] = set()
    for c, _ in filmography:
        title, year, _is_tv = _credit_title_year(c)
        t = title.strip().lower()
        if t:
            keys.add((t, year))
            keys.add((t, None))
    return keys


# ── A Person's existing screen credits ───────────────────────────────
def _titles(name: str | None, name_en: str | None, year: int | None) -> Iterator[tuple[str, str]]:
    y = str(year) if year else ""
    for n in (name, name_en):
        if n:
            yield n, y


def local_screen_entries(person: Person) -> Iterator[tuple[str, str]]:
    """Every movie and show this person is already credited on. TMDB's TV
    credits are keyed on the *show*, so an episode credit corroborates its
    show's title just as well as a show-level credit does."""
    for link in person.movie_links:
        m = link.movie
        if m is not None:
            yield from _titles(m.name, m.name_en, m.release_year)
    for link in person.television_links:
        s = link.show
        if s is not None:
            yield from _titles(s.name, s.name_en, s.release_year)
    for link in person.television_episode_links:
        ep = link.episode
        if ep is not None and ep.show is not None:
            yield from _titles(ep.show.name, ep.show.name_en, ep.show.release_year)


def has_screen_entries(person: Person) -> bool:
    """Whether this person has anything a TMDB filmography could corroborate."""
    return bool(person.movie_links or person.television_links or person.television_episode_links)


def filmography_overlaps(person: Person, film_keys: set[tuple[str, str | None]]) -> bool:
    for title, year in local_screen_entries(person):
        t = title.strip().lower()
        if (t, year) in film_keys or (t, None) in film_keys:
            return True
    return False


def person_load_options() -> list:
    """Eager-load everything the matcher and the summaries touch — the
    enrichment loop fans out to threads, so nothing may lazy-load later."""
    return [
        selectinload(Person.movie_links).joinedload(MoviePerson.movie),
        selectinload(Person.television_links).joinedload(TelevisionShowPerson.show),
        selectinload(Person.television_episode_links)
        .joinedload(TelevisionEpisodePerson.episode)
        .joinedload(TelevisionEpisode.show),
        selectinload(Person.game_links).joinedload(GamePerson.game),
        selectinload(Person.artist_links)
        .joinedload(ArtistPerson.artist)
        .selectinload(Artist.album_links)
        .joinedload(AlbumArtist.album),
    ]


def batch_load_persons(db: Session, names: set[str]) -> dict[str, list[Person]]:
    """Single query for all candidate persons, relations eager-loaded."""
    if not names:
        return {}
    rows = (
        db.query(Person)
        .filter(Person.name.in_(names) | Person.name_en.in_(names))
        .options(*person_load_options())
        .all()
    )
    by_name: dict[str, list[Person]] = {}
    for p in rows:
        by_name.setdefault(p.name, []).append(p)
        if p.name_en and p.name_en != p.name:
            by_name.setdefault(p.name_en, []).append(p)
    return by_name


# ── Non-screen credit summaries (disambiguation evidence) ────────────
def artist_summary(person: Person) -> str:
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


def game_summary(person: Person) -> str:
    """The games half of the same evidence: a name-only match with a big game
    credit list is usually a real person, just not a screen one."""
    if not person.game_links:
        return "(no game entries)"
    by_game: dict[tuple[str, int | None], set[str]] = {}
    for link in person.game_links:
        game = link.game
        if game is None:
            continue
        by_game.setdefault((game.name, game.release_year), set()).add(link.role.value.replace("_", " "))
    parts: list[str] = []
    for (name, year), roles in sorted(by_game.items()):
        head = f"{name} ({year})" if year else name
        parts.append(f"{head} — {', '.join(sorted(roles))}")
    return "; ".join(parts) if parts else "(no game entries)"


@dataclass
class PersonMatch:
    person_id: int
    person_name: str
    has_screen_entries: bool
    artist_summary: str
    game_summary: str


def find_db_matches(
    name: str,
    film_keys: set[tuple[str, str | None]],
    persons_by_name: dict[str, list[Person]],
) -> list[PersonMatch]:
    """Existing people with this name who could plausibly be this TMDB person.
    Someone with screen credits that share *nothing* with the TMDB filmography
    is demonstrably a different human and is dropped."""
    seen: set[int] = set()
    out: list[PersonMatch] = []
    for c in persons_by_name.get(name, []):
        if c.id in seen:
            continue
        seen.add(c.id)
        has = has_screen_entries(c)
        if has and not filmography_overlaps(c, film_keys):
            continue
        out.append(
            PersonMatch(
                person_id=c.id,
                person_name=c.name,
                has_screen_entries=has,
                artist_summary=artist_summary(c),
                game_summary=game_summary(c),
            )
        )
    return out


# ── Per-person TMDB enrichment ───────────────────────────────────────
@dataclass
class PersonTmdbData:
    tmdb_id: int
    filmography: list[tuple[dict, str]] = field(default_factory=list)
    details: dict = field(default_factory=dict)


@dataclass
class PersonEnrichment:
    top_credits: list[str]
    nationality_guess: str
    birth_place: str | None
    db_matches: list[PersonMatch]


def fetch_person_data(c: TmdbClient, tmdb_id: int) -> PersonTmdbData:
    film = c.get(PERSON_CREDITS_PATH.format(pid=tmdb_id))
    details = c.get(f"/person/{tmdb_id}")
    return PersonTmdbData(tmdb_id, parse_filmography(film), details or {})


def fetch_person_data_bulk(c: TmdbClient, ids: list[int]) -> dict[int, PersonTmdbData]:
    """Network only, in parallel. Kept strictly separate from `build_enrichment`
    so no Session work happens off the main thread."""
    ids = list(dict.fromkeys(ids))
    out: dict[int, PersonTmdbData] = {}
    if not ids:
        return out
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {ex.submit(fetch_person_data, c, pid): pid for pid in ids}
        for fut, pid in futures.items():
            try:
                out[pid] = fut.result()
            except Exception:  # one person 500ing must not sink the lookup
                out[pid] = PersonTmdbData(pid)
    return out


def build_enrichment(
    data: PersonTmdbData,
    name: str,
    persons_by_name: dict[str, list[Person]],
) -> PersonEnrichment:
    nat_guess, birth_place = derive_nationality(data.details)
    return PersonEnrichment(
        top_credits=format_top_credits(data.filmography),
        nationality_guess=nat_guess,
        birth_place=birth_place,
        db_matches=find_db_matches(name, filmography_keys(data.filmography), persons_by_name),
    )


# ── Genres ───────────────────────────────────────────────────────────
def match_genre(tmdb_name: str, db_genres: list[Genre]) -> int | None:
    needle = tmdb_name.strip().lower()
    for g in db_genres:
        if needle == g.name.lower():
            return g.id
        for s in g.synonyms or []:
            if needle == s.lower():
                return g.id
    return None


def db_genres_for(db: Session, media_flag: str) -> list[Genre]:
    return db.query(Genre).filter(getattr(Genre, media_flag).is_(True)).order_by(Genre.name).all()


# ── Import-side person resolution ────────────────────────────────────
@dataclass
class ResolvedPerson:
    person_id: int
    name: str
    nationality: str
    created: bool


class PeopleResolver:
    """Create-or-reuse people across one import, keyed on TMDB id, recording
    created/reused exactly once per person even when the same human is credited
    on the show *and* on a dozen episodes."""

    def __init__(self, db: Session):
        self.db = db
        self._by_tmdb: dict[int, Person] = {}
        self._seen: set[int] = set()
        self.created: list[ResolvedPerson] = []
        self.reused: list[ResolvedPerson] = []

    def resolve(
        self,
        *,
        tmdb_id: int,
        name: str,
        nationality: str,
        existing_person_id: int | None = None,
    ) -> Person:
        is_new = False
        if tmdb_id in self._by_tmdb:
            person = self._by_tmdb[tmdb_id]
        elif existing_person_id is not None:
            person = self.db.get(Person, existing_person_id)
            if person is None:
                raise ValueError(f"Person id={existing_person_id} not found")
        else:
            nat = nationality if nationality in KNOWN_NATIONALITIES else "Unknown"
            person = Person(name=name, name_en=None, birth_nationality=nat, core_nationality=nat)
            self.db.add(person)
            self.db.flush()
            is_new = True

        self._by_tmdb[tmdb_id] = person
        if person.id not in self._seen:
            self._seen.add(person.id)
            item = ResolvedPerson(person.id, person.name, person.birth_nationality, is_new)
            (self.created if is_new else self.reused).append(item)
        return person


def append_rank(db: Session, rank_col, *, id_col, scope=None) -> Decimal:
    """The rank for a newly imported row: straight after the current maximum."""
    return rank_at(db, rank_col, None, exclude_col=id_col, exclude=None, scope=scope)
