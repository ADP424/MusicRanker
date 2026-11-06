import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Clapperboard, Gamepad2, GitMerge, type LucideIcon, Music, Pencil, Tv, UserCog, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { gk } from "../api/keys";
import type { ActivityPage, GuildOverview } from "../api/types";
import { Field, FormDialog } from "../components/form/FormKit";
import { useMe } from "../auth/AuthProvider";
import { useCan, useGuild } from "./GuildProvider";

const SECTIONS: { key: keyof GuildOverview["sections"]; label: string; noun: string; icon: LucideIcon }[] = [
  { key: "music", label: "Music", noun: "artists", icon: Music },
  { key: "books", label: "Books", noun: "books", icon: BookOpen },
  { key: "movies", label: "Movies", noun: "movies", icon: Clapperboard },
  { key: "television", label: "Television", noun: "shows", icon: Tv },
  { key: "games", label: "Games", noun: "games", icon: Gamepad2 },
];

const SECTION_ICON: Record<string, LucideIcon> = Object.fromEntries(SECTIONS.map((s) => [s.key, s.icon]));

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  for (const [secs, unit] of [[86400 * 365, "y"], [86400 * 30, "mo"], [86400, "d"], [3600, "h"], [60, "m"]] as const)
    if (s >= secs) return `${Math.floor(s / secs)}${unit} ago`;
  return "";
}

export function GuildHomePage() {
  const guild = useGuild();
  const { guildId, base } = useGuildApi();
  const canMerge = useCan("merge_in");
  const canManage = useCan("manage_members");
  const { data, isLoading } = useQuery({
    queryKey: gk(guildId, "overview"),
    queryFn: () => api.get<GuildOverview>(`${base}/overview`),
  });
  const empty = data && SECTIONS.every((s) => data.sections[s.key].catalog === 0);
  const nothingListed = data && SECTIONS.every((s) => data.sections[s.key].mine === 0);
  const canRename = useCan("guild_settings");
  const [renaming, setRenaming] = useState(false);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5">
            {guild.name}
            {canRename && (
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Rename this guild"
                      onClick={() => setRenaming(true)}><Pencil /></Button>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? `${data.members} member${data.members === 1 ? "" : "s"} · ${data.people} people in the catalog` : " "}
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button variant="outline" size="sm" asChild><Link to="members"><UserCog className="size-4" /> Members</Link></Button>
          )}
          {canMerge && (
            <Button variant="outline" size="sm" asChild><Link to="merge"><GitMerge className="size-4" /> Merge a guild in</Link></Button>
          )}
        </div>
      </div>

      {empty && <Onboarding />}
      {data && !empty && nothingListed && (
        <Card className="gap-1 border-dashed px-6 py-4">
          <p className="font-medium">Your lists are empty</p>
          <p className="text-sm text-muted-foreground">
            Open a section's Catalog tab and add what you've seen, read or played; several at once with “Select several”.
            Then use its Rank page to put them in order.
          </p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => {
          const c = data?.sections[s.key];
          return (
            <Link key={s.key} to={s.key} className="group">
              <Card className="h-full gap-3 px-5 py-4 transition-colors group-hover:border-primary/40">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <s.icon className="size-4.5" />
                  </span>
                  <span className="font-semibold">{s.label}</span>
                </div>
                {isLoading || !c ? <Skeleton className="h-5 w-40" /> : (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{c.mine}</span> in your list ·{" "}
                    {c.catalog} {s.noun} in the catalog
                  </p>
                )}
              </Card>
            </Link>
          );
        })}
        <Link to="people" className="group">
          <Card className="h-full gap-3 px-5 py-4 transition-colors group-hover:border-primary/40">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users className="size-4.5" />
              </span>
              <span className="font-semibold">People</span>
            </div>
            <p className="text-sm text-muted-foreground">Everyone credited across the catalog, and how they connect.</p>
          </Card>
        </Link>
      </div>

      <ActivityFeed />
      {renaming && <RenameGuild name={guild.name} id={guild.id} onClose={() => setRenaming(false)} />}
    </div>
  );
}

function RenameGuild({ id, name, onClose }: { id: number; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(name);
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: () => api.patch(`/guilds/${id}`, { name: value.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <FormDialog title="Rename this guild" onClose={onClose} onSubmit={() => save.mutate()} busy={save.isPending}
                error={save.error} submitLabel="Save" submitDisabled={!value.trim()}>
      <Field label="Name"><Input required autoFocus maxLength={100} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
    </FormDialog>
  );
}

/** A guild with nothing in it: the three steps, and the shortest way into the first. */
function Onboarding() {
  const canCreate = useCan("catalog_create");
  const canMerge = useCan("merge_in");
  const steps = [
    { title: "Fill the catalog", text: canCreate
        ? "Import movies and shows from TMDB and games from IGDB, or add music and books by hand. Their people come along."
        : "Ask someone who can edit the catalog to add the first titles." },
    { title: "Add what you know", text: "Each member keeps their own list. Add a title to yours and it goes in at the bottom." },
    { title: "Put it in order", text: "The Rank pages ask “which do you prefer?” until your order settles. Members' lists can then be compared." },
  ];
  return (
    <Card className="gap-4 px-6 py-5">
      <div>
        <h2>Welcome. Here's how this works</h2>
        <p className="mt-1 text-sm text-muted-foreground">This guild's catalog is empty.</p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="grid content-start gap-1">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
            <p className="font-medium">{s.title}</p>
            <p className="text-sm text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>
      {canCreate && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild><Link to="movies"><Clapperboard className="size-4" /> Movies</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="television"><Tv className="size-4" /> Television</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="games"><Gamepad2 className="size-4" /> Games</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="music"><Music className="size-4" /> Music</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="books"><BookOpen className="size-4" /> Books</Link></Button>
          {canMerge && <Button size="sm" variant="ghost" asChild><Link to="merge"><GitMerge className="size-4" /> Or merge another guild in</Link></Button>}
        </div>
      )}
    </Card>
  );
}

type FeedKind = "all" | "catalog" | "list";

function ActivityFeed() {
  const { guildId, base } = useGuildApi();
  const me = useMe();
  const [kind, setKind] = useState<FeedKind>("all");
  const feed = useInfiniteQuery({
    queryKey: gk(guildId, "activity", kind),
    queryFn: ({ pageParam }) =>
      api.get<ActivityPage>(`${base}/overview/activity?kind=${kind}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>Activity</h2>
        <Tabs value={kind} onValueChange={(v) => setKind(v as FeedKind)}>
          <TabsList>
            <TabsTrigger value="all">Everything</TabsTrigger>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
            <TabsTrigger value="list">Lists</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {feed.isLoading ? <Skeleton className="h-40" /> : !items.length ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {items.map((r) => {
            const Icon = SECTION_ICON[r.section] ?? Users;
            const who = r.user_id === me.id ? "You" : (r.username ?? "Someone");
            const where = r.kind === "catalog" ? "to the catalog" : r.user_id === me.id ? "to your list" : "to their list";
            return (
              <Link key={`${r.kind}-${r.section}-${r.id}-${r.user_id}-${r.at}`} to={`${r.path}/${r.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">{who} added </span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground"> {where}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground" title={new Date(r.at).toLocaleString()}>
                  {ago(r.at)}
                </span>
              </Link>
            );
          })}
        </Card>
      )}
      {feed.hasNextPage && (
        <Button variant="outline" size="sm" className="justify-self-center" disabled={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}>
          {feed.isFetchingNextPage ? "Loading…" : "Show older"}
        </Button>
      )}
    </section>
  );
}
