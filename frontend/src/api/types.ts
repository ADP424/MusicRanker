/** Slim artist shape returned by GET /albums/{id}/artists */
export interface ArtistRef {
  id: number;
  name: string;
  name_en: string | null;
}

export interface Genre {
  id: number;
  name: string;
  synonyms: string[] | null;
  notes: string | null;
  is_music: boolean;
  is_movie: boolean;
  is_game: boolean;
  is_television: boolean;
  parent_ids: number[];
  category_ids: number[];
}

/** An unordered tag assignable to root (parentless) genres/platforms. */
export interface GenreCategory {
  id: number;
  name: string;
}

export interface Artist {
  id: number;
  name: string;
  name_en: string | null;
  global_rank: string | null;      // NUMERIC → JSON string
  position: number | null;
  discography_link: string;
  birth_nationality: string;
  core_nationality: string;
  primary_genre: number | null;
  notes: string | null;
}

export interface AlbumArtistRef {
  id: number;
  name: string;
  name_en: string | null;
  discography_link: string;
}

export interface SoundtrackMovieRef {
  id: number;
  name: string;
  name_en: string | null;
}

export interface SoundtrackAlbumRef {
  id: number;
  name: string;
  name_en: string | null;
  artist_ids: number[];
}

export interface SoundtrackTelevisionShowRef {
  id: number;
  name: string;
  name_en: string | null;
}

export interface Album {
  id: number;
  name: string;
  name_en: string | null;
  runtime_seconds: number;
  release_year: number;
  alias: string | null;
  alias_link: string | null;
  listens: number;
  listen_link: string | null;
  notes: string | null;
  album_rank: string | null;
  position: number | null;
  artists: AlbumArtistRef[];
  genre_ids: number[];
  soundtrack_movies: SoundtrackMovieRef[];
  soundtrack_games: { id: number; name: string; name_en: string | null }[];
  soundtrack_television_shows: SoundtrackTelevisionShowRef[];
}

export type ArtistIn = Omit<Artist, "id" | "global_rank" | "position"> & {
  position?: number;
};

export type AlbumIn = Omit<Album, "id" | "album_rank" | "position">;

export interface GenreIn {
  name: string;
  synonyms?: string[] | null;
  notes?: string | null;
}

export interface ArtistBody {
  name: string;
  name_en: string | null;
  discography_link: string;
  birth_nationality: string;
  core_nationality: string;
  primary_genre: number | null;
  notes: string | null;
}

export interface NamedRef {
  id: number;
  name: string;
}

export interface ArtistDetail {
  album_count: number;
  total_runtime: string;
  total_runtime_seconds: number;
  total_listened_runtime: string;
  total_listened_seconds: number;
  avg_runtime: string;
  avg_runtime_seconds: number;
  genres: NamedRef[];
  members: NamedRef[];
  collaborators: NamedRef[];
  avg_album_score: number | null;
}

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
  album_count: number;
  avg_score: number | null;
  artist_count: number;
  avg_artist_rank: number | null;
}

export interface DecadeRow {
  decade: number;
  album_count: number;
  avg_score: number | null;
  artist_count: number;
  avg_artist_rank: number | null;
}

export interface NatRow {
  nationality: string;
  album_count: number;
  avg_album_score: number | null;
  artist_count: number;
  avg_artist_rank: number | null;
}

export interface GenreRow {
  genre_id: number;
  genre_name: string;
  album_count: number;
  album_count_direct: number;
  avg_album_score: number | null;
  artist_count: number;
  artist_count_direct: number;
  avg_artist_rank: number | null;
}

export interface ScatterPoint { [key: string]: number | string }

export interface AlbumIndex {
  id: number;
  name: string;
  name_en: string | null;
  artist_ids: number[];
  genre_ids: number[];
}

export interface AlbumBody {
  name: string;
  name_en: string | null;
  runtime_seconds: number;
  release_year: number;
  alias: string | null;
  alias_link: string | null;
  listens: number;
  listen_link: string | null;
  notes: string | null;
}

// ─── Movies ────────────────────────────────────────────────────────────────

export type CastRole = "creator" | "director" | "composer" | "actor" | "lead_actor" | "cameo_actor";

/** Movies: no `creator`. */
export const CAST_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor", "cameo_actor"];
/** TV shows: a show is authored — `creator` stands in for `director`. */
export const TV_SHOW_ROLES: CastRole[] = ["creator", "composer", "lead_actor", "actor", "cameo_actor"];
/** TV episodes: each episode keeps its own director. */
export const TV_EPISODE_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor", "cameo_actor"];

export const CAST_ROLE_LABELS: Record<CastRole, string> = {
  creator: "Creator",
  director: "Director",
  composer: "Composer",
  actor: "Actor",
  lead_actor: "Lead Actor",
  cameo_actor: "Cameo Actor",
};

/** Roles where holding two on one entry is noise, not signal. */
export const ACTING_ROLES: CastRole[] = ["lead_actor", "actor", "cameo_actor"];

/** An episode with any acting credit has been cast; it needs no cast import. */
export function hasActingCredit(persons: { role: CastRole }[]): boolean {
  return persons.some((p) => ACTING_ROLES.includes(p.role));
}

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
  watches: number;
  watch_link: string | null;
  notes: string | null;
  global_rank: string | null;
  position: number | null;
  persons: MoviePersonRef[];
  genre_ids: number[];
  soundtrack_albums: SoundtrackAlbumRef[];
}

export interface MovieIndex {
  id: number;
  name: string;
  name_en: string | null;
  person_ids: number[];
  genre_ids: number[];
}

export interface MovieBody {
  name: string;
  name_en: string | null;
  runtime_minutes: number;
  release_year: number;
  watches: number;
  watch_link: string | null;
  notes: string | null;
}

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

export interface MovieYearRow {
  year: number;
  movie_count: number;
  avg_score: number | null;
}

export interface MovieDecadeRow {
  decade: number;
  movie_count: number;
  avg_score: number | null;
}

export interface MovieNatRow {
  nationality: string;
  movie_count: number;
  avg_movie_score: number | null;
}

export interface MovieGenreRow {
  genre_id: number;
  genre_name: string;
  movie_count: number;
  movie_count_direct: number;
  avg_movie_score: number | null;
}

// ─── Television ────────────────────────────────────────────────────────────
// Shows and episodes reuse the movie CastRole enum/labels (CAST_ROLES, CAST_ROLE_LABELS).

export interface TelevisionPersonRef {
  id: number;
  name: string;
  name_en: string | null;
  role: CastRole;
}

export interface TelevisionEpisode {
  id: number;
  show_id: number;
  show_name: string;
  name: string;
  name_en: string | null;
  runtime_minutes: number;
  release_year: number;
  watches: number;
  watch_link: string | null;
  notes: string | null;
  episode_rank: string | null; // NUMERIC → JSON string
  position: number | null;     // 1-based rank *within the show*
  persons: TelevisionPersonRef[];
  genre_ids: number[];
  // no soundtrack_albums — soundtracks are show-level only
}

export interface TelevisionShow {
  id: number;
  name: string;
  name_en: string | null;
  release_year: number;
  watch_link: string | null;
  notes: string | null;
  global_rank: string | null;
  position: number | null;
  persons: TelevisionPersonRef[];
  genre_ids: number[];
  soundtrack_albums: SoundtrackAlbumRef[];
  episodes: TelevisionEpisode[];
  episode_count: number;
  total_runtime_minutes: number;
  total_watched_minutes: number;
  total_watches: number;
}

export interface TelevisionShowIndex {
  id: number;
  name: string;
  name_en: string | null;
  person_ids: number[];
  genre_ids: number[];
  episode_names: string[];
}

export interface TelevisionEpisodeIndex {
  id: number;
  show_id: number;
  show_name: string;
  name: string;
  name_en: string | null;
  person_ids: number[];
  genre_ids: number[];
}

export interface TelevisionShowBody {
  name: string;
  name_en: string | null;
  release_year: number;
  watch_link: string | null;
  notes: string | null;
}

export interface TelevisionEpisodeBody {
  name: string | null;         // null → inherit the show's name
  name_en: string | null;
  runtime_minutes: number;
  release_year: number | null; // null → inherit the show's year
  watches: number;
  watch_link: string | null;
  notes: string | null;
}

export interface TelevisionEpisodeCreate extends TelevisionEpisodeBody {
  position?: number | null;
  inherit_from_show?: boolean; // also copies people & genres
}

export type TelevisionEpisodePatch = Partial<TelevisionEpisodeBody>;

export interface TelevisionPropagateBody {
  persons: boolean;
  genres: boolean;
  overwrite: boolean;
}

export interface TelevisionPropagateResult {
  episodes_updated: number;
  person_links_added: number;
  genre_links_added: number;
}

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
  year: number;
  show_count: number;
  avg_show_score: number | null;
  episode_count: number;
  avg_episode_score: number | null;
}

export interface TelevisionDecadeRow {
  decade: number;
  show_count: number;
  avg_show_score: number | null;
  episode_count: number;
  avg_episode_score: number | null;
}

export interface TelevisionNatRow {
  nationality: string;
  show_count: number;
  avg_show_score: number | null;
  episode_count: number;
  avg_episode_score: number | null;
}

export interface TelevisionGenreRow {
  genre_id: number;
  genre_name: string;
  show_count: number;
  show_count_direct: number;
  avg_show_score: number | null;
  episode_count: number;
  episode_count_direct: number;
  avg_episode_score: number | null;
}

export interface TelevisionShowRow {
  show_id: number;
  show_name: string;
  position: number;
  show_score: number;
  release_year: number;
  episode_count: number;
  total_watches: number;
  total_runtime_minutes: number;
  total_watched_minutes: number;
  avg_episode_runtime_minutes: number | null;
}

// ─── Games ─────────────────────────────────────────────────────────────────

/** Hierarchical platform taxonomy, e.g. PlayStation -> PlayStation 4. */
export interface GamePlatform {
  id: number;
  name: string;
  synonyms: string[] | null;
  notes: string | null;
  parent_ids: number[];
  category_ids: number[];
}

export type GameRole =
  | "director"
  | "developer"
  | "composer"
  | "writer"
  | "lead_actor"
  | "actor"
  | "cameo_actor";

export const GAME_ROLES: GameRole[] = [
  "director", "developer", "composer", "writer",
  "lead_actor", "actor", "cameo_actor",
];

export const GAME_ROLE_LABELS: Record<GameRole, string> = {
  director: "Director",
  developer: "Developer",
  composer: "Composer",
  writer: "Writer",
  lead_actor: "Lead Actor",
  actor: "Actor",
  cameo_actor: "Cameo Actor",
};

export interface GamePersonRef {
  id: number;
  name: string;
  name_en: string | null;
  role: GameRole;
}

export interface GameSoundtrackAlbumRef {
  id: number;
  name: string;
  name_en: string | null;
}

export interface Game {
  id: number;
  name: string;
  name_en: string | null;
  release_year: number;
  hours_played: string | null; // NUMERIC(7,1) → JSON string
  play_link: string | null;
  notes: string | null;
  global_rank: string | null;
  position: number | null;
  persons: GamePersonRef[];
  genre_ids: number[];
  platform_ids: number[];
  soundtrack_albums: GameSoundtrackAlbumRef[];
}

export interface GameIndex {
  id: number;
  name: string;
  name_en: string | null;
  person_ids: number[];
  genre_ids: number[];
  platform_ids: number[];
}

export interface GameBody {
  name: string;
  name_en: string | null;
  release_year: number;
  hours_played: number | null; // sent as a JSON number, returned as string
  play_link: string | null;
  notes: string | null;
}

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

export interface GameYearRow {
  year: number;
  game_count: number;
  avg_score: number | null;
}

export interface GameDecadeRow {
  decade: number;
  game_count: number;
  avg_score: number | null;
}

export interface GameNatRow {
  nationality: string;
  game_count: number;
  avg_game_score: number | null;
}

export interface GameGenreRow {
  genre_id: number;
  genre_name: string;
  game_count: number;
  game_count_direct: number;
  avg_game_score: number | null;
  total_hours: number | null;
}

export interface GamePlatformRow {
  platform_id: number;
  platform_name: string;
  game_count: number;
  game_count_direct: number;
  avg_game_score: number | null;
  total_hours: number | null;
}

// ─── People ────────────────────────────────────────────────────────────────

export type BandRole = "core_member" | "member";

export const BAND_ROLES: BandRole[] = ["core_member", "member"];

export const BAND_ROLE_LABELS: Record<BandRole, string> = {
  core_member: "Core Member",
  member: "Member",
};

export interface Person {
  id: number;
  name: string;
  name_en: string | null;
  birth_nationality: string;
  core_nationality: string;
  notes: string | null;
  artist_ids: number[];
  artist_names: string[];
  movie_names: string[];
  game_names: string[];
  television_names: string[];
}

export interface PersonArtistRef {
  id: number;
  name: string;
  name_en: string | null;
  discography_link: string;
  role: BandRole;
}

export interface PersonMovieRoleRef {
  movie_id: number;
  movie_name: string;
  role: CastRole;
}

export interface PersonGameRoleRef {
  game_id: number;
  game_name: string;
  role: GameRole;
}

export interface PersonTelevisionRoleRef {
  show_id: number;
  show_name: string;
  role: CastRole;
}

export interface PersonTelevisionEpisodeRoleRef {
  episode_id: number;
  episode_name: string;
  show_id: number;
  show_name: string;
  role: CastRole;
}

export interface PersonDetail {
  id: number;
  name: string;
  name_en: string | null;
  birth_nationality: string;
  core_nationality: string;
  notes: string | null;
  artists: PersonArtistRef[];
  movie_roles: PersonMovieRoleRef[];
  game_roles: PersonGameRoleRef[];
  television_roles: PersonTelevisionRoleRef[];
  television_episode_roles: PersonTelevisionEpisodeRoleRef[];
}

export interface PersonBody {
  name: string;
  name_en: string | null;
  birth_nationality: string;
  core_nationality: string;
  notes: string | null;
}

export interface GraphPerson {
  id: number;
  name: string;
  name_en: string | null;
  artist_ids: number[];
  artist_roles: BandRole[];
  movie_roles: CastRole[];
}

export interface GraphMovieNode {
  id: number;
  name: string;
}

export interface GraphArtistNode {
  id: number;
  name: string;
}

export interface GraphEdge {
  person_id: number;
  target_id: number;
  target_type: "movie" | "artist";
}

export interface PersonGraph {
  persons: GraphPerson[];
  movies: GraphMovieNode[];
  artists: GraphArtistNode[];
  edges: GraphEdge[];
}

// ── TMDB movie/person link scan ──────────────────────────────────
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

export interface UnresolvedMovie { id: number; name: string; release_year: number | null }

export interface ScanResults {
  job_id: string;
  candidates: ScanCandidate[];
  unresolved_movies: UnresolvedMovie[];
}

export interface ScanLink { movie_id: number; person_id: number; role: CastRole }
export interface ScanSlotRef { movie_id: number; person_id: number; slot: ScanSlot }

export interface ScanApply {
  links: ScanLink[];
  suppress: ScanSlotRef[];
  unsuppress: ScanSlotRef[];
}

export interface ScanApplyResult {
  created: number;
  skipped: number;
  invalid: ScanLink[];
  suppressed: number;
  unsuppressed: number;
}

export interface Suppression {
  person_id: number; person_name: string | null;
  movie_id: number; movie_name: string | null;
  slot: ScanSlot;
}
export interface SuppressionList { count: number; items: Suppression[] }

// ── TMDB import ───────────────────────────────────────────────────

export interface DbPersonMatch {
  person_id: number;
  person_name: string;
  /** Has movie *or* TV credits — i.e. something the filmography can confirm. */
  has_screen_entries: boolean;
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
  original_title: string | null;
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

export interface TmdbImportResult {
  movie_id: number;
  created_people: TmdbImportPersonResult[];
  reused_people: TmdbImportPersonResult[];
}

// ── TMDB television import ───────────────────────────────────────

export interface TmdbTvDbPersonMatch {
  person_id: number;
  person_name: string;
  has_screen_entries: boolean;
  artist_summary: string;
  game_summary: string;
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
  db_matches: TmdbTvDbPersonMatch[];
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
  /** At the show step, only the episode's automatic director/composer. */
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

export interface TmdbTvLookupIn {
  title: string;
  year?: number;
  include_episodes?: boolean;
  include_specials?: boolean;
  season_numbers?: number[];
  crew_episode_threshold?: number;
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
  watches: number;
  watch_link: string | null;
  notes: string | null;
  people: TmdbTvImportPersonIn[];
  inherit_show_people: boolean;
  genre_ids: number[] | null;
}

export interface TmdbTvImportIn {
  name: string;
  name_en: string | null;
  release_year: number;
  watch_link: string | null;
  notes: string | null;
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

export interface TmdbTvImportResult {
  show_id: number;
  episode_ids: number[];
  created_people: TmdbTvImportPersonResult[];
  reused_people: TmdbTvImportPersonResult[];
}

// ── Single-episode lookup/import (adding/re-casting an episode) ───
export interface TmdbTvEpisodeLookupBody {
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
  /** Set to merge into an existing episode; omit to append a new one. */
  episode_id?: number | null;
  update_episode_fields?: boolean;
  episode: TmdbTvImportEpisodeIn;
}

export interface TmdbTvEpisodeImportResult {
  show_id: number;
  episode_id: number;
  created: boolean;
  people_linked: number;
  created_people: TmdbTvImportPersonResult[];
  reused_people: TmdbTvImportPersonResult[];
}

// ── IGDB import ───────────────────────────────────────────────────

export interface IgdbDbPersonMatch {
  person_id: number;
  person_name: string;
  has_game_entries: boolean;
  artist_summary: string;
}

export interface IgdbPerson {
  igdb_id: number;
  name: string;
  source: string;
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

export interface IgdbImportResult {
  game_id: number;
  created_people: IgdbImportPersonResult[];
  reused_people: IgdbImportPersonResult[];
}

// ─── Pairwise preferences ──────────────────────────────────────────────────
export interface ComparisonIn {
  winner_id: number;
  loser_id: number;
}

export interface Comparison extends ComparisonIn {
  created_at?: string | null;
}