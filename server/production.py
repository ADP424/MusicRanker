"""Production entrypoint: one origin serves the API under /api and the built
frontend everywhere else, so cookies are first-party and no CORS is needed.

    cd frontend && npm run build          # -> frontend/dist
    alembic upgrade head
    uvicorn server.production:app --host 0.0.0.0 --port 8000 --workers 2

Several workers are safe: jobs are claimed from Postgres, not held in memory.
(Login rate limits are per process, so N workers allow N times the attempts.)
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

from .main import app as api

DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parent.parent / "frontend" / "dist"))


class SpaFiles(StaticFiles):
    """Static files, except that a path with no file behind it (a client-side
    route like /g/3/movies) gets index.html, so deep links and refreshes work."""

    async def get_response(self, path: str, scope):
        url_path = path.replace("\\", "/")  # Starlette hands over an OS path: backslashes on Windows
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or "." in url_path.rsplit("/", 1)[-1]:
                raise
            response = await super().get_response("index.html", scope)
        # Hashed bundles never change; the page that names them always may.
        if url_path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif response.media_type == "text/html":
            response.headers["Cache-Control"] = "no-cache"
        return response


# The API's lifespan (DB engine, job workers, maintenance) must run on the
# outer app: Starlette doesn't run a mounted app's lifespan.
app = FastAPI(lifespan=api.router.lifespan_context, docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)
if DIST.is_dir():
    app.mount("/", SpaFiles(directory=DIST, html=True), name="frontend")
