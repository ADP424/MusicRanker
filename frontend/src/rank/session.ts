import { useCallback, useEffect, useRef, useState } from "react";

const VERSION = 2;
const PREFIX = "mediaranker.pairwise.v2:";
/** v1 kept the answers here; they're migrated into the DB on first load. */
export const LEGACY_PREFIX = "mediaranker.pairwise.v1:";

export interface UndoSnapshot {
  previous: number[];
  next: number[];
  at: number;
}

export interface PairwiseSession {
  version: number;
  skipped: [number, number][];
  undo: UndoSnapshot | null;
}

const EMPTY: PairwiseSession = { version: VERSION, skipped: [], undo: null };

function read(scope: string): PairwiseSession {
  try {
    const raw = localStorage.getItem(PREFIX + scope);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION) return EMPTY;
    return { ...EMPTY, ...parsed };
  } catch {
    return EMPTY;
  }
}

function write(scope: string, s: PairwiseSession) {
  try {
    localStorage.setItem(PREFIX + scope, JSON.stringify(s));
  } catch {
    /* private mode / quota */
  }
}

type Patch = Partial<PairwiseSession> | ((s: PairwiseSession) => Partial<PairwiseSession>);

export function usePairwiseSession(scope: string) {
  const [session, setSession] = useState<PairwiseSession>(() => read(scope));

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSession(read(scope));
  }, [scope]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFIX + scope) setSession(read(scope));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [scope]);

  const patch = useCallback(
    (p: Patch) => {
      setSession((prev) => {
        const delta = typeof p === "function" ? p(prev) : p;
        if (!Object.keys(delta).length) return prev;
        const next = { ...prev, ...delta, version: VERSION };
        write(scope, next);
        return next;
      });
    },
    [scope],
  );

  return { session, patch };
}

/** Pull v1's localStorage answers out once, so the DB migration is seamless. */
export function takeLegacyComparisons(scope: string): { winner_id: number; loser_id: number }[] {
  const key = LEGACY_PREFIX + scope;
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  localStorage.removeItem(key);
  try {
    const old = JSON.parse(raw);
    const list = Array.isArray(old?.comparisons) ? old.comparisons : [];
    return list
      .filter((c: unknown): c is { winner: number; loser: number } =>
        !!c && typeof (c as { winner?: unknown }).winner === "number",
      )
      .map((c: { winner: number; loser: number }) => ({ winner_id: c.winner, loser_id: c.loser }));
  } catch {
    return [];
  }
}
