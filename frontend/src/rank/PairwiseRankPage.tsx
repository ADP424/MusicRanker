import { ArrowDown, ArrowLeftRight, ArrowUp, CircleCheck, Search, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FilterChip, FormDialog, Notice } from "../components/form/FormKit";
import { BusyButton, LoadingState, Spinner } from "../components/Spinner";
import { useGuildApi } from "../api/hooks";
import type { Comparison, ComparisonIn } from "../api/types";
import { analyze, nextQuestion, pairKey, sameArray, sameSet, type RankAnalysis } from "./pairwise";
import { scopeFor, takeLegacyComparisons, usePairwiseSession } from "./session";

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
    <ol className="divide-y rounded-md border text-sm">
      {next.map((id, i) => {
        const item = byId.get(id);
        const before = oldIdx.get(id);
        const delta = before === undefined ? 0 : before - i;
        return (
          <li className="grid grid-cols-[3rem_minmax(0,1fr)_3.5rem] items-center gap-2 px-3 py-1.5" key={id}>
            <span className="text-muted-foreground tabular-nums">#{i + 1}</span>
            <span className="truncate font-medium">
              {item?.label ?? `(removed #${id})`}
              {item?.sublabel && <span className="font-normal text-muted-foreground"> ({item.sublabel})</span>}
            </span>
            <span className="flex items-center justify-end gap-0.5 text-xs tabular-nums">
              {delta > 0 ? (
                <span className="flex items-center gap-0.5 text-success"><ArrowUp className="size-3" /> {delta}<span className="sr-only"> up</span></span>
              ) : delta < 0 ? (
                <span className="flex items-center gap-0.5 text-destructive"><ArrowDown className="size-3" /> {-delta}<span className="sr-only"> down</span></span>
              ) : (
                <span className="text-muted-foreground">–</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function AnswersPanel({
  analysis,
  byId,
  onSwap,
  onDelete,
  busy,
  pendingKey,
}: {
  analysis: RankAnalysis;
  byId: Map<number, RankItem>;
  onSwap: (c: Comparison) => void;
  onDelete: (c: Comparison) => void;
  busy: boolean;
  pendingKey: string | null;
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
      <section className="grid gap-2">
        <h2>Your answers</h2>
        <p className="text-sm text-muted-foreground">Nothing yet. Answer a question above and it'll be saved here.</p>
      </section>
    );
  }

  return (
    <section className="grid gap-2">
      <h2>Your answers <span className="font-normal text-muted-foreground">{analysis.comparisons.length}</span></h2>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-8" placeholder="Filter answers…" aria-label="Filter answers"
                 value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {analysis.cycleCount > 0 && (
          <FilterChip active={onlyConflicts} onClick={() => setOnlyConflicts((v) => !v)}>Contradictions</FilterChip>
        )}
        <span className="text-sm text-muted-foreground">{rows.length} shown</span>
      </div>

      <ul className="divide-y rounded-lg border text-sm">
        {rows.map((c) => {
          const k = pairKey(c.winner_id, c.loser_id);
          const cyclic = analysis.cyclic.has(k);
          const overridden = analysis.overridden.has(k);
          const winner = byId.get(c.winner_id)?.label ?? `#${c.winner_id}`;
          const loser = byId.get(c.loser_id)?.label ?? `#${c.loser_id}`;
          return (
            <li className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1", cyclic && "bg-warning/10")} key={k}>
              <span className="min-w-0 truncate font-medium">{winner}</span>
              <span className="text-muted-foreground" title="is preferred over">›</span>
              <span className="min-w-0 truncate text-muted-foreground">{loser}</span>
              {(overridden || cyclic) && (
                <span className="flex items-center gap-1 text-xs"
                      title={overridden ? "Part of a preference cycle; this answer is currently being overridden" : "Part of a preference cycle"}>
                  <TriangleAlert className="size-3.5 text-warning" /> {overridden ? "overridden" : "in a cycle"}
                </span>
              )}
              <span className="ml-auto flex">
                <BusyButton variant="ghost" size="icon" className="size-7" title="Swap: the other one wins"
                            aria-label={`Swap: ${loser} wins`} disabled={busy} busy={pendingKey === k} busyLabel={null} onClick={() => onSwap(c)}>
                  <ArrowLeftRight />
                </BusyButton>
                <BusyButton variant="ghost" size="icon" className="size-7" title="Delete this answer"
                            aria-label={`Delete the answer ${winner} over ${loser}`} disabled={busy} busy={pendingKey === k} busyLabel={null} onClick={() => onDelete(c)}>
                  <X />
                </BusyButton>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const KBD = "rounded border bg-muted px-1 font-mono text-[0.7rem]";

/** One side of the question. */
function ChoiceCard({ item, keys, disabled, onChoose }: { item: RankItem; keys: string; disabled: boolean; onChoose: () => void }) {
  return (
    <button
      type="button"
      data-slot="rank-card"
      disabled={disabled}
      onClick={onChoose}
      className="flex min-h-36 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-card p-5 text-center shadow-xs transition-colors outline-none hover:border-primary hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60"
    >
      <span className="text-lg font-semibold break-words">{item.label}</span>
      {item.sublabel && <span className="text-sm text-muted-foreground">{item.sublabel}</span>}
      {item.meta && <span className="text-xs text-muted-foreground">{item.meta}</span>}
      <kbd className={cn(KBD, "mt-2 hidden sm:inline")}>{keys}</kbd>
    </button>
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
  const { guildId, userId } = useGuildApi();
  const { session, patch } = usePairwiseSession(scopeFor(userId, guildId, scopeKey));
  const [busy, setBusy] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
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
  const run = useCallback(async (fn: () => Promise<unknown>, key: string | null = null) => {
    setBusy(true);
    setPendingKey(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setBusy(false);
      setPendingKey(null);
    }
  }, []);

  const answer = useCallback(
    (winner_id: number, loser_id: number) => {
      patch((s) => ({ skipped: s.skipped.filter(([a, b]) => pairKey(a, b) !== pairKey(winner_id, loser_id)) }));
      void run(() => onAnswer({ winner_id, loser_id }), pairKey(winner_id, loser_id));
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
    }, "apply");
  }

  async function undoOrder() {
    const snap = session.undo;
    if (!snap) return;
    await run(async () => {
      if (!sameArray(snap.previous, ids)) await onApply(snap.previous);
      patch({ undo: null });
    }, "undo");
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

  const skipReset = skipped.size > 0 && (
    <Button variant="link" className="h-auto p-0 text-xs" onClick={resetSkips}>
      Reset {skipped.size} skip{skipped.size === 1 ? "" : "s"}
    </Button>
  );

  let questionBody: ReactNode;
  if (isLoading) {
    questionBody = <LoadingState label={`Loading ${nounPlural}…`} />;
  } else if (items.length < 2) {
    questionBody = <Notice>You need at least two {nounPlural} before there's anything to compare.</Notice>;
  } else if (analysis.complete) {
    questionBody = (
      <Notice tone="success">
        <span className="flex items-center gap-2">
          <CircleCheck className="size-4 shrink-0 text-success" />
          Your answers fully determine the order of all {items.length} {nounPlural}. Nothing left to ask.
        </span>
      </Notice>
    );
  } else if (blockedBySkips) {
    questionBody = <Notice>Every remaining comparison has been skipped. {skipReset}</Notice>;
  } else if (question) {
    questionBody = (
      <div className="grid gap-3">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Which do you prefer?</span>
          <span className="text-sm text-muted-foreground">Question {answered + 1} of about {estTotal}</span>
          {busy && <Spinner size="sm" label="Saving answer" />}
        </p>
        <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <ChoiceCard item={byId.get(question.a)!} keys="← or 1" disabled={busy} onChoose={() => answer(question.a, question.b)} />
          <span className="text-center text-sm text-muted-foreground">vs</span>
          <ChoiceCard item={byId.get(question.b)!} keys="→ or 2" disabled={busy} onChoose={() => answer(question.b, question.a)} />
        </div>
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Press <kbd className={KBD}>S</kbd> to skip</span>
          <Button variant="link" className="h-auto p-0 text-xs" onClick={skip} disabled={busy}>Skip this pair</Button>
          {skipReset}
        </p>
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      {tabs}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{title}</h1>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!answered || busy} onClick={() => setConfirmClear(true)}>Clear all answers</Button>
          <Button disabled={!answered || busy} onClick={() => setPreview(true)}>Preview suggested list</Button>
        </div>
      </div>

      {undoValid && session.undo && (
        <Notice tone="success">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              List replaced: <strong>{session.undo.next.reduce((n, id, i) => (session.undo!.previous[i] === id ? n : n + 1), 0)}</strong>{" "}
              {nounPlural} moved. Your answers are saved, so you can re-apply any time.
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => patch({ undo: null })}>Dismiss</Button>
              <BusyButton variant="outline" size="sm" busy={pendingKey === "undo"} disabled={busy} onClick={undoOrder}>Undo</BusyButton>
            </span>
          </div>
        </Notice>
      )}

      <div className="grid gap-1.5">
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
          <span><strong className="text-foreground">{answered}</strong> answered</span>
          <span>
            {analysis.complete
              ? <strong className="text-foreground">Fully determined</strong>
              : <>About <strong className="text-foreground">{analysis.remainingQuestions}</strong> more for a fully determined list</>}
          </span>
          <span>{analysis.determinedPairs.toLocaleString()} of {analysis.totalPairs.toLocaleString()} pairs ordered ({pairPct}%)</span>
          {answered > 0 && <span>Would move <strong className="text-foreground">{analysis.movedCount}</strong> of {items.length}</span>}
        </div>
        <div role="progressbar" aria-label="Ranking progress" aria-valuemin={0} aria-valuemax={100}
             aria-valuenow={Math.round(analysis.progress * 100)} className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${analysis.progress * 100}%` }} />
        </div>
      </div>

      {analysis.cycleCount > 0 && (
        <Notice tone="warning">
          {analysis.cycleCount} contradiction cycle{analysis.cycleCount === 1 ? "" : "s"} (e.g. A &gt; B &gt; C &gt; A).
          Members are ordered by how many of their own cycle-mates they beat; the{" "}
          {analysis.overridden.size} overridden answer{analysis.overridden.size === 1 ? "" : "s"} are flagged below.
        </Notice>
      )}

      {error && !preview && <Notice tone="error">{error}</Notice>}

      {questionBody}

      <AnswersPanel
        analysis={analysis}
        byId={byId}
        busy={busy}
        pendingKey={pendingKey}
        onSwap={(c) => answer(c.loser_id, c.winner_id)}
        onDelete={(c) => void run(() => onDeleteAnswer(c.winner_id, c.loser_id), pairKey(c.winner_id, c.loser_id))}
      />

      {preview && (
        <FormDialog
          title="Suggested order"
          onClose={() => setPreview(false)}
          onSubmit={() => void applyOrder()}
          busy={pendingKey === "apply"}
          error={error}
          submitDisabled={busy || !analysis.movedCount}
          submitLabel="Replace current list"
          busyLabel="Replacing…"
        >
          <p className="text-sm text-muted-foreground">
            Built from all {answered} answer{answered === 1 ? "" : "s"}.{" "}
            <strong className="text-foreground">{analysis.movedCount}</strong> of {items.length} {nounPlural} would move.
          </p>
          <OrderDiff previous={ids} next={analysis.order} byId={byId} />
        </FormDialog>
      )}

      {confirmClear && (
        <ConfirmDialog
          message={`Permanently delete all ${answered} stored answer${answered === 1 ? "" : "s"} for this list?`}
          busy={pendingKey === "clear"}
          onConfirm={() => { void run(() => onClearAnswers(), "clear").then(() => setConfirmClear(false)); }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </section>
  );
}
