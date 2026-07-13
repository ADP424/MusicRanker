import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  CartesianGrid, Legend, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis,
  BarChart, Bar,
} from "recharts";

import { api } from "../api/client";
import type {
  DecadeRow, GenreRow, NatRow, ScatterPoint,
  StatsSummary, YearRow,
} from "../api/types";
import {
  C1, C2, SCATTER_FILL, ChartWrap, Section, Stat, StatGrid, Table, fmt2,
  type ColDef,
} from "../stats/shared";

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

const useSummary  = () => useQuery({ queryKey: ["stats", "summary"],   queryFn: () => api.get<StatsSummary>("/stats/summary") });
const useByYear   = () => useQuery({ queryKey: ["stats", "by-year"],   queryFn: () => api.get<YearRow[]>("/stats/by-year") });
const useByDecade = () => useQuery({ queryKey: ["stats", "by-decade"], queryFn: () => api.get<DecadeRow[]>("/stats/by-decade") });
const useByNat    = () => useQuery({ queryKey: ["stats", "by-nat"],    queryFn: () => api.get<{ core_nationality: NatRow[]; birth_nationality: NatRow[] }>("/stats/by-nationality") });
const useByGenre  = () => useQuery({ queryKey: ["stats", "by-genre"],  queryFn: () => api.get<{ by_genre: GenreRow[]; by_root_genre: GenreRow[] }>("/stats/by-genre") });
const useScatter  = () => useQuery({ queryKey: ["stats", "scatter"],   queryFn: () => api.get<{
  artist_rank_vs_runtime: ScatterPoint[];
  album_score_vs_runtime: ScatterPoint[];
  album_rank_vs_runtime:  ScatterPoint[];
}>("/stats/scatter") });

// ---------------------------------------------------------------------------
// Tab layout
// ---------------------------------------------------------------------------

const TABS = ["Stats", "Graphs"] as const;
type Tab = typeof TABS[number];

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function StatsPage() {
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
    { key: "artist_count",    label: "Artists",         numeric: true },
    { key: "avg_artist_rank", label: "Avg Artist Rank", numeric: true, fmt: fmt2 },
    { key: "album_count",     label: "Albums",          numeric: true },
    { key: "avg_album_score", label: "Avg Album Score", numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
  ];
  const genreCols: ColDef[] = [
    { key: "genre_name",          label: "Genre" },
    { key: "artist_count",        label: "Artists",         numeric: true },
    { key: "artist_count_direct", label: "Artists (direct)", numeric: true },
    { key: "avg_artist_rank",     label: "Avg Artist Rank", numeric: true, fmt: fmt2 },
    { key: "album_count",         label: "Albums",          numeric: true },
    { key: "album_count_direct",  label: "Albums (direct)", numeric: true },
    { key: "avg_album_score",     label: "Avg Album Score", numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
  ];

  return (
    <div className="stats-page">
      <div className="stats-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`stats-tab${tab === t ? " stats-tab-active" : ""}`}
            onClick={() => setTab(t)}
          >{t}</button>
        ))}
      </div>

      {/* ══════════════════════════ STATS TAB ══════════════════════════ */}
      {tab === "Stats" && (
        <>
          <Section title="Totals">
            <StatGrid>
              <Stat label="Total Artists"       value={summary.total_artists} />
              <Stat label="Total Albums"        value={summary.total_albums} />
              <Stat label="Avg Albums / Artist" value={fmt2(summary.avg_albums_per_artist)} />
            </StatGrid>
          </Section>

          <Section title="Unique Album Runtime">
            <StatGrid>
              <Stat label="Total (hours)" value={fmt2(summary.unique_runtime_hours)} />
              <Stat label="Total (days)"  value={fmt2(summary.unique_runtime_days)} />
              <Stat label="Avg (hours)"   value={fmt2(summary.avg_album_runtime_hours)} />
            </StatGrid>
          </Section>

          <Section title="Total Listened Runtime">
            <StatGrid>
              <Stat label="Total (hours)" value={fmt2(summary.total_listened_hours)} />
              <Stat label="Total (days)"  value={fmt2(summary.total_listened_days)} />
              <Stat label="Avg (hours)"   value={fmt2(summary.avg_listened_hours)} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Year">
            <StatGrid>
              <Stat label="Best Year — Artists"  value={summary.best_year_artists} />
              <Stat label="Best Year — Albums"   value={summary.best_year_albums} />
              <Stat label="Worst Year — Artists" value={summary.worst_year_artists} />
              <Stat label="Worst Year — Albums"  value={summary.worst_year_albums} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Decade">
            <StatGrid>
              <Stat label="Best Decade — Artists"  value={summary.best_decade_artists  ? `${summary.best_decade_artists}s`  : null} />
              <Stat label="Best Decade — Albums"   value={summary.best_decade_albums   ? `${summary.best_decade_albums}s`   : null} />
              <Stat label="Worst Decade — Artists" value={summary.worst_decade_artists ? `${summary.worst_decade_artists}s` : null} />
              <Stat label="Worst Decade — Albums"  value={summary.worst_decade_albums  ? `${summary.worst_decade_albums}s`  : null} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Core Nationality">
            <StatGrid>
              <Stat label="Best — Artists"  value={summary.best_core_nationality_artists} />
              <Stat label="Best — Albums"   value={summary.best_core_nationality_albums} />
              <Stat label="Worst — Artists" value={summary.worst_core_nationality_artists} />
              <Stat label="Worst — Albums"  value={summary.worst_core_nationality_albums} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Birth / Formed Nationality">
            <StatGrid>
              <Stat label="Best — Artists"  value={summary.best_birth_nationality_artists} />
              <Stat label="Best — Albums"   value={summary.best_birth_nationality_albums} />
              <Stat label="Worst — Artists" value={summary.worst_birth_nationality_artists} />
              <Stat label="Worst — Albums"  value={summary.worst_birth_nationality_albums} />
            </StatGrid>
          </Section>

          <Section title="By Year">
            <Table
              cols={[
                { key: "year",            label: "Year",           numeric: true },
                { key: "artist_count",    label: "Artists",        numeric: true },
                { key: "avg_artist_rank", label: "Avg Artist Rank",numeric: true, fmt: fmt2 },
                { key: "album_count",     label: "Albums",         numeric: true },
                { key: "avg_score",       label: "Avg Album Score",numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
              ]}
              rows={byYear}
            />
          </Section>

          <Section title="By Decade">
            <Table
              cols={[
                { key: "decade",          label: "Decade",          numeric: true, fmt: (v) => `${v}s` },
                { key: "artist_count",    label: "Artists",         numeric: true },
                { key: "avg_artist_rank", label: "Avg Artist Rank", numeric: true, fmt: fmt2 },
                { key: "album_count",     label: "Albums",          numeric: true },
                { key: "avg_score",       label: "Avg Album Score", numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
              ]}
              rows={byDecade}
            />
          </Section>

          <Section title="By Core Nationality">
            <Table cols={natCols} rows={coreNat} />
          </Section>

          <Section title="By Birth / Formed Nationality">
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

      {/* ══════════════════════════ GRAPHS TAB ══════════════════════════ */}
      {tab === "Graphs" && (
        <>
          <ChartWrap title="Avg Album Score by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="avg_score" name="Avg Album Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Avg Artist Rank by Decade (lower = better)">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis reversed />
                <Tooltip labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="avg_artist_rank" name="Avg Artist Rank" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Album &amp; Artist Counts by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip labelFormatter={(v) => `${v}s`} />
                <Legend />
                <Bar dataKey="album_count"  name="Albums"  fill={C1} />
                <Bar dataKey="artist_count" name="Artists" fill={C2} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Avg Album Score by Year">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byYear}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} />
                <Bar dataKey="avg_score" name="Avg Album Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Album &amp; Artist Counts by Year">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byYear}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="album_count"  name="Albums"  fill={C1} />
                <Bar dataKey="artist_count" name="Artists" fill={C2} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Albums by Root Genre">
            <ResponsiveContainer width="100%" height={Math.max(260, rootGenres.length * 28)}>
              <BarChart data={rootGenres} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="genre_name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="album_count"  name="Albums"  fill={C1} />
                <Bar dataKey="artist_count" name="Artists" fill={C2} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Avg Album Score by Root Genre">
            <ResponsiveContainer width="100%" height={Math.max(260, rootGenres.length * 28)}>
              <BarChart data={rootGenres} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="genre_name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} />
                <Bar dataKey="avg_album_score" name="Avg Album Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Albums by Core Nationality">
            <ResponsiveContainer width="100%" height={Math.max(300, coreNat.length * 22)}>
              <BarChart data={coreNat} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="nationality" width={130} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="album_count"  name="Albums"  fill={C1} />
                <Bar dataKey="artist_count" name="Artists" fill={C2} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Albums by Birth / Formed Nationality">
            <ResponsiveContainer width="100%" height={Math.max(300, birthNat.length * 22)}>
              <BarChart data={birthNat} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="nationality" width={130} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="album_count"  name="Albums"  fill={C1} />
                <Bar dataKey="artist_count" name="Artists" fill={C2} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          {scatter && (
            <>
              <ChartWrap title="Artist Rank vs Avg Album Runtime">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart>
                    <CartesianGrid />
                    <XAxis dataKey="rank" name="Artist Rank" label={{ value: "Rank", position: "insideBottom", offset: -4 }} />
                    <YAxis dataKey="avg_runtime_minutes" name="Avg Runtime (min)" label={{ value: "Avg Runtime (min)", angle: -90, position: "insideLeft" }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as any;
                      return <div className="chart-tip"><b>{d.name}</b><br />Rank: {d.rank}<br />Avg Runtime: {fmt2(d.avg_runtime_minutes)} min</div>;
                    }} />
                    <Scatter data={scatter.artist_rank_vs_runtime} fill={SCATTER_FILL} />
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartWrap>

              <ChartWrap title="Album Score vs Runtime">
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
                    <Scatter data={scatter.album_score_vs_runtime} fill={SCATTER_FILL} />
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartWrap>

              <ChartWrap title="Album Rank (within artist) vs Runtime">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart>
                    <CartesianGrid />
                    <XAxis dataKey="album_rank" name="Album Rank" label={{ value: "Album Rank", position: "insideBottom", offset: -4 }} />
                    <YAxis dataKey="runtime_minutes" name="Runtime (min)" label={{ value: "Runtime (min)", angle: -90, position: "insideLeft" }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as any;
                      return <div className="chart-tip"><b>{d.name}</b><br />{d.artist_name}<br />Rank #{d.album_rank}<br />Runtime: {fmt2(d.runtime_minutes)} min</div>;
                    }} />
                    <Scatter data={scatter.album_rank_vs_runtime} fill={SCATTER_FILL} />
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
