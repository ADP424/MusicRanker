import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from . import database, jobs
from .database_models import NATIONALITIES
from .merge import apply as _merge_handlers  # noqa: F401 — registers the "guild_merge" handler
from .middleware import CsrfMiddleware
from .routers import (
    albums, artists, auth, book_genres, book_stats, books, game_genres, game_person_scan, game_platforms, game_stats,
    genres, guilds, igdb_import, jobs_router,
    merges, movie_genres, movie_person_scan, movie_stats, movies, persons, stats, television, television_genres,
    television_person_scan, television_stats, tmdb_import, tmdb_tv_import,
)
from .routers import games
from .security import CSRF_HEADER
from .snapshot import save_snapshot

ORIGINS = [o.strip() for o in os.environ.get("FRONTEND_ORIGINS", "http://localhost:5173").split(",")]


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_engine()
    jobs.start_workers()
    yield
    jobs.stop_workers()
    save_snapshot("shutdown")
    database.dispose_engine()


app = FastAPI(title="Media Ranker API", lifespan=lifespan)

# `allow_origins=["*"]` is rejected by browsers once credentials are in play.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["content-type", CSRF_HEADER],
)
app.add_middleware(CsrfMiddleware)

# identity / guild / infrastructure
app.include_router(auth.router)
app.include_router(guilds.router)
app.include_router(merges.router)
app.include_router(jobs_router.router)

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

# catalog + personal layer
app.include_router(persons.router)
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
app.include_router(movie_person_scan.router)
app.include_router(television_person_scan.router)
app.include_router(game_person_scan.router)


@app.exception_handler(IntegrityError)
def _integrity(_, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc.orig).strip()})


@app.get("/nationalities", response_model=list[str])
def nationalities():
    return list(NATIONALITIES)
