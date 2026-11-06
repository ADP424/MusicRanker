"""The movie side of the TMDB person scan (`tmdb_person_scan.py`): a flat
snapshot of the guild's movies and their person links, and the resolution of a
local movie to its TMDB id.

    Phase 1  local movie  ->  tmdb_movie_id    (1 call, cached ~forever)
    Phase 2  /movie/{id}/credits               (1 call, cached 30 days)

Scoped scans only *fetch* the scoped movies, but every movie whose credits are
already cached still feeds the identity evidence -- so a per-movie scan is
fully evidenced the moment you've run one full scan.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .database_models import CastRole, Movie, MoviePerson, Person
from .tmdb_client import TTL_CREDITS, TTL_NEGATIVE, TTL_SEARCH, TmdbClient
from .tmdb_common import CREW_JOB_ROLES, norm as _norm

# A "slot" is the unit of uniqueness for a person on a movie.  It is what the
# already-linked check keys on, and therefore what a rejection keys on too.
SLOT_CAST = "cast"
JOB_SLOTS = {"Director": "director", "Original Music Composer": "composer"}
SLOT_TO_ROLE = {slot: CREW_JOB_ROLES[job] for job, slot in JOB_SLOTS.items()}
CAST_ROLES = frozenset({CastRole.lead_actor, CastRole.actor, CastRole.cameo_actor})


# ──────────────────────────────────────────────────────────────
#  DB snapshot (three flat queries; no ORM objects, no N+1)
# ──────────────────────────────────────────────────────────────
@dataclass(slots=True)
class LMovie:
    id: int
    name: str
    name_en: Optional[str]
    release_year: Optional[int]
    tmdb_id: Optional[int] = None


@dataclass(slots=True)
class LPerson:
    id: int
    name: str
    name_en: Optional[str]


def _load_db(db, guild_id: int):
    movies = [
        LMovie(*r) for r in db.query(Movie.id, Movie.name, Movie.name_en, Movie.release_year, Movie.tmdb_id)
        .filter(Movie.guild_id == guild_id).all()
    ]
    people = [
        LPerson(*r) for r in db.query(Person.id, Person.name, Person.name_en)
        .filter(Person.guild_id == guild_id).all()
    ]
    links = db.query(MoviePerson.person_id, MoviePerson.movie_id, MoviePerson.role) \
        .filter(MoviePerson.guild_id == guild_id).all()
    return movies, people, [(r[0], r[1], r[2]) for r in links]


# ──────────────────────────────────────────────────────────────
#  Phase 1: local movie -> tmdb id  (the no-schema-change workaround)
# ──────────────────────────────────────────────────────────────
#: How many title/year-plausible TMDB films get their credits fetched to be
#: told apart by the people already linked to the local movie.
DISAMBIGUATE_TOP = 3

#: A movie with at least this many links whose resolved TMDB credits contain
#: none of them was resolved to the wrong film (a same-titled remake, an
#: unreleased reboot...).  Its cast must not be offered as missing links.
MISMATCH_MIN_LINKS = 3


def _score_result(r: dict, want_norm: str, want_year: Optional[int]):
    title_n = _norm(r.get("title") or "")
    orig_n = _norm(r.get("original_title") or "")
    raw_year = (r.get("release_date") or "")[:4]
    yr = int(raw_year) if raw_year.isdigit() else None

    # An undated result is usually an unannounced remake or reboot sharing the
    # title; it can't be confirmed against a known year, so it doesn't qualify.
    if want_year and (yr is None or abs(yr - want_year) > 1):
        return None
    exact = want_norm in (title_n, orig_n)
    if not exact and not (want_year and yr == want_year):
        return None
    # Festival-vs-wide-release years drift by one, so an off-by-one year stays
    # a candidate; when it loses to an obscure exact-year namesake here, the
    # linked-people overlap in `_resolve_movie_id` is what corrects it.
    return (1 if exact else 0, 1 if yr == want_year else 0, float(r.get("popularity") or 0.0))


def _credit_norms(credits: Optional[dict]) -> set[str]:
    out: set[str] = set()
    for c in (credits or {}).get("cast", []) + (credits or {}).get("crew", []):
        out |= {_norm(n) for n in (c.get("name"), c.get("original_name")) if n}
    return out


def _resolve_movie_id(
    client: TmdbClient, m: LMovie, linked: set[str], *, allow_network: bool
) -> Optional[int]:
    """`linked` is the normalised names of people already linked to `m`: when
    several TMDB films fit the title and year, the one crediting the most of
    them wins."""
    # Keyed on the DB id *plus* a fingerprint, so fixing a title or year
    # invalidates the mapping automatically.  (v2: the v1 resolver stopped at
    # the first exact title within the DB year, mapping e.g. Enemy (2013) to an
    # obscure namesake instead of Villeneuve's film, TMDB-dated 2014.)
    fp = f"{_norm(m.name)}|{_norm(m.name_en or '')}|{m.release_year}"
    key = f"movie_id:v2:{m.id}:{fp}"

    # force_refresh must bypass this, or a forced re-scan keeps honouring the
    # 7-day negative cache and never retries a movie whose title you just fixed.
    cached = None if client.force_refresh else client.sidecar.kv_get(key)
    if cached is not None:
        return cached or None  # 0 == known-missing
    if not allow_network:
        return None

    titles = list(filter(None, (m.name_en, m.name)))
    attempts: list[tuple[str, Optional[int]]] = [(t, m.release_year) for t in titles]
    if m.release_year:
        attempts += [(t, None) for t in titles]

    # Every attempt runs: stopping at the first exact title inside the DB year
    # would never see the real film when TMDB dates it a year later.
    seen: set = set()
    scores: dict[int, tuple] = {}
    for title, year in attempts:
        k = (title.lower(), year)
        if k in seen:
            continue
        seen.add(k)

        params = {"query": title}
        if year:
            params["primary_release_year"] = str(year)
        data = client.get("/search/movie", params, ttl=TTL_SEARCH)
        if not data:
            continue

        want_norm = _norm(title)
        for r in data.get("results", [])[:10]:
            sc = _score_result(r, want_norm, m.release_year)
            if sc and sc > scores.get(r["id"], ()):
                scores[r["id"]] = sc

    ranked = sorted(scores, key=scores.get, reverse=True)
    tid = ranked[0] if ranked else None
    if linked and len(ranked) > 1:
        # By score *and* by popularity: a handful of obscure exact-year
        # namesakes can otherwise crowd the famous film out of the pool.
        by_pop = sorted(scores, key=lambda cid: scores[cid][2], reverse=True)
        pool = dict.fromkeys(ranked[:DISAMBIGUATE_TOP] + by_pop[:DISAMBIGUATE_TOP])
        overlap = {
            cid: len(linked & _credit_norms(client.get(f"/movie/{cid}/credits", ttl=TTL_CREDITS)))
            for cid in pool
        }
        best = max(overlap, key=lambda cid: (overlap[cid], scores[cid]))
        if overlap[best] > 0:
            tid = best

    client.sidecar.kv_set(key, tid or 0, TTL_SEARCH if tid else TTL_NEGATIVE)
    return tid
