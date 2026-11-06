import { Download, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useGuildApi, useTelevisionEpisode, useTelevisionGenres, useTelevisionSeason, useTelevisionShow } from "../api/hooks";
import { CAST_ROLE_LABELS, TV_EPISODE_ROLES } from "../api/types";
import { DetailHeader, fmtMinutes, Section } from "../components/detail/DetailKit";
import { MyEntrySection } from "../components/detail/MyEntrySection";
import { PeopleSection } from "../components/detail/PeopleSection";
import { TaxonomySection } from "../components/detail/TaxonomySection";
import { LinksSection } from "../components/LinksSection";
import { LoadFailed } from "../components/LoadFailed";
import { MediaHero } from "../components/MediaHero";
import { PrevNext } from "../components/PrevNext";
import { LoadingState } from "../components/Spinner";
import { TelevisionEpisodeForm } from "../components/TelevisionEpisodeForm";
import { TmdbTelevisionEpisodeImportDialog } from "../components/TmdbTelevisionEpisodeImportDialog";
import { TELEVISION_GENRES } from "../genre/config";
import { GenreChooser } from "../genre/GenreChooser";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";

export function TelevisionEpisodeDetailPage() {
  const eid = Number(useParams<{ id: string }>().id);
  const { guildId } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [dialog, setDialog] = useState<"edit" | "import" | null>(null);
  const { data: genres = [] } = useTelevisionGenres();
  const genreNames = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);

  const { data: episode, isLoading, isError, error, refetch } = useTelevisionEpisode(eid);
  const { data: show } = useTelevisionShow(episode?.show_id ?? 0);
  const { data: season } = useTelevisionSeason(episode?.season_id ?? 0);

  usePageTitle(episode ? `${show?.name ?? "…"} · ${episode.name}` : null);
  if (isLoading) return <LoadingState label="Loading episode…" />;
  if (isError || !episode) return <LoadFailed what="episode" error={error} onRetry={() => void refetch()} />;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          <Link to={`/g/${guildId}/television/shows/${episode.show_id}`} className="hover:underline">← {show?.name ?? "Show"}</Link>
          {" / "}
          <Link to={`/g/${guildId}/television/seasons/${episode.season_id}`} className="hover:underline">{season?.name ?? "Season"}</Link>
        </span>
        <PrevNext items={season?.episodes} current={episode.id} noun="Episode" href={(e) => `/g/${guildId}/television/episodes/${e.id}`} />
      </div>
      <DetailHeader
        title={episode.name}
        altTitle={episode.name_en}
        facts={[
          season?.season_number != null && episode.episode_number != null && `S${season.season_number} E${episode.episode_number}`,
          episode.release_year,
          fmtMinutes(episode.runtime_minutes),
        ]}
        actions={canEdit && show && season && (
          <>
            <Button variant="outline" size="sm" onClick={() => setDialog("import")}><Download className="size-4" /> Import credits</Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("edit")}><Pencil className="size-4" /> Edit</Button>
          </>
        )}
      />
      <MediaHero image={episode.image_url} overview={episode.overview}
                 external={show?.tmdb_id && season?.season_number != null && episode.episode_number
                   ? { href: `https://www.themoviedb.org/tv/${show.tmdb_id}/season/${season.season_number}/episode/${episode.episode_number}`, label: "TMDB" }
                   : null} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <PeopleSection path="television/episodes" ownerId={episode.id} persons={episode.persons} roles={TV_EPISODE_ROLES}
                         roleLabels={CAST_ROLE_LABELS} defaultRole="director" />
          {episode.notes && <Section title="Notes"><p className="text-sm whitespace-pre-line">{episode.notes}</p></Section>}
        </div>
        <div className="grid content-start gap-5">
          <MyEntrySection entryPath={`television/episodes/${episode.id}`} noun="episode" counter={{ key: "watches", label: "Watches" }} />
          <TaxonomySection path="television/episodes" ownerId={episode.id} ids={episode.genre_ids} names={genreNames}
                           linkTo={(id) => `television/genres/${id}`}
                           chooser={(sel, change) => <GenreChooser domain={TELEVISION_GENRES} selected={sel} onChange={change} />} />
          <LinksSection path="television/episodes" section="television" ownerId={episode.id} />
        </div>
      </div>

      {dialog && show && season && (
        dialog === "edit" ? (
          <TelevisionEpisodeForm show={show} season={season} initial={episode} onClose={() => setDialog(null)} />
        ) : (
          <TmdbTelevisionEpisodeImportDialog show={show} season={season} episode={episode} onClose={() => setDialog(null)} />
        )
      )}
    </div>
  );
}
