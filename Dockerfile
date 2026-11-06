# One image: the API plus the built frontend, served from one origin by
# server.production. Postgres runs separately (see docker-compose.yml).

FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY alembic.ini ./
COPY server/ server/
COPY --from=frontend /app/frontend/dist frontend/dist
# The TMDB/IGDB caches live on a volume so they survive rebuilds.
ENV TMDB_CACHE_PATH=/data/tmdb_cache.sqlite3 IGDB_CACHE_PATH=/data/igdb_cache.sqlite3
VOLUME /data
EXPOSE 8000
# Migrations first: every start brings the schema to the code's version.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn server.production:app --host 0.0.0.0 --port 8000 --workers ${WEB_WORKERS:-2} --proxy-headers"]
