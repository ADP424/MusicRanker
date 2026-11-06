import { EntityStatsPage, type StatsConfig } from "../stats/EntityStatsPage";
import { count, decade, decadeCol, n2, num, score, scoreScatter, yearCol } from "../stats/common";

const natCols = [{ key: "nationality", label: "Nationality" }, count("game_count", "Games"), score("avg_game_score", "Avg Game Score")];
const taxonCols = (key: string, label: string) => [
  { key, label }, count("game_count", "Games"), count("game_count_direct", "Games (direct)"),
  score("avg_game_score", "Avg Game Score"), num("total_hours", "Hours Played"),
];

const GAMES: StatsConfig = {
  slug: "game-stats",
  title: "Game stats",
  summary: [
    { title: "Totals", stats: [
      { label: "Games", key: "total_games", fmt: "int" },
      { label: "People credited", key: "total_people_credited", fmt: "int" },
      { label: "Avg games / person", key: "avg_games_per_person", fmt: "num" },
    ] },
    { title: "Hours played", stats: [
      { label: "Hours", key: "total_hours_played", fmt: "num" },
      { label: "Days", key: "total_days_played", fmt: "num" },
      { label: "Avg hours / game", key: "avg_hours_played", fmt: "num" },
      { label: "Games with hours", key: "games_with_hours_tracked", fmt: "int" },
      { label: "Games without", key: "games_without_hours_tracked", fmt: "int" },
      { label: "Most played", get: (s) => (s.most_played_game ? `${s.most_played_game} (${n2(s.most_played_hours)}h)` : null) },
    ] },
    { title: "Best & worst years", stats: [
      { label: "Best year", key: "best_year_games" }, { label: "Worst year", key: "worst_year_games" },
      decade("best_decade_games", "Best decade"), decade("worst_decade_games", "Worst decade"),
    ] },
    { title: "Platforms", stats: [{ label: "Best", key: "best_platform" }, { label: "Worst", key: "worst_platform" }] },
    { title: "Core nationality", stats: [
      { label: "Best (games)", key: "best_core_nationality_games" }, { label: "Best (people)", key: "best_core_nationality_people" },
      { label: "Worst (games)", key: "worst_core_nationality_games" }, { label: "Worst (people)", key: "worst_core_nationality_people" },
    ] },
    { title: "Birth nationality", stats: [
      { label: "Best (games)", key: "best_birth_nationality_games" }, { label: "Best (people)", key: "best_birth_nationality_people" },
      { label: "Worst (games)", key: "worst_birth_nationality_games" }, { label: "Worst (people)", key: "worst_birth_nationality_people" },
    ] },
  ],
  tables: [
    { title: "By year", from: "by_year", keyCol: "year", cols: [yearCol, count("game_count", "Games"), score("avg_score", "Avg Game Score")] },
    { title: "By decade", from: "by_decade", keyCol: "decade", cols: [decadeCol, count("game_count", "Games"), score("avg_score", "Avg Game Score")] },
    { title: "By core nationality", from: "by_nationality.core_nationality", keyCol: "nationality", cols: natCols },
    { title: "By birth nationality", from: "by_nationality.birth_nationality", keyCol: "nationality", cols: natCols },
    { title: "By root platform", from: "by_platform.by_root_platform", keyCol: "platform_name", cols: taxonCols("platform_name", "Platform") },
    { title: "By platform", from: "by_platform.by_platform", keyCol: "platform_name", cols: taxonCols("platform_name", "Platform") },
    { title: "By root genre", from: "by_genre.by_root_genre", keyCol: "genre_name", cols: taxonCols("genre_name", "Genre") },
    { title: "By genre", from: "by_genre.by_genre", keyCol: "genre_name", cols: taxonCols("genre_name", "Genre") },
  ],
  bars: [
    { title: "Avg game score by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "score", series: [{ key: "avg_score", label: "Avg score" }] },
    { title: "Games by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "int", series: [{ key: "game_count", label: "Games" }] },
    { title: "Avg game score by year", from: "by_year", x: "year", fmt: "score", series: [{ key: "avg_score", label: "Avg score" }] },
    { title: "Games by root platform", from: "by_platform.by_root_platform", x: "platform_name", horizontal: true, fmt: "int", series: [{ key: "game_count", label: "Games" }] },
    { title: "Hours played by root platform", from: "by_platform.by_root_platform", x: "platform_name", horizontal: true, series: [{ key: "total_hours", label: "Hours" }] },
    { title: "Games by root genre", from: "by_genre.by_root_genre", x: "genre_name", horizontal: true, fmt: "int", series: [{ key: "game_count", label: "Games" }] },
    { title: "Hours played by root genre", from: "by_genre.by_root_genre", x: "genre_name", horizontal: true, series: [{ key: "total_hours", label: "Hours" }] },
    { title: "Games by core nationality", from: "by_nationality.core_nationality", x: "nationality", horizontal: true, fmt: "int", series: [{ key: "game_count", label: "Games" }] },
  ],
  scatters: [
    scoreScatter("Game score vs hours played", "scatter.game_score_vs_hours", { key: "hours_played", label: "Hours played" }),
    scoreScatter("Person avg score vs avg hours played", "scatter.person_score_vs_hours", { key: "avg_hours_played", label: "Avg hours" }, "avg_score"),
  ],
};

export function GameStatsPage() {
  return <EntityStatsPage config={GAMES} />;
}
