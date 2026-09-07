import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";

import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { MemberPicker } from "../components/MemberPicker";
import type {
  TelevisionDecadeRow, TelevisionGenreRow, TelevisionNatRow,
  TelevisionShowRow, TelevisionStatsSummary, TelevisionYearRow,
} from "../api/types";
import {
  C1, C2, SCATTER_FILL, ChartWrap, Section, Stat, StatGrid, Table, fmt2,
  type ColDef,
} from "../stats/shared";
import { LoadingState } from "../components/Spinner";

function useStatsHooks(userId: number) {
  const { guildId, base } = useGuildApi();
  const qs = `?user_id=${userId}`;
  const useSummary  = () => useQuery({ queryKey: ["g", guildId, "u", userId, "television-stats", "summary"],   queryFn: () => api.get<TelevisionStatsSummary>(`${base}/television-stats/summary${qs}`) });
  const useByYear   = () => useQuery({ queryKey: ["g", guildId, "u", userId, "television-stats", "by-year"],   queryFn: () => api.get<TelevisionYearRow[]>(`${base}/television-stats/by-year${qs}`) });
  const useByDecade = () => useQuery({ queryKey: ["g", guildId, "u", userId, "television-stats", "by-decade"], queryFn: () => api.get<TelevisionDecadeRow[]>(`${base}/television-stats/by-decade${qs}`) });
  const useByNat    = () => useQuery({ queryKey: ["g", guildId, "u", userId, "television-stats", "by-nat"],    queryFn: () => api.get<{ core_nationality: TelevisionNatRow[]; birth_nationality: TelevisionNatRow[] }>(`${base}/television-stats/by-nationality${qs}`) });
  const useByGenre  = () => useQuery({ queryKey: ["g", guildId, "u", userId, "television-stats", "by-genre"],  queryFn: () => api.get<{ by_genre: TelevisionGenreRow[]; by_root_genre: TelevisionGenreRow[] }>(`${base}/television-stats/by-genre${qs}`) });
  const useByShow   = () => useQuery({ queryKey: ["g", guildId, "u", userId, "television-stats", "by-show"],   queryFn: () => api.get<TelevisionShowRow[]>(`${base}/television-stats/by-show${qs}`) });
  const useScatter  = () => useQuery({ queryKey: ["g", guildId, "u", userId, "television-stats", "scatter"],   queryFn: () => api.get<{
    show_score_vs_runtime: { show_id: number; name: string; score: number; episode_count: number; runtime_minutes: number }[];
    episode_score_vs_runtime: { episode_id: number; name: string; show_name: string; score: number; local_score: number; runtime_minutes: number }[];
    cast_member_score_vs_runtime: { cast_member_id: number; name: string; avg_score: number; episode_count: number; avg_runtime_minutes: number }[];
  }>(`${base}/television-stats/scatter${qs}`) });
  return { useSummary, useByYear, useByDecade, useByNat, useByGenre, useByShow, useScatter };
}

const TABS = ["Stats", "Shows", "Graphs"] as const;
type Tab = typeof TABS[number];

export function TelevisionStatsPage() {
  const { userId: me } = useGuildApi();
  const [tab, setTab] = useState<Tab>("Stats");
  const [viewingUser, setViewingUser] = useState(me);
  const { useSummary, useByYear, useByDecade, useByNat, useByGenre, useByShow, useScatter } = useStatsHooks(viewingUser);

  const summaryQ = useSummary();
  const yearQ    = useByYear();
  const decadeQ  = useByDecade();
  const natQ     = useByNat();
  const genreQ   = useByGenre();
  const showQ    = useByShow();
  const scatterQ = useScatter();
  const summary  = summaryQ.data;
  const byYear   = yearQ.data ?? [];
  const byDecade = decadeQ.data ?? [];
  const byNat    = natQ.data;
  const byGenre  = genreQ.data;
  const byShow   = showQ.data ?? [];
  const scatter  = scatterQ.data;
  const loading  = [summaryQ, yearQ, decadeQ, natQ, genreQ, showQ, scatterQ].some((q) => q.isLoading);

  const header = (
    <div className="stats-tabs" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex" }}>
        {TABS.map((t) => (
          <button key={t} className={`stats-tab${tab === t ? " stats-tab-active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <MemberPicker value={viewingUser} onChange={setViewingUser} />
    </div>
  );

  if (summaryQ.isError) {
    return <div className="stats-page">{header}<p className="err">{(summaryQ.error as Error).message}</p></div>;
  }
  if (loading || !summary) {
    return <div className="stats-page">{header}<LoadingState label="Crunching stats…" /></div>;
  }

  const coreNat    = byNat?.core_nationality  ?? [];
  const birthNat   = byNat?.birth_nationality ?? [];
  const allGenres  = byGenre?.by_genre        ?? [];
  const rootGenres = byGenre?.by_root_genre   ?? [];

  const natCols: ColDef[] = [
    { key: "nationality",       label: "Nationality" },
    { key: "show_count",        label: "Shows",              numeric: true },
    { key: "avg_show_score",    label: "Avg Show Score",     numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
    { key: "episode_count",     label: "Episodes",           numeric: true },
    { key: "avg_episode_score", label: "Avg Episode Score",  numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
  ];
  const genreCols: ColDef[] = [
    { key: "genre_name",         label: "Genre" },
    { key: "show_count",         label: "Shows",              numeric: true },
    { key: "show_count_direct",  label: "Shows (direct)",     numeric: true },
    { key: "avg_show_score",     label: "Avg Show Score",     numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
    { key: "episode_count",      label: "Episodes",           numeric: true },
    { key: "episode_count_direct", label: "Episodes (direct)", numeric: true },
    { key: "avg_episode_score",  label: "Avg Episode Score",  numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
  ];
  const showCols: ColDef[] = [
    { key: "position",                     label: "#",                   numeric: true },
    { key: "show_name",                    label: "Show" },
    { key: "release_year",                 label: "Year",                numeric: true },
    { key: "episode_count",                label: "Episodes",            numeric: true },
    { key: "total_watches",                label: "Total Watches",       numeric: true },
    { key: "total_runtime_minutes",        label: "Runtime (min)",       numeric: true },
    { key: "total_watched_minutes",        label: "Watched (min)",       numeric: true },
    { key: "avg_episode_runtime_minutes",  label: "Avg Ep. Runtime",     numeric: true, fmt: (v) => v != null ? fmt2(v) : "—" },
    { key: "show_score",                   label: "Score",               numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
  ];

  return (
    <div className="stats-page">
      {header}

      {tab === "Stats" && (
        <>
          <Section title="Totals">
            <StatGrid>
              <Stat label="Total Cast Members"        value={summary.total_cast_members} />
              <Stat label="Total Shows"                value={summary.total_shows} />
              <Stat label="Total Episodes"             value={summary.total_episodes} />
              <Stat label="Avg Episodes / Show"        value={fmt2(summary.avg_episodes_per_show)} />
              <Stat label="Avg Shows / Cast Member"    value={fmt2(summary.avg_shows_per_cast_member)} />
              <Stat label="Avg Episodes / Cast Member" value={fmt2(summary.avg_episodes_per_cast_member)} />
            </StatGrid>
          </Section>

          {summary.most_episodes_show && (
            <Section title="Longest-Running Show">
              <StatGrid>
                <Stat label="Show"     value={summary.most_episodes_show} />
                <Stat label="Episodes" value={summary.most_episodes_count} />
              </StatGrid>
            </Section>
          )}

          <Section title="Unique Runtime">
            <StatGrid>
              <Stat label="Total (hours)"      value={fmt2(summary.unique_runtime_hours)} />
              <Stat label="Total (days)"       value={fmt2(summary.unique_runtime_days)} />
              <Stat label="Avg / Episode (hrs)" value={fmt2(summary.avg_episode_runtime_hours)} />
              <Stat label="Avg / Show (hrs)"    value={fmt2(summary.avg_show_runtime_hours)} />
            </StatGrid>
          </Section>

          <Section title="Total Watched Runtime">
            <StatGrid>
              <Stat label="Total (hours)"      value={fmt2(summary.total_watched_hours)} />
              <Stat label="Total (days)"       value={fmt2(summary.total_watched_days)} />
              <Stat label="Avg / Show (hrs)"    value={fmt2(summary.avg_watched_hours_per_show)} />
              <Stat label="Avg / Episode (hrs)" value={fmt2(summary.avg_watched_hours_per_episode)} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Year">
            <StatGrid>
              <Stat label="Best Year — Shows"     value={summary.best_year_shows} />
              <Stat label="Worst Year — Shows"    value={summary.worst_year_shows} />
              <Stat label="Best Year — Episodes"  value={summary.best_year_episodes} />
              <Stat label="Worst Year — Episodes" value={summary.worst_year_episodes} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Decade">
            <StatGrid>
              <Stat label="Best Decade — Shows"     value={summary.best_decade_shows    ? `${summary.best_decade_shows}s`    : null} />
              <Stat label="Worst Decade — Shows"    value={summary.worst_decade_shows   ? `${summary.worst_decade_shows}s`   : null} />
              <Stat label="Best Decade — Episodes"  value={summary.best_decade_episodes ? `${summary.best_decade_episodes}s` : null} />
              <Stat label="Worst Decade — Episodes" value={summary.worst_decade_episodes ? `${summary.worst_decade_episodes}s` : null} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Core Nationality">
            <StatGrid>
              <Stat label="Best — Shows"  value={summary.best_core_nationality_shows} />
              <Stat label="Best — Cast"   value={summary.best_core_nationality_cast} />
              <Stat label="Worst — Shows" value={summary.worst_core_nationality_shows} />
              <Stat label="Worst — Cast"  value={summary.worst_core_nationality_cast} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Birth Nationality">
            <StatGrid>
              <Stat label="Best — Shows"  value={summary.best_birth_nationality_shows} />
              <Stat label="Best — Cast"   value={summary.best_birth_nationality_cast} />
              <Stat label="Worst — Shows" value={summary.worst_birth_nationality_shows} />
              <Stat label="Worst — Cast"  value={summary.worst_birth_nationality_cast} />
            </StatGrid>
          </Section>

          <Section title="By Year">
            <Table
              cols={[
                { key: "year",              label: "Year",               numeric: true },
                { key: "show_count",        label: "Shows",              numeric: true },
                { key: "avg_show_score",    label: "Avg Show Score",     numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
                { key: "episode_count",     label: "Episodes",           numeric: true },
                { key: "avg_episode_score", label: "Avg Episode Score",  numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
              ]}
              rows={byYear}
            />
          </Section>

          <Section title="By Decade">
            <Table
              cols={[
                { key: "decade",            label: "Decade",             numeric: true, fmt: (v) => `${v}s` },
                { key: "show_count",        label: "Shows",              numeric: true },
                { key: "avg_show_score",    label: "Avg Show Score",     numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
                { key: "episode_count",     label: "Episodes",           numeric: true },
                { key: "avg_episode_score", label: "Avg Episode Score",  numeric: true, fmt: (v) => v != null ? v.toFixed(4) : "—" },
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

      {tab === "Shows" && (
        <Section title="By Show">
          <Table cols={showCols} rows={byShow} />
        </Section>
      )}

      {tab === "Graphs" && (
        <>
          <ChartWrap title="Avg Score by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="avg_show_score" name="Avg Show Score" fill={C1} />
                <Bar dataKey="avg_episode_score" name="Avg Episode Score" fill={C2} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Episode Count by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="episode_count" name="Episodes" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Shows by Root Genre">
            <ResponsiveContainer width="100%" height={Math.max(260, rootGenres.length * 28)}>
              <BarChart data={rootGenres} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="genre_name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="show_count" name="Shows" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Shows by Core Nationality">
            <ResponsiveContainer width="100%" height={Math.max(300, coreNat.length * 22)}>
              <BarChart data={coreNat} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="nationality" width={130} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="show_count" name="Shows" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          {scatter && (
            <>
              <ChartWrap title="Show Score vs Total Runtime">
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
                    <Scatter data={scatter.show_score_vs_runtime} fill={SCATTER_FILL} />
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartWrap>

              <ChartWrap title="Episode Score vs Runtime">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart>
                    <CartesianGrid />
                    <XAxis dataKey="runtime_minutes" name="Runtime (min)" label={{ value: "Runtime (min)", position: "insideBottom", offset: -4 }} />
                    <YAxis dataKey="score" name="Score" label={{ value: "Score", angle: -90, position: "insideLeft" }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as any;
                      return <div className="chart-tip"><b>{d.name}</b><br />({d.show_name})<br />Score: {d.score?.toFixed(4)}<br />Runtime: {fmt2(d.runtime_minutes)} min</div>;
                    }} />
                    <Scatter data={scatter.episode_score_vs_runtime} fill={SCATTER_FILL} />
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartWrap>

              <ChartWrap title="Cast Member Avg Score vs Avg Episode Runtime">
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
