# MusicRanker

Rank the music, books, movies, TV, and games you've been through, by answering "which do you prefer?"
until your order settles. A **guild** is a shared catalog for a group of friends: everyone sees the
same titles and people, and each member keeps their own ranking of them. Movies and TV can be imported
from TMDB, games from IGDB.

There are two ways to run it:

- **Docker** runs the whole thing (app and database) in containers. Use it to host the app for yourself
  or your friends.
- **Locally**, with Python, Node and a PostgreSQL you installed yourself. Use it for development: code
  changes reload as you save.

Both need a `.env` file (next section). The two keep **separate databases**: Docker doesn't see a local
PostgreSQL's data until you copy it in ([below](#bring-your-existing-database-into-docker)).

## 1. The `.env` file

Copy `.env.example` to `.env` and fill it in. What you need:

| Setting | What for |
|---|---|
| `DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` | Your local PostgreSQL. Docker ignores all of these except `DB_PASSWORD` (see below). |
| `TMDB_BEARER_TOKEN` | Importing movies and TV. From <https://www.themoviedb.org/settings/api>. |
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | Importing games. A Twitch app: <https://api-docs.igdb.com/#account-creation>. |

The app runs without the TMDB and IGDB keys; only importing and person scans need them.

## 2. Run it with Docker

Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine with the
compose plugin). Commands below are for PowerShell, from the repository folder.

```powershell
docker compose up -d --build
```

Then open <http://localhost:8000> and register. The first build takes a few minutes; later starts take
seconds.

This starts two containers: `db` (PostgreSQL 18, data kept in the `pgdata18` volume) and `app` (the API
and the website on one port). The app brings the database schema up to date every time it starts.
The Docker database's password is `DB_PASSWORD` from `.env`, fixed the first time the volume is created.

| To… | Run |
|---|---|
| Stop it | `docker compose stop` |
| Start it again | `docker compose start` |
| See the app's logs | `docker compose logs -f app` |
| Update after pulling new code | `docker compose up -d --build` |

### Update to new code, keeping your data

The data lives in the `pgdata18` volume, which rebuilding the app doesn't touch. On start the app runs
`alembic upgrade head`, which converts the existing data to the new schema in place.

```powershell
# 1. Back up first (see "Back up the Docker database" below): a migration can't be undone by restarting.
docker compose exec db pg_dump -U music_ranker -d music_ranker --no-owner -f /tmp/backup.sql
docker compose cp db:/tmp/backup.sql backup.sql

# 2. Get the new code (git pull, or copy the files over), then rebuild and restart the app.
docker compose up -d --build

# 3. Check that the migration worked: the log should show "Running upgrade ..." and then Uvicorn starting.
docker compose logs -f app
```

Run these in **PowerShell** (or cmd). In Git Bash, put `MSYS_NO_PATHCONV=1` in front of the two backup
commands, or Git Bash turns `/tmp/backup.sql` into a Windows path and pg_dump fails with
"could not open output file ... No such file or directory".

Never use `docker compose down -v` to update: `-v` deletes the volumes, and the database with them.
If the app keeps restarting after an update, the log shows the migration error. Restore the backup
([as below](#back-up-the-docker-database)) or fix the problem and run `docker compose up -d --build` again.

### Bring your existing database into Docker

Do this **before** the app has started on a new Docker database. The load expects an empty database,
and the app creates tables as soon as it starts.

```powershell
# 1. Start only the database (a new, empty one).
docker compose up -d db

# 2. Dump your local database (asks for its password). Add --exclude-schema=<name> for each
#    scratch schema you don't want to bring, e.g. --exclude-schema=mr_demo.
pg_dump -h localhost -U music_ranker -d music_ranking --no-owner --no-privileges -f music_ranker.sql

# 3. Load it into the Docker database.
docker compose cp music_ranker.sql db:/tmp/music_ranker.sql
docker compose exec db psql -U music_ranker -d music_ranker -v ON_ERROR_STOP=1 -q -f /tmp/music_ranker.sql

# 4. Start the app, and sign in with your usual account.
docker compose up -d --build
```

Replace `music_ranking` and `music_ranker` in step 2 with the `DATABASE` and `DB_USER` from your `.env`.
The `-U music_ranker -d music_ranker` in step 3 are the Docker database's own names; leave them.

If the Docker database already has data you don't need, `docker compose down -v` deletes it (and the
cache volume) so you can start this section from the top. **That can't be undone.**

Run these in **PowerShell** (or cmd). Git Bash rewrites any argument that starts with `/` into a Windows
path, so step 3 fails with "No such file or directory" for `/tmp/music_ranker.sql`. In Git Bash, put
`MSYS_NO_PATHCONV=1` in front of the `docker compose exec` command.

Write the dump to a file and copy it in, as above, rather than piping `pg_dump | docker compose exec ...`.
Windows PowerShell re-encodes text sent through a pipe, which mangles accented names.

If the load stops part-way, or the app started first and already made empty tables, clear the Docker
database's tables and run steps 3 and 4 again:

```powershell
docker compose stop app
docker compose exec db psql -U music_ranker -d music_ranker -c "drop schema public cascade; create schema public;"
```

This deletes everything in the Docker database (never your local one), so only do it when the Docker copy
has nothing you need.

### Optional: bring the TMDB/IGDB caches too

Lookups are cached on disk, so a filled cache makes imports and scans much faster. The local caches
are in `var/`. Copy them into the app's volume:

```powershell
docker compose cp var/tmdb_cache.sqlite3 app:/data/tmdb_cache.sqlite3
docker compose cp var/igdb_cache.sqlite3 app:/data/igdb_cache.sqlite3
docker compose restart app
```

### Back up the Docker database

```powershell
docker compose exec db pg_dump -U music_ranker -d music_ranker --no-owner -f /tmp/backup.sql
docker compose cp db:/tmp/backup.sql backup.sql
```

In Git Bash, put `MSYS_NO_PATHCONV=1` in front of both commands (see above).

Restore one the same way as [bringing a database in](#bring-your-existing-database-into-docker),
steps 1, 3 and 4, on a new, empty database.

### Forgotten password

Passwords are stored only as one-way hashes, so nobody can look one up. Set a new one instead:

```powershell
docker compose exec app python -m server.set_password <username or email>   # the Docker app
python -m server.set_password <username or email>                            # a local setup
```

It asks for the new password twice and signs that account out everywhere.

### Using it from other devices

Sign-in cookies are marked secure, which browsers accept over plain http only at `localhost`. To use
the app from another computer or phone, put it behind https: a reverse proxy such as Caddy or nginx.
Then set `TRUSTED_PROXY_HOPS=1` in `.env` so login rate limits see real addresses.

For a trusted home network only, `SECURE_COOKIES=false` in `.env` makes plain http work everywhere.

## 3. Run it locally (development)

Needs Python 3.13+, Node 22+ and PostgreSQL 15+ (an empty database and a user for it, named in `.env`).

```powershell
pip install -r requirements-dev.txt
cd frontend; npm install; cd ..
alembic upgrade head      # creates the tables
python main.py            # backend and frontend together
```

Open <http://localhost:5173>. Both halves reload when you save a file, and Ctrl-C stops both.

Checks before committing:

```powershell
pytest
cd frontend; npm run build; npm run lint; npm test
```
