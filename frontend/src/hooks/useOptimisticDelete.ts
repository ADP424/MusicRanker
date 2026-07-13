import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";

interface HasId { id: number }

/**
 * Delete mutation with optimistic cache removal + rollback on error, shared by
 * the list pages.
 *
 * `queryKey` is the cache entry holding the array to remove from optimistically.
 * `invalidateKeys` are the query keys refetched on settle; defaults to
 * `[queryKey]`. Pass extra keys when a delete affects more than one cached list
 * (e.g. movies invalidate both "ranked" and "index").
 */
export function useOptimisticDelete<T extends HasId>(opts: {
  queryKey: unknown[];
  endpoint: (id: number) => string;
  invalidateKeys?: unknown[][];
}) {
  const { queryKey, endpoint, invalidateKeys = [opts.queryKey] } = opts;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(endpoint(id)),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<T[]>(queryKey);
      qc.setQueryData<T[]>(queryKey, (old = []) => old.filter((it) => it.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => qc.setQueryData(queryKey, ctx?.prev),
    onSettled: () => {
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
    },
  });
}
