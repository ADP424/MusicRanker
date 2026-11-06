import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "../api/client";
import { useGuildApi, useRankedShowEpisodes, useTelevisionSeasons, useTelevisionShow } from "../api/hooks";
import { rk } from "../api/keys";
import { LoadFailed } from "../components/LoadFailed";
import { MemberPicker } from "../components/MemberPicker";
import { SortableList } from "../components/SortableList";
import { LoadingState } from "../components/Spinner";
import { reorderEntries } from "../lib/reorder";
import { usePageTitle } from "../shell/pageTitle";

/** One list of a show's best episodes, across seasons. A second order over the
 *  same list rows as the per-season rankings: adding or removing an episode
 *  affects both, reordering one leaves the other alone. */
export function TelevisionShowEpisodesPage() {
  const sid = Number(useParams<{ id: string }>().id);
  const { guildId, userId: me, base } = useGuildApi();
  const qc = useQueryClient();
  const [viewingUser, setViewingUser] = useState(me);
  const isMine = viewingUser === me;

  const { data: show, isLoading: showLoading, error: showError } = useTelevisionShow(sid);
  const { data: seasons = [] } = useTelevisionSeasons(sid);
  const { data: ranked = [], isLoading } = useRankedShowEpisodes(sid, viewingUser);
  const rankKey = rk(guildId, me, "television", "shows", sid, "episodes", "ranked");

  // "S2E5" from the season's number (or its airing position) and the episode's.
  const seasonLabel = useMemo(() => {
    const m = new Map<number, string>();
    seasons.forEach((s, i) => m.set(s.id, `S${s.season_number ?? i + 1}`));
    return m;
  }, [seasons]);

  const move = useMutation({
    mutationFn: (v: { episodeId: number; position: number }) =>
      api.put(`${base}/television/episodes/${v.episodeId}/show-position`, { position: v.position }),
    meta: { invalidates: false },
    onSettled: () => qc.invalidateQueries({ queryKey: rankKey }),
  });

  usePageTitle(show?.name ?? null);
  if (showLoading) return <LoadingState label="Loading show…" />;
  if (!show) return <LoadFailed what="show" error={showError} />;

  const items = ranked.map((r) => ({ ...r.episode, position: r.position, watches: r.watches }));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{show.name}: all episodes</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isMine ? "Your" : "Their"} favourite episodes of the whole show, best first. This order is separate from the
            per-season rankings; episodes join it when they're added to a list on a season page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MemberPicker value={viewingUser} onChange={setViewingUser} />
          {isMine && ranked.length >= 2 && (
            <Button size="sm" variant="outline" asChild>
              <Link to="rank"><Scale className="size-4" /> Rank by comparing</Link>
            </Button>
          )}
        </div>
      </div>

      <SortableList
        items={items}
        loading={isLoading}
        loadingLabel="Loading episodes…"
        empty={
          <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
            {isMine
              ? <>No episodes of this show in your list yet. Add them from the <Link className="underline" to={`/g/${guildId}/television/shows/${sid}`}>season pages</Link>.</>
              : "This member hasn't ranked any episodes of this show yet."}
          </p>
        }
        disableDrag={!isMine}
        pendingId={move.isPending ? move.variables?.episodeId ?? null : null}
        itemLabel={(e) => e.name}
        onReorder={(next) => {
          void qc.cancelQueries({ queryKey: rankKey });
          qc.setQueryData(rankKey, reorderEntries(ranked, next, "episode"));
        }}
        onMove={(episodeId, position) => move.mutate({ episodeId, position })}
        render={(e) => (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {seasonLabel.get(e.season_id) ?? "S?"}{e.episode_number != null ? `E${e.episode_number}` : ""}
            </Badge>
            <Link to={`/g/${guildId}/television/episodes/${e.id}`} className="min-w-0 truncate font-medium hover:underline">
              {e.name}
            </Link>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {e.release_year} · {e.runtime_minutes}m{e.watches > 1 ? ` · ${e.watches}× watched` : ""}
            </span>
          </div>
        )}
      />
    </div>
  );
}
