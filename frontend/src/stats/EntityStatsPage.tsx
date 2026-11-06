import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";

import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { gk, rk } from "../api/keys";
import { MemberPicker } from "../components/MemberPicker";
import { LoadingState } from "../components/Spinner";

// ── Config ────────────────────────────────────────────────────────────────────
// A stats page is a description of what to show from the vertical's
// `GET /<slug>/all` response; this component draws it, for one member or two.

export type Row = Record<string, unknown>;
export type Fmt = "int" | "num" | "score" | "decade" | "text";

export interface StatDef {
  label: string;
  key?: string;
  get?: (summary: Row) => unknown;
  fmt?: Fmt;
}
export interface SummaryGroup {
  title: string | ((summary: Row) => string);
  stats: StatDef[];
  when?: (summary: Row) => boolean;
}
export interface Col { key: string; label: string; fmt?: Fmt; numeric?: boolean }
export interface TableDef {
  title: string;
  /** Section of the response, then (optionally) a key inside it: "by_genre.by_root_genre". */
  from: string;
  /** Joins two members' rows in compare mode. */
  keyCol: string;
  cols: Col[];
}
export interface BarDef {
  title: string;
  from: string;
  x: string;
  xFmt?: Fmt;
  series: { key: string; label: string }[];
  fmt?: Fmt;
  /** Categories down the side: for long labels (genres, nationalities). */
  horizontal?: boolean;
  /** Lower is better (ranks). */
  reversed?: boolean;
}
export interface ScatterDef {
  title: string;
  from: string;
  x: { key: string; label: string };
  y: { key: string; label: string };
  tip: (d: Row) => ReactNode[];
}
export interface StatsConfig {
  slug: string;
  title: string;
  summary: SummaryGroup[];
  tables: TableDef[];
  bars: BarDef[];
  scatters: ScatterDef[];
  /** More tabs of tables, e.g. TV's per-show table. */
  extraTabs?: { name: string; tables: TableDef[] }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// SVG presentation attributes (fill, stroke) don't resolve CSS variables, so the
// theme's colours are read once and re-read whenever the theme class flips.
interface Palette { a: string; b: string; border: string; muted: string; card: string }

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { a: v("--chart-a"), b: v("--chart-b"), border: v("--border"), muted: v("--muted-foreground"), card: v("--card") };
}

function usePalette(): Palette {
  const [p, setP] = useState(readPalette);
  useEffect(() => {
    const mo = new MutationObserver(() => setP(readPalette()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return p;
}

const SERIES_CSS = ["var(--chart-a)", "var(--chart-b)"] as const;
const legendText = (v: string) => <span className="text-foreground">{v}</span>;

export function format(v: unknown, fmt: Fmt = "text"): string {
  if (v == null || v === "") return "—";
  if (typeof v !== "number") return String(v);
  switch (fmt) {
    case "int": return v.toLocaleString();
    case "num": return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case "score": return `${(v * 100).toFixed(1)}%`;
    case "decade": return `${v}s`;
    default: return String(v);
  }
}

function pick(all: Row | undefined, from: string): Row[] {
  let cur: unknown = all;
  for (const k of from.split(".")) cur = (cur as Row | undefined)?.[k];
  return Array.isArray(cur) ? (cur as Row[]) : [];
}

function statValue(s: Row, d: StatDef): unknown {
  return d.get ? d.get(s) : d.key ? s[d.key] : undefined;
}

/** Two members' rows side by side: `k` from the first, `k__b` from the second. */
function joinRows(a: Row[], b: Row[], keyCol: string, keys: string[]): Row[] {
  const out = new Map<unknown, Row>();
  for (const r of a) out.set(r[keyCol], { ...r });
  for (const r of b) {
    const row = out.get(r[keyCol]) ?? { [keyCol]: r[keyCol] };
    for (const k of keys) row[`${k}__b`] = r[k];
    out.set(r[keyCol], row);
  }
  const rows = [...out.values()];
  return rows.every((r) => typeof r[keyCol] === "number")
    ? rows.sort((x, y) => (x[keyCol] as number) - (y[keyCol] as number))
    : rows;
}

const tooltipStyle = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
  itemStyle: { color: "var(--foreground)" },

};

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-3 px-4 py-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </Card>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function SortTable({ cols, rows }: { cols: Col[]; rows: Row[] }) {
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({ key: cols[0].key, asc: !cols[0].numeric });
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sort.asc ? cmp : -cmp;
  }), [rows, sort]);
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr>
            {cols.map((c) => {
              const Icon = sort.key !== c.key ? ArrowUpDown : sort.asc ? ArrowUp : ArrowDown;
              return (
                <th key={c.key} className={cn("px-3 py-2 font-medium whitespace-nowrap", c.numeric ? "text-right" : "text-left")}>
                  <button type="button" data-slot="th-sort"
                          className={cn("inline-flex cursor-pointer items-center gap-1 hover:text-foreground",
                            sort.key === c.key ? "text-foreground" : "text-muted-foreground")}
                          onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, asc: !s.asc } : { key: c.key, asc: !c.numeric }))}>
                    {c.label}<Icon className="size-3" />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((r, i) => (
            <tr key={i} className="hover:bg-accent/40">
              {cols.map((c) => (
                <td key={c.key} className={cn("px-3 py-1.5", c.numeric && "text-right tabular-nums")}>{format(r[c.key], c.fmt)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsTable({ def, a, b, names }: { def: TableDef; a: Row | undefined; b?: Row; names: [string, string] }) {
  const rowsA = pick(a, def.from);
  if (!b) return <SortTable cols={def.cols} rows={rowsA} />;
  const numeric = def.cols.filter((c) => c.numeric && c.key !== def.keyCol);
  const cols: Col[] = [
    ...def.cols.filter((c) => !numeric.includes(c)),
    ...numeric.flatMap((c) => [
      { ...c, label: `${c.label} · ${names[0]}` },
      { ...c, key: `${c.key}__b`, label: `${c.label} · ${names[1]}` },
    ]),
  ];
  return <SortTable cols={cols} rows={joinRows(rowsA, pick(b, def.from), def.keyCol, numeric.map((c) => c.key))} />;
}

function BarCard({ def, a, b, names }: { def: BarDef; a: Row | undefined; b?: Row; names: [string, string] }) {
  const pal = usePalette();
  const axisTick = { fill: pal.muted, fontSize: 12 };
  const rowsA = pick(a, def.from);
  // Comparing, each series gets its own chart (you vs them), so colour always
  // means "whose" and never has to mean two things at once.
  const charts = b
    ? def.series.map((s) => ({
        title: def.series.length > 1 ? `${def.title}: ${s.label}` : def.title,
        rows: joinRows(rowsA, pick(b, def.from), def.x, [s.key]),
        bars: [{ key: s.key, label: names[0] }, { key: `${s.key}__b`, label: names[1] }],
      }))
    : [{ title: def.title, rows: rowsA, bars: def.series }];

  return (
    <>
      {charts.map((ch) => {
        const height = def.horizontal ? Math.max(240, ch.rows.length * (b ? 34 : 26)) : 260;
        return (
          <ChartCard key={ch.title} title={ch.title}>
            {ch.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to show yet.</p> : (
              <ResponsiveContainer width="100%" height={height}>
                <BarChart data={ch.rows} layout={def.horizontal ? "vertical" : "horizontal"} barGap={2}
                          margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={pal.border}
                                 horizontal={!def.horizontal} vertical={!!def.horizontal} />
                  {def.horizontal ? (
                    <>
                      <XAxis type="number" tick={axisTick} stroke={pal.border} reversed={def.reversed} />
                      <YAxis type="category" dataKey={def.x} width={130} tick={axisTick} stroke={pal.border}
                             tickFormatter={(v) => format(v, def.xFmt)} />
                    </>
                  ) : (
                    <>
                      <XAxis dataKey={def.x} tick={axisTick} stroke={pal.border} tickFormatter={(v) => format(v, def.xFmt)} />
                      <YAxis tick={axisTick} stroke={pal.border} reversed={def.reversed} width={56} />
                    </>
                  )}
                  <Tooltip {...tooltipStyle} cursor={{ fill: pal.border, opacity: 0.5 }} labelFormatter={(v) => format(v, def.xFmt)}
                           formatter={(v) => format(v, def.fmt ?? "num")} />
                  {ch.bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />}
                  {ch.bars.map((s, i) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={i % 2 ? pal.b : pal.a}
                         radius={def.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        );
      })}
    </>
  );
}

function ScatterCard({ def, a, b, names }: { def: ScatterDef; a: Row | undefined; b?: Row; names: [string, string] }) {
  const pal = usePalette();
  const axisTick = { fill: pal.muted, fontSize: 12 };
  const sets = b ? [pick(a, def.from), pick(b, def.from)] : [pick(a, def.from)];
  return (
    <ChartCard title={def.title}>
      {sets[0].length === 0 && !sets[1]?.length ? <p className="text-sm text-muted-foreground">Nothing to show yet.</p> : (
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 4, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={pal.border} />
            <XAxis dataKey={def.x.key} name={def.x.label} type="number" tick={axisTick} stroke={pal.border}
                   label={{ value: def.x.label, position: "insideBottom", offset: -12, fill: pal.muted, fontSize: 12 }} />
            <YAxis dataKey={def.y.key} name={def.y.label} type="number" tick={axisTick} stroke={pal.border} width={64}
                   label={{ value: def.y.label, angle: -90, position: "insideLeft", fill: pal.muted, fontSize: 12 }} />
            <Tooltip cursor={{ strokeDasharray: "3 3", stroke: pal.muted }} content={({ payload }) => {
              const d = payload?.[0]?.payload as Row | undefined;
              if (!d) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
                  {def.tip(d).map((line, i) => <div key={i} className={i === 0 ? "font-semibold" : undefined}>{line}</div>)}
                </div>
              );
            }} />
            {b && <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />}
            {sets.map((rows, i) => (
              <Scatter key={i} name={names[i]} data={rows} fill={i ? pal.b : pal.a} fillOpacity={0.75}
                       stroke={pal.card} strokeWidth={1} isAnimationActive={false} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

function Summary({ groups, a, b, names }: { groups: SummaryGroup[]; a: Row; b?: Row; names: [string, string] }) {
  const shown = groups.filter((g) => !g.when || g.when(a) || (b && g.when(b)));
  if (!b) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((g) => {
          const title = typeof g.title === "function" ? g.title(a) : g.title;
          return (
            <Card key={title} className="gap-2 px-4 py-3">
              <h3 className="text-sm font-semibold">{title}</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {g.stats.map((d) => (
                  <div key={d.label} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{d.label}</dt>
                    <dd className="truncate font-medium tabular-nums">{format(statValue(a, d), d.fmt)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          );
        })}
      </div>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {shown.map((g) => {
        const title = typeof g.title === "function" ? g.title(a) : g.title;
        return (
          <Card key={title} className="gap-0 py-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-semibold">{title}</th>
                  {names.map((n, i) => (
                    <th key={n} className="px-4 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                      <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: SERIES_CSS[i] }} />{n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {g.stats.map((d) => (
                  <tr key={d.label}>
                    <td className="px-4 py-1.5 text-muted-foreground">{d.label}</td>
                    <td className="px-4 py-1.5 text-right font-medium tabular-nums">{format(statValue(a, d), d.fmt)}</td>
                    <td className="px-4 py-1.5 text-right font-medium tabular-nums">{format(statValue(b, d), d.fmt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface MemberRow { user_id: number; username: string }

export function EntityStatsPage({ config }: { config: StatsConfig }) {
  const { guildId, userId: me, base } = useGuildApi();
  const [tab, setTab] = useState("Stats");
  const [viewing, setViewing] = useState(me);
  const [compare, setCompare] = useState<number | null>(null);

  const members = useQuery({
    queryKey: gk(guildId, "members"),
    queryFn: () => api.get<MemberRow[]>(`/guilds/${guildId}/members`),
  });
  const nameOf = (id: number) => (id === me ? "You" : members.data?.find((m) => m.user_id === id)?.username ?? `#${id}`);

  const statsFor = (uid: number | null) => ({
    queryKey: rk(guildId, uid ?? 0, config.slug, "all"),
    queryFn: () => api.get<Row>(`${base}/${config.slug}/all?user_id=${uid}`),
    enabled: uid != null,
  });
  const qa = useQuery(statsFor(viewing));
  const qb = useQuery(statsFor(compare !== viewing ? compare : null));
  const a = qa.data;
  const b = compare != null && compare !== viewing ? qb.data : undefined;
  const names: [string, string] = [nameOf(viewing), compare != null ? nameOf(compare) : ""];
  const others = (members.data ?? []).filter((m) => m.user_id !== viewing);
  const tabs = ["Stats", ...(config.extraTabs ?? []).map((t) => t.name), "Graphs"];

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-3">
          <h1>{config.title}</h1>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>{tabs.map((t) => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}</TabsList>
          </Tabs>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <MemberPicker value={viewing} onChange={(id) => { setViewing(id); if (id === compare) setCompare(null); }} />
          {others.length > 0 && (
            <select aria-label="Compare with" value={compare ?? ""}
                    onChange={(e) => setCompare(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Compare with…</option>
              {others.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === me ? "You" : m.username}</option>)}
            </select>
          )}
        </div>
      </div>

      {qa.isError ? (
        <p className="text-sm text-destructive">{(qa.error as Error).message}</p>
      ) : qa.isLoading || !a || (compare != null && compare !== viewing && qb.isLoading) ? (
        <LoadingState label="Crunching stats…" />
      ) : tab === "Stats" ? (
        <>
          <Summary groups={config.summary} a={a.summary as Row} b={b?.summary as Row | undefined} names={names} />
          {config.tables.map((t) => (
            <section key={t.title} className="grid gap-2">
              <h2>{t.title}</h2>
              <StatsTable def={t} a={a} b={b} names={names} />
            </section>
          ))}
        </>
      ) : tab === "Graphs" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {config.bars.map((d) => <BarCard key={d.title} def={d} a={a} b={b} names={names} />)}
          {config.scatters.map((d) => <ScatterCard key={d.title} def={d} a={a} b={b} names={names} />)}
        </div>
      ) : (
        (config.extraTabs ?? []).find((t) => t.name === tab)?.tables.map((t) => (
          <section key={t.title} className="grid gap-2">
            <h2>{t.title}</h2>
            <StatsTable def={t} a={a} b={b} names={names} />
          </section>
        ))
      )}
    </div>
  );
}
