import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { useAlbumIndex, useArtists, useGenres } from "../api/hooks";
import type { Artist } from "../api/types";
import { ArtistDetailDropdown } from "../components/ArtistDetailDropdown";
import { ArtistForm } from "../components/ArtistForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SortableList } from "../components/SortableList";

type SearchBy = "all" | "artist" | "genre" | "album";

export function ArtistsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ artist: Artist } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Artist | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<SearchBy>("all");
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const { data: artists = [] } = useArtists();
  const { data: albumIndex = [] } = useAlbumIndex();
  const { data: genres = [] } = useGenres();

  const visibleArtists = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return artists;

    const matchingIds = new Set<number>();

    if (searchBy === "artist" || searchBy === "all") {
      for (const a of artists) {
        if (a.name.toLowerCase().includes(needle)) matchingIds.add(a.id);
      }
    }

    if (searchBy === "genre" || searchBy === "all") {
      // Build set of genre IDs whose name matches
      const matchingGenreIds = new Set(
        genres
          .filter((g) =>
            g.name.toLowerCase().includes(needle) ||
            g.synonyms?.some((s) => s.toLowerCase().includes(needle))
          )
          .map((g) => g.id)
      );
      if (matchingGenreIds.size > 0) {
        // Artists whose primary genre matches
        for (const a of artists) {
          if (a.primary_genre != null && matchingGenreIds.has(a.primary_genre))
            matchingIds.add(a.id);
        }
        // Artists whose albums have a matching genre
        for (const album of albumIndex) {
          if (album.genre_ids.some((gid) => matchingGenreIds.has(gid))) {
            for (const aid of album.artist_ids) matchingIds.add(aid);
          }
        }
      }
    }

    if (searchBy === "album" || searchBy === "all") {
      for (const album of albumIndex) {
        if (album.name.toLowerCase().includes(needle)) {
          for (const aid of album.artist_ids) matchingIds.add(aid);
        }
      }
    }

    return artists.filter((a) => matchingIds.has(a.id));
  }, [searchQ, searchBy, artists, albumIndex, genres]);

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) =>
      api.put(`/artists/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["artists"] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/artists/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["artists"] });
      const prev = qc.getQueryData<Artist[]>(["artists"]);
      qc.setQueryData<Artist[]>(["artists"], (old = []) => old.filter((a) => a.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => qc.setQueryData(["artists"], ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["artists"] }),
  });

  const allExpanded = artists.length > 0 && expandedIds.size === artists.length;

  return (
    <section>
      <header className="page-head">
        <h1>Artists</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => {
            if (allExpanded) {
              setExpandedIds(new Set());
            } else {
              setExpandedIds(new Set(artists.map((a) => a.id)));
            }
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
          {(["all", "artist", "genre", "album"] as SearchBy[]).map((opt) => (
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
          <span className="search-count">{visibleArtists.length} result{visibleArtists.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <SortableList
        items={visibleArtists}
        onReorder={(next) => qc.setQueryData(["artists"], next)}
        onMove={(id, position) => move.mutate({ id, position })}
        disableDrag={searchQ.trim().length > 0}
        renderDetail={(a) =>
          expandedIds.has(a.id) ? (
            <ArtistDetailDropdown artistId={a.id} primaryGenreId={a.primary_genre} />
          ) : null
        }
        render={(a) => (
          <>
            <Link className="name" to={`/music/artists/${a.id}`}>{a.name}</Link>
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
              onClick={() => setEditing({ artist: a })}
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
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <ArtistForm
              initial={editing === "new" ? undefined : editing.artist}
              onClose={(savedName, savedId) => {
                setEditing(null);
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = artists.filter(
                    (a) => a.name.toLowerCase() === nameLower && a.id !== savedId
                  );
                  if (dups.length > 0) setDupWarning(`Warning: another artist named "${savedName}" already exists.`);
                }
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
