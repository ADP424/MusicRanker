import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import { useGenres } from "../api/hooks";
import type { Genre } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GenreForm } from "../components/GenreForm";
import { GenreTree } from "../components/GenreTree";

type View = "list" | "tree";

export function GenresPage() {
  const qc = useQueryClient();
  const { data: genres = [] } = useGenres();
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<Genre | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Genre | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/genres/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["genres"] }),
  });

  return (
    <section>
      <header className="page-head">
        <h1>Genres</h1>
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
        <GenreTree genres={genres} onEdit={(g) => setEditing(g)} />
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
            <GenreForm
              initial={editing === "new" ? undefined : editing}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
