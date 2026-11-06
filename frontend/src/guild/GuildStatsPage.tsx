import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { gk } from "../api/keys";
import { LoadFailed } from "../components/LoadFailed";

interface SectionStats {
  catalog: number;
  in_any_list: number;
  mine: number;
  path: string;
  top: { id: number; name: string; holders: number }[];
}
interface GuildStats {
  sections: Record<string, SectionStats>;
  members: { user_id: number; username: string; counts: Record<string, number> }[];
  me: { movie_minutes: number; episode_minutes: number; album_minutes: number; game_hours: number; book_words: number };
}

const SECTIONS: [key: string, label: string, noun: string][] = [
  ["music", "Music", "artists"], ["books", "Books", "books"], ["movies", "Movies", "movies"],
  ["television", "Television", "shows"], ["games", "Games", "games"],
];

const hours = (minutes: number) => `${Math.round(minutes / 60).toLocaleString()} h`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 px-5 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

/** The whole guild across every medium: what you've got through, what's in the catalog, who has what. */
export function GuildStatsPage() {
  const { guildId, base } = useGuildApi();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: gk(guildId, "guild-stats"),
    queryFn: () => api.get<GuildStats>(`${base}/overview/stats`),
  });
  if (isError) return <LoadFailed what="page" error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const { me, sections, members } = data;

  return (
    <div className="grid gap-8">
      <div>
        <h1>Guild stats</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everything at once, across every medium.</p>
      </div>

      <section className="grid gap-3">
        <h2>Your time</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tile label="Movies" value={hours(me.movie_minutes)} sub="runtime × watches" />
          <Tile label="Television" value={hours(me.episode_minutes)} sub="episodes in your lists" />
          <Tile label="Music" value={hours(me.album_minutes)} sub="each album once" />
          <Tile label="Games" value={`${Math.round(me.game_hours).toLocaleString()} h`} sub="hours you've logged" />
          <Tile label="Books" value={me.book_words.toLocaleString()} sub="words, where known" />
        </div>
      </section>

      <section className="grid gap-3">
        <h2>The catalog</h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Section</th>
                <th className="px-4 py-2 text-right font-medium">In the catalog</th>
                <th className="px-4 py-2 text-right font-medium">In someone's list</th>
                <th className="px-4 py-2 text-right font-medium">In your list</th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map(([key, label, noun]) => {
                const s = sections[key];
                return (
                  <tr key={key} className="border-b last:border-b-0">
                    <td className="px-4 py-2 font-medium">{label} <span className="font-normal text-muted-foreground">({noun})</span></td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.catalog.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.in_any_list.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.mine.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3">
        <h2>Members</h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Member</th>
                {SECTIONS.map(([key, label]) => <th key={key} className="px-4 py-2 text-right font-medium">{label}</th>)}
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id} className="border-b last:border-b-0">
                  <td className="px-4 py-2 font-medium">{m.username}</td>
                  {SECTIONS.map(([key]) => (
                    <td key={key} className="px-4 py-2 text-right tabular-nums">{(m.counts[key] ?? 0).toLocaleString()}</td>
                  ))}
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {Object.values(m.counts).reduce((a, b) => a + b, 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3">
        <h2>Most shared</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.filter(([key]) => sections[key].top.length > 0).map(([key, label]) => (
            <Card key={key} className="gap-2 px-5 py-4">
              <h3>{label}</h3>
              <ol className="grid gap-1 text-sm">
                {sections[key].top.map((t) => (
                  <li key={t.id} className="flex items-baseline justify-between gap-3">
                    <Link className="min-w-0 truncate hover:underline" to={`/g/${guildId}/${sections[key].path}/${t.id}`}>{t.name}</Link>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t.holders} {t.holders === 1 ? "member" : "members"}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
