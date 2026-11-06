import { EntityStatsPage, type StatsConfig } from "../stats/EntityStatsPage";
import { count, decade, decadeCol, num, score, scoreScatter, yearCol } from "../stats/common";

const natCols = [
  { key: "nationality", label: "Nationality" }, count("show_count", "Shows"), score("avg_show_score", "Avg Show Score"),
  count("episode_count", "Episodes"), score("avg_episode_score", "Avg Episode Score"),
];
const genreCols = [
  { key: "genre_name", label: "Genre" }, count("show_count", "Shows"), count("show_count_direct", "Shows (direct)"),
  score("avg_show_score", "Avg Show Score"), count("episode_count", "Episodes"), count("episode_count_direct", "Episodes (direct)"),
  score("avg_episode_score", "Avg Episode Score"),
];
const periodCols = [
  count("show_count", "Shows"), score("avg_show_score", "Avg Show Score"), count("episode_count", "Episodes"),
  score("avg_episode_score", "Avg Episode Score"),
];

const TELEVISION: StatsConfig = {
  slug: "television-stats",
  title: "Television stats",
  summary: [
    { title: "Totals", stats: [
      { label: "Shows", key: "total_shows", fmt: "int" },
      { label: "Episodes", key: "total_episodes", fmt: "int" },
      { label: "Cast & crew", key: "total_cast_members", fmt: "int" },
      { label: "Avg episodes / show", key: "avg_episodes_per_show", fmt: "num" },
      { label: "Avg shows / person", key: "avg_shows_per_cast_member", fmt: "num" },
      { label: "Avg episodes / person", key: "avg_episodes_per_cast_member", fmt: "num" },
    ] },
    { title: "Longest-running show", when: (s) => !!s.most_episodes_show, stats: [
      { label: "Show", key: "most_episodes_show" }, { label: "Episodes", key: "most_episodes_count", fmt: "int" },
    ] },
    { title: "Unique runtime", stats: [
      { label: "Hours", key: "unique_runtime_hours", fmt: "num" },
      { label: "Days", key: "unique_runtime_days", fmt: "num" },
      { label: "Avg hours / episode", key: "avg_episode_runtime_hours", fmt: "num" },
      { label: "Avg hours / show", key: "avg_show_runtime_hours", fmt: "num" },
    ] },
    { title: "Watched (counting rewatches)", stats: [
      { label: "Hours", key: "total_watched_hours", fmt: "num" },
      { label: "Days", key: "total_watched_days", fmt: "num" },
      { label: "Avg hours / show", key: "avg_watched_hours_per_show", fmt: "num" },
      { label: "Avg hours / episode", key: "avg_watched_hours_per_episode", fmt: "num" },
    ] },
    { title: "Best & worst years", stats: [
      { label: "Best year (shows)", key: "best_year_shows" }, { label: "Worst year (shows)", key: "worst_year_shows" },
      { label: "Best year (episodes)", key: "best_year_episodes" }, { label: "Worst year (episodes)", key: "worst_year_episodes" },
    ] },
    { title: "Best & worst decades", stats: [
      decade("best_decade_shows", "Best (shows)"), decade("worst_decade_shows", "Worst (shows)"),
      decade("best_decade_episodes", "Best (episodes)"), decade("worst_decade_episodes", "Worst (episodes)"),
    ] },
    { title: "Core nationality", stats: [
      { label: "Best (shows)", key: "best_core_nationality_shows" }, { label: "Best (cast)", key: "best_core_nationality_cast" },
      { label: "Worst (shows)", key: "worst_core_nationality_shows" }, { label: "Worst (cast)", key: "worst_core_nationality_cast" },
    ] },
    { title: "Birth nationality", stats: [
      { label: "Best (shows)", key: "best_birth_nationality_shows" }, { label: "Best (cast)", key: "best_birth_nationality_cast" },
      { label: "Worst (shows)", key: "worst_birth_nationality_shows" }, { label: "Worst (cast)", key: "worst_birth_nationality_cast" },
    ] },
  ],
  tables: [
    { title: "By year", from: "by_year", keyCol: "year", cols: [yearCol, ...periodCols] },
    { title: "By decade", from: "by_decade", keyCol: "decade", cols: [decadeCol, ...periodCols] },
    { title: "By core nationality", from: "by_nationality.core_nationality", keyCol: "nationality", cols: natCols },
    { title: "By birth nationality", from: "by_nationality.birth_nationality", keyCol: "nationality", cols: natCols },
    { title: "By root genre", from: "by_genre.by_root_genre", keyCol: "genre_name", cols: genreCols },
    { title: "By genre", from: "by_genre.by_genre", keyCol: "genre_name", cols: genreCols },
  ],
  extraTabs: [{ name: "Shows", tables: [{
    title: "By show", from: "by_show", keyCol: "show_name", cols: [
      { key: "position", label: "#", numeric: true }, { key: "show_name", label: "Show" },
      { key: "release_year", label: "Year", numeric: true }, count("episode_count", "Episodes"),
      count("total_watches", "Watches"), count("total_runtime_minutes", "Runtime (min)"),
      count("total_watched_minutes", "Watched (min)"), num("avg_episode_runtime_minutes", "Avg episode (min)"),
      score("show_score", "Score"),
    ],
  }] }],
  bars: [
    { title: "Avg score by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "score",
      series: [{ key: "avg_show_score", label: "Shows" }, { key: "avg_episode_score", label: "Episodes" }] },
    { title: "Episodes by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "int", series: [{ key: "episode_count", label: "Episodes" }] },
    { title: "Shows by root genre", from: "by_genre.by_root_genre", x: "genre_name", horizontal: true, fmt: "int", series: [{ key: "show_count", label: "Shows" }] },
    { title: "Shows by core nationality", from: "by_nationality.core_nationality", x: "nationality", horizontal: true, fmt: "int", series: [{ key: "show_count", label: "Shows" }] },
  ],
  scatters: [
    scoreScatter("Show score vs total runtime", "scatter.show_score_vs_runtime", { key: "runtime_minutes", label: "Runtime (min)", unit: " min" }),
    scoreScatter("Episode score vs runtime", "scatter.episode_score_vs_runtime", { key: "runtime_minutes", label: "Runtime (min)", unit: " min" },
      "score", (d) => String(d.show_name ?? "")),
    scoreScatter("Cast & crew: avg score vs avg episode runtime", "scatter.cast_member_score_vs_runtime",
      { key: "avg_runtime_minutes", label: "Avg runtime (min)", unit: " min" }, "avg_score"),
  ],
};

export function TelevisionStatsPage() {
  return <EntityStatsPage config={TELEVISION} />;
}
