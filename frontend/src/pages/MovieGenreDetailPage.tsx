import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import type { MovieGenre } from "../api/types";

export function MovieGenreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const gid = Number(id);

  const { data: genre, isLoading, isError } = useQuery({
    queryKey: ["movie-genres", gid],
    queryFn: () => api.get<MovieGenre>(`/movie-genres/${gid}`),
    enabled: !isNaN(gid),
  });

  const { data: parents = [] } = useQuery({
    queryKey: ["movie-genres", gid, "parents"],
    queryFn: () => api.get<MovieGenre[]>(`/movie-genres/${gid}/parents`),
    enabled: !isNaN(gid),
  });

  const { data: children = [] } = useQuery({
    queryKey: ["movie-genres", gid, "children"],
    queryFn: () => api.get<MovieGenre[]>(`/movie-genres/${gid}/children`),
    enabled: !isNaN(gid),
  });

  if (isLoading) return <section><p>Loading…</p></section>;
  if (isError || !genre) return <section><p>Genre not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>{genre.name}</h1>
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
                  <Link className="name" to={`/movies/genres/${g.id}`}>{g.name}</Link>
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
                  <Link className="name" to={`/movies/genres/${g.id}`}>{g.name}</Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {parents.length === 0 && children.length === 0 && (
        <p style={{ opacity: 0.5 }}>No parent or child genres.</p>
      )}
    </section>
  );
}
