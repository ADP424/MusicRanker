import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useMovieGenres, usePeople } from "../api/hooks";
import type { CastRole, Movie, MovieGenre, MoviePersonRef, Person } from "../api/types";
import { CAST_ROLES, CAST_ROLE_LABELS } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MovieForm } from "../components/MovieForm";
import { MovieGenreChooser } from "../components/MovieGenreChooser";
import { PersonForm } from "../components/PersonForm";

function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m > 0 ? `${m}m` : ""}`.trim();
  return `${m}m`;
}

// ── People section ─────────────────────────────────────────────────────────────

function MoviePeopleSection({ movie }: { movie: Movie }) {
  const qc = useQueryClient();
  const { data: allPeople = [] } = usePeople();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<MoviePersonRef | null>(null);
  const [castSearch, setCastSearch] = useState("");
  const [searchField, setSearchField] = useState<"all" | "person" | "artist" | "movie">("all");
  const [addRole, setAddRole] = useState<CastRole>("director");
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  // Track the current set of (personId, role) links as "id:role" keys
  const [castKeys, setCastKeys] = useState<Set<string>>(
    () => new Set(movie.persons.map((p) => `${p.id}:${p.role}`))
  );

  useEffect(() => {
    setCastKeys(new Set(movie.persons.map((p) => `${p.id}:${p.role}`)));
  }, [movie.persons]);

  const filteredPeople = useMemo(() => {
    const q = castSearch.trim().toLowerCase();
    if (!q) return allPeople;
    return allPeople.filter((p) => {
      if (searchField === "person") return p.name.toLowerCase().includes(q);
      if (searchField === "artist") return p.artist_names.some((n) => n.toLowerCase().includes(q));
      if (searchField === "movie") return p.movie_names.some((n) => n.toLowerCase().includes(q));
      return (
        p.name.toLowerCase().includes(q) ||
        p.artist_names.some((n) => n.toLowerCase().includes(q)) ||
        p.movie_names.some((n) => n.toLowerCase().includes(q))
      );
    });
  }, [castSearch, searchField, allPeople]);

  const link = useMutation({
    mutationFn: ({ personId, role }: { personId: number; role: CastRole }) =>
      api.put(`/movies/${movie.id}/persons/${personId}/${role}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movies", movie.id] });
      qc.invalidateQueries({ queryKey: ["movies", "ranked"] });
    },
  });

  const unlink = useMutation({
    mutationFn: ({ personId, role }: { personId: number; role: CastRole }) =>
      api.delete(`/movies/${movie.id}/persons/${personId}/${role}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movies", movie.id] });
      qc.invalidateQueries({ queryKey: ["movies", "ranked"] });
    },
  });

  function toggleLink(person: Person, role: CastRole) {
    const key = `${person.id}:${role}`;
    if (castKeys.has(key)) {
      const ref = movie.persons.find((p) => p.id === person.id && p.role === role);
      if (ref) setConfirmUnlink(ref);
    } else {
      link.mutate({ personId: person.id, role });
      setCastKeys((prev) => new Set([...prev, key]));
    }
  }

  // Group persons by role for display
  const byRole: Record<string, MoviePersonRef[]> = {};
  for (const p of movie.persons) {
    if (!byRole[p.role]) byRole[p.role] = [];
    byRole[p.role].push(p);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>People</h2>
        <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
          {editing ? "Done" : "Edit"}
        </button>
      </header>

      {editing && (
        <>
          {dupWarning && (
            <div className="dup-warning">
              <span>{dupWarning}</span>
              <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
            </div>
          )}

          {/* Role selector */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            {CAST_ROLES.map((role) => (
              <label
                key={role}
                className={`chip${addRole === role ? " chip-active" : ""}`}
                onClick={() => setAddRole(role)}
                style={{ cursor: "pointer" }}
              >
                {CAST_ROLE_LABELS[role]}
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem", flexWrap: "wrap" }}>
            {(["all", "person", "artist", "movie"] as const).map((f) => (
              <label
                key={f}
                className={`chip${searchField === f ? " chip-active" : ""}`}
                onClick={() => setSearchField(f)}
                style={{ cursor: "pointer" }}
              >
                {f === "all" ? "All" : f === "person" ? "Person" : f === "artist" ? "Artist" : "Movie"}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
            <input
              className="genre-search"
              type="search"
              placeholder={
                searchField === "person" ? "Search by person name…" :
                searchField === "artist" ? "Search by artist name…" :
                searchField === "movie" ? "Search by movie name…" :
                "Search people, artists, movies…"
              }
              value={castSearch}
              onChange={(e) => setCastSearch(e.target.value)}
              style={{ margin: 0, flex: 1 }}
            />
            <button style={{ whiteSpace: "nowrap" }} onClick={() => setCreatingPerson(true)}>
              + New Person
            </button>
          </div>

          <div className="chips" style={{ marginBottom: "0.75rem" }}>
            {filteredPeople.map((p) => {
              const key = `${p.id}:${addRole}`;
              return (
                <label key={p.id} className="chip">
                  <input
                    type="checkbox"
                    checked={castKeys.has(key)}
                    onChange={() => toggleLink(p, addRole)}
                  />
                  {p.name}
                </label>
              );
            })}
          </div>
        </>
      )}

      {movie.persons.length > 0 ? (
        CAST_ROLES.filter((r) => byRole[r]?.length).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>
              {CAST_ROLE_LABELS[role]}
            </div>
            <ul className="sortable plain-list">
              {byRole[role].map((p) => (
                <li key={`${p.id}:${p.role}`} className="sortable-item">
                  <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                    <Link className="name" to={`/people/${p.id}`}>{p.name}</Link>
                    {editing && (
                      <button
                        className="icon"
                        title="Remove"
                        onClick={() => setConfirmUnlink(p)}
                      >✕</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No people linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove "${confirmUnlink.name}" (${CAST_ROLE_LABELS[confirmUnlink.role]}) from this movie?`}
          onConfirm={() => {
            unlink.mutate({ personId: confirmUnlink.id, role: confirmUnlink.role });
            setCastKeys((prev) => {
              const next = new Set(prev);
              next.delete(`${confirmUnlink!.id}:${confirmUnlink!.role}`);
              return next;
            });
            setConfirmUnlink(null);
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}

      {creatingPerson && (
        <div className="modal-backdrop" onClick={() => setCreatingPerson(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PersonForm
              onClose={(savedName, savedId) => {
                setCreatingPerson(false);
                if (savedId != null) {
                  qc.invalidateQueries({ queryKey: ["people"] });
                  link.mutate({ personId: savedId, role: addRole });
                  setCastKeys((prev) => new Set([...prev, `${savedId}:${addRole}`]));
                }
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = allPeople.filter((p) => p.name.toLowerCase() === nameLower && p.id !== savedId);
                  if (dups.length > 0) setDupWarning(`Warning: another person named "${savedName}" already exists.`);
                }
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// ── Genres section ─────────────────────────────────────────────────────────────

function MovieGenresSection({ movie }: { movie: Movie }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<MovieGenre | null>(null);
  const { data: allGenres = [] } = useMovieGenres();

  const { data: movieGenres = [] } = useQuery({
    queryKey: ["movies", movie.id, "genres"],
    queryFn: () => api.get<MovieGenre[]>(`/movies/${movie.id}/genres`),
  });

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setGenreIds(new Set(movieGenres.map((g) => g.id)));
  }, [movieGenres]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`/movies/${movie.id}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movies", movie.id, "genres"] });
      qc.invalidateQueries({ queryKey: ["movies", movie.id] });
    },
  });

  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`/movies/${movie.id}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movies", movie.id, "genres"] });
      qc.invalidateQueries({ queryKey: ["movies", movie.id] });
    },
  });

  function handleChange(next: Set<number>) {
    const prev = genreIds;
    for (const id of next) {
      if (!prev.has(id)) addGenre.mutate(id);
    }
    for (const id of prev) {
      if (!next.has(id)) {
        const g = genreMap[id];
        if (g) {
          setConfirmUnlink(g);
          return;
        }
      }
    }
    setGenreIds(next);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Genres</h2>
        <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
          {editing ? "Done" : "Edit"}
        </button>
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
          <MovieGenreChooser selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {movieGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {movieGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/movies/genres/${g.id}`}>{g.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No genres linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove genre "${confirmUnlink.name}" from this movie?`}
          onConfirm={() => {
            removeGenre.mutate(confirmUnlink.id);
            setGenreIds((prev) => {
              const next = new Set(prev);
              next.delete(confirmUnlink!.id);
              return next;
            });
            setConfirmUnlink(null);
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function MovieDetailPage() {
  const { id } = useParams<{ id: string }>();
  const movieId = Number(id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data: movie, isLoading, isError } = useQuery({
    queryKey: ["movies", movieId],
    queryFn: () => api.get<Movie>(`/movies/${movieId}`),
    enabled: !isNaN(movieId),
  });

  if (isLoading) return <section><p>Loading…</p></section>;
  if (isError || !movie) return <section><p>Movie not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>
          {movie.name}
          {movie.watch_link && (
            <> <a href={movie.watch_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.6em", opacity: 0.7, fontWeight: "normal", color: "inherit" }}>(link)</a></>
          )}
        </h1>
        <button onClick={() => setEditing(true)}>✎ Edit</button>
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div>
            <span className="detail-label">Release year</span>
            <span>{movie.release_year}</span>
          </div>
          <div>
            <span className="detail-label">Runtime</span>
            <span>{fmtRuntime(movie.runtime_minutes)}</span>
          </div>
          <div>
            <span className="detail-label">Watches</span>
            <span>{movie.watches}</span>
          </div>
          {movie.soundtrack_albums.length > 0 && (
            <div>
              <span className="detail-label">Soundtrack</span>
              <span>
                {movie.soundtrack_albums.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ", "}
                    <Link to={`/music/albums/${a.id}`}>{a.name}</Link>
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
        {movie.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{movie.notes}</span>
          </div>
        )}
      </div>

      <MoviePeopleSection movie={movie} />
      <MovieGenresSection movie={movie} />

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <MovieForm
              initial={movie}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: ["movies", movieId] });
                qc.invalidateQueries({ queryKey: ["movies", "ranked"] });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
