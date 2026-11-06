import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { Spinner } from "./Spinner";

interface JobState { status: string; processed: number; total: number; result: { filled: number } | null; error: string | null }

/** Queues a job that fetches the synopsis and poster/cover of every title
 * that has a TMDB/IGDB id but no artwork yet (a scan stores the ids). */
export function ArtworkBackfillButton() {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<number | null>(null);
  const start = useMutation({
    mutationFn: () => api.post<{ job_id: number; missing: number }>(`${base}/metadata/backfill`),
    meta: { invalidates: false },
    onSuccess: (r) => {
      if (r.missing === 0) toast("Every title with a TMDB or IGDB id already has its artwork.");
      else { setJobId(r.job_id); toast(`Fetching artwork for ${r.missing} titles…`); }
    },
  });
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<JobState>(`/jobs/${jobId}`),
    enabled: jobId !== null,
    refetchInterval: (q) => (["done", "error", "cancelled"].includes(q.state.data?.status ?? "") ? false : 1500),
  });
  const status = job.data?.status;
  useEffect(() => {
    if (status === "done") {
      toast.success(`Artwork added to ${job.data?.result?.filled ?? 0} titles`);
      void qc.invalidateQueries({ queryKey: ["g", guildId] });
    }
    if (status === "error") toast.error(`Fetching artwork failed: ${job.data?.error}`);
    if (status && ["done", "error", "cancelled"].includes(status)) setJobId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const running = jobId !== null;
  return (
    <Button variant="outline" disabled={start.isPending || running} onClick={() => start.mutate()}
            title="Fetch the synopsis and poster of every title the scan or an import linked to TMDB/IGDB">
      {start.isPending || running ? <Spinner size="sm" /> : <ImageDown />}
      {running && job.data?.total ? `Artwork ${job.data.processed}/${job.data.total}` : "Fetch missing artwork"}
    </Button>
  );
}
