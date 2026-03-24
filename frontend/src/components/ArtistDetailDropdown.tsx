import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ArtistDetail } from "../api/types";

export function ArtistDetailDropdown({ artistId }: { artistId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["stats", "artist-detail", artistId],
    queryFn: () => api.get<ArtistDetail>(`/stats/artist-detail/${artistId}`),
  });

  if (isLoading) return <div className="artist-detail-dropdown">Loading…</div>;
  if (!data)     return null;

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
    </div>
  );
}
