import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./client";
import type { AlbumIndex, Artist, Genre } from "./types";

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

/** Prefetch artists, albums index, and genres into the cache on app mount. */
export function usePrefetchAll() {
  const qc = useQueryClient();
  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["artists"],       queryFn: () => api.get<Artist[]>("/artists") });
    qc.prefetchQuery({ queryKey: ["albums", "index"], queryFn: () => api.get<AlbumIndex[]>("/albums") });
    qc.prefetchQuery({ queryKey: ["genres"],         queryFn: () => api.get<Genre[]>("/genres") });
  }, [qc]);
}
