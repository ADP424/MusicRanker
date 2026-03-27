from .album import AlbumIn, AlbumIndex, AlbumOut, AlbumPatch
from .artist import ArtistIn, ArtistOut, ArtistPatch
from .base import LinkBody, ORMSchema, PositionBody
from .genre import GenreIn, GenreOut, GenrePatch

__all__ = [
    "ORMSchema",
    "PositionBody",
    "LinkBody",
    "GenreIn",
    "GenrePatch",
    "GenreOut",
    "ArtistIn",
    "ArtistPatch",
    "ArtistOut",
    "AlbumIn",
    "AlbumIndex",
    "AlbumPatch",
    "AlbumOut",
]
