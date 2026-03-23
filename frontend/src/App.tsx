import { NavLink, Route, Routes } from "react-router-dom";
import { ArtistsPage } from "./pages/ArtistsPage";
import { ArtistDetailPage } from "./pages/ArtistDetailPage";
import { GenresPage } from "./pages/GenresPage";

export function App() {
  return (
    <>
      <nav>
        <NavLink to="/">Artists</NavLink>
        <NavLink to="/genres">Genres</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<ArtistsPage />} />
          <Route path="/genres" element={<GenresPage />} />
          <Route path="/artists/:id" element={<ArtistDetailPage />} />
        </Routes>
      </main>
    </>
  );
}