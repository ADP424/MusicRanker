from .album import Album
from .album_artist import AlbumArtist
from .album_game_soundtrack import album_game_soundtrack
from .album_genre import album_genres
from .album_movie_soundtrack import album_movie_soundtrack
from .artist import Artist
from .artist_band_role import BandRole, band_role_type
from .artist_person import ArtistPerson
from .base import Base
from .game import Game, game_genres_junction, game_platforms_junction
from .game_credit import GameRole, game_role_type
from .game_genre_category import GameGenreCategory, game_genre_category_members
from .game_person import GamePerson
from .game_platform import GamePlatform, game_platform_parents
from .game_platform_category import GamePlatformCategory, game_platform_category_members
from .genre import Genre
from .genre_category import GenreCategory, genre_category_members
from .genre_parent import genre_parents
from .movie import Movie, movie_genres_junction
from .movie_cast_member import CastRole, cast_role_type  # enum only, no table
from .movie_genre_category import MovieGenreCategory, movie_genre_category_members
from .movie_person import MoviePerson
from .nationality import NATIONALITIES, nationality
from .person import Person

__all__ = [
    "Base",
    "NATIONALITIES",
    "nationality",
    "Genre",
    "genre_parents",
    "GenreCategory",
    "genre_category_members",
    "Artist",
    "ArtistPerson",
    "BandRole",
    "band_role_type",
    "Album",
    "album_genres",
    "album_game_soundtrack",
    "album_movie_soundtrack",
    "AlbumArtist",
    "CastRole",
    "cast_role_type",
    "Movie",
    "movie_genres_junction",
    "MovieGenreCategory",
    "movie_genre_category_members",
    "MoviePerson",
    "Game",
    "game_genres_junction",
    "game_platforms_junction",
    "GameRole",
    "game_role_type",
    "GameGenreCategory",
    "game_genre_category_members",
    "GamePerson",
    "GamePlatform",
    "game_platform_parents",
    "GamePlatformCategory",
    "game_platform_category_members",
    "Person",
]
