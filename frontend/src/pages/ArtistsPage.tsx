import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import type { Artist } from "../api/types";
import { ArtistDetailDropdown } from "../components/ArtistDetailDropdown";
import { ArtistForm } from "../components/ArtistForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SortableList } from "../components/SortableList";

export function ArtistsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ artist: Artist; top: number } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Artist | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

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
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => {
            const allExpanded = artists.length > 0 && expandedIds.size === artists.length;
            if (allExpanded) {
              setExpandedIds(new Set());
            } else {
              setExpandedIds(new Set(artists.map((a) => a.id)));
            }
          }}>
            {artists.length > 0 && expandedIds.size === artists.length ? "Collapse all" : "Expand all"}
          </button>
          <button onClick={() => setEditing("new")}>+ Add</button>
        </div>
      </header>

      <SortableList
        items={artists}
        onReorder={(next) => qc.setQueryData(["artists"], next)}
        onMove={(id, position) => move.mutate({ id, position })}
        renderDetail={(a) =>
          expandedIds.has(a.id) ? <ArtistDetailDropdown artistId={a.id} /> : null
        }
        render={(a) => (
          <>
            <Link className="name" to={`/artists/${a.id}`}>{a.name}</Link>
            <span className="meta">
              {a.core_nationality}
              {a.birth_nationality !== a.core_nationality && (
                <> ({a.birth_nationality})</>
              )}
            </span>
            <button
              className="icon"
              title="Show details"
              onClick={() => {
                setExpandedIds((prev) => {
                  const next = new Set(prev);
                  next.has(a.id) ? next.delete(a.id) : next.add(a.id);
                  return next;
                });
              }}
            >{expandedIds.has(a.id) ? "▲" : "▼"}</button>
            <button
              className="icon"
              onClick={(e) => {
                const top = (e.currentTarget.closest(".row") as HTMLElement).offsetTop;
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
