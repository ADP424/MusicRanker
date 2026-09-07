import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AlbumForm } from "../components/AlbumForm";
import { ArtistForm } from "../components/ArtistForm";
import { CatalogList } from "../components/CatalogList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LinksSection } from "../components/LinksSection";
import { MemberPicker } from "../components/MemberPicker";
import { PersonForm } from "../components/PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../components/PersonPicker";
import { api } from "../api/client";
import { gk, rk } from "../api/keys";
import {
  useAlbumCatalog, useArtist, useGuildApi, useMusicGenres, usePeople, useRankedAlbums,
} from "../api/hooks";
import type { Album, BandRole, Person, PersonArtistRef, RankedAlbum } from "../api/types";
import { BAND_ROLES, BAND_ROLE_LABELS } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { SortableList } from "../components/SortableList";
import { BusyButton, InlineBusy, LoadingState, Spinner } from "../components/Spinner";

type AlbumView = "mine" | "catalog";

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
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const { data: allPeople = [], isLoading: peopleLoading } = usePeople();
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [addRole, setAddRole] = useState<BandRole>("member");

  const { data: artistPersons = [], isLoading: personsLoading } = useQuery({
    queryKey: gk(guildId, "artists", artistId, "persons"),
    queryFn: () => api.get<PersonArtistRef[]>(`${base}/artists/${artistId}/persons`),
  });

  const [castKeys, setCastKeys] = useState<Set<string>>(
    () => new Set(artistPersons.map((p) => `${p.id}:${p.role}`)),
  );
  useEffect(() => {
    setCastKeys(new Set(artistPersons.map((p) => `${p.id}:${p.role}`)));
  }, [artistPersons]);

  const linkedIds = useMemo(() => new Set(artistPersons.map((p) => p.id)), [artistPersons]);

  const filteredPeople = useMemo(() => {
    const filtered = allPeople.filter((p: Person) => matchesPersonSearch(p, searchField, search));
    return [...filtered].sort((a, b) => {
      const aLinked = linkedIds.has(a.id) ? 0 : 1;
      const bLinked = linkedIds.has(b.id) ? 0 : 1;
      if (aLinked !== bLinked) return aLinked - bLinked;
      return a.name.localeCompare(b.name);
    });
  }, [search, searchField, allPeople, linkedIds]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, "people") });
    qc.invalidateQueries({ queryKey: gk(guildId, "artists", artistId, "persons") });
  };

  const link = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: BandRole }) =>
      api.put(`${base}/artists/${artistId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });

  const unlink = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: BandRole }) =>
      api.delete(`${base}/artists/${artistId}/persons/${pid}/${role}`),
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

  const byRole: Record<BandRole, PersonArtistRef[]> = { core_member: [], member: [] };
  for (const p of artistPersons) byRole[p.role].push(p);

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>People</h2>
          {(link.isPending || unlink.isPending) && <InlineBusy label="Saving…" />}
        </span>
        {canEdit && (
          <button style={{ fontSize: 12 }} onClick={() => setChooserOpen((o) => !o)}>
            {chooserOpen ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {chooserOpen && (
        <>
          {dupWarning && (
            <div className="dup-warning">
              <span>{dupWarning}</span>
              <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
            </div>
          )}
          <div style={{ marginBottom: "0.75rem" }}>
            <PersonPicker
              roles={BAND_ROLES}
              roleLabels={BAND_ROLE_LABELS}
              activeRole={addRole}
              onRole={setAddRole}
              searchField={searchField}
              onSearchField={setSearchField}
              search={search}
              onSearch={setSearch}
              onNewPerson={() => setCreatingPerson(true)}
              people={filteredPeople}
              isChecked={(p, role) => castKeys.has(`${p.id}:${role}`)}
              onToggle={toggleLink}
              loading={peopleLoading}
              busy={link.isPending || unlink.isPending}
            />
          </div>
        </>
      )}

      {personsLoading ? (
        <LoadingState compact label="Loading people…" />
      ) : artistPersons.length > 0 ? (
        BAND_ROLES.filter((r) => byRole[r].length > 0).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>{BAND_ROLE_LABELS[role]}</div>
            <ul className="sortable plain-list">
              {byRole[role].map((p) => (
                <li key={`${p.id}:${p.role}`} className="sortable-item">
                  <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                    <Link className="name" to={`/g/${guildId}/people/${p.id}`}>
                      {p.name}{p.name_en && <span style={{ opacity: 0.6 }}> ({p.name_en})</span>}
                    </Link>
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
                  qc.invalidateQueries({ queryKey: gk(guildId, "people") });
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
  const { guildId, userId: me, base } = useGuildApi();
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");

  const [view, setView] = useState<AlbumView>("mine");
  const [editing, setEditing] = useState<{ album: RankedAlbum["album"] } | "new" | null>(null);
  const [editingArtist, setEditingArtist] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ album: RankedAlbum["album"]; rankingsDestroyed: number } | null>(null);
  const [confirmRemoveFromList, setConfirmRemoveFromList] = useState<RankedAlbum["album"] | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingUser, setViewingUser] = useState(me);
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: genres = [] } = useMusicGenres();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));

  const { data: artist, isLoading: artistLoading, isError: artistError } = useArtist(aid);
  const { data: ranked = [], isLoading: rankedLoading } = useRankedAlbums(aid, viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useAlbumCatalog(aid);
  const isMine = viewingUser === me;

  const rankKey = rk(guildId, me, "artists", aid, "albums", "ranked");

  const invalidateAlbums = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, "artists", aid, "albums") });
    qc.invalidateQueries({ queryKey: rk(guildId, me, "artists", aid, "albums") });
  };

  const moveAlbum = useMutation({
    mutationFn: (v: { albumId: number; position: number }) =>
      api.put(`${base}/artists/${aid}/albums/${v.albumId}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "artists", aid, "albums") }),
  });

  const adjustListens = useMutation({
    mutationFn: ({ albumId, listens }: { albumId: number; listens: number }) =>
      api.put(`${base}/artists/${aid}/albums/${albumId}/entry`, { listens }),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "artists", aid, "albums") }),
  });

  const addEntry = useMutation({
    mutationFn: (albumId: number) => api.put(`${base}/artists/${aid}/albums/${albumId}/entry`, {}),
    onSuccess: invalidateAlbums,
  });

  const removeEntry = useMutation({
    mutationFn: (albumId: number) => api.delete(`${base}/artists/${aid}/albums/${albumId}/entry`),
    onSuccess: invalidateAlbums,
  });

  const remove = useMutation({
    mutationFn: (albumId: number) => api.delete(`${base}/albums/${albumId}`),
    onSettled: () => {
      invalidateAlbums();
      qc.invalidateQueries({ queryKey: gk(guildId, "artists") });
    },
  });

  async function confirmRemoval(album: RankedAlbum["album"]) {
    setImpactFor(album.id);
    setActionError(null);
    try {
      const { rankings_destroyed } = await api.get<{ rankings_destroyed: number }>(`${base}/albums/${album.id}/impact`);
      setConfirmDelete({ album, rankingsDestroyed: rankings_destroyed });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setImpactFor(null);
    }
  }

  function toggleExpand(albumId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(albumId) ? next.delete(albumId) : next.add(albumId);
      return next;
    });
  }

  function renderAlbumDetail(a: Album) {
    if (!expandedIds.has(a.id)) return null;
    return (
      <div className="album-detail-dropdown">
        {a.alias && <div className="album-detail-row"><span className="detail-label">Alias</span><span>{a.alias}</span></div>}
        {a.genre_ids.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Genres</span>
            <span>
              {a.genre_ids.filter((id) => genreMap[id]).sort((x, y) => genreMap[x].localeCompare(genreMap[y])).map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <Link className="plain-link" to={`/g/${guildId}/music/genres/${id}`}>{genreMap[id]}</Link>
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
                <span key={ar.id}>{i > 0 && ", "}{ar.name}{ar.name_en && <span style={{ opacity: 0.6 }}> ({ar.name_en})</span>}</span>
              ))}
            </span>
          </div>
        )}
        {a.links.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Links</span>
            <span>
              {a.links.map((l, i) => (
                <span key={l.id}>{i > 0 && ", "}<a href={l.url} target="_blank" rel="noreferrer">{l.label ?? l.url}</a></span>
              ))}
            </span>
          </div>
        )}
        {a.notes && <div className="album-detail-row"><span className="detail-label">Notes</span><span>{a.notes}</span></div>}
        {!a.alias && a.artists.length <= 1 && a.links.length === 0 && !a.notes && a.genre_ids.length === 0 && (
          <span style={{ opacity: 0.5 }}>No extra info.</span>
        )}
      </div>
    );
  }

  if (artistLoading) return <section><LoadingState label="Loading artist…" /></section>;
  if (artistError || !artist) return <section><p>Artist not found.</p></section>;

  const allExpanded = ranked.length > 0 && expandedIds.size === ranked.length;
  const primaryGenre = artist.primary_genre != null ? genres.find((g) => g.id === artist.primary_genre) : undefined;
  const sortable = ranked.map((r) => ({ ...r.album, position: r.position }));

  return (
    <section>
      <header className="page-head">
        <h1>
          {artist.name}
          {artist.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({artist.name_en})</span>}
        </h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {canEdit && <button onClick={() => setEditingArtist(true)}>✎ Edit</button>}
          {canCreate && <button onClick={() => setEditing("new")}>+ Add Album</button>}
        </div>
      </header>
      {actionError && <p className="err">{actionError}</p>}
      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div><span className="detail-label">Albums</span><span>{artist.album_count}</span></div>
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
            <Link to={`/g/${guildId}/music/genres/${primaryGenre.id}`} className="plain-link">{primaryGenre.name}</Link>
          </div>
        )}
        {artist.notes && (
          <div className="detail-tags">
            <span className="detail-label">Notes</span>
            <span>{artist.notes}</span>
          </div>
        )}
      </div>

      <ArtistPeopleSection artistId={aid} />
      <LinksSection path="artists" section="artists" ownerId={aid} />

      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Albums</h2>
        <div className="inline">
          <div className="view-toggle">
            <button className={view === "mine" ? "view-toggle-active" : ""} onClick={() => setView("mine")}>Ranking</button>
            <button className={view === "catalog" ? "view-toggle-active" : ""} onClick={() => setView("catalog")}>Catalog</button>
          </div>
          {view === "mine" && <MemberPicker value={viewingUser} onChange={setViewingUser} />}
          <button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(ranked.map((r) => r.album.id)))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </header>

      {view === "mine" && (
        <SortableList
          items={sortable}
          loading={rankedLoading}
          loadingLabel="Loading ranking…"
          empty={<p className="rank-empty">{isMine ? "No albums ranked yet." : "This member hasn't ranked any albums by this artist yet."}</p>}
          pendingId={moveAlbum.isPending ? moveAlbum.variables?.albumId ?? null : null}
          rowClassName="album-row"
          disableDrag={!isMine}
          onReorder={(next) => qc.setQueryData(rankKey, next.map((a, i) => ({ ...ranked[i], position: i + 1, album: a })))}
          onMove={(albumId, position) => moveAlbum.mutate({ albumId, position })}
          renderDetail={renderAlbumDetail}
          render={(a) => {
            const r = ranked.find((x) => x.album.id === a.id)!;
            return (
              <>
                <span className="name">
                  <Link to={`/g/${guildId}/music/albums/${a.id}`} className="plain-link">
                    {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
                  </Link>
                </span>
                <span className="meta">{a.release_year} · {fmtRuntime(a.runtime_seconds)}</span>
                {isMine ? (() => {
                  const counting = adjustListens.isPending && adjustListens.variables?.albumId === a.id;
                  return (
                    <span className="listens-ctrl">
                      <button className="icon" title="Remove one listen" disabled={r.listens <= 1 || counting}
                              onClick={() => adjustListens.mutate({ albumId: a.id, listens: r.listens - 1 })}>−</button>
                      <span className="listens-count">{counting ? <Spinner size="sm" /> : `${r.listens}×`}</span>
                      <button className="icon" title="Add one listen" disabled={counting}
                              onClick={() => adjustListens.mutate({ albumId: a.id, listens: r.listens + 1 })}>+</button>
                    </span>
                  );
                })() : <span />}
                <button className="icon" title="Show details" onClick={() => toggleExpand(a.id)}>
                  {expandedIds.has(a.id) ? "▲" : "▼"}
                </button>
                {isMine
                  ? <button className="icon" title="Remove from my ranking" onClick={() => setConfirmRemoveFromList(a)}>✕ list</button>
                  : <span />}
                {canEdit ? <button className="icon" onClick={() => setEditing({ album: a })}>✎</button> : <span />}
                {canDelete ? (
                  <BusyButton className="icon" title="Delete from catalog" busy={impactFor === a.id} busyLabel={null}
                              onClick={() => void confirmRemoval(a)}>✕</BusyButton>
                ) : <span />}
              </>
            );
          }}
        />
      )}

      {view === "catalog" && (
        <CatalogList
          items={catalog}
          loading={catalogLoading}
          empty={<p><small>No albums by this artist in the catalog yet.</small></p>}
          rowClassName="catalog-row"
          renderDetail={renderAlbumDetail}
          render={(a) => (
            <>
              <span className="name">
                <Link to={`/g/${guildId}/music/albums/${a.id}`} className="plain-link">
                  {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
                </Link>
              </span>
              <span className="meta">{a.release_year} · {fmtRuntime(a.runtime_seconds)}</span>
              {a.in_my_list
                ? <span className="meta">in your list</span>
                : (
                  <BusyButton busy={addEntry.isPending && addEntry.variables === a.id} busyLabel="Adding…"
                              onClick={() => addEntry.mutate(a.id)}>+ Add to my list</BusyButton>
                )}
              <button className="icon" title="Show details" onClick={() => toggleExpand(a.id)}>
                {expandedIds.has(a.id) ? "▲" : "▼"}
              </button>
              {canEdit ? <button className="icon" onClick={() => setEditing({ album: a })}>✎</button> : <span />}
              {canDelete ? (
                <BusyButton className="icon" title="Delete from catalog" busy={impactFor === a.id} busyLabel={null}
                            onClick={() => void confirmRemoval(a)}>✕</BusyButton>
              ) : <span />}
            </>
          )}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.album.name}" from the guild catalog? ${confirmDelete.rankingsDestroyed} member ranking(s) will be destroyed.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.album.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmRemoveFromList && (
        <ConfirmDialog
          message={`Remove "${confirmRemoveFromList.name}" from your list? Your listen count and personal notes for it will be lost.`}
          confirmLabel="Remove"
          busy={removeEntry.isPending}
          onConfirm={() => removeEntry.mutate(confirmRemoveFromList.id, { onSettled: () => setConfirmRemoveFromList(null) })}
          onCancel={() => setConfirmRemoveFromList(null)}
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

      {editingArtist && (
        <div className="modal-backdrop" onClick={() => setEditingArtist(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <ArtistForm
              initial={artist}
              onClose={() => {
                setEditingArtist(false);
                qc.invalidateQueries({ queryKey: gk(guildId, "artists", aid) });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
