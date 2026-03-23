from sqlalchemy import Column, ForeignKey, Index, Table

from .base import Base

album_genres = Table(
    "album_genres",
    Base.metadata,
    Column("album_id", ForeignKey("albums.id", ondelete="CASCADE"), primary_key=True),
    Column("genre_id", ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True),
    Index("idx_album_genres_genre", "genre_id"),
)
