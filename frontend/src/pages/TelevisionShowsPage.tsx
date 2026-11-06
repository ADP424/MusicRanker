import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { useGuildApi, useRankedTelevisionShows, useTelevisionCatalog, useTelevisionGenres } from "../api/hooks";
import type { CastRole, RankedTelevisionShow, TelevisionShow } from "../api/types";
import { CAST_ROLE_LABELS, TV_SHOW_ROLES } from "../api/types";
import { DetailRows, EntityListPage, LinkList } from "../components/EntityListPage";
import { TelevisionShowForm } from "../components/TelevisionShowForm";
import { TmdbTelevisionImportDialog } from "../components/TmdbTelevisionImportDialog";
import { matchesAny, personNamed, taxonIdsMatching } from "../search/textMatch";
import { taxonomyNames } from "../lib/facets";

const SEARCH_BY = ["all", "title", "genre", "person", "episode"] as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function TelevisionShowsPage() {
  const navigate = useNavigate();
  const { guildId } = useGuildApi();
  const { data: genres = [] } = useTelevisionGenres();

  const facets = useMemo(() => {
    const names = taxonomyNames(genres);
    return [{ key: "genre", label: "genres", values: (t: TelevisionShow) => names(t.genre_ids) }];
  }, [genres]);
  const genreName = Object.fromEntries(genres.map((g) => [g.id, g.name]));

  const matches = useCallback((s: TelevisionShow, needle: string, by: string) => {
    if ((by === "title" || by === "all") && matchesAny(needle, s.name, s.name_en)) return true;
    if (by === "genre" || by === "all") {
      const ids = taxonIdsMatching(needle, genres);
      if (s.genre_ids.some((id) => ids.has(id))) return true;
    }
    if ((by === "person" || by === "all") && personNamed(needle, s.persons)) return true;
    return (by === "episode" || by === "all") && s.episodes.some((e) => matchesAny(needle, e.name, e.name_en));
  }, [genres]);

  const meta = (s: TelevisionShow) =>
    `${s.release_year} · ${plural(s.season_count, "season")} · ${plural(s.episode_count, "episode")}`;

  const detail = (s: TelevisionShow) => {
    const byRole: Partial<Record<CastRole, TelevisionShow["persons"]>> = {};
    for (const p of s.persons) (byRole[p.role] ??= []).push(p);
    const genreRefs = s.genre_ids.filter((id) => genreName[id]).map((id) => ({ id, name: genreName[id] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return (
      <DetailRows rows={[
        ...TV_SHOW_ROLES.filter((r) => byRole[r]?.length).map((role): [string, React.ReactNode] => [
          CAST_ROLE_LABELS[role], <LinkList items={byRole[role]!} to={(id) => `/g/${guildId}/people/${id}`} />,
        ]),
        ["Seasons", s.seasons.length > 0 && <LinkList items={s.seasons} to={(id) => `/g/${guildId}/television/seasons/${id}`} />],
        ["Genres", genreRefs.length > 0 && <LinkList items={genreRefs} to={(id) => `/g/${guildId}/television/genres/${id}`} />],
        ["Soundtrack", s.soundtrack_albums.length > 0 && <LinkList items={s.soundtrack_albums} to={(id) => `/g/${guildId}/music/albums/${id}`} />],
        ["Based on", s.source_books.length > 0 && <LinkList items={s.source_books} to={(id) => `/g/${guildId}/books/${id}`} />],
        ["Notes", s.notes],
      ]} />
    );
  };

  return (
    <EntityListPage<TelevisionShow, RankedTelevisionShow>
      title="TV shows"
      noun={["show", "shows"]}
      section="television/shows"
      route="television/shows"
      entityKey="show"
      ranked={useRankedTelevisionShows}
      catalog={useTelevisionCatalog}
      searchBy={SEARCH_BY}
      facets={facets}
      countsSection="television"
      matches={matches}
      meta={meta}
      year={(s) => s.release_year}
      image={(s) => s.image_url}
      detail={detail}
      restoreBody={() => ({})}
      form={(initial, close) => <TelevisionShowForm initial={initial} onClose={close} />}
      importer={{
        label: "Import from TMDB",
        render: (close) => (
          <TmdbTelevisionImportDialog onClose={close}
                                      onSuccess={(showId) => navigate(`/g/${guildId}/television/shows/${showId}`)} />
        ),
      }}
    />
  );
}
