import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { gk, rk } from "./keys";
import { useMe } from "../auth/AuthProvider";
import { useGuild } from "../guild/GuildProvider";
import type {
  Album, AlbumEntry, Artist, Book, BookEntry, RankedBook, Comparison, ComparisonIn, Game, GameEntry, GamePlatform, Genre, GenreCategory,
  IgdbImportIn, IgdbImportOut, IgdbLookup, IgdbLookupIn, Link as LinkItem, Movie, MovieEntry, NationalityEntry, Person, PersonDetail,
  PersonGraph, PersonScanApplyIn, PersonScanApplyResult, PersonScanEntityKind, PersonScanJob, PersonScanResults,
  PersonScanSuppressionList, RankedAlbum, RankedArtist, RankedGame, RankedMovie, RankedTelevisionEpisode, RankedTelevisionSeason,
  RankedTelevisionShow,
  TelevisionEpisode, TelevisionEpisodeEntry,
  TelevisionSeason, TelevisionSeasonEntry, TelevisionShow, TelevisionShowEntry, TmdbImportIn, TmdbImportOut, TmdbLookup, TmdbLookupIn,
  TmdbTvEpisodeImportIn, TmdbTvEpisodeImportOut, TmdbTvEpisodeLookup, TmdbTvEpisodeLookupIn, TmdbTvImportIn,
  TmdbTvImportOut, TmdbTvLookup, TmdbTvLookupIn, TmdbTvSeasonImportIn, TmdbTvSeasonImportOut, TmdbTvSeasonLookup,
  TmdbTvSeasonLookupIn,
} from "./types";

/** Every path and every cache key is scoped to the active guild. */
export function useGuildApi() {
  const guild = useGuild();
  const me = useMe();
  return { guildId: guild.id, userId: me.id, base: `/guilds/${guild.id}` };
}

/** The guild's nationality list ("Unknown" is not in it; it's always available). */
export function useNationalities() {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "nationalities"),
    queryFn: () => api.get<NationalityEntry[]>(`${base}/nationalities`),
  });
}

// ── People ───────────────────────────────────────────────────────────────────
/** `enabled: false` defers the (large) request until e.g. an editor opens. */
export function usePeople(enabled = true) {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "people"), queryFn: () => api.get<Person[]>(`${base}/persons`), enabled });
}

export function usePersonGraph() {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "people", "graph"), queryFn: () => api.get<PersonGraph>(`${base}/persons/graph`) });
}

export function usePerson(pid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "people", pid),
    queryFn: () => api.get<Person>(`${base}/persons/${pid}`),
    enabled: !!pid,
  });
}

export function usePersonDetail(pid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "people", pid, "detail"),
    queryFn: () => api.get<PersonDetail>(`${base}/persons/${pid}/detail`),
    enabled: !isNaN(pid),
  });
}

// ── Genres / categories / platforms ───────────────────────────────────────────
export function useMusicGenres() {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "genres"), queryFn: () => api.get<Genre[]>(`${base}/genres`) });
}
export function useMovieGenres() {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "movie-genres"), queryFn: () => api.get<Genre[]>(`${base}/movie-genres`) });
}
export function useGameGenres() {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "game-genres"), queryFn: () => api.get<Genre[]>(`${base}/game-genres`) });
}
export function useTelevisionGenres() {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "television-genres"),
    queryFn: () => api.get<Genre[]>(`${base}/television-genres`),
  });
}
export function useBookGenres() {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "book-genres"), queryFn: () => api.get<Genre[]>(`${base}/book-genres`) });
}
export function useGamePlatforms() {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "game-platforms"),
    queryFn: () => api.get<GamePlatform[]>(`${base}/game-platforms`),
  });
}

export function useUpdateGenreMediaTypes() {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: number } & Partial<Record<"is_music" | "is_movie" | "is_game" | "is_television" | "is_book", boolean>>) => {
      const { id, ...patch } = body;
      return api.patch(`${base}/genres/${id}/media-types`, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "genres") });
      qc.invalidateQueries({ queryKey: gk(guildId, "movie-genres") });
      qc.invalidateQueries({ queryKey: gk(guildId, "game-genres") });
      qc.invalidateQueries({ queryKey: gk(guildId, "television-genres") });
      qc.invalidateQueries({ queryKey: gk(guildId, "book-genres") });
    },
  });
}

export function useGenreCategories() {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "genres", "categories"),
    queryFn: () => api.get<GenreCategory[]>(`${base}/genres/categories`),
  });
}
export function useMovieGenreCategories() {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "movie-genres", "categories"),
    queryFn: () => api.get<GenreCategory[]>(`${base}/movie-genres/categories`),
  });
}
export function useGameGenreCategories() {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "game-genres", "categories"),
    queryFn: () => api.get<GenreCategory[]>(`${base}/game-genres/categories`),
  });
}
export function useTelevisionGenreCategories() {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "television-genres", "categories"),
    queryFn: () => api.get<GenreCategory[]>(`${base}/television-genres/categories`),
  });
}
export function useBookGenreCategories() {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "book-genres", "categories"),
    queryFn: () => api.get<GenreCategory[]>(`${base}/book-genres/categories`),
  });
}
export function useGamePlatformCategories() {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "game-platforms", "categories"),
    queryFn: () => api.get<GenreCategory[]>(`${base}/game-platforms/categories`),
  });
}

// ── Catalog ──────────────────────────────────────────────────────────────────
export function useArtistCatalog(enabled = true) {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "artists"), queryFn: () => api.get<Artist[]>(`${base}/artists`), enabled });
}
export function useArtist(aid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "artists", aid),
    queryFn: () => api.get<Artist>(`${base}/artists/${aid}`),
    enabled: !!aid,
  });
}

/** Every album by this artist in the guild catalog, not just what's ranked. */
export function useAlbumCatalog(artistId: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "artists", artistId, "albums"),
    queryFn: () => api.get<Album[]>(`${base}/artists/${artistId}/albums`),
    enabled: !!artistId,
  });
}

export function useBookCatalog() {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "books"), queryFn: () => api.get<Book[]>(`${base}/books`) });
}

export function useMovieCatalog(enabled = true) {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "movies"), queryFn: () => api.get<Movie[]>(`${base}/movies`), enabled });
}
export function useMovie(mid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "movies", mid),
    queryFn: () => api.get<Movie>(`${base}/movies/${mid}`),
    enabled: !!mid,
  });
}

export function useGameCatalog(enabled = true) {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, "games"), queryFn: () => api.get<Game[]>(`${base}/games`), enabled });
}
export function useGame(gid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "games", gid),
    queryFn: () => api.get<Game>(`${base}/games/${gid}`),
    enabled: !!gid,
  });
}

export function useTelevisionCatalog(enabled = true) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "television", "shows"),
    queryFn: () => api.get<TelevisionShow[]>(`${base}/television/shows`),
    enabled,
  });
}
export function useTelevisionShow(sid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "television", "shows", sid),
    queryFn: () => api.get<TelevisionShow>(`${base}/television/shows/${sid}`),
    enabled: !!sid,
  });
}
export function useTelevisionSeasons(sid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "television", "shows", sid, "seasons"),
    queryFn: () => api.get<TelevisionSeason[]>(`${base}/television/shows/${sid}/seasons`),
    enabled: !!sid,
  });
}
export function useTelevisionSeason(seid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "television", "seasons", seid),
    queryFn: () => api.get<TelevisionSeason>(`${base}/television/seasons/${seid}`),
    enabled: !!seid,
  });
}
export function useTelevisionEpisodes(seasonId: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "television", "seasons", seasonId, "episodes"),
    queryFn: () => api.get<TelevisionEpisode[]>(`${base}/television/seasons/${seasonId}/episodes`),
    enabled: !!seasonId,
  });
}
export function useTelevisionEpisode(eid: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, "television", "episodes", eid),
    queryFn: () => api.get<TelevisionEpisode>(`${base}/television/episodes/${eid}`),
    enabled: !!eid,
  });
}

// ── Links ────────────────────────────────────────────────────────────────────
/** `section` is the owner's list-cache key prefix (e.g. "artists", "albums",
 * "movies", "games", "television"); `path` is the URL segment for the owner
 * (e.g. "albums", "television/shows", "television/episodes"). */
export function useLinks(path: string, ownerId: number) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, ...path.split("/"), ownerId, "links"),
    queryFn: () => api.get<LinkItem[]>(`${base}/${path}/${ownerId}/links`),
    enabled: !!ownerId,
  });
}

export function useLinkMutations(section: string, path: string, ownerId: number) {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, ...path.split("/"), ownerId, "links") });
    qc.invalidateQueries({ queryKey: gk(guildId, section) });
  };
  const add = useMutation({
    mutationFn: (body: { label: string | null; url: string; position: number }) =>
      api.post<LinkItem>(`${base}/${path}/${ownerId}/links`, body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (v: { id: number; label: string | null; url: string; position: number }) =>
      api.patch<LinkItem>(`${base}/${path}/${ownerId}/links/${v.id}`, {
        label: v.label, url: v.url, position: v.position,
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${base}/${path}/${ownerId}/links/${id}`),
    onSuccess: invalidate,
  });
  return { add, update, remove };
}

// ── Rankings ─────────────────────────────────────────────────────────────────
export function useRankedArtists(userId?: number) {
  const { guildId, userId: me, base } = useGuildApi();
  const uid = userId ?? me;
  return useQuery({
    queryKey: rk(guildId, uid, "artists", "ranked"),
    queryFn: () => api.get<RankedArtist[]>(`${base}/artists/ranked${uid === me ? "" : `?user_id=${uid}`}`),
  });
}

export function useRankedAlbums(artistId: number, userId?: number) {
  const { guildId, userId: me, base } = useGuildApi();
  const uid = userId ?? me;
  return useQuery({
    queryKey: rk(guildId, uid, "artists", artistId, "albums", "ranked"),
    queryFn: () =>
      api.get<RankedAlbum[]>(`${base}/artists/${artistId}/albums/ranked${uid === me ? "" : `?user_id=${uid}`}`),
    enabled: !!artistId,
  });
}

export function useRankedBooks(userId?: number) {
  const { guildId, userId: me, base } = useGuildApi();
  const uid = userId ?? me;
  return useQuery({
    queryKey: rk(guildId, uid, "books", "ranked"),
    queryFn: () => api.get<RankedBook[]>(`${base}/books/ranked${uid === me ? "" : `?user_id=${uid}`}`),
  });
}

export function useRankedMovies(userId?: number) {
  const { guildId, userId: me, base } = useGuildApi();
  const uid = userId ?? me;
  return useQuery({
    queryKey: rk(guildId, uid, "movies", "ranked"),
    queryFn: () => api.get<RankedMovie[]>(`${base}/movies/ranked${uid === me ? "" : `?user_id=${uid}`}`),
  });
}

export function useRankedGames(userId?: number) {
  const { guildId, userId: me, base } = useGuildApi();
  const uid = userId ?? me;
  return useQuery({
    queryKey: rk(guildId, uid, "games", "ranked"),
    queryFn: () => api.get<RankedGame[]>(`${base}/games/ranked${uid === me ? "" : `?user_id=${uid}`}`),
  });
}

export function useRankedTelevisionShows(userId?: number) {
  const { guildId, userId: me, base } = useGuildApi();
  const uid = userId ?? me;
  return useQuery({
    queryKey: rk(guildId, uid, "television", "shows", "ranked"),
    queryFn: () =>
      api.get<RankedTelevisionShow[]>(`${base}/television/shows/ranked${uid === me ? "" : `?user_id=${uid}`}`),
  });
}

export function useRankedTelevisionSeasons(showId: number, userId?: number) {
  const { guildId, userId: me, base } = useGuildApi();
  const uid = userId ?? me;
  return useQuery({
    queryKey: rk(guildId, uid, "television", "shows", showId, "seasons", "ranked"),
    queryFn: () =>
      api.get<RankedTelevisionSeason[]>(
        `${base}/television/shows/${showId}/seasons/ranked${uid === me ? "" : `?user_id=${uid}`}`,
      ),
    enabled: !!showId,
  });
}

export function useRankedTelevisionEpisodes(seasonId: number, userId?: number) {
  const { guildId, userId: me, base } = useGuildApi();
  const uid = userId ?? me;
  return useQuery({
    queryKey: rk(guildId, uid, "television", "seasons", seasonId, "episodes", "ranked"),
    queryFn: () =>
      api.get<RankedTelevisionEpisode[]>(
        `${base}/television/seasons/${seasonId}/episodes/ranked${uid === me ? "" : `?user_id=${uid}`}`,
      ),
    enabled: !!seasonId,
  });
}

/** Every episode of the show in one order (`show_rank`), across seasons. */
export function useRankedShowEpisodes(showId: number, userId?: number) {
  const { guildId, userId: me, base } = useGuildApi();
  const uid = userId ?? me;
  return useQuery({
    queryKey: rk(guildId, uid, "television", "shows", showId, "episodes", "ranked"),
    queryFn: () =>
      api.get<RankedTelevisionEpisode[]>(
        `${base}/television/shows/${showId}/episodes/ranked${uid === me ? "" : `?user_id=${uid}`}`,
      ),
    enabled: !!showId,
  });
}

/** Invalidate both the catalog (in_my_list flips) and my ranked view. */
export function useInvalidate(section: string) {
  const qc = useQueryClient();
  const { guildId, userId } = useGuildApi();
  return () => {
    qc.invalidateQueries({ queryKey: gk(guildId, section) });
    qc.invalidateQueries({ queryKey: rk(guildId, userId) });
  };
}

export function useEntryMutations(section: "artists" | "books" | "movies" | "games" | "television/shows") {
  const { base } = useGuildApi();
  const invalidate = useInvalidate(section.split("/")[0]);
  const add = useMutation({
    mutationFn: (id: number) => api.put(`${base}/${section}/${id}/entry`, {}),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${base}/${section}/${id}/entry`),
    onSuccess: invalidate,
  });
  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) =>
      api.put(`${base}/${section}/${v.id}/position`, { position: v.position }),
    onSettled: invalidate,
  });
  return { add, remove, move };
}

// ── Single-entity "my list" entry: notes + watch/listen count on detail pages ──
export function useMovieEntry(movieId: number) {
  const { guildId, userId, base } = useGuildApi();
  return useQuery({
    queryKey: rk(guildId, userId, "movies", movieId, "entry"),
    queryFn: () => api.get<MovieEntry | null>(`${base}/movies/${movieId}/entry`),
    enabled: !!movieId,
  });
}
export function useUpdateMovieEntry(movieId: number) {
  const { guildId, userId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { watches?: number; notes?: string | null }) =>
      api.put(`${base}/movies/${movieId}/entry`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "movies", movieId, "entry") });
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "movies") });
    },
  });
}

export function useAlbumEntry(artistId: number, albumId: number) {
  const { guildId, userId, base } = useGuildApi();
  return useQuery({
    queryKey: rk(guildId, userId, "artists", artistId, "albums", albumId, "entry"),
    queryFn: () => api.get<AlbumEntry | null>(`${base}/artists/${artistId}/albums/${albumId}/entry`),
    enabled: !!artistId && !!albumId,
  });
}
export function useUpdateAlbumEntry(artistId: number, albumId: number) {
  const { guildId, userId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { listens?: number; notes?: string | null }) =>
      api.put(`${base}/artists/${artistId}/albums/${albumId}/entry`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "artists", artistId, "albums", albumId, "entry") });
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "artists", artistId, "albums") });
    },
  });
}

export function useBookEntry(bookId: number) {
  const { guildId, userId, base } = useGuildApi();
  return useQuery({
    queryKey: rk(guildId, userId, "books", bookId, "entry"),
    queryFn: () => api.get<BookEntry | null>(`${base}/books/${bookId}/entry`),
    enabled: !!bookId,
  });
}
export function useUpdateBookEntry(bookId: number) {
  const { guildId, userId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { reads?: number; notes?: string | null }) =>
      api.put(`${base}/books/${bookId}/entry`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "books", bookId, "entry") });
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "books") });
    },
  });
}

export function useGameEntry(gameId: number) {
  const { guildId, userId, base } = useGuildApi();
  return useQuery({
    queryKey: rk(guildId, userId, "games", gameId, "entry"),
    queryFn: () => api.get<GameEntry | null>(`${base}/games/${gameId}/entry`),
    enabled: !!gameId,
  });
}
export function useUpdateGameEntry(gameId: number) {
  const { guildId, userId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { hours_played?: number | null; notes?: string | null }) =>
      api.put(`${base}/games/${gameId}/entry`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "games", gameId, "entry") });
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "games") });
    },
  });
}

export function useTelevisionShowEntry(showId: number) {
  const { guildId, userId, base } = useGuildApi();
  return useQuery({
    queryKey: rk(guildId, userId, "television", "shows", showId, "entry"),
    queryFn: () => api.get<TelevisionShowEntry | null>(`${base}/television/shows/${showId}/entry`),
    enabled: !!showId,
  });
}
export function useUpdateTelevisionShowEntry(showId: number) {
  const { guildId, userId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { notes?: string | null }) => api.put(`${base}/television/shows/${showId}/entry`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "shows", showId, "entry") });
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "shows") });
    },
  });
}

export function useTelevisionSeasonEntry(seasonId: number) {
  const { guildId, userId, base } = useGuildApi();
  return useQuery({
    queryKey: rk(guildId, userId, "television", "seasons", seasonId, "entry"),
    queryFn: () => api.get<TelevisionSeasonEntry | null>(`${base}/television/seasons/${seasonId}/entry`),
    enabled: !!seasonId,
  });
}
export function useUpdateTelevisionSeasonEntry(showId: number, seasonId: number) {
  const { guildId, userId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { notes?: string | null }) => api.put(`${base}/television/seasons/${seasonId}/entry`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "seasons", seasonId, "entry") });
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "shows", showId, "seasons") });
    },
  });
}

export function useTelevisionEpisodeEntry(episodeId: number) {
  const { guildId, userId, base } = useGuildApi();
  return useQuery({
    queryKey: rk(guildId, userId, "television", "episodes", episodeId, "entry"),
    queryFn: () => api.get<TelevisionEpisodeEntry | null>(`${base}/television/episodes/${episodeId}/entry`),
    enabled: !!episodeId,
  });
}
export function useUpdateTelevisionEpisodeEntry(seasonId: number, episodeId: number) {
  const { guildId, userId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { watches?: number; notes?: string | null }) =>
      api.put(`${base}/television/episodes/${episodeId}/entry`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "episodes", episodeId, "entry") });
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "seasons", seasonId, "episodes") });
    },
  });
}

// ── Comparisons (pairwise ranking) ────────────────────────────────────────────
/** `path` is the comparisons endpoint's prefix, e.g. "artists", "movies",
 * "artists/12/albums", "television/shows/4/seasons", "television/seasons/7/episodes". */
export function useComparisons(path: string) {
  const { guildId, userId, base } = useGuildApi();
  return useQuery({
    queryKey: rk(guildId, userId, ...path.split("/"), "comparisons"),
    queryFn: () => api.get<Comparison[]>(`${base}/${path}/comparisons`),
  });
}

export function useComparisonMutations(path: string) {
  const { guildId, userId, base } = useGuildApi();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: rk(guildId, userId, ...path.split("/"), "comparisons") });
  const upsert = useMutation({
    mutationFn: (body: ComparisonIn) => api.put<Comparison>(`${base}/${path}/comparisons`, body),
    // Answers arrive in quick bursts and only change the comparisons list.
    meta: { invalidates: false },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ a, b }: { a: number; b: number }) => api.delete(`${base}/${path}/comparisons/${a}/${b}`),
    onSuccess: invalidate,
  });
  const clear = useMutation({
    mutationFn: () => api.delete(`${base}/${path}/comparisons`),
    onSuccess: invalidate,
  });
  return { upsert, remove, clear };
}

export function useReorder(path: string, section: string) {
  const { base } = useGuildApi();
  const invalidate = useInvalidate(section);
  return useMutation({
    mutationFn: (ids: number[]) => api.put(`${base}/${path}/reorder`, { ids }),
    onSuccess: invalidate,
  });
}

// ── TMDB import (movies) ───────────────────────────────────────────────────────
export function useTmdbLookup() {
  const { base } = useGuildApi();
  return useMutation({ meta: { invalidates: false }, mutationFn: (body: TmdbLookupIn) => api.post<TmdbLookup>(`${base}/movies/tmdb-import/lookup`, body) });
}
export function useTmdbImport() {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TmdbImportIn) => api.post<TmdbImportOut>(`${base}/movies/tmdb-import`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "movies") });
      qc.invalidateQueries({ queryKey: gk(guildId, "people") });
    },
  });
}

// ── TMDB import (television) ────────────────────────────────────────────────────
export function useTmdbTvLookup() {
  const { base } = useGuildApi();
  return useMutation({ meta: { invalidates: false }, mutationFn: (body: TmdbTvLookupIn) => api.post<TmdbTvLookup>(`${base}/television/tmdb-import/lookup`, body) });
}
export function useTmdbTvImport() {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TmdbTvImportIn) => api.post<TmdbTvImportOut>(`${base}/television/tmdb-import`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "television") });
      qc.invalidateQueries({ queryKey: gk(guildId, "people") });
    },
  });
}
export function useTmdbTvSeasonLookup() {
  const { base } = useGuildApi();
  return useMutation({
    meta: { invalidates: false }, mutationFn: (body: TmdbTvSeasonLookupIn) => api.post<TmdbTvSeasonLookup>(`${base}/television/tmdb-import/season-lookup`, body),
  });
}
export function useTmdbTvSeasonImport() {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TmdbTvSeasonImportIn) => api.post<TmdbTvSeasonImportOut>(`${base}/television/tmdb-import/season`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "television") });
      qc.invalidateQueries({ queryKey: gk(guildId, "people") });
    },
  });
}
export function useTmdbTvEpisodeLookup() {
  const { base } = useGuildApi();
  return useMutation({
    meta: { invalidates: false }, mutationFn: (body: TmdbTvEpisodeLookupIn) => api.post<TmdbTvEpisodeLookup>(`${base}/television/tmdb-import/episode-lookup`, body),
  });
}
export function useTmdbTvEpisodeImport() {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TmdbTvEpisodeImportIn) => api.post<TmdbTvEpisodeImportOut>(`${base}/television/tmdb-import/episode`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "television") });
      qc.invalidateQueries({ queryKey: gk(guildId, "people") });
    },
  });
}

// ── IGDB import (games) ─────────────────────────────────────────────────────────
export function useIgdbLookup() {
  const { base } = useGuildApi();
  return useMutation({ meta: { invalidates: false }, mutationFn: (body: IgdbLookupIn) => api.post<IgdbLookup>(`${base}/games/igdb-import/lookup`, body) });
}
export function useIgdbImport() {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IgdbImportIn) => api.post<IgdbImportOut>(`${base}/games/igdb-import`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "games") });
      qc.invalidateQueries({ queryKey: gk(guildId, "people") });
    },
  });
}

// ── Person scans ─────────────────────────────────────────────────────────────────
// One set of hooks for both: `path` is the router prefix ("tmdb-person-scan" /
// "game-person-scan"), which also namespaces the cache keys.
export function usePersonScanJobs(path: string) {
  const { guildId, base } = useGuildApi();
  return useQuery({ queryKey: gk(guildId, path, "jobs"), queryFn: () => api.get<PersonScanJob[]>(`${base}/${path}/jobs`) });
}
export function usePersonScanJob(path: string, jobId: string | null) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, path, "jobs", jobId),
    queryFn: () => api.get<PersonScanJob>(`${base}/${path}/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data && ["done", "cancelled", "error"].includes(query.state.data.status) ? false : 1000),
  });
}
export function usePersonScanResults(path: string, jobId: string | null) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, path, "jobs", jobId, "results"),
    queryFn: () => api.get<PersonScanResults>(`${base}/${path}/jobs/${jobId}/results`),
    enabled: !!jobId,
  });
}
export function useStartPersonScan(path: string) {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { entity_ids?: number[] | null; entity_kind?: PersonScanEntityKind; force_refresh?: boolean }) =>
      api.post<PersonScanJob>(`${base}/${path}/jobs`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, path, "jobs") }),
  });
}
export function useCancelPersonScan(path: string) {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post(`${base}/${path}/jobs/${jobId}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, path, "jobs") }),
  });
}
export function useDeletePersonScanJob(path: string) {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.delete(`${base}/${path}/jobs/${jobId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, path, "jobs") }),
  });
}
/** `invalidate`: the catalog prefixes whose cached detail pages show the new links. */
export function useApplyPersonScan(path: string, invalidate: string[]) {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PersonScanApplyIn) => api.post<PersonScanApplyResult>(`${base}/${path}/apply`, body),
    onSuccess: () => {
      for (const prefix of [...invalidate, "people"]) qc.invalidateQueries({ queryKey: gk(guildId, prefix) });
      qc.invalidateQueries({ queryKey: gk(guildId, path, "suppressions") });
    },
  });
}
export function usePersonScanSuppressions(path: string) {
  const { guildId, base } = useGuildApi();
  return useQuery({
    queryKey: gk(guildId, path, "suppressions"),
    queryFn: () => api.get<PersonScanSuppressionList>(`${base}/${path}/suppressions`),
  });
}
export function useClearPersonScanSuppressions(path: string) {
  const { guildId, base } = useGuildApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`${base}/${path}/suppressions`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, path, "suppressions") }),
  });
}
