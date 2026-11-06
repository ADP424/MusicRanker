import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Crown, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { gk } from "../api/keys";
import { useMe } from "../auth/AuthProvider";
import { useGuild } from "./GuildProvider";

type Vertical = "artists" | "books" | "movies" | "games" | "television";
const VERTICALS: Array<[Vertical, string, string]> = [
  ["movies", "Movies", "movies"], ["television", "TV", "television/shows"], ["books", "Books", "books"],
  ["games", "Games", "games"], ["artists", "Music", "music/artists"],
];

interface Item { id: number; name: string; year: number | null }
interface Shared extends Item { mine: number; theirs: number; gap: number }
interface Compare {
  other_name: string; my_count: number; their_count: number; shared: number; agreement: number | null;
  shared_items: Shared[]; disagreements: Shared[]; only_mine: Item[]; only_theirs: Item[];
}
interface Consensus { members: number; items: Array<Item & { score: number; members: number; top_of: string[] }> }
interface Member { user_id: number; username: string }

/** Two members' rankings side by side, or what the whole guild thinks. */
export function ComparePage() {
  const guild = useGuild();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const vertical = (VERTICALS.find(([v]) => v === params.get("v"))?.[0] ?? "movies") as Vertical;
  const route = VERTICALS.find(([v]) => v === vertical)![2];
  const set = (k: string, v: string | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (v) n.set(k, v); else n.delete(k);
    return n;
  }, { replace: true });

  const members = useQuery({ queryKey: gk(guild.id, "members"), queryFn: () => api.get<Member[]>(`/guilds/${guild.id}/members`) });
  const others = (members.data ?? []).filter((m) => m.user_id !== me.id);
  const other = Number(params.get("with")) || others[0]?.user_id || null;
  const mode = params.get("mode") === "consensus" ? "consensus" : "compare";

  const compare = useQuery({
    queryKey: gk(guild.id, "social", "compare", vertical, other),
    queryFn: () => api.get<Compare>(`/guilds/${guild.id}/social/compare?vertical=${vertical}&other=${other}`),
    enabled: mode === "compare" && other !== null,
  });
  const consensus = useQuery({
    queryKey: gk(guild.id, "social", "consensus", vertical),
    queryFn: () => api.get<Consensus>(`/guilds/${guild.id}/social/consensus?vertical=${vertical}`),
    enabled: mode === "consensus",
  });

  const link = (it: Item) => (
    <Link className="truncate hover:underline" to={`/g/${guild.id}/${route}/${it.id}`}>
      {it.name}{it.year && <span className="text-muted-foreground"> ({it.year})</span>}
    </Link>
  );

  return (
    <div className="grid gap-5">
      <div>
        <h1>Compare rankings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See where you and another member agree, or what the guild ranks highest overall.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={mode} onValueChange={(m) => set("mode", m === "consensus" ? "consensus" : null)}>
          <TabsList>
            <TabsTrigger value="compare">With a member</TabsTrigger>
            <TabsTrigger value="consensus">Guild consensus</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={vertical} onValueChange={(v) => set("v", v === "movies" ? null : v)}>
          <TabsList>
            {VERTICALS.map(([v, label]) => <TabsTrigger key={v} value={v}>{label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        {mode === "compare" && others.length > 0 && (
          <select aria-label="Member to compare with" className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={other ?? ""} onChange={(e) => set("with", e.target.value)}>
            {others.map((m) => <option key={m.user_id} value={m.user_id}>{m.username}</option>)}
          </select>
        )}
      </div>

      {mode === "compare" && (
        members.isLoading ? <Skeleton className="h-40" /> : others.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            You're the only member so far. Invite someone to compare rankings.
          </CardContent></Card>
        ) : compare.isLoading || !compare.data ? <Skeleton className="h-40" /> : (
          <CompareView c={compare.data} link={link} />
        )
      )}

      {mode === "consensus" && (
        consensus.isLoading || !consensus.data ? <Skeleton className="h-60" /> : consensus.data.items.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Nobody has ranked anything here yet.</CardContent></Card>
        ) : (
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-3 [.border-b]:pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                <Users className="size-4" /> Averaged over {consensus.data.members} member{consensus.data.members === 1 ? "" : "s"}' lists:
                100 means everyone who ranked it put it first.
              </CardTitle>
            </CardHeader>
            <ol>
              {consensus.data.items.map((it, i) => (
                <li key={it.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto_auto] items-center gap-3 border-b px-4 py-2 text-sm last:border-b-0">
                  <span className="tabular-nums text-muted-foreground">#{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    {link(it)}
                    {it.top_of.map((n) => <Badge key={n} variant="secondary" title={`${n}'s #1`}><Crown /> {n}</Badge>)}
                  </span>
                  <span className="text-xs text-muted-foreground">{it.members} ranked</span>
                  <span className="w-12 text-right font-medium tabular-nums">{it.score.toFixed(0)}</span>
                </li>
              ))}
            </ol>
          </Card>
        )
      )}
    </div>
  );
}

function CompareView({ c, link }: { c: Compare; link: (it: Item) => ReactNode }) {
  const pct = c.agreement;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardContent className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-4xl font-semibold tabular-nums">{pct === null ? "–" : `${pct.toFixed(0)}%`}</p>
            <p className="text-sm text-muted-foreground">agreement with {c.other_name}</p>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            {c.shared < 2
              ? `You share ${c.shared} ranked item${c.shared === 1 ? "" : "s"}; agreement needs at least two.`
              : `Of every pair of the ${c.shared} things you've both ranked, how often you put them in the same order.`}
            {" "}You've ranked {c.my_count}; {c.other_name} has ranked {c.their_count}.
          </p>
        </CardContent>
      </Card>

      <ListCard title="Biggest disagreements" empty="Nothing in common yet.">
        {c.disagreements.filter((s) => Math.abs(s.gap) > 0).map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{link(s)}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">you #{s.mine} · them #{s.theirs}</span>
            <span className={cn("flex shrink-0 items-center text-xs", s.gap > 0 ? "text-success" : "text-warning")}>
              {s.gap > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
              {s.gap > 0 ? "you rate it higher" : "they rate it higher"}
            </span>
          </li>
        ))}
      </ListCard>

      <ListCard title="Ranked by both" empty="Nothing in common yet.">
        {c.shared_items.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{link(s)}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">you #{s.mine} · them #{s.theirs}</span>
          </li>
        ))}
      </ListCard>

      <ListCard title={`Only in your list`} empty="Nothing they haven't ranked.">
        {c.only_mine.map((it) => <li key={it.id} className="px-4 py-2 text-sm">{link(it)}</li>)}
      </ListCard>
      <ListCard title={`Only in ${c.other_name}'s list`} empty="Nothing you haven't ranked.">
        {c.only_theirs.map((it) => <li key={it.id} className="px-4 py-2 text-sm">{link(it)}</li>)}
      </ListCard>
    </div>
  );
}

function ListCard({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-3 [.border-b]:pb-3"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      {children.length === 0
        ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
        : <ul className="divide-y">{children}</ul>}
    </Card>
  );
}
