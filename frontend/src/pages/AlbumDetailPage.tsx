import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import { gk, rk } from "../api/keys";
import { useAlbumEntry, useArtistCatalog, useGuildApi, useMusicGenres, useUpdateAlbumEntry } from "../api/hooks";
import type { Album, Genre, NamedRef } from "../api/types";
import { AlbumForm } from "../components/AlbumForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LinksSection } from "../components/LinksSection";
import { GenreChooser } from "../genre/GenreChooser";
import { MUSIC_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { BusyButton, InlineBusy, LoadingState } from "../components/Spinner";

function fmtRuntime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// ── Artists section ────────────────────────────────────────────────────────────

function AlbumArtistsSection({ albumId, album }: { albumId: number; album: Album }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<NamedRef | null>(null);
  const [search, setSearch] = useState("");

  const { data: allArtists = [], isLoading: artistsLoading } = useArtistCatalog();
  const linkedIds = new Set(album.artists.map((a) => a.id));

  const filteredArtists = allArtists.filter((a) =>
    !search.trim() || a.name.toLowerCase().includes(search.trim().toLowerCase()) || !!a.name_en?.toLowerCase().includes(search.trim().toLowerCase())
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, "albums") });
    qc.invalidateQueries({ queryKey: gk(guildId, "artists") });
  };

  const link = useMutation({
    mutationFn: (artistId: number) => api.put(`${base}/albums/${albumId}/artists/${artistId}`),
    onSuccess: invalidate,
  });

  const unlink = useMutation({
    mutationFn: (artist: NamedRef) => api.delete(`${base}/albums/${albumId}/artists/${artist.id}`),
    onSuccess: invalidate,
  });

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>Artists</h2>
          {(link.isPending || unlink.isPending) && <InlineBusy label="Saving…" />}
        </span>
        {canEdit && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
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
          {artistsLoading ? (
            <LoadingState compact label="Loading artists…" />
          ) : (
            <div className="chips" style={{ marginBottom: "0.75rem" }}>
              {filteredArtists.map((a) => (
                <label key={a.id} className="chip">
                  <input
                    type="checkbox"
                    checked={linkedIds.has(a.id)}
                    onChange={(e) => {
                      if (e.target.checked) link.mutate(a.id);
                      else setConfirmUnlink(a);
                    }}
                  />
                  {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
                </label>
              ))}
            </div>
          )}
        </>
      )}

      {album.artists.length > 0 ? (
        <ul className="sortable plain-list">
          {album.artists.map((a) => (
            <li key={a.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/g/${guildId}/music/artists/${a.id}`}>
                  {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No artists linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove "${confirmUnlink.name}" from this album?`}
          confirmLabel="Remove"
          busy={unlink.isPending}
          onConfirm={() => unlink.mutate(confirmUnlink, { onSettled: () => setConfirmUnlink(null) })}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}

// ── Genres section ─────────────────────────────────────────────────────────────

function AlbumGenresSection({ albumId, album }: { albumId: number; album: Album }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useMusicGenres();

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => { setGenreIds(new Set(album.genre_ids)); }, [album.genre_ids]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));
  const albumGenres = album.genre_ids.map((id) => genreMap[id]).filter(Boolean);

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`${base}/albums/${albumId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "albums") }),
  });
  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`${base}/albums/${albumId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "albums") }),
  });

  function handleChange(next: Set<number>) {
    const prev = genreIds;
    for (const id of next) if (!prev.has(id)) addGenre.mutate(id);
    for (const id of prev) {
      if (!next.has(id)) {
        const g = genreMap[id];
        if (g) { setConfirmUnlink(g); return; }
      }
    }
    setGenreIds(next);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>Genres</h2>
          {(addGenre.isPending || removeGenre.isPending) && <InlineBusy label="Saving…" />}
        </span>
        {canEdit && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
          <GenreChooser domain={MUSIC_GENRES} selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {albumGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {albumGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/g/${guildId}/music/genres/${g.id}`}>{g.name}</Link>
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
          busy={removeGenre.isPending}
          onConfirm={() => {
            const id = confirmUnlink.id;
            setGenreIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
            removeGenre.mutate(id, { onSettled: () => setConfirmUnlink(null) });
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}

// ── My list section ──────────────────────────────────────────────────────────

function MyAlbumListSection({ artistId, albumId }: { artistId: number; albumId: number }) {
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const { data: entry, isLoading } = useAlbumEntry(artistId, albumId);
  const update = useUpdateAlbumEntry(artistId, albumId);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (entry) setNotes(entry.notes ?? "");
  }, [entry]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, "artists", artistId, "albums") });
    qc.invalidateQueries({ queryKey: rk(guildId, userId, "artists", artistId, "albums") });
  };
  const add = useMutation({
    mutationFn: () => api.put(`${base}/artists/${artistId}/albums/${albumId}/entry`, {}),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`${base}/artists/${artistId}/albums/${albumId}/entry`),
    onSuccess: invalidate,
  });

  if (!canRank) return null;
  const saving = update.isPending || add.isPending || remove.isPending;

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>My List</h2>
          {saving && <InlineBusy label="Saving…" />}
        </span>
        {entry && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {isLoading ? (
        <LoadingState compact />
      ) : !entry ? (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>
          Not in your list. <BusyButton busy={add.isPending} busyLabel="Adding…" onClick={() => add.mutate()}>+ Add to my list</BusyButton>
        </p>
      ) : (
        <>
          <div className="artist-detail-grid">
            <div>
              <span className="detail-label">Listens</span>
              <span className="listens-ctrl">
                <button className="icon" title="Remove one listen" disabled={entry.listens <= 1}
                        onClick={() => update.mutate({ listens: entry.listens - 1 })}>−</button>
                <input
                  type="number" min={1} className="listens-input" value={entry.listens}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 1) update.mutate({ listens: n });
                  }}
                />
                <button className="icon" title="Add one listen"
                        onClick={() => update.mutate({ listens: entry.listens + 1 })}>+</button>
              </span>
            </div>
          </div>

          {editing ? (
            <div className="detail-section-form" style={{ marginTop: "0.75rem" }}>
              <label>My notes
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                <BusyButton busy={update.isPending} busyLabel="Saving…"
                            onClick={() => update.mutate({ notes: notes.trim() === "" ? null : notes })}>Save notes</BusyButton>
                <button className="danger" onClick={() => setConfirmRemove(true)}>✕ Remove from my list</button>
              </div>
            </div>
          ) : (
            entry.notes && (
              <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
                <span className="detail-label">My notes</span>
                <span>{entry.notes}</span>
              </div>
            )
          )}
        </>
      )}

      {confirmRemove && (
        <ConfirmDialog
          message="Remove this album from your list? Your listen count and personal notes for it will be lost."
          confirmLabel="Remove"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(undefined, { onSettled: () => { setConfirmRemove(false); setEditing(false); } })}
          onCancel={() => setConfirmRemove(false)}
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
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);

  const { data: album, isLoading, isError } = useQuery({
    queryKey: gk(guildId, "albums", albumId),
    queryFn: () => api.get<Album>(`${base}/albums/${albumId}`),
    enabled: !isNaN(albumId),
  });

  if (isLoading) return <section><LoadingState label="Loading album…" /></section>;
  if (isError || !album) return <section><p>Album not found.</p></section>;

  const firstArtistId = album.artists[0]?.id ?? 0;

  return (
    <section>
      {album.artists.length > 0 ? (
        <Link to={`/g/${guildId}/music/artists/${firstArtistId}`} className="back-link">
          ← {album.artists[0].name}
        </Link>
      ) : (
        <Link to={`/g/${guildId}/music`} className="back-link">← All artists</Link>
      )}
      <header className="page-head">
        <h1>
          {album.name}{album.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({album.name_en})</span>}
        </h1>
        {canEdit && <button onClick={() => setEditing(true)}>✎ Edit</button>}
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div><span className="detail-label">Release year</span><span>{album.release_year}</span></div>
          <div><span className="detail-label">Runtime</span><span>{fmtRuntime(album.runtime_seconds)}</span></div>
          {album.alias && (
            <div><span className="detail-label">Alias</span><span>{album.alias}</span></div>
          )}
          {album.soundtrack_movies.length > 0 && (
            <div>
              <span className="detail-label">Soundtrack for</span>
              <span>
                {album.soundtrack_movies.map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ", "}
                    <Link to={`/g/${guildId}/movies/${m.id}`}>
                      {m.name}{m.name_en && <span style={{ opacity: 0.6 }}> ({m.name_en})</span>}
                    </Link>
                  </span>
                ))}
              </span>
            </div>
          )}
          {album.soundtrack_television_shows.length > 0 && (
            <div>
              <span className="detail-label">Soundtrack for (TV)</span>
              <span>
                {album.soundtrack_television_shows.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ", "}
                    <Link to={`/g/${guildId}/television/shows/${s.id}`}>
                      {s.name}{s.name_en && <span style={{ opacity: 0.6 }}> ({s.name_en})</span>}
                    </Link>
                  </span>
                ))}
              </span>
            </div>
          )}
          {album.soundtrack_games.length > 0 && (
            <div>
              <span className="detail-label">Soundtrack for (Game)</span>
              <span>
                {album.soundtrack_games.map((g, i) => (
                  <span key={g.id}>
                    {i > 0 && ", "}
                    <Link to={`/g/${guildId}/games/${g.id}`}>
                      {g.name}{g.name_en && <span style={{ opacity: 0.6 }}> ({g.name_en})</span>}
                    </Link>
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

      <AlbumArtistsSection albumId={albumId} album={album} />
      <AlbumGenresSection albumId={albumId} album={album} />
      <LinksSection path="albums" section="albums" ownerId={albumId} />
      {album.artists.length > 0 && <MyAlbumListSection artistId={firstArtistId} albumId={albumId} />}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <AlbumForm
              artistId={firstArtistId}
              initial={album}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: gk(guildId, "albums", albumId) });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
