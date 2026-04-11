import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useAlbumIndex, useGenres } from "../api/hooks";
import type { Album, ArtistRef, Genre } from "../api/types";
import { AlbumForm } from "../components/AlbumForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GenreChooser } from "../components/GenreChooser";

function fmtRuntime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// ── Artists section ────────────────────────────────────────────────────────────

function AlbumArtistsSection({ albumId }: { albumId: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<ArtistRef | null>(null);
  const [search, setSearch] = useState("");

  const { data: albumArtists = [] } = useQuery({
    queryKey: ["albums", albumId, "artists"],
    queryFn: () => api.get<ArtistRef[]>(`/albums/${albumId}/artists`),
  });

  const { data: allArtists = [] } = useQuery({
    queryKey: ["artists"],
    queryFn: () => api.get<ArtistRef[]>("/artists"),
  });

  const linkedIds = new Set(albumArtists.map((a) => a.id));

  const filteredArtists = allArtists.filter((a) =>
    !search.trim() || a.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const link = useMutation({
    mutationFn: (artistId: number) => api.put(`/albums/${albumId}/artists/${artistId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["albums", albumId, "artists"] });
      qc.invalidateQueries({ queryKey: ["albums", albumId] });
      qc.invalidateQueries({ queryKey: ["albums", "index"] });
    },
  });

  const unlink = useMutation({
    mutationFn: async (artist: ArtistRef) => {
      if (albumArtists.length > 1) {
        await api.delete(`/albums/${albumId}/artists/${artist.id}`);
      } else {
        await api.delete(`/albums/${albumId}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["albums", albumId, "artists"] });
      qc.invalidateQueries({ queryKey: ["albums", albumId] });
      qc.invalidateQueries({ queryKey: ["albums", "index"] });
    },
  });

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Artists</h2>
        <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
          {editing ? "Done" : "Edit"}
        </button>
      </header>

      {editing && (
        <>
          <input
            className="genre-search"
            type="search"
            placeholder="Search artists…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: "0.4rem" }}
          />
          <div className="chips" style={{ marginBottom: "0.75rem" }}>
            {filteredArtists.map((a) => (
              <label key={a.id} className="chip">
                <input
                  type="checkbox"
                  checked={linkedIds.has(a.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      link.mutate(a.id);
                    } else {
                      setConfirmUnlink(a);
                    }
                  }}
                />
                {a.name}
              </label>
            ))}
          </div>
        </>
      )}

      {albumArtists.length > 0 ? (
        <ul className="sortable plain-list">
          {albumArtists.map((a) => (
            <li key={a.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/music/artists/${a.id}`}>{a.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No artists linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={albumArtists.length > 1
            ? `Remove "${confirmUnlink.name}" from this album?`
            : `"${confirmUnlink.name}" is the only artist — removing them will delete the whole album.`}
          onConfirm={() => {
            unlink.mutate(confirmUnlink);
            setConfirmUnlink(null);
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}

// ── Genres section ─────────────────────────────────────────────────────────────

function AlbumGenresSection({ albumId }: { albumId: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useGenres();

  const { data: albumGenres = [] } = useQuery({
    queryKey: ["albums", albumId, "genres"],
    queryFn: () => api.get<Genre[]>(`/albums/${albumId}/genres`),
  });

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setGenreIds(new Set(albumGenres.map((g) => g.id)));
  }, [albumGenres]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`/albums/${albumId}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["albums", albumId, "genres"] });
      qc.invalidateQueries({ queryKey: ["albums", albumId] });
    },
  });

  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`/albums/${albumId}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["albums", albumId, "genres"] });
      qc.invalidateQueries({ queryKey: ["albums", albumId] });
    },
  });

  function handleChange(next: Set<number>) {
    const prev = genreIds;
    // Handle additions immediately
    for (const id of next) {
      if (!prev.has(id)) addGenre.mutate(id);
    }
    // Removals route through confirm dialog — find the first removed id
    for (const id of prev) {
      if (!next.has(id)) {
        const g = genreMap[id];
        if (g) {
          setConfirmUnlink(g);
          return;
        }
      }
    }
    setGenreIds(next);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Genres</h2>
        <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
          {editing ? "Done" : "Edit"}
        </button>
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
          <GenreChooser selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {albumGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {albumGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/music/genres/${g.id}`}>{g.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No genres linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove genre "${confirmUnlink.name}" from this album?`}
          onConfirm={() => {
            removeGenre.mutate(confirmUnlink.id);
            setGenreIds((prev) => {
              const next = new Set(prev);
              next.delete(confirmUnlink!.id);
              return next;
            });
            setConfirmUnlink(null);
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>();
  const albumId = Number(id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const { data: album, isLoading, isError } = useQuery({
    queryKey: ["albums", albumId],
    queryFn: () => api.get<Album>(`/albums/${albumId}`),
    enabled: !isNaN(albumId),
  });

  const { data: albumIndex = [] } = useAlbumIndex();

  if (isLoading) return <section><p>Loading…</p></section>;
  if (isError || !album) return <section><p>Album not found.</p></section>;

  const firstArtistId = album.artists[0]?.id ?? 0;

  return (
    <section>
      <header className="page-head">
        <h1>
          {album.name}
          {album.listen_link && (
            <> <a href={album.listen_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.6em", opacity: 0.7, fontWeight: "normal", color: "inherit" }}>(link)</a></>
          )}
        </h1>
        <button onClick={() => setEditing(true)}>✎ Edit</button>
      </header>

      {dupWarning && (
        <div className="dup-warning">
          <span>{dupWarning}</span>
          <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
        </div>
      )}

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div>
            <span className="detail-label">Release year</span>
            <span>{album.release_year}</span>
          </div>
          <div>
            <span className="detail-label">Runtime</span>
            <span>{fmtRuntime(album.runtime_seconds)}</span>
          </div>
          <div>
            <span className="detail-label">Listens</span>
            <span>{album.listens}</span>
          </div>
          {album.alias && (
            <div>
              <span className="detail-label">Alias</span>
              <span>
                {album.alias_link
                  ? <a href={album.alias_link} target="_blank" rel="noreferrer" className="plain-link">{album.alias}</a>
                  : album.alias}
              </span>
            </div>
          )}
          {album.soundtrack_movies.length > 0 && (
            <div>
              <span className="detail-label">Soundtrack for</span>
              <span>
                {album.soundtrack_movies.map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ", "}
                    <Link to={`/movies/${m.id}`}>{m.name}</Link>
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
        {album.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{album.notes}</span>
          </div>
        )}
      </div>

      <AlbumArtistsSection albumId={albumId} />
      <AlbumGenresSection albumId={albumId} />

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <AlbumForm
              artistId={firstArtistId}
              initial={album}
              onClose={(savedName, savedId) => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: ["albums", albumId] });
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = albumIndex.filter(
                    (a) => a.name.toLowerCase() === nameLower && a.id !== savedId
                  );
                  if (dups.length > 0) setDupWarning(`Warning: another album named "${savedName}" already exists.`);
                }
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
