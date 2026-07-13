import { useState } from "react";

// ---------------------------------------------------------------------------
// Chart colours — light enough to show on a dark background
// ---------------------------------------------------------------------------
export const C1 = "#c8d8e8";  // soft blue-grey
export const C2 = "#d8c8e0";  // soft lavender
export const SCATTER_FILL = "#c0ccd8";

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value ?? "—"}</span>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="stats-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function ChartWrap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="chart-wrap">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function fmt2(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Sortable Table
// ---------------------------------------------------------------------------

export type ColDef = {
  key: string;
  label: string;
  fmt?: (v: any) => string;
  numeric?: boolean;
};

export function Table({ cols, rows }: { cols: ColDef[]; rows: Record<string, any>[] }) {
  const [sortKey, setSortKey] = useState<string>(cols[0].key);
  const [sortAsc, setSortAsc] = useState(true);

  function handleSort(key: string) {
    if (key === sortKey) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return sortAsc ? cmp : -cmp;
  });

  return (
    <div className="stats-table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                className="sortable-th"
                onClick={() => handleSort(c.key)}
              >
                {c.label}
                <span className="sort-arrow">
                  {sortKey === c.key ? (sortAsc ? " ▲" : " ▼") : " ⇅"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key}>{c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? "—")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
