import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { ActivityIndicator, LoadingState } from "./components/Spinner";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { GuildProvider, useCan, useGuild } from "./guild/GuildProvider";
import { GuildHomePage } from "./guild/GuildHomePage";
import { GuildMembersPage } from "./guild/GuildMembersPage";
import { GuildsPage } from "./guild/GuildsPage";
import { MergeWizard } from "./guild/MergeWizard";
import { AlbumDetailPage } from "./pages/AlbumDetailPage";
import { ArtistDetailPage } from "./pages/ArtistDetailPage";
import { ArtistsPage } from "./pages/ArtistsPage";
import { BookDetailPage } from "./pages/BookDetailPage";
import { BooksPage } from "./pages/BooksPage";
import { BookStatsPage } from "./pages/BookStatsPage";
import { GameDetailPage } from "./pages/GameDetailPage";
import { GamesPage } from "./pages/GamesPage";
import { MovieDetailPage } from "./pages/MovieDetailPage";
import { MoviePersonScanPage } from "./pages/MoviePersonScanPage";
import { GamePersonScanPage, TelevisionPersonScanPage } from "./pages/PersonScanPage";
import { MoviesPage } from "./pages/MoviesPage";
import { GameStatsPage } from "./pages/GameStatsPage";
import { MovieStatsPage } from "./pages/MovieStatsPage";
import { PeopleGraphPage } from "./pages/PeopleGraphPage";
import { PeoplePage } from "./pages/PeoplePage";
import { PersonDetailPage } from "./pages/PersonDetailPage";
import { StatsPage } from "./pages/StatsPage";
import { TelevisionEpisodeDetailPage } from "./pages/TelevisionEpisodeDetailPage";
import { TelevisionSeasonDetailPage } from "./pages/TelevisionSeasonDetailPage";
import { TelevisionShowDetailPage } from "./pages/TelevisionShowDetailPage";
import { TelevisionShowsPage } from "./pages/TelevisionShowsPage";
import { TelevisionStatsPage } from "./pages/TelevisionStatsPage";
import { GenreDetailPage } from "./genre/GenreDetailPage";
import { GenresPage } from "./genre/GenresPage";
import { BOOK_GENRES, GAME_GENRES, GAME_PLATFORMS, MOVIE_GENRES, MUSIC_GENRES, TELEVISION_GENRES } from "./genre/config";
import {
  ArtistAlbumsRankPage, ArtistsRankPage, BooksRankPage, GamesRankPage, MoviesRankPage,
  TelevisionEpisodesRankPage, TelevisionSeasonsRankPage, TelevisionShowsRankPage,
} from "./rank/pages";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <LoadingState label="Checking your session…" />;
  return me ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Shared chrome: the section's own tabs. The global TopBar already covers
 * getting back to the guild home / all guilds / sign-out, so this only needs
 * the tabs themselves now. */
function SectionNav({ links }: { links: [to: string, label: string, end?: boolean][] }) {
  const guild = useGuild();
  return (
    <nav>
      {links.map(([to, label, end]) => (
        <NavLink key={to} to={`/g/${guild.id}/${to}`} end={end}>{label}</NavLink>
      ))}
    </nav>
  );
}

function MusicSection() {
  return (
    <>
      <SectionNav links={[["music", "Artists", true], ["music/rank", "Rank"], ["music/genres", "Genres"], ["music/stats", "Stats"]]} />
      <main>
        <Routes>
          <Route path="/" element={<ArtistsPage />} />
          <Route path="/rank" element={<ArtistsRankPage />} />
          <Route path="/artists/:id" element={<ArtistDetailPage />} />
          <Route path="/artists/:id/rank" element={<ArtistAlbumsRankPage />} />
          <Route path="/albums/:id" element={<AlbumDetailPage />} />
          <Route path="/genres" element={<GenresPage domain={MUSIC_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={MUSIC_GENRES} />} />
          <Route path="/stats" element={<StatsPage />} />
        </Routes>
      </main>
    </>
  );
}

function BooksSection() {
  return (
    <>
      <SectionNav links={[["books", "Books", true], ["books/rank", "Rank"], ["books/genres", "Genres"], ["books/stats", "Stats"]]} />
      <main>
        <Routes>
          <Route path="/" element={<BooksPage />} />
          <Route path="/rank" element={<BooksRankPage />} />
          <Route path="/:id" element={<BookDetailPage />} />
          <Route path="/genres" element={<GenresPage domain={BOOK_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={BOOK_GENRES} />} />
          <Route path="/stats" element={<BookStatsPage />} />
        </Routes>
      </main>
    </>
  );
}

function MoviesSection() {
  return (
    <>
      <SectionNav links={[["movies", "Movies", true], ["movies/rank", "Rank"], ["movies/genres", "Genres"], ["movies/stats", "Stats"], ["movies/scan", "Scan"]]} />
      <main>
        <Routes>
          <Route path="/" element={<MoviesPage />} />
          <Route path="/rank" element={<MoviesRankPage />} />
          <Route path="/:id" element={<MovieDetailPage />} />
          <Route path="/genres" element={<GenresPage domain={MOVIE_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={MOVIE_GENRES} />} />
          <Route path="/stats" element={<MovieStatsPage />} />
          <Route path="/scan" element={<MoviePersonScanPage />} />
        </Routes>
      </main>
    </>
  );
}

function GamesSection() {
  return (
    <>
      <SectionNav links={[["games", "Games", true], ["games/rank", "Rank"], ["games/genres", "Genres"], ["games/platforms", "Platforms"], ["games/stats", "Stats"], ["games/scan", "Scan"]]} />
      <main>
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
        </Routes>
      </main>
    </>
  );
}

function TelevisionSection() {
  return (
    <>
      <SectionNav links={[["television", "Shows", true], ["television/rank", "Rank"], ["television/genres", "Genres"], ["television/stats", "Stats"], ["television/scan", "Scan"]]} />
      <main>
        <Routes>
          <Route path="/" element={<TelevisionShowsPage />} />
          <Route path="/rank" element={<TelevisionShowsRankPage />} />
          <Route path="/shows/:id" element={<TelevisionShowDetailPage />} />
          <Route path="/shows/:id/rank" element={<TelevisionSeasonsRankPage />} />
          <Route path="/seasons/:id" element={<TelevisionSeasonDetailPage />} />
          <Route path="/seasons/:id/rank" element={<TelevisionEpisodesRankPage />} />
          <Route path="/episodes/:id" element={<TelevisionEpisodeDetailPage />} />
          <Route path="/genres" element={<GenresPage domain={TELEVISION_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={TELEVISION_GENRES} />} />
          <Route path="/stats" element={<TelevisionStatsPage />} />
          <Route path="/scan" element={<TelevisionPersonScanPage />} />
        </Routes>
      </main>
    </>
  );
}

function PeopleSection() {
  return (
    <>
      <SectionNav links={[["people", "People", true], ["people/graph", "Graph"]]} />
      <main>
        <Routes>
          <Route path="/" element={<PeoplePage />} />
          <Route path="/graph" element={<PeopleGraphPage />} />
          <Route path="/:id" element={<PersonDetailPage />} />
        </Routes>
      </main>
    </>
  );
}

/** Always-visible top bar inside a guild: identity, guild switcher, sign-out.
 * Without this, the only way to reach "All guilds" or sign out was to already
 * be on the guild home page — everywhere else (an artist page, a movie's
 * detail view, three levels deep) was a dead end. */
function TopBar() {
  const guild = useGuild();
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="top-bar">
      <Link to="." className="top-bar-guild">{guild.name}</Link>
      <div className="top-bar-actions">
        <ActivityIndicator />
        <Link to="/guilds" className="top-bar-link">All guilds</Link>
        <span className="meta">{me?.username}</span>
        <button className="top-bar-link" onClick={() => logout().then(() => navigate("/login"))}>Sign out</button>
      </div>
    </div>
  );
}

function GuildShell() {
  const canManage = useCan("manage_members");
  const canMerge = useCan("merge_in");
  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/" element={<GuildHomePage />} />
        <Route path="members" element={canManage ? <GuildMembersPage /> : <Navigate to=".." replace />} />
        <Route path="merge" element={canMerge ? <MergeWizard /> : <Navigate to=".." replace />} />
        <Route path="music/*" element={<MusicSection />} />
        <Route path="books/*" element={<BooksSection />} />
        <Route path="movies/*" element={<MoviesSection />} />
        <Route path="people/*" element={<PeopleSection />} />
        <Route path="television/*" element={<TelevisionSection />} />
        <Route path="games/*" element={<GamesSection />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/guilds" element={<RequireAuth><GuildsPage /></RequireAuth>} />
        <Route
          path="/g/:guildId/*"
          element={<RequireAuth><GuildProvider><GuildShell /></GuildProvider></RequireAuth>}
        />
        <Route path="*" element={<Navigate to="/guilds" replace />} />
      </Routes>
    </AuthProvider>
  );
}
