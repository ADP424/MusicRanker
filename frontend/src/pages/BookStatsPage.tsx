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
  BookDecadeRow, BookGenreRow, BookNatRow, BookStatsSummary, BookYearRow, ScatterPoint,
} from "../api/types";
import {
  C1, SCATTER_FILL, ChartWrap, Section, Stat, StatGrid, Table, fmt2,
  type ColDef,
} from "../stats/shared";
import { LoadingState } from "../components/Spinner";

function useStatsHooks(userId: number) {
  const { guildId, base } = useGuildApi();
  const qs = `?user_id=${userId}`;
  const useSummary  = () => useQuery({ queryKey: ["g", guildId, "u", userId, "book-stats", "summary"],   queryFn: () => api.get<BookStatsSummary>(`${base}/book-stats/summary${qs}`) });
  const useByYear   = () => useQuery({ queryKey: ["g", guildId, "u", userId, "book-stats", "by-year"],   queryFn: () => api.get<BookYearRow[]>(`${base}/book-stats/by-year${qs}`) });
  const useByDecade = () => useQuery({ queryKey: ["g", guildId, "u", userId, "book-stats", "by-decade"], queryFn: () => api.get<BookDecadeRow[]>(`${base}/book-stats/by-decade${qs}`) });
  const useByNat    = () => useQuery({ queryKey: ["g", guildId, "u", userId, "book-stats", "by-nat"],    queryFn: () => api.get<{ core_nationality: BookNatRow[]; birth_nationality: BookNatRow[] }>(`${base}/book-stats/by-nationality${qs}`) });
  const useByGenre  = () => useQuery({ queryKey: ["g", guildId, "u", userId, "book-stats", "by-genre"],  queryFn: () => api.get<{ by_genre: BookGenreRow[]; by_root_genre: BookGenreRow[] }>(`${base}/book-stats/by-genre${qs}`) });
  const useScatter  = () => useQuery({ queryKey: ["g", guildId, "u", userId, "book-stats", "scatter"],   queryFn: () => api.get<{
    book_score_vs_words: ScatterPoint[];
    author_score_vs_words: ScatterPoint[];
  }>(`${base}/book-stats/scatter${qs}`) });
  return { useSummary, useByYear, useByDecade, useByNat, useByGenre, useScatter };
}

const TABS = ["Stats", "Graphs"] as const;
type Tab = typeof TABS[number];

const score = (v: any) => v != null ? (v as number).toFixed(4) : "—";

export function BookStatsPage() {
  const { userId: me } = useGuildApi();
  const [tab, setTab] = useState<Tab>("Stats");
  const [viewingUser, setViewingUser] = useState(me);
  const { useSummary, useByYear, useByDecade, useByNat, useByGenre, useScatter } = useStatsHooks(viewingUser);

  const summaryQ = useSummary();
  const yearQ    = useByYear();
  const decadeQ  = useByDecade();
  const natQ     = useByNat();
  const genreQ   = useByGenre();
  const scatterQ = useScatter();
  const summary  = summaryQ.data;
  const byYear   = yearQ.data ?? [];
  const byDecade = decadeQ.data ?? [];
  const byNat    = natQ.data;
  const byGenre  = genreQ.data;
  const scatter  = scatterQ.data;
  const loading  = [summaryQ, yearQ, decadeQ, natQ, genreQ, scatterQ].some((q) => q.isLoading);

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
    { key: "nationality",    label: "Author Nationality" },
    { key: "book_count",     label: "Books",          numeric: true },
    { key: "avg_book_score", label: "Avg Book Score", numeric: true, fmt: score },
  ];
  const genreCols: ColDef[] = [
    { key: "genre_name",        label: "Genre" },
    { key: "book_count",        label: "Books",          numeric: true },
    { key: "book_count_direct", label: "Books (direct)", numeric: true },
    { key: "avg_book_score",    label: "Avg Book Score", numeric: true, fmt: score },
  ];

  return (
    <div className="stats-page">
      {header}

      {tab === "Stats" && (
        <>
          <Section title="Totals">
            <StatGrid>
              <Stat label="Total Books"        value={summary.total_books} />
              <Stat label="Total Authors"      value={summary.total_authors} />
              <Stat label="Avg Books / Author" value={fmt2(summary.avg_books_per_author)} />
            </StatGrid>
          </Section>

          <Section title={`Unique Book Words (${summary.books_with_word_count} of ${summary.total_books} books have a word count)`}>
            <StatGrid>
              <Stat label="Total words"      value={summary.unique_words.toLocaleString()} />
              <Stat label="Avg words / book" value={summary.avg_book_words.toLocaleString()} />
            </StatGrid>
          </Section>

          <Section title="Total Words Read (counting re-reads)">
            <StatGrid>
              <Stat label="Total words"      value={summary.total_words_read.toLocaleString()} />
              <Stat label="Avg words / book" value={summary.avg_words_read.toLocaleString()} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Year">
            <StatGrid>
              <Stat label="Best Year — Books"  value={summary.best_year_books} />
              <Stat label="Worst Year — Books" value={summary.worst_year_books} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Decade">
            <StatGrid>
              <Stat label="Best Decade — Books"  value={summary.best_decade_books  ? `${summary.best_decade_books}s`  : null} />
              <Stat label="Worst Decade — Books" value={summary.worst_decade_books ? `${summary.worst_decade_books}s` : null} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Core Nationality">
            <StatGrid>
              <Stat label="Best — Books"    value={summary.best_core_nationality_books} />
              <Stat label="Best — Authors"  value={summary.best_core_nationality_authors} />
              <Stat label="Worst — Books"   value={summary.worst_core_nationality_books} />
              <Stat label="Worst — Authors" value={summary.worst_core_nationality_authors} />
            </StatGrid>
          </Section>

          <Section title="Best &amp; Worst Birth Nationality">
            <StatGrid>
              <Stat label="Best — Books"    value={summary.best_birth_nationality_books} />
              <Stat label="Best — Authors"  value={summary.best_birth_nationality_authors} />
              <Stat label="Worst — Books"   value={summary.worst_birth_nationality_books} />
              <Stat label="Worst — Authors" value={summary.worst_birth_nationality_authors} />
            </StatGrid>
          </Section>

          <Section title="By Year">
            <Table
              cols={[
                { key: "year",       label: "Year",           numeric: true },
                { key: "book_count", label: "Books",          numeric: true },
                { key: "avg_score",  label: "Avg Book Score", numeric: true, fmt: score },
              ]}
              rows={byYear}
            />
          </Section>

          <Section title="By Decade">
            <Table
              cols={[
                { key: "decade",     label: "Decade",         numeric: true, fmt: (v) => `${v}s` },
                { key: "book_count", label: "Books",          numeric: true },
                { key: "avg_score",  label: "Avg Book Score", numeric: true, fmt: score },
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
          <ChartWrap title="Avg Book Score by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="avg_score" name="Avg Book Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Book Count by Decade">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDecade}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decade" tickFormatter={(v) => `${v}s`} />
                <YAxis />
                <Tooltip labelFormatter={(v) => `${v}s`} />
                <Bar dataKey="book_count" name="Books" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Avg Book Score by Year">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byYear}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} />
                <Bar dataKey="avg_score" name="Avg Book Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Books by Root Genre">
            <ResponsiveContainer width="100%" height={Math.max(260, rootGenres.length * 28)}>
              <BarChart data={rootGenres} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="genre_name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="book_count" name="Books" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Avg Book Score by Root Genre">
            <ResponsiveContainer width="100%" height={Math.max(260, rootGenres.length * 28)}>
              <BarChart data={rootGenres} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="genre_name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: any) => (v as number).toFixed(4)} />
                <Bar dataKey="avg_book_score" name="Avg Book Score" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          <ChartWrap title="Books by Author Core Nationality">
            <ResponsiveContainer width="100%" height={Math.max(300, coreNat.length * 22)}>
              <BarChart data={coreNat} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="nationality" width={130} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="book_count" name="Books" fill={C1} />
              </BarChart>
            </ResponsiveContainer>
          </ChartWrap>

          {scatter && (
            <>
              <ChartWrap title="Book Score vs Word Count">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart>
                    <CartesianGrid />
                    <XAxis dataKey="word_count" name="Words" label={{ value: "Words", position: "insideBottom", offset: -4 }} />
                    <YAxis dataKey="score" name="Score" label={{ value: "Score", angle: -90, position: "insideLeft" }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as any;
                      return <div className="chart-tip"><b>{d.name}</b><br />Score: {d.score?.toFixed(4)}<br />Words: {d.word_count?.toLocaleString()}</div>;
                    }} />
                    <Scatter data={scatter.book_score_vs_words} fill={SCATTER_FILL} />
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartWrap>

              <ChartWrap title="Author Avg Score vs Avg Word Count">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart>
                    <CartesianGrid />
                    <XAxis dataKey="avg_word_count" name="Avg Words" label={{ value: "Avg Words", position: "insideBottom", offset: -4 }} />
                    <YAxis dataKey="avg_score" name="Avg Score" label={{ value: "Avg Score", angle: -90, position: "insideLeft" }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as any;
                      return <div className="chart-tip"><b>{d.name}</b><br />Avg Score: {d.avg_score?.toFixed(4)}<br />Avg Words: {d.avg_word_count?.toLocaleString()}</div>;
                    }} />
                    <Scatter data={scatter.author_score_vs_words} fill={SCATTER_FILL} />
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
