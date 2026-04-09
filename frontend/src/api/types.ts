/** Slim artist shape returned by GET /albums/{id}/artists */
export interface ArtistRef {
  id: number;
  name: string;
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
  discography_link: string;
}

export interface SoundtrackMovieRef {
  id: number;
  name: string;
}

export interface SoundtrackAlbumRef {
  id: number;
  name: string;
  artist_ids: number[];
}

export interface Album {
  id: number;
  name: string;
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
  artist_ids: number[];
  genre_ids: number[];
}

export interface AlbumBody {
  name: string;
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

export type CastRole = "director" | "composer" | "actor" | "lead_actor";

export const CAST_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor"];

export const CAST_ROLE_LABELS: Record<CastRole, string> = {
  director: "Director",
  composer: "Composer",
  actor: "Actor",
  lead_actor: "Lead Actor",
};

export interface MoviePersonRef {
  id: number;
  name: string;
  role: CastRole;
}

export interface Movie {
  id: number;
  name: string;
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
  person_ids: number[];
  genre_ids: number[];
}

export interface MovieBody {
  name: string;
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

export interface Person {
  id: number;
  name: string;
  birth_nationality: string;
  core_nationality: string;
  notes: string | null;
  artist_ids: number[];
}

export interface PersonArtistRef {
  id: number;
  name: string;
  discography_link: string;
}

export interface PersonMovieRoleRef {
  movie_id: number;
  movie_name: string;
  role: CastRole;
}

export interface PersonDetail {
  id: number;
  name: string;
  birth_nationality: string;
  core_nationality: string;
  notes: string | null;
  artists: PersonArtistRef[];
  movie_roles: PersonMovieRoleRef[];
}

export interface PersonBody {
  name: string;
  birth_nationality: string;
  core_nationality: string;
  notes: string | null;
}

export interface PersonGraphEdge {
  person_a: number;
  person_b: number;
  via_movie_ids: number[];
  via_artist_ids: number[];
}

export interface GraphPerson {
  id: number;
  name: string;
  artist_ids: number[];
  movie_roles: CastRole[];
}

export interface PersonGraph {
  persons: GraphPerson[];
  edges: PersonGraphEdge[];
  movies: Record<number, string>;
  artists: Record<number, string>;
}