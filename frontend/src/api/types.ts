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
  parent_ids: number[];
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

export interface MovieGenre {
  id: number;
  name: string;
  synonyms: string[] | null;
  notes: string | null;
  parent_ids: number[];
}

export type CastRole = "director" | "composer" | "actor" | "lead_actor" | "cameo_actor";

export const CAST_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor", "cameo_actor"];

export const CAST_ROLE_LABELS: Record<CastRole, string> = {
  director: "Director",
  composer: "Composer",
  actor: "Actor",
  lead_actor: "Lead Actor",
  cameo_actor: "Cameo Actor",
};

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

export interface PersonDetail {
  id: number;
  name: string;
  name_en: string | null;
  birth_nationality: string;
  core_nationality: string;
  notes: string | null;
  artists: PersonArtistRef[];
  movie_roles: PersonMovieRoleRef[];
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
  has_movie_entries: boolean;
  artist_summary: string;
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