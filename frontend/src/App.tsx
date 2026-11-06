import { Suspense, lazy, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoadFailed } from "./components/LoadFailed";
import { LoadingState } from "./components/Spinner";
import { AppShell } from "./shell/AppShell";
const LoginPage = lazyNamed(() => import("./auth/LoginPage"), "LoginPage");
const RegisterPage = lazyNamed(() => import("./auth/RegisterPage"), "RegisterPage");
import { GuildProvider, useCan } from "./guild/GuildProvider";
const GuildStatsPage = lazyNamed(() => import("./guild/GuildStatsPage"), "GuildStatsPage");
const GuildHomePage = lazyNamed(() => import("./guild/GuildHomePage"), "GuildHomePage");
const GuildMembersPage = lazyNamed(() => import("./guild/GuildMembersPage"), "GuildMembersPage");
const GuildsPage = lazyNamed(() => import("./guild/GuildsPage"), "GuildsPage");
const MergeWizard = lazyNamed(() => import("./guild/MergeWizard"), "MergeWizard");
const ComparePage = lazyNamed(() => import("./guild/ComparePage"), "ComparePage");
const AccountPage = lazyNamed(() => import("./auth/AccountPage"), "AccountPage");
const AlbumDetailPage = lazyNamed(() => import("./pages/AlbumDetailPage"), "AlbumDetailPage");
const ArtistDetailPage = lazyNamed(() => import("./pages/ArtistDetailPage"), "ArtistDetailPage");
const ArtistsPage = lazyNamed(() => import("./pages/ArtistsPage"), "ArtistsPage");
const BookDetailPage = lazyNamed(() => import("./pages/BookDetailPage"), "BookDetailPage");
const BooksPage = lazyNamed(() => import("./pages/BooksPage"), "BooksPage");
const BookStatsPage = lazyNamed(() => import("./pages/BookStatsPage"), "BookStatsPage");
const GameDetailPage = lazyNamed(() => import("./pages/GameDetailPage"), "GameDetailPage");
const GamesPage = lazyNamed(() => import("./pages/GamesPage"), "GamesPage");
const MovieDetailPage = lazyNamed(() => import("./pages/MovieDetailPage"), "MovieDetailPage");
const GamePersonScanPage = lazyNamed(() => import("./pages/PersonScanPage"), "GamePersonScanPage");
const TmdbPersonScanPage = lazyNamed(() => import("./pages/PersonScanPage"), "TmdbPersonScanPage");
const MoviesPage = lazyNamed(() => import("./pages/MoviesPage"), "MoviesPage");
const GameStatsPage = lazyNamed(() => import("./pages/GameStatsPage"), "GameStatsPage");
const MovieStatsPage = lazyNamed(() => import("./pages/MovieStatsPage"), "MovieStatsPage");
const PeopleGraphPage = lazyNamed(() => import("./pages/PeopleGraphPage"), "PeopleGraphPage");
const NationalitiesPage = lazyNamed(() => import("./pages/NationalitiesPage"), "NationalitiesPage");
const PeoplePage = lazyNamed(() => import("./pages/PeoplePage"), "PeoplePage");
const PersonDetailPage = lazyNamed(() => import("./pages/PersonDetailPage"), "PersonDetailPage");
const StatsPage = lazyNamed(() => import("./pages/StatsPage"), "StatsPage");
const TelevisionEpisodeDetailPage = lazyNamed(() => import("./pages/TelevisionEpisodeDetailPage"), "TelevisionEpisodeDetailPage");
const TelevisionSeasonDetailPage = lazyNamed(() => import("./pages/TelevisionSeasonDetailPage"), "TelevisionSeasonDetailPage");
const TelevisionShowDetailPage = lazyNamed(() => import("./pages/TelevisionShowDetailPage"), "TelevisionShowDetailPage");
const TelevisionShowsPage = lazyNamed(() => import("./pages/TelevisionShowsPage"), "TelevisionShowsPage");
const TelevisionShowEpisodesPage = lazyNamed(() => import("./pages/TelevisionShowEpisodesPage"), "TelevisionShowEpisodesPage");
const TelevisionStatsPage = lazyNamed(() => import("./pages/TelevisionStatsPage"), "TelevisionStatsPage");
const GenreDetailPage = lazyNamed(() => import("./genre/GenreDetailPage"), "GenreDetailPage");
const GenresPage = lazyNamed(() => import("./genre/GenresPage"), "GenresPage");
import { BOOK_GENRES, GAME_GENRES, GAME_PLATFORMS, MOVIE_GENRES, MUSIC_GENRES, TELEVISION_GENRES } from "./genre/config";
const ArtistAlbumsRankPage = lazyNamed(() => import("./rank/pages"), "ArtistAlbumsRankPage");
const ArtistsRankPage = lazyNamed(() => import("./rank/pages"), "ArtistsRankPage");
const BooksRankPage = lazyNamed(() => import("./rank/pages"), "BooksRankPage");
const GamesRankPage = lazyNamed(() => import("./rank/pages"), "GamesRankPage");
const MoviesRankPage = lazyNamed(() => import("./rank/pages"), "MoviesRankPage");
const TelevisionEpisodesRankPage = lazyNamed(() => import("./rank/pages"), "TelevisionEpisodesRankPage");
const TelevisionSeasonsRankPage = lazyNamed(() => import("./rank/pages"), "TelevisionSeasonsRankPage");
const TelevisionShowEpisodesRankPage = lazyNamed(() => import("./rank/pages"), "TelevisionShowEpisodesRankPage");
const TelevisionShowsRankPage = lazyNamed(() => import("./rank/pages"), "TelevisionShowsRankPage");

/** Route pages load on first visit, so the initial bundle carries only the shell
 *  (recharts and d3-force in particular stay out of it). */
function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `lazy` itself is typed on ComponentType<any>
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType<any> })));
}

const pageFallback = <LoadingState />;

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <LoadingState label="Checking your session…" />;
  return me ? <>{children}</> : <Navigate to="/login" replace />;
}

function MusicSection() {
  return (
    <>
      <Suspense fallback={pageFallback}>
        <Routes>
          <Route path="/" element={<ArtistsPage />} />
          <Route path="/rank" element={<ArtistsRankPage />} />
          <Route path="/artists/:id" element={<ArtistDetailPage />} />
          <Route path="/artists/:id/rank" element={<ArtistAlbumsRankPage />} />
          <Route path="/albums/:id" element={<AlbumDetailPage />} />
          <Route path="/genres" element={<GenresPage domain={MUSIC_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={MUSIC_GENRES} />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="*" element={<LoadFailed what="page" error={null} />} />
        </Routes>
      </Suspense>
    </>
  );
}

function BooksSection() {
  return (
    <>
      <Suspense fallback={pageFallback}>
        <Routes>
          <Route path="/" element={<BooksPage />} />
          <Route path="/rank" element={<BooksRankPage />} />
          <Route path="/:id" element={<BookDetailPage />} />
          <Route path="/genres" element={<GenresPage domain={BOOK_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={BOOK_GENRES} />} />
          <Route path="/stats" element={<BookStatsPage />} />
          <Route path="*" element={<LoadFailed what="page" error={null} />} />
        </Routes>
      </Suspense>
    </>
  );
}

function MoviesSection() {
  return (
    <>
      <Suspense fallback={pageFallback}>
        <Routes>
          <Route path="/" element={<MoviesPage />} />
          <Route path="/rank" element={<MoviesRankPage />} />
          <Route path="/:id" element={<MovieDetailPage />} />
          <Route path="/genres" element={<GenresPage domain={MOVIE_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={MOVIE_GENRES} />} />
          <Route path="/stats" element={<MovieStatsPage />} />
          <Route path="/scan" element={<TmdbPersonScanPage />} />
          <Route path="*" element={<LoadFailed what="page" error={null} />} />
        </Routes>
      </Suspense>
    </>
  );
}

function GamesSection() {
  return (
    <>
      <Suspense fallback={pageFallback}>
        <Routes>
          <Route path="/" element={<GamesPage />} />
          <Route path="/rank" element={<GamesRankPage />} />
          <Route path="/:id" element={<GameDetailPage />} />
          <Route path="/genres" element={<GenresPage domain={GAME_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={GAME_GENRES} />} />
          <Route path="/platforms" element={<GenresPage domain={GAME_PLATFORMS} />} />
          <Route path="/platforms/:id" element={<GenreDetailPage domain={GAME_PLATFORMS} />} />
          <Route path="/stats" element={<GameStatsPage />} />
          <Route path="/scan" element={<GamePersonScanPage />} />
          <Route path="*" element={<LoadFailed what="page" error={null} />} />
        </Routes>
      </Suspense>
    </>
  );
}

function TelevisionSection() {
  return (
    <>
      <Suspense fallback={pageFallback}>
        <Routes>
          <Route path="/" element={<TelevisionShowsPage />} />
          <Route path="/rank" element={<TelevisionShowsRankPage />} />
          <Route path="/shows/:id" element={<TelevisionShowDetailPage />} />
          <Route path="/shows/:id/rank" element={<TelevisionSeasonsRankPage />} />
          <Route path="/shows/:id/episodes" element={<TelevisionShowEpisodesPage />} />
          <Route path="/shows/:id/episodes/rank" element={<TelevisionShowEpisodesRankPage />} />
          <Route path="/seasons/:id" element={<TelevisionSeasonDetailPage />} />
          <Route path="/seasons/:id/rank" element={<TelevisionEpisodesRankPage />} />
          <Route path="/episodes/:id" element={<TelevisionEpisodeDetailPage />} />
          <Route path="/genres" element={<GenresPage domain={TELEVISION_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={TELEVISION_GENRES} />} />
          <Route path="/stats" element={<TelevisionStatsPage />} />
          <Route path="/scan" element={<TmdbPersonScanPage />} />
          <Route path="*" element={<LoadFailed what="page" error={null} />} />
        </Routes>
      </Suspense>
    </>
  );
}

function PeopleSection() {
  return (
    <>
      <Suspense fallback={pageFallback}>
        <Routes>
          <Route path="/" element={<PeoplePage />} />
          <Route path="/graph" element={<PeopleGraphPage />} />
          <Route path="/nationalities" element={<NationalitiesPage />} />
          <Route path="/:id" element={<PersonDetailPage />} />
          <Route path="*" element={<LoadFailed what="page" error={null} />} />
        </Routes>
      </Suspense>
    </>
  );
}

function GuildShell() {
  const canManage = useCan("manage_members");
  const canMerge = useCan("merge_in");
  return (
    <AppShell>
      <Suspense fallback={pageFallback}>
      <Routes>
        <Route path="/" element={<GuildHomePage />} />
        <Route path="members" element={canManage ? <GuildMembersPage /> : <Navigate to=".." replace />} />
        <Route path="merge" element={canMerge ? <MergeWizard /> : <Navigate to=".." replace />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="stats" element={<GuildStatsPage />} />
        <Route path="music/*" element={<MusicSection />} />
        <Route path="books/*" element={<BooksSection />} />
        <Route path="movies/*" element={<MoviesSection />} />
        <Route path="people/*" element={<PeopleSection />} />
        <Route path="television/*" element={<TelevisionSection />} />
        <Route path="games/*" element={<GamesSection />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
      </Suspense>
    </AppShell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Suspense fallback={pageFallback}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/guilds" element={<RequireAuth><GuildsPage /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><Suspense fallback={pageFallback}><AccountPage /></Suspense></RequireAuth>} />
        <Route
          path="/g/:guildId/*"
          element={<RequireAuth><GuildProvider><GuildShell /></GuildProvider></RequireAuth>}
        />
        <Route path="*" element={<Navigate to="/guilds" replace />} />
      </Routes>
      </Suspense>
    </AuthProvider>
  );
}
