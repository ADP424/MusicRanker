import { useMutation } from "@tanstack/react-query";
import { Download, ListOrdered, Pencil, Plus, RefreshCw, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { api } from "../api/client";
import {
  useGuildApi, useRankedTelevisionSeasons, useTelevisionGenres, useTelevisionSeasons, useTelevisionShow,
} from "../api/hooks";
import { rk } from "../api/keys";
import type { RankedTelevisionSeason, TelevisionSeason } from "../api/types";
import { CAST_ROLE_LABELS, TV_SHOW_ROLES } from "../api/types";
import { AddAllButton } from "../components/AddAllButton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ChildList } from "../components/detail/ChildList";
import { DetailHeader, ExternalLinks, Facts, fmtMinutes, RefLinks, Section } from "../components/detail/DetailKit";
import { MyEntrySection } from "../components/detail/MyEntrySection";
import { PeopleSection } from "../components/detail/PeopleSection";
import { TaxonomySection } from "../components/detail/TaxonomySection";
import { GuildHolders } from "../components/GuildHolders";
import { LinksSection } from "../components/LinksSection";
import { LoadFailed } from "../components/LoadFailed";
import { MediaHero } from "../components/MediaHero";
import { LoadingState, Spinner } from "../components/Spinner";
import { TelevisionSeasonForm } from "../components/TelevisionSeasonForm";
import { TelevisionShowForm } from "../components/TelevisionShowForm";
import { TmdbTelevisionSeasonImportDialog } from "../components/TmdbTelevisionSeasonImportDialog";
import { TELEVISION_GENRES } from "../genre/config";
import { GenreChooser } from "../genre/GenreChooser";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";

type SeasonImpact = { rankings_destroyed: number; episodes_destroyed: number; episode_rankings_destroyed: number };

/** People credited on a season or episode, in a line, each once. */
export function peopleLine(persons: { id: number; name: string }[]) {
  return [...new Map(persons.map((p) => [p.id, p.name])).values()].join(", ");
}

export function TelevisionShowDetailPage() {
  const sid = Number(useParams<{ id: string }>().id);
  const { guildId, userId: me, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const [dialog, setDialog] = useState<
    { kind: "show" } | { kind: "season"; season?: TelevisionSeason } | { kind: "import"; season?: TelevisionSeason } | null
  >(null);
  const [deleting, setDeleting] = useState<{ season: TelevisionSeason; impact: SeasonImpact } | null>(null);
  const [viewingUser, setViewingUser] = useState(me);

  const { data: show, isLoading, isError, error, refetch } = useTelevisionShow(sid);
  const { data: ranked = [], isLoading: rankedLoading } = useRankedTelevisionSeasons(sid, viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useTelevisionSeasons(sid);
  const { data: genres = [] } = useTelevisionGenres();
  const genreNames = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);

  const impact = useMutation({
    mutationFn: (season: TelevisionSeason) => api.get<SeasonImpact>(`${base}/television/seasons/${season.id}/impact`),
    meta: { invalidates: false },
    onSuccess: (data, season) => setDeleting({ season, impact: data }),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`${base}/television/seasons/${id}`) });

  const sync = useMutation({
    mutationFn: () => api.post<{ seasons_added: number; episodes_added: number; runtimes_updated: number }>(`${base}/television/tmdb-import/sync/${sid}`),
    onSuccess: ({ seasons_added: s, episodes_added: e, runtimes_updated: r }) => {
      const bits = [
        s > 0 && `${s} new season${s === 1 ? "" : "s"}`,
        e > 0 && `${e} new episode${e === 1 ? "" : "s"}`,
        r > 0 && `${r} runtime${r === 1 ? "" : "s"} corrected`,
      ].filter(Boolean);
      toast.success(bits.length ? `Synced: ${bits.join(", ")}` : "Already up to date with TMDB");
    },
  });

  usePageTitle(show?.name);
  if (isLoading) return <LoadingState label="Loading show…" />;
  if (isError || !show) return <LoadFailed what="show" error={error} onRetry={() => void refetch()} />;

  const related = show.soundtrack_albums.length > 0 || (show.source_books ?? []).length > 0 || show.notes;

  return (
    <div className="grid gap-5">
      <DetailHeader
        title={show.name}
        altTitle={show.name_en}
        facts={[
          show.release_year,
          `${show.season_count} season${show.season_count === 1 ? "" : "s"}`,
          `${show.episode_count} episode${show.episode_count === 1 ? "" : "s"}`,
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="episodes"><ListOrdered className="size-4" /> Best episodes</Link>
            </Button>
            {canEdit && (
              <Button variant="outline" size="sm" disabled={sync.isPending} title="Add new seasons and episodes, and correct runtimes" onClick={() => sync.mutate()}>
                {sync.isPending ? <Spinner size="sm" /> : <RefreshCw className="size-4" />} Sync with TMDB
              </Button>
            )}
            {canEdit && <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "show" })}><Pencil className="size-4" /> Edit</Button>}
          </>
        }
      />
      <MediaHero image={show.image_url} overview={show.overview}
                 external={show.tmdb_id ? { href: `https://www.themoviedb.org/tv/${show.tmdb_id}`, label: "TMDB" } : null}
                 refresh={{ path: `television/shows/${show.id}/tmdb-refresh`, source: "TMDB" }} />
      <GuildHolders vertical="television" id={show.id} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <ChildList<TelevisionSeason, RankedTelevisionSeason>
            title="Seasons"
            noun={["season", "seasons"]}
            field="season"
            ranked={ranked}
            rankedLoading={rankedLoading}
            rankKey={rk(guildId, me, "television", "shows", sid, "seasons", "ranked")}
            catalog={catalog}
            catalogLoading={catalogLoading}
            viewingUser={viewingUser}
            onViewingUser={setViewingUser}
            href={(s) => `television/seasons/${s.id}`}
            entryPath={(s) => `television/seasons/${s.id}`}
            meta={(s) => [
              s.release_year,
              `${s.episode_count} episode${s.episode_count === 1 ? "" : "s"}`,
              s.runtime_minutes > 0 && fmtMinutes(s.runtime_minutes),
            ].filter(Boolean).join(" · ")}
            detail={(s) => (
              <Facts items={[
                ["People", s.persons.length > 0 && peopleLine(s.persons)],
                ["Links", s.links.length > 0 && <ExternalLinks links={s.links} />],
                ["Notes", s.notes],
              ]} />
            )}
            catalogMenu={canEdit || canDelete ? (s) => (
              <>
                {canEdit && <DropdownMenuItem onSelect={() => setDialog({ kind: "season", season: s })}><Pencil /> Edit</DropdownMenuItem>}
                {canEdit && <DropdownMenuItem onSelect={() => setDialog({ kind: "import", season: s })}><Download /> Import credits from TMDB</DropdownMenuItem>}
                {canDelete && (
                  <DropdownMenuItem variant="destructive" onSelect={() => impact.mutate(s)}><Trash2 /> Delete from catalog</DropdownMenuItem>
                )}
              </>
            ) : undefined}
            removeNote="Your episode rankings are separate and stay."
            headerActions={
              <>
                {ranked.length >= 2 && viewingUser === me && (
                  <Button variant="ghost" size="sm" asChild><Link to="rank"><Scale className="size-4" /> Rank</Link></Button>
                )}
                <AddAllButton path={`television/shows/${show.id}/seasons/add-all`} noun="seasons" />
                {canEdit && <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "season" })}><Plus className="size-4" /> Add</Button>}
                {canEdit && <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "import" })}><Download className="size-4" /> Import</Button>}
              </>
            }
          />
          <PeopleSection
            path="television/shows" ownerId={show.id} persons={show.persons} roles={TV_SHOW_ROLES}
            roleLabels={CAST_ROLE_LABELS} defaultRole="creator"
            scanHref={`television/scan?scope=show:${show.id}&name=${encodeURIComponent(show.name)}`}
            populateDown={{
              label: "Populate down",
              confirm: `Attach the show's people to all ${show.season_count} season(s) and ${show.episode_count} episode(s)? Creators stay on the show; anyone already credited is left as is.`,
            }}
          />
          {related && (
            <Section title="Related">
              <Facts items={[
                ["Soundtrack", <RefLinks items={show.soundtrack_albums} to={(id) => `music/albums/${id}`} />],
                ["Based on", <RefLinks items={show.source_books ?? []} to={(id) => `books/${id}`} />],
                ["Notes", show.notes],
              ]} />
            </Section>
          )}
        </div>
        <div className="grid content-start gap-5">
          <MyEntrySection entryPath={`television/shows/${show.id}`} noun="show" />
          <TaxonomySection path="television/shows" ownerId={show.id} ids={show.genre_ids} names={genreNames}
                           linkTo={(id) => `television/genres/${id}`}
                           chooser={(sel, change) => <GenreChooser domain={TELEVISION_GENRES} selected={sel} onChange={change} />} />
          <LinksSection path="television/shows" section="television" ownerId={show.id} />
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          message={`Delete “${deleting.season.name}” from the guild catalog? This also deletes its ${deleting.impact.episodes_destroyed} episode(s); ${deleting.impact.rankings_destroyed} season ranking(s) and ${deleting.impact.episode_rankings_destroyed} episode ranking(s) go with them.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.season.id, { onSettled: () => setDeleting(null) })}
          onCancel={() => setDeleting(null)}
        />
      )}
      {dialog && (
        <>
          {dialog.kind === "show" ? (
            <TelevisionShowForm initial={show} onClose={() => setDialog(null)} />
          ) : dialog.kind === "season" ? (
            <TelevisionSeasonForm show={show} initial={dialog.season} onClose={() => setDialog(null)} />
          ) : (
            <TmdbTelevisionSeasonImportDialog show={show} season={dialog.season}
                                              onClose={() => setDialog(null)} onSuccess={() => setDialog(null)} />
          )}
        </>
      )}
    </div>
  );
}
