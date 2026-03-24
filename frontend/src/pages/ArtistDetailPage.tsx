import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { AlbumForm } from "../components/AlbumForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { api } from "../api/client";
import type { Album, Artist, ArtistRef } from "../api/types";
import { SortableList } from "../components/SortableList";

export function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const aid = Number(id);
  const qc = useQueryClient();
  const key = ["artists", aid, "albums"];

  const [editing, setEditing] = useState<{ album: Album; top: number } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Album | null>(null);

  const { data: artist } = useQuery({
    queryKey: ["artists", aid],
    queryFn: () => api.get<Artist>(`/artists/${aid}`),
  });

  const { data: albums = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get<Album[]>(`/artists/${aid}/albums`),
  });

  const move = useMutation({
    mutationFn: (v: { albumId: number; position: number }) =>
      api.put(`/albums/${v.albumId}/artists/${aid}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const adjustListens = useMutation({
    mutationFn: ({ albumId, delta }: { albumId: number; delta: 1 | -1 }) => {
      const album = albums.find((a) => a.id === albumId)!;
      return api.patch<Album>(`/albums/${albumId}`, { listens: album.listens + delta });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  async function handleDelete(album: Album) {
    const artists = await api.get<ArtistRef[]>(`/albums/${album.id}/artists`);
    if (artists.length > 1) {
      // Other artists own this album too — just unlink from this artist
      await api.delete(`/albums/${album.id}/artists/${aid}`);
    } else {
      await api.delete(`/albums/${album.id}`);
    }
    qc.invalidateQueries({ queryKey: key });
  }

  const remove = useMutation({ mutationFn: handleDelete });

  if (!artist) return <p>Loading…</p>;

  return (
    <section>
      <header className="page-head">
        <h1>{artist.name}</h1>
        <button onClick={() => setEditing("new")}>+ Add Album</button>
        <a href={artist.discography_link} target="_blank" rel="noreferrer">
          Discography ↗
        </a>
      </header>

      <h2>Albums</h2>
      <SortableList
        items={albums}
        rowClassName="album-row"
        onReorder={(next) => qc.setQueryData(key, next)}
        onMove={(albumId, position) => move.mutate({ albumId, position })}
        render={(a) => (
          <>
            <span className="name">{a.name}</span>
            <span className="meta">
              {a.release_year} · {Math.floor(a.runtime_seconds / 60)}:
              {String(a.runtime_seconds % 60).padStart(2, "0")}
            </span>
            <span className="listens-ctrl">
              <button
                className="icon"
                title="Remove one listen"
                disabled={a.listens <= 1}
                onClick={() => adjustListens.mutate({ albumId: a.id, delta: -1 })}
              >−</button>
              <span className="listens-count">{a.listens}×</span>
              <button
                className="icon"
                title="Add one listen"
                onClick={() => adjustListens.mutate({ albumId: a.id, delta: 1 })}
              >+</button>
            </span>
            <button
              className="icon"
              onClick={(e) => {
                const top = (e.currentTarget.closest(".row") as HTMLElement).offsetTop;
                setEditing({ album: a, top });
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
            remove.mutate(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {editing && (
        <AlbumForm
          artistId={aid}
          initial={editing === "new" ? undefined : editing.album}
          anchorTop={editing === "new" ? undefined : editing.top}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
