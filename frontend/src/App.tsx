import { NavLink, Route, Routes } from "react-router-dom";
import { usePrefetchAll } from "./api/hooks";
import { ArtistsPage } from "./pages/ArtistsPage";
import { ArtistDetailPage } from "./pages/ArtistDetailPage";
import { GenresPage } from "./pages/GenresPage";
import { StatsPage } from "./pages/StatsPage";

export function App() {
  usePrefetchAll();
  return (
    <>
      <nav>
        <NavLink to="/">Artists</NavLink>
        <NavLink to="/genres">Genres</NavLink>
        <NavLink to="/stats">Stats</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<ArtistsPage />} />
          <Route path="/genres" element={<GenresPage />} />
          <Route path="/artists/:id" element={<ArtistDetailPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Routes>
      </main>
    </>
  );
}