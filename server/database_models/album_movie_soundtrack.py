from sqlalchemy import Column, ForeignKey, Table

from .base import Base

album_movie_soundtrack = Table(
    "album_movie_soundtrack",
    Base.metadata,
    Column("album_id", ForeignKey("albums.id", ondelete="CASCADE"), primary_key=True),
    Column("movie_id", ForeignKey("movies.id", ondelete="CASCADE"), primary_key=True),
)
