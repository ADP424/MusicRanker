"""
Load genres.csv and ranking.csv into the database.

Run from the repo root:
    python -m server.load.load_data
"""

import csv
from datetime import timedelta
from pathlib import Path

import server.database as _db
from server.database import dispose_engine, init_engine
from server.database_models import (  # noqa: F401 – ensures all models are registered
    Base,
)
from server.database_models.album import Album
from server.database_models.album_artist import AlbumArtist
from server.database_models.album_genre import album_genres
from server.database_models.artist import Artist
from server.database_models.genre import Genre

HERE = Path(__file__).parent
GENRES_CSV = HERE / "genres.csv"
RANKING_CSV = HERE / "ranking.csv"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_runtime(s: str) -> timedelta:
    """Parse 'H:MM:SS' or 'M:SS' into a timedelta."""
    parts = s.strip().split(":")
    if len(parts) == 3:
        h, m, sec = int(parts[0]), int(parts[1]), int(parts[2])
    elif len(parts) == 2:
        h, m, sec = 0, int(parts[0]), int(parts[1])
    else:
        raise ValueError(f"Unexpected runtime format: {s!r}")
    return timedelta(hours=h, minutes=m, seconds=sec)


_NATIONALITY_FIXES: dict[str, str] = {
    "???": "Unknown",
    "New Zealand": "New Zealander",
    "Russia": "Russian",
}


def _fix_nationality(value: str) -> str:
    return _NATIONALITY_FIXES.get(value, value)


def _synonyms(raw: str) -> list[str] | None:
    if not raw.strip():
        return None
    return [s.strip() for s in raw.split(",") if s.strip()]


# ---------------------------------------------------------------------------
# Load genres
# ---------------------------------------------------------------------------


def load_genres(db) -> dict[str, Genre]:
    """
    Insert every distinct genre name, then wire up parent relationships.

    Returns a lookup dict that maps both canonical names AND synonyms to Genre
    objects, so the ranking loader can resolve either form. Double internal
    spaces (CSV typos) are collapsed before lookup.

    CSV columns (0-based):
      0  Subgenre   – the genre being described
      1  Genre      – its direct parent (if different from Subgenre)
      2  Parent Genre – top-level category (parent of Genre, if Genre != Parent Genre)
      4  Synonyms   – comma-separated
      6  Notes
    """
    with open(GENRES_CSV, encoding="utf-8") as f:
        rows = list(csv.reader(f))[1:]  # skip header

    # Collect every name that needs to exist as a Genre row
    all_names: dict[str, dict] = {}  # name -> {synonyms, notes}
    for r in rows:
        subgenre, genre, parent, _, synonyms, _, notes = (
            r[0],
            r[1],
            r[2],
            r[3],
            r[4],
            r[5],
            r[6],
        )
        for name in (subgenre, genre, parent):
            if name and name not in all_names:
                all_names[name] = {"synonyms": None, "notes": None}
        # Synonyms and notes belong to the Subgenre row
        if subgenre:
            all_names[subgenre]["synonyms"] = _synonyms(synonyms)
            if notes.strip():
                all_names[subgenre]["notes"] = notes.strip()

    # Insert genres
    genre_objs: dict[str, Genre] = {}
    for name, meta in all_names.items():
        g = Genre(name=name, synonyms=meta["synonyms"], notes=meta["notes"])
        db.add(g)
        genre_objs[name] = g
    db.flush()  # assign IDs

    # Wire parent relationships
    # Rule: "a genre's parent is only the one directly above it"
    #   Subgenre -> Genre  (when Subgenre != Genre)
    #   Genre    -> Parent Genre  (when Genre != Parent Genre)
    parent_rels: set[tuple[str, str]] = set()
    for r in rows:
        subgenre, genre, parent = r[0], r[1], r[2]
        if subgenre and genre and subgenre != genre:
            parent_rels.add((subgenre, genre))
        if genre and parent and genre != parent:
            parent_rels.add((genre, parent))

    for child_name, parent_name in parent_rels:
        child = genre_objs[child_name]
        par = genre_objs[parent_name]
        child.parents.append(par)

    db.flush()

    # Build an extended lookup: canonical name + every synonym -> Genre object.
    # Also normalise double spaces so ranking CSV typos resolve correctly.
    lookup: dict[str, Genre] = {}
    for name, g in genre_objs.items():
        lookup[" ".join(name.split())] = g
        if g.synonyms:
            for syn in g.synonyms:
                lookup[" ".join(syn.split())] = g

    print(f"  Genres inserted: {len(genre_objs)}")
    print(f"  Parent relationships: {len(parent_rels)}")
    return lookup


# ---------------------------------------------------------------------------
# Load ranking (artists + albums)
# ---------------------------------------------------------------------------


def load_ranking(db, genre_objs: dict[str, Genre]) -> None:
    """
    CSV columns (0-based):
      0  Artist Rank
      1  Album Rank
      3  Artists
      4  Albums
      5  Alias / Collaborators
      7  Runtime
      8  Release Year
      10 Primary Genre (Artist)
      11 Primary Genre (Album)
      13 Core Artist Nationality
      14 Artist Birth/Formed Nationality
      16 Number of Listens
      18 Notes
    """
    with open(RANKING_CSV, encoding="utf-8") as f:
        rows = list(csv.reader(f))[1:]  # skip header

    # Only data rows (album rank present)
    data_rows = [r for r in rows if r[1].strip()]

    artists_inserted = 0
    albums_inserted = 0

    current_artist: Artist | None = None

    for r in data_rows:
        artist_rank_raw = r[0].strip()
        album_rank_raw = r[1].strip()
        artist_name = r[3].strip()
        album_name = r[4].strip()
        alias = r[5].strip() or None
        runtime_raw = r[7].strip()
        release_year = int(r[8].strip())
        primary_genre_artist_name = " ".join(r[10].split()) or None
        primary_genre_album_name = " ".join(r[11].split()) or None
        core_nationality = _fix_nationality(r[13].strip()) or None
        birth_nationality = _fix_nationality(r[14].strip()) or None
        listens_raw = r[16].strip()
        notes = r[18].strip() or None

        # New artist row
        if artist_rank_raw:
            artist_genre_id = genre_objs[primary_genre_artist_name].id if primary_genre_artist_name else None
            current_artist = Artist(
                name=artist_name,
                global_rank=int(artist_rank_raw),
                discography_link="",
                birth_nationality=birth_nationality,
                core_nationality=core_nationality,
                primary_genre=artist_genre_id,
            )
            db.add(current_artist)
            db.flush()
            artists_inserted += 1

        # Album
        album_genre_id = genre_objs[primary_genre_album_name].id if primary_genre_album_name else None
        listens = int(listens_raw) if listens_raw else 1

        album = Album(
            name=album_name,
            runtime=_parse_runtime(runtime_raw),
            release_year=release_year,
            alias=alias,
            listens=listens,
            notes=notes,
        )
        db.add(album)
        db.flush()

        # AlbumArtist link
        link = AlbumArtist(
            album_id=album.id,
            artist_id=current_artist.id,
            album_rank=int(album_rank_raw),
        )
        db.add(link)

        # Album genre
        if album_genre_id:
            db.execute(album_genres.insert().values(album_id=album.id, genre_id=album_genre_id))

        albums_inserted += 1

    db.flush()
    print(f"  Artists inserted: {artists_inserted}")
    print(f"  Albums inserted: {albums_inserted}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    init_engine()
    with _db.SessionLocal() as db:
        try:
            print("Loading genres…")
            genre_objs = load_genres(db)
            print("Loading artists and albums…")
            load_ranking(db, genre_objs)
            db.commit()
            print("Done.")
        except Exception:
            db.rollback()
            raise
    dispose_engine()


if __name__ == "__main__":
    main()
