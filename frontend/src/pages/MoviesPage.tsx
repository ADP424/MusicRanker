import { Minus, Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useGuildApi, useMovieCatalog, useMovieGenres, useRankedMovies, useUpdateMovieEntry } from "../api/hooks";
import type { CastRole, Movie, RankedMovie } from "../api/types";
import { CAST_ROLE_LABELS, MOVIE_ROLES } from "../api/types";
import { DetailRows, EntityListPage, LinkList } from "../components/EntityListPage";
import { MovieForm } from "../components/MovieForm";
import { Spinner } from "../components/Spinner";
import { TmdbImportDialog } from "../components/TmdbImportDialog";
import { matchesAny, personNamed, taxonIdsMatching } from "../search/textMatch";
import { taxonomyNames } from "../lib/facets";

const SEARCH_BY = ["all", "title", "genre", "person"] as const;

export function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`;
  return `${m}m`;
}

/** − 3× + : the watch counter on your own ranked rows. */
export function CountControl({ value, min = 1, busy, unit, onChange }: {
  value: number; min?: number; busy: boolean; unit: string; onChange: (n: number) => void;
}) {
  return (
    <span className="flex items-center gap-0.5 text-sm tabular-nums">
      <Button variant="ghost" size="icon-sm" aria-label={`One fewer ${unit}`} disabled={value <= min || busy}
              onClick={() => onChange(value - 1)}><Minus /></Button>
      <span className="w-8 text-center" aria-live="polite">{busy ? <Spinner size="sm" /> : `${value}×`}</span>
      <Button variant="ghost" size="icon-sm" aria-label={`One more ${unit}`} disabled={busy}
              onClick={() => onChange(value + 1)}><Plus /></Button>
    </span>
  );
}

function WatchCount({ entry }: { entry: RankedMovie }) {
  const update = useUpdateMovieEntry(entry.movie.id);
  return (
    <CountControl value={entry.watches} unit="watch" busy={update.isPending}
                  onChange={(watches) => update.mutate({ watches })} />
  );
}

export function MoviesPage() {
  const navigate = useNavigate();
  const { guildId } = useGuildApi();
  const { data: genres = [] } = useMovieGenres();

  const facets = useMemo(() => {
    const names = taxonomyNames(genres);
    return [{ key: "genre", label: "genres", values: (t: Movie) => names(t.genre_ids) }];
  }, [genres]);
  const genreName = Object.fromEntries(genres.map((g) => [g.id, g.name]));

  const matches = useCallback((m: Movie, needle: string, by: string) => {
    if ((by === "title" || by === "all") && matchesAny(needle, m.name, m.name_en)) return true;
    if (by === "genre" || by === "all") {
      const ids = taxonIdsMatching(needle, genres);
      if (m.genre_ids.some((id) => ids.has(id))) return true;
    }
    return (by === "person" || by === "all") && personNamed(needle, m.persons);
  }, [genres]);

  const meta = (m: Movie) => {
    const directors = m.persons.filter((p) => p.role === "director").map((p) => p.name);
    return [m.release_year, fmtRuntime(m.runtime_minutes), directors.join(", ")].filter(Boolean).join(" · ");
  };

  const detail = (m: Movie) => {
    const byRole: Partial<Record<CastRole, Movie["persons"]>> = {};
    for (const p of m.persons) (byRole[p.role] ??= []).push(p);
    const genreRefs = m.genre_ids.filter((id) => genreName[id]).map((id) => ({ id, name: genreName[id] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return (
      <DetailRows rows={[
        ...MOVIE_ROLES.filter((r) => byRole[r]?.length).map((role): [string, React.ReactNode] => [
          CAST_ROLE_LABELS[role], <LinkList items={byRole[role]!} to={(id) => `/g/${guildId}/people/${id}`} />,
        ]),
        ["Genres", genreRefs.length > 0 && <LinkList items={genreRefs} to={(id) => `/g/${guildId}/movies/genres/${id}`} />],
        ["Soundtrack", m.soundtrack_albums.length > 0 && <LinkList items={m.soundtrack_albums} to={(id) => `/g/${guildId}/music/albums/${id}`} />],
        ["Based on", m.source_books.length > 0 && <LinkList items={m.source_books} to={(id) => `/g/${guildId}/books/${id}`} />],
        ["Notes", m.notes],
      ]} />
    );
  };

  return (
    <EntityListPage<Movie, RankedMovie>
      title="Movies"
      noun={["movie", "movies"]}
      section="movies"
      route="movies"
      entityKey="movie"
      ranked={useRankedMovies}
      catalog={useMovieCatalog}
      searchBy={SEARCH_BY}
      facets={facets}
      countsSection="movies"
      sorts={[{ key: "runtime", label: "Longest", value: (m) => m.runtime_minutes }]}
      matches={matches}
      meta={meta}
      year={(m) => m.release_year}
      image={(m) => m.image_url}
      detail={detail}
      entryControls={(r) => <WatchCount entry={r} />}
      restoreBody={(r) => ({ watches: r.watches })}
      form={(initial, close) => <MovieForm initial={initial} onClose={close} />}
      importer={{
        label: "Import from TMDB",
        render: (close) => (
          <TmdbImportDialog onClose={close} onSuccess={(movieId) => navigate(`/g/${guildId}/movies/${movieId}`)} />
        ),
      }}
    />
  );
}
