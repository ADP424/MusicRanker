from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from . import database
from .database_models import NATIONALITIES
from .routers import (
    albums,
    artists,
    genres,
    movie_genres,
    movie_stats,
    movies,
    persons,
    stats,
)
from .snapshot import save_snapshot


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_engine()
    yield
    database.dispose_engine()
    save_snapshot("shutdown")


app = FastAPI(title="Music DB API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(genres.router)
app.include_router(artists.router)
app.include_router(albums.router)
app.include_router(stats.router)
app.include_router(movie_genres.router)
app.include_router(movies.router)
app.include_router(movie_stats.router)
app.include_router(persons.router)


@app.exception_handler(IntegrityError)
def _integrity(_, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc.orig).strip()})


@app.get("/nationalities", response_model=list[str])
def nationalities():
    return list(NATIONALITIES)
