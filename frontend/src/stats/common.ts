import type { Col, Row, ScatterDef, StatDef } from "./EntityStatsPage";

/** Pieces most stats configs share. */
export const decade = (key: string, label: string): StatDef => ({ key, label, fmt: "decade" });
export const yearCol: Col = { key: "year", label: "Year", numeric: true };
export const decadeCol: Col = { key: "decade", label: "Decade", numeric: true, fmt: "decade" };
export const count = (key: string, label: string): Col => ({ key, label, numeric: true, fmt: "int" });
export const score = (key: string, label: string): Col => ({ key, label, numeric: true, fmt: "score" });
export const num = (key: string, label: string): Col => ({ key, label, numeric: true, fmt: "num" });

/** A 0..1 score as a percentage. */
export const n4 = (v: unknown) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");
export const n2 = (v: unknown) => (typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—");

/** A scatter of score against something, with a "name / score / thing" tooltip. */
export function scoreScatter(
  title: string, from: string, x: { key: string; label: string; unit?: string }, y: "score" | "avg_score" = "score",
  extra?: (d: Row) => string,
): ScatterDef {
  const yLabel = y === "score" ? "Score" : "Avg score";
  return {
    title, from, x: { key: x.key, label: x.label }, y: { key: y, label: yLabel },
    tip: (d) => [String(d.name ?? ""), ...(extra ? [extra(d)] : []), `${yLabel}: ${n4(d[y])}`, `${x.label}: ${n2(d[x.key])}${x.unit ?? ""}`],
  };
}
