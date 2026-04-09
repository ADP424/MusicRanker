import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";

import { api } from "../api/client";
import type { PersonDetail } from "../api/types";

const ROLE_LABEL: Record<string, string> = {
  director:   "Director",
  composer:   "Composer",
  actor:      "Actor",
  lead_actor: "Lead Actor",
};

export function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const pid = Number(id);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["people", pid, "detail"],
    queryFn: () => api.get<PersonDetail>(`/persons/${pid}/detail`),
    enabled: !isNaN(pid),
  });

  if (isLoading) return <section><p>Loading…</p></section>;
  if (isError || !data) return <section><p>Person not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>{data.name}</h1>
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div>
            <span className="detail-label">Core nationality</span>
            <span>{data.core_nationality}</span>
          </div>
          {data.birth_nationality !== data.core_nationality && (
            <div>
              <span className="detail-label">Birth nationality</span>
              <span>{data.birth_nationality}</span>
            </div>
          )}
        </div>
        {data.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{data.notes}</span>
          </div>
        )}
      </div>

      {data.artists.length > 0 && (
        <>
          <h2>Artists</h2>
          <ul className="sortable plain-list">
            {data.artists.map((a) => (
              <li key={a.id} className="sortable-item">
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <Link className="name" to={`/music/artists/${a.id}`}>{a.name}</Link>
                  {a.discography_link && (
                    <a href={a.discography_link} target="_blank" rel="noreferrer" className="meta plain-link">
                      discography ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.movie_roles.length > 0 && (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Movie Roles</h2>
          <ul className="sortable plain-list">
            {data.movie_roles.map((r, i) => (
              <li key={i} className="sortable-item">
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <span className="name">{r.movie_name}</span>
                  <span className="meta">{ROLE_LABEL[r.role] ?? r.role}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.artists.length === 0 && data.movie_roles.length === 0 && (
        <p style={{ opacity: 0.5 }}>No linked artists or movie roles yet.</p>
      )}
    </section>
  );
}
