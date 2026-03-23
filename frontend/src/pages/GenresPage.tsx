import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import { useGenres } from "../api/hooks";
import type { Genre } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GenreForm } from "../components/GenreForm";

export function GenresPage() {
  const qc = useQueryClient();
  const { data: genres = [] } = useGenres();
  const [editing, setEditing] = useState<{ genre: Genre; top: number } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Genre | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/genres/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["genres"] }),
  });

  return (
    <section>
      <header className="page-head">
        <h1>Genres</h1>
        <button onClick={() => setEditing("new")}>+ Add</button>
      </header>

      <ul className="plain-list">
        {genres.map((g) => (
          <li key={g.id} className="row">
            <span className="name">{g.name}</span>
            <span className="meta">
              {g.synonyms?.length ? `aka ${g.synonyms.join(", ")}` : ""}
            </span>
            <button
              className="icon"
              onClick={(e) => {
                const top = (e.currentTarget.closest("li") as HTMLElement).offsetTop;
                setEditing({ genre: g, top });
              }}
            >✎</button>
            <button className="icon" onClick={() => setConfirmDelete(g)}>✕</button>
          </li>
        ))}
      </ul>

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
        <GenreForm
          initial={editing === "new" ? undefined : editing.genre}
          anchorTop={editing === "new" ? undefined : editing.top}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
