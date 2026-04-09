import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./client";
import type { AlbumIndex, Artist, Genre, Movie, MovieGenre, MovieIndex, Person } from "./types";

export const useNationalities = () =>
  useQuery({
    queryKey: ["nationalities"],
    queryFn: () => api.get<string[]>("/nationalities"),
  });

export const useGenres = () =>
  useQuery({
    queryKey: ["genres"],
    queryFn: () => api.get<Genre[]>("/genres"),
  });

export const useArtists = () =>
  useQuery({
    queryKey: ["artists"],
    queryFn: () => api.get<Artist[]>("/artists"),
  });

export const useAlbumIndex = () =>
  useQuery({
    queryKey: ["albums", "index"],
    queryFn: () => api.get<AlbumIndex[]>("/albums"),
  });

// ─── Movie hooks ───────────────────────────────────────────────────────────

export const useMovieGenres = () =>
  useQuery({
    queryKey: ["movie-genres"],
    queryFn: () => api.get<MovieGenre[]>("/movie-genres"),
  });

export const useMovieIndex = () =>
  useQuery({
    queryKey: ["movies", "index"],
    queryFn: () => api.get<MovieIndex[]>("/movies"),
  });

export const useMoviesRanked = () =>
  useQuery({
    queryKey: ["movies", "ranked"],
    queryFn: () => api.get<Movie[]>("/movies/ranked"),
  });

export const usePeople = () =>
  useQuery({
    queryKey: ["people"],
    queryFn: () => api.get<Person[]>("/persons"),
  });

/** Prefetch music data into the cache on music section mount. */
export function usePrefetchAll() {
  const qc = useQueryClient();
  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["artists"],         queryFn: () => api.get<Artist[]>("/artists") });
    qc.prefetchQuery({ queryKey: ["albums", "index"], queryFn: () => api.get<AlbumIndex[]>("/albums") });
    qc.prefetchQuery({ queryKey: ["genres"],          queryFn: () => api.get<Genre[]>("/genres") });
  }, [qc]);
}

/** Prefetch people data into the cache on people section mount. */
export function usePrefetchPeople() {
  const qc = useQueryClient();
  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["people"], queryFn: () => api.get<Person[]>("/persons") });
  }, [qc]);
}

/** Prefetch movie data into the cache on movies section mount. */
export function usePrefetchMovies() {
  const qc = useQueryClient();
  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["movies", "index"],  queryFn: () => api.get<MovieIndex[]>("/movies") });
    qc.prefetchQuery({ queryKey: ["movies", "ranked"], queryFn: () => api.get<Movie[]>("/movies/ranked") });
    qc.prefetchQuery({ queryKey: ["movie-genres"],     queryFn: () => api.get<MovieGenre[]>("/movie-genres") });
    qc.prefetchQuery({ queryKey: ["people"],           queryFn: () => api.get<Person[]>("/persons") });
  }, [qc]);
}
