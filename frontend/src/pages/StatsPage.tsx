import { EntityStatsPage, type StatsConfig } from "../stats/EntityStatsPage";
import { count, decade, decadeCol, n2, n4, num, score, yearCol } from "../stats/common";

const natCols = [
  { key: "nationality", label: "Nationality" }, count("artist_count", "Artists"), num("avg_artist_rank", "Avg Artist Rank"),
  count("album_count", "Albums"), score("avg_album_score", "Avg Album Score"),
];
const genreCols = [
  { key: "genre_name", label: "Genre" }, count("artist_count", "Artists"), count("artist_count_direct", "Artists (direct)"),
  num("avg_artist_rank", "Avg Artist Rank"), count("album_count", "Albums"), count("album_count_direct", "Albums (direct)"),
  score("avg_album_score", "Avg Album Score"),
];
const periodCols = [
  count("artist_count", "Artists"), num("avg_artist_rank", "Avg Artist Rank"), count("album_count", "Albums"),
  score("avg_score", "Avg Album Score"),
];
const both = [{ key: "album_count", label: "Albums" }, { key: "artist_count", label: "Artists" }];

const MUSIC: StatsConfig = {
  slug: "stats",
  title: "Music stats",
  summary: [
    { title: "Totals", stats: [
      { label: "Artists", key: "total_artists", fmt: "int" },
      { label: "Albums", key: "total_albums", fmt: "int" },
      { label: "Avg albums / artist", key: "avg_albums_per_artist", fmt: "num" },
    ] },
    { title: "Unique album runtime", stats: [
      { label: "Hours", key: "unique_runtime_hours", fmt: "num" },
      { label: "Days", key: "unique_runtime_days", fmt: "num" },
      { label: "Avg hours / album", key: "avg_album_runtime_hours", fmt: "num" },
    ] },
    { title: "Listened (counting relistens)", stats: [
      { label: "Hours", key: "total_listened_hours", fmt: "num" },
      { label: "Days", key: "total_listened_days", fmt: "num" },
      { label: "Avg hours / album", key: "avg_listened_hours", fmt: "num" },
    ] },
    { title: "Best & worst years", stats: [
      { label: "Best year (artists)", key: "best_year_artists" }, { label: "Best year (albums)", key: "best_year_albums" },
      { label: "Worst year (artists)", key: "worst_year_artists" }, { label: "Worst year (albums)", key: "worst_year_albums" },
    ] },
    { title: "Best & worst decades", stats: [
      decade("best_decade_artists", "Best (artists)"), decade("best_decade_albums", "Best (albums)"),
      decade("worst_decade_artists", "Worst (artists)"), decade("worst_decade_albums", "Worst (albums)"),
    ] },
    { title: "Core nationality", stats: [
      { label: "Best (artists)", key: "best_core_nationality_artists" }, { label: "Best (albums)", key: "best_core_nationality_albums" },
      { label: "Worst (artists)", key: "worst_core_nationality_artists" }, { label: "Worst (albums)", key: "worst_core_nationality_albums" },
    ] },
    { title: "Birth / formed nationality", stats: [
      { label: "Best (artists)", key: "best_birth_nationality_artists" }, { label: "Best (albums)", key: "best_birth_nationality_albums" },
      { label: "Worst (artists)", key: "worst_birth_nationality_artists" }, { label: "Worst (albums)", key: "worst_birth_nationality_albums" },
    ] },
  ],
  tables: [
    { title: "By year", from: "by_year", keyCol: "year", cols: [yearCol, ...periodCols] },
    { title: "By decade", from: "by_decade", keyCol: "decade", cols: [decadeCol, ...periodCols] },
    { title: "By core nationality", from: "by_nationality.core_nationality", keyCol: "nationality", cols: natCols },
    { title: "By birth / formed nationality", from: "by_nationality.birth_nationality", keyCol: "nationality", cols: natCols },
    { title: "By root genre", from: "by_genre.by_root_genre", keyCol: "genre_name", cols: genreCols },
    { title: "By genre", from: "by_genre.by_genre", keyCol: "genre_name", cols: genreCols },
  ],
  bars: [
    { title: "Avg album score by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "score", series: [{ key: "avg_score", label: "Avg score" }] },
    { title: "Avg artist rank by decade (lower is better)", from: "by_decade", x: "decade", xFmt: "decade", reversed: true,
      series: [{ key: "avg_artist_rank", label: "Avg rank" }] },
    { title: "Counts by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "int", series: both },
    { title: "Avg album score by year", from: "by_year", x: "year", fmt: "score", series: [{ key: "avg_score", label: "Avg score" }] },
    { title: "Counts by year", from: "by_year", x: "year", fmt: "int", series: both },
    { title: "By root genre", from: "by_genre.by_root_genre", x: "genre_name", horizontal: true, fmt: "int", series: both },
    { title: "Avg album score by root genre", from: "by_genre.by_root_genre", x: "genre_name", horizontal: true, fmt: "score",
      series: [{ key: "avg_album_score", label: "Avg score" }] },
    { title: "By core nationality", from: "by_nationality.core_nationality", x: "nationality", horizontal: true, fmt: "int", series: both },
    { title: "By birth / formed nationality", from: "by_nationality.birth_nationality", x: "nationality", horizontal: true, fmt: "int", series: both },
  ],
  scatters: [
    { title: "Artist rank vs avg album runtime", from: "scatter.artist_rank_vs_runtime",
      x: { key: "rank", label: "Artist rank" }, y: { key: "avg_runtime_minutes", label: "Avg runtime (min)" },
      tip: (d) => [String(d.name ?? ""), `Rank #${d.rank}`, `Avg runtime: ${n2(d.avg_runtime_minutes)} min`] },
    { title: "Album score vs runtime", from: "scatter.album_score_vs_runtime",
      x: { key: "runtime_minutes", label: "Runtime (min)" }, y: { key: "score", label: "Score" },
      tip: (d) => [String(d.name ?? ""), `Score: ${n4(d.score)}`, `Runtime: ${n2(d.runtime_minutes)} min`] },
    { title: "Album rank (within artist) vs runtime", from: "scatter.album_rank_vs_runtime",
      x: { key: "album_rank", label: "Album rank" }, y: { key: "runtime_minutes", label: "Runtime (min)" },
      tip: (d) => [String(d.name ?? ""), String(d.artist_name ?? ""), `Rank #${d.album_rank}`, `Runtime: ${n2(d.runtime_minutes)} min`] },
  ],
};

export function StatsPage() {
  return <EntityStatsPage config={MUSIC} />;
}
