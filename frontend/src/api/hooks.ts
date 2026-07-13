import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./client";
import type {
  AlbumIndex,
  Artist,
  Genre,
  Movie,
  MovieGenre,
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
