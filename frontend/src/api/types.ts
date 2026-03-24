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

export interface Album {
  id: number;
  name: string;
  runtime_seconds: number;
  release_year: number;
  alias: string | null;
  listens: number;
  listen_link: string | null;
  notes: string | null;
  album_rank: string | null;
  position: number | null;
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

export interface ArtistDetail {
  album_count: number;
  total_runtime: string;
  total_runtime_seconds: number;
  total_listened_runtime: string;
  total_listened_seconds: number;
  avg_runtime: string;
  avg_runtime_seconds: number;
  genres: string[];
  collaborators: string[];
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
  avg_album_score: number | null;
  artist_count: number;
  avg_artist_rank: number | null;
}

export interface ScatterPoint { [key: string]: number | string }

export interface AlbumBody {
  name: string;
  runtime_seconds: number;
  release_year: number;
  alias: string | null;
  listens: number;
  listen_link: string | null;
  notes: string | null;
}