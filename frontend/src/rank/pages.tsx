import { useMemo } from "react";
import { NavLink, useParams } from "react-router-dom";
import {
  useArtistCatalog, useComparisonMutations, useComparisons, useGuildApi, useRankedBooks, useRankedMovies,
  useRankedGames, useRankedTelevisionEpisodes, useRankedTelevisionSeasons, useRankedTelevisionShows, useReorder,
  useTelevisionSeason, useTelevisionShow, useArtist,
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

// ── Books ──────────────────────────────────────────────────────────────────────

export function BooksRankPage() {
  const { data: ranked = [], isLoading } = useRankedBooks();
  const answers = useAnswers("books");
  const reorder = useReorder("books", "books");

  const items: RankItem[] = useMemo(
    () =>
      ranked.map((r) => {
        const authors = r.book.persons.filter((p) => p.role === "author").map((p) => p.name);
        const words = r.book.word_count != null ? ` · ${r.book.word_count.toLocaleString()} words` : "";
        return {
          id: r.book.id,
          label: r.book.name,
          sublabel: r.book.name_en,
          meta: `${r.book.release_year}${words}${authors.length ? ` · ${authors.join(", ")}` : ""}`,
        };
      }),
    [ranked],
  );

  return (
    <PairwiseRankPage
      title="Rank Books"
      scopeKey="books"
      noun="book"
      nounPlural="books"
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

// ── Seasons (scoped to one show) ───────────────────────────────────────────────

export function TelevisionSeasonsRankPage() {
  const { id } = useParams<{ id: string }>();
  const sid = Number(id);
  const { guildId } = useGuildApi();

  const { data: show, isLoading: showLoading } = useTelevisionShow(sid);
  const { data: ranked = [], isLoading } = useRankedTelevisionSeasons(sid);
  const answers = useAnswers(`television/shows/${sid}/seasons`);
  const reorder = useReorder(`television/shows/${sid}/seasons`, "television");

  const items: RankItem[] = useMemo(
    () =>
      ranked.map((r) => ({
        id: r.season.id,
        label: r.season.name,
        sublabel: r.season.name_en,
        meta: `${r.season.release_year} · ${r.season.episode_count} episode${r.season.episode_count === 1 ? "" : "s"}`,
      })),
    [ranked],
  );

  const tabs = (
    <div className="page-tabs">
      <NavLink to={`/g/${guildId}/television/shows/${sid}`} end>
        Overview
      </NavLink>
      <NavLink to={`/g/${guildId}/television/shows/${sid}/rank`}>Rank Seasons</NavLink>
    </div>
  );

  return (
    <PairwiseRankPage
      title={show ? `Rank ${show.name} Seasons` : "Rank Seasons"}
      scopeKey={`tv-seasons:${sid}`}
      noun="season"
      nounPlural="seasons"
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

// ── Episodes (scoped to one season) ────────────────────────────────────────────

export function TelevisionEpisodesRankPage() {
  const { id } = useParams<{ id: string }>();
  const seid = Number(id);
  const { guildId } = useGuildApi();

  const { data: season, isLoading: seasonLoading } = useTelevisionSeason(seid);
  const { data: show } = useTelevisionShow(season?.show_id ?? 0);
  const { data: ranked = [], isLoading } = useRankedTelevisionEpisodes(seid);
  const answers = useAnswers(`television/seasons/${seid}/episodes`);
  const reorder = useReorder(`television/seasons/${seid}/episodes`, "television");

  const items: RankItem[] = useMemo(
    () =>
      ranked.map((r) => ({
        id: r.episode.id,
        label: r.episode.name,
        sublabel: r.episode.name_en,
        meta: `${r.episode.release_year} · ${mins(r.episode.runtime_minutes)}`,
      })),
    [ranked],
  );

  const tabs = (
    <div className="page-tabs">
      <NavLink to={`/g/${guildId}/television/seasons/${seid}`} end>
        Overview
      </NavLink>
      <NavLink to={`/g/${guildId}/television/seasons/${seid}/rank`}>Rank Episodes</NavLink>
    </div>
  );

  return (
    <PairwiseRankPage
      title={season ? `Rank ${show ? `${show.name} ` : ""}${season.name} Episodes` : "Rank Episodes"}
      scopeKey={`tv-episodes:${seid}`}
      noun="episode"
      nounPlural="episodes"
      items={items}
      isLoading={seasonLoading || isLoading || answers.isLoading}
      comparisons={answers.comparisons}
      onAnswer={answers.onAnswer}
      onDeleteAnswer={answers.onDeleteAnswer}
      onClearAnswers={answers.onClearAnswers}
      onApply={(ids) => reorder.mutateAsync(ids)}
      tabs={tabs}
    />
  );
}
