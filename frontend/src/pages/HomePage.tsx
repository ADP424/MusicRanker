import { useNavigate } from "react-router-dom";

export function HomePage() {
  const navigate = useNavigate();
  return (
    <div className="home-page">
      <h1 className="home-title">Ranker</h1>
      <div className="home-choices">
        <button className="home-choice" onClick={() => navigate("/music")}>
          <span className="home-choice-icon">🎵</span>
          <span className="home-choice-label">Music</span>
        </button>
        <button className="home-choice" onClick={() => navigate("/movies")}>
          <span className="home-choice-icon">🎬</span>
          <span className="home-choice-label">Movies</span>
        </button>
        <button className="home-choice" onClick={() => navigate("/people")}>
          <span className="home-choice-icon">👤</span>
          <span className="home-choice-label">People</span>
        </button>
      </div>
    </div>
  );
}
