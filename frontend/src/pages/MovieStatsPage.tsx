import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";

import { api } from "../api/client";
import type {
  MovieDecadeRow, MovieGenreRow, MovieNatRow,
  MovieStatsSummary, MovieYearRow, ScatterPoint,
} from "../api/types";

const useSummary  = () => useQuery({ queryKey: ["movie-stats", "summary"],   queryFn: () => api.get<MovieStatsSummary>("/movie-stats/summary") });
const useByYear   = () => useQuery({ queryKey: ["movie-stats", "by-year"],   queryFn: () => api.get<MovieYearRow[]>("/movie-stats/by-year") });
const useByDecade = () => useQuery({ queryKey: ["movie-stats", "by-decade"], queryFn: () => api.get<MovieDecadeRow[]>("/movie-stats/by-decade") });
const useByNat    = () => useQuery({ queryKey: ["movie-stats", "by-nat"],    queryFn: () => api.get<{ core_nationality: MovieNatRow[]; birth_nationality: MovieNatRow[] }>("/movie-stats/by-nationality") });
const useByGenre  = () => useQuery({ queryKey: ["movie-stats", "by-genre"],  queryFn: () => api.get<{ by_genre: MovieGenreRow[]; by_root_genre: MovieGenreRow[] }>("/movie-stats/by-genre") });
const useScatter  = () => useQuery({ queryKey: ["movie-stats", "scatter"],   queryFn: () => api.get<{
  movie_score_vs_runtime: ScatterPoint[];
  cast_member_score_vs_runtime: ScatterPoint[];
}>("/movie-stats/scatter") });

const C1 = "#c8d8e8";
const C2 = "#d8c8e0";
const SCATTER_FILL = "#c0ccd8";

function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value ?? "—"}</span>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="stats-section"><h2>{title}</h2>{children}</section>;
}
function ChartWrap({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="chart-wrap"><h3>{title}</h3>{children}</div>;
}
function fmt2(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

type ColDef = { key: string; label: string; fmt?: (v: any) => string; numeric?: boolean };

function Table({ cols, rows }: { cols: ColDef[]; rows: Record<string, any>[] }) {
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
              <th key={c.key} className="sortable-th" onClick={() => handleSort(c.key)}>
                {c.label}
                <span className="sort-arrow">{sortKey === c.key ? (sortAsc ? " ▲" : " ▼") : " ⇅"}</span>
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

const TABS = ["Stats", "Graphs"] as const;
type Tab = typeof TABS[number];

export function MovieStatsPage() {
  const [tab, setTab] = useState<Tab>("Stats");

  const { data: summary, isLoading } = useSummary();
  const { data: byYear   = [] } = useByYear();
  const { data: byDecade = [] } = useByDecade();
  const { data: byNat }         = useByNat();
  const { data: byGenre }       = useByGenre();
  const { data: scatter }       = useScatter();

  if (isLoading || !summary) return <p>Loading…</p>;

  const coreNat    = byNat?.core_nationality  ?? [];
  const birthNat   = byNat?.birth_nationality ?? [];
  const allGenres  = byGenre?.by_genre        ?? [];
  const rootGenres = byGenre?.by_root_genre   ?? [];

  const natCols: ColDef[] = [
    { key: "nationality",     label: "Nationality" },
    { key: "movie_count",     label: "Movies",          numeric: true },
    { key: "avg_movie_score", label: "Avg Movie Score", numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
  ];
  const genreCols: ColDef[] = [
    { key: "genre_name",         label: "Genre" },
    { key: "movie_count",        label: "Movies",         numeric: true },
    { key: "movie_count_direct", label: "Movies (direct)",numeric: true },
    { key: "avg_movie_score",    label: "Avg Movie Score",numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
  ];

  return (
    <div className="stats-page">
      <div className="stats-tabs">
        {TABS.map((t) => (
          <button key={t} className={`stats-tab${tab === t ? " stats-tab-active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "Stats" && (
        <>
          <Section title="Totals">
            <StatGrid>
              <Stat label="Total Cast Members"       value={summary.total_cast_members} />
              <Stat label="Total Movies"              value={summary.total_movies} />
              <Stat label="Avg Movies / Cast Member"  value={fmt2(summary.avg_movies_per_cast_member)} />
            </StatGrid>
          </Section>

          <Section title="Unique Movie Runtime">
            <StatGrid>
              <Stat label="Total (hours)" value={fmt2(summary.unique_runtime_hours)} />
              <Stat label="Total (days)"  value={fmt2(summary.unique_runtime_days)} />
              <Stat label="Avg (hours)"   value={fmt2(summary.avg_movie_runtime_hours)} />
            </StatGrid>
          </Section>

          <Section title="Total Watched Runtime">
            <StatGrid>
              <Stat label="Total (hours)" value={fmt2(summary.total_watched_hours)} />
              <Stat label="Total (days)"  value={fmt2(summary.total_watched_days)} />
              <Stat label="Avg (hours)"   value={fmt2(summary.avg_watched_hours)} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Year">
            <StatGrid>
              <Stat label="Best Year — Movies"  value={summary.best_year_movies} />
              <Stat label="Worst Year — Movies" value={summary.worst_year_movies} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Decade">
            <StatGrid>
              <Stat label="Best Decade — Movies"  value={summary.best_decade_movies  ? `${summary.best_decade_movies}s`  : null} />
              <Stat label="Worst Decade — Movies" value={summary.worst_decade_movies ? `${summary.worst_decade_movies}s` : null} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Core Nationality">
            <StatGrid>
              <Stat label="Best — Movies"      value={summary.best_core_nationality_movies} />
              <Stat label="Best — Cast"        value={summary.best_core_nationality_cast} />
              <Stat label="Worst — Movies"     value={summary.worst_core_nationality_movies} />
              <Stat label="Worst — Cast"       value={summary.worst_core_nationality_cast} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Birth Nationality">
            <StatGrid>
              <Stat label="Best — Movies"  value={summary.best_birth_nationality_movies} />
              <Stat label="Best — Cast"    value={summary.best_birth_nationality_cast} />
              <Stat label="Worst — Movies" value={summary.worst_birth_nationality_movies} />
              <Stat label="Worst — Cast"   value={summary.worst_birth_nationality_cast} />
            </StatGrid>
          </Section>

          <Section title="By Year">
            <Table
              cols={[
                { key: "year",        label: "Year",           numeric: true },
                { key: "movie_count", label: "Movies",         numeric: true },
                { key: "avg_score",   label: "Avg Movie Score",numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
              ]}
              rows={byYear}
            />
          </Section>

          <Section title="By Decade">
            <Table
              cols={[
                { key: "decade",      label: "Decade",         numeric: true, fmt: (v) => `${v}s` },
                { key: "movie_count", label: "Movies",         numeric: true },
                { key: "avg_score",   label: "Avg Movie Score",numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
              ]}
              rows={byDecade}
            />
          </Section>

          <Section title="By Core Nationality">
            <Table cols={natCols} rows={coreNat} />
          </Section>

          <Section title="By Birth Nationality">
            <Table cols={natCols} rows={birthNat} />
          </Section>

          <Section title="By Root Genre">
            <Table cols={genreCols} rows={rootGenres} />
          </Section>

          <Section title="By Genre">
            <Table cols={genreCols} rows={allGenres} />
          </Section>
        </>
      )}

      {tab === "Graphs" && (
        <>
          <ChartWrap title="Avg Movie Score by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="avg_score" name="Avg Movie Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Movie Count by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="movie_count" name="Movies" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Avg Movie Score by Year">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byYear}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} />
                <Bar dataKey="avg_score" name="Avg Movie Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Movies by Root Genre">
            <ResponsiveContainer width="100%" height={Math.max(260, rootGenres.length * 28)}>
              <BarChart data={rootGenres} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="genre_name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="movie_count" name="Movies" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Movies by Core Nationality">
            <ResponsiveContainer width="100%" height={Math.max(300, coreNat.length * 22)}>
              <BarChart data={coreNat} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="nationality" width={130} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="movie_count" name="Movies" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          {scatter && (
            <>
              <ChartWrap title="Movie Score vs Runtime">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart>
                    <CartesianGrid />
                    <XAxis dataKey="runtime_minutes" name="Runtime (min)" label={{ value: "Runtime (min)", position: "insideBottom", offset: -4 }} />
                    <YAxis dataKey="score" name="Score" label={{ value: "Score", angle: -90, position: "insideLeft" }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as any;
                      return <div className="chart-tip"><b>{d.name}</b><br />Score: {d.score?.toFixed(4)}<br />Runtime: {fmt2(d.runtime_minutes)} min</div>;
                    }} />
                    <Scatter data={scatter.movie_score_vs_runtime} fill={SCATTER_FILL} />
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartWrap>

              <ChartWrap title="Cast Member Avg Score vs Avg Runtime">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart>
                    <CartesianGrid />
                    <XAxis dataKey="avg_runtime_minutes" name="Avg Runtime (min)" label={{ value: "Avg Runtime (min)", position: "insideBottom", offset: -4 }} />
                    <YAxis dataKey="avg_score" name="Avg Score" label={{ value: "Avg Score", angle: -90, position: "insideLeft" }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as any;
                      return <div className="chart-tip"><b>{d.name}</b><br />Avg Score: {d.avg_score?.toFixed(4)}<br />Avg Runtime: {fmt2(d.avg_runtime_minutes)} min</div>;
                    }} />
                    <Scatter data={scatter.cast_member_score_vs_runtime} fill={SCATTER_FILL} />
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartWrap>
            </>
          )}
        </>
      )}
    </div>
  );
}
