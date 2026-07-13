import {
  memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useApplyScan, useCancelScan, useClearSuppressions, useDeleteScanJob,
  useScanJob, useScanJobs, useScanResults, useStartScan, useSuppressions,
} from "../api/hooks";
import { CAST_ROLE_LABELS } from "../api/types";
import type {
  CastRole, ScanApply, ScanApplyResult, ScanCandidate, ScanResults,
} from "../api/types";

const KEY_TO_ROLE: Record<string, CastRole> = {
  "1": "lead_actor", "2": "actor", "3": "cameo_actor", "4": "director", "5": "composer",
};
const CAST_ROLES: CastRole[] = ["lead_actor", "actor", "cameo_actor"];

const rolesFor = (c: ScanCandidate): CastRole[] =>
  c.credit_type === "cast" ? CAST_ROLES : [c.suggested_role];

const domId = (k: string) => `scanrow-${k.replace(/:/g, "-")}`;

type Decision = { kind: "accept"; role: CastRole } | { kind: "reject" };
type Decisions = Record<string, Decision | undefined>;
type SortCol = "person" | "movie" | "credit" | "match";

function seedDecisions(cands: ScanCandidate[]): Decisions {
  const d: Decisions = {};
  for (const c of cands) {
    if (c.suppressed) d[c.key] = { kind: "reject" };
    else if (c.match === "verified") d[c.key] = { kind: "accept", role: c.suggested_role };
    // name_only & not suppressed -> undecided
  }
  return d;
}

// ── Row ───────────────────────────────────────────────────────
interface RowProps {
  c: ScanCandidate;
  decision: Decision | undefined;
  focused: boolean;
  onAssign: (key: string, role: CastRole) => void;
  onReject: (key: string) => void;
  onClear: (key: string) => void;
  onFocus: (key: string) => void;
}

const ScanRow = memo(function ScanRow(
  { c, decision, focused, onAssign, onReject, onClear, onFocus }: RowProps,
) {
  const state =
    decision?.kind === "accept" ? "accept"
    : decision?.kind === "reject" ? "reject"
    : c.match === "name_only" ? "attention"
    : "idle";
  const roles = rolesFor(c);

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
        <Link to={`/people/${c.person_id}`}>{c.person_name}</Link>
      </span>
      <span role="gridcell" className="scan-ellipsis">
        <Link to={`/movies/${c.movie_id}`}>
          {c.movie_name}{c.movie_year ? ` (${c.movie_year})` : ""}
        </Link>
      </span>
      <span role="gridcell" className="scan-ellipsis" title={c.suggestion_reason}>
        {c.credit_type === "crew"
          ? c.job
          : `${c.character || "?"} · #${(c.billing_order ?? 0) + 1}`}
      </span>
      <span role="gridcell">
        {roles.length === 1 ? (
          <span className="scan-fixed-role">{CAST_ROLE_LABELS[roles[0]]}</span>
        ) : (
          <select
            value={decision?.kind === "accept" ? decision.role : c.suggested_role}
            onChange={(e) => onAssign(c.key, e.target.value as CastRole)}
          >
            {roles.map((r) => <option key={r} value={r}>{CAST_ROLE_LABELS[r]}</option>)}
          </select>
        )}
      </span>
      <span role="gridcell" className="scan-match">
        {c.match === "verified" ? (
          <span className="scan-badge ok" title={`${c.overlap} shared movie(s) confirm identity`}>
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
export function MoviePersonScanPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job");

  const { data: jobs } = useScanJobs();
  const jobQuery = useScanJob(jobId);
  const job = jobQuery.data;
  const jobExpired = !!jobId && jobQuery.isError;

  const busy = job?.status === "running" || job?.status === "pending";
  const done = job?.status === "done";

  const { data: results } = useScanResults(jobId, !!done);

  const start = useStartScan();
  const cancel = useCancelScan();
  const deleteJob = useDeleteScanJob();
  const apply = useApplyScan();
  const { data: suppressions } = useSuppressions();
  const clearSuppressions = useClearSuppressions();

  const [forceRefresh, setForceRefresh] = useState(false);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [query, setQuery] = useState("");
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: "match", dir: 1 });
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<ScanApplyResult | null>(null);

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
        c.person_name.toLowerCase().includes(q) || c.movie_name.toLowerCase().includes(q));
    }
    const key = (c: ScanCandidate) => {
      switch (sort.col) {
        case "person": return c.person_name.toLowerCase();
        case "movie": return c.movie_name.toLowerCase();
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
  const assign = useCallback((k: string, role: CastRole) => setDec(k, { kind: "accept", role }), [setDec]);
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
      const role = KEY_TO_ROLE[e.key];
      if (role && rolesFor(c).includes(role)) { assign(c.key, role); go(i + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assign, reject, clearOne]);

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
      onError: () => qc.invalidateQueries({ queryKey: ["scan", "jobs"] }),
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
    const links: ScanApply["links"] = [];
    const suppress: ScanApply["suppress"] = [];
    const unsuppress: ScanApply["unsuppress"] = [];
    const handled = new Set<string>();
    const lifted = new Set<string>();

    for (const c of results.candidates) {
      const ref = { movie_id: c.movie_id, person_id: c.person_id, slot: c.slot };
      const d = decisions[c.key];
      if (d?.kind === "accept") {
        links.push({ movie_id: c.movie_id, person_id: c.person_id, role: d.role });
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
        qc.setQueryData<ScanResults>(["scan", "results", jobId], (old) =>
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

  return (
    <div className="scan-page">
      <header className="page-head">
        <h1>TMDB scan</h1>
        <div className="inline">
          <label className={`chip${forceRefresh ? " chip-active" : ""}`}
                 title="Re-fetch from TMDB instead of reusing the on-disk cache">
            <input type="checkbox" checked={forceRefresh}
                   onChange={(e) => setForceRefresh(e.target.checked)} />
            Ignore cache
          </label>
          {busy ? (
            <button onClick={() => jobId && cancel.mutate(jobId)} disabled={cancel.isPending}>
              Cancel scan
            </button>
          ) : (
            <button onClick={beginScan} disabled={start.isPending}>
              {start.isPending ? "Starting…" : job ? "Re-scan" : "Start scan"}
            </button>
          )}
          {job && !busy && (
            <button className="icon" title="Discard these results" onClick={discard}>✕</button>
          )}
        </div>
      </header>

      {start.error && <p className="err">{(start.error as Error).message}</p>}

      {!busy && !done && (
        <section className="scan-intro">
          <p>
            Fetches credits for every movie in the database and diffs them against the
            links you already have. Roughly two TMDB calls per movie on a cold cache,
            near-zero afterwards — tick <em>Ignore cache</em> to force fresh data.
          </p>
        </section>
      )}

      {job?.status === "error" && (
        <p className="scan-notice bad"><span>Scan failed: {job.error}</span></p>
      )}
      {job?.status === "cancelled" && (
        <p className="scan-notice warn"><span>Scan cancelled.</span></p>
      )}

      {busy && job && (
        <section className="scan-progress">
          <span className="meta">
            {job.phase === "loading" && "Loading database…"}
            {job.phase === "fetching" && `Fetching credits… ${job.processed}/${job.total}`}
            {job.phase === "matching" && "Matching people…"}
            {job.last_movie && ` · ${job.last_movie}`}
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

      {done && !results && <p className="meta">Loading results…</p>}

      {done && results && (
        <>
          <div className="scan-toolbar">
            <input type="search" placeholder="Filter person or movie…"
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
            <button className="scan-save" onClick={onSave}
                    disabled={apply.isPending || !dirty}>
              {apply.isPending ? "Saving…" : `Save (${counts.acc})`}
            </button>
          </div>

          <p className="meta">
            {counts.total} candidates · {counts.acc} accepted · {counts.rej} rejected ·{" "}
            {counts.undecided} undecided · showing {rows.length}
            {job.stats && ` — ${job.stats.network_calls} TMDB calls, ` +
              `${job.stats.cache_hits} cache hits, ${job.stats.movies_unresolved} unresolved`}
          </p>
          <p className="meta scan-help">
            <kbd>1</kbd>–<kbd>5</kbd> role · <kbd>Enter</kbd> accept suggested ·{" "}
            <kbd>Space</kbd> toggle · <kbd>S</kbd> reject (remembered) ·{" "}
            <kbd>U</kbd> undecide · <kbd>↑</kbd><kbd>↓</kbd> move
          </p>

          <div className="scan-grid" role="grid">
            <div className="scan-row scan-head" role="row">
              <span role="columnheader" />
              <span role="columnheader">{header("person", "Person")}</span>
              <span role="columnheader">{header("movie", "Movie")}</span>
              <span role="columnheader">{header("credit", "TMDB credit")}</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">{header("match", "Match")}</span>
              <span role="columnheader" />
            </div>
            {rows.map((c) => (
              <ScanRow key={c.key} c={c} decision={decisions[c.key]}
                       focused={focusKey === c.key} onAssign={assign} onReject={reject}
                       onClear={clearOne} onFocus={setFocusKey} />
            ))}
          </div>

          {results.unresolved_movies.length > 0 && (
            <details className="scan-unresolved">
              <summary>{results.unresolved_movies.length} movie(s) TMDB could not resolve</summary>
              <p className="meta">
                Their credits were never checked. Fix the title or year, then re-scan
                with <em>Ignore cache</em> ticked.
              </p>
              <ul>
                {results.unresolved_movies.map((m) => (
                  <li key={m.id}>
                    <Link className="plain-link" to={`/movies/${m.id}`}>{m.name}</Link>{" "}
                    <span className="meta">({m.release_year ?? "?"})</span>
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
          <button onClick={() => clearSuppressions.mutate()}>Clear all suppressions</button>
          <ul>
            {suppressions.items.map((s) => (
              <li key={`${s.person_id}:${s.movie_id}:${s.slot}`}>
                {s.person_name ?? `#${s.person_id}`} → {s.movie_name ?? `#${s.movie_id}`}{" "}
                <span className="meta">({s.slot})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
