from sqlalchemy import Column, ForeignKeyConstraint, Index, Table

from .base import Base


def guild_junction(name: str, left: tuple[str, str], right: tuple[str, str], *, index_right: bool = True) -> Table:
    """(column, table) pairs. Both sides get a composite FK, so a junction row
    can never straddle two guilds.

    Deliberately *not* also given a plain single-column `ForeignKey`: a column
    that carried both would leave SQLAlchemy with two FK paths to the same
    target table and no way to pick one for a bare `secondary=` relationship
    (AmbiguousForeignKeysError) — the composite constraint alone is sufficient
    for referential integrity.
    """
    (lcol, ltab), (rcol, rtab) = left, right
    args = [
        Column(lcol, primary_key=True),
        Column(rcol, primary_key=True),
        Column("guild_id", nullable=False),
        ForeignKeyConstraint([lcol, "guild_id"], [f"{ltab}.id", f"{ltab}.guild_id"], ondelete="CASCADE"),
        ForeignKeyConstraint([rcol, "guild_id"], [f"{rtab}.id", f"{rtab}.guild_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["guild_id"], ["guilds.id"], ondelete="CASCADE"),
    ]
    if index_right:
        args.append(Index(f"idx_{name}_{rcol}", rcol))
    return Table(name, Base.metadata, *args)


album_genres = guild_junction("album_genres", ("album_id", "albums"), ("genre_id", "genres"))
album_movie_soundtrack = guild_junction("album_movie_soundtrack", ("album_id", "albums"), ("movie_id", "movies"))
album_game_soundtrack = guild_junction("album_game_soundtrack", ("album_id", "albums"), ("game_id", "games"))
album_television_show_soundtrack = guild_junction(
    "album_television_show_soundtrack", ("album_id", "albums"), ("show_id", "television_shows")
)
movie_genres_junction = guild_junction("movie_genres_junction", ("movie_id", "movies"), ("genre_id", "genres"))
game_genres_junction = guild_junction("game_genres_junction", ("game_id", "games"), ("genre_id", "genres"))
game_platforms_junction = guild_junction(
    "game_platforms_junction", ("game_id", "games"), ("platform_id", "game_platforms")
)
game_platform_parents = guild_junction(
    "game_platform_parents", ("platform_id", "game_platforms"), ("parent_platform_id", "game_platforms")
)
television_show_genres_junction = guild_junction(
    "television_show_genres_junction", ("show_id", "television_shows"), ("genre_id", "genres")
)
television_episode_genres_junction = guild_junction(
    "television_episode_genres_junction", ("episode_id", "television_episodes"), ("genre_id", "genres")
)
book_genres = guild_junction("book_genres", ("book_id", "books"), ("genre_id", "genres"))
# A book and the movies / games / shows adapted from it.
book_movie_adaptations = guild_junction("book_movie_adaptations", ("book_id", "books"), ("movie_id", "movies"))
book_game_adaptations = guild_junction("book_game_adaptations", ("book_id", "books"), ("game_id", "games"))
book_television_show_adaptations = guild_junction(
    "book_television_show_adaptations", ("book_id", "books"), ("show_id", "television_shows")
)
