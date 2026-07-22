import {
  useGameGenreCategories,
  useGameGenres,
  useGamePlatformCategories,
  useGamePlatforms,
  useGenreCategories,
  useGenres,
  useMovieGenreCategories,
  useMovieGenres,
} from "../api/hooks";
import type { GamePlatform, Genre, GenreCategory } from "../api/types";

/** A genre-like entity (music/movie/game `Genre` and `GamePlatform` are structurally identical). */
export type GenreLike = Genre | GamePlatform;

/**
 * Per-domain config that parameterizes the shared genre components. The music,
 * movie, and game genre/platform features differ only in these values.
 */
export interface GenreDomain {
  /** React-Query key prefix, also the API path segment: "genres" | "movie-genres". */
  key: string;
  /** API base path: "/genres" | "/movie-genres". */
  apiBase: string;
  /** Category CRUD base path: "/genres/categories" | "/movie-genres/categories". */
  categoryApiBase: string;
  /** Router base for detail-page links: "/music/genres" | "/movies/genres". */
  routeBase: string;
  /** Singular noun for headings: "Genre" | "Movie Genre". */
  heading: string;
  /** Lowercase plural, used in prose: "Search platforms…", "Parent platforms". */
  noun: string;
  /** Example for the comma-separated Synonyms input. */
  synonymPlaceholder: string;
  /** The list hook that loads all genres in this domain. */
  useAll: () => { data?: GenreLike[] };
  /** The list hook that loads all categories in this domain. */
  useCategories: () => { data?: GenreCategory[] };
  /** Which shared-genre boolean flag this domain corresponds to; unset for
   * taxonomies (like game platforms) that aren't split by media type. */
  mediaTypeFlag?: "is_music" | "is_movie" | "is_game";
}

export const MUSIC_GENRES: GenreDomain = {
  key: "genres",
  apiBase: "/genres",
  categoryApiBase: "/genres/categories",
  routeBase: "/music/genres",
  heading: "Genre",
  noun: "genres",
  synonymPlaceholder: "Prog Rock, Prog",
  useAll: useGenres,
  useCategories: useGenreCategories,
  mediaTypeFlag: "is_music",
};

export const MOVIE_GENRES: GenreDomain = {
  key: "movie-genres",
  apiBase: "/movie-genres",
  categoryApiBase: "/movie-genres/categories",
  routeBase: "/movies/genres",
  heading: "Movie Genre",
  noun: "genres",
  synonymPlaceholder: "Sci-Fi, Science Fiction",
  useAll: useMovieGenres,
  useCategories: useMovieGenreCategories,
  mediaTypeFlag: "is_movie",
};

export const GAME_GENRES: GenreDomain = {
  key: "game-genres",
  apiBase: "/game-genres",
  categoryApiBase: "/game-genres/categories",
  routeBase: "/games/genres",
  heading: "Game Genre",
  noun: "genres",
  synonymPlaceholder: "RPG, Role-Playing Game",
  useAll: useGameGenres,
  useCategories: useGameGenreCategories,
  mediaTypeFlag: "is_game",
};

/** Platforms are a hierarchical taxonomy, so they reuse the genre UI wholesale. */
export const GAME_PLATFORMS: GenreDomain = {
  key: "game-platforms",
  apiBase: "/game-platforms",
  categoryApiBase: "/game-platforms/categories",
  routeBase: "/games/platforms",
  heading: "Game Platform",
  noun: "platforms",
  synonymPlaceholder: "PS4, PlayStation 4",
  useAll: useGamePlatforms,
  useCategories: useGamePlatformCategories,
};
