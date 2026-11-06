import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DataError, IntegrityError

from . import database, jobs, maintenance
from .database_models import DEFAULT_NATIONALITIES
from .merge import apply as _merge_handlers  # noqa: F401 — registers the "guild_merge" handler
from .middleware import CsrfMiddleware
from .routers import (
    account, albums, artists, auth, book_genres, book_stats, books, game_genres, game_person_scan, game_platforms, game_stats,
    genre_items, genres, guilds, igdb_import, jobs_router, merges, metadata, movie_genres, movie_stats, movies, nationalities, overview, persons, search, social, stats,
    television, television_genres, television_stats, tmdb_import, tmdb_person_scan, tmdb_tv_import,
)
from .routers import batch, games, person_tmdb
from .security import CSRF_HEADER
from .snapshot import save_snapshot

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

ORIGINS = [o.strip() for o in os.environ.get("FRONTEND_ORIGINS", "http://localhost:5173").split(",")]


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_engine()
    jobs.start_workers()
    maintenance.start()
    try:
        yield
    finally:
        maintenance.stop()
        jobs.stop_workers()
        # Opt-in: the dump holds password and session hashes, and `--reload`
        # would otherwise write one on every code change.
        if os.environ.get("SNAPSHOT_ON_SHUTDOWN", "false").lower() == "true":
            try:
                save_snapshot("shutdown")
            except Exception:
                log.exception("Shutdown snapshot failed")
        database.dispose_engine()


app = FastAPI(title="Media Ranker API", lifespan=lifespan)

# The last middleware added is the outermost: CSRF sits inside CORS, so a CSRF
# refusal still carries the CORS headers that let the page read it.
app.add_middleware(CsrfMiddleware)
# `allow_origins=["*"]` is rejected by browsers once credentials are in play.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["content-type", CSRF_HEADER],
)

# identity / guild / infrastructure
app.include_router(auth.router)
app.include_router(account.router)
app.include_router(guilds.router)
app.include_router(merges.router)
app.include_router(jobs_router.router)
app.include_router(overview.router)
app.include_router(search.router)
app.include_router(social.router)

# taxonomy — category routers first, so /categories isn't eaten by /{gid}
app.include_router(genres.category_router)
app.include_router(genres.router)
app.include_router(movie_genres.category_router)
app.include_router(movie_genres.router)
app.include_router(game_genres.category_router)
app.include_router(game_genres.router)
app.include_router(television_genres.category_router)
app.include_router(television_genres.router)
app.include_router(book_genres.category_router)
app.include_router(book_genres.router)
app.include_router(game_platforms.category_router)
app.include_router(game_platforms.router)
app.include_router(genre_items.router)

# catalog + personal layer
app.include_router(persons.router)
app.include_router(nationalities.router)
app.include_router(person_tmdb.router)
app.include_router(batch.router)
app.include_router(artists.router)
app.include_router(artists.links_router)
app.include_router(albums.router)
app.include_router(albums.links_router)
app.include_router(movies.router)
app.include_router(movies.links_router)
app.include_router(games.router)
app.include_router(games.links_router)
app.include_router(television.router)
app.include_router(television.links_router)
app.include_router(television.season_links_router)
app.include_router(television.episode_links_router)
app.include_router(books.router)
app.include_router(books.links_router)

# stats
app.include_router(stats.router)
app.include_router(movie_stats.router)
app.include_router(game_stats.router)
app.include_router(television_stats.router)
app.include_router(book_stats.router)

# imports
app.include_router(tmdb_import.router)
app.include_router(tmdb_tv_import.router)
app.include_router(igdb_import.router)
app.include_router(metadata.router)
app.include_router(tmdb_person_scan.router)
app.include_router(game_person_scan.router)


#: SQLSTATE -> what the user is told. The raw driver message names tables,
#: columns and values, so it is logged, never returned.
_INTEGRITY_MESSAGES = {
    "23505": "That conflicts with something that already exists (probably a duplicate name).",
    "23503": "That refers to something that no longer exists, or is still in use elsewhere.",
    "23502": "A required value is missing.",
    "23514": "That value isn't allowed.",
}


@app.exception_handler(IntegrityError)
def _integrity(_, exc: IntegrityError):
    code = getattr(exc.orig, "sqlstate", None)
    log.info("IntegrityError %s: %s", code, str(exc.orig).strip())
    return JSONResponse(status_code=409, content={
        "detail": _INTEGRITY_MESSAGES.get(code, "That conflicts with existing data."),
    })


@app.exception_handler(DataError)
def _data_error(_, exc: DataError):
    log.info("DataError: %s", str(exc.orig).strip())
    return JSONResponse(status_code=422, content={"detail": "One of the values is invalid."})


@app.get("/nationalities", response_model=list[str])
def default_nationalities():
    """The list a new guild starts with (each guild's own is under
    /guilds/{id}/nationalities). Also what the frontend fetches to prime CSRF."""
    return list(DEFAULT_NATIONALITIES)
