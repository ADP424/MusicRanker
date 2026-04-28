import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AlbumForm } from "../components/AlbumForm";
import { ArtistForm } from "../components/ArtistForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PersonForm } from "../components/PersonForm";
import { api } from "../api/client";
import { useGenres, usePeople } from "../api/hooks";
import type { Album, Artist, ArtistDetail, ArtistRef, BandRole, Person, PersonArtistRef } from "../api/types";
import { BAND_ROLES, BAND_ROLE_LABELS } from "../api/types";
import { SortableList } from "../components/SortableList";

function fmtRuntime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── People panel ───────────────────────────────────────────────────────────────

function ArtistPeopleSection({ artistId }: { artistId: number }) {
  const qc = useQueryClient();
  const { data: allPeople = [] } = usePeople();
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<"all" | "person" | "artist" | "movie">("all");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [addRole, setAddRole] = useState<BandRole>("member");

  // Fetch role-aware person links for this artist
  const { data: artistPersons = [] } = useQuery({
    queryKey: ["artists", artistId, "persons"],
    queryFn: () => api.get<PersonArtistRef[]>(`/artists/${artistId}/persons`),
  });

  // Track current (personId, role) links as "id:role" keys
  const [castKeys, setCastKeys] = useState<Set<string>>(
    () => new Set(artistPersons.map((p) => `${p.id}:${p.role}`)),
  );
  useEffect(() => {
    setCastKeys(new Set(artistPersons.map((p) => `${p.id}:${p.role}`)));
  }, [artistPersons]);

  const linkedIds = useMemo(
    () => new Set(artistPersons.map((p) => p.id)),
    [artistPersons],
  );

  // Linked people floated to the top, then alphabetical
  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? allPeople.filter((p: Person) => {
          if (searchField === "person") return p.name.toLowerCase().includes(q);
          if (searchField === "artist") return p.artist_names.some((n) => n.toLowerCase().includes(q));
          if (searchField === "movie") return p.movie_names.some((n) => n.toLowerCase().includes(q));
          return (
            p.name.toLowerCase().includes(q) ||
            p.artist_names.some((n) => n.toLowerCase().includes(q)) ||
            p.movie_names.some((n) => n.toLowerCase().includes(q))
          );
        })
      : allPeople;
    return [...filtered].sort((a, b) => {
      const aLinked = linkedIds.has(a.id) ? 0 : 1;
      const bLinked = linkedIds.has(b.id) ? 0 : 1;
      if (aLinked !== bLinked) return aLinked - bLinked;
      return a.name.localeCompare(b.name);
    });
  }, [search, searchField, allPeople, linkedIds]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["people"] });
    qc.invalidateQueries({ queryKey: ["artists", artistId, "persons"] });
    qc.invalidateQueries({ queryKey: ["stats", "artist-detail", artistId] });
  };

  const link = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: BandRole }) =>
      api.put(`/persons/${pid}/artists/${artistId}/${role}`),
    onSuccess: invalidate,
  });

  const unlink = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: BandRole }) =>
      api.delete(`/persons/${pid}/artists/${artistId}/${role}`),
    onSuccess: invalidate,
  });

  function toggleLink(person: Person, role: BandRole) {
    const key = `${person.id}:${role}`;
    if (castKeys.has(key)) {
      unlink.mutate({ pid: person.id, role });
      setCastKeys((prev) => { const next = new Set(prev); next.delete(key); return next; });
    } else {
      link.mutate({ pid: person.id, role });
      setCastKeys((prev) => new Set([...prev, key]));
    }
  }

  // Group linked persons by role for display
  const byRole: Record<BandRole, PersonArtistRef[]> = { core_member: [], member: [] };
  for (const p of artistPersons) byRole[p.role].push(p);

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

          {/* Role selector */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            {BAND_ROLES.map((role) => (
              <label
                key={role}
                className={`chip${addRole === role ? " chip-active" : ""}`}
                onClick={() => setAddRole(role)}
                style={{ cursor: "pointer" }}
              >
                {BAND_ROLE_LABELS[role]}
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem", flexWrap: "wrap" }}>
            {(["all", "person", "artist", "movie"] as const).map((f) => (
              <label
                key={f}
                className={`chip${searchField === f ? " chip-active" : ""}`}
                onClick={() => setSearchField(f)}
                style={{ cursor: "pointer" }}
              >
                {f === "all" ? "All" : f === "person" ? "Person" : f === "artist" ? "Artist" : "Movie"}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
            <input
              className="genre-search"
              type="search"
              placeholder={
                searchField === "person" ? "Search by person name…" :
                searchField === "artist" ? "Search by artist name…" :
                searchField === "movie" ? "Search by movie name…" :
                "Search people, artists, movies…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ margin: 0, flex: 1 }}
            />
            <button style={{ whiteSpace: "nowrap" }} onClick={() => setCreatingPerson(true)}>
              + New Person
            </button>
          </div>
          <div className="chips" style={{ marginBottom: "0.75rem" }}>
            {filteredPeople.map((p: Person) => {
              const key = `${p.id}:${addRole}`;
              return (
                <label key={p.id} className="chip">
                  <input
                    type="checkbox"
                    checked={castKeys.has(key)}
                    onChange={() => toggleLink(p, addRole)}
                  />
                  {p.name}
                </label>
              );
            })}
          </div>
        </>
      )}

      {artistPersons.length > 0 ? (
        BAND_ROLES.filter((r) => byRole[r].length > 0).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>
              {BAND_ROLE_LABELS[role]}
            </div>
            <ul className="sortable plain-list">
              {byRole[role].map((p) => (
                <li key={`${p.id}:${p.role}`} className="sortable-item">
                  <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                    <Link className="name" to={`/people/${p.id}`}>{p.name}</Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No people linked.</p>
      )}

      {creatingPerson && (
        <div className="modal-backdrop" onClick={() => setCreatingPerson(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PersonForm
              onClose={(savedName, savedId) => {
                setCreatingPerson(false);
                if (savedId != null) {
                  qc.invalidateQueries({ queryKey: ["people"] });
                  link.mutate({ pid: savedId, role: addRole });
                  setCastKeys((prev) => new Set([...prev, `${savedId}:${addRole}`]));
                }
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = allPeople.filter((p) => p.name.toLowerCase() === nameLower && p.id !== savedId);
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
  const [editingArtist, setEditingArtist] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Album | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const { data: genres = [] } = useGenres();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));

  const { data: artist } = useQuery({
    queryKey: ["artists", aid],
    queryFn: () => api.get<Artist>(`/artists/${aid}`),
  });

  const { data: detail } = useQuery({
    queryKey: ["stats", "artist-detail", aid],
    queryFn: () => api.get<ArtistDetail>(`/stats/artist-detail/${aid}`),
    enabled: !!artist,
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

  const primaryGenre = artist.primary_genre != null ? genres.find((g) => g.id === artist.primary_genre) : undefined;

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
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => setEditingArtist(true)}>✎ Edit</button>
          <button onClick={() => setEditing("new")}>+ Add Album</button>
        </div>
      </header>

      {dupWarning && (
        <div className="dup-warning">
          <span>{dupWarning}</span>
          <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
        </div>
      )}

      {detail && (
        <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
          <div className="artist-detail-grid">
            <div><span className="detail-label">Albums</span><span>{detail.album_count}</span></div>
            <div><span className="detail-label">Total Runtime</span><span>{detail.total_runtime}</span></div>
            <div><span className="detail-label">Listened Runtime</span><span>{detail.total_listened_runtime}</span></div>
            <div><span className="detail-label">Avg Runtime</span><span>{detail.avg_runtime}</span></div>
            <div><span className="detail-label">Avg Album Score</span><span>{detail.avg_album_score?.toFixed(4) ?? "—"}</span></div>
            <div>
              <span className="detail-label">Nationality</span>
              <span>
                {artist.core_nationality}
                {artist.birth_nationality !== artist.core_nationality && ` (${artist.birth_nationality})`}
              </span>
            </div>
          </div>
          {primaryGenre && (
            <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
              <span className="detail-label">Primary Genre</span>
              <Link to={`/music/genres/${primaryGenre.id}`} className="plain-link">{primaryGenre.name}</Link>
            </div>
          )}
          {detail.genres.length > 0 && (
            <div className="detail-tags">
              <span className="detail-label">Genres</span>
              <span>
                {detail.genres.map((g, i) => (
                  <span key={g.id}>{i > 0 && ", "}<Link to={`/music/genres/${g.id}`} className="plain-link">{g.name}</Link></span>
                ))}
              </span>
            </div>
          )}
          {detail.members.length > 0 && (
            <div className="detail-tags">
              <span className="detail-label">Members</span>
              <span>
                {detail.members.map((p, i) => (
                  <span key={p.id}>{i > 0 && ", "}<Link to={`/people/${p.id}`} className="plain-link">{p.name}</Link></span>
                ))}
              </span>
            </div>
          )}
          {detail.collaborators.length > 0 && (
            <div className="detail-tags">
              <span className="detail-label">Collaborators</span>
              <span>
                {detail.collaborators.map((a, i) => (
                  <span key={a.id}>{i > 0 && ", "}<Link to={`/music/artists/${a.id}`} className="plain-link">{a.name}</Link></span>
                ))}
              </span>
            </div>
          )}
          {artist.notes && (
            <div className="detail-tags">
              <span className="detail-label">Notes</span>
              <span>{artist.notes}</span>
            </div>
          )}
        </div>
      )}

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
                  <span>
                    {a.genre_ids
                      .filter((id) => genreMap[id])
                      .sort((a, b) => genreMap[a].localeCompare(genreMap[b]))
                      .map((id, i) => (
                        <span key={id}>
                          {i > 0 && ", "}
                          <Link className="plain-link" to={`/music/genres/${id}`}>{genreMap[id]}</Link>
                        </span>
                      ))}
                  </span>
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
                        <Link to={`/movies/${m.id}`}>{m.name}</Link>
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
              <Link to={`/music/albums/${a.id}`} className="plain-link">{a.name}</Link>
              {a.listen_link && (
                <> <a href={a.listen_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.85em", opacity: 0.7, color: "inherit" }}>(link)</a></>
              )}
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
              onClose={(savedName, savedId) => {
                setEditing(null);
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = albums.filter(
                    (a) => a.name.toLowerCase() === nameLower && a.id !== savedId
                  );
                  if (dups.length > 0) setDupWarning(`Warning: another album named "${savedName}" already exists in this artist's discography.`);
                }
              }}
            />
          </div>
        </div>
      )}

      {editingArtist && (
        <div className="modal-backdrop" onClick={() => setEditingArtist(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <ArtistForm
              initial={artist}
              onClose={() => {
                setEditingArtist(false);
                qc.invalidateQueries({ queryKey: ["artists", aid] });
                qc.invalidateQueries({ queryKey: ["stats", "artist-detail", aid] });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
