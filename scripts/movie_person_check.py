"""
find_missing_cast_links.py

For each movie in the local PostgreSQL film catalog, look up the cast on TMDB
and report people that already exist in our `people` table but are not yet
linked to the movie via `movie_persons`.
"""

import os
import sys
import time
import unicodedata

import requests
from dotenv import load_dotenv
from sqlalchemy import select
from sqlalchemy.orm import selectinload

import server.database as _db
from server.database import dispose_engine, init_engine
from server.database_models import Movie, MoviePerson, Person


load_dotenv()

TMDB_BEARER = os.environ["TMDB_BEARER_TOKEN"]
TMDB_BASE = "https://api.themoviedb.org/3"

SESSION = requests.Session()
SESSION.headers.update(
    {
        "Authorization": f"Bearer {TMDB_BEARER}",
        "accept": "application/json",
    }
)


# --------------------------------------------------------------------------- #
# Name matching helpers
# --------------------------------------------------------------------------- #

def normalize(name: str) -> str:
    """Case-fold + strip diacritics for forgiving name comparisons."""
    nfkd = unicodedata.normalize("NFKD", name)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).casefold().strip()


def person_name_keys(person: Person) -> set[str]:
    """All normalized name variants under which a person may be matched."""
    keys = {normalize(person.name)}
    if person.name_en:
        keys.add(normalize(person.name_en))
    return keys


def person_db_movies(person: Person) -> set[tuple[str, int]]:
    """The (normalized title, year) set of movies a DB person is linked to."""
    return {
        (normalize(pl.movie.name), pl.movie.release_year)
        for pl in person.movie_links
    }


# --------------------------------------------------------------------------- #
# TMDB
# --------------------------------------------------------------------------- #

def tmdb_get(path: str, **params) -> dict:
    """GET wrapper with very light rate-limit handling."""
    while True:
        r = SESSION.get(f"{TMDB_BASE}{path}", params=params, timeout=30)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", "1")))
            continue
        r.raise_for_status()
        return r.json()


_person_filmography_cache: dict[int, set[tuple[str, int]]] = {}


def tmdb_person_filmography(tmdb_person_id: int) -> set[tuple[str, int]]:
    """Return (normalized title, year) for every movie this TMDB person worked on."""
    if tmdb_person_id in _person_filmography_cache:
        return _person_filmography_cache[tmdb_person_id]

    try:
        credits = tmdb_get(f"/person/{tmdb_person_id}/movie_credits")
    except requests.HTTPError:
        _person_filmography_cache[tmdb_person_id] = set()
        return set()

    films: set[tuple[str, int]] = set()
    for c in credits.get("cast", []) + credits.get("crew", []):
        title = c.get("title") or ""
        release = c.get("release_date") or ""
        if title and len(release) >= 4 and release[:4].isdigit():
            films.add((normalize(title), int(release[:4])))

    _person_filmography_cache[tmdb_person_id] = films
    return films


def find_tmdb_movie_id(movie: Movie) -> int | None:
    """
    Resolve a local Movie to a single TMDB movie id.

    When TMDB returns more than one candidate with the same title/year,
    disambiguate by fetching each candidate's credits and choosing the one
    whose cast/crew most overlaps with the people already linked to our
    movie in the DB.
    """
    data = tmdb_get(
        "/search/movie",
        query=movie.name,
        year=movie.release_year,
        include_adult="true",
    )
    results = data.get("results", [])

    if not results:
        # Fallback: search without year, then filter by year ourselves.
        data = tmdb_get("/search/movie", query=movie.name, include_adult="true")
        results = [
            r for r in data.get("results", [])
            if (r.get("release_date") or "").startswith(str(movie.release_year))
        ]
        if not results:
            return None

    if len(results) == 1:
        return results[0]["id"]

    linked_name_keys: set[str] = set()
    for pl in movie.person_links:
        linked_name_keys |= person_name_keys(pl.person)

    if not linked_name_keys:
        print(
            f"  ? Multiple TMDB matches for {movie.name!r} ({movie.release_year}) "
            f"and no linked people to disambiguate by; skipping.",
            file=sys.stderr,
        )
        return None

    best_id: int | None = None
    best_score = 0
    for r in results:
        try:
            credits = tmdb_get(f"/movie/{r['id']}/credits")
        except requests.HTTPError:
            continue
        tmdb_names = {normalize(c["name"]) for c in credits.get("cast", [])}
        tmdb_names |= {normalize(c["name"]) for c in credits.get("crew", [])}
        score = len(linked_name_keys & tmdb_names)
        if score > best_score:
            best_score = score
            best_id = r["id"]

    if best_id is None:
        print(
            f"  ? Could not disambiguate {movie.name!r} ({movie.release_year}).",
            file=sys.stderr,
        )
    return best_id


def resolve_person(
    candidates: list[Person],
    tmdb_person_id: int,
    current_movie: Movie,
) -> Person | None:
    """
    Decide which (if any) DB Person actually corresponds to a TMDB cast member.

    A DB person is only considered the same individual as the TMDB person if
    *every* movie they are linked to in our database also appears in that
    TMDB person's filmography. Sharing a name with one overlapping film is
    not enough -- a true identity match must account for the entire local
    filmography.
    """
    tmdb_movies = tmdb_person_filmography(tmdb_person_id)
    if not tmdb_movies:
        # No filmography to compare against; we cannot confirm identity.
        return None

    # The current movie is in the TMDB person's credits by definition
    # (they're in its cast), even if TMDB's /movie_credits endpoint hasn't
    # caught up yet. Include it explicitly so that a freshly-inserted DB
    # person linked only to this movie can still be matched.
    current_key = (normalize(current_movie.name), current_movie.release_year)
    tmdb_movies = tmdb_movies | {current_key}

    matches = [
        person for person in candidates
        if person_db_movies(person).issubset(tmdb_movies)
    ]

    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        # Multiple DB people whose every linked movie fits this TMDB person.
        # We can't tell them apart with the information we have.
        print(
            f"  ? Ambiguous match for TMDB {matches[0].name} (person id {tmdb_person_id}): "
            f"{len(matches)} DB candidates all consistent.",
            file=sys.stderr,
        )
    return None


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main() -> None:
    init_engine()
    try:
        with _db.SessionLocal() as db:
            # Eager-load each person's other movies so we can disambiguate
            # namesakes without lazy-load surprises.
            people = db.scalars(
                select(Person).options(
                    selectinload(Person.movie_links).selectinload(MoviePerson.movie)
                )
            ).all()

            people_by_name: dict[str, list[Person]] = {}
            for p in people:
                for key in person_name_keys(p):
                    people_by_name.setdefault(key, []).append(p)

            movies = db.scalars(
                select(Movie).options(
                    selectinload(Movie.person_links).selectinload(MoviePerson.person)
                )
            ).all()

            print(f"Scanning {len(movies)} movies against TMDB...\n")

            missing_total = 0
            for movie in movies:
                try:
                    tmdb_id = find_tmdb_movie_id(movie)
                except requests.HTTPError as e:
                    print(
                        f"  ! TMDB search failed for {movie.name!r}: {e}",
                        file=sys.stderr,
                    )
                    continue

                if tmdb_id is None:
                    print(
                        f"  ? No TMDB match for {movie.name!r} ({movie.release_year})",
                        file=sys.stderr,
                    )
                    continue

                try:
                    credits = tmdb_get(f"/movie/{tmdb_id}/credits")
                except requests.HTTPError as e:
                    print(
                        f"  ! TMDB credits failed for {movie.name!r}: {e}",
                        file=sys.stderr,
                    )
                    continue

                linked_person_ids = {pl.person_id for pl in movie.person_links}
                missing_for_movie: list[tuple[Person, str]] = []
                already_reported: set[int] = set()

                for member in credits.get("cast", []):
                    key = normalize(member["name"])
                    candidates = people_by_name.get(key, [])
                    if not candidates:
                        continue

                    person = resolve_person(candidates, member["id"], movie)
                    if person is None:
                        continue

                    if person.id in linked_person_ids or person.id in already_reported:
                        continue

                    already_reported.add(person.id)
                    missing_for_movie.append((person, member.get("character", "")))

                if missing_for_movie:
                    print(
                        f"\n{movie.name} ({movie.release_year}) "
                        f"[movie_id={movie.id}]"
                    )
                    for person, character in missing_for_movie:
                        extra = f" as {character}" if character else ""
                        print(f"  - {person.name} (person_id={person.id}){extra}")
                        missing_total += 1

            print(f"\nDone. {missing_total} missing cast link(s) found.")
    finally:
        dispose_engine()


if __name__ == "__main__":
    main()