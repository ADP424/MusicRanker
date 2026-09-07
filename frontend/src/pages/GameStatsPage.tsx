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
  GameDecadeRow, GameGenreRow, GameNatRow, GamePlatformRow,
  GameStatsSummary, GameYearRow, ScatterPoint,
} from "../api/types";
import {
  C1, SCATTER_FILL, ChartWrap, Section, Stat, StatGrid, Table, fmt2,
  type ColDef,
} from "../stats/shared";
import { LoadingState } from "../components/Spinner";

function useStatsHooks(userId: number) {
  const { guildId, base } = useGuildApi();
  const qs = `?user_id=${userId}`;
  const useSummary    = () => useQuery({ queryKey: ["g", guildId, "u", userId, "game-stats", "summary"],     queryFn: () => api.get<GameStatsSummary>(`${base}/game-stats/summary${qs}`) });
  const useByYear     = () => useQuery({ queryKey: ["g", guildId, "u", userId, "game-stats", "by-year"],     queryFn: () => api.get<GameYearRow[]>(`${base}/game-stats/by-year${qs}`) });
  const useByDecade   = () => useQuery({ queryKey: ["g", guildId, "u", userId, "game-stats", "by-decade"],   queryFn: () => api.get<GameDecadeRow[]>(`${base}/game-stats/by-decade${qs}`) });
  const useByNat      = () => useQuery({ queryKey: ["g", guildId, "u", userId, "game-stats", "by-nat"],      queryFn: () => api.get<{ core_nationality: GameNatRow[]; birth_nationality: GameNatRow[] }>(`${base}/game-stats/by-nationality${qs}`) });
  const useByGenre    = () => useQuery({ queryKey: ["g", guildId, "u", userId, "game-stats", "by-genre"],    queryFn: () => api.get<{ by_genre: GameGenreRow[]; by_root_genre: GameGenreRow[] }>(`${base}/game-stats/by-genre${qs}`) });
  const useByPlatform = () => useQuery({ queryKey: ["g", guildId, "u", userId, "game-stats", "by-platform"], queryFn: () => api.get<{ by_platform: GamePlatformRow[]; by_root_platform: GamePlatformRow[] }>(`${base}/game-stats/by-platform${qs}`) });
  const useScatter    = () => useQuery({ queryKey: ["g", guildId, "u", userId, "game-stats", "scatter"],     queryFn: () => api.get<{
    game_score_vs_hours: ScatterPoint[];
    person_score_vs_hours: ScatterPoint[];
  }>(`${base}/game-stats/scatter${qs}`) });
  return { useSummary, useByYear, useByDecade, useByNat, useByGenre, useByPlatform, useScatter };
}

const TABS = ["Stats", "Graphs"] as const;
type Tab = typeof TABS[number];

const score4 = (v: any) => (v != null ? (v as number).toFixed(4) : "—");

export function GameStatsPage() {
  const { userId: me } = useGuildApi();
  const [tab, setTab] = useState<Tab>("Stats");
  const [viewingUser, setViewingUser] = useState(me);
  const { useSummary, useByYear, useByDecade, useByNat, useByGenre, useByPlatform, useScatter } = useStatsHooks(viewingUser);

  const summaryQ  = useSummary();
  const yearQ     = useByYear();
  const decadeQ   = useByDecade();
  const natQ      = useByNat();
  const genreQ    = useByGenre();
  const platformQ = useByPlatform();
  const scatterQ  = useScatter();
  const summary   = summaryQ.data;
  const byYear    = yearQ.data ?? [];
  const byDecade  = decadeQ.data ?? [];
  const byNat     = natQ.data;
  const byGenre   = genreQ.data;
  const byPlatform = platformQ.data;
  const scatter   = scatterQ.data;
  const loading   = [summaryQ, yearQ, decadeQ, natQ, genreQ, platformQ, scatterQ].some((q) => q.isLoading);

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

  const coreNat       = byNat?.core_nationality      ?? [];
  const birthNat      = byNat?.birth_nationality     ?? [];
  const allGenres     = byGenre?.by_genre            ?? [];
  const rootGenres    = byGenre?.by_root_genre       ?? [];
  const allPlatforms  = byPlatform?.by_platform      ?? [];
  const rootPlatforms = byPlatform?.by_root_platform ?? [];

  const natCols: ColDef[] = [
    { key: "nationality",    label: "Nationality" },
    { key: "game_count",     label: "Games",          numeric: true },
    { key: "avg_game_score", label: "Avg Game Score", numeric: true, fmt: score4 },
  ];

  const genreCols: ColDef[] = [
    { key: "genre_name",        label: "Genre" },
    { key: "game_count",        label: "Games",          numeric: true },
    { key: "game_count_direct", label: "Games (direct)", numeric: true },
    { key: "avg_game_score",    label: "Avg Game Score", numeric: true, fmt: score4 },
    { key: "total_hours",       label: "Hours Played",   numeric: true, fmt: fmt2 },
  ];

  const platformCols: ColDef[] = [
    { key: "platform_name",     label: "Platform" },
    { key: "game_count",        label: "Games",          numeric: true },
    { key: "game_count_direct", label: "Games (direct)", numeric: true },
    { key: "avg_game_score",    label: "Avg Game Score", numeric: true, fmt: score4 },
    { key: "total_hours",       label: "Hours Played",   numeric: true, fmt: fmt2 },
  ];

  return (
    <div className="stats-page">
      {header}

      {tab === "Stats" && (
        <>
          <Section title="Totals">
            <StatGrid>
              <Stat label="Total Games"            value={summary.total_games} />
              <Stat label="People Credited"        value={summary.total_people_credited} />
              <Stat label="Avg Games / Person"     value={fmt2(summary.avg_games_per_person)} />
            </StatGrid>
          </Section>

          <Section title="Hours Played">
            <StatGrid>
              <Stat label="Total (hours)"    value={fmt2(summary.total_hours_played)} />
              <Stat label="Total (days)"     value={fmt2(summary.total_days_played)} />
              <Stat label="Avg (hours)"      value={fmt2(summary.avg_hours_played)} />
              <Stat label="Tracked Games"    value={summary.games_with_hours_tracked} />
              <Stat label="Untracked Games"  value={summary.games_without_hours_tracked} />
              <Stat
                label="Most Played"
                value={summary.most_played_game ? `${summary.most_played_game} (${fmt2(summary.most_played_hours)}h)` : null}
              />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Year">
            <StatGrid>
              <Stat label="Best Year — Games"  value={summary.best_year_games} />
              <Stat label="Worst Year — Games" value={summary.worst_year_games} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Decade">
            <StatGrid>
              <Stat label="Best Decade — Games"  value={summary.best_decade_games  ? `${summary.best_decade_games}s`  : null} />
              <Stat label="Worst Decade — Games" value={summary.worst_decade_games ? `${summary.worst_decade_games}s` : null} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Platform">
            <StatGrid>
              <Stat label="Best Platform"  value={summary.best_platform} />
              <Stat label="Worst Platform" value={summary.worst_platform} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Core Nationality">
            <StatGrid>
              <Stat label="Best — Games"   value={summary.best_core_nationality_games} />
              <Stat label="Best — People"  value={summary.best_core_nationality_people} />
              <Stat label="Worst — Games"  value={summary.worst_core_nationality_games} />
              <Stat label="Worst — People" value={summary.worst_core_nationality_people} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Birth Nationality">
            <StatGrid>
              <Stat label="Best — Games"   value={summary.best_birth_nationality_games} />
              <Stat label="Best — People"  value={summary.best_birth_nationality_people} />
              <Stat label="Worst — Games"  value={summary.worst_birth_nationality_games} />
              <Stat label="Worst — People" value={summary.worst_birth_nationality_people} />
            </StatGrid>
          </Section>

          <Section title="By Year">
            <Table
              cols={[
                { key: "year",       label: "Year",           numeric: true },
                { key: "game_count", label: "Games",          numeric: true },
                { key: "avg_score",  label: "Avg Game Score", numeric: true, fmt: score4 },
              ]}
              rows={byYear}
            />
          </Section>

          <Section title="By Decade">
            <Table
              cols={[
                { key: "decade",     label: "Decade",         numeric: true, fmt: (v) => `${v}s` },
                { key: "game_count", label: "Games",          numeric: true },
                { key: "avg_score",  label: "Avg Game Score", numeric: true, fmt: score4 },
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

          <Section title="By Root Platform">
            <Table cols={platformCols} rows={rootPlatforms} />
          </Section>
          <Section title="By Platform">
            <Table cols={platformCols} rows={allPlatforms} />
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
          <ChartWrap title="Avg Game Score by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="avg_score" name="Avg Game Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Game Count by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="game_count" name="Games" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Avg Game Score by Year">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byYear}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} />
                <Bar dataKey="avg_score" name="Avg Game Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          {/* Platform replaces nothing in the movie set — it's the game-only axis. */}
          <ChartWrap title="Games by Root Platform">
            <ResponsiveContainer width="100%" height={Math.max(260, rootPlatforms.length * 28)}>
              <BarChart data={rootPlatforms} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="platform_name" width={130} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="game_count" name="Games" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Hours Played by Root Platform">
            <ResponsiveContainer width="100%" height={Math.max(260, rootPlatforms.length * 28)}>
              <BarChart data={rootPlatforms} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="platform_name" width={130} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: any) => `${fmt2(v as number)}h`} />
                <Bar dataKey="total_hours" name="Hours Played" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Games by Root Genre">
            <ResponsiveContainer width="100%" height={Math.max(260, rootGenres.length * 28)}>
              <BarChart data={rootGenres} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="genre_name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="game_count" name="Games" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Hours Played by Root Genre">
            <ResponsiveContainer width="100%" height={Math.max(260, rootGenres.length * 28)}>
              <BarChart data={rootGenres} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="genre_name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: any) => `${fmt2(v as number)}h`} />
                <Bar dataKey="total_hours" name="Hours Played" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Games by Core Nationality">
            <ResponsiveContainer width="100%" height={Math.max(300, coreNat.length * 22)}>
              <BarChart data={coreNat} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="nationality" width={130} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="game_count" name="Games" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          {scatter && (
            <>
              <ChartWrap title="Game Score vs Hours Played">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart>
                    <CartesianGrid />
                    <XAxis dataKey="hours_played" name="Hours Played" label={{ value: "Hours Played", position: "insideBottom", offset: -4 }} />
                    <YAxis dataKey="score" name="Score" label={{ value: "Score", angle: -90, position: "insideLeft" }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as any;
                      return <div className="chart-tip"><b>{d.name}</b><br />Score: {d.score?.toFixed(4)}<br />Hours: {fmt2(d.hours_played)}</div>;
                    }} />
                    <Scatter data={scatter.game_score_vs_hours} fill={SCATTER_FILL} />
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartWrap>

              <ChartWrap title="Person Avg Score vs Avg Hours Played">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart>
                    <CartesianGrid />
                    <XAxis dataKey="avg_hours_played" name="Avg Hours" label={{ value: "Avg Hours Played", position: "insideBottom", offset: -4 }} />
                    <YAxis dataKey="avg_score" name="Avg Score" label={{ value: "Avg Score", angle: -90, position: "insideLeft" }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as any;
                      return <div className="chart-tip"><b>{d.name}</b><br />Avg Score: {d.avg_score?.toFixed(4)}<br />Avg Hours: {fmt2(d.avg_hours_played)}</div>;
                    }} />
                    <Scatter data={scatter.person_score_vs_hours} fill={SCATTER_FILL} />
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
