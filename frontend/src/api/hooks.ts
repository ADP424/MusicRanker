import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./client";
import type {
  AlbumIndex,
  Artist,
  Comparison,
  ComparisonIn,
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
  TelevisionEpisodeIndex,
  TelevisionShow,
  TelevisionShowIndex,
  TmdbImportIn,
  TmdbImportResult,
  TmdbLookup,
  TmdbTvEpisodeImportIn,
  TmdbTvEpisodeImportResult,
  TmdbTvEpisodeLookup,
  TmdbTvEpisodeLookupBody,
  TmdbTvImportIn,
  TmdbTvImportResult,
  TmdbTvLookup,
  TmdbTvLookupIn,
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
    mutationFn: ({ id, ...body }: {
      id: number; is_music?: boolean; is_movie?: boolean; is_game?: boolean; is_television?: boolean;
    }) => api.patch<Genre>(`/genres/${id}/media-types`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["genres"] });
      qc.invalidateQueries({ queryKey: ["movie-genres"] });
      qc.invalidateQueries({ queryKey: ["game-genres"] });
      qc.invalidateQueries({ queryKey: ["television-genres"] });
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

// ─── Television hooks ──────────────────────────────────────────────────────

export const useTelevisionGenres = () =>
  useQuery({
    queryKey: ["television-genres"],
    queryFn: () => api.get<Genre[]>("/television-genres"),
  });

export const useTelevisionGenreCategories = () =>
  useQuery({
    queryKey: ["television-genres", "categories"],
    queryFn: () => api.get<GenreCategory[]>("/television-genres/categories"),
  });

export const useTelevisionIndex = () =>
  useQuery({
    queryKey: ["television", "index"],
    queryFn: () => api.get<TelevisionShowIndex[]>("/television/shows"),
  });

export const useTelevisionEpisodeIndex = () =>
  useQuery({
    queryKey: ["television", "episodes", "index"],
    queryFn: () => api.get<TelevisionEpisodeIndex[]>("/television/episodes"),
  });

export const useTelevisionShowsRanked = () =>
  useQuery({
    queryKey: ["television", "ranked"],
    queryFn: () => api.get<TelevisionShow[]>("/television/shows/ranked"),
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

/** Prefetch television data into the cache on television section mount. */
export function usePrefetchTelevision() {
  const qc = useQueryClient();
  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["television", "index"],  queryFn: () => api.get<TelevisionShowIndex[]>("/television/shows") });
    qc.prefetchQuery({ queryKey: ["television", "ranked"], queryFn: () => api.get<TelevisionShow[]>("/television/shows/ranked") });
    qc.prefetchQuery({ queryKey: ["television-genres"],    queryFn: () => api.get<Genre[]>("/television-genres") });
    qc.prefetchQuery({ queryKey: ["albums", "index"],       queryFn: () => api.get<AlbumIndex[]>("/albums") });
    qc.prefetchQuery({ queryKey: ["people"],                queryFn: () => api.get<Person[]>("/persons") });
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

// ─── TMDB television import ─────────────────────────────────────────────────

export const useTmdbTvLookup = () =>
  useMutation({
    mutationFn: (body: TmdbTvLookupIn) =>
      api.post<TmdbTvLookup>("/television/tmdb-import/lookup", body),
  });

export const useTmdbTvImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TmdbTvImportIn) =>
      api.post<TmdbTvImportResult>("/television/tmdb-import", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["television"] });
      qc.invalidateQueries({ queryKey: ["people"] });
    },
  });
};

export const useTmdbTvEpisodeLookup = () =>
  useMutation({
    mutationFn: (body: TmdbTvEpisodeLookupBody) =>
      api.post<TmdbTvEpisodeLookup>("/television/tmdb-import/episode-lookup", body),
  });

export const useTmdbTvEpisodeImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TmdbTvEpisodeImportIn) =>
      api.post<TmdbTvEpisodeImportResult>("/television/tmdb-import/episode", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["television"] });
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

// ─── Bulk reorder (pairwise ranking tabs) ──────────────────────────────────
// Each takes the complete new order (ids, best first) and rewrites ranks 1..n
// server-side in one round trip.

export const useReorderArtists = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put<void>("/artists/reorder", { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["artists"] }),
  });
};

export const useReorderArtistAlbums = (artistId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put<void>(`/artists/${artistId}/albums/reorder`, { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artists", artistId, "albums"] });
      qc.invalidateQueries({ queryKey: ["albums", "index"] });
    },
  });
};

export const useReorderMovies = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put<void>("/movies/reorder", { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["movies"] }),
  });
};

export const useReorderGames = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put<void>("/games/reorder", { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["games"] }),
  });
};

export const useReorderTelevisionShows = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put<void>("/television/shows/reorder", { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["television"] }),
  });
};

export const useReorderTelevisionEpisodes = (showId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put<void>(`/television/shows/${showId}/episodes/reorder`, { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["television", "shows", showId] });
      qc.invalidateQueries({ queryKey: ["television", "ranked"] });
    },
  });
};

// ─── Stored pairwise comparisons ───────────────────────────────────────────

export interface ComparisonEndpoint {
  base: string;
  queryKey: readonly unknown[];
}

/**
 * Query keys are prefixed with the list's own key, so every existing
 * `invalidateQueries(["movies"])` / `(["artists", id, "albums"])` call already
 * refreshes the answers when entries are added or deleted.
 */
export const COMPARISONS = {
  artists: { base: "/artists/comparisons", queryKey: ["artists", "comparisons"] } as ComparisonEndpoint,
  movies: { base: "/movies/comparisons", queryKey: ["movies", "comparisons"] } as ComparisonEndpoint,
  games: { base: "/games/comparisons", queryKey: ["games", "comparisons"] } as ComparisonEndpoint,
  televisionShows: {
    base: "/television/shows/comparisons",
    queryKey: ["television", "shows", "comparisons"],
  } as ComparisonEndpoint,
  artistAlbums: (artistId: number): ComparisonEndpoint => ({
    base: `/artists/${artistId}/albums/comparisons`,
    queryKey: ["artists", artistId, "albums", "comparisons"],
  }),
  televisionEpisodes: (showId: number): ComparisonEndpoint => ({
    base: `/television/shows/${showId}/episodes/comparisons`,
    queryKey: ["television", "shows", showId, "episodes", "comparisons"],
  }),
};

const samePair = (x: ComparisonIn, y: ComparisonIn) =>
  (x.winner_id === y.winner_id && x.loser_id === y.loser_id) ||
  (x.winner_id === y.loser_id && x.loser_id === y.winner_id);

export const useComparisons = (ep: ComparisonEndpoint) =>
  useQuery({
    queryKey: ep.queryKey,
    queryFn: () => api.get<Comparison[]>(ep.base),
  });

/** Optimistic so answering feels instant; the server is the source of truth. */
export function useComparisonMutations(ep: ComparisonEndpoint) {
  const qc = useQueryClient();
  const snapshot = async () => {
    await qc.cancelQueries({ queryKey: ep.queryKey });
    return qc.getQueryData<Comparison[]>(ep.queryKey) ?? [];
  };
  const rollback = (_e: unknown, _v: unknown, ctx: { prev: Comparison[] } | undefined) =>
    qc.setQueryData(ep.queryKey, ctx?.prev);
  const settle = () => qc.invalidateQueries({ queryKey: ep.queryKey });

  const upsert = useMutation({
    mutationFn: (c: ComparisonIn) => api.put<Comparison>(ep.base, c),
    onMutate: async (c) => {
      const prev = await snapshot();
      qc.setQueryData<Comparison[]>(ep.queryKey, [
        ...prev.filter((x) => !samePair(x, c)),
        { ...c, created_at: new Date().toISOString() },
      ]);
      return { prev };
    },
    onError: rollback,
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: ({ a, b }: { a: number; b: number }) => api.delete(`${ep.base}/${a}/${b}`),
    onMutate: async ({ a, b }) => {
      const prev = await snapshot();
      qc.setQueryData<Comparison[]>(
        ep.queryKey,
        prev.filter((x) => !samePair(x, { winner_id: a, loser_id: b })),
      );
      return { prev };
    },
    onError: rollback,
    onSettled: settle,
  });

  const clear = useMutation({
    mutationFn: () => api.delete(ep.base),
    onMutate: async () => {
      const prev = await snapshot();
      qc.setQueryData<Comparison[]>(ep.queryKey, []);
      return { prev };
    },
    onError: rollback,
    onSettled: settle,
  });

  return { upsert, remove, clear };
}
