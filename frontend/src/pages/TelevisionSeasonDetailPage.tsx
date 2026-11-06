import { useMutation } from "@tanstack/react-query";
import { Download, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { api } from "../api/client";
import {
  useGuildApi, useRankedTelevisionEpisodes, useTelevisionEpisodes, useTelevisionGenres, useTelevisionSeason,
  useTelevisionShow,
} from "../api/hooks";
import { rk } from "../api/keys";
import type { RankedTelevisionEpisode, TelevisionEpisode } from "../api/types";
import { CAST_ROLE_LABELS, TV_SEASON_ROLES } from "../api/types";
import { AddAllButton } from "../components/AddAllButton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ChildList, RowCounter } from "../components/detail/ChildList";
import { DetailHeader, ExternalLinks, Facts, fmtMinutes, Section } from "../components/detail/DetailKit";
import { MyEntrySection } from "../components/detail/MyEntrySection";
import { PeopleSection } from "../components/detail/PeopleSection";
import { LinksSection } from "../components/LinksSection";
import { LoadFailed } from "../components/LoadFailed";
import { MediaHero } from "../components/MediaHero";
import { PrevNext } from "../components/PrevNext";
import { LoadingState } from "../components/Spinner";
import { TelevisionEpisodeForm } from "../components/TelevisionEpisodeForm";
import { TelevisionSeasonForm } from "../components/TelevisionSeasonForm";
import { TmdbTelevisionEpisodeImportDialog } from "../components/TmdbTelevisionEpisodeImportDialog";
import { TmdbTelevisionSeasonImportDialog } from "../components/TmdbTelevisionSeasonImportDialog";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";

type Dialog =
  | { kind: "season" } | { kind: "season-import" }
  | { kind: "episode"; episode?: TelevisionEpisode } | { kind: "episode-import"; episode?: TelevisionEpisode };

export function TelevisionSeasonDetailPage() {
  const seid = Number(useParams<{ id: string }>().id);
  const { guildId, userId: me, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [deleting, setDeleting] = useState<{ episode: TelevisionEpisode; rankings: number } | null>(null);
  const [viewingUser, setViewingUser] = useState(me);

  const { data: season, isLoading, isError, error, refetch } = useTelevisionSeason(seid);
  const { data: show } = useTelevisionShow(season?.show_id ?? 0);
  const { data: ranked = [], isLoading: rankedLoading } = useRankedTelevisionEpisodes(seid, viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useTelevisionEpisodes(seid);
  const { data: genres = [] } = useTelevisionGenres();
  const genreNames = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);

  const watches = useMutation({
    mutationFn: (v: { id: number; watches: number }) => api.put(`${base}/television/episodes/${v.id}/entry`, { watches: v.watches }),
  });
  const impact = useMutation({
    mutationFn: (e: TelevisionEpisode) => api.get<{ rankings_destroyed: number }>(`${base}/television/episodes/${e.id}/impact`),
    meta: { invalidates: false },
    onSuccess: (r, episode) => setDeleting({ episode, rankings: r.rankings_destroyed }),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`${base}/television/episodes/${id}`) });

  usePageTitle(season ? `${show?.name ?? "…"} · ${season.name}` : null);
  if (isLoading) return <LoadingState label="Loading season…" />;
  if (isError || !season) return <LoadFailed what="season" error={error} onRetry={() => void refetch()} />;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/g/${guildId}/television/shows/${season.show_id}`} className="text-sm text-muted-foreground hover:underline">
          ← {show?.name ?? "Show"}
        </Link>
        <PrevNext items={show?.seasons} current={season.id} noun="Season" href={(x) => `/g/${guildId}/television/seasons/${x.id}`} />
      </div>
      <DetailHeader
        title={season.name}
        altTitle={season.name_en}
        facts={[
          season.season_number != null && season.name !== `Season ${season.season_number}` && `Season ${season.season_number}`,
          season.release_year,
          `${season.episode_count} episode${season.episode_count === 1 ? "" : "s"}`,
          season.runtime_minutes > 0 && fmtMinutes(season.runtime_minutes),
        ]}
        actions={canEdit && show && (
          <>
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "season-import" })}><Download className="size-4" /> Import credits</Button>
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "season" })}><Pencil className="size-4" /> Edit</Button>
          </>
        )}
      />
      <MediaHero image={season.image_url} overview={season.overview}
                 external={show?.tmdb_id && season.season_number != null
                   ? { href: `https://www.themoviedb.org/tv/${show.tmdb_id}/season/${season.season_number}`, label: "TMDB" } : null} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <ChildList<TelevisionEpisode, RankedTelevisionEpisode>
            title="Episodes"
            noun={["episode", "episodes"]}
            field="episode"
            ranked={ranked}
            rankedLoading={rankedLoading}
            rankKey={rk(guildId, me, "television", "seasons", seid, "episodes", "ranked")}
            catalog={catalog}
            catalogLoading={catalogLoading}
            viewingUser={viewingUser}
            onViewingUser={setViewingUser}
            href={(e) => `television/episodes/${e.id}`}
            entryPath={(e) => `television/episodes/${e.id}`}
            meta={(e) => [e.episode_number != null && `E${e.episode_number}`, e.release_year, fmtMinutes(e.runtime_minutes)]
              .filter(Boolean).join(" · ")}
            rankedExtra={(e, r) => (
              <RowCounter value={r.watches} label="watches" busy={watches.isPending && watches.variables?.id === e.id}
                          onChange={(n) => watches.mutate({ id: e.id, watches: n })} />
            )}
            detail={(e) => (
              <Facts items={[
                ["Genres", e.genre_ids.length > 0 && e.genre_ids.map((g) => genreNames.get(g)).filter(Boolean).join(", ")],
                ["Links", e.links.length > 0 && <ExternalLinks links={e.links} />],
                ["Notes", e.notes],
              ]} />
            )}
            catalogMenu={(canEdit && show) || canDelete ? (e) => (
              <>
                {canEdit && show && <DropdownMenuItem onSelect={() => setDialog({ kind: "episode", episode: e })}><Pencil /> Edit</DropdownMenuItem>}
                {canEdit && show && (
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "episode-import", episode: e })}><Download /> Import credits from TMDB</DropdownMenuItem>
                )}
                {canDelete && <DropdownMenuItem variant="destructive" onSelect={() => impact.mutate(e)}><Trash2 /> Delete from catalog</DropdownMenuItem>}
              </>
            ) : undefined}
            headerActions={
              <>
                {ranked.length >= 2 && viewingUser === me && (
                  <Button variant="ghost" size="sm" asChild><Link to="rank"><Scale className="size-4" /> Rank</Link></Button>
                )}
                <AddAllButton path={`television/seasons/${season.id}/episodes/add-all`} noun="episodes" />
                {canEdit && show && <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "episode" })}><Plus className="size-4" /> Add</Button>}
                {canEdit && show && <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "episode-import" })}><Download className="size-4" /> Import</Button>}
              </>
            }
          />
          <PeopleSection
            path="television/seasons" ownerId={season.id} persons={season.persons} roles={TV_SEASON_ROLES}
            roleLabels={CAST_ROLE_LABELS} defaultRole="director"
            populateDown={{
              label: "Populate down",
              confirm: `Attach this season's people to all ${season.episode_count} of its episodes? Anyone already credited is left as is.`,
            }}
          />
          {season.notes && <Section title="Notes"><p className="text-sm whitespace-pre-line">{season.notes}</p></Section>}
        </div>
        <div className="grid content-start gap-5">
          <MyEntrySection entryPath={`television/seasons/${season.id}`} noun="season" />
          <LinksSection path="television/seasons" section="television" ownerId={season.id} />
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          message={`Delete “${deleting.episode.name}” from the guild catalog? ${deleting.rankings} member ranking(s) of it go with it.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.episode.id, { onSettled: () => setDeleting(null) })}
          onCancel={() => setDeleting(null)}
        />
      )}
      {dialog && show && (
        <>
          {dialog.kind === "season" ? (
            <TelevisionSeasonForm show={show} initial={season} onClose={() => setDialog(null)} />
          ) : dialog.kind === "season-import" ? (
            <TmdbTelevisionSeasonImportDialog show={show} season={season} onClose={() => setDialog(null)} onSuccess={() => setDialog(null)} />
          ) : dialog.kind === "episode" ? (
            <TelevisionEpisodeForm show={show} season={season} initial={dialog.episode} onClose={() => setDialog(null)} />
          ) : (
            <TmdbTelevisionEpisodeImportDialog show={show} season={season} episode={dialog.episode}
                                               onClose={() => setDialog(null)} onSuccess={() => setDialog(null)} />
          )}
        </>
      )}
    </div>
  );
}
