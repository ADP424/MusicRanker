import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, GitMerge } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../api/client";
import { ak, gk } from "../api/keys";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoadingState, Spinner } from "../components/Spinner";
import { useGuild, useGuilds } from "./GuildProvider";

type Action = "duplicate" | "merge" | "skip";
interface Candidate { target_id: number; name: string; name_en: string | null; match: "verified" | "name_only"; evidence: string }
interface Item { source_id: number; name: string; name_en: string | null; year: number | null; subtitle: string; candidates: Candidate[]; default_action: Action; default_target_id: number | null }
type Decisions = Record<string, Record<number, { action: Action; target_id: number | null }>>;
interface JobState { status: string; phase: string; processed: number; total: number; queue_position: number; error?: string | null }

const SECTIONS = [
  "genres", "platforms", "people", "artists", "albums", "books", "movies", "games", "television_shows",
] as const;
const SECTION_LABEL: Record<(typeof SECTIONS)[number], string> = {
  genres: "Genres", platforms: "Platforms", people: "People", artists: "Artists", albums: "Albums",
  books: "Books", movies: "Movies", games: "Games", television_shows: "TV shows",
};
const FINISHED = ["done", "error", "cancelled"];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function MergeWizard() {
  const guild = useGuild();
  const qc = useQueryClient();
  const { data: guilds = [], isLoading: guildsLoading } = useGuilds();
  const sources = guilds.filter((g) => g.role === "owner" && g.id !== guild.id);
  const [source, setSource] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [copyRanking, setCopyRanking] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const sourceName = sources.find((g) => g.id === source)?.name ?? "that guild";

  const preview = useQuery({
    queryKey: gk(guild.id, "merge-preview", source),
    enabled: source !== null,
    queryFn: () =>
      api.post<{ already_merged: boolean; sections: Record<string, Item[]> }>(
        `/guilds/${guild.id}/merges/preview`, { source_guild_id: source },
      ),
  });

  // Seed decisions from whichever source's preview is showing. Doing this in the
  // queryFn instead would skip it when switching back to a cached source, and
  // submit the other source's decisions under this one.
  useEffect(() => {
    const seed: Decisions = {};
    if (preview.data) {
      for (const s of SECTIONS) {
        seed[s] = {};
        for (const it of preview.data.sections[s] ?? [])
          seed[s][it.source_id] = { action: it.default_action, target_id: it.default_target_id };
      }
    }
    setDecisions(seed);
  }, [preview.data]);

  const set = (section: string, id: number, action: Action, target_id: number | null = null) =>
    setDecisions((prev) => ({ ...prev, [section]: { ...prev[section], [id]: { action, target_id } } }));

  const start = useMutation({
    mutationFn: () =>
      api.post<{ job_id: number; queue_position: number }>(`/guilds/${guild.id}/merges`, {
        source_guild_id: source, decisions, copy_my_ranking: copyRanking,
      }),
    onSuccess: (r) => { setConfirming(false); setJobId(r.job_id); },
  });

  const job = useQuery({
    queryKey: ["job", jobId],
    enabled: jobId !== null,
    queryFn: () => api.get<JobState>(`/jobs/${jobId}`),
    refetchInterval: (q) => (FINISHED.includes(q.state.data?.status ?? "") ? false : 1000),
  });

  // Once the merge lands, everything cached for this guild is stale.
  const finishedStatus = job.data && FINISHED.includes(job.data.status) ? job.data.status : null;
  useEffect(() => {
    if (finishedStatus === "done") {
      qc.invalidateQueries({ queryKey: gk(guild.id) });
      qc.invalidateQueries({ queryKey: ak("guilds") });
    }
  }, [finishedStatus, guild.id, qc]);

  const counts = useMemo(() => {
    const n = { duplicate: 0, merge: 0, skip: 0 };
    for (const s of SECTIONS) for (const d of Object.values(decisions[s] ?? {})) n[d.action]++;
    return n;
  }, [decisions]);

  if (jobId !== null) {
    const j = job.data;
    return (
      <Card className="max-w-xl">
        <CardContent className="grid gap-3 py-6">
          {!j ? (
            <LoadingState label="Starting merge…" />
          ) : j.status === "done" ? (
            <>
              <h1 className="flex items-center gap-2"><CheckCircle2 className="text-success" /> Merge complete</h1>
              <p className="text-sm text-muted-foreground">{j.processed} of {j.total} entries processed.</p>
              <Button asChild className="w-fit"><Link to={`/g/${guild.id}`}>Back to {guild.name}</Link></Button>
            </>
          ) : j.status === "error" ? (
            <>
              <h1>Merge failed</h1>
              <p className="text-sm text-destructive">{j.error ?? "The merge job reported an error."} Nothing was changed.</p>
            </>
          ) : j.status === "cancelled" ? (
            <h1>Merge cancelled</h1>
          ) : (
            <>
              <h1 className="flex items-center gap-2"><Spinner /> Merging…</h1>
              <p className="text-sm text-muted-foreground">
                {j.status === "pending"
                  ? `Queued: ${plural(j.queue_position, "job")} ahead of you`
                  : `${j.phase} · ${j.processed}/${j.total}`}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-[width]"
                     style={{ width: `${j.total ? (100 * j.processed) / j.total : 0}%` }} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 pb-24">
      <div>
        <h1>Merge a guild into {guild.name}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Copies another guild you own into this one. For each entry, choose whether to create it here, reuse a
          matching entry that's already here, or skip it. The other guild isn't changed.
        </p>
      </div>

      {guildsLoading ? (
        <Skeleton className="h-9 w-72" />
      ) : sources.length === 0 ? (
        <Card className="max-w-xl">
          <CardContent className="py-6 text-sm text-muted-foreground">
            You don't own any other guild to merge in. Only guilds you own can be merged into another one.
          </CardContent>
        </Card>
      ) : (
        <select aria-label="Guild to merge in" className="h-9 w-72 rounded-md border bg-background px-2 text-sm"
                value={source ?? ""} disabled={start.isPending} onChange={(e) => setSource(Number(e.target.value) || null)}>
          <option value="">Choose a guild you own…</option>
          {sources.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}

      {source !== null && preview.isLoading && <LoadingState label="Comparing the two catalogs…" />}
      {preview.isError && <p className="text-sm text-destructive">{(preview.error as Error).message}</p>}
      {preview.data?.already_merged && (
        <p className="flex max-w-2xl items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          You've merged this guild in before. Merging again re-evaluates every entry; anything you choose to
          create again becomes a second copy.
        </p>
      )}

      {preview.data && SECTIONS.map((s) => {
        const items = preview.data.sections[s] ?? [];
        if (!items.length) return null;
        return (
          <section key={s} className="grid gap-2">
            <h2>{SECTION_LABEL[s]} <span className="font-normal text-muted-foreground">({items.length})</span></h2>
            <Card className="gap-0 py-0">
              {items.map((it) => {
                const d = decisions[s]?.[it.source_id];
                return (
                  <div key={it.source_id} className="grid gap-2 border-b px-4 py-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{it.name}{it.name_en && <span className="font-normal text-muted-foreground"> ({it.name_en})</span>}</p>
                        <p className="truncate text-xs text-muted-foreground">{it.subtitle}</p>
                      </div>
                      <select aria-label={`What to do with ${it.name}`} disabled={start.isPending}
                              className="h-8 rounded-md border bg-background px-2 text-sm" value={d?.action}
                              onChange={(e) => set(s, it.source_id, e.target.value as Action,
                                e.target.value === "merge" ? d?.target_id ?? it.candidates[0]?.target_id ?? null : null)}>
                        <option value="duplicate">Create new</option>
                        <option value="merge" disabled={!it.candidates.length}>Use existing</option>
                        <option value="skip">Skip</option>
                      </select>
                    </div>
                    {d?.action === "merge" && it.candidates.map((c) => (
                      <label key={c.target_id} className="flex cursor-pointer items-center gap-2 pl-2 text-sm">
                        <input type="radio" name={`${s}-${it.source_id}`} checked={d.target_id === c.target_id}
                               onChange={() => set(s, it.source_id, "merge", c.target_id)} />
                        <span className="font-medium">{c.name}</span>
                        <Badge variant="outline" className={c.match === "verified" ? "text-success" : "text-warning"}>
                          {c.match === "verified" ? "verified" : "name only"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{c.evidence}</span>
                      </label>
                    ))}
                    {d?.action === "duplicate" && it.candidates.length > 0 && (
                      <p className="pl-2 text-xs text-warning">
                        Looks like {plural(it.candidates.length, "existing entry")}; creating it makes a separate second entry.
                      </p>
                    )}
                  </div>
                );
              })}
            </Card>
          </section>
        );
      })}

      {preview.data && (
        <footer className="fixed right-0 bottom-0 left-0 z-20 border-t bg-background/95 backdrop-blur md:left-64">
          <div className="flex flex-wrap items-center gap-4 px-4 py-3 md:px-8">
            <span className="text-sm text-muted-foreground">
              {counts.duplicate} new · {counts.merge} reused · {counts.skip} skipped
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={copyRanking} onCheckedChange={(v) => setCopyRanking(v === true)} />
              Copy my ranking from {sourceName}
            </label>
            <Button className="ml-auto" disabled={start.isPending} onClick={() => setConfirming(true)}>
              <GitMerge /> Start merge
            </Button>
          </div>
        </footer>
      )}

      {confirming && (
        <ConfirmDialog
          tone="default"
          title={`Merge ${sourceName} into ${guild.name}?`}
          message={`${counts.duplicate} entries will be created and ${counts.merge} matched to existing ones here; ${counts.skip} are skipped.${
            copyRanking ? ` Your ranking from ${sourceName} is copied in too.` : ""} This can't be undone automatically.`}
          confirmLabel="Start merge"
          busy={start.isPending}
          onConfirm={() => start.mutate()}
          onCancel={() => setConfirming(false)}
        />
      )}
      {start.isError && <p className="text-sm text-destructive">{(start.error as Error).message}</p>}
    </div>
  );
}
