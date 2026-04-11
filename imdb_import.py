from __future__ import annotations

"""
TMDb data import script.

Reads movie metadata from the TMDb API and populates existing movies in the
 database with:
  - runtime_minutes
  - release_year
  - directors (Person entries with role="director")
  - composers (Person entries with role="composer")
  - lead actors (Person entries with role="lead_actor")
  - recurring actors — actors appearing in >=2 movies on the list (role="actor")

This is a drop-in replacement for the older IMDb TSV importer, but it queries
TMDb live instead of reading bulk dump files.

Environment:
    TMDB_BEARER_TOKEN   Preferred. A TMDb v4 read access token.
    TMDB_API_KEY        Also supported. A TMDb v3 API key.

Usage:
    python tmdb_import.py [--dry-run] [--overwrite]
                          [--language en-US] [--region US]
                          [--delay 0.0] [--cache-file tmdb_cache.json]

    --dry-run    Print what would happen without writing to the DB
    --overwrite  Also update movies that already have cast attached (runtime,
                 release year, and person links). Without this flag only movies
                 with no existing person links are touched.
    --language   TMDb language to request (default: en-US)
    --region     TMDb region hint for search (default: US)
    --delay      Optional delay in seconds between TMDb requests
    --cache-file JSON cache path for TMDb responses (default: tmdb_cache.json)
"""

import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from sqlalchemy import select

import server.database as _db
from server.database import dispose_engine, init_engine
from server.database_models import Movie, MoviePerson, Person
from server.database_models.movie_cast_member import CastRole

load_dotenv()

TMDB_BASE_URL = "https://api.themoviedb.org/3"
RELEVANT_COMPOSER_JOBS = {
    "Original Music Composer",
    "Composer",
    "Music",
    "Music Director",
}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class TmdbMovieMatch:
    tmdb_id: int
    title: str
    original_title: str | None
    release_year: int | None
    runtime_minutes: int | None
    imdb_id: str | None = None
    directors: list[int] = field(default_factory=list)
    composers: list[int] = field(default_factory=list)
    cast: list[dict[str, Any]] = field(default_factory=list)  # full TMDb cast rows
    crew: list[dict[str, Any]] = field(default_factory=list)  # full TMDb crew rows


@dataclass
class TmdbPersonInfo:
    tmdb_person_id: int
    name: str
    known_for_department: str | None = None


# ---------------------------------------------------------------------------
# Phase 1: Load DB state
# ---------------------------------------------------------------------------


def load_db_movies(db) -> list[Movie]:
    return list(db.scalars(select(Movie)).all())


def load_existing_persons(db) -> tuple[dict[int, int], dict[str, list[int]]]:
    """
    Returns:
      tmdb_person_id_to_pid  — 12345 -> person.id  (from notes "TMDB: person:12345")
      name_to_pids          — normalized name -> [person.id, ...]
    """
    persons = list(db.scalars(select(Person)).all())
    tmdb_person_id_to_pid: dict[int, int] = {}
    name_to_pids: dict[str, list[int]] = defaultdict(list)
    for p in persons:
        if p.notes:
            for m in re.finditer(r"TMDB:\s*person:(\d+)", p.notes):
                tmdb_person_id_to_pid[int(m.group(1))] = p.id
        name_to_pids[p.name.lower().strip()].append(p.id)
    return tmdb_person_id_to_pid, name_to_pids


# ---------------------------------------------------------------------------
# TMDb client + cache
# ---------------------------------------------------------------------------


class TmdbClient:
    def __init__(
        self,
        bearer_token: str | None,
        api_key: str | None,
        language: str = "en-US",
        region: str | None = "US",
        delay_seconds: float = 0.0,
        cache_file: Path | None = None,
    ) -> None:
        if not bearer_token and not api_key:
            raise RuntimeError("Missing TMDb credentials. Set TMDB_BEARER_TOKEN or TMDB_API_KEY in your environment.")

        self.language = language
        self.region = region
        self.delay_seconds = delay_seconds
        self.session = requests.Session()
        self.cache_file = cache_file
        self.cache: dict[str, Any] = {}
        self.stats: dict[str, int] = defaultdict(int)

        headers = {"Accept": "application/json"}
        if bearer_token:
            headers["Authorization"] = f"Bearer {bearer_token}"
        self.session.headers.update(headers)
        self.api_key = api_key

        if self.cache_file and self.cache_file.exists():
            try:
                self.cache = json.loads(self.cache_file.read_text(encoding="utf-8"))
            except Exception:
                self.cache = {}

    def _cache_key(self, path: str, params: dict[str, Any] | None) -> str:
        payload = {"path": path, "params": params or {}}
        return json.dumps(payload, sort_keys=True, separators=(",", ":"))

    def save_cache(self) -> None:
        if not self.cache_file:
            return
        self.cache_file.write_text(json.dumps(self.cache, ensure_ascii=False, indent=2), encoding="utf-8")

    def get(self, path: str, *, params: dict[str, Any] | None = None, use_cache: bool = True) -> Any:
        merged_params = dict(params or {})
        if self.api_key:
            merged_params.setdefault("api_key", self.api_key)

        key = self._cache_key(path, merged_params)
        if use_cache and key in self.cache:
            self.stats["cache_hits"] += 1
            return self.cache[key]

        url = f"{TMDB_BASE_URL}{path}"
        if self.delay_seconds > 0:
            time.sleep(self.delay_seconds)

        self.stats["api_requests"] += 1
        resp = self.session.get(url, params=merged_params, timeout=30)

        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            wait_s = float(retry_after) if retry_after else max(1.0, self.delay_seconds or 1.0)
            print(f"    TMDb rate limited; waiting {wait_s:.1f}s and retrying...", file=sys.stderr)
            time.sleep(wait_s)
            resp = self.session.get(url, params=merged_params, timeout=30)
            self.stats["api_requests"] += 1

        resp.raise_for_status()
        data = resp.json()
        if use_cache:
            self.cache[key] = data
        return data

    def search_movie_candidates(self, title: str, year: int | None) -> list[dict[str, Any]]:
        params = {
            "query": title,
            "language": self.language,
            "include_adult": "false",
        }
        if self.region:
            params["region"] = self.region
        if year and year > 1800:
            params["year"] = str(year)

        data = self.get("/search/movie", params=params)
        results = list(data.get("results") or [])

        # Fallback search without year if the year-constrained search found nothing.
        if not results and year and year > 1800:
            fallback_params = dict(params)
            fallback_params.pop("year", None)
            data = self.get("/search/movie", params=fallback_params)
            results = list(data.get("results") or [])

        return results

    def get_movie_with_credits(self, tmdb_movie_id: int) -> dict[str, Any]:
        return self.get(
            f"/movie/{tmdb_movie_id}",
            params={
                "language": self.language,
                "append_to_response": "credits,external_ids",
            },
        )

    def get_person_details(self, tmdb_person_id: int) -> dict[str, Any]:
        return self.get(f"/person/{tmdb_person_id}", params={"language": self.language})


# ---------------------------------------------------------------------------
# Phase 2a: TMDb movie matching
# ---------------------------------------------------------------------------


def _extract_year(release_date: str | None) -> int | None:
    if not release_date:
        return None
    try:
        return int(release_date[:4])
    except (TypeError, ValueError):
        return None


def _normalize_title(value: str | None) -> str:
    return (value or "").strip().lower()


def score_tmdb_candidate(movie: Movie, candidate: dict[str, Any]) -> tuple[int, int, int, float]:
    """
    Higher tuple is better.

    Priority:
      1. exact title match on localized title
      2. exact match on original title
      3. release year proximity
      4. popularity
    """
    db_title = _normalize_title(movie.name)
    cand_title = _normalize_title(candidate.get("title"))
    cand_original = _normalize_title(candidate.get("original_title"))
    cand_year = _extract_year(candidate.get("release_date"))

    exact_title = 1 if cand_title == db_title else 0
    exact_original = 1 if cand_original == db_title else 0

    if movie.release_year and movie.release_year > 1800 and cand_year:
        year_score = -abs(cand_year - movie.release_year)
    elif cand_year is not None:
        year_score = -1
    else:
        year_score = -5

    popularity = float(candidate.get("popularity") or 0.0)
    return (exact_title, exact_original, year_score, popularity)


def choose_best_tmdb_candidate(movie: Movie, candidates: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, bool]:
    """
    Returns (best_candidate, is_ambiguous).

    We consider the result ambiguous only if the top two candidates have the
    same score and both look plausible (same normalized title and same year).
    """
    if not candidates:
        return None, False

    ranked = sorted(candidates, key=lambda c: score_tmdb_candidate(movie, c), reverse=True)
    best = ranked[0]
    if len(ranked) == 1:
        return best, False

    second = ranked[1]
    best_score = score_tmdb_candidate(movie, best)
    second_score = score_tmdb_candidate(movie, second)
    if best_score != second_score:
        return best, False

    best_title = _normalize_title(best.get("title"))
    second_title = _normalize_title(second.get("title"))
    best_year = _extract_year(best.get("release_date"))
    second_year = _extract_year(second.get("release_date"))
    if best_title == second_title and best_year == second_year:
        return best, True
    return best, False


def fetch_tmdb_matches(
    db_movies: list[Movie],
    client: TmdbClient,
) -> tuple[dict[int, TmdbMovieMatch], list[tuple[str, int]], list[tuple[str, int]]]:
    """
    Returns:
      matched    — movie.id -> TmdbMovieMatch
      unmatched  — [(name, year), ...]
      ambiguous  — [(name, year), ...]
    """
    matched: dict[int, TmdbMovieMatch] = {}
    unmatched: list[tuple[str, int]] = []
    ambiguous: list[tuple[str, int]] = []

    total = len(db_movies)
    for idx, movie in enumerate(db_movies, start=1):
        if idx % 25 == 0 or idx == total:
            print(f"  Matched/search-checked {idx:,} / {total:,} movies...")

        candidates = client.search_movie_candidates(movie.name, movie.release_year)
        best, is_ambiguous = choose_best_tmdb_candidate(movie, candidates)
        if not best:
            unmatched.append((movie.name, movie.release_year))
            continue
        if is_ambiguous:
            ambiguous.append((movie.name, movie.release_year))
            continue

        details = client.get_movie_with_credits(int(best["id"]))
        credits = details.get("credits") or {}
        crew = list(credits.get("crew") or [])
        cast = list(credits.get("cast") or [])

        directors = [int(p["id"]) for p in crew if p.get("job") == "Director" and p.get("id") is not None]

        composers: list[int] = []
        for p in crew:
            if p.get("id") is None:
                continue
            department = p.get("department") or ""
            job = p.get("job") or ""
            if department == "Sound" and job in RELEVANT_COMPOSER_JOBS:
                composers.append(int(p["id"]))

        matched[movie.id] = TmdbMovieMatch(
            tmdb_id=int(details["id"]),
            title=details.get("title") or best.get("title") or movie.name,
            original_title=details.get("original_title") or best.get("original_title"),
            release_year=_extract_year(details.get("release_date")),
            runtime_minutes=details.get("runtime"),
            imdb_id=(details.get("external_ids") or {}).get("imdb_id"),
            directors=directors,
            composers=composers,
            cast=cast,
            crew=crew,
        )

    return matched, unmatched, ambiguous


# ---------------------------------------------------------------------------
# Phase 3a: Lead actor selection
# ---------------------------------------------------------------------------


def compute_lead_actors(cast_rows: list[dict[str, Any]]) -> set[int]:
    """
    Returns the set of TMDb person IDs that are lead actors for this title.

    TMDb exposes cast billing order within the cast list via `order`. To stay
    close to the IMDb importer behavior, we treat the top-billed cast members
    as leads:
      - take cast with order <= 2
      - from those, take at most 2
      - if none have an order, fall back to the first credited cast member
    """
    cleaned = [r for r in cast_rows if r.get("id") is not None]
    if not cleaned:
        return set()

    ordered = sorted(cleaned, key=lambda r: (r.get("order", 10_000), r.get("cast_id", 10_000)))
    top_position_cast = [r for r in ordered if isinstance(r.get("order"), int) and r["order"] <= 2]
    if top_position_cast:
        return {int(r["id"]) for r in top_position_cast[:2]}
    return {int(ordered[0]["id"])}


# ---------------------------------------------------------------------------
# Phase 3b: Recurring actors
# ---------------------------------------------------------------------------


def compute_recurring_actors(
    matched: dict[int, TmdbMovieMatch],
) -> tuple[set[int], dict[int, set[int]]]:
    """
    Returns:
      recurring       — person IDs of actors who appear in at least 2 matched movies
      appearances     — person_id -> {tmdb_movie_id}
    """
    appearances: dict[int, set[int]] = defaultdict(set)
    for movie_match in matched.values():
        for cast_row in movie_match.cast:
            person_id = cast_row.get("id")
            if person_id is None:
                continue
            appearances[int(person_id)].add(movie_match.tmdb_id)

    recurring = {pid for pid, movie_ids in appearances.items() if len(movie_ids) >= 2}
    return recurring, dict(appearances)


# ---------------------------------------------------------------------------
# Phase 4: Write to DB
# ---------------------------------------------------------------------------


def get_or_create_person(
    db,
    tmdb_person_id: int,
    person_name: str,
    tmdb_person_id_to_pid: dict[int, int],
    name_to_pids: dict[str, list[int]],
    dry_run: bool,
    stats: dict[str, int],
    _dry_run_counter: list[int],
) -> int:
    """
    Resolve TMDb person ID -> person.id, creating a new Person if needed.
    Mutates tmdb_person_id_to_pid and name_to_pids caches.
    """
    if tmdb_person_id in tmdb_person_id_to_pid:
        stats["persons_reused"] += 1
        return tmdb_person_id_to_pid[tmdb_person_id]

    normalized = person_name.lower().strip()
    existing_ids = name_to_pids.get(normalized, [])

    if len(existing_ids) == 1:
        pid = existing_ids[0]
        tmdb_person_id_to_pid[tmdb_person_id] = pid
        stats["persons_notes_updated"] += 1
        if not dry_run:
            person = db.get(Person, pid)
            if person:
                tag = f"TMDB: person:{tmdb_person_id}"
                if person.notes is None:
                    person.notes = tag
                elif tag not in person.notes:
                    person.notes = person.notes + "\n" + tag
        return pid

    stats["persons_created"] += 1
    if dry_run:
        _dry_run_counter[0] -= 1
        fake_id = _dry_run_counter[0]
        tmdb_person_id_to_pid[tmdb_person_id] = fake_id
        name_to_pids[normalized].append(fake_id)
        return fake_id

    new_person = Person(
        name=person_name,
        birth_nationality="Unknown",
        core_nationality="Unknown",
        notes=f"TMDB: person:{tmdb_person_id}",
    )
    db.add(new_person)
    db.flush()
    tmdb_person_id_to_pid[tmdb_person_id] = new_person.id
    name_to_pids[normalized].append(new_person.id)
    return new_person.id


def add_movie_person_link(
    db,
    movie_id: int,
    person_id: int,
    role: CastRole,
    dry_run: bool,
    stats: dict[str, int],
    pending_links: set[tuple[int, int, CastRole]],
) -> None:
    """Add a movie-person link, skipping duplicates within this import pass."""
    if person_id < 0:
        stats["links_added"] += 1
        return
    key = (movie_id, person_id, role)
    if key in pending_links:
        return
    pending_links.add(key)
    stats["links_added"] += 1
    if not dry_run:
        db.add(MoviePerson(movie_id=movie_id, person_id=person_id, role=role))


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def print_report(
    matched: dict[int, TmdbMovieMatch],
    total_movies: int,
    unmatched: list[tuple[str, int]],
    ambiguous: list[tuple[str, int]],
    stats: dict[str, int],
    dry_run: bool,
    report_path: Path,
) -> None:
    lines = [
        "=== TMDb Import Report ===",
        f"Matched:              {len(matched):>6} / {total_movies} movies",
        f"Unmatched:            {len(unmatched):>6}  (title not found in TMDb movies)",
        f"Ambiguous:            {len(ambiguous):>6}  (multiple TMDb entries, couldn't disambiguate)",
        f"Skipped (has cast):   {stats['movies_skipped']:>6}  (already have cast — use -o/--overwrite to update)",
        "",
        f"Runtime updated:      {stats['runtime_updated']:>6}",
        f"Year updated:         {stats['year_updated']:>6}",
        f"Movies cleared:       {stats['links_deleted']:>6}  (existing person links deleted before re-import)",
        f"New persons created:  {stats['persons_created']:>6}",
        f"Persons reused:       {stats['persons_reused']:>6}",
        f"Person notes updated: {stats['persons_notes_updated']:>6}",
        f"Person links added:   {stats['links_added']:>6}",
        f"Orphaned people removed: {stats['persons_deleted']:>6}",
        f"TMDb API requests:    {stats['api_requests']:>6}",
        f"TMDb cache hits:      {stats['cache_hits']:>6}",
    ]

    if dry_run:
        lines.append("")
        lines.append("DRY RUN — no changes written to the database.")

    if unmatched:
        lines.append("")
        lines.append("UNMATCHED MOVIES:")
        for name, year in sorted(unmatched):
            lines.append(f"  - {name} ({year})")

    if ambiguous:
        lines.append("")
        lines.append("AMBIGUOUS MOVIES (skipped):")
        for name, year in sorted(ambiguous):
            lines.append(f"  - {name} ({year})")

    report = "\n".join(lines)
    print("\n" + report)

    report_path.write_text(report, encoding="utf-8")
    print(f"\nReport written to {report_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Populate movies from TMDb data.")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen without writing to the DB")
    parser.add_argument(
        "-o",
        "--overwrite",
        action="store_true",
        help="Update movies that already have cast attached. Without "
        "this flag, only movies with no existing person links are touched.",
    )
    parser.add_argument("--language", default="en-US", help="TMDb language to request (default: en-US)")
    parser.add_argument("--region", default="US", help="TMDb region hint for movie search (default: US)")
    parser.add_argument("--delay", type=float, default=0.0, help="Optional delay in seconds between TMDb requests")
    parser.add_argument(
        "--cache-file", default="tmdb_cache.json", help="JSON cache path for TMDb responses (default: tmdb_cache.json)"
    )
    args = parser.parse_args()

    if args.dry_run:
        print("DRY RUN MODE — no changes will be written.\n")
    if not args.overwrite:
        print("SKIP MODE — movies with existing cast will not be updated (pass -o/--overwrite to change this).\n")

    stats: dict[str, int] = defaultdict(int)
    _dry_run_counter = [-1]

    client = TmdbClient(
        bearer_token=os.getenv("TMDB_BEARER_TOKEN"),
        api_key=os.getenv("TMDB_API_KEY"),
        language=args.language,
        region=args.region,
        delay_seconds=args.delay,
        cache_file=Path(args.cache_file),
    )

    init_engine()
    try:
        with _db.SessionLocal() as db:
            # ------------------------------------------------------------------
            # Phase 1: Load DB state
            # ------------------------------------------------------------------
            print("Phase 1: Loading database state...")
            db_movies = load_db_movies(db)
            tmdb_person_id_to_pid, name_to_pids = load_existing_persons(db)
            print(f"  {len(db_movies)} movies, {sum(len(v) for v in name_to_pids.values())} persons loaded.")

            # ------------------------------------------------------------------
            # Phase 2: Fetch TMDb data
            # ------------------------------------------------------------------
            print("\nPhase 2: Querying TMDb...")
            matched, unmatched, ambiguous = fetch_tmdb_matches(db_movies, client)
            print(
                f"\n  Matched {len(matched)} / {len(db_movies)} movies "
                f"({len(unmatched)} unmatched, {len(ambiguous)} ambiguous)"
            )

            if not matched:
                print("No movies matched — nothing to import.")
                return

            # ------------------------------------------------------------------
            # Phase 3: Compute roles
            # ------------------------------------------------------------------
            print("\nPhase 3: Computing roles...")
            lead_sets: dict[int, set[int]] = {
                movie_id: compute_lead_actors(movie_match.cast) for movie_id, movie_match in matched.items()
            }
            recurring, actor_appearances = compute_recurring_actors(matched)
            print(f"  {sum(len(s) for s in lead_sets.values())} lead actor slots across all matched movies.")
            print(f"  {len(recurring)} recurring actors (appear in >=2 movies).")

            # ------------------------------------------------------------------
            # Phase 4: Write to DB
            # ------------------------------------------------------------------
            print("\nPhase 4: Writing to database...")

            person_detail_cache: dict[int, TmdbPersonInfo] = {}

            def resolve_person_info(tmdb_person_id: int, fallback_name: str | None = None) -> TmdbPersonInfo | None:
                if tmdb_person_id in person_detail_cache:
                    return person_detail_cache[tmdb_person_id]
                try:
                    details = client.get_person_details(tmdb_person_id)
                except requests.HTTPError:
                    if fallback_name:
                        info = TmdbPersonInfo(tmdb_person_id=tmdb_person_id, name=fallback_name)
                        person_detail_cache[tmdb_person_id] = info
                        return info
                    return None
                info = TmdbPersonInfo(
                    tmdb_person_id=tmdb_person_id,
                    name=details.get("name") or fallback_name or f"TMDb Person {tmdb_person_id}",
                    known_for_department=details.get("known_for_department"),
                )
                person_detail_cache[tmdb_person_id] = info
                return info

            for movie in db_movies:
                movie_match = matched.get(movie.id)
                if not movie_match:
                    continue

                if not args.overwrite and movie.person_links:
                    stats["movies_skipped"] += 1
                    continue

                if movie_match.runtime_minutes is not None:
                    if not args.dry_run:
                        movie.runtime_minutes = movie_match.runtime_minutes
                    stats["runtime_updated"] += 1

                if movie_match.release_year is not None:
                    if not args.dry_run:
                        movie.release_year = movie_match.release_year
                    stats["year_updated"] += 1

                if not args.dry_run:
                    db.query(MoviePerson).filter(MoviePerson.movie_id == movie.id).delete()
                stats["links_deleted"] += 1

                pending_links: set[tuple[int, int, CastRole]] = set()

                def _add_person(tmdb_person_id: int, role: CastRole, fallback_name: str | None = None) -> None:
                    info = resolve_person_info(tmdb_person_id, fallback_name=fallback_name)
                    if info is None:
                        return
                    pid = get_or_create_person(
                        db,
                        tmdb_person_id=tmdb_person_id,
                        person_name=info.name,
                        tmdb_person_id_to_pid=tmdb_person_id_to_pid,
                        name_to_pids=name_to_pids,
                        dry_run=args.dry_run,
                        stats=stats,
                        _dry_run_counter=_dry_run_counter,
                    )
                    add_movie_person_link(db, movie.id, pid, role, args.dry_run, stats, pending_links)

                for tmdb_person_id in movie_match.directors:
                    crew_row = next((r for r in movie_match.crew if r.get("id") == tmdb_person_id), None)
                    _add_person(
                        tmdb_person_id, CastRole.director, fallback_name=crew_row.get("name") if crew_row else None
                    )

                credits_cast = movie_match.cast

                for crew_row in movie_match.crew:
                    if crew_row.get("id") in movie_match.composers:
                        _add_person(int(crew_row["id"]), CastRole.composer, fallback_name=crew_row.get("name"))

                for tmdb_person_id in lead_sets.get(movie.id, set()):
                    cast_row = next((r for r in credits_cast if r.get("id") == tmdb_person_id), None)
                    _add_person(
                        tmdb_person_id, CastRole.lead_actor, fallback_name=cast_row.get("name") if cast_row else None
                    )

                leads_here = lead_sets.get(movie.id, set())
                recurring_here = {
                    int(r["id"]) for r in credits_cast if r.get("id") is not None and int(r["id"]) in recurring
                }
                for tmdb_person_id in recurring_here:
                    if tmdb_person_id not in leads_here:
                        cast_row = next((r for r in credits_cast if r.get("id") == tmdb_person_id), None)
                        _add_person(
                            tmdb_person_id, CastRole.actor, fallback_name=cast_row.get("name") if cast_row else None
                        )

            stats["api_requests"] += client.stats.get("api_requests", 0)
            stats["cache_hits"] += client.stats.get("cache_hits", 0)

            if not args.dry_run:
                db.commit()
                print("  Committed.")

            client.save_cache()

            # ------------------------------------------------------------------
            # Phase 5: Remove orphaned people
            # ------------------------------------------------------------------
            print("\nPhase 5: Removing orphaned people...")
            all_persons = list(db.scalars(select(Person)).all())
            orphans = [p for p in all_persons if not p.movie_links and not p.artist_links]
            stats["persons_deleted"] = len(orphans)
            if orphans:
                if not args.dry_run:
                    for p in orphans:
                        db.delete(p)
                    db.commit()
                print(f"  {'Would remove' if args.dry_run else 'Removed'} {len(orphans)} orphaned people.")
            else:
                print("  No orphaned people found.")

            # ------------------------------------------------------------------
            # Phase 6: Report
            # ------------------------------------------------------------------
            print("\nPhase 6: Writing report...")
            print_report(
                matched=matched,
                total_movies=len(db_movies),
                unmatched=unmatched,
                ambiguous=ambiguous,
                stats=stats,
                dry_run=args.dry_run,
                report_path=Path("tmdb_import_report.txt"),
            )

    finally:
        dispose_engine()


if __name__ == "__main__":
    main()
