import { NavLink, Route, Routes } from "react-router-dom";
import { usePrefetchAll, usePrefetchMovies, usePrefetchPeople } from "./api/hooks";
import { GenreDetailPage } from "./genre/GenreDetailPage";
import { GenresPage } from "./genre/GenresPage";
import { MOVIE_GENRES, MUSIC_GENRES } from "./genre/config";
import { AlbumDetailPage } from "./pages/AlbumDetailPage";
import { ArtistsPage } from "./pages/ArtistsPage";
import { ArtistDetailPage } from "./pages/ArtistDetailPage";
import { HomePage } from "./pages/HomePage";
import { MovieDetailPage } from "./pages/MovieDetailPage";
import { MoviePersonScanPage } from "./pages/MoviePersonScanPage";
import { MoviesPage } from "./pages/MoviesPage";
import { MovieStatsPage } from "./pages/MovieStatsPage";
import { PeopleGraphPage } from "./pages/PeopleGraphPage";
import { PeoplePage } from "./pages/PeoplePage";
import { PersonDetailPage } from "./pages/PersonDetailPage";
import { StatsPage } from "./pages/StatsPage";

function MusicSection() {
  usePrefetchAll();
  return (
    <>
      <nav>
        <NavLink to="/music">Artists</NavLink>
        <NavLink to="/music/genres">Genres</NavLink>
        <NavLink to="/music/stats">Stats</NavLink>
        <NavLink to="/" className="nav-home">← Home</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<ArtistsPage />} />
          <Route path="/genres" element={<GenresPage domain={MUSIC_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={MUSIC_GENRES} />} />
          <Route path="/artists/:id" element={<ArtistDetailPage />} />
          <Route path="/albums/:id" element={<AlbumDetailPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Routes>
      </main>
    </>
  );
}

function MoviesSection() {
  usePrefetchMovies();
  return (
    <>
      <nav>
        <NavLink to="/movies">Movies</NavLink>
        <NavLink to="/movies/genres">Genres</NavLink>
        <NavLink to="/movies/stats">Stats</NavLink>
        <NavLink to="/movies/tmdb-scan">TMDB Scan</NavLink>
        <NavLink to="/" className="nav-home">← Home</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<MoviesPage />} />
          <Route path="/genres" element={<GenresPage domain={MOVIE_GENRES} />} />
          <Route path="/genres/:id" element={<GenreDetailPage domain={MOVIE_GENRES} />} />
          <Route path="/stats" element={<MovieStatsPage />} />
          <Route path="/tmdb-scan" element={<MoviePersonScanPage />} />
          <Route path="/:id" element={<MovieDetailPage />} />
        </Routes>
      </main>
    </>
  );
}

function PeopleSection() {
  usePrefetchPeople();
  return (
    <>
      <nav>
        <NavLink to="/people">People</NavLink>
        <NavLink to="/people/graph">Graph</NavLink>
        <NavLink to="/" className="nav-home">← Home</NavLink>
      </nav>
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

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/music/*" element={<MusicSection />} />
      <Route path="/movies/*" element={<MoviesSection />} />
      <Route path="/people/*" element={<PeopleSection />} />
    </Routes>
  );
}
