"""Eager-loading option sets: one per serializer, listing exactly the
relationships it reads, so a list endpoint costs a fixed number of queries
however many rows it returns (tests/test_query_counts.py enforces this).

Keep each set next to what it serves in mind: if a serializer starts reading a
new relationship, add it here or the endpoint quietly goes N+1 again.
"""
from __future__ import annotations

from typing import Iterable, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .database_models import (
    Album, AlbumArtist, Artist, ArtistPerson, Book, BookPerson, Game, GamePerson, Movie, MoviePerson, Person,
    TelevisionEpisode, TelevisionEpisodePerson, TelevisionSeason, TelevisionSeasonPerson, TelevisionShow,
    TelevisionShowPerson,
)

T = TypeVar("T")

MOVIE = (
    selectinload(Movie.person_links).joinedload(MoviePerson.person),
    selectinload(Movie.genres),
    selectinload(Movie.soundtrack_albums),
    selectinload(Movie.source_books),
    selectinload(Movie.links),
)
GAME = (
    selectinload(Game.person_links).joinedload(GamePerson.person),
    selectinload(Game.genres),
    selectinload(Game.platforms),
    selectinload(Game.soundtrack_albums),
    selectinload(Game.source_books),
    selectinload(Game.links),
)
BOOK = (
    selectinload(Book.person_links).joinedload(BookPerson.person),
    selectinload(Book.genres),
    selectinload(Book.adaptation_movies),
    selectinload(Book.adaptation_games),
    selectinload(Book.adaptation_television_shows),
    selectinload(Book.links),
)
ALBUM = (
    selectinload(Album.artist_links).joinedload(AlbumArtist.artist),
    selectinload(Album.genres),
    selectinload(Album.soundtrack_movies),
    selectinload(Album.soundtrack_games),
    selectinload(Album.soundtrack_television_shows),
    selectinload(Album.links),
)
ARTIST = (
    selectinload(Artist.person_links).joinedload(ArtistPerson.person),
    selectinload(Artist.album_links).joinedload(AlbumArtist.album).selectinload(Album.genres),
    selectinload(Artist.links),
)

SHOW = (
    selectinload(TelevisionShow.person_links).joinedload(TelevisionShowPerson.person),
    selectinload(TelevisionShow.genres),
    selectinload(TelevisionShow.soundtrack_albums),
    selectinload(TelevisionShow.source_books),
    selectinload(TelevisionShow.seasons),
    selectinload(TelevisionShow.episodes),
    selectinload(TelevisionShow.links),
)
SEASON = (
    selectinload(TelevisionSeason.person_links).joinedload(TelevisionSeasonPerson.person),
    selectinload(TelevisionSeason.episodes),
    selectinload(TelevisionSeason.links),
)
EPISODE = (
    selectinload(TelevisionEpisode.person_links).joinedload(TelevisionEpisodePerson.person),
    selectinload(TelevisionEpisode.genres),
    selectinload(TelevisionEpisode.links),
)

#: What a person's list row names: every credit's target (seasons and episodes
#: up to their show, which is how the list rolls them up).
PERSON = (
    selectinload(Person.artist_links).joinedload(ArtistPerson.artist),
    selectinload(Person.book_links).joinedload(BookPerson.book),
    selectinload(Person.movie_links).joinedload(MoviePerson.movie),
    selectinload(Person.game_links).joinedload(GamePerson.game),
    selectinload(Person.television_links).joinedload(TelevisionShowPerson.show),
    selectinload(Person.television_season_links).joinedload(TelevisionSeasonPerson.season)
    .joinedload(TelevisionSeason.show),
    selectinload(Person.television_episode_links).joinedload(TelevisionEpisodePerson.episode)
    .joinedload(TelevisionEpisode.show),
)


def by_ids(db: Session, model: type[T], ids: Iterable[int], options) -> dict[int, T]:
    """Load many rows by id in one round trip (plus one per eager-loaded
    relationship), instead of a `db.get` per row."""
    ids = list(ids)
    if not ids:
        return {}
    return {o.id: o for o in db.scalars(select(model).where(model.id.in_(ids)).options(*options))}


def get(db: Session, model: type[T], ident: int, options) -> T | None:
    return db.get(model, ident, options=options)
