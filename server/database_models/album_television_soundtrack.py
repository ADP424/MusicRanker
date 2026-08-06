from sqlalchemy import Column, ForeignKey, Table

from .base import Base

album_television_show_soundtrack = Table(
    "album_television_show_soundtrack",
    Base.metadata,
    Column("album_id", ForeignKey("albums.id", ondelete="CASCADE"), primary_key=True),
    Column("show_id", ForeignKey("television_shows.id", ondelete="CASCADE"), primary_key=True),
)
