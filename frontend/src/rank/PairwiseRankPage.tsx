import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { Comparison, ComparisonIn } from "../api/types";
import { analyze, nextQuestion, pairKey, sameArray, sameSet, type RankAnalysis } from "./pairwise";
import { takeLegacyComparisons, usePairwiseSession } from "./session";

export interface RankItem {
  id: number;
  label: string;
  sublabel?: string | null;
  meta?: string | null;
}

interface Props {
  title: string;
  /** localStorage namespace: "artists", "albums:12", "tv-episodes:4", … */
  scopeKey: string;
  noun: string;
  nounPlural: string;
  items: RankItem[];
  comparisons: Comparison[];
  isLoading?: boolean;
  onAnswer: (c: ComparisonIn) => Promise<unknown>;
  onDeleteAnswer: (a: number, b: number) => Promise<unknown>;
  onClearAnswers: () => Promise<unknown>;
  onApply: (ids: number[]) => Promise<unknown>;
  tabs?: ReactNode;
}

// ── shared bits ────────────────────────────────────────────────────────────────

function OrderDiff({ previous, next, byId }: { previous: number[]; next: number[]; byId: Map<number, RankItem> }) {
  const oldIdx = useMemo(() => new Map(previous.map((id, i) => [id, i])), [previous]);
  return (
    <div className="rank-result">
      {next.map((id, i) => {
        const item = byId.get(id);
        const before = oldIdx.get(id);
        const delta = before === undefined ? 0 : before - i;
        return (
          <div className="rank-result-row" key={id}>
            <span className="pos">#{i + 1}</span>
            <span className="name">
              {item?.label ?? `(removed #${id})`}
              {item?.sublabel && <span style={{ opacity: 0.6 }}> ({item.sublabel})</span>}
            </span>
            {delta > 0 ? (
              <span className="rank-up">▲ {delta}</span>
            ) : delta < 0 ? (
              <span className="rank-down">▼ {-delta}</span>
            ) : (
              <span className="rank-same">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AnswersPanel({
  analysis,
  byId,
  onSwap,
  onDelete,
  busy,
}: {
  analysis: RankAnalysis;
  byId: Map<number, RankItem>;
  onSwap: (c: Comparison) => void;
  onDelete: (c: Comparison) => void;
  busy: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [onlyConflicts, setOnlyConflicts] = useState(false);

  // Newest first — the order the user remembers answering them in.
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const out = [...analysis.comparisons].reverse();
    return out.filter((c) => {
      const k = pairKey(c.winner_id, c.loser_id);
      if (onlyConflicts && !analysis.cyclic.has(k)) return false;
      if (!needle) return true;
      const w = byId.get(c.winner_id)?.label.toLowerCase() ?? "";
      const l = byId.get(c.loser_id)?.label.toLowerCase() ?? "";
      return w.includes(needle) || l.includes(needle);
    });
  }, [analysis, filter, onlyConflicts, byId]);

  if (!analysis.comparisons.length) {
    return (
      <section style={{ marginTop: "2rem" }}>
        <h2 className="rank-h2">Your answers</h2>
        <p className="rank-empty">Nothing yet. Answer a question above and it'll be saved here.</p>
      </section>
    );
  }

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 className="rank-h2">Your answers ({analysis.comparisons.length})</h2>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Filter answers…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {analysis.cycleCount > 0 && (
          <button
            className={`chip${onlyConflicts ? " chip-active" : ""}`}
            onClick={() => setOnlyConflicts((v) => !v)}
          >
            ⚠ Contradictions
          </button>
        )}
        <span className="search-count">
          {rows.length} shown
        </span>
      </div>

      <div className="rank-answers">
        {rows.map((c) => {
          const k = pairKey(c.winner_id, c.loser_id);
          const cyclic = analysis.cyclic.has(k);
          const overridden = analysis.overridden.has(k);
          return (
            <div className={`rank-answer-row${cyclic ? " rank-answer-cyclic" : ""}`} key={k}>
              <span className="rank-answer-side">{byId.get(c.winner_id)?.label ?? `#${c.winner_id}`}</span>
              <span className="rank-gt" title="is preferred over">›</span>
              <span className="rank-answer-side rank-answer-loser">
                {byId.get(c.loser_id)?.label ?? `#${c.loser_id}`}
              </span>
              <span className="rank-answer-flag">
                {overridden ? (
                  <span title="Part of a preference cycle — this answer is currently being overridden">⚠ overridden</span>
                ) : cyclic ? (
                  <span title="Part of a preference cycle">⚠ in a cycle</span>
                ) : null}
              </span>
              <button className="icon" title="Swap: the other one wins" disabled={busy} onClick={() => onSwap(c)}>
                ⇄
              </button>
              <button className="icon" title="Delete this answer" disabled={busy} onClick={() => onDelete(c)}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────

export function PairwiseRankPage({
  title,
  scopeKey,
  nounPlural,
  items,
  comparisons,
  isLoading = false,
  onAnswer,
  onDeleteAnswer,
  onClearAnswers,
  onApply,
  tabs,
}: Props) {
  const { session, patch } = usePairwiseSession(scopeKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [preview, setPreview] = useState(false);

  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const idSig = ids.join(",");
  const liveSet = useMemo(() => new Set(ids), [idSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // One-time migration of v1's localStorage answers into the database.
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || isLoading || !ids.length) return;
    migrated.current = true;
    const legacy = takeLegacyComparisons(scopeKey).filter(
      (c) => liveSet.has(c.winner_id) && liveSet.has(c.loser_id),
    );
    void (async () => {
      for (const c of legacy) await onAnswer(c).catch(() => undefined);
    })();
  }, [scopeKey, isLoading, idSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Answers referencing entries that no longer exist are ignored here; the DB
  // cascade removes them for good the next time the list is fetched.
  const liveComparisons = useMemo(
    () => comparisons.filter((c) => liveSet.has(c.winner_id) && liveSet.has(c.loser_id)),
    [comparisons, liveSet],
  );

  const cmpSig = liveComparisons.map((c) => `${c.winner_id}>${c.loser_id}`).join(",");
  const analysis = useMemo(
    () => analyze(ids, liveComparisons),
    [idSig, cmpSig], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const skipSig = session.skipped.map((p) => pairKey(p[0], p[1])).join(",");
  const skipped = useMemo(
    () => new Set(session.skipped.filter(([a, b]) => liveSet.has(a) && liveSet.has(b)).map(([a, b]) => pairKey(a, b))),
    [skipSig, liveSet], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const question = useMemo(
    () => nextQuestion(analysis, skipped),
    [analysis, skipSig], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Are we out of questions only because everything left was skipped?
  const blockedBySkips = !question && !analysis.complete && skipped.size > 0;

  // ── actions ─────────────────────────────────────────────────────────────────
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const answer = useCallback(
    (winner_id: number, loser_id: number) => {
      patch((s) => ({ skipped: s.skipped.filter(([a, b]) => pairKey(a, b) !== pairKey(winner_id, loser_id)) }));
      void run(() => onAnswer({ winner_id, loser_id }));
    },
    [onAnswer, patch, run],
  );

  const skip = useCallback(() => {
    if (!question) return;
    patch((s) => ({ skipped: [...s.skipped, [question.a, question.b] as [number, number]] }));
  }, [question, patch]);

  const resetSkips = useCallback(() => patch({ skipped: [] }), [patch]);

  async function applyOrder() {
    const previous = [...ids];
    const next = [...analysis.order];
    await run(async () => {
      if (!sameArray(previous, next)) await onApply(next);
      patch({ undo: { previous, next, at: Date.now() } });
      setPreview(false);
    });
  }

  async function undoOrder() {
    const snap = session.undo;
    if (!snap) return;
    await run(async () => {
      if (!sameArray(snap.previous, ids)) await onApply(snap.previous);
      patch({ undo: null });
    });
  }

  // ── keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!question || preview) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowLeft" || e.key === "1") {
        e.preventDefault();
        answer(question!.a, question!.b);
      } else if (e.key === "ArrowRight" || e.key === "2") {
        e.preventDefault();
        answer(question!.b, question!.a);
      } else if (e.key === "ArrowDown" || k === "s") {
        e.preventDefault();
        skip();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [question, preview, answer, skip]);

  // ── render ──────────────────────────────────────────────────────────────────
  const undoValid = !!session.undo && sameSet(session.undo.previous, ids);
  const answered = analysis.comparisons.length;
  const estTotal = answered + analysis.remainingQuestions;
  const pairPct = analysis.totalPairs ? Math.round((analysis.determinedPairs / analysis.totalPairs) * 100) : 100;

  let questionBody: ReactNode;
  if (isLoading) {
    questionBody = <p className="rank-empty">Loading…</p>;
  } else if (items.length < 2) {
    questionBody = <p className="rank-empty">You need at least two {nounPlural} before there's anything to compare.</p>;
  } else if (analysis.complete) {
    questionBody = (
      <p className="rank-empty">
        ✔ Your answers fully determine the order of all {items.length} {nounPlural}. Nothing left to ask.
      </p>
    );
  } else if (blockedBySkips) {
    questionBody = (
      <p className="rank-empty">
        Every remaining comparison has been skipped.{" "}
        <button className="icon" onClick={resetSkips}>
          Reset {skipped.size} skip{skipped.size === 1 ? "" : "s"}
        </button>
      </p>
    );
  } else if (question) {
    const left = byId.get(question.a)!;
    const right = byId.get(question.b)!;
    questionBody = (
      <>
        <p className="rank-question">
          Which do you prefer? <span className="meta">(question {answered + 1} of ≈{estTotal})</span>
        </p>
        <div className="rank-cards">
          <button className="rank-card" disabled={busy} onClick={() => answer(question.a, question.b)}>
            <span className="rank-card-label">{left.label}</span>
            {left.sublabel && <span className="rank-card-sub">{left.sublabel}</span>}
            {left.meta && <span className="rank-card-meta">{left.meta}</span>}
            <span className="rank-card-key">← / 1</span>
          </button>
          <span className="rank-vs">vs</span>
          <button className="rank-card" disabled={busy} onClick={() => answer(question.b, question.a)}>
            <span className="rank-card-label">{right.label}</span>
            {right.sublabel && <span className="rank-card-sub">{right.sublabel}</span>}
            {right.meta && <span className="rank-card-meta">{right.meta}</span>}
            <span className="rank-card-key">→ / 2</span>
          </button>
        </div>
        <p className="rank-hint">
          <kbd>←</kbd>/<kbd>→</kbd> choose · <kbd>S</kbd> skip ·{" "}
          <button className="icon" onClick={skip} disabled={busy}>
            Skip this pair
          </button>
          {skipped.size > 0 && (
            <>
              {" · "}
              <button className="icon" onClick={resetSkips}>
                reset {skipped.size} skip{skipped.size === 1 ? "" : "s"}
              </button>
            </>
          )}
        </p>
      </>
    );
  }

  return (
    <section className="rank-page">
      {tabs}
      <header className="page-head">
        <h1>{title}</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="rank-primary" disabled={!answered || busy} onClick={() => setPreview(true)}>
            Preview suggested list
          </button>
          <button disabled={!answered || busy} onClick={() => setConfirmClear(true)}>
            Clear all answers
          </button>
        </div>
      </header>

      {undoValid && session.undo && (
        <div className="rank-banner">
          <span>
            List replaced — <strong>{session.undo.next.reduce((n, id, i) => (session.undo!.previous[i] === id ? n : n + 1), 0)}</strong>{" "}
            {nounPlural} moved. Your answers are saved, so you can re-apply any time.
          </span>
          <span style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => patch({ undo: null })}>Dismiss</button>
            <button onClick={undoOrder} disabled={busy}>
              Undo
            </button>
          </span>
        </div>
      )}

      <div className="rank-stats">
        <span>
          <strong>{answered}</strong> answered
        </span>
        <span>
          {analysis.complete ? (
            <strong>fully determined</strong>
          ) : (
            <>
              <strong>≈{analysis.remainingQuestions}</strong> more for a fully-determined list
            </>
          )}
        </span>
        <span>
          {analysis.determinedPairs.toLocaleString()} / {analysis.totalPairs.toLocaleString()} pairs ordered ({pairPct}%)
        </span>
        {answered > 0 && (
          <span>
            would move <strong>{analysis.movedCount}</strong> of {items.length}
          </span>
        )}
      </div>
      <progress className="rank-progress" value={analysis.progress} max={1} />

      {analysis.cycleCount > 0 && (
        <div className="dup-warning">
          <span>
            {analysis.cycleCount} contradiction cycle{analysis.cycleCount === 1 ? "" : "s"} (e.g. A &gt; B &gt; C &gt; A).
            Members are ordered by how many of their own cycle-mates they beat; the{" "}
            {analysis.overridden.size} overridden answer{analysis.overridden.size === 1 ? "" : "s"} are flagged below.
          </span>
        </div>
      )}

      {error && <p className="err">{error}</p>}

      {questionBody}

      <AnswersPanel
        analysis={analysis}
        byId={byId}
        busy={busy}
        onSwap={(c) => answer(c.loser_id, c.winner_id)}
        onDelete={(c) => void run(() => onDeleteAnswer(c.winner_id, c.loser_id))}
      />

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="modal rank-preview">
              <h2>Suggested order</h2>
              <p className="meta">
                Built from all {answered} answer{answered === 1 ? "" : "s"}.{" "}
                <strong>{analysis.movedCount}</strong> of {items.length} {nounPlural} would move.
              </p>
              <OrderDiff previous={ids} next={analysis.order} byId={byId} />
              <footer>
                <button onClick={() => setPreview(false)}>Cancel</button>
                <button className="rank-primary" onClick={applyOrder} disabled={busy || !analysis.movedCount}>
                  {busy ? "Replacing…" : "Replace current list"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          message={`Permanently delete all ${answered} stored answer${answered === 1 ? "" : "s"} for this list?`}
          onConfirm={() => {
            setConfirmClear(false);
            void run(() => onClearAnswers());
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </section>
  );
}
