import { useQuery } from "@tanstack/react-query";
import { Download, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { api } from "../api/client";
import { useGameGenres, useGamePlatforms, useGuildApi } from "../api/hooks";
import { gk } from "../api/keys";
import type { Game } from "../api/types";
import { GAME_ROLE_LABELS, GAME_ROLES } from "../api/types";
import { DetailHeader, Facts, RefLinks, Section } from "../components/detail/DetailKit";
import { MyEntrySection } from "../components/detail/MyEntrySection";
import { PeopleSection } from "../components/detail/PeopleSection";
import { TaxonomySection } from "../components/detail/TaxonomySection";
import { GameForm } from "../components/GameForm";
import { IgdbImportDialog } from "../components/IgdbImportDialog";
import { GamePlatformChooser } from "../components/GamePlatformChooser";
import { GuildHolders } from "../components/GuildHolders";
import { LinksSection } from "../components/LinksSection";
import { LoadFailed } from "../components/LoadFailed";
import { MediaHero } from "../components/MediaHero";
import { LoadingState } from "../components/Spinner";
import { GAME_GENRES } from "../genre/config";
import { GenreChooser } from "../genre/GenreChooser";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";

export function GameDetailPage() {
  const gameId = Number(useParams<{ id: string }>().id);
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [importingCredits, setImportingCredits] = useState(false);
  const { data: genres = [] } = useGameGenres();
  const { data: platforms = [] } = useGamePlatforms();
  const genreNames = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);
  const platformNames = useMemo(() => new Map(platforms.map((p) => [p.id, p.name])), [platforms]);

  const { data: game, isLoading, isError, error, refetch } = useQuery({
    queryKey: gk(guildId, "games", gameId),
    queryFn: () => api.get<Game>(`${base}/games/${gameId}`),
    enabled: !isNaN(gameId),
  });

  usePageTitle(game?.name);
  if (isLoading) return <LoadingState label="Loading game…" />;
  if (isError || !game) return <LoadFailed what="game" error={error} onRetry={() => void refetch()} />;

  const related = game.soundtrack_albums.length > 0 || (game.source_books ?? []).length > 0 || game.notes;

  return (
    <div className="grid gap-5">
      <DetailHeader
        title={game.name}
        altTitle={game.name_en}
        facts={[game.release_year]}
        actions={canEdit && (
          <>
            <Button variant="outline" size="sm" onClick={() => setImportingCredits(true)}><Download className="size-4" /> Import credits</Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
          </>
        )}
      />
      <MediaHero image={game.image_url} overview={game.overview}
                 refresh={{ path: `games/${game.id}/igdb-refresh`, source: "IGDB" }} />
      <GuildHolders vertical="games" id={game.id} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <PeopleSection path="games" ownerId={game.id} persons={game.persons} roles={GAME_ROLES}
                         roleLabels={GAME_ROLE_LABELS} defaultRole="developer"
                         scanHref={`games/scan?scope=game:${game.id}&name=${encodeURIComponent(game.name)}`} />
          {related && (
            <Section title="Related">
              <Facts items={[
                ["Soundtrack", <RefLinks items={game.soundtrack_albums} to={(id) => `music/albums/${id}`} />],
                ["Based on", <RefLinks items={game.source_books ?? []} to={(id) => `books/${id}`} />],
                ["Notes", game.notes],
              ]} />
            </Section>
          )}
        </div>
        <div className="grid content-start gap-5">
          <MyEntrySection entryPath={`games/${game.id}`} noun="game" hours />
          <TaxonomySection title="Platforms" path="games" segment="platforms" ownerId={game.id} ids={game.platform_ids}
                           names={platformNames} linkTo={(id) => `games/platforms/${id}`}
                           chooser={(sel, change) => <GamePlatformChooser selected={sel} onChange={change} />} />
          <TaxonomySection path="games" ownerId={game.id} ids={game.genre_ids} names={genreNames}
                           linkTo={(id) => `games/genres/${id}`}
                           chooser={(sel, change) => <GenreChooser domain={GAME_GENRES} selected={sel} onChange={change} />} />
          <LinksSection path="games" section="games" ownerId={game.id} />
        </div>
      </div>

      {editing && <GameForm initial={game} onClose={() => setEditing(false)} />}
      {importingCredits && <IgdbImportDialog mergeInto={game} onClose={() => setImportingCredits(false)} />}
    </div>
  );
}
