from .album import Album
from .album_artist import AlbumArtist
from .album_game_soundtrack import album_game_soundtrack
from .album_genre import album_genres
from .album_movie_soundtrack import album_movie_soundtrack
from .album_television_soundtrack import album_television_show_soundtrack
from .artist import Artist
from .artist_band_role import BandRole, band_role_type
from .artist_person import ArtistPerson
from .base import Base
from .comparisons import (
    AlbumComparison,
    ArtistComparison,
    GameComparison,
    MovieComparison,
    TelevisionEpisodeComparison,
    TelevisionShowComparison,
)
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
from .movie_cast_member import (  # enum only, no table
    ACTING_ROLES,
    MOVIE_ROLES,
    TELEVISION_EPISODE_ROLES,
    TELEVISION_SHOW_ROLES,
    CastRole,
    cast_role_type,
)
from .movie_genre_category import MovieGenreCategory, movie_genre_category_members
from .movie_person import MoviePerson
from .nationality import NATIONALITIES, nationality
from .person import Person
from .television import TelevisionShow, television_show_genres_junction
from .television_episode import TelevisionEpisode, television_episode_genres_junction
from .television_genre_category import (
    TelevisionGenreCategory,
    television_genre_category_members,
)
from .television_person import TelevisionEpisodePerson, TelevisionShowPerson

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
    "album_television_show_soundtrack",
    "AlbumArtist",
    "CastRole",
    "cast_role_type",
    "ACTING_ROLES",
    "MOVIE_ROLES",
    "TELEVISION_SHOW_ROLES",
    "TELEVISION_EPISODE_ROLES",
    "Movie",
    "movie_genres_junction",
    "MovieGenreCategory",
    "movie_genre_category_members",
    "MoviePerson",
    "TelevisionShow",
    "television_show_genres_junction",
    "TelevisionEpisode",
    "television_episode_genres_junction",
    "TelevisionShowPerson",
    "TelevisionEpisodePerson",
    "TelevisionGenreCategory",
    "television_genre_category_members",
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
    "ArtistComparison",
    "AlbumComparison",
    "MovieComparison",
    "GameComparison",
    "TelevisionShowComparison",
    "TelevisionEpisodeComparison",
]
