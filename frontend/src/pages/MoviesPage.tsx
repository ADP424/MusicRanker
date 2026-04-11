import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { useMovieGenres, useMoviesRanked, usePeople } from "../api/hooks";
import type { Movie, MoviePersonRef } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MovieForm } from "../components/MovieForm";
import { SortableList } from "../components/SortableList";

type MovieSearchBy = "all" | "title" | "genre" | "person";

function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`;
  return `${m}m`;
}

const ROLE_LABEL: Record<string, string> = {
  director: "Director",
  composer: "Composer",
  lead_actor: "Lead Actor",
  actor: "Actor",
  cameo_actor: "Cameo Actor",
};

export function MoviesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ movie: Movie } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Movie | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<MovieSearchBy>("all");
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const { data: movies = [] } = useMoviesRanked();
  const { data: genres = [] } = useMovieGenres();
  const { data: people = [] } = usePeople();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));

  const visibleMovies = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return movies;

    const matchingIds = new Set<number>();

    if (searchBy === "title" || searchBy === "all") {
      for (const m of movies) {
        if (m.name.toLowerCase().includes(needle)) matchingIds.add(m.id);
      }
    }

    if (searchBy === "genre" || searchBy === "all") {
      const matchingGenreIds = new Set(
        genres
          .filter((g) =>
            g.name.toLowerCase().includes(needle) ||
            g.synonyms?.some((s) => s.toLowerCase().includes(needle))
          )
          .map((g) => g.id)
      );
      for (const m of movies) {
        if (m.genre_ids.some((gid) => matchingGenreIds.has(gid))) matchingIds.add(m.id);
      }
    }

    if (searchBy === "person" || searchBy === "all") {
      const matchingPersonIds = new Set(
        people.filter((p) => p.name.toLowerCase().includes(needle)).map((p) => p.id)
      );
      for (const m of movies) {
        if (m.persons.some((p) => matchingPersonIds.has(p.id))) matchingIds.add(m.id);
      }
    }

    return movies.filter((m) => matchingIds.has(m.id));
  }, [searchQ, searchBy, movies, genres, people]);

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) =>
      api.put(`/movies/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["movies", "ranked"] }),
  });

  const adjustWatches = useMutation({
    mutationFn: ({ movieId, delta }: { movieId: number; delta: 1 | -1 }) => {
      const movie = movies.find((m) => m.id === movieId)!;
      return api.patch<Movie>(`/movies/${movieId}`, { watches: movie.watches + delta });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movies", "ranked"] });
      qc.invalidateQueries({ queryKey: ["movies", "index"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/movies/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["movies", "ranked"] });
      const prev = qc.getQueryData<Movie[]>(["movies", "ranked"]);
      qc.setQueryData<Movie[]>(["movies", "ranked"], (old = []) => old.filter((m) => m.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => qc.setQueryData(["movies", "ranked"], ctx?.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["movies", "ranked"] });
      qc.invalidateQueries({ queryKey: ["movies", "index"] });
    },
  });

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const allExpanded = movies.length > 0 && expandedIds.size === movies.length;

  // Group persons by role for display
  function groupPersons(persons: MoviePersonRef[]) {
    const byRole: Record<string, MoviePersonRef[]> = {};
    for (const p of persons) {
      if (!byRole[p.role]) byRole[p.role] = [];
      byRole[p.role].push(p);
    }
    return byRole;
  }

  return (
    <section>
      <header className="page-head">
        <h1>Movies</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => {
            if (allExpanded) setExpandedIds(new Set());
            else setExpandedIds(new Set(movies.map((m) => m.id)));
          }}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          <button onClick={() => setEditing("new")}>+ Add</button>
        </div>
      </header>

      {dupWarning && (
        <div className="dup-warning">
          <span>{dupWarning}</span>
          <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
        </div>
      )}

      <div className="search-bar">
        <input
          type="search"
          placeholder="Search…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <div className="search-by-chips">
          {(["all", "title", "genre", "person"] as MovieSearchBy[]).map((opt) => (
            <button
              key={opt}
              className={`chip${searchBy === opt ? " chip-active" : ""}`}
              onClick={() => setSearchBy(opt)}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
        {searchQ.trim().length > 0 && (
          <span className="search-count">{visibleMovies.length} result{visibleMovies.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <SortableList
        items={visibleMovies}
        rowClassName="album-row"
        onReorder={(next) => qc.setQueryData(["movies", "ranked"], next)}
        onMove={(id, position) => move.mutate({ id, position })}
        disableDrag={searchQ.trim().length > 0}
        renderDetail={(m) =>
          expandedIds.has(m.id) ? (
            <div className="album-detail-dropdown">
              {m.persons.length > 0 && (() => {
                const byRole = groupPersons(m.persons);
                const roleOrder = ["director", "composer", "lead_actor", "actor", "cameo_actor"];
                return roleOrder
                  .filter((r) => byRole[r]?.length)
                  .map((role) => (
                    <div key={role} className="album-detail-row">
                      <span className="detail-label">{ROLE_LABEL[role] ?? role}</span>
                      <span>
                        {byRole[role].map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && ", "}
                            <Link className="plain-link" to={`/people/${p.id}`}>{p.name}</Link>
                          </span>
                        ))}
                      </span>
                    </div>
                  ));
              })()}
              {m.genre_ids.length > 0 && (
                <div className="album-detail-row">
                  <span className="detail-label">Genres</span>
                  <span>
                    {m.genre_ids
                      .filter((id) => genreMap[id])
                      .sort((a, b) => genreMap[a].localeCompare(genreMap[b]))
                      .map((id, i) => (
                        <span key={id}>
                          {i > 0 && ", "}
                          <Link className="plain-link" to={`/movies/genres/${id}`}>{genreMap[id]}</Link>
                        </span>
                      ))}
                  </span>
                </div>
              )}
              {m.soundtrack_albums.length > 0 && (
                <div className="album-detail-row">
                  <span className="detail-label">Soundtrack</span>
                  <span>
                    {m.soundtrack_albums.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && ", "}
                        <Link to={`/music/albums/${a.id}`}>{a.name}</Link>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {m.watch_link && (
                <div className="album-detail-row">
                  <span className="detail-label">Watch</span>
                  <a href={m.watch_link} target="_blank" rel="noreferrer">{m.watch_link}</a>
                </div>
              )}
              {m.notes && (
                <div className="album-detail-row">
                  <span className="detail-label">Notes</span>
                  <span>{m.notes}</span>
                </div>
              )}
              {m.persons.length === 0 && !m.watch_link && !m.notes && m.genre_ids.length === 0 && m.soundtrack_albums.length === 0 && (
                <span style={{ opacity: 0.5 }}>No extra info.</span>
              )}
            </div>
          ) : null
        }
        render={(m) => (
          <>
            <span className="name">
              <Link to={`/movies/${m.id}`} className="plain-link">{m.name}</Link>
              {m.watch_link && (
                <> <a href={m.watch_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.85em", opacity: 0.7, color: "inherit" }}>(link)</a></>
              )}
            </span>
            <span className="meta">
              {m.release_year} · {fmtRuntime(m.runtime_minutes)}
              {m.persons.filter((p) => p.role === "director").length > 0 && (
                <> · {m.persons.filter((p) => p.role === "director").map((p) => p.name).join(", ")}</>
              )}
            </span>
            <span className="listens-ctrl">
              <button
                className="icon"
                title="Remove one watch"
                disabled={m.watches <= 1}
                onClick={() => adjustWatches.mutate({ movieId: m.id, delta: -1 })}
              >−</button>
              <span className="listens-count">{m.watches}×</span>
              <button
                className="icon"
                title="Add one watch"
                onClick={() => adjustWatches.mutate({ movieId: m.id, delta: 1 })}
              >+</button>
            </span>
            <button className="icon" title="Show details" onClick={() => toggleExpand(m.id)}>
              {expandedIds.has(m.id) ? "▲" : "▼"}
            </button>
            <button className="icon" onClick={() => setEditing({ movie: m })}>✎</button>
            <button className="icon" onClick={() => setConfirmDelete(m)}>✕</button>
          </>
        )}
      />

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}"?`}
          onConfirm={() => {
            remove.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <MovieForm
              initial={editing === "new" ? undefined : editing.movie}
              onClose={(savedName, savedId) => {
                setEditing(null);
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = movies.filter(
                    (m) => m.name.toLowerCase() === nameLower && m.id !== savedId
                  );
                  if (dups.length > 0) setDupWarning(`Warning: another movie named "${savedName}" already exists.`);
                }
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
