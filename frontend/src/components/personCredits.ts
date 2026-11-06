import { BAND_ROLE_LABELS, BOOK_ROLE_LABELS, CAST_ROLE_LABELS, GAME_ROLE_LABELS, type PersonDetail } from "../api/types";

export type CreditKind = "artist" | "book" | "movie" | "game" | "show" | "season" | "episode";

export interface Credit {
  key: string;
  kind: CreditKind;
  id: number;
  role: string;
  title: string;
  /** Path under /g/:guildId/ */
  to: string;
  kindLabel: string;
  roleLabel: string;
}

/** Every credit on a person's detail, flattened: the person page lists them, the
 *  split dialog picks from them. */
export function personCredits(p: PersonDetail): Credit[] {
  const c = (kind: CreditKind, id: number, role: string, title: string, to: string, kindLabel: string, roleLabel: string): Credit =>
    ({ key: `${kind}:${id}:${role}`, kind, id, role, title, to, kindLabel, roleLabel });
  return [
    ...p.artists.map((a) => c("artist", a.id, a.role, a.name, `music/artists/${a.id}`, "Artist", BAND_ROLE_LABELS[a.role] ?? a.role)),
    ...(p.book_roles ?? []).map((r) => c("book", r.book_id, r.role, r.book_name, `books/${r.book_id}`, "Book", BOOK_ROLE_LABELS[r.role] ?? r.role)),
    ...p.movie_roles.map((r) => c("movie", r.movie_id, r.role, r.movie_name, `movies/${r.movie_id}`, "Movie", CAST_ROLE_LABELS[r.role] ?? r.role)),
    ...p.game_roles.map((r) => c("game", r.game_id, r.role, r.game_name, `games/${r.game_id}`, "Game", GAME_ROLE_LABELS[r.role] ?? r.role)),
    ...p.television_roles.map((r) => c("show", r.show_id, r.role, r.show_name, `television/shows/${r.show_id}`, "Show", CAST_ROLE_LABELS[r.role] ?? r.role)),
    ...p.television_season_roles.map((r) => c("season", r.season_id, r.role, `${r.show_name}: ${r.season_name}`,
      `television/seasons/${r.season_id}`, "Season", CAST_ROLE_LABELS[r.role] ?? r.role)),
    ...p.television_episode_roles.map((r) => c("episode", r.episode_id, r.role, `${r.show_name}: ${r.episode_name}`,
      `television/episodes/${r.episode_id}`, "Episode", CAST_ROLE_LABELS[r.role] ?? r.role)),
  ];
}
