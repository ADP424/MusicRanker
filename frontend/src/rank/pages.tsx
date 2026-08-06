import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { NavLink, useParams } from "react-router-dom";
import { api } from "../api/client";
import {
  COMPARISONS,
  useArtists,
  useComparisonMutations,
  useComparisons,
  useGamesRanked,
  useMoviesRanked,
  useReorderArtistAlbums,
  useReorderArtists,
  useReorderGames,
  useReorderMovies,
  useReorderTelevisionEpisodes,
  useReorderTelevisionShows,
  useTelevisionShowsRanked,
  type ComparisonEndpoint,
} from "../api/hooks";
import type { Album, Artist, TelevisionShow } from "../api/types";
import { PairwiseRankPage, type RankItem } from "./PairwiseRankPage";

function mins(m: number) {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
}
function secs(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Bundles the four comparison callbacks the page needs. */
function useAnswers(ep: ComparisonEndpoint) {
  const { data: comparisons = [], isLoading } = useComparisons(ep);
  const { upsert, remove, clear } = useComparisonMutations(ep);
  return {
    comparisons,
    isLoading,
    onAnswer: upsert.mutateAsync,
    onDeleteAnswer: (a: number, b: number) => remove.mutateAsync({ a, b }),
    onClearAnswers: () => clear.mutateAsync(undefined),
  };
}

// ── Artists ────────────────────────────────────────────────────────────────────

export function ArtistsRankPage() {
  const { data: artists = [], isLoading } = useArtists();
  const answers = useAnswers(COMPARISONS.artists);
  const reorder = useReorderArtists();

  const items: RankItem[] = useMemo(
    () => artists.map((a) => ({ id: a.id, label: a.name, sublabel: a.name_en, meta: a.core_nationality })),
    [artists],
  );

  return (
    <PairwiseRankPage
      title="Rank Artists"
      scopeKey="artists"
      noun="artist"
      nounPlural="artists"
      items={items}
      isLoading={isLoading || answers.isLoading}
      comparisons={answers.comparisons}
      onAnswer={answers.onAnswer}
      onDeleteAnswer={answers.onDeleteAnswer}
      onClearAnswers={answers.onClearAnswers}
      onApply={(ids) => reorder.mutateAsync(ids)}
    />
  );
}

// ── Albums (scoped to one artist) ──────────────────────────────────────────────

export function ArtistAlbumsRankPage() {
  const { id } = useParams<{ id: string }>();
  const aid = Number(id);

  const { data: artist } = useQuery({
    queryKey: ["artists", aid],
    queryFn: () => api.get<Artist>(`/artists/${aid}`),
    enabled: !Number.isNaN(aid),
  });
  const { data: albums = [], isLoading } = useQuery({
    queryKey: ["artists", aid, "albums"],
    queryFn: () => api.get<Album[]>(`/artists/${aid}/albums`),
    enabled: !Number.isNaN(aid),
  });
  const answers = useAnswers(COMPARISONS.artistAlbums(aid));
  const reorder = useReorderArtistAlbums(aid);

  const items: RankItem[] = useMemo(
    () =>
      albums.map((a) => ({
        id: a.id,
        label: a.name,
        sublabel: a.name_en,
        meta: `${a.release_year} · ${secs(a.runtime_seconds)} · ${a.listens}×`,
      })),
    [albums],
  );

  const tabs = (
    <div className="page-tabs">
      <NavLink to={`/music/artists/${aid}`} end>
        Overview
      </NavLink>
      <NavLink to={`/music/artists/${aid}/rank`}>Rank Albums</NavLink>
    </div>
  );

  return (
    <PairwiseRankPage
      title={artist ? `Rank ${artist.name}'s Albums` : "Rank Albums"}
      scopeKey={`albums:${aid}`}
      noun="album"
      nounPlural="albums"
      items={items}
      isLoading={isLoading || answers.isLoading}
      comparisons={answers.comparisons}
      onAnswer={answers.onAnswer}
      onDeleteAnswer={answers.onDeleteAnswer}
      onClearAnswers={answers.onClearAnswers}
      onApply={(ids) => reorder.mutateAsync(ids)}
      tabs={tabs}
    />
  );
}

// ── Movies ─────────────────────────────────────────────────────────────────────

export function MoviesRankPage() {
  const { data: movies = [], isLoading } = useMoviesRanked();
  const answers = useAnswers(COMPARISONS.movies);
  const reorder = useReorderMovies();

  const items: RankItem[] = useMemo(
    () =>
      movies.map((m) => {
        const directors = m.persons.filter((p) => p.role === "director").map((p) => p.name);
        return {
          id: m.id,
          label: m.name,
          sublabel: m.name_en,
          meta: `${m.release_year} · ${mins(m.runtime_minutes)}${directors.length ? ` · ${directors.join(", ")}` : ""}`,
        };
      }),
    [movies],
  );

  return (
    <PairwiseRankPage
      title="Rank Movies"
      scopeKey="movies"
      noun="movie"
      nounPlural="movies"
      items={items}
      isLoading={isLoading || answers.isLoading}
      comparisons={answers.comparisons}
      onAnswer={answers.onAnswer}
      onDeleteAnswer={answers.onDeleteAnswer}
      onClearAnswers={answers.onClearAnswers}
      onApply={(ids) => reorder.mutateAsync(ids)}
    />
  );
}

// ── Games ──────────────────────────────────────────────────────────────────────

export function GamesRankPage() {
  const { data: games = [], isLoading } = useGamesRanked();
  const answers = useAnswers(COMPARISONS.games);
  const reorder = useReorderGames();

  const items: RankItem[] = useMemo(
    () =>
      games.map((g) => ({
        id: g.id,
        label: g.name,
        sublabel: g.name_en,
        meta: `${g.release_year}${g.hours_played != null ? ` · ${g.hours_played}h played` : ""}`,
      })),
    [games],
  );

  return (
    <PairwiseRankPage
      title="Rank Games"
      scopeKey="games"
      noun="game"
      nounPlural="games"
      items={items}
      isLoading={isLoading || answers.isLoading}
      comparisons={answers.comparisons}
      onAnswer={answers.onAnswer}
      onDeleteAnswer={answers.onDeleteAnswer}
      onClearAnswers={answers.onClearAnswers}
      onApply={(ids) => reorder.mutateAsync(ids)}
    />
  );
}

// ── Television shows ───────────────────────────────────────────────────────────

export function TelevisionShowsRankPage() {
  const { data: shows = [], isLoading } = useTelevisionShowsRanked();
  const answers = useAnswers(COMPARISONS.televisionShows);
  const reorder = useReorderTelevisionShows();

  const items: RankItem[] = useMemo(
    () =>
      shows.map((s) => ({
        id: s.id,
        label: s.name,
        sublabel: s.name_en,
        meta: `${s.release_year} · ${s.episode_count} episode${s.episode_count === 1 ? "" : "s"}`,
      })),
    [shows],
  );

  return (
    <PairwiseRankPage
      title="Rank Television Shows"
      scopeKey="tv-shows"
      noun="show"
      nounPlural="shows"
      items={items}
      isLoading={isLoading || answers.isLoading}
      comparisons={answers.comparisons}
      onAnswer={answers.onAnswer}
      onDeleteAnswer={answers.onDeleteAnswer}
      onClearAnswers={answers.onClearAnswers}
      onApply={(ids) => reorder.mutateAsync(ids)}
    />
  );
}

// ── Episodes (scoped to one show) ──────────────────────────────────────────────

export function TelevisionEpisodesRankPage() {
  const { id } = useParams<{ id: string }>();
  const sid = Number(id);

  const { data: show, isLoading } = useQuery({
    queryKey: ["television", "shows", sid],
    queryFn: () => api.get<TelevisionShow>(`/television/shows/${sid}`),
    enabled: !Number.isNaN(sid),
  });
  const answers = useAnswers(COMPARISONS.televisionEpisodes(sid));
  const reorder = useReorderTelevisionEpisodes(sid);

  const items: RankItem[] = useMemo(
    () =>
      (show?.episodes ?? []).map((e) => ({
        id: e.id,
        label: e.name,
        sublabel: e.name_en,
        meta: `${e.release_year} · ${mins(e.runtime_minutes)} · ${e.watches}×`,
      })),
    [show],
  );

  const tabs = (
    <div className="page-tabs">
      <NavLink to={`/television/${sid}`} end>
        Overview
      </NavLink>
      <NavLink to={`/television/${sid}/rank`}>Rank Episodes</NavLink>
    </div>
  );

  return (
    <PairwiseRankPage
      title={show ? `Rank ${show.name} Episodes` : "Rank Episodes"}
      scopeKey={`tv-episodes:${sid}`}
      noun="episode"
      nounPlural="episodes"
      items={items}
      isLoading={isLoading || answers.isLoading}
      comparisons={answers.comparisons}
      onAnswer={answers.onAnswer}
      onDeleteAnswer={answers.onDeleteAnswer}
      onClearAnswers={answers.onClearAnswers}
      onApply={(ids) => reorder.mutateAsync(ids)}
      tabs={tabs}
    />
  );
}
