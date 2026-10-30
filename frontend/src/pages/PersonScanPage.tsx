import {
  memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useApplyPersonScan, useCancelPersonScan, useClearPersonScanSuppressions, useDeletePersonScanJob, useGuildApi,
  usePersonScanJob, usePersonScanJobs, usePersonScanResults, usePersonScanSuppressions, useStartPersonScan,
} from "../api/hooks";
import { gk } from "../api/keys";
import { CAST_ROLE_LABELS, GAME_ROLE_LABELS } from "../api/types";
import type {
  PersonScanApplyIn, PersonScanApplyResult, PersonScanCandidate, PersonScanEntityKind, PersonScanResults,
} from "../api/types";
import { BusyButton, LoadingState, Spinner } from "../components/Spinner";

// The television and game counterpart of MoviePersonScanPage: same review
// flow, generalised over what a candidate links to (show / season / episode /
// game). Each vertical is a `ScanConfig` below.

interface ScanConfig {
  path: string;                       // router prefix, also the cache-key namespace
  title: string;
  source: "TMDB" | "IGDB";
  noun: string;                       // what a scan covers: "show", "game"
  column: string;                     // header of the linked-entity column
  intro: ReactNode;
  roleLabels: Record<string, string>;
  roleKeys: string[];                 // key N picks roleKeys[N-1] (when the row offers it)
  href: (guildId: number, kind: PersonScanEntityKind, id: number) => string;
  invalidate: string[];               // catalog cache prefixes the new links show up under
}

const KIND_LABELS: Record<PersonScanEntityKind, string> = {
  show: "Show", season: "Season", episode: "Episode", game: "Game",
};

const domId = (k: string) => `scanrow-${k.replace(/:/g, "-")}`;

type Decision = { kind: "accept"; role: string } | { kind: "reject" };
type Decisions = Record<string, Decision | undefined>;
type SortCol = "person" | "entity" | "credit" | "match";

function seedDecisions(cands: PersonScanCandidate[]): Decisions {
  const d: Decisions = {};
  for (const c of cands) {
    if (c.suppressed) d[c.key] = { kind: "reject" };
    else if (c.match === "verified") d[c.key] = { kind: "accept", role: c.suggested_role };
    // name_only & not suppressed -> undecided
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

// ── Row ───────────────────────────────────────────────────────
interface RowProps {
  c: PersonScanCandidate;
  cfg: ScanConfig;
  decision: Decision | undefined;
  focused: boolean;
  guildId: number;
  onAssign: (key: string, role: string) => void;
  onReject: (key: string) => void;
  onClear: (key: string) => void;
  onFocus: (key: string) => void;
}

const ScanRow = memo(function ScanRow(
  { c, cfg, decision, focused, guildId, onAssign, onReject, onClear, onFocus }: RowProps,
) {
  const state =
    decision?.kind === "accept" ? "accept"
    : decision?.kind === "reject" ? "reject"
    : c.match === "name_only" ? "attention"
    : "idle";
  const label = (r: string) => cfg.roleLabels[r] ?? r;

  return (
    <div
      id={domId(c.key)}
      role="row"
      className={`scan-row scan-${state}${focused ? " scan-focus" : ""}`}
      onMouseDown={() => onFocus(c.key)}
    >
      <span role="gridcell" className="scan-st">
        {state === "accept" ? "✓" : state === "reject" ? "✗" : "·"}
      </span>
      <span role="gridcell" className="scan-ellipsis">
        <Link to={`/g/${guildId}/people/${c.person_id}`}>{c.person_name}</Link>
      </span>
      <span role="gridcell" className="scan-ellipsis" title={c.context ?? undefined}>
        {c.entity_kind !== "game" && <span className="scan-badge mute">{KIND_LABELS[c.entity_kind]}</span>}{" "}
        <Link to={cfg.href(guildId, c.entity_kind, c.entity_id)}>
          {c.context ? `${c.context} · ` : ""}{c.entity_name}
          {c.entity_kind !== "episode" && c.entity_year ? ` (${c.entity_year})` : ""}
        </Link>
      </span>
      <span role="gridcell" className="scan-ellipsis" title={c.suggestion_reason}>
        {creditText(c)}
      </span>
      <span role="gridcell">
        {c.roles.length === 1 ? (
          <span className="scan-fixed-role">{label(c.roles[0])}</span>
        ) : (
          <select
            value={decision?.kind === "accept" ? decision.role : c.suggested_role}
            onChange={(e) => onAssign(c.key, e.target.value)}
          >
            {c.roles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        )}
      </span>
      <span role="gridcell" className="scan-match">
        {c.match === "verified" ? (
          <span className="scan-badge ok" title={`${c.overlap} shared ${cfg.noun}(s) confirm identity`}>
            ✔ {c.overlap}
          </span>
        ) : (
          <span className="scan-badge warn" title="Name matches; nothing corroborates it">
            ~ name
          </span>
        )}
        {c.suppressed && <span className="scan-badge mute">suppressed</span>}
      </span>
      <span role="gridcell" className="scan-actions">
        <button onClick={() => onAssign(c.key, c.suggested_role)}>Accept</button>
        <button onClick={() => onReject(c.key)}>Reject</button>
        <button onClick={() => onClear(c.key)}>Clear</button>
      </span>
    </div>
  );
});

// ── Page ──────────────────────────────────────────────────────
function PersonScanPage({ cfg }: { cfg: ScanConfig }) {
  const qc = useQueryClient();
  const { guildId } = useGuildApi();
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job");

  const { data: jobs, isLoading: jobsLoading } = usePersonScanJobs(cfg.path);
  const jobQuery = usePersonScanJob(cfg.path, jobId);
  const job = jobQuery.data;
  const jobExpired = !!jobId && jobQuery.isError;

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
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: "match", dir: 1 });
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<PersonScanApplyResult | null>(null);

  const deferredQuery = useDeferredValue(query);
  const seeded = useRef<string | null>(null);

  const resetLocal = useCallback(() => {
    setDecisions({});
    setFocusKey(null);
    setQuery("");
    setSummary(null);
    seeded.current = null;
  }, []);

  // An evicted job 404s. Drop the stale ?job= instead of rendering nothing.
  useEffect(() => {
    if (jobExpired) { setParams({}, { replace: true }); resetLocal(); }
  }, [jobExpired, setParams, resetLocal]);

  // Re-attach to a scan already in flight (e.g. after a reload).
  useEffect(() => {
    if (jobId || !jobs) return;
    const live = jobs.find((j) => j.status === "running" || j.status === "pending");
    if (live) setParams({ job: live.id }, { replace: true });
  }, [jobs, jobId, setParams]);

  useEffect(() => {
    if (results && seeded.current !== results.job_id) {
      setDecisions(seedDecisions(results.candidates));
      setFocusKey(results.candidates[0]?.key ?? null);
      seeded.current = results.job_id;
    }
  }, [results]);

  const rows = useMemo(() => {
    const all = results?.candidates ?? [];
    const q = deferredQuery.trim().toLowerCase();
    let r = showSuppressed ? all : all.filter((c) => !c.suppressed);
    if (q) {
      r = r.filter((c) =>
        c.person_name.toLowerCase().includes(q)
        || c.entity_name.toLowerCase().includes(q)
        || (c.context ?? "").toLowerCase().includes(q));
    }
    const key = (c: PersonScanCandidate) => {
      switch (sort.col) {
        case "person": return c.person_name.toLowerCase();
        case "entity": return `${c.context ?? ""} ${c.entity_name}`.toLowerCase();
        case "credit": return (c.job ?? c.character ?? "").toLowerCase();
        case "match": return `${c.match === "name_only" ? 0 : 1}${String(c.overlap).padStart(4, "0")}`;
      }
    };
    return [...r].sort((a, b) => (key(a) < key(b) ? -sort.dir : key(a) > key(b) ? sort.dir : 0));
  }, [results, deferredQuery, showSuppressed, sort]);

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
    for (const c of results?.candidates ?? []) {
      const d = decisions[c.key];
      if (d?.kind === "accept") acc++;
      else if (d?.kind === "reject") rej++;
    }
    const total = results?.candidates.length ?? 0;
    return { acc, rej, undecided: total - acc - rej, total };
  }, [results, decisions]);

  const dirty = counts.acc + counts.rej > 0;

  // ── scan lifecycle ──
  const beginScan = () => {
    if (dirty && !window.confirm("Discard unsaved decisions and start a new scan?")) return;
    const previous = jobId;
    start.mutate({ force_refresh: forceRefresh }, {
      onSuccess: (j) => {
        setParams({ job: j.id }, { replace: true });
        resetLocal();
        if (previous && previous !== j.id) deleteJob.mutate(previous);
      },
      // 409 means one is already running — let the re-attach effect find it.
      onError: () => qc.invalidateQueries({ queryKey: gk(guildId, cfg.path, "jobs") }),
    });
  };

  const discard = () => {
    if (dirty && !window.confirm("Discard unsaved decisions?")) return;
    const previous = jobId;
    setParams({}, { replace: true });
    resetLocal();
    if (previous) deleteJob.mutate(previous);
  };

  const bulkVisible = (mode: "accept" | "reject" | "clear") =>
    setDecisions((prev) => {
      const n = { ...prev };
      for (const c of rows) {
        if (mode === "accept") n[c.key] = { kind: "accept", role: c.suggested_role };
        else if (mode === "reject") n[c.key] = { kind: "reject" };
        else delete n[c.key];
      }
      return n;
    });

  const acceptVerified = () =>
    setDecisions((prev) => {
      const n = { ...prev };
      for (const c of results?.candidates ?? []) {
        if (c.match === "verified" && !c.suppressed) n[c.key] = { kind: "accept", role: c.suggested_role };
      }
      return n;
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
        setSummary(res);
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

  const header = (col: SortCol, label: string) => (
    <button className="scan-sort"
      onClick={() => setSort((s) => ({ col, dir: s.col === col && s.dir === 1 ? -1 : 1 }))}>
      {label}
      {sort.col === col && <span className="sort-arrow"> {sort.dir === 1 ? "▲" : "▼"}</span>}
    </button>
  );

  const suppressedShown = results?.candidates.filter((c) => c.suppressed).length ?? 0;
  const shownKeys = roleKeys.map((r, i) => `${i + 1} ${cfg.roleLabels[r] ?? r}`).join(", ");

  return (
    <div className="scan-page">
      <header className="page-head">
        <h1>{cfg.title}</h1>
        <div className="inline">
          <label className={`chip${forceRefresh ? " chip-active" : ""}`}
                 title={`Re-fetch from ${cfg.source} instead of reusing the on-disk cache`}>
            <input type="checkbox" checked={forceRefresh}
                   onChange={(e) => setForceRefresh(e.target.checked)} />
            Ignore cache
          </label>
          {busy ? (
            <BusyButton busy={cancel.isPending} busyLabel="Cancelling…" onClick={() => jobId && cancel.mutate(jobId)}>
              Cancel scan
            </BusyButton>
          ) : (
            <BusyButton busy={start.isPending} busyLabel="Starting…" disabled={bootstrapping} onClick={beginScan}>
              {job ? "Re-scan" : "Start scan"}
            </BusyButton>
          )}
          {job && !busy && (
            <button className="icon" title="Discard these results" onClick={discard}>✕</button>
          )}
        </div>
      </header>

      {start.error && <p className="err">{(start.error as Error).message}</p>}

      {bootstrapping && <LoadingState label={jobId ? "Loading scan…" : "Checking for a running scan…"} />}
      {!bootstrapping && !busy && !done && (
        <section className="scan-intro">{cfg.intro}</section>
      )}

      {job?.status === "error" && (
        <p className="scan-notice bad"><span>Scan failed: {job.error}</span></p>
      )}
      {job?.status === "cancelled" && (
        <p className="scan-notice warn"><span>Scan cancelled.</span></p>
      )}

      {busy && job && (
        <section className="scan-progress">
          <span className="meta inline"><Spinner size="sm" />
            {job.phase === "loading" && "Loading database…"}
            {job.phase === "fetching" && `Fetching credits… ${job.processed}/${job.total}`}
            {job.phase === "matching" && "Matching people…"}
            {job.last_item && ` · ${job.last_item}`}
          </span>
          <progress value={job.processed} max={Math.max(job.total, 1)} />
        </section>
      )}

      {summary && (
        <p className="scan-notice ok">
          <span>
            Saved <strong>{summary.created}</strong> link{summary.created === 1 ? "" : "s"}
            {summary.skipped > 0 && ` (${summary.skipped} already existed)`}
            {summary.suppressed > 0 && ` · suppressed ${summary.suppressed}`}
            {summary.unsuppressed > 0 && ` · un-suppressed ${summary.unsuppressed}`}
            {summary.invalid.length > 0 && ` · ${summary.invalid.length} skipped (row deleted)`}
          </span>
          <button className="icon" onClick={() => setSummary(null)}>✕</button>
        </p>
      )}

      {done && !results && <LoadingState label="Loading results…" />}

      {done && results && (
        <>
          <div className="scan-toolbar">
            <input type="search" placeholder={`Filter person or ${cfg.noun}…`}
                   value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className={`chip${showSuppressed ? " chip-active" : ""}`}>
              <input type="checkbox" checked={showSuppressed}
                     onChange={(e) => setShowSuppressed(e.target.checked)} />
              Suppressed ({suppressedShown})
            </label>
            <span className="spacer" />
            <button onClick={acceptVerified}>Accept verified</button>
            <span className="meta">visible:</span>
            <button onClick={() => bulkVisible("accept")}>Accept</button>
            <button onClick={() => bulkVisible("reject")}>Reject</button>
            <button onClick={() => bulkVisible("clear")}>Clear</button>
            <BusyButton className="scan-save" busy={apply.isPending} busyLabel="Saving…" disabled={!dirty} onClick={onSave}>
              Save ({counts.acc})
            </BusyButton>
          </div>

          <p className="meta">
            {counts.total} candidates · {counts.acc} accepted · {counts.rej} rejected ·{" "}
            {counts.undecided} undecided · showing {rows.length}
            {job.stats && ` — ${job.stats.network_calls} ${cfg.source} calls, ` +
              `${job.stats.cache_hits} cache hits, ${job.stats.items_unresolved} unresolved`}
          </p>
          <p className="meta scan-help">
            {roleKeys.length > 1 && <><kbd>1</kbd>–<kbd>{roleKeys.length}</kbd> role ({shownKeys}) · </>}
            <kbd>Enter</kbd> accept suggested · <kbd>Space</kbd> toggle · <kbd>S</kbd> reject (remembered) ·{" "}
            <kbd>U</kbd> undecide · <kbd>↑</kbd><kbd>↓</kbd> move
          </p>

          <div className="scan-grid" role="grid">
            <div className="scan-row scan-head" role="row">
              <span role="columnheader" />
              <span role="columnheader">{header("person", "Person")}</span>
              <span role="columnheader">{header("entity", cfg.column)}</span>
              <span role="columnheader">{header("credit", `${cfg.source} credit`)}</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">{header("match", "Match")}</span>
              <span role="columnheader" />
            </div>
            {rows.map((c) => (
              <ScanRow key={c.key} c={c} cfg={cfg} decision={decisions[c.key]}
                       focused={focusKey === c.key} guildId={guildId} onAssign={assign} onReject={reject}
                       onClear={clearOne} onFocus={setFocusKey} />
            ))}
          </div>

          {results.unresolved.length > 0 && (
            <details className="scan-unresolved">
              <summary>{results.unresolved.length} item(s) {cfg.source} could not resolve</summary>
              <p className="meta">
                Their credits were never checked. Fix the title, year or season number, then
                re-scan with <em>Ignore cache</em> ticked.
              </p>
              <ul>
                {results.unresolved.map((u) => (
                  <li key={`${u.entity_kind}:${u.id}`}>
                    <Link className="plain-link" to={cfg.href(guildId, u.entity_kind, u.id)}>{u.name}</Link>{" "}
                    <span className="meta">({u.release_year ?? "?"}) — {u.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {suppressions && suppressions.count > 0 && (
        <details className="scan-suppressions">
          <summary>{suppressions.count} suppressed suggestion(s)</summary>
          <p className="meta">These never appear in scan results again.</p>
          <BusyButton busy={clearSuppressions.isPending} busyLabel="Clearing…" onClick={() => clearSuppressions.mutate()}>Clear all suppressions</BusyButton>
          <ul>
            {suppressions.items.map((s) => (
              <li key={`${s.entity_kind}:${s.entity_id}:${s.person_id}:${s.slot}`}>
                {s.person_name ?? `#${s.person_id}`} → {s.entity_name ?? `#${s.entity_id}`}{" "}
                <span className="meta">({KIND_LABELS[s.entity_kind].toLowerCase()} · {s.slot})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── Verticals ─────────────────────────────────────────────────
const TELEVISION_SCAN: ScanConfig = {
  path: "television-person-scan",
  title: "TMDB scan",
  source: "TMDB",
  noun: "show",
  column: "Show / season / episode",
  intro: (
    <p>
      Fetches TMDB credits for every show, its seasons and the episodes you have, and diffs
      them against the people links you already have. A credit is offered at the highest level
      it holds everywhere beneath, the way the TV import does it: show (creators, people in every
      episode), season (people in every episode of it), or episode (its full cast, guest stars,
      director and composer). A link a person already has on a show or season counts for
      everything under it. On a cold cache that's a couple of calls per season plus one per
      episode; afterwards almost none. Tick <em>Ignore cache</em> to force fresh data.
    </p>
  ),
  roleLabels: CAST_ROLE_LABELS,
  roleKeys: ["lead_actor", "actor", "cameo_actor", "director", "composer", "creator"],
  href: (g, kind, id) => `/g/${g}/television/${kind === "show" ? "shows" : kind === "season" ? "seasons" : "episodes"}/${id}`,
  invalidate: ["television"],
};

const GAME_SCAN: ScanConfig = {
  path: "game-person-scan",
  title: "IGDB scan",
  source: "IGDB",
  noun: "game",
  column: "Game",
  intro: (
    <p>
      Looks every game up on IGDB and suggests <em>developer</em> links for studios that are
      already in your people list but not yet linked to games IGDB says they developed. IGDB only
      credits companies, not individual people, so directors, composers and cast can't be
      found this way; publishers aren't suggested because there's no publisher role. One IGDB
      call per game on a cold cache (IGDB allows only a few a second), near-zero afterwards —
      tick <em>Ignore cache</em> to force fresh data.
    </p>
  ),
  roleLabels: GAME_ROLE_LABELS,
  roleKeys: ["developer"],
  href: (g, _kind, id) => `/g/${g}/games/${id}`,
  invalidate: ["games"],
};

export const TelevisionPersonScanPage = () => <PersonScanPage cfg={TELEVISION_SCAN} />;
export const GamePersonScanPage = () => <PersonScanPage cfg={GAME_SCAN} />;
