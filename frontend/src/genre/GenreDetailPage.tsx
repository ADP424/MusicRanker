import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import { GenreForm } from "./GenreForm";
import type { GenreDomain, GenreLike } from "./config";

export function GenreDetailPage({ domain }: { domain: GenreDomain }) {
  const { id } = useParams<{ id: string }>();
  const gid = Number(id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data: genre, isLoading, isError } = useQuery({
    queryKey: [domain.key, gid],
    queryFn: () => api.get<GenreLike>(`${domain.apiBase}/${gid}`),
    enabled: !isNaN(gid),
  });

  const { data: parents = [] } = useQuery({
    queryKey: [domain.key, gid, "parents"],
    queryFn: () => api.get<GenreLike[]>(`${domain.apiBase}/${gid}/parents`),
    enabled: !isNaN(gid),
  });

  const { data: children = [] } = useQuery({
    queryKey: [domain.key, gid, "children"],
    queryFn: () => api.get<GenreLike[]>(`${domain.apiBase}/${gid}/children`),
    enabled: !isNaN(gid),
  });

  if (isLoading) return <section><p>Loading…</p></section>;
  if (isError || !genre) return <section><p>Genre not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>{genre.name}</h1>
        <button onClick={() => setEditing(true)}>✎ Edit</button>
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        {genre.synonyms && genre.synonyms.length > 0 && (
          <div className="detail-tags" style={{ marginBottom: "0.5rem" }}>
            <span className="detail-label">Also known as</span>
            <span>{genre.synonyms.join(", ")}</span>
          </div>
        )}
        {genre.notes && (
          <div className="detail-tags">
            <span className="detail-label">Notes</span>
            <span>{genre.notes}</span>
          </div>
        )}
        {!genre.notes && (!genre.synonyms || genre.synonyms.length === 0) && (
          <span style={{ opacity: 0.5 }}>No additional info.</span>
        )}
      </div>

      {parents.length > 0 && (
        <>
          <h2>Parent genres</h2>
          <ul className="sortable plain-list">
            {parents.map((g) => (
              <li key={g.id} className="sortable-item">
                <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                  <Link className="name" to={`${domain.routeBase}/${g.id}`}>{g.name}</Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {children.length > 0 && (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Subgenres</h2>
          <ul className="sortable plain-list">
            {children.map((g) => (
              <li key={g.id} className="sortable-item">
                <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                  <Link className="name" to={`${domain.routeBase}/${g.id}`}>{g.name}</Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {parents.length === 0 && children.length === 0 && (
        <p style={{ opacity: 0.5 }}>No parent or child genres.</p>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <GenreForm
              domain={domain}
              initial={genre}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: [domain.key, gid] });
                qc.invalidateQueries({ queryKey: [domain.key, gid, "parents"] });
                qc.invalidateQueries({ queryKey: [domain.key, gid, "children"] });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
