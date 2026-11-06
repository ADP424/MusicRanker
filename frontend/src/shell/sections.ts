import { BookOpen, Clapperboard, Gamepad2, Music, Tv, Users } from "lucide-react";

export interface Section {
  path: string;
  label: string;
  icon: typeof Music;
  pages: [to: string, label: string][];
}

/** Every vertical and its sub-pages; the sidebar shows the active section's pages. */
export const SECTIONS: Section[] = [
  { path: "music", label: "Music", icon: Music, pages: [["", "Artists"], ["rank", "Rank"], ["genres", "Genres"], ["stats", "Stats"]] },
  { path: "books", label: "Books", icon: BookOpen, pages: [["", "Books"], ["rank", "Rank"], ["genres", "Genres"], ["stats", "Stats"]] },
  {
    path: "movies", label: "Movies", icon: Clapperboard,
    pages: [["", "Movies"], ["rank", "Rank"], ["genres", "Genres"], ["stats", "Stats"], ["scan", "TMDB scan"]],
  },
  {
    path: "television", label: "Television", icon: Tv,
    pages: [["", "Shows"], ["rank", "Rank"], ["genres", "Genres"], ["stats", "Stats"], ["scan", "TMDB scan"]],
  },
  {
    path: "games", label: "Games", icon: Gamepad2,
    pages: [["", "Games"], ["rank", "Rank"], ["genres", "Genres"], ["platforms", "Platforms"], ["stats", "Stats"], ["scan", "IGDB scan"]],
  },
  { path: "people", label: "People", icon: Users, pages: [["", "People"], ["graph", "Graph"], ["nationalities", "Nationalities"]] },
];

