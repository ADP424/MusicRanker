import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import type { Artist } from "../api/types";
import { ArtistForm } from "../components/ArtistForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SortableList } from "../components/SortableList";

export function ArtistsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ artist: Artist; top: number } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Artist | null>(null);

  const { data: artists = [] } = useQuery({
    queryKey: ["artists"],
    queryFn: () => api.get<Artist[]>("/artists"),
  });

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) =>
      api.put(`/artists/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["artists"] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/artists/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["artists"] }),
  });

  return (
    <section>
      <header className="page-head">
        <h1>Artists</h1>
        <button onClick={() => setEditing("new")}>+ Add</button>
      </header>

      <SortableList
        items={artists}
        onReorder={(next) => qc.setQueryData(["artists"], next)}
        onMove={(id, position) => move.mutate({ id, position })}
        render={(a) => (
          <>
            <Link className="name" to={`/artists/${a.id}`}>{a.name}</Link>
            <span className="meta">{a.core_nationality}</span>
            <button
              className="icon"
              onClick={(e) => {
                const top = (e.currentTarget.closest("li") as HTMLElement).offsetTop;
                setEditing({ artist: a, top });
              }}
            >✎</button>
            <button className="icon" onClick={() => setConfirmDelete(a)}>✕</button>
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
        <ArtistForm
          initial={editing === "new" ? undefined : editing.artist}
          anchorTop={editing === "new" ? undefined : editing.top}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
