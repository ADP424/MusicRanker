import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Album, ArtistDetail } from "../api/types";

function fmtRuntime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ArtistDetailDropdown({ artistId }: { artistId: number }) {
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
      {data.genres.length > 0 && (
        <div className="detail-tags">
          <span className="detail-label">Genres</span>
          <span>{data.genres.join(", ")}</span>
        </div>
      )}
      {data.collaborators.length > 0 && (
        <div className="detail-tags">
          <span className="detail-label">Collaborators</span>
          <span>{data.collaborators.join(", ")}</span>
        </div>
      )}
      {albums.length > 0 && (
        <ol className="dropdown-album-list">
          {albums.map((a) => (
            <li key={a.id} className="dropdown-album-row">
              <span className="dropdown-album-pos">#{a.position}</span>
              <span className="dropdown-album-name">
                {a.listen_link
                  ? <a href={a.listen_link} target="_blank" rel="noreferrer" className="album-name-link">{a.name}</a>
                  : a.name}
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
                          : ar.name}
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
