import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GenreForm } from "./GenreForm";
import { GenreTree } from "./GenreTree";
import type { GenreDomain, GenreLike } from "./config";

type View = "list" | "tree";

export function GenresPage({ domain }: { domain: GenreDomain }) {
  const qc = useQueryClient();
  const { data: genres = [] } = domain.useAll();
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<GenreLike | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GenreLike | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${domain.apiBase}/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: [domain.key] });
      const prev = qc.getQueryData<GenreLike[]>([domain.key]);
      qc.setQueryData<GenreLike[]>([domain.key], (old = []) => old.filter((g) => g.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => qc.setQueryData([domain.key], ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: [domain.key] }),
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
              <Link className="name" to={`${domain.routeBase}/${g.id}`}>{g.name}</Link>
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
              domain={domain}
              initial={editing === "new" ? undefined : editing}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
