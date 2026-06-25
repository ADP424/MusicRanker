"""
movie_credits_db.py


Tkinter UI for reviewing movie cast, writing to PostgreSQL.
- Director & composer auto-included; cast classified by the user.
- Full cast is shown (no limit); a "Skip Rest" button finishes a movie early.
- Genre selection step between cast review and save, with live TMDB→DB
  matching, synonym mapping, and on-the-fly genre creation.
- Buttons are pinned to the bottom of the window.
- Ends with a summary of all newly created people and their nationalities.


Usage:
    python movie_credits_db.py
"""

import os
import re
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

import requests
from dotenv import load_dotenv
from sqlalchemy import text

import server.database as _db
from server.database import dispose_engine, init_engine
from server.database_models import CastRole, Movie, MovieGenre, MoviePerson, Person

load_dotenv()


TMDB_BEARER = os.environ["TMDB_BEARER_TOKEN"]
TMDB_BASE = "https://api.themoviedb.org/3"


SESSION = requests.Session()
SESSION.headers.update({"Authorization": f"Bearer {TMDB_BEARER}", "accept": "application/json"})


TOP_CREDITS = 5


CATEGORIES = ["Lead Actor", "Actor", "Cameo Actor"]
CATEGORY_TO_ROLE = {
    "Lead Actor": CastRole.lead_actor,
    "Actor": CastRole.actor,
    "Cameo Actor": CastRole.cameo_actor,
}


NATIONALITIES = (
    "American",
    "Andorran",
    "Argentinian",
    "Armenian",
    "Australian",
    "Austrian",
    "Belgian",
    "Beninois",
    "Brazilian",
    "Canadian",
    "Chilean",
    "Chinese",
    "Columbian",
    "Croatian",
    "Cuban",
    "Cypriot",
    "Czech",
    "Danish",
    "Dutch",
    "Egyptian",
    "English",
    "Filipino",
    "Finnish",
    "French",
    "German",
    "Ghanaian",
    "Greek",
    "Guatemalan",
    "Guyanese",
    "Hongkongese",
    "Hungarian",
    "Icelandic",
    "Indian",
    "Indonesian",
    "Iranian",
    "Irish",
    "Israeli",
    "Italian",
    "Jamaican",
    "Japanese",
    "Kenyan",
    "Korean",
    "Latvian",
    "Lebanese",
    "Liberian",
    "Lithuanian",
    "Luxembourgish",
    "Malaysian",
    "Malian",
    "Mexican",
    "New Zealander",
    "Nigerian",
    "Northern Irish",
    "Norwegian",
    "Omani",
    "Panamanian",
    "Polish",
    "Portuguese",
    "Romanian",
    "Russian",
    "Saudi",
    "Scottish",
    "Serbian",
    "Singaporean",
    "Somalian",
    "South African",
    "Spanish",
    "Swazi",
    "Swedish",
    "Swiss",
    "Taiwanese",
    "Thai",
    "Trinidadian and Tobagonian",
    "Ukrainian",
    "Unknown",
    "Uruguayan",
    "Venezuelan",
    "Vietnamese",
    "Welsh",
    "Yugoslav",
    "Zimbabween",
)
KNOWN_NATIONALITIES = set(NATIONALITIES)


COUNTRY_TO_NATIONALITY = {
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
    "colombia": "Columbian",
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
    "zimbabwe": "Zimbabween",
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


CAMEO_CHARACTER_PATTERNS = re.compile(
    r"(uncredited|himself|herself|themselves|self\b|cameo|"
    r"^(man|woman|guy|girl|guest|patron|customer|waiter|waitress|"
    r"bartender|cop|officer|nurse|doctor|reporter)\b.*(#\d+|at |in |on )?)",
    re.IGNORECASE,
)


# ----------------------------------------------------------------------
# TMDB helpers
# ----------------------------------------------------------------------
def parse_input_line(line):
    """Parse: title [year] [rank]  — year is 4 digits, rank is any other integer."""
    line = line.strip()
    if not line:
        return None
    parts = line.split()
    year = None
    rank = None
    if parts and parts[-1].isdigit() and len(parts[-1]) != 4:
        rank = int(parts[-1])
        parts = parts[:-1]
    if parts and parts[-1].isdigit() and len(parts[-1]) == 4:
        year = parts[-1]
        parts = parts[:-1]
    title = " ".join(parts)
    if not title:
        return None
    return title, year, rank


def search_movie(title, year):
    params = {"query": title}
    if year:
        params["primary_release_year"] = year
    resp = SESSION.get(f"{TMDB_BASE}/search/movie", params=params)
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if not results:
        return None, False
    exact = [r for r in results if r.get("title", "").lower() == title.lower()]
    candidates = exact if exact else results
    ambiguous = len(candidates) > 1
    best = max(candidates, key=lambda r: r.get("popularity", 0))
    return best, ambiguous


def get_movie_details(movie_id):
    resp = SESSION.get(f"{TMDB_BASE}/movie/{movie_id}")
    resp.raise_for_status()
    return resp.json()


def get_credits(movie_id):
    resp = SESSION.get(f"{TMDB_BASE}/movie/{movie_id}/credits")
    resp.raise_for_status()
    return resp.json()


def get_person_details(person_id):
    resp = SESSION.get(f"{TMDB_BASE}/person/{person_id}")
    resp.raise_for_status()
    return resp.json()


def get_person_movie_credits(person_id):
    resp = SESSION.get(f"{TMDB_BASE}/person/{person_id}/movie_credits")
    resp.raise_for_status()
    data = resp.json()
    seen, unique = set(), []
    for c in data.get("cast", []):
        if c["id"] not in seen:
            seen.add(c["id"])
            unique.append((c, c.get("character") or "Unknown role"))
    for c in data.get("crew", []):
        if c["id"] not in seen:
            seen.add(c["id"])
            unique.append((c, c.get("job") or "Crew"))
    return unique


def format_top_credits(filmography):
    by_pop = sorted(filmography, key=lambda p: p[0].get("popularity", 0), reverse=True)
    entries = []
    for c, role in by_pop[:TOP_CREDITS]:
        year = (c.get("release_date") or "")[:4]
        title = c.get("title", "?")
        movie_str = f"{title} ({year})" if year else title
        entries.append(f"{movie_str} — {role}")
    return entries


def filmography_keys(filmography):
    keys = set()
    for c, _role in filmography:
        title = (c.get("title") or "").strip().lower()
        year = (c.get("release_date") or "")[:4]
        if title:
            keys.add((title, year))
            keys.add((title, None))
    return keys


def derive_nationality(person_details):
    place = (person_details.get("place_of_birth") or "").strip()
    if not place:
        return "Unknown", None
    segments = [s.strip().lower() for s in place.split(",") if s.strip()]
    for seg in segments:
        if seg in COUNTRY_TO_NATIONALITY:
            return COUNTRY_TO_NATIONALITY[seg], place
    full_lower = place.strip().lower()
    if full_lower in COUNTRY_TO_NATIONALITY:
        return COUNTRY_TO_NATIONALITY[full_lower], place
    country = segments[-1].title() if segments else "Unknown"
    return country, place


def suggest_category(cast_member):
    order = cast_member.get("order", 99)
    popularity = cast_member.get("popularity", 0)
    character = cast_member.get("character") or ""
    if CAMEO_CHARACTER_PATTERNS.search(character):
        return "Cameo Actor", f'character "{character}" looks like a bit part/cameo'
    if order >= 10 and popularity >= 20:
        return (
            "Cameo Actor",
            f"high-profile actor (popularity {popularity:.0f}) billed low " f"(#{order + 1})",
        )
    if order <= 2:
        return "Lead Actor", f"billed #{order + 1} in the credits"
    if order >= 12:
        return "Cameo Actor", f"billed #{order + 1} (deep in the credits)"
    return "Actor", f"billed #{order + 1} (supporting range)"


def build_movie_data(movie):
    credits = get_credits(movie["id"])

    def build_person(member, extra):
        filmography = get_person_movie_credits(member["id"])
        details = get_person_details(member["id"])
        guess, place = derive_nationality(details)
        return {
            "tmdb_id": member["id"],
            "name": member["name"],
            "top": format_top_credits(filmography),
            "filmography_keys": filmography_keys(filmography),
            "nationality_guess": guess,
            "birth_place": place,
            **extra,
        }

    auto_crew = []
    seen = set()
    for member in credits.get("crew", []):
        if member.get("job") not in ("Director", "Original Music Composer"):
            continue
        key = (member["id"], member["job"])
        if key in seen:
            continue
        seen.add(key)
        role = CastRole.director if member["job"] == "Director" else CastRole.composer
        auto_crew.append(build_person(member, {"db_role": role}))

    cast_list = []
    for member in credits.get("cast", []):
        suggestion, reason = suggest_category(member)
        cast_list.append(
            build_person(
                member,
                {
                    "character": member.get("character") or "Unknown role",
                    "order": member.get("order", 99),
                    "suggestion": suggestion,
                    "suggestion_reason": reason,
                    "category": None,
                },
            )
        )
    return auto_crew, cast_list


# ----------------------------------------------------------------------
# Genre helpers
# ----------------------------------------------------------------------
def load_db_genres():
    """Return all MovieGenre rows as lightweight dicts, sorted by name."""
    with _db.SessionLocal() as db:
        rows = db.query(MovieGenre).order_by(MovieGenre.name).all()
        return [
            {
                "id": g.id,
                "name": g.name,
                "synonyms": list(g.synonyms or []),
                "parent_ids": [p.id for p in g.parents],
            }
            for g in rows
        ]


def match_tmdb_genre(tmdb_name, db_genres):
    """
    Return the DB genre ID whose name or synonyms match *tmdb_name*
    (case-insensitive), or ``None`` if unmatched.
    """
    needle = tmdb_name.strip().lower()
    for g in db_genres:
        haystack = [g["name"].lower()] + [s.lower() for s in g["synonyms"]]
        if needle in haystack:
            return g["id"]
    return None


def create_genre(name, synonyms=None, parent_ids=None):
    """Create a new MovieGenre and return it as a lightweight dict."""
    with _db.SessionLocal() as db:
        genre = MovieGenre(name=name, synonyms=synonyms or None)
        actual_parent_ids = []
        if parent_ids:
            parents = db.query(MovieGenre).filter(MovieGenre.id.in_(parent_ids)).all()
            genre.parents = parents
            actual_parent_ids = [p.id for p in parents]
        db.add(genre)
        db.flush()
        result = {
            "id": genre.id,
            "name": genre.name,
            "synonyms": list(genre.synonyms or []),
            "parent_ids": actual_parent_ids,
        }
        db.commit()
        return result


def add_genre_synonym(genre_id, synonym):
    """Append *synonym* to a genre's synonyms array; return the updated list."""
    with _db.SessionLocal() as db:
        genre = db.get(MovieGenre, genre_id)
        if genre is None:
            raise ValueError(f"Genre {genre_id} not found")
        current = list(genre.synonyms or [])
        if synonym not in current:
            current.append(synonym)
            genre.synonyms = current
            db.commit()
        return current


# ----------------------------------------------------------------------
# Database operations
# ----------------------------------------------------------------------
def _db_person_matches_tmdb(db_person, tmdb_film_keys):
    if not db_person.movie_links:
        return True
    for link in db_person.movie_links:
        movie = getattr(link, "movie", None)
        if movie is None:
            continue
        names = [movie.name] + ([movie.name_en] if movie.name_en else [])
        year = str(movie.release_year) if movie.release_year else ""
        matched = any(
            (n.strip().lower(), year) in tmdb_film_keys or (n.strip().lower(), None) in tmdb_film_keys for n in names
        )
        if matched:
            return True
    return False


def find_or_create_person(db, person_data):
    tmdb_name = person_data["name"]
    candidates = db.query(Person).filter((Person.name == tmdb_name) | (Person.name_en == tmdb_name)).all()
    for candidate in candidates:
        if _db_person_matches_tmdb(candidate, person_data["filmography_keys"]):
            return candidate, False, None

    guess = person_data["nationality_guess"]
    place = person_data["birth_place"]
    if guess in KNOWN_NATIONALITIES:
        nationality, pending = guess, None
    else:
        nationality, pending = "Unknown", (guess, place)

    person = Person(
        name=tmdb_name,
        name_en=None,
        birth_nationality=nationality,
        core_nationality=nationality,
    )
    db.add(person)
    db.flush()
    return person, True, pending


def find_existing_movie(db, matched_tmdb_movie):
    title = matched_tmdb_movie["title"]
    year_str = (matched_tmdb_movie.get("release_date") or "")[:4]
    if not year_str:
        return None
    return (
        db.query(Movie)
        .filter(
            (Movie.name == title) | (Movie.name_en == title),
            Movie.release_year == int(year_str),
        )
        .first()
    )


def write_movie_to_db(movie_entry, overwrite_existing=False):
    matched = movie_entry["matched"]
    details = movie_entry["details"]

    with _db.SessionLocal() as db:
        existing = find_existing_movie(db, matched)
        if existing and not overwrite_existing:
            return {"status": "exists", "db_movie_id": existing.id}

        if existing and overwrite_existing:
            db.query(MoviePerson).filter(MoviePerson.movie_id == existing.id).delete()
            db_movie = existing
            status = "overwritten"
        else:
            db_movie = Movie(
                name=matched["title"],
                name_en=matched["title"] if matched.get("original_title") != matched["title"] else None,
                runtime_minutes=details.get("runtime") or 0,
                release_year=int((matched.get("release_date") or "0000")[:4]),
            )
            db.add(db_movie)
            db.flush()
            status = "written"

        new_people, reused_people, pending = [], [], []
        linked = set()

        people_to_link = [(c, c["db_role"]) for c in movie_entry["crew"]]
        people_to_link += [
            (c, CATEGORY_TO_ROLE[c["category"]]) for c in movie_entry["cast"] if c["category"] is not None
        ]

        for person_data, role in people_to_link:
            person, created, pend = find_or_create_person(db, person_data)
            if created:
                new_people.append(
                    {
                        "person_id": person.id,
                        "name": person_data["name"],
                        "nationality": person.birth_nationality,
                    }
                )
            else:
                reused_people.append(person_data["name"])
            if pend is not None:
                pending.append((person.id, person_data["name"], pend[0], pend[1]))
            key = (person.id, role)
            if key in linked:
                continue
            linked.add(key)
            db.add(MoviePerson(movie_id=db_movie.id, person_id=person.id, role=role))

        genre_ids = movie_entry.get("genre_ids", [])
        db_movie.genres = db.query(MovieGenre).filter(MovieGenre.id.in_(genre_ids)).all() if genre_ids else []

        movie_id = db_movie.id
        db.commit()
        return {
            "status": status,
            "db_movie_id": movie_id,
            "new_people": new_people,
            "reused_people": reused_people,
            "pending_nationalities": pending,
        }


def update_movie_genres(movie_entry):
    """Update only the genre links of an existing movie (cast untouched)."""
    with _db.SessionLocal() as db:
        existing = find_existing_movie(db, movie_entry["matched"])
        if existing is None:
            return {"status": "missing", "db_movie_id": None}
        movie_id = existing.id
        genre_ids = movie_entry.get("genre_ids", [])
        existing.genres = db.query(MovieGenre).filter(MovieGenre.id.in_(genre_ids)).all() if genre_ids else []
        db.commit()
        return {"status": "genres_updated", "db_movie_id": movie_id}


def assign_movie_rank(movie_id, position):
    """Set global_rank on movie_id so it lands at 1-based position."""
    from sqlalchemy import func
    from sqlalchemy import select as sa_select

    from server.database_models.movie import Movie as _Movie
    from server.ranking import rank_between as _rank_between

    with _db.SessionLocal() as db:
        ranked = (
            sa_select(_Movie.global_rank, _Movie.id)
            .where(_Movie.id != movie_id)
            .add_columns(func.row_number().over(order_by=_Movie.global_rank).label("pos"))
            .subquery()
        )
        prev_rank = db.scalar(sa_select(ranked.c.global_rank).where(ranked.c.pos == position - 1))
        next_rank = db.scalar(sa_select(ranked.c.global_rank).where(ranked.c.pos == position))
        new_rank = _rank_between(prev_rank, next_rank)
        movie = db.get(_Movie, movie_id)
        movie.global_rank = new_rank
        db.commit()


def add_nationality_value(value):
    if value in KNOWN_NATIONALITIES:
        return
    with _db.SessionLocal() as db:
        existing = {row[0] for row in db.execute(text("SELECT unnest(enum_range(NULL::nationality))::text"))}
    KNOWN_NATIONALITIES.update(existing)
    if value in KNOWN_NATIONALITIES:
        return
    engine = _db.SessionLocal().get_bind()
    safe = value.replace("'", "''")
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(text(f"ALTER TYPE nationality ADD VALUE IF NOT EXISTS '{safe}'"))
    KNOWN_NATIONALITIES.add(value)


def assign_nationality(person_ids, value):
    if not person_ids:
        return
    with _db.SessionLocal() as db:
        db.query(Person).filter(Person.id.in_(person_ids)).update(
            {"birth_nationality": value, "core_nationality": value},
            synchronize_session=False,
        )
        db.commit()


# ----------------------------------------------------------------------
# UI
# ----------------------------------------------------------------------
class CreditsReviewApp:
    BTN_STYLES = {
        "Lead Actor": {"bg": "#1565c0", "fg": "white"},
        "Actor": {"bg": "#2e7d32", "fg": "white"},
        "Cameo Actor": {"bg": "#6a1b9a", "fg": "white"},
        "Skip": {"bg": "#757575", "fg": "white"},
    }

    def __init__(self, root):
        self.root = root
        self.root.title("Movie Credits Reviewer")
        self.root.geometry("700x680")
        self.movies = []
        self.db_genres = []
        self._ancestor_cache = {}
        self.movie_idx = 0
        self.person_idx = 0
        self.existing_movies = []
        self.pending_nationalities = {}
        self.new_people = {}
        self._in_genre_mode = False
        self._genre_movie = None
        self._genre_vars = []
        self._genre_parent_search_var = tk.BooleanVar(value=True)
        self._build_start_screen()

    # ---------- Ancestor cache ----------
    def _build_ancestor_cache(self):
        """Precompute the set of lowercased ancestor names for every genre."""
        by_id = {g["id"]: g for g in self.db_genres}
        cache = {}

        def _ancestors_of(gid, seen=()):
            if gid in cache:
                return cache[gid]
            result = set()
            for pid in by_id.get(gid, {}).get("parent_ids", []):
                if pid in seen:
                    continue
                parent = by_id.get(pid)
                if parent:
                    result.add(parent["name"].lower())
                    result |= _ancestors_of(pid, seen + (gid,))
            cache[gid] = result
            return result

        for g in self.db_genres:
            _ancestors_of(g["id"])
        self._ancestor_cache = cache

    # ---------- Screen 1 ----------
    def _build_start_screen(self):
        self.start_frame = ttk.Frame(self.root, padding=30)
        self.start_frame.pack(expand=True, fill="both")
        ttk.Label(
            self.start_frame,
            text="Movie Credits Reviewer",
            font=("Helvetica", 18, "bold"),
        ).pack(pady=(0, 20))
        ttk.Label(
            self.start_frame,
            text=(
                "Select an input file — one movie per line:\n"
                "  [title] [year] [rank]\n\n"
                "Year and rank are optional. Rank is the position the movie\n"
                "will be inserted below (e.g. '5' places it at position 5).\n\n"
                "Directors and composers are included automatically.\n"
                "Cast members are classified and saved per movie."
            ),
            wraplength=460,
            justify="center",
        ).pack(pady=(0, 20))
        ttk.Button(
            self.start_frame,
            text="Choose Input File & Start",
            command=self.load_file,
        ).pack()
        self.status_label = ttk.Label(self.start_frame, text="")
        self.status_label.pack(pady=20)

    def load_file(self):
        path = filedialog.askopenfilename(
            title="Select input file",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        except OSError as e:
            messagebox.showerror("Error", f"Could not read file:\n{e}")
            return
        parsed = [p for p in (parse_input_line(line) for line in lines) if p is not None]
        if not parsed:
            messagebox.showwarning("Empty", "No valid movie lines found.")
            return
        self.status_label.config(
            text="Fetching data from TMDB… please wait.\n" "(Full casts are fetched, so this may take a while.)"
        )
        self.root.update_idletasks()
        threading.Thread(target=self._fetch_all, args=(parsed,), daemon=True).start()

    def _fetch_all(self, parsed):
        try:
            db_genres = load_db_genres()
        except Exception:
            db_genres = []

        movies = []
        for title, year, desired_rank in parsed:
            entry = {
                "title": title,
                "year": year,
                "desired_rank": desired_rank,
                "matched": None,
                "details": None,
                "ambiguous": False,
                "crew": [],
                "cast": [],
                "genre_ids": [],
                "tmdb_genres": [],
            }
            try:
                movie, ambiguous = search_movie(title, year)
                if movie:
                    entry["matched"] = movie
                    entry["ambiguous"] = ambiguous
                    entry["details"] = get_movie_details(movie["id"])
                    entry["crew"], entry["cast"] = build_movie_data(movie)
                    entry["tmdb_genres"] = entry["details"].get("genres", [])
            except requests.RequestException as e:
                entry["error"] = str(e)
            movies.append(entry)
        self.root.after(0, lambda: self._start_review(movies, db_genres))

    def _start_review(self, movies, db_genres):
        self.movies = movies
        self.db_genres = db_genres
        self._build_ancestor_cache()
        self.movie_idx = 0
        self.person_idx = 0
        self.start_frame.destroy()
        self._build_review_screen()
        self._show_current_person()

    # ---------- Screen 2 ----------
    def _build_review_screen(self):
        self.review_frame = ttk.Frame(self.root)
        self.review_frame.pack(expand=True, fill="both")

        # --- Bottom action bar (packed first so it claims the bottom edge) ---
        bottom_bar = ttk.Frame(self.review_frame, padding=(20, 10, 20, 16))
        bottom_bar.pack(side="bottom", fill="x")

        self.db_status_label = ttk.Label(bottom_bar, foreground="#2e7d32", wraplength=640)
        self.db_status_label.pack(side="bottom", pady=(8, 0))

        # ── Person-mode bottom controls ──────────────────────────
        self.person_bottom = ttk.Frame(bottom_bar)
        self.person_bottom.pack(side="bottom")

        ttk.Label(
            self.person_bottom,
            text="Shortcuts:  1 = Lead   2 = Actor   3 = Cameo   4 / ← = Skip",
            foreground="gray",
        ).pack(side="bottom")

        tk.Button(
            self.person_bottom,
            text="⏭ Skip Rest of Cast",
            font=("Helvetica", 11),
            bg="#37474f",
            fg="white",
            command=self._skip_rest,
        ).pack(side="bottom", pady=(6, 8))

        btn_frame = ttk.Frame(self.person_bottom)
        btn_frame.pack(side="bottom")
        self.buttons = {}
        for i, label in enumerate(CATEGORIES + ["Skip"]):
            btn = tk.Button(
                btn_frame,
                text=label if label != "Skip" else "✗ Skip",
                font=("Helvetica", 12, "bold"),
                width=12,
                command=lambda line=label: self._decide(line),
                **self.BTN_STYLES[label],
            )
            btn.grid(row=0, column=i, padx=8)
            self.buttons[label] = btn

        # ── Genre-mode bottom controls (hidden until needed) ─────
        self.genre_bottom = ttk.Frame(bottom_bar)

        ttk.Label(
            self.genre_bottom,
            text="Toggle genres, then confirm.  Shortcut: Enter",
            foreground="gray",
        ).pack(side="bottom")

        tk.Button(
            self.genre_bottom,
            text="✓ Confirm Genres & Save",
            font=("Helvetica", 12, "bold"),
            width=24,
            bg="#1565c0",
            fg="white",
            command=self._confirm_genres,
        ).pack(side="bottom", pady=(6, 8))

        # --- Top content area ---
        content = ttk.Frame(self.review_frame, padding=20)
        content.pack(side="top", fill="both", expand=True)

        self.movie_label = ttk.Label(content, font=("Helvetica", 14, "bold"), wraplength=640)
        self.movie_label.pack(pady=(0, 4))
        self.note_label = ttk.Label(content, foreground="#b06000", wraplength=640)
        self.note_label.pack()
        self.progress_label = ttk.Label(content, foreground="gray")
        self.progress_label.pack(pady=(0, 12))

        # ── Person card ──────────────────────────────────────────
        self.person_card = ttk.Frame(content, relief="solid", borderwidth=1, padding=20)
        self.person_card.pack(fill="x", pady=8)
        self.name_label = ttk.Label(self.person_card, font=("Helvetica", 16, "bold"))
        self.name_label.pack(anchor="w")
        self.role_label = ttk.Label(self.person_card, font=("Helvetica", 12, "italic"))
        self.role_label.pack(anchor="w", pady=(2, 10))
        ttk.Label(
            self.person_card,
            text="Known for:",
            font=("Helvetica", 11, "bold"),
        ).pack(anchor="w")
        self.credits_label = ttk.Label(self.person_card, wraplength=600, justify="left")
        self.credits_label.pack(anchor="w", pady=(2, 10))
        self.suggestion_label = ttk.Label(
            self.person_card,
            wraplength=600,
            justify="left",
            foreground="#1565c0",
        )
        self.suggestion_label.pack(anchor="w")

        # ── Genre card (hidden until needed) ─────────────────────
        self.genre_card = ttk.Frame(content, relief="solid", borderwidth=1, padding=20)

        # Key bindings
        self.root.bind("1", lambda e: self._decide("Lead Actor"))
        self.root.bind("2", lambda e: self._decide("Actor"))
        self.root.bind("3", lambda e: self._decide("Cameo Actor"))
        self.root.bind("4", lambda e: self._decide("Skip"))
        self.root.bind("<Left>", lambda e: self._decide("Skip"))

    def _current_movie(self):
        return self.movies[self.movie_idx]

    def _show_current_person(self):
        self._in_genre_mode = False

        while self.movie_idx < len(self.movies):
            movie = self._current_movie()
            if movie["cast"] and self.person_idx < len(movie["cast"]):
                break
            if movie.get("matched") and not movie.get("saved"):
                self._show_genre_selection(movie)
                return
            self.movie_idx += 1
            self.person_idx = 0

        if self.movie_idx >= len(self.movies):
            self._finish()
            return

        # ── Ensure person mode is visible ────────────────────────
        self.genre_card.pack_forget()
        self.genre_bottom.pack_forget()
        self.person_card.pack(fill="x", pady=8)
        self.person_bottom.pack(side="bottom")

        movie = self._current_movie()
        person = movie["cast"][self.person_idx]
        matched = movie.get("matched")
        match_year = (matched.get("release_date") or "")[:4] if matched else ""
        self.movie_label.config(text=f"{matched['title']} ({match_year})" if matched else movie["title"])
        self.note_label.config(
            text="⚠ Multiple matches found — showing the most popular one." if movie["ambiguous"] else ""
        )
        rank_info = f"  •  Rank → #{movie['desired_rank']}" if movie.get("desired_rank") else ""
        self.progress_label.config(
            text=f"Movie {self.movie_idx + 1}/{len(self.movies)}  •  "
            f"Cast member {self.person_idx + 1}/{len(movie['cast'])}"
            f"{rank_info}"
        )
        self.name_label.config(text=person["name"])
        self.role_label.config(text=f"as {person['character']}  (billed #{person['order'] + 1})")
        self.credits_label.config(text="\n".join(f"• {c}" for c in person["top"]) or "No notable credits found")
        self.suggestion_label.config(text=f"💡 Suggested: {person['suggestion']} " f"— {person['suggestion_reason']}")
        for label, btn in self.buttons.items():
            btn.config(
                relief="solid" if label == person["suggestion"] else "raised",
                borderwidth=4 if label == person["suggestion"] else 2,
            )

    def _decide(self, choice):
        if self._in_genre_mode or self.movie_idx >= len(self.movies):
            return
        movie = self._current_movie()
        if self.person_idx < len(movie["cast"]):
            movie["cast"][self.person_idx]["category"] = None if choice == "Skip" else choice
        self.person_idx += 1
        self._show_current_person()

    def _skip_rest(self):
        """Mark all remaining cast in the current movie as skipped."""
        if self._in_genre_mode or self.movie_idx >= len(self.movies):
            return
        movie = self._current_movie()
        for person in movie["cast"][self.person_idx :]:
            person["category"] = None
        self.person_idx = len(movie["cast"])
        self._show_current_person()

    # ---------- Genre selection ----------
    def _show_genre_selection(self, movie):
        """Switch to genre-selection mode for *movie*."""
        self._in_genre_mode = True
        self._genre_movie = movie

        matched = movie.get("matched")
        match_year = (matched.get("release_date") or "")[:4] if matched else ""
        self.movie_label.config(text=f"{matched['title']} ({match_year})" if matched else movie["title"])
        self.note_label.config(text="Select or map genres for this movie.")
        self.progress_label.config(text=f"Movie {self.movie_idx + 1}/{len(self.movies)}" f"  •  Genre selection")

        self.person_card.pack_forget()
        self.person_bottom.pack_forget()
        self.genre_card.pack(fill="both", expand=True, pady=8)
        self.genre_bottom.pack(side="bottom")

        self._render_genre_card(movie)
        self.root.bind("<Return>", lambda e: self._confirm_genres())

    def _render_genre_card(self, movie, extra_checked=None):
        """(Re)build the genre card contents.

        TMDB→DB matching is recomputed from the *current* ``self.db_genres``
        so that synonyms/genres created mid-session are picked up immediately.
        """
        extra_checked = set(extra_checked or [])

        suggested, unmapped = set(), []
        for tg in movie.get("tmdb_genres", []):
            gid = match_tmdb_genre(tg["name"], self.db_genres)
            if gid is not None:
                suggested.add(gid)
            else:
                unmapped.append(tg)
        checked = suggested | extra_checked

        for w in self.genre_card.winfo_children():
            w.destroy()

        # ── Filter row (fixed top) ───────────────────────────────
        filter_row = ttk.Frame(self.genre_card)
        filter_row.pack(side="top", fill="x", pady=(0, 8))
        ttk.Label(filter_row, text="🔍 Filter:").pack(side="left")
        self._genre_filter_var = tk.StringVar()
        self._genre_filter_var.trace_add("write", self._filter_genres)
        filter_entry = ttk.Entry(filter_row, textvariable=self._genre_filter_var, width=30)
        filter_entry.pack(side="left", padx=8)
        filter_entry.focus_set()
        ttk.Checkbutton(
            filter_row,
            text="Include sub-genres",
            variable=self._genre_parent_search_var,
            command=lambda: self._filter_genres(),
        ).pack(side="left", padx=(8, 0))

        # ── Create-new-genre button (fixed bottom) ───────────────
        add_row = ttk.Frame(self.genre_card)
        add_row.pack(side="bottom", fill="x", pady=(8, 0))
        ttk.Button(
            add_row,
            text="+ Create new genre…",
            command=lambda: self._create_genre_for_tmdb(None),
        ).pack(side="left")

        # ── Unmatched TMDB genres (fixed bottom) ─────────────────
        if unmapped:
            uf = ttk.Frame(self.genre_card)
            uf.pack(side="bottom", fill="x", pady=(8, 0))
            ttk.Separator(uf, orient="horizontal").pack(fill="x", pady=(0, 6))
            ttk.Label(
                uf,
                text=("⚠ Unmatched TMDB genres — attach as a synonym, " "create a matching genre, or leave unmapped:"),
                foreground="#b06000",
                wraplength=600,
                justify="left",
            ).pack(anchor="w", pady=(0, 4))
            genre_names = [g["name"] for g in self.db_genres]
            for tg in unmapped:
                row = ttk.Frame(uf)
                row.pack(fill="x", anchor="w", pady=2)
                ttk.Label(
                    row,
                    text=f'"{tg["name"]}"',
                    font=("Helvetica", 10, "bold"),
                    width=16,
                ).pack(side="left")
                ttk.Label(row, text="→ synonym of:").pack(side="left", padx=(4, 2))
                combo = ttk.Combobox(row, values=genre_names, state="readonly", width=16)
                combo.pack(side="left")
                ttk.Button(
                    row,
                    text="Add synonym",
                    command=lambda tg=tg, c=combo: self._add_synonym_mapping(tg, c),
                ).pack(side="left", padx=4)
                ttk.Button(
                    row,
                    text="+ Create",
                    command=lambda tg=tg: self._create_genre_for_tmdb(tg),
                ).pack(side="left", padx=2)

        # ── Scrollable checklist (middle, expands) ───────────────
        canvas_frame = ttk.Frame(self.genre_card)
        canvas_frame.pack(side="top", fill="both", expand=True)
        self._genre_canvas = tk.Canvas(canvas_frame, highlightthickness=0)
        scrollbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self._genre_canvas.yview)
        self._genre_inner = ttk.Frame(self._genre_canvas)
        self._genre_inner.bind(
            "<Configure>",
            lambda e: self._genre_canvas.configure(scrollregion=self._genre_canvas.bbox("all")),
        )
        win_id = self._genre_canvas.create_window((0, 0), window=self._genre_inner, anchor="nw")
        self._genre_canvas.bind(
            "<Configure>",
            lambda e: self._genre_canvas.itemconfigure(win_id, width=e.width),
        )
        self._genre_canvas.configure(yscrollcommand=scrollbar.set)
        self._genre_canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        def _wheel(event):
            self._genre_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

        self._genre_canvas.bind_all("<MouseWheel>", _wheel)
        self._genre_canvas.bind_all(
            "<Button-4>",
            lambda e: self._genre_canvas.yview_scroll(-1, "units"),
        )
        self._genre_canvas.bind_all(
            "<Button-5>",
            lambda e: self._genre_canvas.yview_scroll(1, "units"),
        )

        self._genre_vars = []
        ordered = sorted(
            self.db_genres,
            key=lambda g: (g["id"] not in suggested, g["name"].lower()),
        )
        for g in ordered:
            var = tk.BooleanVar(value=g["id"] in checked)
            row = ttk.Frame(self._genre_inner)
            row.pack(fill="x", anchor="w", pady=1)
            ttk.Checkbutton(row, text=g["name"], variable=var).pack(side="left")
            if g["id"] in suggested:
                ttk.Label(row, text="← TMDB", foreground="#888").pack(side="left", padx=(6, 0))
            self._genre_vars.append((g["id"], var, row, g["name"]))

    def _filter_genres(self, *_args):
        """Show/hide genre checkboxes based on the filter text and toggle."""
        needle = self._genre_filter_var.get().strip().lower()
        if not needle:
            for _gid, _var, row, _name in self._genre_vars:
                row.pack(fill="x", anchor="w", pady=1)
            return
        include_sub = self._genre_parent_search_var.get()
        for gid, _var, row, name in self._genre_vars:
            match = needle in name.lower()
            if not match and include_sub:
                match = any(needle in a for a in self._ancestor_cache.get(gid, set()))
            if match:
                row.pack(fill="x", anchor="w", pady=1)
            else:
                row.pack_forget()

    def _refresh_genre_card(self, also_check=None):
        """Re-render the genre card, preserving current user selections."""
        checked = {gid for gid, var, _, _ in self._genre_vars if var.get()}
        if also_check:
            checked |= set(also_check)
        self._render_genre_card(self._genre_movie, extra_checked=checked)

    def _add_synonym_mapping(self, tmdb_genre, combo):
        """Persist the TMDB genre name as a synonym of the chosen DB genre."""
        target_name = combo.get()
        if not target_name:
            messagebox.showinfo(
                "Pick a genre",
                "Choose an existing genre to attach this synonym to.",
                parent=self.root,
            )
            return
        target = next((g for g in self.db_genres if g["name"] == target_name), None)
        if target is None:
            return
        try:
            target["synonyms"] = add_genre_synonym(target["id"], tmdb_genre["name"])
        except Exception as e:
            messagebox.showerror("Error", f"Could not add synonym:\n{e}")
            return
        self._refresh_genre_card()

    def _create_genre_for_tmdb(self, tmdb_genre):
        """Create a new genre via modal dialog (optionally prefilled from TMDB)."""
        default_name = tmdb_genre["name"] if tmdb_genre else ""
        default_synonym = tmdb_genre["name"] if tmdb_genre else ""
        new_genre = self._prompt_create_genre(default_name=default_name, default_synonym=default_synonym)
        if new_genre is None:
            return
        self.db_genres.append(new_genre)
        self.db_genres.sort(key=lambda g: g["name"].lower())
        self._build_ancestor_cache()
        self._refresh_genre_card(also_check=[new_genre["id"]])

    def _prompt_create_genre(self, default_name="", default_synonym=""):
        """Open a modal dialog for creating a genre.

        Returns the lightweight genre dict, or ``None`` if cancelled.
        """
        dialog = tk.Toplevel(self.root)
        dialog.title("Create new genre")
        dialog.transient(self.root)
        dialog.grab_set()
        dialog.geometry("460x500")

        frame = ttk.Frame(dialog, padding=20)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="Genre name:").pack(anchor="w")
        name_var = tk.StringVar(value=default_name)
        name_entry = ttk.Entry(frame, textvariable=name_var, width=40)
        name_entry.pack(fill="x", pady=(0, 10))
        name_entry.focus_set()

        ttk.Label(frame, text="Synonyms (comma-separated, optional):").pack(anchor="w")
        syn_var = tk.StringVar(value=default_synonym)
        ttk.Entry(frame, textvariable=syn_var, width=40).pack(fill="x", pady=(0, 10))

        ttk.Label(frame, text="Parent genres (optional, multi-select):").pack(anchor="w")
        list_frame = ttk.Frame(frame)
        list_frame.pack(fill="both", expand=True, pady=(0, 10))
        sb = ttk.Scrollbar(list_frame)
        sb.pack(side="right", fill="y")
        parent_list = tk.Listbox(
            list_frame,
            selectmode="multiple",
            yscrollcommand=sb.set,
            exportselection=False,
        )
        parent_list.pack(side="left", fill="both", expand=True)
        sb.config(command=parent_list.yview)
        for g in self.db_genres:
            parent_list.insert("end", g["name"])

        result = {"genre": None}

        def on_ok():
            name = name_var.get().strip()
            if not name:
                messagebox.showwarning(
                    "Missing name",
                    "Genre name is required.",
                    parent=dialog,
                )
                return
            synonyms = [s.strip() for s in syn_var.get().split(",") if s.strip()]
            parent_ids = [self.db_genres[i]["id"] for i in parent_list.curselection()]
            try:
                result["genre"] = create_genre(name, synonyms or None, parent_ids or None)
            except Exception as e:
                messagebox.showerror(
                    "Error",
                    f"Could not create genre:\n{e}",
                    parent=dialog,
                )
                return
            dialog.destroy()

        btn_row = ttk.Frame(frame)
        btn_row.pack(fill="x")
        ttk.Button(btn_row, text="Create", command=on_ok).pack(side="right", padx=4)
        ttk.Button(btn_row, text="Cancel", command=dialog.destroy).pack(side="right")
        dialog.bind("<Return>", lambda e: on_ok())

        dialog.wait_window()
        return result["genre"]

    def _confirm_genres(self):
        """Collect selected genres, prompt for rank, save, and advance."""
        if not self._in_genre_mode:
            return
        movie = self._genre_movie
        movie["genre_ids"] = [gid for gid, var, _, _ in self._genre_vars if var.get()]

        self.root.unbind("<Return>")
        try:
            self._genre_canvas.unbind_all("<MouseWheel>")
            self._genre_canvas.unbind_all("<Button-4>")
            self._genre_canvas.unbind_all("<Button-5>")
        except Exception:
            pass
        self._in_genre_mode = False

        if movie.get("desired_rank") is None:
            title = movie["matched"]["title"]
            pos = simpledialog.askinteger(
                "Rank movie",
                f"Position for '{title}'?\n" "(leave blank / cancel to skip ranking)",
                parent=self.root,
                minvalue=1,
            )
            if pos is not None:
                movie["desired_rank"] = pos

        self._save_movie(movie)
        self.movie_idx += 1
        self.person_idx = 0
        self._show_current_person()

    # ---------- DB write ----------
    def _maybe_assign_rank(self, movie, db_movie_id):
        rank = movie.get("desired_rank")
        if rank is None:
            return
        try:
            assign_movie_rank(db_movie_id, rank)
        except Exception as e:
            messagebox.showwarning(
                "Rank error",
                f"Could not assign rank {rank} " f"to '{movie['matched']['title']}':\n{e}",
            )

    def _record_result(self, result):
        for p in result.get("new_people", []):
            self.new_people[p["person_id"]] = p
        for person_id, name, guess, place in result.get("pending_nationalities", []):
            bucket = self.pending_nationalities.setdefault(guess, {"place": place, "people": []})
            bucket["people"].append((person_id, name))

    def _save_movie(self, movie):
        movie["saved"] = True
        try:
            result = write_movie_to_db(movie, overwrite_existing=False)
        except Exception as e:
            messagebox.showerror(
                "Database error",
                f"Failed to save '{movie['matched']['title']}':\n{e}",
            )
            return
        if result["status"] == "exists":
            self.existing_movies.append(movie)
            self.db_status_label.config(
                text=f"'{movie['matched']['title']}' already exists — " "overwrite decision deferred to the end.",
                foreground="#b06000",
            )
        else:
            self._record_result(result)
            self._maybe_assign_rank(movie, result["db_movie_id"])
            self.db_status_label.config(
                text=f"Saved '{movie['matched']['title']}' "
                f"({len(result['new_people'])} new people, "
                f"{len(result['reused_people'])} reused).",
                foreground="#2e7d32",
            )

    # ---------- Finish ----------
    def _finish(self):
        if hasattr(self, "review_frame"):
            self.review_frame.destroy()
        if self.existing_movies:
            self._build_overwrite_screen()
        else:
            self._after_overwrites()

    def _build_overwrite_screen(self):
        frame = ttk.Frame(self.root, padding=30)
        frame.pack(expand=True, fill="both")
        self._overwrite_frame = frame
        ttk.Label(
            frame,
            text="These movies already exist in the database.",
            font=("Helvetica", 14, "bold"),
        ).pack(pady=(0, 6))
        ttk.Label(frame, text="Choose what to do for each:").pack(pady=(0, 14))

        self.overwrite_vars = []
        for movie in self.existing_movies:
            matched = movie["matched"]
            year = (matched.get("release_date") or "")[:4]

            block = ttk.Frame(frame)
            block.pack(anchor="w", padx=20, pady=4, fill="x")
            ttk.Label(
                block,
                text=f"{matched['title']} ({year})",
                font=("Helvetica", 11, "bold"),
            ).pack(anchor="w")

            action_var = tk.IntVar(value=0)
            radio_row = ttk.Frame(block)
            radio_row.pack(anchor="w", padx=20)
            ttk.Radiobutton(radio_row, text="Skip", variable=action_var, value=0).pack(side="left")
            ttk.Radiobutton(
                radio_row,
                text="Update genres only",
                variable=action_var,
                value=1,
            ).pack(side="left", padx=(10, 0))
            ttk.Radiobutton(
                radio_row,
                text="Overwrite cast & genres",
                variable=action_var,
                value=2,
            ).pack(side="left", padx=(10, 0))

            rank_row = ttk.Frame(block)
            rank_row.pack(anchor="w", padx=20)
            ttk.Label(rank_row, text="Rank:").pack(side="left")
            rank_entry = ttk.Entry(rank_row, width=6)
            if movie.get("desired_rank") is not None:
                rank_entry.insert(0, str(movie["desired_rank"]))
            rank_entry.pack(side="left", padx=4)

            self.overwrite_vars.append((movie, action_var, rank_entry))

        ttk.Button(frame, text="Apply", command=self._apply_overwrites).pack(pady=20)

    def _apply_overwrites(self):
        errors = []
        for movie, action_var, rank_entry in self.overwrite_vars:
            rank_text = rank_entry.get().strip()
            if rank_text.isdigit():
                movie["desired_rank"] = int(rank_text)
            action = action_var.get()
            try:
                if action == 2:
                    result = write_movie_to_db(movie, overwrite_existing=True)
                    if result["status"] in ("written", "overwritten"):
                        self._record_result(result)
                    movie_id = result.get("db_movie_id")
                elif action == 1:
                    movie_id = update_movie_genres(movie).get("db_movie_id")
                else:
                    if movie.get("desired_rank") is not None:
                        result = write_movie_to_db(movie, overwrite_existing=False)
                        movie_id = result.get("db_movie_id")
                    else:
                        movie_id = None
                if movie_id is not None:
                    self._maybe_assign_rank(movie, movie_id)
            except Exception as e:
                errors.append(f"{movie['matched']['title']}: {e}")
        self._overwrite_frame.destroy()
        if errors:
            messagebox.showwarning("Overwrite errors", "\n".join(errors))
        self._after_overwrites()

    # ---------- New nationalities ----------
    def _after_overwrites(self):
        if self.pending_nationalities:
            self._build_nationality_screen()
        else:
            self._show_summary()

    def _build_nationality_screen(self):
        frame = ttk.Frame(self.root, padding=30)
        frame.pack(expand=True, fill="both")
        self._nationality_frame = frame
        ttk.Label(
            frame,
            text="New nationalities needed",
            font=("Helvetica", 14, "bold"),
        ).pack(pady=(0, 6))
        ttk.Label(
            frame,
            text=(
                "TMDB returned birthplaces that don't map to an existing "
                "nationality enum value.\nEnter the correct enum entry for "
                "each (it will be added to the DB type)."
            ),
            wraplength=600,
            justify="center",
        ).pack(pady=(0, 16))

        self.nationality_entries = []
        for guess, info in self.pending_nationalities.items():
            auto = None
            g_lower = guess.strip().lower()
            if guess in KNOWN_NATIONALITIES:
                auto = guess
            elif g_lower in COUNTRY_TO_NATIONALITY:
                auto = COUNTRY_TO_NATIONALITY[g_lower]

            block = ttk.Frame(frame, relief="solid", borderwidth=1, padding=12)
            block.pack(fill="x", pady=6)
            people_names = ", ".join(name for _id, name in info["people"])
            place = info["place"] or "unknown birthplace"
            ttk.Label(
                block,
                text=f"Birthplace: {place}\nPeople: {people_names}",
                wraplength=560,
                justify="left",
            ).pack(anchor="w")
            row = ttk.Frame(block)
            row.pack(anchor="w", pady=(8, 0))
            if auto:
                ttk.Label(row, text=f"Auto-resolved: {auto}", foreground="#2e7d32").pack(side="left")
                self.nationality_entries.append((guess, info, auto))
            else:
                ttk.Label(row, text="Nationality enum entry:").pack(side="left")
                entry = ttk.Entry(row, width=30)
                entry.insert(0, guess)
                entry.pack(side="left", padx=8)
                self.nationality_entries.append((guess, info, entry))

        ttk.Button(frame, text="Save nationalities", command=self._apply_nationalities).pack(pady=20)

    def _apply_nationalities(self):
        errors = []
        for _guess, info, entry in self.nationality_entries:
            value = (entry if isinstance(entry, str) else entry.get().strip()) or "Unknown"
            person_ids = [pid for pid, _name in info["people"]]
            try:
                add_nationality_value(value)
                assign_nationality(person_ids, value)
                for pid in person_ids:
                    if pid in self.new_people:
                        self.new_people[pid]["nationality"] = value
            except Exception as e:
                errors.append(f"{value}: {e}")
        if errors:
            messagebox.showwarning("Nationality errors", "\n".join(errors))
        self._nationality_frame.destroy()
        self._show_summary()

    # ---------- Final summary ----------
    def _show_summary(self):
        frame = ttk.Frame(self.root, padding=30)
        frame.pack(expand=True, fill="both")

        ttk.Label(frame, text="All done!", font=("Helvetica", 16, "bold")).pack(pady=(0, 10))

        if not self.new_people:
            ttk.Label(
                frame,
                text="No new people were added — everyone was already " "in the database.",
            ).pack(pady=10)
        else:
            ttk.Label(
                frame,
                text=f"{len(self.new_people)} new people added:",
                font=("Helvetica", 12, "bold"),
            ).pack(anchor="w", pady=(0, 8))

            list_frame = ttk.Frame(frame)
            list_frame.pack(fill="both", expand=True)
            scrollbar = ttk.Scrollbar(list_frame)
            scrollbar.pack(side="right", fill="y")
            listbox = tk.Listbox(
                list_frame,
                yscrollcommand=scrollbar.set,
                font=("Helvetica", 11),
            )
            listbox.pack(side="left", fill="both", expand=True)
            scrollbar.config(command=listbox.yview)

            for p in sorted(self.new_people.values(), key=lambda x: x["name"]):
                listbox.insert("end", f"{p['name']}  —  {p['nationality']}")

        ttk.Button(frame, text="Close", command=self.root.destroy).pack(pady=16)


def main():
    init_engine()
    try:
        root = tk.Tk()
        CreditsReviewApp(root)
        root.mainloop()
    finally:
        dispose_engine()


if __name__ == "__main__":
    main()
