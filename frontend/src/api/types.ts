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

export type BookRole = "author" | "contributor";
export const BOOK_ROLES: BookRole[] = ["author", "contributor"];
export const BOOK_ROLE_LABELS: Record<BookRole, string> = { author: "Author", contributor: "Contributor" };

export type CastRole = "creator" | "director" | "composer" | "actor" | "lead_actor" | "cameo_actor";
export const CAST_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor", "cameo_actor"];
export const MOVIE_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor", "cameo_actor"];
export const TV_SHOW_ROLES: CastRole[] = ["creator", "composer", "lead_actor", "actor", "cameo_actor"];
export const TV_SEASON_ROLES: CastRole[] = ["director", "composer", "lead_actor", "actor", "cameo_actor"];
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
  is_book?: boolean;
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
  tmdb_id: number | null;
  igdb_id: number | null;
  image_url: string | null;
  artist_names: string[];
  book_names: string[];
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
  book_roles: { book_id: number; book_name: string; role: BookRole }[];
  movie_roles: { movie_id: number; movie_name: string; role: CastRole }[];
  game_roles: { game_id: number; game_name: string; role: GameRole }[];
  television_roles: { show_id: number; show_name: string; role: CastRole }[];
  television_season_roles: {
    show_id: number; show_name: string; season_id: number; season_name: string; role: CastRole;
  }[];
  television_episode_roles: {
    show_id: number; show_name: string; episode_id: number; episode_name: string; role: CastRole;
  }[];
}

export interface PersonTmdbCredit {
  media: "movie" | "tv";
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_url: string | null;
  popularity: number;
  roles: { label: string; role: CastRole | null }[];
  local_id: number | null; // the catalog movie / show, if there is one
  linked_roles: CastRole[]; // TV: on the show or anything below it
}

export interface PersonTmdb {
  tmdb_id: number | null;
  profile_url: string | null;
  candidates: { tmdb_id: number; name: string; department: string | null; known_for: string[]; profile_url: string | null }[];
  credits: PersonTmdbCredit[];
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

// ── Books ────────────────────────────────────────────────────────────────────
export interface BookPersonRef {
  id: number;
  name: string;
  name_en: string | null;
  role: BookRole;
}

export type AdaptationKind = "movie" | "game" | "television_show";
export type SoundtrackKind = "movie" | "game" | "television_show";

export interface Book {
  id: number;
  name: string;
  name_en: string | null;
  word_count: number | null;
  release_year: number;
  alias: string | null;
  notes: string | null;
  persons: BookPersonRef[];
  genre_ids: number[];
  links: Link[];
  adaptation_movies: NamedRef[];
  adaptation_games: NamedRef[];
  adaptation_television_shows: NamedRef[];
  in_my_list: boolean;
}

export interface RankedBook {
  position: number;
  rank: string;
  reads: number;
  notes: string | null;
  book: Book;
}

/** The caller's own personal-list row for one book, or null if not in their list. */
export interface BookEntry {
  reads: number;
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
  tmdb_id: number | null;
  overview: string | null;
  image_url: string | null; // poster / cover, hotlinked from TMDB / IGDB
  persons: MoviePersonRef[];
  genre_ids: number[];
  links: Link[];
  soundtrack_albums: NamedRef[];
  source_books: NamedRef[];
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
  igdb_id: number | null;
  overview: string | null;
  image_url: string | null; // poster / cover, hotlinked from TMDB / IGDB
  persons: GamePersonRef[];
  genre_ids: number[];
  platform_ids: number[];
  links: Link[];
  soundtrack_albums: NamedRef[];
  source_books: NamedRef[];
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

export interface SeasonRef {
  id: number;
  name: string;
  name_en: string | null;
  season_number: number | null;
}

export interface TelevisionShow {
  id: number;
  name: string;
  name_en: string | null;
  release_year: number;
  notes: string | null;
  tmdb_id: number | null;
  overview: string | null;
  image_url: string | null; // poster / cover, hotlinked from TMDB / IGDB
  persons: TelevisionPersonRef[];
  genre_ids: number[];
  links: Link[];
  soundtrack_albums: NamedRef[];
  source_books: NamedRef[];
  seasons: SeasonRef[];
  season_count: number;
  episodes: EpisodeRef[]; // every episode, all seasons
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

export interface TelevisionSeason {
  id: number;
  show_id: number;
  name: string;
  name_en: string | null;
  season_number: number | null;
  release_year: number;
  notes: string | null;
  overview: string | null;
  image_url: string | null; // poster / cover, hotlinked from TMDB / IGDB
  season_rank: string | null;
  persons: TelevisionPersonRef[];
  links: Link[];
  episodes: EpisodeRef[];
  episode_count: number;
  runtime_minutes: number;
  in_my_list: boolean;
}

export interface RankedTelevisionSeason {
  position: number;
  rank: string;
  notes: string | null;
  season: TelevisionSeason;
}

/** The caller's own personal-list row for one season, or null if not in their list. */
export interface TelevisionSeasonEntry {
  notes: string | null;
}

export interface TelevisionEpisode {
  id: number;
  show_id: number;
  season_id: number;
  name: string;
  name_en: string | null;
  runtime_minutes: number;
  release_year: number;
  notes: string | null;
  episode_number: number | null;
  overview: string | null;
  image_url: string | null; // poster / cover, hotlinked from TMDB / IGDB
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

/** Always available, never in a guild's list, and what an empty nationality is. */
export const UNKNOWN_NATIONALITY = "Unknown";

/** One entry of a guild's own nationality list. */
export interface NationalityEntry {
  id: number;
  name: string;
  people_count: number;
  artist_count: number;
}

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

// ── Stats (books) ────────────────────────────────────────────────────────────
export interface BookStatsSummary {
  total_books: number;
  total_authors: number;
  avg_books_per_author: number;
  books_with_word_count: number;
  unique_words: number;
  avg_book_words: number;
  total_words_read: number;
  avg_words_read: number;
  best_year_books: number | null;
  worst_year_books: number | null;
  best_decade_books: number | null;
  worst_decade_books: number | null;
  best_core_nationality_books: string | null;
  worst_core_nationality_books: string | null;
  best_birth_nationality_books: string | null;
  worst_birth_nationality_books: string | null;
  best_core_nationality_authors: string | null;
  worst_core_nationality_authors: string | null;
  best_birth_nationality_authors: string | null;
  worst_birth_nationality_authors: string | null;
}

export interface BookYearRow { year: number; book_count: number; avg_score: number | null }
export interface BookDecadeRow { decade: number; book_count: number; avg_score: number | null }
export interface BookNatRow { nationality: string | null; book_count: number; avg_book_score: number | null }
export interface BookGenreRow {
  genre_id: number; genre_name: string;
  book_count: number; book_count_direct: number; avg_book_score: number | null;
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
/** Another search result an import dialog can switch to. */
export interface LookupCandidate {
  tmdb_id?: number;
  igdb_id?: number;
  title: string;
  year: number | null;
  poster_url?: string | null;
  cover_url?: string | null;
}

export interface TmdbLookupIn {
  title: string;
  year?: number | null;
  tmdb_id?: number;
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
  poster_url: string | null;
  existing_movie_id: number | null; // already in the catalog
  candidates: LookupCandidate[];
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
  tmdb_id?: number | null;
  overview?: string | null;
  poster_url?: string | null;
  original_title?: string | null;
  runtime_minutes: number;
  release_year: number;
  people: TmdbImportPersonIn[];
  genre_ids: number[];
  add_to_list?: boolean;
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
  tmdb_id?: number;
  include_episodes?: boolean;
  include_specials?: boolean;
  season_numbers?: number[] | null;
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
  /** Season/episode lookups: roles this person already holds on the parent
   *  (the show for a season, the season for an episode); empty if none. */
  parent_roles: CastRole[];
  parent_person_id: number | null;
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
  still_url: string | null;
  people: TmdbTvPerson[];
}

export interface TmdbTvSeason {
  season_number: number;
  name: string;
  air_date: string | null;
  release_year: number;
  episode_count: number;
  overview: string | null;
  poster_url: string | null;
  episodes: TmdbTvEpisode[];
  /** Season lookup only: everyone credited on every episode of the season. */
  people: TmdbTvPerson[];
  episodes_counted: number;
}

export interface TmdbTvLookup {
  tmdb_id: number;
  name: string;
  original_name: string | null;
  first_air_date: string | null;
  release_year: number;
  overview: string | null;
  poster_url: string | null;
  existing_show_id: number | null; // already in the catalog
  candidates: LookupCandidate[];
  episode_run_time: number;
  number_of_seasons: number;
  number_of_episodes: number;
  people: TmdbTvPerson[];
  episodes_counted: number;
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
  episode_number?: number | null;
  overview?: string | null;
  still_url?: string | null;
  name_en: string | null;
  runtime_minutes: number;
  release_year: number;
  notes: string | null;
  people: TmdbTvImportPersonIn[];
  inherit_parent_people: boolean;
  genre_ids: number[] | null;
}

export interface TmdbTvImportSeasonIn {
  name: string;
  overview?: string | null;
  poster_url?: string | null;
  name_en: string | null;
  season_number: number | null;
  release_year: number;
  notes: string | null;
  people: TmdbTvImportPersonIn[];
  episodes: TmdbTvImportEpisodeIn[];
  /** Whole-show import only: put this season + its episodes in my list. */
  add_to_list?: boolean;
}

export interface TmdbTvImportIn {
  name: string;
  full_episode_cast?: boolean;
  tmdb_id?: number | null;
  overview?: string | null;
  poster_url?: string | null;
  name_en?: string | null;
  release_year: number;
  notes?: string | null;
  people: TmdbTvImportPersonIn[];
  genre_ids: number[];
  seasons: TmdbTvImportSeasonIn[];
  populate_down: boolean;
  add_to_list?: boolean;
}

export interface TmdbTvImportPersonResult {
  person_id: number;
  name: string;
  nationality: string;
  created: boolean;
}

export interface TmdbTvImportOut {
  show_id: number;
  season_ids: number[];
  episode_ids: number[];
  created_people: TmdbTvImportPersonResult[];
  reused_people: TmdbTvImportPersonResult[];
}

export interface TmdbTvSeasonLookupIn {
  show_id: number;
  tmdb_show_id?: number | null;
  title?: string | null;
  year?: number | null;
  season_number: number;
}

export interface TmdbTvSeasonLookup {
  tmdb_show_id: number;
  show_name: string;
  show_ambiguous: boolean;
  season: TmdbTvSeason;
}

export interface TmdbTvSeasonImportIn {
  show_id: number;
  full_episode_cast?: boolean;
  season_id?: number | null;
  update_season_fields?: boolean;
  season: TmdbTvImportSeasonIn;
  populate_down: boolean;
}

export interface TmdbTvSeasonImportOut {
  show_id: number;
  season_id: number;
  created: boolean;
  people_linked: number;
  episodes_created: number;
  created_people: TmdbTvImportPersonResult[];
  reused_people: TmdbTvImportPersonResult[];
}

export interface TmdbTvEpisodeLookupIn {
  season_id?: number | null;
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
  season_id: number;
  episode_id?: number | null;
  update_episode_fields?: boolean;
  episode: TmdbTvImportEpisodeIn;
}

export interface TmdbTvEpisodeImportOut {
  show_id: number;
  season_id: number;
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
  igdb_id?: number;
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
  cover_url: string | null;
  existing_game_id: number | null; // already in the catalog
  candidates: LookupCandidate[];
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
  igdb_id?: number | null;
  summary?: string | null;
  cover_url?: string | null;
  release_year: number;
  people: IgdbImportPersonIn[];
  genre_ids: number[];
  platform_ids: number[];
  add_to_list?: boolean;
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

// ── Person scans: TMDB (movies + television) and IGDB (games) ──────────────────
export type PersonScanEntityKind = "movie" | "show" | "season" | "episode" | "game";
// "conflict": corroborated in one medium, contradicted in another (TMDB scan only).
export type PersonScanVerdict = "verified" | "name_only" | "conflict" | "";

export interface PersonScanStats {
  items_total: number;
  items_in_scope: number;
  items_resolved: number;
  items_unresolved: number;
  network_calls: number;
  cache_hits: number;
}

export interface PersonScanJob {
  id: string;
  status: "pending" | "running" | "done" | "cancelled" | "error";
  phase: "queued" | "loading" | "fetching" | "matching" | "finished";
  processed: number;
  total: number;
  last_item: string | null;
  error: string | null;
  candidate_count: number | null;
  stats: PersonScanStats | null;
  scoped: boolean; // limited to some entities, not a full scan
  created_at: string | null;
  finished_at: string | null;
}

export interface PersonScanCandidate {
  key: string;
  person_id: number;
  person_name: string;
  entity_kind: PersonScanEntityKind;
  entity_id: number;
  entity_name: string;
  entity_year: number | null;
  context: string | null;
  credit_type: "cast" | "guest" | "crew" | "company";
  slot: string;
  character: string | null;
  billing_order: number | null;
  job: string | null;
  episode_count: number | null;
  suggested_role: string;
  roles: string[];
  suggestion_reason: string;
  match: "verified" | "name_only";
  overlap: number;
  source_person_id: number;
  source_popularity: number;
  suppressed: boolean;
  verdict: PersonScanVerdict;
  // medium -> [linked works that corroborate, linked works checked]
  evidence: Partial<Record<"movie" | "show", [number, number]>>;
}

export interface PersonScanUnresolved {
  entity_kind: PersonScanEntityKind;
  id: number;
  name: string;
  release_year: number | null;
  reason: string;
}

export interface PersonScanResults {
  job_id: string;
  candidates: PersonScanCandidate[];
  unresolved: PersonScanUnresolved[];
}

export interface PersonScanLinkIn {
  entity_kind: PersonScanEntityKind;
  entity_id: number;
  person_id: number;
  role: string;
}

export interface PersonScanSlotIn {
  entity_kind: PersonScanEntityKind;
  entity_id: number;
  person_id: number;
  slot: string;
}

export interface PersonScanApplyIn {
  links: PersonScanLinkIn[];
  suppress: PersonScanSlotIn[];
  unsuppress: PersonScanSlotIn[];
}

export interface PersonScanApplyResult {
  created: number;
  skipped: number;
  invalid: PersonScanLinkIn[];
  suppressed: number;
  unsuppressed: number;
}

export interface PersonScanSuppression {
  entity_kind: PersonScanEntityKind;
  entity_id: number;
  entity_name: string | null;
  person_id: number;
  person_name: string | null;
  slot: string;
}

export interface PersonScanSuppressionList {
  count: number;
  items: PersonScanSuppression[];
}

// ── People graph ─────────────────────────────────────────────────────────────
export type GraphHubKind = "artist" | "album" | "book" | "movie" | "game" | "show" | "season" | "episode";
export type GraphHubRelation = "album_artist" | "season_show" | "episode_season" | "adaptation" | "soundtrack";

export interface GraphPerson {
  id: number;
  name: string;
  name_en: string | null;
  roles: Partial<Record<GraphHubKind, string[]>>; // distinct roles per hub kind
}

export interface GraphHub {
  kind: GraphHubKind;
  id: number;
  name: string;
  show_id: number | null; // seasons and episodes
  show_name: string | null; // seasons and episodes
  season_number: number | null; // seasons and episodes
}

export interface GraphEdge {
  person_id: number;
  kind: GraphHubKind;
  target_id: number;
  roles: string[];
  inherited: string[]; // roles already held on the season's show / episode's season or show
}

// Hub-to-hub link: album→artist, episode→season→show, adaptations, soundtracks.
export interface GraphHubLink {
  relation: GraphHubRelation;
  from_kind: GraphHubKind;
  from_id: number;
  to_kind: GraphHubKind;
  to_id: number;
}

export interface PersonGraph {
  mine: { kind: GraphHubKind; id: number }[];
  persons: GraphPerson[];
  hubs: GraphHub[];
  edges: GraphEdge[]; // person → hub (never album)
  hub_links: GraphHubLink[];
}

export interface GuildOverview {
  sections: Record<"music" | "books" | "movies" | "television" | "games", { catalog: number; mine: number }>;
  people: number;
  members: number;
}

export interface ActivityItem {
  kind: "catalog" | "list"; // added to the catalog / added to someone's list
  section: string;
  path: string;
  id: number;
  name: string;
  at: string;
  user_id: number | null;
  username: string | null;
}

export interface ActivityPage {
  items: ActivityItem[];
  next_before: string | null;
}
