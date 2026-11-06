import { Minus, Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  useGameCatalog, useGameGenres, useGamePlatforms, useGuildApi, useRankedGames, useUpdateGameEntry,
} from "../api/hooks";
import type { Game, GameRole, RankedGame } from "../api/types";
import { GAME_ROLE_LABELS, GAME_ROLES } from "../api/types";
import { DetailRows, EntityListPage, LinkList } from "../components/EntityListPage";
import { GameForm } from "../components/GameForm";
import { IgdbImportDialog } from "../components/IgdbImportDialog";
import { Spinner } from "../components/Spinner";
import { matchesAny, personNamed, taxonIdsMatching } from "../search/textMatch";
import { taxonomyNames } from "../lib/facets";

const SEARCH_BY = ["all", "title", "genre", "platform", "person"] as const;

/** − 12.5h + : hours played, in half-hour steps. */
function HoursControl({ entry }: { entry: RankedGame }) {
  const update = useUpdateGameEntry(entry.game.id);
  const hours = Number(entry.hours_played ?? 0);
  const set = (h: number) => update.mutate({ hours_played: Math.max(0, h) });
  return (
    <span className="flex items-center gap-0.5 text-sm tabular-nums">
      <Button variant="ghost" size="icon-sm" aria-label="Half an hour less" disabled={hours <= 0 || update.isPending}
              onClick={() => set(hours - 0.5)}><Minus /></Button>
      <span className="w-12 text-center" aria-live="polite">
        {update.isPending ? <Spinner size="sm" /> : entry.hours_played == null ? "–" : `${hours}h`}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Half an hour more" disabled={update.isPending}
              onClick={() => set(hours + 0.5)}><Plus /></Button>
    </span>
  );
}

export function GamesPage() {
  const navigate = useNavigate();
  const { guildId } = useGuildApi();
  const { data: genres = [] } = useGameGenres();
  const { data: platforms = [] } = useGamePlatforms();

  const facets = useMemo(() => {
    const genreNames = taxonomyNames(genres);
    const platformNames = taxonomyNames(platforms);
    return [
      { key: "genre", label: "genres", values: (g: Game) => genreNames(g.genre_ids) },
      { key: "platform", label: "platforms", values: (g: Game) => platformNames(g.platform_ids) },
    ];
  }, [genres, platforms]);
  const genreName = Object.fromEntries(genres.map((g) => [g.id, g.name]));
  const platformName = Object.fromEntries(platforms.map((p) => [p.id, p.name]));

  const matches = useCallback((g: Game, needle: string, by: string) => {
    if ((by === "title" || by === "all") && matchesAny(needle, g.name, g.name_en)) return true;
    if (by === "genre" || by === "all") {
      const ids = taxonIdsMatching(needle, genres);
      if (g.genre_ids.some((id) => ids.has(id))) return true;
    }
    if (by === "platform" || by === "all") {
      const ids = taxonIdsMatching(needle, platforms);
      if (g.platform_ids.some((id) => ids.has(id))) return true;
    }
    return (by === "person" || by === "all") && personNamed(needle, g.persons);
  }, [genres, platforms]);

  const meta = (g: Game) => {
    const devs = g.persons.filter((p) => p.role === "developer").map((p) => p.name);
    return [g.release_year, devs.join(", ")].filter(Boolean).join(" · ");
  };

  const detail = (g: Game) => {
    const byRole: Partial<Record<GameRole, Game["persons"]>> = {};
    for (const p of g.persons) (byRole[p.role] ??= []).push(p);
    const sorted = (ids: number[], names: Record<number, string>) =>
      ids.filter((id) => names[id]).map((id) => ({ id, name: names[id] })).sort((a, b) => a.name.localeCompare(b.name));
    const genreRefs = sorted(g.genre_ids, genreName);
    const platformRefs = sorted(g.platform_ids, platformName);
    return (
      <DetailRows rows={[
        ...GAME_ROLES.filter((r) => byRole[r]?.length).map((role): [string, React.ReactNode] => [
          GAME_ROLE_LABELS[role], <LinkList items={byRole[role]!} to={(id) => `/g/${guildId}/people/${id}`} />,
        ]),
        ["Genres", genreRefs.length > 0 && <LinkList items={genreRefs} to={(id) => `/g/${guildId}/games/genres/${id}`} />],
        ["Platforms", platformRefs.length > 0 && <LinkList items={platformRefs} to={(id) => `/g/${guildId}/games/platforms/${id}`} />],
        ["Soundtrack", g.soundtrack_albums.length > 0 && <LinkList items={g.soundtrack_albums} to={(id) => `/g/${guildId}/music/albums/${id}`} />],
        ["Based on", g.source_books.length > 0 && <LinkList items={g.source_books} to={(id) => `/g/${guildId}/books/${id}`} />],
        ["Notes", g.notes],
      ]} />
    );
  };

  return (
    <EntityListPage<Game, RankedGame>
      title="Games"
      noun={["game", "games"]}
      section="games"
      route="games"
      entityKey="game"
      ranked={useRankedGames}
      catalog={useGameCatalog}
      searchBy={SEARCH_BY}
      facets={facets}
      countsSection="games"
      matches={matches}
      meta={meta}
      year={(g) => g.release_year}
      image={(g) => g.image_url}
      detail={detail}
      entryControls={(r) => <HoursControl entry={r} />}
      restoreBody={(r) => (r.hours_played == null ? {} : { hours_played: r.hours_played })}
      form={(initial, close) => <GameForm initial={initial} onClose={close} />}
      importer={{
        label: "Import from IGDB",
        render: (close) => (
          <IgdbImportDialog onClose={close} onSuccess={(gameId) => navigate(`/g/${guildId}/games/${gameId}`)} />
        ),
      }}
    />
  );
}
