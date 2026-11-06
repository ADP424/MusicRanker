import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Check, CircleHelp, ExternalLink, RefreshCw, Search, ShieldCheck, Trash2, X,
} from "lucide-react";
import {
  memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  useApplyPersonScan, useCancelPersonScan, useClearPersonScanSuppressions, useDeletePersonScanJob, useGuildApi,
  usePersonScanJob, usePersonScanJobs, usePersonScanResults, usePersonScanSuppressions, useStartPersonScan,
} from "../api/hooks";
import { gk } from "../api/keys";
import { CAST_ROLE_LABELS, GAME_ROLE_LABELS } from "../api/types";
import type {
  PersonScanApplyIn, PersonScanCandidate, PersonScanEntityKind, PersonScanJob, PersonScanResults, PersonScanVerdict,
} from "../api/types";
import { ArtworkBackfillButton } from "../components/ArtworkBackfillButton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoadingState, Spinner } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";

// One review flow for every person-link scan. The TMDB scan covers movies and
// the whole TV tree in one job (so identity is checked across both media); the
// IGDB scan covers games. Each is a `ScanConfig` below.

interface ScanConfig {
  path: string;                       // router prefix, also the cache-key namespace
  title: string;
  source: "TMDB" | "IGDB";
  intro: ReactNode;
  kinds: PersonScanEntityKind[];      // what candidates can link to, in filter order
  roleLabels: Record<string, string>;
  roleKeys: string[];                 // key N picks roleKeys[N-1] (when the row offers it)
  href: (guildId: number, kind: PersonScanEntityKind, id: number) => string;
  profile?: (sourceId: number) => string;
  invalidate: string[];               // catalog cache prefixes the new links show up under
}

const KIND_LABELS: Record<PersonScanEntityKind, [string, string]> = {
  movie: ["Movie", "Movies"], show: ["Show", "Shows"], season: ["Season", "Seasons"],
  episode: ["Episode", "Episodes"], game: ["Game", "Games"],
};

const domId = (k: string) => `scanrow-${k.replace(/:/g, "-")}`;

type Decision = { kind: "accept"; role: string } | { kind: "reject" };
type Decisions = Record<string, Decision | undefined>;
type VerdictFilter = "all" | "conflict" | "name_only" | "verified";
type CreditFilter = "all" | "cast" | "guest" | "crew";

const verdictOf = (c: PersonScanCandidate): Exclude<PersonScanVerdict, ""> => c.verdict || c.match;

function seedDecisions(cands: PersonScanCandidate[]): Decisions {
  const d: Decisions = {};
  for (const c of cands) {
    if (c.suppressed) d[c.key] = { kind: "reject" };
    else if (verdictOf(c) === "verified") d[c.key] = { kind: "accept", role: c.suggested_role };
    // name-only and conflicting -> undecided: they need a look
  }
  return d;
}

function creditText(c: PersonScanCandidate): string {
  if (c.credit_type === "cast" || c.credit_type === "guest") {
    const parts = [c.character || "?"];
    if (c.billing_order !== null) parts.push(`#${c.billing_order + 1}`);
    if (c.credit_type === "guest") parts.push("guest");
    return parts.join(" · ");
  }
  return c.job ?? c.slot;
}

/** "matches 4/4 linked movies · 0/3 shows", from the per-medium evidence. */
function evidenceText(c: PersonScanCandidate): string {
  const parts = (["movie", "show"] as const).flatMap((m) => {
    const e = c.evidence?.[m];
    if (!e || e[1] === 0) return [];
    return [`${e[0]}/${e[1]} linked ${m === "movie" ? "movie" : "show"}${e[1] === 1 ? "" : "s"}`];
  });
  if (parts.length) return `matches ${parts.join(" · ")}`;
  if (c.overlap > 0) return `${c.overlap} linked title${c.overlap === 1 ? "" : "s"} agree`;
  return "name only — nothing linked to check against";
}

function VerdictBadge({ c }: { c: PersonScanCandidate }) {
  const v = verdictOf(c);
  const text = evidenceText(c);
  if (v === "conflict") {
    return (
      <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning" title={text}>
        <AlertTriangle /> Conflict
      </Badge>
    );
  }
  if (v === "verified") {
    return <Badge variant="outline" className="border-success/50 bg-success/10 text-success" title={text}><ShieldCheck /> Verified</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground" title={text}><CircleHelp /> Name only</Badge>;
}

// ── Row ───────────────────────────────────────────────────────
interface RowProps {
  c: PersonScanCandidate;
  cfg: ScanConfig;
  decision: Decision | undefined;
  focused: boolean;
  showPerson: boolean;
  guildId: number;
  onAssign: (key: string, role: string) => void;
  onReject: (key: string) => void;
  onClear: (key: string) => void;
  onFocus: (key: string) => void;
}

const ScanRow = memo(function ScanRow(
  { c, cfg, decision, focused, showPerson, guildId, onAssign, onReject, onClear, onFocus }: RowProps,
) {
  const state = decision?.kind ?? "none";
  const label = (r: string) => cfg.roleLabels[r] ?? r;
  return (
    <div
      id={domId(c.key)}
      role="row"
      onMouseDown={() => onFocus(c.key)}
      className={cn(
        "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-sm last:border-b-0",
        "md:grid-cols-[1.5rem_minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1fr)_9rem_auto]",
        state === "accept" && "bg-success/5",
        state === "reject" && "bg-muted/60 text-muted-foreground",
        focused && "ring-2 ring-inset ring-ring",
      )}
    >
      <span role="gridcell" aria-label={state === "accept" ? "Accepted" : state === "reject" ? "Rejected" : "Undecided"}>
        {state === "accept" ? <Check className="size-4 text-success" /> : state === "reject" ? <X className="size-4" /> : <span className="text-muted-foreground">·</span>}
      </span>
      <span role="gridcell" className="min-w-0 truncate">
        {showPerson ? (
          <>
            <Link className="font-medium hover:underline" to={`/g/${guildId}/people/${c.person_id}`}>{c.person_name}</Link>
            <span className="ml-2 hidden md:inline"><VerdictBadge c={c} /></span>
          </>
        ) : (
          <EntityLink c={c} cfg={cfg} guildId={guildId} />
        )}
      </span>
      <span role="gridcell" className="hidden min-w-0 truncate md:block">
        {showPerson ? <EntityLink c={c} cfg={cfg} guildId={guildId} /> : <span className="text-muted-foreground">{creditText(c)}</span>}
      </span>
      <span role="gridcell" className="col-start-2 min-w-0 truncate text-xs text-muted-foreground md:col-start-auto md:text-sm">
        {showPerson ? creditText(c) : null}
        <span className="block truncate text-xs">{c.suggestion_reason}</span>
      </span>
      <span role="gridcell" className="col-start-2 md:col-start-auto">
        {c.roles.length === 1 ? (
          <span className="text-sm">{label(c.roles[0])}</span>
        ) : (
          <select
            aria-label="Role"
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={decision?.kind === "accept" ? decision.role : c.suggested_role}
            onChange={(e) => onAssign(c.key, e.target.value)}
          >
            {c.roles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        )}
      </span>
      <span role="gridcell" className="col-start-3 row-start-1 flex justify-end gap-1 md:col-start-auto md:row-start-auto">
        <Button size="icon-sm" variant={state === "accept" ? "default" : "outline"} aria-label="Accept"
                onClick={() => (state === "accept" ? onClear(c.key) : onAssign(c.key, c.suggested_role))}>
          <Check />
        </Button>
        <Button size="icon-sm" variant={state === "reject" ? "secondary" : "outline"} aria-label="Reject (remembered)"
                onClick={() => (state === "reject" ? onClear(c.key) : onReject(c.key))}>
          <X />
        </Button>
      </span>
    </div>
  );
});

function EntityLink({ c, cfg, guildId }: { c: PersonScanCandidate; cfg: ScanConfig; guildId: number }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={c.context ?? undefined}>
      {cfg.kinds.length > 1 && <Badge variant="secondary" className="shrink-0">{KIND_LABELS[c.entity_kind][0]}</Badge>}
      <Link className="truncate hover:underline" to={cfg.href(guildId, c.entity_kind, c.entity_id)}>
        {c.context ? `${c.context} · ` : ""}{c.entity_name}
        {c.entity_kind !== "episode" && c.entity_year ? ` (${c.entity_year})` : ""}
      </Link>
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────
function PersonScanPage({ cfg }: { cfg: ScanConfig }) {
  const qc = useQueryClient();
  const { guildId } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job");
  // ?scope=movie:12 (from a detail page's "Scan" button) limits the next scan.
  const scope = useMemo(() => {
    const [kind, id] = (params.get("scope") ?? "").split(":");
    return kind && Number(id) ? { kind: kind as PersonScanEntityKind, id: Number(id), name: params.get("name") } : null;
  }, [params]);
  const setParam = useCallback((key: string, value: string | null) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value === null) next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true }), [setParams]);

  const { data: jobs, isLoading: jobsLoading } = usePersonScanJobs(cfg.path);
  const jobQuery = usePersonScanJob(cfg.path, jobId);
  const job = jobQuery.data;
  const jobGone = !!jobId && jobQuery.isError;

  const busy = job?.status === "running" || job?.status === "pending";
  const done = job?.status === "done";
  const bootstrapping = (jobId !== null && jobQuery.isLoading) || (jobId === null && jobsLoading);

  const { data: results } = usePersonScanResults(cfg.path, done ? jobId : null);

  const start = useStartPersonScan(cfg.path);
  const cancel = useCancelPersonScan(cfg.path);
  const deleteJob = useDeletePersonScanJob(cfg.path);
  const apply = useApplyPersonScan(cfg.path, cfg.invalidate);
  const { data: suppressions } = usePersonScanSuppressions(cfg.path);
  const clearSuppressions = useClearPersonScanSuppressions(cfg.path);

  const [forceRefresh, setForceRefresh] = useState(false);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [query, setQuery] = useState("");
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  const [kinds, setKinds] = useState<Set<PersonScanEntityKind>>(new Set());
  const [credit, setCredit] = useState<CreditFilter>("all");
  const [grouped, setGrouped] = useState(true);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { message: string; action: () => void }>(null);

  const deferredQuery = useDeferredValue(query);
  const seeded = useRef<string | null>(null);
  const seed = useRef<Decisions>({}); // the pre-filled decisions, to tell what the user changed

  const resetLocal = useCallback(() => {
    setDecisions({});
    setFocusKey(null);
    setQuery("");
    seeded.current = null;
  }, []);

  // A discarded job 404s. Drop the stale ?job= instead of rendering nothing.
  useEffect(() => {
    if (jobGone) { setParam("job", null); resetLocal(); }
  }, [jobGone, setParam, resetLocal]);

  // Reopen the scan in flight, or else the latest finished one.
  useEffect(() => {
    if (jobId || !jobs?.length) return;
    const live = jobs.find((j) => j.status === "running" || j.status === "pending");
    const latest = live ?? jobs.find((j) => j.status === "done");
    if (latest) setParam("job", latest.id);
  }, [jobs, jobId, setParam]);

  useEffect(() => {
    if (results && seeded.current !== results.job_id) {
      seed.current = seedDecisions(results.candidates);
      setDecisions(seed.current);
      setFocusKey(null);
      seeded.current = results.job_id;
    }
  }, [results]);

  const rows = useMemo(() => {
    const all = results?.candidates ?? [];
    const q = deferredQuery.trim().toLowerCase();
    const r = all.filter((c) =>
      (showSuppressed || !c.suppressed)
      && (verdict === "all" || verdictOf(c) === verdict)
      && (kinds.size === 0 || kinds.has(c.entity_kind))
      && (credit === "all" || (credit === "crew" ? !["cast", "guest"].includes(c.credit_type) : c.credit_type === credit))
      && (!q || c.person_name.toLowerCase().includes(q) || c.entity_name.toLowerCase().includes(q)
        || (c.context ?? "").toLowerCase().includes(q)));
    // The server's order already puts what needs scrutiny first; grouping only
    // keeps each person's rows together, in the order the person first appears.
    if (!grouped) return r;
    const order = new Map<number, number>();
    r.forEach((c, i) => { if (!order.has(c.person_id)) order.set(c.person_id, i); });
    return [...r].sort((a, b) => order.get(a.person_id)! - order.get(b.person_id)!);
  }, [results, deferredQuery, showSuppressed, verdict, kinds, credit, grouped]);

  const groups = useMemo(() => {
    const out: Array<{ person: number; rows: PersonScanCandidate[] }> = [];
    for (const c of rows) {
      const last = out[out.length - 1];
      if (last?.person === c.person_id) last.rows.push(c); else out.push({ person: c.person_id, rows: [c] });
    }
    return out;
  }, [rows]);

  // Stable mutators — keeps every untouched row out of reconciliation.
  const setDec = useCallback((k: string, d: Decision | undefined) => {
    setDecisions((prev) => {
      const n = { ...prev };
      if (d) n[k] = d; else delete n[k];
      return n;
    });
  }, []);
  const assign = useCallback((k: string, role: string) => setDec(k, { kind: "accept", role }), [setDec]);
  const reject = useCallback((k: string) => setDec(k, { kind: "reject" }), [setDec]);
  const clearOne = useCallback((k: string) => setDec(k, undefined), [setDec]);
  const decideMany = (list: PersonScanCandidate[], mode: "accept" | "reject" | "clear") =>
    setDecisions((prev) => {
      const n = { ...prev };
      for (const c of list) {
        if (mode === "accept") n[c.key] = { kind: "accept", role: c.suggested_role };
        else if (mode === "reject") n[c.key] = { kind: "reject" };
        else delete n[c.key];
      }
      return n;
    });

  // Keyboard handler reads the latest state through refs, so the listener
  // is attached once rather than re-bound on every decision.
  const rowsRef = useRef(rows);
  const decRef = useRef(decisions);
  const focusRef = useRef(focusKey);
  useEffect(() => {
    rowsRef.current = rows; decRef.current = decisions; focusRef.current = focusKey;
  });

  const roleKeys = cfg.roleKeys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector("[role=alertdialog]")) return;

      const list = rowsRef.current;
      if (!list.length) return;
      let i = list.findIndex((r) => r.key === focusRef.current);
      if (i < 0) i = 0;
      const c = list[i];

      const go = (j: number) => {
        const k = list[Math.max(0, Math.min(list.length - 1, j))].key;
        setFocusKey(k);
        document.getElementById(domId(k))?.scrollIntoView({ block: "nearest" });
      };

      switch (e.key) {
        case "ArrowDown": case "j": e.preventDefault(); go(i + 1); return;
        case "ArrowUp":   case "k": e.preventDefault(); go(i - 1); return;
        case "Enter":     e.preventDefault(); assign(c.key, c.suggested_role); go(i + 1); return;
        case "s": case "S": reject(c.key); go(i + 1); return;
        case "u": case "U": clearOne(c.key); go(i + 1); return;
        case " ": {
          e.preventDefault();
          const d = decRef.current[c.key];
          if (d?.kind === "accept") clearOne(c.key); else assign(c.key, c.suggested_role);
          return;
        }
      }
      const role = /^[1-9]$/.test(e.key) ? roleKeys[Number(e.key) - 1] : undefined;
      if (role && c.roles.includes(role)) { assign(c.key, role); go(i + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assign, reject, clearOne, roleKeys]);

  const counts = useMemo(() => {
    let acc = 0, rej = 0;
    const byVerdict = { conflict: 0, name_only: 0, verified: 0 };
    const byKind: Partial<Record<PersonScanEntityKind, number>> = {};
    for (const c of results?.candidates ?? []) {
      const d = decisions[c.key];
      if (d?.kind === "accept") acc++;
      else if (d?.kind === "reject") rej++;
      if (!c.suppressed) {
        byVerdict[verdictOf(c)]++;
        byKind[c.entity_kind] = (byKind[c.entity_kind] ?? 0) + 1;
      }
    }
    const total = results?.candidates.length ?? 0;
    return { acc, rej, undecided: total - acc - rej, total, byVerdict, byKind };
  }, [results, decisions]);

  const dirty = counts.acc + counts.rej > 0; // something to save
  // Only what the user changed is worth a "discard?" prompt, not the pre-filled defaults.
  const changed = useMemo(() => {
    const same = (a?: Decision, b?: Decision) =>
      a?.kind === b?.kind && (a?.kind !== "accept" || a.role === (b as typeof a).role);
    return Object.keys({ ...decisions, ...seed.current }).some((k) => !same(decisions[k], seed.current[k]));
  }, [decisions]);
  const guard = (message: string, action: () => void) => (changed ? setConfirm({ message, action }) : action());

  // ── scan lifecycle ──
  const beginScan = () => guard("Discard your unsaved decisions and start a new scan?", () => {
    const previous = job;
    start.mutate({
      force_refresh: forceRefresh,
      ...(scope ? { entity_ids: [scope.id], entity_kind: scope.kind } : {}),
    }, {
      onSuccess: (j) => {
        setParams({ job: j.id }, { replace: true });
        resetLocal();
        // A fresh full scan replaces the previous full one; a scoped scan leaves it be.
        if (!scope && previous && !previous.scoped && previous.id !== j.id) deleteJob.mutate(previous.id);
      },
      // 409 means one is already running — let the reopen effect find it.
      onError: () => qc.invalidateQueries({ queryKey: gk(guildId, cfg.path, "jobs") }),
    });
  });

  const discard = () => guard("Discard your unsaved decisions?", () => {
    const previous = jobId;
    setParams({}, { replace: true });
    resetLocal();
    if (previous) deleteJob.mutate(previous);
  });

  const onSave = () => {
    if (!results) return;
    const links: PersonScanApplyIn["links"] = [];
    const suppress: PersonScanApplyIn["suppress"] = [];
    const unsuppress: PersonScanApplyIn["unsuppress"] = [];
    const handled = new Set<string>();
    const lifted = new Set<string>();

    for (const c of results.candidates) {
      const ref = { entity_kind: c.entity_kind, entity_id: c.entity_id, person_id: c.person_id, slot: c.slot };
      const d = decisions[c.key];
      if (d?.kind === "accept") {
        links.push({ entity_kind: c.entity_kind, entity_id: c.entity_id, person_id: c.person_id, role: d.role });
        if (c.suppressed) unsuppress.push(ref);
        handled.add(c.key);
      } else if (d?.kind === "reject") {
        if (!c.suppressed) suppress.push(ref);
        handled.add(c.key);
      } else if (c.suppressed) {
        unsuppress.push(ref);          // un-suppressed, but left undecided
        lifted.add(c.key);
      }
    }

    apply.mutate({ links, suppress, unsuppress }, {
      onSuccess: (res) => {
        const extra = [
          res.skipped > 0 && `${res.skipped} already existed`,
          res.suppressed > 0 && `${res.suppressed} rejected`,
          res.unsuppressed > 0 && `${res.unsuppressed} un-rejected`,
          res.invalid.length > 0 && `${res.invalid.length} skipped (deleted since the scan)`,
        ].filter(Boolean).join(" · ");
        toast.success(`Saved ${res.created} link${res.created === 1 ? "" : "s"}`, { description: extra || undefined });
        qc.setQueryData<PersonScanResults>(gk(guildId, cfg.path, "jobs", jobId, "results"), (old) =>
          old ? {
            ...old,
            candidates: old.candidates
              .filter((c) => !handled.has(c.key))
              .map((c) => (lifted.has(c.key) ? { ...c, suppressed: false } : c)),
          } : old);
        setDecisions({});
      },
    });
  };

  const suppressedShown = results?.candidates.filter((c) => c.suppressed).length ?? 0;
  const shownKeys = roleKeys.map((r, i) => `${i + 1} ${cfg.roleLabels[r] ?? r}`).join(", ");
  const toggleKind = (k: PersonScanEntityKind) => setKinds((prev) => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const rowProps = (c: PersonScanCandidate, showPerson: boolean) => ({
    c, cfg, showPerson, guildId, decision: decisions[c.key], focused: focusKey === c.key,
    onAssign: assign, onReject: reject, onClear: clearOne, onFocus: setFocusKey,
  });

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto">{cfg.title}</h1>
        {canEdit && (
          <>
            <ArtworkBackfillButton />
            <label className="flex cursor-pointer items-center gap-2 text-sm"
                   title={`Re-fetch from ${cfg.source} instead of reusing the on-disk cache`}>
              <Checkbox checked={forceRefresh} onCheckedChange={(v) => setForceRefresh(v === true)} />
              Ignore cache
            </label>
            {busy ? (
              <Button variant="outline" disabled={cancel.isPending} onClick={() => jobId && cancel.mutate(jobId)}>
                {cancel.isPending && <Spinner size="sm" />} Cancel scan
              </Button>
            ) : (
              <Button disabled={start.isPending || bootstrapping} onClick={beginScan}>
                {start.isPending ? <Spinner size="sm" /> : <RefreshCw />}
                {scope ? `Scan this ${KIND_LABELS[scope.kind][0].toLowerCase()}` : job ? "Re-scan" : "Start scan"}
              </Button>
            )}
            {job && !busy && (
              <Button variant="ghost" size="icon" aria-label="Discard these results" title="Discard these results" onClick={discard}>
                <Trash2 />
              </Button>
            )}
          </>
        )}
      </header>

      {scope && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          The next scan only fetches {scope.name ? <strong>{scope.name}</strong> : `this ${KIND_LABELS[scope.kind][0].toLowerCase()}`};
          everything already cached still counts as evidence.
          <Button variant="link" size="sm" className="ml-auto h-auto p-0" onClick={() => { setParam("scope", null); setParam("name", null); }}>
            Scan everything instead
          </Button>
        </div>
      )}

      {bootstrapping && <LoadingState label={jobId ? "Loading scan…" : "Looking for an earlier scan…"} />}
      {!bootstrapping && !busy && !done && (
        <section className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{cfg.intro}</section>
      )}

      {job?.status === "error" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Scan failed: {job.error}
        </p>
      )}
      {job?.status === "cancelled" && <p className="text-sm text-muted-foreground">Scan cancelled.</p>}

      {busy && job && <ScanProgress job={job} />}

      {done && !results && <LoadingState label="Loading results…" />}

      {done && results && job && (
        <>
          <JobMeta job={job} source={cfg.source} />

          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={verdict} onValueChange={(v) => setVerdict(v as VerdictFilter)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                {cfg.source === "TMDB" && (
                  <TabsTrigger value="conflict">Conflicts ({counts.byVerdict.conflict})</TabsTrigger>
                )}
                <TabsTrigger value="name_only">Name only ({counts.byVerdict.name_only})</TabsTrigger>
                <TabsTrigger value="verified">Verified ({counts.byVerdict.verified})</TabsTrigger>
              </TabsList>
            </Tabs>
            {cfg.kinds.length > 1 && cfg.kinds.map((k) => (
              <Button key={k} size="sm" variant={kinds.has(k) ? "default" : "outline"} onClick={() => toggleKind(k)}
                      disabled={!counts.byKind[k]}>
                {KIND_LABELS[k][1]} {counts.byKind[k] ? `(${counts.byKind[k]})` : ""}
              </Button>
            ))}
            {cfg.source === "TMDB" && (
              <select aria-label="Credit type" className="h-8 rounded-md border bg-background px-2 text-sm"
                      value={credit} onChange={(e) => setCredit(e.target.value as CreditFilter)}>
                <option value="all">Any credit</option>
                <option value="cast">Cast</option>
                <option value="guest">Guest stars</option>
                <option value="crew">Crew</option>
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Filter" className="w-64 pl-8" placeholder="Filter person or title…"
                     value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={grouped} onCheckedChange={(v) => setGrouped(v === true)} /> Group by person
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={showSuppressed} onCheckedChange={(v) => setShowSuppressed(v === true)} />
              Rejected earlier ({suppressedShown})
            </label>
            <span className="grow" />
            {canEdit && (
              <>
                <span className="text-xs text-muted-foreground">Shown:</span>
                <Button size="sm" variant="outline" onClick={() => decideMany(rows, "accept")}>Accept</Button>
                <Button size="sm" variant="outline" onClick={() => decideMany(rows, "reject")}>Reject</Button>
                <Button size="sm" variant="ghost" onClick={() => decideMany(rows, "clear")}>Clear</Button>
                <Button size="sm" disabled={!dirty || apply.isPending} onClick={onSave}>
                  {apply.isPending && <Spinner size="sm" />} Save ({counts.acc})
                </Button>
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {counts.total} suggestions · {counts.acc} accepted · {counts.rej} rejected · {counts.undecided} undecided ·
            showing {rows.length}
            <span className="hidden lg:inline">
              {" "}— {roleKeys.length > 1 && <><kbd>1</kbd>–<kbd>{roleKeys.length}</kbd> role ({shownKeys}) · </>}
              <kbd>Enter</kbd> accept · <kbd>Space</kbd> toggle · <kbd>S</kbd> reject (remembered) · <kbd>U</kbd> undecide ·
              {" "}<kbd>↑</kbd><kbd>↓</kbd> move
            </span>
          </p>

          {rows.length === 0 ? (
            <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
              {counts.total === 0 ? "Nothing missing — every credit TMDB knows about is already linked." : "No suggestions match these filters."}
            </p>
          ) : grouped ? (
            <div className="grid gap-3" role="grid">
              {groups.map(({ person, rows: list }) => {
                const first = list[0];
                return (
                  <section key={person} className="overflow-hidden rounded-lg border bg-card">
                    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/30 px-3 py-2">
                      <Link className="font-medium hover:underline" to={`/g/${guildId}/people/${person}`}>{first.person_name}</Link>
                      <VerdictBadge c={first} />
                      <span className={cn("text-xs", verdictOf(first) === "conflict" ? "text-warning" : "text-muted-foreground")}>
                        {evidenceText(first)}
                        {verdictOf(first) === "conflict" && " — possibly a different person with the same name"}
                      </span>
                      {cfg.profile && (
                        <a className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                           href={cfg.profile(first.source_person_id)} target="_blank" rel="noreferrer">
                          {cfg.source} profile <ExternalLink className="size-3" />
                        </a>
                      )}
                      {canEdit && (
                        <span className="ml-auto flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => decideMany(list, "accept")}>Accept all {list.length}</Button>
                          <Button size="sm" variant="ghost" onClick={() => decideMany(list, "reject")}>Reject all</Button>
                        </span>
                      )}
                    </header>
                    {list.map((c) => <ScanRow key={c.key} {...rowProps(c, false)} />)}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card" role="grid">
              {rows.map((c) => <ScanRow key={c.key} {...rowProps(c, true)} />)}
            </div>
          )}

          {results.unresolved.length > 0 && (
            <details className="rounded-lg border px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">
                {results.unresolved.length} item{results.unresolved.length === 1 ? "" : "s"} {cfg.source} couldn't match
              </summary>
              <p className="mt-2 text-muted-foreground">
                Their credits were never checked. Fix the title, year or season number, then re-scan with
                {" "}<em>Ignore cache</em> ticked.
              </p>
              <ul className="mt-2 grid gap-1">
                {results.unresolved.map((u) => (
                  <li key={`${u.entity_kind}:${u.id}`}>
                    <Link className="hover:underline" to={cfg.href(guildId, u.entity_kind, u.id)}>{u.name}</Link>{" "}
                    <span className="text-muted-foreground">({u.release_year ?? "?"}) — {u.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {suppressions && suppressions.count > 0 && (
        <details className="rounded-lg border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {suppressions.count} rejected suggestion{suppressions.count === 1 ? "" : "s"}
          </summary>
          <p className="mt-2 text-muted-foreground">These never come back in scan results.</p>
          {canEdit && (
            <Button className="mt-2" size="sm" variant="outline" disabled={clearSuppressions.isPending}
                    onClick={() => setConfirm({ message: "Forget every rejection? They'll be suggested again next scan.", action: () => clearSuppressions.mutate() })}>
              Forget all rejections
            </Button>
          )}
          <ul className="mt-2 grid gap-1">
            {suppressions.items.map((s) => (
              <li key={`${s.entity_kind}:${s.entity_id}:${s.person_id}:${s.slot}`}>
                {s.person_name ?? `#${s.person_id}`} → {s.entity_name ?? `#${s.entity_id}`}{" "}
                <span className="text-muted-foreground">({KIND_LABELS[s.entity_kind][0].toLowerCase()} · {s.slot})</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={() => { confirm.action(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function ScanProgress({ job }: { job: PersonScanJob }) {
  const pct = job.total ? Math.round((100 * job.processed) / job.total) : 0;
  return (
    <section className="grid gap-2 rounded-lg border p-4">
      <span className="flex items-center gap-2 text-sm">
        <Spinner size="sm" />
        {job.phase === "queued" && "Waiting for an earlier TMDB/IGDB job to finish…"}
        {job.phase === "loading" && "Loading the catalog…"}
        {job.phase === "fetching" && `Fetching credits… ${job.processed}/${job.total}`}
        {job.phase === "matching" && "Matching people…"}
        {job.last_item && <span className="truncate text-muted-foreground">· {job.last_item}</span>}
      </span>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}

function JobMeta({ job, source }: { job: PersonScanJob; source: string }) {
  const when = job.finished_at ? new Date(job.finished_at).toLocaleString() : null;
  return (
    <p className="text-xs text-muted-foreground">
      {job.scoped ? "Scoped scan" : "Full scan"}{when && ` finished ${when}`}
      {job.stats && ` · ${job.stats.items_resolved}/${job.stats.items_in_scope} matched on ${source} · `
        + `${job.stats.network_calls} calls, ${job.stats.cache_hits} from cache`}
    </p>
  );
}

// ── Verticals ─────────────────────────────────────────────────
const TV_PATH: Record<string, string> = { show: "shows", season: "seasons", episode: "episodes" };

const TMDB_SCAN: ScanConfig = {
  path: "tmdb-person-scan",
  title: "TMDB scan",
  source: "TMDB",
  intro: (
    <>
      <p>
        Fetches TMDB credits for every movie and show (with its seasons and the episodes you have) and
        lists the people already in your catalog who are credited but not linked. TV credits are offered at
        the highest level they hold everywhere beneath, the way the TV import does it, and a link a person
        already has on a show or season counts for everything under it.
      </p>
      <p className="mt-2">
        Identity is checked across both media: someone's linked movies and shows either back up the match or
        contradict it. <strong>Conflicts</strong> (say, matching all their movies but none of their shows) usually
        mean two people share a name, so they're listed first and never pre-accepted. On a cold cache this takes
        a few calls per title; afterwards almost none.
      </p>
    </>
  ),
  kinds: ["movie", "show", "season", "episode"],
  roleLabels: CAST_ROLE_LABELS,
  roleKeys: ["lead_actor", "actor", "cameo_actor", "director", "composer", "creator"],
  href: (g, kind, id) => (kind === "movie" ? `/g/${g}/movies/${id}` : `/g/${g}/television/${TV_PATH[kind]}/${id}`),
  profile: (id) => `https://www.themoviedb.org/person/${id}`,
  invalidate: ["movies", "television"],
};

const GAME_SCAN: ScanConfig = {
  path: "game-person-scan",
  title: "IGDB scan",
  source: "IGDB",
  intro: (
    <p>
      Looks every game up on IGDB and suggests <em>developer</em> links for studios that are already in
      your people list but not yet linked to games IGDB says they developed. IGDB only credits companies, so
      directors, composers and cast can't be found this way. One IGDB call per game on a cold cache, near
      zero afterwards.
    </p>
  ),
  kinds: ["game"],
  roleLabels: GAME_ROLE_LABELS,
  roleKeys: ["developer"],
  href: (g, _kind, id) => `/g/${g}/games/${id}`,
  invalidate: ["games"],
};

export const TmdbPersonScanPage = () => <PersonScanPage cfg={TMDB_SCAN} />;
export const GamePersonScanPage = () => <PersonScanPage cfg={GAME_SCAN} />;
