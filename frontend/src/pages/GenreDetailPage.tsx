import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import { GenreForm } from "../components/GenreForm";
import type { Genre } from "../api/types";

export function GenreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const gid = Number(id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data: genre, isLoading, isError } = useQuery({
    queryKey: ["genres", gid],
    queryFn: () => api.get<Genre>(`/genres/${gid}`),
    enabled: !isNaN(gid),
  });

  const { data: parents = [] } = useQuery({
    queryKey: ["genres", gid, "parents"],
    queryFn: () => api.get<Genre[]>(`/genres/${gid}/parents`),
    enabled: !isNaN(gid),
  });

  const { data: children = [] } = useQuery({
    queryKey: ["genres", gid, "children"],
    queryFn: () => api.get<Genre[]>(`/genres/${gid}/children`),
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
                  <Link className="name" to={`/music/genres/${g.id}`}>{g.name}</Link>
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
                  <Link className="name" to={`/music/genres/${g.id}`}>{g.name}</Link>
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
              initial={genre}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: ["genres", gid] });
                qc.invalidateQueries({ queryKey: ["genres", gid, "parents"] });
                qc.invalidateQueries({ queryKey: ["genres", gid, "children"] });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
