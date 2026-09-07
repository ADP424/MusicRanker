# MusicRanker

A multi-tenant media ranking app. Guilds (shared workspaces) hold a catalog of artists/albums,
movies, games, TV shows/episodes, and the people credited across them; each guild member keeps
their own personal ranking of that catalog via pairwise comparison, with role-based permissions
controlling who can edit the shared catalog vs. just rank it.

## Setup

**Backend dependencies:**
```bash
pip install -e .
# or
pip install -r requirements.txt
pip install -r requirements-dev.txt
```

**Frontend dependencies:**
```bash
cd frontend
npm install
```

**Database** — create a `.env` file in the repo root with your PostgreSQL credentials:
```
DATABASE=music_ranking
DB_USER=music_ranker
DB_HOST=localhost
DB_PASSWORD=your_password
DB_PORT=5432
```

Optional — TMDB and IGDB import (movies/TV/games can be pulled in from these instead of entered
by hand):
```
TMDB_API_KEY=...
TMDB_BEARER_TOKEN=...
IGDB_CLIENT_ID=...
IGDB_CLIENT_SECRET=...
IGDB_RPS=3
IGDB_BURST=4
```

Initialize (or reset) the schema:
```bash
python -m server.initialize_database
```
This drops and recreates every table from the current ORM models — data is not preserved. Use
a snapshot (below) first if you need to keep what's there.

## Running

**Backend** (from repo root):
```bash
uvicorn server.main:app --reload
```
API available at `http://localhost:8000`. Docs at `http://localhost:8000/docs`.

**Frontend** (from `frontend/`):
```bash
npm run dev
```
UI available at `http://localhost:5173`.

**Production frontend build:**
```bash
npm run build
```

Registering an account automatically creates a personal guild you own; from there you can invite
others or create additional guilds. Everything in the app — catalog entries, rankings, genres — is
scoped to whichever guild you're currently in.

## Database Snapshots

Snapshots are plain-text SQL files stored in `server/snapshots/`, named by UTC timestamp.

**Save a snapshot:**
```bash
python server/snapshot_save.py              # auto-named by timestamp
python server/snapshot_save.py my-label     # adds a label, e.g. 2026-03-27T14-30-00_my-label.sql
```

**Load a snapshot:**
```bash
python -m server.snapshot_load                                      # most recent snapshot
python -m server.snapshot_load 2026-03-27T14-30-00_my-label.sql     # specific file
```

Restoring a snapshot drops and recreates all objects in-place — no need to run `initialize_database` first.

**From Python:**
```python
from server.snapshot import save_snapshot, load_snapshot, list_snapshots

save_snapshot("before-migration")
load_snapshot("snapshots/2026-03-27T14-30-00_before-migration.sql")
snapshots = list_snapshots()  # sorted newest-first
```

## Linting

```bash
black server/
isort server/
flake8 server/
```
