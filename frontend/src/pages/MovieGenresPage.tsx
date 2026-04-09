import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import { useMovieGenres } from "../api/hooks";
import type { MovieGenre } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MovieGenreForm } from "../components/MovieGenreForm";
import { MovieGenreTree } from "../components/MovieGenreTree";

type View = "list" | "tree";

export function MovieGenresPage() {
  const qc = useQueryClient();
  const { data: genres = [] } = useMovieGenres();
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<MovieGenre | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MovieGenre | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/movie-genres/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["movie-genres"] });
      const prev = qc.getQueryData<MovieGenre[]>(["movie-genres"]);
      qc.setQueryData<MovieGenre[]>(["movie-genres"], (old = []) => old.filter((g) => g.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => qc.setQueryData(["movie-genres"], ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["movie-genres"] }),
  });

  return (
    <section>
      <header className="page-head">
        <h1>Movie Genres</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <div className="view-toggle">
            <button
              className={view === "list" ? "view-toggle-active" : ""}
              onClick={() => setView("list")}
            >List</button>
            <button
              className={view === "tree" ? "view-toggle-active" : ""}
              onClick={() => setView("tree")}
            >Tree</button>
          </div>
          <button onClick={() => setEditing("new")}>+ Add</button>
        </div>
      </header>

      {view === "list" && (
        <ul className="plain-list">
          {genres.map((g) => (
            <li key={g.id} className="row">
              <span className="name">{g.name}</span>
              <span className="meta">
                {g.synonyms?.length ? `aka ${g.synonyms.join(", ")}` : ""}
              </span>
              <button className="icon" onClick={() => setEditing(g)}>✎</button>
              <button className="icon" onClick={() => setConfirmDelete(g)}>✕</button>
            </li>
          ))}
        </ul>
      )}

      {view === "tree" && (
        <MovieGenreTree genres={genres} onEdit={(g) => setEditing(g)} />
      )}

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
            <MovieGenreForm
              initial={editing === "new" ? undefined : editing}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
