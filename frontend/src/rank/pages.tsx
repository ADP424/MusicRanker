import { useMemo } from "react";
import { NavLink, useParams } from "react-router-dom";
import {
  useArtistCatalog, useComparisonMutations, useComparisons, useGuildApi, useRankedMovies,
  useRankedGames, useRankedTelevisionShows, useReorder, useTelevisionShow, useArtist,
} from "../api/hooks";
import { api } from "../api/client";
import { useQuery } from "@tanstack/react-query";
import type { Album } from "../api/types";
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
function useAnswers(path: string) {
  const { data: comparisons = [], isLoading } = useComparisons(path);
  const { upsert, remove, clear } = useComparisonMutations(path);
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
  const { data: artists = [], isLoading } = useArtistCatalog();
  const answers = useAnswers("artists");
  const reorder = useReorder("artists", "artists");

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
  const { guildId, base } = useGuildApi();

  const { data: artist } = useArtist(aid);
  const { data: albums = [], isLoading } = useQuery({
    queryKey: ["g", guildId, "artists", aid, "albums"],
    queryFn: () => api.get<Album[]>(`${base}/artists/${aid}/albums`),
    enabled: !Number.isNaN(aid),
  });
  const answers = useAnswers(`artists/${aid}/albums`);
  const reorder = useReorder(`artists/${aid}/albums`, "artists");

  const items: RankItem[] = useMemo(
    () =>
      albums.map((a) => ({
        id: a.id,
        label: a.name,
        sublabel: a.name_en,
        meta: `${a.release_year} · ${secs(a.runtime_seconds)}`,
      })),
    [albums],
  );

  const tabs = (
    <div className="page-tabs">
      <NavLink to={`/g/${guildId}/music/artists/${aid}`} end>
        Overview
      </NavLink>
      <NavLink to={`/g/${guildId}/music/artists/${aid}/rank`}>Rank Albums</NavLink>
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
  const { data: ranked = [], isLoading } = useRankedMovies();
  const answers = useAnswers("movies");
  const reorder = useReorder("movies", "movies");

  const items: RankItem[] = useMemo(
    () =>
      ranked.map((r) => {
        const directors = r.movie.persons.filter((p) => p.role === "director").map((p) => p.name);
        return {
          id: r.movie.id,
          label: r.movie.name,
          sublabel: r.movie.name_en,
          meta: `${r.movie.release_year} · ${mins(r.movie.runtime_minutes)}${directors.length ? ` · ${directors.join(", ")}` : ""}`,
        };
      }),
    [ranked],
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
  const { data: ranked = [], isLoading } = useRankedGames();
  const answers = useAnswers("games");
  const reorder = useReorder("games", "games");

  const items: RankItem[] = useMemo(
    () =>
      ranked.map((r) => ({
        id: r.game.id,
        label: r.game.name,
        sublabel: r.game.name_en,
        meta: `${r.game.release_year}${r.hours_played != null ? ` · ${r.hours_played}h played` : ""}`,
      })),
    [ranked],
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
  const { data: ranked = [], isLoading } = useRankedTelevisionShows();
  const answers = useAnswers("television/shows");
  const reorder = useReorder("television/shows", "television");

  const items: RankItem[] = useMemo(
    () =>
      ranked.map((r) => ({
        id: r.show.id,
        label: r.show.name,
        sublabel: r.show.name_en,
        meta: `${r.show.release_year} · ${r.show.episode_count} episode${r.show.episode_count === 1 ? "" : "s"}`,
      })),
    [ranked],
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
  const { guildId } = useGuildApi();

  const { data: show, isLoading: showLoading } = useTelevisionShow(sid);
  const answers = useAnswers(`television/shows/${sid}/episodes`);
  const reorder = useReorder(`television/shows/${sid}/episodes`, "television");
  const { data: episodesRanked = [], isLoading } = useEpisodesForRank(sid);

  const items: RankItem[] = useMemo(
    () =>
      episodesRanked.map((e) => ({
        id: e.id,
        label: e.name,
        sublabel: e.name_en,
        meta: `${e.release_year} · ${mins(e.runtime_minutes)}`,
      })),
    [episodesRanked],
  );

  const tabs = (
    <div className="page-tabs">
      <NavLink to={`/g/${guildId}/television/shows/${sid}`} end>
        Overview
      </NavLink>
      <NavLink to={`/g/${guildId}/television/shows/${sid}/rank`}>Rank Episodes</NavLink>
    </div>
  );

  return (
    <PairwiseRankPage
      title={show ? `Rank ${show.name} Episodes` : "Rank Episodes"}
      scopeKey={`tv-episodes:${sid}`}
      noun="episode"
      nounPlural="episodes"
      items={items}
      isLoading={showLoading || isLoading || answers.isLoading}
      comparisons={answers.comparisons}
      onAnswer={answers.onAnswer}
      onDeleteAnswer={answers.onDeleteAnswer}
      onClearAnswers={answers.onClearAnswers}
      onApply={(ids) => reorder.mutateAsync(ids)}
      tabs={tabs}
    />
  );
}

function useEpisodesForRank(sid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: ["g", guildId, "television", "shows", sid, "episodes"],
    queryFn: () => api.get<{ id: number; name: string; name_en: string | null; release_year: number; runtime_minutes: number }[]>(
      `${base}/television/shows/${sid}/episodes`,
    ),
    enabled: !Number.isNaN(sid),
  });
}
