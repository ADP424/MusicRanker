import { useQuery } from "@tanstack/react-query";
import { Download, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { api } from "../api/client";
import { useGuildApi, useMovieGenres } from "../api/hooks";
import { gk } from "../api/keys";
import type { Movie } from "../api/types";
import { CAST_ROLE_LABELS, MOVIE_ROLES } from "../api/types";
import { DetailHeader, Facts, fmtMinutes, RefLinks, Section } from "../components/detail/DetailKit";
import { MyEntrySection } from "../components/detail/MyEntrySection";
import { PeopleSection } from "../components/detail/PeopleSection";
import { TaxonomySection } from "../components/detail/TaxonomySection";
import { GuildHolders } from "../components/GuildHolders";
import { LinksSection } from "../components/LinksSection";
import { LoadFailed } from "../components/LoadFailed";
import { MediaHero } from "../components/MediaHero";
import { MovieForm } from "../components/MovieForm";
import { TmdbImportDialog } from "../components/TmdbImportDialog";
import { LoadingState } from "../components/Spinner";
import { MOVIE_GENRES } from "../genre/config";
import { GenreChooser } from "../genre/GenreChooser";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";

export function MovieDetailPage() {
  const movieId = Number(useParams<{ id: string }>().id);
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [importingCredits, setImportingCredits] = useState(false);
  const { data: genres = [] } = useMovieGenres();
  const genreNames = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);

  const { data: movie, isLoading, isError, error, refetch } = useQuery({
    queryKey: gk(guildId, "movies", movieId),
    queryFn: () => api.get<Movie>(`${base}/movies/${movieId}`),
    enabled: !isNaN(movieId),
  });

  usePageTitle(movie?.name);
  if (isLoading) return <LoadingState label="Loading movie…" />;
  if (isError || !movie) return <LoadFailed what="movie" error={error} onRetry={() => void refetch()} />;

  const related = movie.soundtrack_albums.length > 0 || (movie.source_books ?? []).length > 0 || movie.notes;

  return (
    <div className="grid gap-5">
      <DetailHeader
        title={movie.name}
        altTitle={movie.name_en}
        facts={[movie.release_year, fmtMinutes(movie.runtime_minutes)]}
        actions={canEdit && (
          <>
            <Button variant="outline" size="sm" onClick={() => setImportingCredits(true)}><Download className="size-4" /> Import credits</Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
          </>
        )}
      />
      <MediaHero image={movie.image_url} overview={movie.overview}
                 external={movie.tmdb_id ? { href: `https://www.themoviedb.org/movie/${movie.tmdb_id}`, label: "TMDB" } : null}
                 refresh={{ path: `movies/${movie.id}/tmdb-refresh`, source: "TMDB" }} />
      <GuildHolders vertical="movies" id={movie.id} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <PeopleSection path="movies" ownerId={movie.id} persons={movie.persons} roles={MOVIE_ROLES}
                         roleLabels={CAST_ROLE_LABELS} defaultRole="director"
                         scanHref={`movies/scan?scope=movie:${movie.id}&name=${encodeURIComponent(movie.name)}`} />
          {related && (
            <Section title="Related">
              <Facts items={[
                ["Soundtrack", <RefLinks items={movie.soundtrack_albums} to={(id) => `music/albums/${id}`} />],
                ["Based on", <RefLinks items={movie.source_books ?? []} to={(id) => `books/${id}`} />],
                ["Notes", movie.notes],
              ]} />
            </Section>
          )}
        </div>
        <div className="grid content-start gap-5">
          <MyEntrySection entryPath={`movies/${movie.id}`} noun="movie" counter={{ key: "watches", label: "Watches" }} />
          <TaxonomySection path="movies" ownerId={movie.id} ids={movie.genre_ids} names={genreNames}
                           linkTo={(id) => `movies/genres/${id}`}
                           chooser={(sel, change) => <GenreChooser domain={MOVIE_GENRES} selected={sel} onChange={change} />} />
          <LinksSection path="movies" section="movies" ownerId={movie.id} />
        </div>
      </div>

      {editing && <MovieForm initial={movie} onClose={() => setEditing(false)} />}
      {importingCredits && <TmdbImportDialog mergeInto={movie} onClose={() => setImportingCredits(false)} />}
    </div>
  );
}
