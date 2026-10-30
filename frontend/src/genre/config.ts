import { useGuildApi } from "../api/hooks";
import {
  useBookGenreCategories,
  useBookGenres,
  useGameGenreCategories,
  useGameGenres,
  useGamePlatformCategories,
  useGamePlatforms,
  useGenreCategories,
  useMusicGenres,
  useMovieGenreCategories,
  useMovieGenres,
  useTelevisionGenreCategories,
  useTelevisionGenres,
} from "../api/hooks";
import type { GamePlatform, Genre, GenreCategory } from "../api/types";

/** A genre-like entity (music/movie/game `Genre` and `GamePlatform` are structurally identical). */
export type GenreLike = Genre | GamePlatform;

/**
 * Per-domain config that parameterizes the shared genre components. The music,
 * movie, and game genre/platform features differ only in these values.
 * `apiBase`/`categoryApiBase` are hooks because they must be guild-prefixed,
 * which requires the guild context.
 */
export interface GenreDomain {
  /** React-Query key prefix, also the API path segment: "genres" | "movie-genres". */
  key: string;
  /** Guild-prefixed API base path: "/guilds/{g}/genres" | "/guilds/{g}/movie-genres". */
  useApiBase: () => string;
  /** Guild-prefixed category CRUD base path. */
  useCategoryApiBase: () => string;
  /** Router base for detail-page links: "/music/genres" | "/movies/genres". */
  routeBase: string;
  /** Singular noun for headings: "Genre" | "Movie Genre". */
  heading: string;
  /** Lowercase plural, used in prose: "Search platforms…", "Parent platforms". */
  noun: string;
  /** Example for the comma-separated Synonyms input. */
  synonymPlaceholder: string;
  /** The list hook that loads all genres in this domain. */
  useAll: () => { data?: GenreLike[]; isLoading: boolean };
  /** The list hook that loads all categories in this domain. */
  useCategories: () => { data?: GenreCategory[]; isLoading: boolean };
  /** Which shared-genre boolean flag this domain corresponds to; unset for
   * taxonomies (like game platforms) that aren't split by media type. */
  mediaTypeFlag?: "is_music" | "is_movie" | "is_game" | "is_television" | "is_book";
}

export const MUSIC_GENRES: GenreDomain = {
  key: "genres",
  useApiBase: () => `${useGuildApi().base}/genres`,
  useCategoryApiBase: () => `${useGuildApi().base}/genres/categories`,
  routeBase: "/music/genres",
  heading: "Genre",
  noun: "genres",
  synonymPlaceholder: "Prog Rock, Prog",
  useAll: useMusicGenres,
  useCategories: useGenreCategories,
  mediaTypeFlag: "is_music",
};

export const MOVIE_GENRES: GenreDomain = {
  key: "movie-genres",
  useApiBase: () => `${useGuildApi().base}/movie-genres`,
  useCategoryApiBase: () => `${useGuildApi().base}/movie-genres/categories`,
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
  useApiBase: () => `${useGuildApi().base}/game-genres`,
  useCategoryApiBase: () => `${useGuildApi().base}/game-genres/categories`,
  routeBase: "/games/genres",
  heading: "Game Genre",
  noun: "genres",
  synonymPlaceholder: "RPG, Role-Playing Game",
  useAll: useGameGenres,
  useCategories: useGameGenreCategories,
  mediaTypeFlag: "is_game",
};

export const TELEVISION_GENRES: GenreDomain = {
  key: "television-genres",
  useApiBase: () => `${useGuildApi().base}/television-genres`,
  useCategoryApiBase: () => `${useGuildApi().base}/television-genres/categories`,
  routeBase: "/television/genres",
  heading: "Television Genre",
  noun: "genres",
  synonymPlaceholder: "Sitcom, Situation Comedy",
  useAll: useTelevisionGenres,
  useCategories: useTelevisionGenreCategories,
  mediaTypeFlag: "is_television",
};

export const BOOK_GENRES: GenreDomain = {
  key: "book-genres",
  useApiBase: () => `${useGuildApi().base}/book-genres`,
  useCategoryApiBase: () => `${useGuildApi().base}/book-genres/categories`,
  routeBase: "/books/genres",
  heading: "Book Genre",
  noun: "genres",
  synonymPlaceholder: "SF, Science Fiction",
  useAll: useBookGenres,
  useCategories: useBookGenreCategories,
  mediaTypeFlag: "is_book",
};

/** Platforms are a hierarchical taxonomy, so they reuse the genre UI wholesale. */
export const GAME_PLATFORMS: GenreDomain = {
  key: "game-platforms",
  useApiBase: () => `${useGuildApi().base}/game-platforms`,
  useCategoryApiBase: () => `${useGuildApi().base}/game-platforms/categories`,
  routeBase: "/games/platforms",
  heading: "Game Platform",
  noun: "platforms",
  synonymPlaceholder: "PS4, PlayStation 4",
  useAll: useGamePlatforms,
  useCategories: useGamePlatformCategories,
};
