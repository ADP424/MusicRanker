import { describe, expect, it } from "vitest";

import { analyze, nextQuestion, pairKey, type Comparison } from "./pairwise";

const beats = (winner_id: number, loser_id: number): Comparison => ({ winner_id, loser_id });

/** Answers every question the way `truth` (best first) says, until done. */
function runToCompletion(start: number[], truth: number[], limit = 1000) {
  const rank = new Map(truth.map((id, i) => [id, i]));
  const answers: Comparison[] = [];
  for (let asked = 0; asked < limit; asked++) {
    const q = nextQuestion(analyze(start, answers));
    if (!q) return { answers, analysis: analyze(start, answers) };
    answers.push(rank.get(q.a)! < rank.get(q.b)! ? beats(q.a, q.b) : beats(q.b, q.a));
  }
  throw new Error("never finished");
}

describe("analyze", () => {
  it("keeps the current order when there are no answers", () => {
    const a = analyze([3, 1, 2], []);
    expect(a.order).toEqual([3, 1, 2]);
    expect(a.movedCount).toBe(0);
    expect(a.complete).toBe(false);
  });

  it("honours an answer without flinging the item across the list", () => {
    // #5 beat #1: they meet in the middle rather than #5 jumping to the top.
    const a = analyze([1, 2, 3, 4, 5], [beats(5, 1)]);
    expect(a.order.indexOf(5)).toBeLessThan(a.order.indexOf(1));
    expect(a.relation(5, 1)).toBe(-1);
  });

  it("follows transitive answers", () => {
    const a = analyze([1, 2, 3], [beats(3, 2), beats(2, 1)]);
    expect(a.order).toEqual([3, 2, 1]);
    expect(a.relation(3, 1)).toBe(-1);
    expect(a.complete).toBe(true);
  });

  it("detects a contradiction cycle and still produces a total order", () => {
    const a = analyze([1, 2, 3], [beats(1, 2), beats(2, 3), beats(3, 1)]);
    expect(a.cycleCount).toBe(1);
    expect(a.cyclic.has(pairKey(1, 2))).toBe(true);
    expect([...a.order].sort()).toEqual([1, 2, 3]);
  });

  it("lets the latest answer for a pair win", () => {
    const a = analyze([1, 2], [
      { winner_id: 1, loser_id: 2, created_at: "2026-01-01T00:00:00Z" },
      { winner_id: 2, loser_id: 1, created_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(a.order).toEqual([2, 1]);
  });

  it("ignores answers about items no longer in the list", () => {
    const a = analyze([1, 2], [beats(9, 1), beats(2, 1)]);
    expect(a.order).toEqual([2, 1]);
  });
});

describe("nextQuestion", () => {
  it("never asks a pair that's already answered", () => {
    const a = analyze([1, 2, 3, 4], [beats(1, 2)]);
    const q = nextQuestion(a)!;
    expect(pairKey(q.a, q.b)).not.toBe(pairKey(1, 2));
  });

  it("sorts any list into the true order", () => {
    const truth = [7, 3, 9, 1, 5, 2, 8, 6, 4, 10];
    const { analysis } = runToCompletion([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], truth);
    expect(analysis.order).toEqual(truth);
    expect(analysis.complete).toBe(true);
    expect(analysis.progress).toBeCloseTo(1);
  });

  it("asks about as few questions as binary insertion needs", () => {
    const n = 32;
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const truth = [...ids].reverse(); // worst case for the starting order
    const { answers } = runToCompletion(ids, truth);
    let bound = 0;
    for (let k = 2; k <= n; k++) bound += Math.ceil(Math.log2(k));
    expect(answers.length).toBeLessThanOrEqual(bound);
  });

  it("has nothing to ask once the order is fully determined", () => {
    expect(nextQuestion(analyze([1, 2, 3], [beats(1, 2), beats(2, 3)]))).toBeNull();
  });
});
