"""Indexes for the reverse direction of composite keys.

A junction's primary key `(left_id, right_id, ...)` serves lookups by its
leading column only. These cover the other side: "everything this person is
credited on" (person pages, the people graph), "everything in this category",
and the ON DELETE CASCADE scans Postgres runs when a catalog row is deleted,
which otherwise read the whole rank/comparison table.

Declared here, against the finished tables, rather than in each model; the
tables come from several shared factories (`guild_junction`, `_members`, the
rank/comparison mixins).
"""
from sqlalchemy import Index

from .base import Base

_T = Base.metadata.tables

_SPECS: list[tuple[str, tuple[str, ...]]] = [
    # credits, by person
    *[(t, ("person_id",)) for t in (
        "artist_people", "book_persons", "movie_persons", "game_persons",
        "television_show_persons", "television_season_persons", "television_episode_persons",
    )],
    # an artist's discography
    ("album_artists", ("artist_id",)),
    # category membership, by category
    *[(t, ("category_id",)) for t in (
        "music_genre_category_members", "movie_genre_category_members", "game_genre_category_members",
        "television_genre_category_members", "book_genre_category_members", "game_platform_category_members",
    )],
    # a user's guilds
    ("guild_members", ("user_id",)),
    # rank rows, by the catalog row they point at (cascades, "who ranked this")
    ("user_album_ranks", ("album_id",)),
    ("user_television_season_ranks", ("show_id",)),
    ("user_television_episode_ranks", ("season_id",)),
    ("user_television_episode_ranks", ("show_id",)),
    # comparisons: a user's answers, and both sides for cascades
    *[(t, cols) for t in (
        "artist_comparison", "album_comparison", "movie_comparison", "game_comparison", "book_comparison",
        "television_show_comparison", "television_season_comparison", "television_episode_comparison",
    ) for cols in (("user_id", "guild_id"), ("winner_id",), ("loser_id",))],
]

for _table, _cols in _SPECS:
    _t = _T[_table]
    _name = f"ix_{_table}_{'_'.join(_cols)}"
    if not any([c.name for c in ix.columns] == list(_cols) for ix in _t.indexes):
        Index(_name, *(_t.c[c] for c in _cols))
