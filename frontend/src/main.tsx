import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { ThemeProvider } from "./theme";
import { ApiError } from "./api/client";
import "./index.css";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** false: this mutation changes no server data (a lookup), so don't refresh anything. */
      invalidates?: boolean;
      /** false: the component shows this mutation's error itself; no toast. */
      errorToast?: boolean;
    };
  }
}

/**
 * Freshness is a rule, not a per-mutation chore: after *any* mutation settles,
 * every guild-scoped query is invalidated (mounted ones refetch now, the rest
 * when next shown). The mutation stays pending until that refetch lands, so a
 * "Saving…" state never clears onto stale data. `cancelRefetch: false` reuses
 * refetches a hook's own invalidation already started, instead of doubling them.
 *
 * Queries also go stale after 30s and refetch on window focus, so other
 * members' edits show up without a reload.
 */
const qc: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      // A 4xx won't change on retry (and made "not found" pages spin for ~7s).
      retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 1,
    },
  },
  mutationCache: new MutationCache({
    onSettled: (_data, _error, _vars, _ctx, mutation) => {
      if (mutation.meta?.invalidates === false) return;
      return Promise.all([
        qc.invalidateQueries({ queryKey: ["g"] }, { cancelRefetch: false }),
        qc.invalidateQueries({ queryKey: ["auth", "guilds"] }, { cancelRefetch: false }),
      ]);
    },
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.errorToast === false) return;
      if (error instanceof ApiError && error.status === 401) return; // AuthProvider handles it
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    },
  }),
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <TooltipProvider delayDuration={300}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </TooltipProvider>
        <Toaster richColors closeButton position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
