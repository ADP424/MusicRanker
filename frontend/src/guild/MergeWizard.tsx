import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { ak, gk } from "../api/keys";
import { BusyButton, LoadingState, Spinner } from "../components/Spinner";
import { useGuild, useGuilds } from "./GuildProvider";

type Action = "duplicate" | "merge" | "skip";
interface Candidate { target_id: number; name: string; name_en: string | null; match: "verified" | "name_only"; evidence: string }
interface Item { source_id: number; name: string; name_en: string | null; year: number | null; subtitle: string; candidates: Candidate[]; default_action: Action; default_target_id: number | null }
type Decisions = Record<string, Record<number, { action: Action; target_id: number | null }>>;
interface JobState { status: string; phase: string; processed: number; total: number; queue_position: number; error?: string | null }

const SECTIONS = ["genres", "platforms", "people", "artists", "albums", "movies", "games", "television_shows"] as const;
const FINISHED = ["done", "error", "cancelled"];

export function MergeWizard() {
  const guild = useGuild();
  const qc = useQueryClient();
  const { data: guilds = [], isLoading: guildsLoading } = useGuilds();
  const sources = guilds.filter((g) => g.role === "owner" && g.id !== guild.id);
  const [source, setSource] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [jobId, setJobId] = useState<number | null>(null);

  const preview = useQuery({
    queryKey: ["merge-preview", guild.id, source],
    enabled: source !== null,
    queryFn: async () => {
      const data = await api.post<{ already_merged: boolean; sections: Record<string, Item[]> }>(
        `/guilds/${guild.id}/merges/preview`, { source_guild_id: source },
      );
      const seed: Decisions = {};
      for (const s of SECTIONS) {
        seed[s] = {};
        for (const it of data.sections[s] ?? [])
          seed[s][it.source_id] = { action: it.default_action, target_id: it.default_target_id };
      }
      setDecisions(seed);
      return data;
    },
  });

  const set = (section: string, id: number, action: Action, target_id: number | null = null) =>
    setDecisions((prev) => ({ ...prev, [section]: { ...prev[section], [id]: { action, target_id } } }));

  const start = useMutation({
    mutationFn: () =>
      api.post<{ job_id: number; queue_position: number }>(`/guilds/${guild.id}/merges`, {
        source_guild_id: source, decisions, copy_my_ranking: true,
      }),
    onSuccess: (r) => setJobId(r.job_id),
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
      <section className="rank-page">
        <Link to="." className="back-link">← {guild.name}</Link>
        {!j ? (
          <LoadingState label="Starting merge…" />
        ) : j.status === "done" ? (
          <>
            <h1>Merge complete</h1>
            <p className="meta">{j.processed} / {j.total} entries processed.</p>
            <p><Link to="..">Back to {guild.name} →</Link></p>
          </>
        ) : j.status === "error" ? (
          <>
            <h1>Merge failed</h1>
            <p className="err">{j.error ?? "The merge job reported an error."}</p>
          </>
        ) : j.status === "cancelled" ? (
          <h1>Merge cancelled</h1>
        ) : (
          <>
            <h1 className="inline"><Spinner /> Merging…</h1>
            <p className="meta">
              {j.status === "pending"
                ? `Queued — ${j.queue_position} job(s) ahead of you`
                : `${j.phase} · ${j.processed}/${j.total}`}
            </p>
            <progress value={j.processed} max={Math.max(j.total, 1)} />
          </>
        )}
      </section>
    );
  }

  return (
    <section>
      <Link to="." className="back-link">← {guild.name}</Link>
      <h1>Merge a guild into {guild.name}</h1>
      {guildsLoading ? (
        <LoadingState compact label="Loading your guilds…" />
      ) : (
        <select value={source ?? ""} disabled={start.isPending} onChange={(e) => setSource(Number(e.target.value) || null)}>
          <option value="">Choose a guild you own…</option>
          {sources.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      {source !== null && preview.isLoading && <LoadingState label="Comparing the two catalogs…" />}
      {preview.isError && <p className="err">{(preview.error as Error).message}</p>}
      {start.isError && <p className="err">{(start.error as Error).message}</p>}
      {preview.data?.already_merged && (
        <div className="cycle-warning">
          ⚠ You have merged this guild in before. Merging again will re-evaluate every entry;
          anything you choose to <em>duplicate</em> will become a second copy.
        </div>
      )}
      {preview.data && SECTIONS.map((s) => {
        const items = preview.data.sections[s] ?? [];
        if (!items.length) return null;
        return (
          <fieldset key={s} disabled={start.isPending}>
            <legend>{s.replace("_", " ")} ({items.length})</legend>
            {items.map((it) => {
              const d = decisions[s]?.[it.source_id];
              return (
                <div key={it.source_id} className="tip-row">
                  <div className="tip-body">
                    <div className="tip-main">
                      <strong className="tip-name">{it.name}{it.name_en && ` (${it.name_en})`}</strong>
                      <span className="tip-desc">{it.subtitle}</span>
                      <select value={d?.action} onChange={(e) => set(s, it.source_id, e.target.value as Action, d?.target_id ?? null)}>
                        <option value="duplicate">Create new</option>
                        <option value="merge" disabled={!it.candidates.length}>Use existing</option>
                        <option value="skip">Skip</option>
                      </select>
                    </div>
                    {d?.action === "merge" && it.candidates.map((c) => (
                      <label key={c.target_id} className="tip-conflict-option">
                        <input type="radio" name={`${s}-${it.source_id}`} checked={d.target_id === c.target_id}
                               onChange={() => set(s, it.source_id, "merge", c.target_id)} />
                        <strong>{c.name}</strong> (#{c.target_id})
                        <span className={c.match === "verified" ? "tip-match tip-match--ok" : "tip-match tip-match--warn"}>
                          {c.match === "verified" ? "✓ verified" : "~ name only"} — {c.evidence}
                        </span>
                      </label>
                    ))}
                    {d?.action === "duplicate" && it.candidates.length > 0 && (
                      <p className="tip-warn">⚠ Conflicts with {it.candidates.length} existing entry — a second, separate entry will be created.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </fieldset>
        );
      })}
      {preview.data && (
        <footer className="tip-footer">
          <span className="meta">{counts.duplicate} new · {counts.merge} reused · {counts.skip} skipped</span>
          <BusyButton className="tip-primary" busy={start.isPending} busyLabel="Starting merge…" onClick={() => start.mutate()}>
            Start merge
          </BusyButton>
        </footer>
      )}
    </section>
  );
}
