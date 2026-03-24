from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from . import database
from .database_models import NATIONALITIES
from .routers import albums, artists, genres, stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_engine()
    yield
    database.dispose_engine()


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


@app.exception_handler(IntegrityError)
def _integrity(_, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc.orig).strip()})


@app.get("/nationalities", response_model=list[str])
def nationalities():
    return list(NATIONALITIES)
