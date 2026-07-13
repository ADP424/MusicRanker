import { useGenres, useMovieGenres } from "../api/hooks";
import type { Genre, MovieGenre } from "../api/types";

/** A genre-like entity (music `Genre` and `MovieGenre` are structurally identical). */
export type GenreLike = Genre | MovieGenre;

/**
 * Per-domain config that parameterizes the shared genre components. The music
 * and movie genre features differ only in these values.
 */
export interface GenreDomain {
  /** React-Query key prefix, also the API path segment: "genres" | "movie-genres". */
  key: string;
  /** API base path: "/genres" | "/movie-genres". */
  apiBase: string;
  /** Router base for detail-page links: "/music/genres" | "/movies/genres". */
  routeBase: string;
  /** Singular noun for headings: "Genre" | "Movie Genre". */
  heading: string;
  /** The list hook that loads all genres in this domain. */
  useAll: () => { data?: GenreLike[] };
}

export const MUSIC_GENRES: GenreDomain = {
  key: "genres",
  apiBase: "/genres",
  routeBase: "/music/genres",
  heading: "Genre",
  useAll: useGenres,
};

export const MOVIE_GENRES: GenreDomain = {
  key: "movie-genres",
  apiBase: "/movie-genres",
  routeBase: "/movies/genres",
  heading: "Movie Genre",
  useAll: useMovieGenres,
};
