import type { GenreLike } from "./config";

/** Stable key for one parent → child link. */
export const edgeKey = (parentId: number, childId: number) => `${parentId}->${childId}`;

export interface CycleReport {
  /** Each loop as the chain that closes it, e.g. [A, B, C, A]. */
  cycles: number[][];
  /** Every id taking part in at least one loop. */
  nodeIds: Set<number>;
  /** parent → child links that close a loop. Skip these to get an acyclic view. */
  backEdges: Set<string>;
  hasCycles: boolean;
}

const EMPTY: CycleReport = {
  cycles: [],
  nodeIds: new Set(),
  backEdges: new Set(),
  hasCycles: false,
};

/** Rotate a loop so its smallest id leads, so [A,B,A] and [B,A,B] dedupe. */
function canonicalKey(loop: number[]): string {
  const ring = loop.slice(0, -1); // drop the repeated closing id
  const at = ring.indexOf(Math.min(...ring));
  return [...ring.slice(at), ...ring.slice(0, at)].join(">");
}

/**
 * White/grey/black DFS over the parent → child graph.
 *
 * Iterative rather than recursive: the data is user-authored and may be
 * arbitrarily deep, and a stack overflow is no better than the hang we're
 * fixing. Any edge reaching a *grey* node closes a cycle — it is recorded and
 * not traversed, so callers get a guaranteed-acyclic view of the graph plus an
 * exact description of what's wrong with the data.
 *
 * O(V + E), and safe on any input, including parents pointing outside `genres`
 * (which happens whenever the list is filtered by category).
 */
export function findCycles(genres: GenreLike[]): CycleReport {
  if (genres.length === 0) return EMPTY;

  const present = new Set(genres.map((g) => g.id));
  const childrenOf = new Map<number, number[]>();
  for (const g of genres) {
    for (const pid of g.parent_ids) {
      if (!present.has(pid)) continue;
      const list = childrenOf.get(pid);
      if (list) list.push(g.id);
      else childrenOf.set(pid, [g.id]);
    }
  }

  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<number, number>(genres.map((g) => [g.id, WHITE]));

  const backEdges = new Set<string>();
  const cycles: number[][] = [];
  const nodeIds = new Set<number>();
  const seenLoops = new Set<string>();

  for (const root of genres) {
    if (colour.get(root.id) !== WHITE) continue;

    const path: number[] = [root.id];
    const stack: { id: number; next: number }[] = [{ id: root.id, next: 0 }];
    colour.set(root.id, GREY);

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const kids = childrenOf.get(frame.id) ?? [];

      if (frame.next < kids.length) {
        const child = kids[frame.next++];
        const c = colour.get(child);
        if (c === GREY) {
          backEdges.add(edgeKey(frame.id, child));
          const loop = [...path.slice(path.indexOf(child)), child];
          const key = canonicalKey(loop);
          if (!seenLoops.has(key)) {
            seenLoops.add(key);
            cycles.push(loop);
          }
          for (const id of loop) nodeIds.add(id);
        } else if (c === WHITE) {
          colour.set(child, GREY);
          path.push(child);
          stack.push({ id: child, next: 0 });
        }
      } else {
        colour.set(frame.id, BLACK);
        stack.pop();
        path.pop();
      }
    }
  }

  return { cycles, nodeIds, backEdges, hasCycles: cycles.length > 0 };
}
