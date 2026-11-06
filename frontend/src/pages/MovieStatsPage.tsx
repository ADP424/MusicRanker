import { EntityStatsPage, type StatsConfig } from "../stats/EntityStatsPage";
import { count, decade, decadeCol, score, scoreScatter, yearCol } from "../stats/common";

const natCols = [{ key: "nationality", label: "Nationality" }, count("movie_count", "Movies"), score("avg_movie_score", "Avg Movie Score")];
const genreCols = [
  { key: "genre_name", label: "Genre" }, count("movie_count", "Movies"), count("movie_count_direct", "Movies (direct)"),
  score("avg_movie_score", "Avg Movie Score"),
];

const MOVIES: StatsConfig = {
  slug: "movie-stats",
  title: "Movie stats",
  summary: [
    { title: "Totals", stats: [
      { label: "Movies", key: "total_movies", fmt: "int" },
      { label: "Cast & crew", key: "total_cast_members", fmt: "int" },
      { label: "Avg movies / person", key: "avg_movies_per_cast_member", fmt: "num" },
    ] },
    { title: "Unique runtime", stats: [
      { label: "Hours", key: "unique_runtime_hours", fmt: "num" },
      { label: "Days", key: "unique_runtime_days", fmt: "num" },
      { label: "Avg hours / movie", key: "avg_movie_runtime_hours", fmt: "num" },
    ] },
    { title: "Watched (counting rewatches)", stats: [
      { label: "Hours", key: "total_watched_hours", fmt: "num" },
      { label: "Days", key: "total_watched_days", fmt: "num" },
      { label: "Avg hours / movie", key: "avg_watched_hours", fmt: "num" },
    ] },
    { title: "Best & worst years", stats: [
      { label: "Best year", key: "best_year_movies" }, { label: "Worst year", key: "worst_year_movies" },
      decade("best_decade_movies", "Best decade"), decade("worst_decade_movies", "Worst decade"),
    ] },
    { title: "Core nationality", stats: [
      { label: "Best (movies)", key: "best_core_nationality_movies" }, { label: "Best (cast)", key: "best_core_nationality_cast" },
      { label: "Worst (movies)", key: "worst_core_nationality_movies" }, { label: "Worst (cast)", key: "worst_core_nationality_cast" },
    ] },
    { title: "Birth nationality", stats: [
      { label: "Best (movies)", key: "best_birth_nationality_movies" }, { label: "Best (cast)", key: "best_birth_nationality_cast" },
      { label: "Worst (movies)", key: "worst_birth_nationality_movies" }, { label: "Worst (cast)", key: "worst_birth_nationality_cast" },
    ] },
  ],
  tables: [
    { title: "By year", from: "by_year", keyCol: "year", cols: [yearCol, count("movie_count", "Movies"), score("avg_score", "Avg Movie Score")] },
    { title: "By decade", from: "by_decade", keyCol: "decade", cols: [decadeCol, count("movie_count", "Movies"), score("avg_score", "Avg Movie Score")] },
    { title: "By director's core nationality", from: "by_nationality.core_nationality", keyCol: "nationality", cols: natCols },
    { title: "By director's birth nationality", from: "by_nationality.birth_nationality", keyCol: "nationality", cols: natCols },
    { title: "By root genre", from: "by_genre.by_root_genre", keyCol: "genre_name", cols: genreCols },
    { title: "By genre", from: "by_genre.by_genre", keyCol: "genre_name", cols: genreCols },
  ],
  bars: [
    { title: "Avg movie score by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "score", series: [{ key: "avg_score", label: "Avg score" }] },
    { title: "Movies by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "int", series: [{ key: "movie_count", label: "Movies" }] },
    { title: "Avg movie score by year", from: "by_year", x: "year", fmt: "score", series: [{ key: "avg_score", label: "Avg score" }] },
    { title: "Movies by root genre", from: "by_genre.by_root_genre", x: "genre_name", horizontal: true, fmt: "int", series: [{ key: "movie_count", label: "Movies" }] },
    { title: "Movies by director's nationality", from: "by_nationality.core_nationality", x: "nationality", horizontal: true, fmt: "int", series: [{ key: "movie_count", label: "Movies" }] },
  ],
  scatters: [
    scoreScatter("Movie score vs runtime", "scatter.movie_score_vs_runtime", { key: "runtime_minutes", label: "Runtime (min)", unit: " min" }),
    scoreScatter("Cast & crew: avg score vs avg runtime", "scatter.cast_member_score_vs_runtime",
      { key: "avg_runtime_minutes", label: "Avg runtime (min)", unit: " min" }, "avg_score"),
  ],
};

export function MovieStatsPage() {
  return <EntityStatsPage config={MOVIES} />;
}
