from sqlalchemy import Column, ForeignKey, Index, Table

from .base import Base

album_game_soundtrack = Table(
    "album_game_soundtrack",
    Base.metadata,
    Column("album_id", ForeignKey("albums.id", ondelete="CASCADE"), primary_key=True),
    Column("game_id", ForeignKey("games.id", ondelete="CASCADE"), primary_key=True),
    Index("idx_album_game_soundtrack_game", "game_id"),
)
