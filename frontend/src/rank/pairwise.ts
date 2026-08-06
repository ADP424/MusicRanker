/**
 * Deterministic pairwise ranking.
 *
 * The stored answers are a digraph (winner → loser). Everything below is a pure
 * function of (current list order, answer set) — no randomness, no tuning
 * constants, no iteration counts. Answer one more question and the result can
 * only become *more* determined, never different-by-luck.
 *
 *   analyze()       the hierarchy + the suggested order + progress metrics
 *   nextQuestion()  the next pair to ask (deterministic, never a known pair)
 *
 * ── the hierarchy ──────────────────────────────────────────────────────────
 * Tarjan's SCC algorithm condenses the answer graph. Every non-trivial SCC is a
 * contradiction (A > B > C > A); the condensation is a genuine strict partial
 * order. Inside a cycle we fall back to the Copeland score (wins − losses within
 * the cycle), tie-broken by current list position — deterministic, and we
 * surface exactly which answers that overrode.
 *
 * ── the suggested order ────────────────────────────────────────────────────
 * Each condensation node targets the mean current index of its members. We then
 * run a generalised pool-adjacent-violators pass: while some edge u→v has
 * target[u] > target[v], pool the whole interval descendants(u) ∩ ancestors(v)
 * at their weighted mean. (Pooling a closed interval of a DAG keeps it acyclic.)
 * That is the isotonic projection of the user's list onto the constraint cone —
 * so "#100 beats #1" makes them meet in the middle instead of flinging one of
 * them across the list. A priority topological sort then linearises, so every
 * non-cyclic answer is honoured and everything unconstrained keeps its place.
 *
 * ── the questions ──────────────────────────────────────────────────────────
 * Any correct comparison sort is a certifying oracle: if it finishes without
 * ever needing an unknown pair, the answers already determine a unique total
 * order; and the first unknown pair it needs cannot be settled by any transitive
 * chain. We use binary insertion sort over the current list — Σ⌈log₂k⌉ ≈
 * log₂(n!) + n/2 comparisons, within a few percent of the information floor,
 * and every probe bisects, i.e. carries ≈1 bit.
 *
 * ── "how many more?" ───────────────────────────────────────────────────────
 * Decompose the partial order into chains (greedy longest-weighted-path peeling;
 * each SCC is a chain of its own size). A disjoint union of chains admits
 * n!/Πcᵢ! linear extensions, so `remainingBits = log₂(n!) − Σlog₂(cᵢ!)` and each
 * comparison yields at most one bit. Exact at both ends: 0 answers + n=10 → 22
 * (Ford–Johnson's optimum); fully determined → 0.
 */

export interface Comparison {
  winner_id: number;
  loser_id: number;
  created_at?: string | null;
}

export interface Pair {
  a: number;
  b: number;
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function sameArray(x: number[], y: number[]): boolean {
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export function sameSet(x: number[], y: number[]): boolean {
  if (x.length !== y.length) return false;
  const s = new Set(x);
  return y.every((v) => s.has(v));
}

export interface RankAnalysis {
  /** The list exactly as the user currently has it (ids, best first). */
  ids: number[];
  index: Map<number, number>;
  /** Live, deduped answers (latest wins per unordered pair). */
  comparisons: Comparison[];
  answeredKeys: Set<string>;
  /** The suggested order. */
  order: number[];
  movedCount: number;
  /** -1 ⇒ x before y, +1 ⇒ y before x, 0 ⇒ not determined. */
  relation: (x: number, y: number) => number;
  /** pairKeys of answers that sit inside a contradiction cycle. */
  cyclic: Set<string>;
  /** pairKeys of answers the cycle resolver had to override outright. */
  overridden: Set<string>;
  cycleCount: number;
  determinedPairs: number;
  totalPairs: number;
  remainingQuestions: number;
  /** bits gathered / bits needed, 0..1 */
  progress: number;
  complete: boolean;
}

// ── tiny utilities ─────────────────────────────────────────────────────────────

class MinHeap<T> {
  private a: T[] = [];
  constructor(private readonly before: (x: T, y: T) => boolean) {}
  get size() {
    return this.a.length;
  }
  push(v: T) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.before(a[l], a[m])) m = l;
        if (r < a.length && this.before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

function log2FactTable(n: number): Float64Array {
  const t = new Float64Array(n + 1);
  for (let k = 2; k <= n; k++) t[k] = t[k - 1] + Math.log2(k);
  return t;
}

/** Topological sort that always emits the available node with the best priority. */
function priorityTopoSort(
  nodes: number[],
  succ: Map<number, number[]>,
  before: (x: number, y: number) => boolean,
): number[] {
  const indeg = new Map<number, number>();
  for (const n of nodes) indeg.set(n, 0);
  for (const n of nodes) for (const v of succ.get(n) ?? []) indeg.set(v, (indeg.get(v) ?? 0) + 1);

  const heap = new MinHeap<number>(before);
  for (const n of nodes) if (indeg.get(n) === 0) heap.push(n);

  const out: number[] = [];
  while (heap.size) {
    const u = heap.pop()!;
    out.push(u);
    for (const v of succ.get(u) ?? []) {
      const d = indeg.get(v)! - 1;
      indeg.set(v, d);
      if (d === 0) heap.push(v);
    }
  }
  if (out.length < nodes.length) {
    const seen = new Set(out); // defensive; the graph is always a DAG here
    for (const n of nodes) if (!seen.has(n)) out.push(n);
  }
  return out;
}

// ── answer graph ───────────────────────────────────────────────────────────────

function dedupe(raw: Comparison[], live: Set<number>): Comparison[] {
  const m = new Map<string, Comparison>();
  for (const c of raw) {
    if (c.winner_id === c.loser_id) continue;
    if (!live.has(c.winner_id) || !live.has(c.loser_id)) continue;
    m.set(pairKey(c.winner_id, c.loser_id), c);
  }
  return [...m.values()];
}

/** Iterative Tarjan. Components come out in reverse-topological order, i.e. every
 *  successor of component c has an id strictly less than c's. */
function tarjan(nodes: number[], adj: Map<number, number[]>) {
  const idx = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const comp = new Map<number, number>();
  const members: number[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (idx.has(root)) continue;
    idx.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);
    const work: { v: number; pi: number }[] = [{ v: root, pi: 0 }];

    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame.v;
      const children = adj.get(v) ?? [];
      if (frame.pi < children.length) {
        const w = children[frame.pi++];
        if (!idx.has(w)) {
          idx.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, pi: 0 });
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        }
      } else {
        work.pop();
        if (work.length) {
          const u = work[work.length - 1].v;
          low.set(u, Math.min(low.get(u)!, low.get(v)!));
        }
        if (low.get(v) === idx.get(v)) {
          const group: number[] = [];
          for (;;) {
            const w = stack.pop()!;
            onStack.delete(w);
            group.push(w);
            if (w === v) break;
          }
          const cid = members.length;
          for (const g of group) comp.set(g, cid);
          members.push(group);
        }
      }
    }
  }
  return { comp, members };
}

/** Copeland order inside a contradiction cycle, tie-broken by current position. */
function internalOrder(group: number[], adj: Map<number, number[]>, index: Map<number, number>): number[] {
  if (group.length === 1) return [...group];
  const inGroup = new Set(group);
  const score = new Map<number, number>(group.map((g) => [g, 0]));
  for (const u of group) {
    for (const v of adj.get(u) ?? []) {
      if (!inGroup.has(v)) continue;
      score.set(u, score.get(u)! + 1);
      score.set(v, score.get(v)! - 1);
    }
  }
  return [...group].sort((x, y) => score.get(y)! - score.get(x)! || index.get(x)! - index.get(y)!);
}

// ── suggested order: generalised PAVA + priority topological sort ──────────────

interface Agg {
  sumTarget: number; // Σ weight·target
  weight: number;
  minIndex: number;
  comps: number[];
}

function computeOrder(
  _ids: number[],
  index: Map<number, number>,
  compMembers: number[][], // already in internal order
  crossEdges: [number, number][], // comp → comp, deduped & canonically sorted
): number[] {
  const C = compMembers.length;
  if (!C) return [];

  // union–find over components; each root is a pooled block
  const parent = new Int32Array(C);
  for (let c = 0; c < C; c++) parent[c] = c;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const agg = new Map<number, Agg>();
  for (let c = 0; c < C; c++) {
    let sum = 0;
    let min = Infinity;
    for (const m of compMembers[c]) {
      const i = index.get(m)!;
      sum += i;
      if (i < min) min = i;
    }
    agg.set(c, { sumTarget: sum, weight: compMembers[c].length, minIndex: min, comps: [c] });
  }
  const target = (root: number) => {
    const a = agg.get(root)!;
    return a.sumTarget / a.weight;
  };

  // Pool until the block DAG is monotone in `target`.
  for (;;) {
    let bad: [number, number] | null = null;
    for (const [ca, cb] of crossEdges) {
      const u = find(ca);
      const v = find(cb);
      if (u === v) continue;
      if (target(u) > target(v)) {
        bad = [u, v];
        break; // crossEdges is canonically ordered ⇒ deterministic choice
      }
    }
    if (!bad) break;
    const [u, v] = bad;

    // Current block adjacency
    const fwd = new Map<number, number[]>();
    const rev = new Map<number, number[]>();
    for (const [ca, cb] of crossEdges) {
      const a = find(ca);
      const b = find(cb);
      if (a === b) continue;
      (fwd.get(a) ?? fwd.set(a, []).get(a)!).push(b);
      (rev.get(b) ?? rev.set(b, []).get(b)!).push(a);
    }
    const bfs = (start: number, g: Map<number, number[]>) => {
      const seen = new Set<number>([start]);
      const q = [start];
      while (q.length) {
        const x = q.pop()!;
        for (const y of g.get(x) ?? []) if (!seen.has(y)) (seen.add(y), q.push(y));
      }
      return seen;
    };
    const desc = bfs(u, fwd);
    const anc = bfs(v, rev);
    const interval = [...desc].filter((x) => anc.has(x)); // always contains u and v

    // Merge the interval into one block: isotonicity forces them all equal.
    let sum = 0;
    let weight = 0;
    let minIndex = Infinity;
    const comps: number[] = [];
    for (const r of interval) {
      const a = agg.get(r)!;
      sum += a.sumTarget;
      weight += a.weight;
      minIndex = Math.min(minIndex, a.minIndex);
      comps.push(...a.comps);
      agg.delete(r);
    }
    const root = Math.min(...interval);
    for (const r of interval) parent[r] = root;
    comps.sort((x, y) => x - y);
    agg.set(root, { sumTarget: sum, weight, minIndex, comps });
  }

  // Linearise the blocks.
  const roots = [...agg.keys()];
  const blockSucc = new Map<number, number[]>();
  for (const r of roots) blockSucc.set(r, []);
  const seenEdge = new Set<string>();
  for (const [ca, cb] of crossEdges) {
    const a = find(ca);
    const b = find(cb);
    if (a === b) continue;
    const k = `${a}>${b}`;
    if (seenEdge.has(k)) continue;
    seenEdge.add(k);
    blockSucc.get(a)!.push(b);
  }
  const blockOrder = priorityTopoSort(roots, blockSucc, (x, y) => {
    const tx = target(x);
    const ty = target(y);
    if (tx !== ty) return tx < ty;
    const mx = agg.get(x)!.minIndex;
    const my = agg.get(y)!.minIndex;
    if (mx !== my) return mx < my;
    return x < y;
  });

  // Expand each block: its components, then each component's members.
  const compMinIndex = (c: number) => Math.min(...compMembers[c].map((m) => index.get(m)!));
  const out: number[] = [];
  for (const root of blockOrder) {
    const comps = agg.get(root)!.comps;
    if (comps.length === 1) {
      out.push(...compMembers[comps[0]]);
      continue;
    }
    const inBlock = new Set(comps);
    const succ = new Map<number, number[]>(comps.map((c) => [c, [] as number[]]));
    for (const [ca, cb] of crossEdges) {
      if (inBlock.has(ca) && inBlock.has(cb)) succ.get(ca)!.push(cb);
    }
    const compOrder = priorityTopoSort(comps, succ, (x, y) => {
      const mx = compMinIndex(x);
      const my = compMinIndex(y);
      return mx !== my ? mx < my : x < y;
    });
    for (const c of compOrder) out.push(...compMembers[c]);
  }
  return out;
}

// ── main entry point ───────────────────────────────────────────────────────────

export function analyze(currentOrder: number[], rawComparisons: Comparison[]): RankAnalysis {
  const ids = [...currentOrder];
  const n = ids.length;
  const index = new Map<number, number>();
  ids.forEach((id, i) => index.set(id, i));
  const live = new Set(ids);

  const comparisons = dedupe(rawComparisons, live);
  const answeredKeys = new Set(comparisons.map((c) => pairKey(c.winner_id, c.loser_id)));

  // Adjacency, canonically sorted so everything downstream is deterministic.
  const adj = new Map<number, number[]>(ids.map((id) => [id, [] as number[]]));
  for (const c of comparisons) adj.get(c.winner_id)!.push(c.loser_id);
  for (const list of adj.values()) list.sort((x, y) => index.get(x)! - index.get(y)!);

  const { comp, members } = tarjan(ids, adj);
  const compMembers = members.map((g) => internalOrder(g, adj, index));
  const C = compMembers.length;
  const compSize = compMembers.map((m) => m.length);
  const posInComp = new Map<number, number>();
  compMembers.forEach((m) => m.forEach((id, i) => posInComp.set(id, i)));

  // Cross-component edges (the real hierarchy), canonical order.
  const edgeSet = new Set<string>();
  const crossEdges: [number, number][] = [];
  for (const c of comparisons) {
    const a = comp.get(c.winner_id)!;
    const b = comp.get(c.loser_id)!;
    if (a === b) continue;
    const k = `${a}>${b}`;
    if (edgeSet.has(k)) continue;
    edgeSet.add(k);
    crossEdges.push([a, b]);
  }
  crossEdges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  // Contradiction bookkeeping.
  const cyclic = new Set<string>();
  const overridden = new Set<string>();
  let cycleCount = 0;
  for (let c = 0; c < C; c++) if (compSize[c] > 1) cycleCount++;
  for (const cmp of comparisons) {
    if (comp.get(cmp.winner_id) !== comp.get(cmp.loser_id)) continue;
    const k = pairKey(cmp.winner_id, cmp.loser_id);
    cyclic.add(k);
    if (posInComp.get(cmp.winner_id)! > posInComp.get(cmp.loser_id)!) overridden.add(k);
  }

  // ── reachability over the "active" components (those touching an edge, plus
  //    the cycles). Everything else is incomparable to everything.
  const active: number[] = [];
  const isActive = new Uint8Array(C);
  for (const [a, b] of crossEdges) {
    isActive[a] = 1;
    isActive[b] = 1;
  }
  for (let c = 0; c < C; c++) if (compSize[c] > 1) isActive[c] = 1;
  for (let c = 0; c < C; c++) if (isActive[c]) active.push(c); // ascending = successors first
  const slot = new Map<number, number>();
  active.forEach((c, i) => slot.set(c, i));

  const A = active.length;
  const W = Math.max(1, (A + 31) >> 5);
  const reach = new Uint32Array(A * W);
  const succOf = new Map<number, number[]>(active.map((c) => [c, [] as number[]]));
  for (const [a, b] of crossEdges) succOf.get(a)!.push(b);

  for (let i = 0; i < A; i++) {
    const c = active[i];
    for (const s of succOf.get(c)!) {
      const j = slot.get(s)!; // j < i, because successors get smaller component ids
      reach[i * W + (j >> 5)] |= 1 << (j & 31);
      for (let w = 0; w < W; w++) reach[i * W + w] |= reach[j * W + w];
    }
  }
  const reaches = (ci: number, cj: number) => {
    const i = slot.get(ci);
    const j = slot.get(cj);
    if (i === undefined || j === undefined) return false;
    return (reach[i * W + (j >> 5)] & (1 << (j & 31))) !== 0;
  };

  const relation = (x: number, y: number): number => {
    if (x === y) return 0;
    const cx = comp.get(x);
    const cy = comp.get(y);
    if (cx === undefined || cy === undefined) return 0;
    if (cx === cy) return posInComp.get(x)! < posInComp.get(y)! ? -1 : 1;
    if (reaches(cx, cy)) return -1;
    if (reaches(cy, cx)) return 1;
    return 0;
  };

  // ── determined pairs ─────────────────────────────────────────────────────────
  const totalPairs = (n * (n - 1)) / 2;
  let determinedPairs = 0;
  for (let c = 0; c < C; c++) determinedPairs += (compSize[c] * (compSize[c] - 1)) / 2;
  for (let i = 0; i < A; i++) {
    for (let j = 0; j < A; j++) {
      if (i === j) continue;
      if (reach[i * W + (j >> 5)] & (1 << (j & 31))) determinedPairs += compSize[active[i]] * compSize[active[j]];
    }
  }

  // ── remaining questions: log₂(n!) − Σ log₂(chainᵢ!) ──────────────────────────
  const LF = log2FactTable(n);
  const totalBits = LF[n];
  let chainBits = 0;
  {
    const remaining = new Set(active);
    while (remaining.size) {
      // longest weighted path, processed in reverse-topological (ascending) order
      const best = new Map<number, number>();
      const nextOf = new Map<number, number>();
      let bestNode = -1;
      let bestVal = -1;
      for (const c of active) {
        if (!remaining.has(c)) continue;
        let extra = 0;
        let pick = -1;
        for (const s of succOf.get(c)!) {
          if (!remaining.has(s)) continue;
          const v = best.get(s) ?? 0;
          if (v > extra || (v === extra && pick === -1)) {
            extra = v;
            pick = s;
          }
        }
        const val = compSize[c] + extra;
        best.set(c, val);
        if (pick >= 0) nextOf.set(c, pick);
        if (val > bestVal || (val === bestVal && c < bestNode)) {
          bestVal = val;
          bestNode = c;
        }
      }
      let len = 0;
      for (let c: number | undefined = bestNode; c !== undefined && remaining.has(c); c = nextOf.get(c)) {
        len += compSize[c];
        remaining.delete(c);
      }
      chainBits += LF[len];
    }
    // every unanswered item is a chain of length 1 and contributes log₂(1!) = 0
  }
  const remainingBits = Math.max(0, totalBits - chainBits);
  const remainingQuestions = Math.max(0, Math.ceil(remainingBits - 1e-9));
  const progress = totalBits > 0 ? Math.min(1, (totalBits - remainingBits) / totalBits) : 1;

  const order = computeOrder(ids, index, compMembers, crossEdges);
  let movedCount = 0;
  for (let i = 0; i < n; i++) if (order[i] !== ids[i]) movedCount++;

  return {
    ids,
    index,
    comparisons,
    answeredKeys,
    order,
    movedCount,
    relation,
    cyclic,
    overridden,
    cycleCount,
    determinedPairs,
    totalPairs,
    remainingQuestions,
    progress,
    complete: n < 2 || determinedPairs >= totalPairs,
  };
}

/**
 * Binary insertion sort over the current list, using the answers as the oracle.
 * The first pair the sort cannot resolve is the question. Pairs the user has
 * already answered (directly, transitively, or inside a resolved cycle) are
 * never asked. `skipped` lets the user pass on a pair: we then assume the list's
 * own order for that probe and keep walking, which surfaces a different question.
 */
export function nextQuestion(a: RankAnalysis, skipped: Set<string> = new Set()): Pair | null {
  const { ids, relation, index } = a;
  if (ids.length < 2) return null;

  const sorted: number[] = [];
  for (const item of ids) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const other = sorted[mid];
      let r = relation(item, other);
      if (r === 0) {
        const k = pairKey(item, other);
        if (!skipped.has(k)) {
          // Present the entry currently nearer the top of the list on the left.
          return index.get(other)! < index.get(item)! ? { a: other, b: item } : { a: item, b: other };
        }
        r = index.get(item)! < index.get(other)! ? -1 : 1;
      }
      if (r < 0) hi = mid;
      else lo = mid + 1;
    }
    sorted.splice(lo, 0, item);
  }
  return null;
}
