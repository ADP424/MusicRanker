import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AlbumForm } from "../components/AlbumForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PersonForm } from "../components/PersonForm";
import { api } from "../api/client";
import { useGenres, usePeople } from "../api/hooks";
import type { Album, Artist, ArtistRef, Person } from "../api/types";
import { SortableList } from "../components/SortableList";

// ── People panel ───────────────────────────────────────────────────────────────

function ArtistPeopleSection({ artistId }: { artistId: number }) {
  const qc = useQueryClient();
  const { data: people = [] } = usePeople();
  const [search, setSearch] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const linked = people.filter((p: Person) => p.artist_ids.includes(artistId));

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter((p: Person) => p.name.toLowerCase().includes(q)) : people;
  }, [search, people]);

  const link = useMutation({
    mutationFn: (pid: number) => api.put(`/persons/${pid}/artists/${artistId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people"] }),
  });

  const unlink = useMutation({
    mutationFn: (pid: number) => api.delete(`/persons/${pid}/artists/${artistId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people"] }),
  });

  function togglePerson(p: Person) {
    if (p.artist_ids.includes(artistId)) {
      unlink.mutate(p.id);
    } else {
      link.mutate(p.id);
    }
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>People</h2>
        <button style={{ fontSize: 12 }} onClick={() => setChooserOpen((o) => !o)}>
          {chooserOpen ? "Done" : "Edit"}
        </button>
      </header>

      {chooserOpen && (
        <>
          {dupWarning && (
            <div className="dup-warning">
              <span>{dupWarning}</span>
              <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
            <input
              className="genre-search"
              type="search"
              placeholder="Search people…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ margin: 0, flex: 1 }}
            />
            <button style={{ whiteSpace: "nowrap" }} onClick={() => setCreatingPerson(true)}>
              + New Person
            </button>
          </div>
          <div className="chips" style={{ marginBottom: "0.75rem" }}>
            {filteredPeople.map((p: Person) => (
              <label key={p.id} className="chip">
                <input
                  type="checkbox"
                  checked={p.artist_ids.includes(artistId)}
                  onChange={() => togglePerson(p)}
                />
                {p.name}
              </label>
            ))}
          </div>
        </>
      )}

      {linked.length > 0 ? (
        <ul className="sortable plain-list">
          {linked.map((p) => (
            <li key={p.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
                <Link className="name" to={`/people/${p.id}`}>{p.name}</Link>
                <span className="meta">
                  {p.core_nationality}
                  {p.birth_nationality !== p.core_nationality && (
                    <> ({p.birth_nationality})</>
                  )}
                </span>
                <button
                  className="icon"
                  title="Unlink person"
                  onClick={() => unlink.mutate(p.id)}
                >✕</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No people linked.</p>
      )}

      {creatingPerson && (
        <div className="modal-backdrop" onClick={() => setCreatingPerson(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PersonForm
              onClose={(savedName, savedId) => {
                setCreatingPerson(false);
                if (savedId != null) link.mutate(savedId);
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = people.filter((p) => p.name.toLowerCase() === nameLower && p.id !== savedId);
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

// ── Main page ──────────────────────────────────────────────────────────────────

export function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const aid = Number(id);
  const qc = useQueryClient();
  const key = ["artists", aid, "albums"];

  const [editing, setEditing] = useState<{ album: Album } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Album | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data: genres = [] } = useGenres();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["albums", "index"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (album: Album) => {
      const artists = await api.get<ArtistRef[]>(`/albums/${album.id}/artists`);
      if (artists.length > 1) {
        await api.delete(`/albums/${album.id}/artists/${aid}`);
      } else {
        await api.delete(`/albums/${album.id}`);
      }
    },
    onMutate: async (album) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Album[]>(key);
      qc.setQueryData<Album[]>(key, (old = []) => old.filter((a) => a.id !== album.id));
      return { prev };
    },
    onError: (_err, _album, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["albums", "index"] });
      qc.invalidateQueries({ queryKey: ["stats", "artist-detail", aid] });
    },
  });

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!artist) return <p>Loading…</p>;

  const allExpanded = albums.length > 0 && expandedIds.size === albums.length;

  return (
    <section>
      <header className="page-head">
        <h1>
          {artist.discography_link ? (
            <a href={artist.discography_link} target="_blank" rel="noreferrer" className="plain-link">
              {artist.name}
            </a>
          ) : artist.name}
        </h1>
        <button onClick={() => setEditing("new")}>+ Add Album</button>
      </header>

      <ArtistPeopleSection artistId={aid} />

      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Albums</h2>
        <button onClick={() => {
          if (allExpanded) {
            setExpandedIds(new Set());
          } else {
            setExpandedIds(new Set(albums.map((a) => a.id)));
          }
        }}>
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </header>

      <SortableList
        items={albums}
        rowClassName="album-row"
        onReorder={(next) => qc.setQueryData(key, next)}
        onMove={(albumId, position) => move.mutate({ albumId, position })}
        renderDetail={(a) =>
          expandedIds.has(a.id) ? (
            <div className="album-detail-dropdown">
              {a.alias && (
                <div className="album-detail-row">
                  <span className="detail-label">Alias</span>
                  <span>
                    {a.alias_link
                      ? <a href={a.alias_link} target="_blank" rel="noreferrer" className="plain-link">{a.alias}</a>
                      : a.alias}
                  </span>
                </div>
              )}
              {a.genre_ids.length > 0 && (
                <div className="album-detail-row">
                  <span className="detail-label">Genres</span>
                  <span>{a.genre_ids.map((id) => genreMap[id]).filter(Boolean).sort().join(", ")}</span>
                </div>
              )}
              {a.artists.length > 1 && (
                <div className="album-detail-row">
                  <span className="detail-label">Artists</span>
                  <span>
                    {a.artists.map((ar, i) => (
                      <span key={ar.id}>
                        {i > 0 && ", "}
                        {ar.discography_link
                          ? <a href={ar.discography_link} target="_blank" rel="noreferrer" className="plain-link">{ar.name}</a>
                          : ar.name}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {a.soundtrack_movies.length > 0 && (
                <div className="album-detail-row">
                  <span className="detail-label">Soundtrack for</span>
                  <span>
                    {a.soundtrack_movies.map((m, i) => (
                      <span key={m.id}>
                        {i > 0 && ", "}
                        <Link to="/movies">{m.name}</Link>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {a.listen_link && (
                <div className="album-detail-row">
                  <span className="detail-label">Listen</span>
                  <a href={a.listen_link} target="_blank" rel="noreferrer">{a.listen_link}</a>
                </div>
              )}
              {a.notes && (
                <div className="album-detail-row">
                  <span className="detail-label">Notes</span>
                  <span>{a.notes}</span>
                </div>
              )}
              {!a.alias && a.artists.length <= 1 && !a.listen_link && !a.notes && a.genre_ids.length === 0 && a.soundtrack_movies.length === 0 && (
                <span style={{ opacity: 0.5 }}>No extra info.</span>
              )}
            </div>
          ) : null
        }
        render={(a) => (
          <>
            <span className="name">
              {a.listen_link
                ? <a href={a.listen_link} target="_blank" rel="noreferrer" className="album-name-link">{a.name}</a>
                : a.name}
            </span>
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
              title="Show details"
              onClick={() => toggleExpand(a.id)}
            >{expandedIds.has(a.id) ? "▲" : "▼"}</button>
            <button
              className="icon"
              onClick={() => setEditing({ album: a })}
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
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <AlbumForm
              artistId={aid}
              initial={editing === "new" ? undefined : editing.album}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
