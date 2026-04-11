import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useGenres } from "../api/hooks";
import type { Album, ArtistDetail } from "../api/types";

function fmtRuntime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ArtistDetailDropdown({ artistId, primaryGenreId, discographyLink }: { artistId: number; primaryGenreId: number | null; discographyLink?: string }) {
  const { data: genreList = [] } = useGenres();
  const primaryGenre = primaryGenreId != null ? genreList.find((g) => g.id === primaryGenreId) : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["stats", "artist-detail", artistId],
    queryFn: () => api.get<ArtistDetail>(`/stats/artist-detail/${artistId}`),
  });

  const { data: albums = [] } = useQuery({
    queryKey: ["artists", artistId, "albums"],
    queryFn: () => api.get<Album[]>(`/artists/${artistId}/albums`),
  });

  if (isLoading) return <div className="artist-detail-dropdown">Loading…</div>;
  if (!data) return null;

  return (
    <div className="artist-detail-dropdown">
      <div className="artist-detail-grid">
        <div><span className="detail-label">Albums</span><span>{data.album_count}</span></div>
        <div><span className="detail-label">Total Runtime</span><span>{data.total_runtime}</span></div>
        <div><span className="detail-label">Listened Runtime</span><span>{data.total_listened_runtime}</span></div>
        <div><span className="detail-label">Avg Runtime</span><span>{data.avg_runtime}</span></div>
        <div><span className="detail-label">Avg Album Score</span><span>{data.avg_album_score?.toFixed(4) ?? "—"}</span></div>
      </div>
      {discographyLink && (
        <div className="detail-tags">
          <span className="detail-label">Discography</span>
          <a href={discographyLink} target="_blank" rel="noreferrer" className="plain-link">Link</a>
        </div>
      )}
      {primaryGenre && (
        <div className="detail-tags">
          <span className="detail-label">Primary Genre</span>
          <Link to={`/music/genres/${primaryGenre.id}`} className="plain-link">{primaryGenre.name}</Link>
        </div>
      )}
      {data.genres.length > 0 && (
        <div className="detail-tags">
          <span className="detail-label">Genres</span>
          <span>
            {data.genres.map((g, i) => (
              <span key={g.id}>{i > 0 && ", "}<Link to={`/music/genres/${g.id}`} className="plain-link">{g.name}</Link></span>
            ))}
          </span>
        </div>
      )}
      {data.members.length > 0 && (
        <div className="detail-tags">
          <span className="detail-label">Members</span>
          <span>
            {data.members.map((p, i) => (
              <span key={p.id}>{i > 0 && ", "}<Link to={`/people/${p.id}`} className="plain-link">{p.name}</Link></span>
            ))}
          </span>
        </div>
      )}
      {data.collaborators.length > 0 && (
        <div className="detail-tags">
          <span className="detail-label">Collaborators</span>
          <span>
            {data.collaborators.map((a, i) => (
              <span key={a.id}>{i > 0 && ", "}<Link to={`/music/artists/${a.id}`} className="plain-link">{a.name}</Link></span>
            ))}
          </span>
        </div>
      )}
      {albums.length > 0 && (
        <ol className="dropdown-album-list">
          {albums.map((a) => (
            <li key={a.id} className="dropdown-album-row">
              <span className="dropdown-album-pos">#{a.position}</span>
              <span className="dropdown-album-name">
                <Link to={`/music/albums/${a.id}`} className="plain-link">{a.name}</Link>
                {a.listen_link && (
                  <> <a href={a.listen_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.85em", opacity: 0.7, color: "inherit" }}>(link)</a></>
                )}
                {a.alias && (
                  <span className="dropdown-album-alias">
                    {" ("}
                    {a.alias_link
                      ? <a href={a.alias_link} target="_blank" rel="noreferrer" className="plain-link">{a.alias}</a>
                      : a.alias}
                    {")"}
                  </span>
                )}
                {a.artists.length > 1 && (
                  <span className="dropdown-album-collabs">
                    {" "}[{a.artists.map((ar, i) => (
                      <span key={ar.id}>
                        {i > 0 && " / "}
                        {ar.discography_link
                          ? <a href={ar.discography_link} target="_blank" rel="noreferrer" className="plain-link">{ar.name}</a>
                          : <Link to={`/music/artists/${ar.id}`} className="plain-link">{ar.name}</Link>}
                      </span>
                    ))}]
                  </span>
                )}
              </span>
              <span className="dropdown-album-meta">
                {a.release_year} · {fmtRuntime(a.runtime_seconds)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
