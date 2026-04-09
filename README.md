# MusicRanker

A personal music ranking app — manage artists, albums, and genres with a ranked ordering system.

## Setup

**Backend dependencies:**
```bash
pip install -e .
```

**Frontend dependencies:**
```bash
cd frontend
npm install
```

**Database** — create a `server/.env` file with your PostgreSQL credentials:
```
DATABASE=music_ranking
DB_USER=music_ranker
DB_HOST=localhost
DB_PASSWORD=your_password
DB_PORT=5432
```

Initialize (or reset) the schema:
```bash
python -m server.initialize_database
```

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

## Database Snapshots

Snapshots are plain-text SQL files stored in `snapshots/`, named by UTC timestamp.

**Save a snapshot:**
```bash
python server/snapshot_save.py              # auto-named by timestamp
python server/snapshot_save.py my-label     # adds a label, e.g. 2026-03-27T14-30-00_my-label.sql
```

**Load a snapshot:**
```bash
python -m server.snapshot_load                                      # most recent snapshot
python -m server.snapshot_load.py 2026-03-27T14-30-00_my-label.sql  # specific file
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
