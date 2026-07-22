import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./client";
import type {
  AlbumIndex,
  Artist,
  Game,
  GameIndex,
  GamePlatform,
  Genre,
  GenreCategory,
  IgdbImportIn,
  IgdbImportResult,
  IgdbLookup,
  Movie,
  MovieIndex,
  Person,
  ScanApply,
  ScanApplyResult,
  ScanJob,
  ScanResults,
  SuppressionList,
  TmdbImportIn,
  TmdbImportResult,
  TmdbLookup,
} from "./types";

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

export const useGenreCategories = () =>
  useQuery({
    queryKey: ["genres", "categories"],
    queryFn: () => api.get<GenreCategory[]>("/genres/categories"),
  });

/** Cross-domain: toggle which media types a genre applies to. */
export const useUpdateGenreMediaTypes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; is_music?: boolean; is_movie?: boolean; is_game?: boolean }) =>
      api.patch<Genre>(`/genres/${id}/media-types`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["genres"] });
      qc.invalidateQueries({ queryKey: ["movie-genres"] });
      qc.invalidateQueries({ queryKey: ["game-genres"] });
    },
  });
};

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
    queryFn: () => api.get<Genre[]>("/movie-genres"),
  });

export const useMovieGenreCategories = () =>
  useQuery({
    queryKey: ["movie-genres", "categories"],
    queryFn: () => api.get<GenreCategory[]>("/movie-genres/categories"),
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

// ─── Game hooks ────────────────────────────────────────────────────────────

export const useGameGenres = () =>
  useQuery({
    queryKey: ["game-genres"],
    queryFn: () => api.get<Genre[]>("/game-genres"),
  });

export const useGameGenreCategories = () =>
  useQuery({
    queryKey: ["game-genres", "categories"],
    queryFn: () => api.get<GenreCategory[]>("/game-genres/categories"),
  });

export const useGamePlatforms = () =>
  useQuery({
    queryKey: ["game-platforms"],
    queryFn: () => api.get<GamePlatform[]>("/game-platforms"),
  });

export const useGamePlatformCategories = () =>
  useQuery({
    queryKey: ["game-platforms", "categories"],
    queryFn: () => api.get<GenreCategory[]>("/game-platforms/categories"),
  });

export const useGameIndex = () =>
  useQuery({
    queryKey: ["games", "index"],
    queryFn: () => api.get<GameIndex[]>("/games"),
  });

export const useGamesRanked = () =>
  useQuery({
    queryKey: ["games", "ranked"],
    queryFn: () => api.get<Game[]>("/games/ranked"),
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
    qc.prefetchQuery({ queryKey: ["movie-genres"],     queryFn: () => api.get<Genre[]>("/movie-genres") });
    qc.prefetchQuery({ queryKey: ["people"],           queryFn: () => api.get<Person[]>("/persons") });
  }, [qc]);
}

/** Prefetch game data into the cache on games section mount. */
export function usePrefetchGames() {
  const qc = useQueryClient();
  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["games", "index"],  queryFn: () => api.get<GameIndex[]>("/games") });
    qc.prefetchQuery({ queryKey: ["games", "ranked"], queryFn: () => api.get<Game[]>("/games/ranked") });
    qc.prefetchQuery({ queryKey: ["game-genres"],     queryFn: () => api.get<Genre[]>("/game-genres") });
    qc.prefetchQuery({ queryKey: ["game-platforms"],  queryFn: () => api.get<GamePlatform[]>("/game-platforms") });
    qc.prefetchQuery({ queryKey: ["people"],          queryFn: () => api.get<Person[]>("/persons") });
  }, [qc]);
}

// ─── TMDB movie/person link scan ───────────────────────────────────────────

const SCAN = "/movie-person-scan";

export const useScanJobs = () =>
  useQuery({ queryKey: ["scan", "jobs"], queryFn: () => api.get<ScanJob[]>(`${SCAN}/jobs`) });

export const useScanJob = (jobId: string | null) =>
  useQuery({
    queryKey: ["scan", "job", jobId],
    queryFn: () => api.get<ScanJob>(`${SCAN}/jobs/${jobId}`),
    enabled: !!jobId,
    retry: false, // an evicted job 404s; surface it instead of retrying
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "running" || s === "pending" ? 1000 : false;
    },
  });

export const useScanResults = (jobId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ["scan", "results", jobId],
    queryFn: () => api.get<ScanResults>(`${SCAN}/jobs/${jobId}/results`),
    enabled: enabled && !!jobId,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });

export const useStartScan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { movie_ids?: number[]; force_refresh?: boolean }) =>
      api.post<ScanJob>(`${SCAN}/jobs`, body),
    onSuccess: (job) => {
      qc.setQueryData(["scan", "job", job.id], job);
      qc.invalidateQueries({ queryKey: ["scan", "jobs"] });
    },
  });
};

export const useCancelScan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post<void>(`${SCAN}/jobs/${jobId}/cancel`, {}),
    onSettled: (_d, _e, jobId) => qc.invalidateQueries({ queryKey: ["scan", "job", jobId] }),
  });
};

export const useDeleteScanJob = () => {
  const qc = useQueryClient();
  return useMutation({
    // Idempotent: discarding an already-evicted job must not error.
    mutationFn: (jobId: string) =>
      api.delete(`${SCAN}/jobs/${jobId}`).catch(() => undefined),
    onSettled: (_d, _e, jobId) => {
      qc.removeQueries({ queryKey: ["scan", "job", jobId] });
      qc.removeQueries({ queryKey: ["scan", "results", jobId] });
      qc.invalidateQueries({ queryKey: ["scan", "jobs"] });
    },
  });
};

export const useApplyScan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScanApply) => api.post<ScanApplyResult>(`${SCAN}/apply`, body),
    onSuccess: () => {
      // Links changed: every movie/person view is now stale. Both prefixes
      // are plural ("movies"/"people") to match this file's own query keys.
      qc.invalidateQueries({ queryKey: ["movies"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["scan", "suppressions"] });
    },
  });
};

export const useSuppressions = () =>
  useQuery({
    queryKey: ["scan", "suppressions"],
    queryFn: () => api.get<SuppressionList>(`${SCAN}/suppressions`),
  });

export const useClearSuppressions = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`${SCAN}/suppressions`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scan", "suppressions"] }),
  });
};

// ─── TMDB import ────────────────────────────────────────────────────────────

export const useTmdbLookup = () =>
  useMutation({
    mutationFn: (body: { title: string; year?: number }) =>
      api.post<TmdbLookup>("/movies/tmdb-import/lookup", body),
  });

export const useTmdbImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TmdbImportIn) =>
      api.post<TmdbImportResult>("/movies/tmdb-import", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movies"] });
      qc.invalidateQueries({ queryKey: ["people"] });
    },
  });
};

// ─── IGDB import ────────────────────────────────────────────────────────────

export const useIgdbLookup = () =>
  useMutation({
    mutationFn: (body: { title: string; year?: number }) =>
      api.post<IgdbLookup>("/games/igdb-import/lookup", body),
  });

export const useIgdbImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IgdbImportIn) =>
      api.post<IgdbImportResult>("/games/igdb-import", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games"] });
      qc.invalidateQueries({ queryKey: ["people"] });
    },
  });
};
