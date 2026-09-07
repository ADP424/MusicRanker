// ── Shared ───────────────────────────────────────────────────────────────────
export interface Link {
  id: number;
  label: string | null;
  url: string;
  position: number;
}

export interface NamedRef {
  id: number;
  name: string;
  name_en: string | null;
}

export type BandRole = "core_member" | "member";
export const BAND_ROLES: BandRole[] = ["core_member", "member"];
export const BAND_ROLE_LABELS: Record<BandRole, string> = { core_member: "Core Member", member: "Member" };

export type CastRole = "creator" | "director" | "composer" | "actor" | "lead_actor" | "cameo_actor";
export const CAST_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor", "cameo_actor"];
export const MOVIE_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor", "cameo_actor"];
export const TV_SHOW_ROLES: CastRole[] = ["creator", "composer", "lead_actor", "actor", "cameo_actor"];
export const TV_EPISODE_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor", "cameo_actor"];
export const CAST_ROLE_LABELS: Record<CastRole, string> = {
  creator: "Creator", director: "Director", composer: "Composer",
  actor: "Actor", lead_actor: "Lead Actor", cameo_actor: "Cameo",
};

export type GameRole = "director" | "writer" | "composer" | "developer" | "actor" | "lead_actor" | "cameo_actor";
export const GAME_ROLES: GameRole[] = ["director", "writer", "composer", "developer", "actor", "lead_actor", "cameo_actor"];
export const GAME_ROLE_LABELS: Record<GameRole, string> = {
  director: "Director", writer: "Writer", composer: "Composer", developer: "Developer",
  actor: "Actor", lead_actor: "Lead Actor", cameo_actor: "Cameo",
};

export interface Genre {
  id: number;
  name: string;
  name_en?: string | null;
  synonyms: string[] | null;
  notes: string | null;
  parent_ids: number[];
  category_ids: number[];
  is_music?: boolean;
  is_movie?: boolean;
  is_game?: boolean;
  is_television?: boolean;
}

export interface GenreCategory { id: number; name: string }

export interface GamePlatform {
  id: number;
  name: string;
  synonyms: string[] | null;
  notes: string | null;
  parent_ids: number[];
  category_ids: number[];
}

// ── People ───────────────────────────────────────────────────────────────────
export interface Person {
  id: number;
  name: string;
  name_en: string | null;
  birth_nationality: string;
  core_nationality: string;
  notes: string | null;
  artist_names: string[];
  movie_names: string[];
  game_names: string[];
  television_names: string[];
}

export interface PersonArtistRef {
  id: number;
  name: string;
  name_en: string | null;
  role: BandRole;
}

export interface PersonDetail extends Person {
  artists: { id: number; name: string; role: BandRole }[];
  movie_roles: { movie_id: number; movie_name: string; role: CastRole }[];
  game_roles: { game_id: number; game_name: string; role: GameRole }[];
  television_roles: { show_id: number; show_name: string; role: CastRole }[];
  television_episode_roles: {
    show_id: number; show_name: string; episode_id: number; episode_name: string; role: CastRole;
  }[];
}

// ── Artists / Albums ─────────────────────────────────────────────────────────
export interface PersonArtistRef {
  id: number;
  name: string;
  name_en: string | null;
  role: BandRole;
}

export interface AlbumRef {
  id: number;
  name: string;
  name_en: string | null;
  alias: string | null;
  genre_ids: number[];
}

export interface Artist {
  id: number;
  name: string;
  name_en: string | null;
  birth_nationality: string;
  core_nationality: string;
  primary_genre: number | null;
  notes: string | null;
  links: Link[];
  persons: PersonArtistRef[];
  albums: AlbumRef[];
  album_count: number;
  in_my_list: boolean;
}

export interface RankedArtist {
  position: number;
  rank: string;
  notes: string | null;
  artist: Artist;
}

export interface Album {
  id: number;
  name: string;
  name_en: string | null;
  runtime_seconds: number;
  release_year: number;
  alias: string | null;
  notes: string | null;
  artists: NamedRef[];
  genre_ids: number[];
  links: Link[];
  soundtrack_movies: NamedRef[];
  soundtrack_games: NamedRef[];
  soundtrack_television_shows: NamedRef[];
  in_my_list: boolean;
}

export interface RankedAlbum {
  position: number;
  rank: string;
  listens: number;
  notes: string | null;
  album: Album;
}

/** The caller's own personal-list row for one album, or null if not in their list. */
export interface AlbumEntry {
  listens: number;
  notes: string | null;
}

// ── Movies ───────────────────────────────────────────────────────────────────
export interface MoviePersonRef {
  id: number;
  name: string;
  name_en: string | null;
  role: CastRole;
}

export interface Movie {
  id: number;
  name: string;
  name_en: string | null;
  runtime_minutes: number;
  release_year: number;
  notes: string | null;
  persons: MoviePersonRef[];
  genre_ids: number[];
  links: Link[];
  soundtrack_albums: NamedRef[];
  in_my_list: boolean;
}

export interface RankedMovie {
  position: number;
  rank: string;
  watches: number;
  notes: string | null;
  movie: Movie;
}

/** The caller's own personal-list row for one movie, or null if not in their list. */
export interface MovieEntry {
  watches: number;
  notes: string | null;
}

// ── Games ────────────────────────────────────────────────────────────────────
export interface GamePersonRef {
  id: number;
  name: string;
  name_en: string | null;
  role: GameRole;
}

export interface Game {
  id: number;
  name: string;
  name_en: string | null;
  release_year: number;
  notes: string | null;
  persons: GamePersonRef[];
  genre_ids: number[];
  platform_ids: number[];
  links: Link[];
  soundtrack_albums: NamedRef[];
  in_my_list: boolean;
}

export interface RankedGame {
  position: number;
  rank: string;
  hours_played: string | null;
  notes: string | null;
  game: Game;
}

/** The caller's own personal-list row for one game, or null if not in their list. */
export interface GameEntry {
  hours_played: string | null;
  notes: string | null;
}

// ── Television ───────────────────────────────────────────────────────────────
export interface TelevisionPersonRef {
  id: number;
  name: string;
  name_en: string | null;
  role: CastRole;
}

export interface EpisodeRef {
  id: number;
  name: string;
  name_en: string | null;
}

export interface TelevisionShow {
  id: number;
  name: string;
  name_en: string | null;
  release_year: number;
  notes: string | null;
  persons: TelevisionPersonRef[];
  genre_ids: number[];
  links: Link[];
  soundtrack_albums: NamedRef[];
  episodes: EpisodeRef[];
  episode_count: number;
  in_my_list: boolean;
}

export interface RankedTelevisionShow {
  position: number;
  rank: string;
  notes: string | null;
  show: TelevisionShow;
}

/** The caller's own personal-list row for one show, or null if not in their list. */
export interface TelevisionShowEntry {
  notes: string | null;
}

export interface TelevisionEpisode {
  id: number;
  show_id: number;
  name: string;
  name_en: string | null;
  runtime_minutes: number;
  release_year: number;
  notes: string | null;
  episode_rank: string | null;
  persons: TelevisionPersonRef[];
  genre_ids: number[];
  links: Link[];
  in_my_list: boolean;
}

export interface RankedTelevisionEpisode {
  position: number;
  rank: string;
  watches: number;
  notes: string | null;
  episode: TelevisionEpisode;
}

/** The caller's own personal-list row for one episode, or null if not in their list. */
export interface TelevisionEpisodeEntry {
  watches: number;
  notes: string | null;
}

// ── Comparisons ──────────────────────────────────────────────────────────────
export interface Comparison {
  winner_id: number;
  loser_id: number;
  created_at?: string | null;
}

export interface ComparisonIn {
  winner_id: number;
  loser_id: number;
}

// ── Nationalities ────────────────────────────────────────────────────────────
export type Nationality = string;

// ── Stats (music) ────────────────────────────────────────────────────────────
export interface StatsSummary {
  total_artists: number;
  total_albums: number;
  avg_albums_per_artist: number;
  unique_runtime_hours: number;
  unique_runtime_days: number;
  avg_album_runtime_hours: number;
  total_listened_hours: number;
  total_listened_days: number;
  avg_listened_hours: number;
  best_year_artists: number | null;
  worst_year_artists: number | null;
  best_year_albums: number | null;
  worst_year_albums: number | null;
  best_decade_artists: number | null;
  worst_decade_artists: number | null;
  best_decade_albums: number | null;
  worst_decade_albums: number | null;
  best_core_nationality_artists: string | null;
  worst_core_nationality_artists: string | null;
  best_core_nationality_albums: string | null;
  worst_core_nationality_albums: string | null;
  best_birth_nationality_artists: string | null;
  worst_birth_nationality_artists: string | null;
  best_birth_nationality_albums: string | null;
  worst_birth_nationality_albums: string | null;
}

export interface YearRow {
  year: number;
  artist_count: number;
  avg_artist_rank: number | null;
  album_count: number;
  avg_score: number | null;
}

export interface DecadeRow {
  decade: number;
  artist_count: number;
  avg_artist_rank: number | null;
  album_count: number;
  avg_score: number | null;
}

export interface NatRow {
  nationality: string | null;
  artist_count: number;
  avg_artist_rank: number | null;
  album_count: number;
  avg_album_score: number | null;
}

export interface GenreRow {
  genre_id: number;
  genre_name: string;
  artist_count: number;
  artist_count_direct: number;
  avg_artist_rank: number | null;
  album_count: number;
  album_count_direct: number;
  avg_album_score: number | null;
}

export interface ScatterPoint {
  [key: string]: number | string | null | undefined;
}

// ── Stats (movies) ───────────────────────────────────────────────────────────
export interface MovieStatsSummary {
  total_cast_members: number;
  total_movies: number;
  avg_movies_per_cast_member: number;
  unique_runtime_hours: number;
  unique_runtime_days: number;
  avg_movie_runtime_hours: number;
  total_watched_hours: number;
  total_watched_days: number;
  avg_watched_hours: number;
  best_year_movies: number | null;
  worst_year_movies: number | null;
  best_decade_movies: number | null;
  worst_decade_movies: number | null;
  best_core_nationality_movies: string | null;
  worst_core_nationality_movies: string | null;
  best_birth_nationality_movies: string | null;
  worst_birth_nationality_movies: string | null;
  best_core_nationality_cast: string | null;
  worst_core_nationality_cast: string | null;
  best_birth_nationality_cast: string | null;
  worst_birth_nationality_cast: string | null;
}

export interface MovieYearRow { year: number; movie_count: number; avg_score: number | null }
export interface MovieDecadeRow { decade: number; movie_count: number; avg_score: number | null }
export interface MovieNatRow { nationality: string | null; movie_count: number; avg_movie_score: number | null }
export interface MovieGenreRow {
  genre_id: number; genre_name: string;
  movie_count: number; movie_count_direct: number; avg_movie_score: number | null;
}

// ── Stats (games) ────────────────────────────────────────────────────────────
export interface GameStatsSummary {
  total_games: number;
  total_people_credited: number;
  avg_games_per_person: number;
  games_with_hours_tracked: number;
  games_without_hours_tracked: number;
  total_hours_played: number;
  total_days_played: number;
  avg_hours_played: number;
  most_played_game: string | null;
  most_played_hours: number | null;
  best_year_games: number | null;
  worst_year_games: number | null;
  best_decade_games: number | null;
  worst_decade_games: number | null;
  best_platform: string | null;
  worst_platform: string | null;
  best_core_nationality_games: string | null;
  worst_core_nationality_games: string | null;
  best_birth_nationality_games: string | null;
  worst_birth_nationality_games: string | null;
  best_core_nationality_people: string | null;
  worst_core_nationality_people: string | null;
  best_birth_nationality_people: string | null;
  worst_birth_nationality_people: string | null;
}

export interface GameYearRow { year: number; game_count: number; avg_score: number | null }
export interface GameDecadeRow { decade: number; game_count: number; avg_score: number | null }
export interface GameNatRow { nationality: string | null; game_count: number; avg_game_score: number | null }
export interface GameGenreRow {
  genre_id: number; genre_name: string;
  game_count: number; game_count_direct: number; avg_game_score: number | null; total_hours: number | null;
}
export interface GamePlatformRow {
  platform_id: number; platform_name: string;
  game_count: number; game_count_direct: number; avg_game_score: number | null; total_hours: number | null;
}

// ── Stats (television) ──────────────────────────────────────────────────────
export interface TelevisionStatsSummary {
  total_cast_members: number;
  total_shows: number;
  total_episodes: number;
  avg_episodes_per_show: number;
  avg_shows_per_cast_member: number;
  avg_episodes_per_cast_member: number;
  unique_runtime_hours: number;
  unique_runtime_days: number;
  avg_episode_runtime_hours: number;
  avg_show_runtime_hours: number;
  total_watched_hours: number;
  total_watched_days: number;
  avg_watched_hours_per_show: number;
  avg_watched_hours_per_episode: number;
  most_episodes_show: string | null;
  most_episodes_count: number | null;
  best_year_shows: number | null;
  worst_year_shows: number | null;
  best_year_episodes: number | null;
  worst_year_episodes: number | null;
  best_decade_shows: number | null;
  worst_decade_shows: number | null;
  best_decade_episodes: number | null;
  worst_decade_episodes: number | null;
  best_core_nationality_shows: string | null;
  worst_core_nationality_shows: string | null;
  best_birth_nationality_shows: string | null;
  worst_birth_nationality_shows: string | null;
  best_core_nationality_cast: string | null;
  worst_core_nationality_cast: string | null;
  best_birth_nationality_cast: string | null;
  worst_birth_nationality_cast: string | null;
}

export interface TelevisionYearRow {
  year: number; show_count: number; avg_show_score: number | null;
  episode_count: number; avg_episode_score: number | null;
}
export interface TelevisionDecadeRow {
  decade: number; show_count: number; avg_show_score: number | null;
  episode_count: number; avg_episode_score: number | null;
}
export interface TelevisionNatRow {
  nationality: string; show_count: number; avg_show_score: number | null;
  episode_count: number; avg_episode_score: number | null;
}
export interface TelevisionGenreRow {
  genre_id: number; genre_name: string;
  show_count: number; show_count_direct: number; avg_show_score: number | null;
  episode_count: number; episode_count_direct: number; avg_episode_score: number | null;
}
export interface TelevisionShowRow {
  show_id: number; show_name: string; position: number; show_score: number; release_year: number;
  episode_count: number; total_watches: number; total_runtime_minutes: number;
  total_watched_minutes: number; avg_episode_runtime_minutes: number | null;
}

// ── TMDB import (movies) ─────────────────────────────────────────────────────
export interface TmdbLookupIn {
  title: string;
  year?: number | null;
}

export interface DbPersonMatch {
  person_id: number;
  person_name: string;
  has_screen_entries: boolean;
  /** True iff has_screen_entries and a credit's title overlaps this filmography.
   * False with has_screen_entries=true means a name-only match against a
   * differing filmography (e.g. a title mismatch between our catalog and TMDB). */
  filmography_overlap: boolean;
  artist_summary: string;
  game_summary: string;
}

export interface TmdbPerson {
  tmdb_id: number;
  name: string;
  credit_type: "cast" | "crew";
  character: string | null;
  billing_order: number | null;
  job: string | null;
  suggested_role: CastRole;
  suggestion_reason: string;
  top_credits: string[];
  nationality_guess: string;
  birth_place: string | null;
  db_matches: DbPersonMatch[];
}

export interface TmdbGenre {
  tmdb_id: number;
  tmdb_name: string;
  db_genre_id: number | null;
}

export interface TmdbLookup {
  tmdb_id: number;
  title: string;
  original_title: string | null;
  release_date: string | null;
  runtime: number;
  overview: string | null;
  people: TmdbPerson[];
  genres: TmdbGenre[];
  ambiguous: boolean;
}

export interface TmdbImportPersonIn {
  tmdb_id: number;
  name: string;
  role: CastRole;
  nationality: string;
  existing_person_id: number | null;
}

export interface TmdbImportIn {
  title: string;
  original_title?: string | null;
  runtime_minutes: number;
  release_year: number;
  people: TmdbImportPersonIn[];
  genre_ids: number[];
}

export interface TmdbImportPersonResult {
  person_id: number;
  name: string;
  nationality: string;
  created: boolean;
}

export interface TmdbImportOut {
  movie_id: number;
  created_people: TmdbImportPersonResult[];
  reused_people: TmdbImportPersonResult[];
}

// ── TMDB import (television) ─────────────────────────────────────────────────
export interface TmdbTvLookupIn {
  title: string;
  year?: number | null;
  include_episodes?: boolean;
  include_specials?: boolean;
  season_numbers?: number[] | null;
  crew_episode_threshold?: number;
}

export interface TmdbTvPerson {
  tmdb_id: number;
  name: string;
  credit_type: "cast" | "crew" | "guest";
  character: string | null;
  billing_order: number | null;
  job: string | null;
  episode_count: number | null;
  suggested_role: CastRole;
  suggestion_reason: string;
  top_credits: string[];
  nationality_guess: string;
  birth_place: string | null;
  db_matches: DbPersonMatch[];
}

export interface TmdbTvGenre {
  tmdb_id: number;
  tmdb_name: string;
  db_genre_id: number | null;
}

export interface TmdbTvEpisode {
  tmdb_id: number | null;
  season_number: number;
  episode_number: number;
  name: string;
  air_date: string | null;
  release_year: number;
  runtime: number;
  overview: string | null;
  people: TmdbTvPerson[];
}

export interface TmdbTvSeason {
  season_number: number;
  name: string;
  air_date: string | null;
  episode_count: number;
  episodes: TmdbTvEpisode[];
}

export interface TmdbTvLookup {
  tmdb_id: number;
  name: string;
  original_name: string | null;
  first_air_date: string | null;
  release_year: number;
  overview: string | null;
  episode_run_time: number;
  number_of_seasons: number;
  number_of_episodes: number;
  crew_episode_threshold: number;
  people: TmdbTvPerson[];
  genres: TmdbTvGenre[];
  seasons: TmdbTvSeason[];
  ambiguous: boolean;
}

export interface TmdbTvImportPersonIn {
  tmdb_id: number;
  name: string;
  role: CastRole;
  nationality: string;
  existing_person_id: number | null;
}

export interface TmdbTvImportEpisodeIn {
  name: string;
  name_en: string | null;
  runtime_minutes: number;
  release_year: number;
  notes: string | null;
  people: TmdbTvImportPersonIn[];
  inherit_show_people: boolean;
  genre_ids: number[] | null;
}

export interface TmdbTvImportIn {
  name: string;
  name_en?: string | null;
  release_year: number;
  notes?: string | null;
  people: TmdbTvImportPersonIn[];
  genre_ids: number[];
  episodes: TmdbTvImportEpisodeIn[];
}

export interface TmdbTvImportPersonResult {
  person_id: number;
  name: string;
  nationality: string;
  created: boolean;
}

export interface TmdbTvImportOut {
  show_id: number;
  episode_ids: number[];
  created_people: TmdbTvImportPersonResult[];
  reused_people: TmdbTvImportPersonResult[];
}

export interface TmdbTvEpisodeLookupIn {
  tmdb_show_id?: number | null;
  title?: string | null;
  year?: number | null;
  season_number?: number | null;
  episode_number?: number | null;
  episode_name?: string | null;
}

export interface TmdbTvEpisodeLookup {
  tmdb_show_id: number;
  show_name: string;
  show_ambiguous: boolean;
  episode: TmdbTvEpisode;
}

export interface TmdbTvEpisodeImportIn {
  show_id: number;
  episode_id?: number | null;
  update_episode_fields?: boolean;
  episode: TmdbTvImportEpisodeIn;
}

export interface TmdbTvEpisodeImportOut {
  show_id: number;
  episode_id: number;
  created: boolean;
  people_linked: number;
  created_people: TmdbTvImportPersonResult[];
  reused_people: TmdbTvImportPersonResult[];
}

// ── IGDB import (games) ───────────────────────────────────────────────────────
export interface IgdbLookupIn {
  title: string;
  year?: number | null;
}

export interface IgdbDbPersonMatch {
  person_id: number;
  person_name: string;
  has_game_entries: boolean;
  /** True iff has_game_entries and a credit's title overlaps this game.
   * False with has_game_entries=true means a name-only match against a
   * differing catalog of games. */
  filmography_overlap: boolean;
  artist_summary: string;
}

export interface IgdbPerson {
  igdb_id: number;
  name: string;
  source: "company" | "person";
  suggested_role: GameRole;
  suggestion_reason: string;
  top_credits: string[];
  nationality_guess: string;
  birth_place: string | null;
  db_matches: IgdbDbPersonMatch[];
}

export interface IgdbGenre {
  igdb_id: number;
  igdb_name: string;
  db_genre_id: number | null;
}

export interface IgdbPlatform {
  igdb_id: number;
  igdb_name: string;
  db_platform_id: number | null;
}

export interface IgdbLookup {
  igdb_id: number;
  title: string;
  release_date: string | null;
  summary: string | null;
  people: IgdbPerson[];
  genres: IgdbGenre[];
  platforms: IgdbPlatform[];
  ambiguous: boolean;
}

export interface IgdbImportPersonIn {
  igdb_id: number;
  source: string;
  name: string;
  role: GameRole;
  nationality: string;
  existing_person_id: number | null;
}

export interface IgdbImportIn {
  title: string;
  release_year: number;
  people: IgdbImportPersonIn[];
  genre_ids: number[];
  platform_ids: number[];
}

export interface IgdbImportPersonResult {
  person_id: number;
  name: string;
  nationality: string;
  created: boolean;
}

export interface IgdbImportOut {
  game_id: number;
  created_people: IgdbImportPersonResult[];
  reused_people: IgdbImportPersonResult[];
}

// ── Movie person scan ──────────────────────────────────────────────────────────
export type ScanSlot = "cast" | "director" | "composer";

export interface ScanStats {
  movies_total: number;
  movies_in_scope: number;
  movies_resolved: number;
  movies_unresolved: number;
  network_calls: number;
  cache_hits: number;
  revalidated: number;
}

export interface ScanJob {
  id: string;
  status: "pending" | "running" | "done" | "cancelled" | "error";
  phase: "queued" | "loading" | "fetching" | "matching" | "finished";
  processed: number;
  total: number;
  last_movie: string | null;
  error: string | null;
  candidate_count: number | null;
  stats: ScanStats | null;
}

export interface ScanCandidate {
  key: string;
  person_id: number;
  person_name: string;
  movie_id: number;
  movie_name: string;
  movie_year: number | null;
  credit_type: "cast" | "crew";
  slot: ScanSlot;
  character: string | null;
  billing_order: number | null;
  job: string | null;
  suggested_role: CastRole;
  suggestion_reason: string;
  match: "verified" | "name_only";
  overlap: number;
  tmdb_person_id: number;
  tmdb_popularity: number;
  suppressed: boolean;
}

export interface UnresolvedMovie {
  id: number;
  name: string;
  release_year: number | null;
}

export interface ScanResults {
  job_id: string;
  candidates: ScanCandidate[];
  unresolved_movies: UnresolvedMovie[];
}

export interface ScanLinkIn {
  movie_id: number;
  person_id: number;
  role: CastRole;
}

export interface ScanSlotIn {
  movie_id: number;
  person_id: number;
  slot: ScanSlot;
}

export interface ScanApplyIn {
  links: ScanLinkIn[];
  suppress: ScanSlotIn[];
  unsuppress: ScanSlotIn[];
}

export interface ScanApplyResult {
  created: number;
  skipped: number;
  invalid: ScanLinkIn[];
  suppressed: number;
  unsuppressed: number;
}

export interface Suppression {
  person_id: number;
  person_name: string | null;
  movie_id: number;
  movie_name: string | null;
  slot: ScanSlot;
}

export interface SuppressionList {
  count: number;
  items: Suppression[];
}

// ── People graph ─────────────────────────────────────────────────────────────
export interface GraphPerson {
  id: number;
  name: string;
  name_en: string | null;
  artist_ids: number[];
  movie_roles: CastRole[];
}

export interface GraphMovie {
  id: number;
  name: string;
}

export interface GraphArtist {
  id: number;
  name: string;
}

export interface GraphEdge {
  person_id: number;
  target_type: "movie" | "artist";
  target_id: number;
}

export interface PersonGraph {
  persons: GraphPerson[];
  movies: GraphMovie[];
  artists: GraphArtist[];
  edges: GraphEdge[];
}
