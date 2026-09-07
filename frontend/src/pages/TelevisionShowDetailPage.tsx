import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import {
  useEntryMutations, useGuildApi, useRankedTelevisionEpisodes, useTelevisionGenres, useTelevisionShow,
  useTelevisionShowEntry, useUpdateTelevisionShowEntry, usePeople,
} from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { CastRole, Genre, Person, TelevisionEpisode, TelevisionShow } from "../api/types";
import { CAST_ROLE_LABELS, TV_SHOW_ROLES } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LinksSection } from "../components/LinksSection";
import { MemberPicker } from "../components/MemberPicker";
import { PersonForm } from "../components/PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../components/PersonPicker";
import { SortableList } from "../components/SortableList";
import { TelevisionEpisodeForm } from "../components/TelevisionEpisodeForm";
import { TelevisionShowForm } from "../components/TelevisionShowForm";
import { TmdbTelevisionEpisodeImportDialog } from "../components/TmdbTelevisionEpisodeImportDialog";
import { GenreChooser } from "../genre/GenreChooser";
import { TELEVISION_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { BusyButton, InlineBusy, LoadingState, Spinner } from "../components/Spinner";

function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`;
  return `${m}m`;
}

type PendingLink = { personId: number; role: CastRole };
function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

// ── People section ──────────────────────────────────────────────────────────

function ShowPeopleSection({ showId, show }: { showId: number; show: TelevisionShow }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const { data: allPeople = [], isLoading: peopleLoading } = usePeople();
  const [editing, setEditing] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<CastRole>("creator");

  const castKeys = useMemo(() => new Set(show.persons.map((p) => linkKey({ personId: p.id, role: p.role }))), [show.persons]);

  const filteredPeople = useMemo(() => {
    return allPeople
      .filter((p) => matchesPersonSearch(p, searchField, search))
      .sort((a, b) => {
        const aKey = linkKey({ personId: a.id, role: addRole });
        const bKey = linkKey({ personId: b.id, role: addRole });
        return (castKeys.has(aKey) ? 0 : 1) - (castKeys.has(bKey) ? 0 : 1);
      });
  }, [search, searchField, allPeople, castKeys, addRole]);

  const invalidate = () => qc.invalidateQueries({ queryKey: gk(guildId, "television", "shows", showId) });

  const link = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: CastRole }) =>
      api.put(`${base}/television/shows/${showId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: CastRole }) =>
      api.delete(`${base}/television/shows/${showId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });

  function toggleLink(person: Person, role: CastRole) {
    const key = linkKey({ personId: person.id, role });
    if (castKeys.has(key)) unlink.mutate({ pid: person.id, role });
    else link.mutate({ pid: person.id, role });
  }

  const byRole: Partial<Record<CastRole, TelevisionShow["persons"]>> = {};
  for (const p of show.persons) (byRole[p.role] ??= []).push(p);

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>People</h2>
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
          {dupWarning && (
            <div className="dup-warning">
              <span>{dupWarning}</span>
              <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
            </div>
          )}
          <div style={{ marginBottom: "0.75rem" }}>
            <PersonPicker
              roles={TV_SHOW_ROLES}
              roleLabels={CAST_ROLE_LABELS}
              activeRole={addRole}
              onRole={setAddRole}
              searchField={searchField}
              onSearchField={setSearchField}
              search={search}
              onSearch={setSearch}
              onNewPerson={() => setCreatingPerson(true)}
              people={filteredPeople}
              isChecked={(p, role) => castKeys.has(linkKey({ personId: p.id, role }))}
              onToggle={toggleLink}
              loading={peopleLoading}
              busy={link.isPending || unlink.isPending}
            />
          </div>
        </>
      )}

      {show.persons.length > 0 ? (
        TV_SHOW_ROLES.filter((r) => byRole[r]?.length).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>{CAST_ROLE_LABELS[role]}</div>
            <ul className="sortable plain-list">
              {byRole[role]!.map((p) => (
                <li key={`${p.id}:${p.role}`} className="sortable-item">
                  <div className="row" style={{ gridTemplateColumns: "1fr" }}>
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

// ── Genres section ───────────────────────────────────────────────────────────

function ShowGenresSection({ showId, show }: { showId: number; show: TelevisionShow }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useTelevisionGenres();

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => { setGenreIds(new Set(show.genre_ids)); }, [show.genre_ids]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));
  const showGenres = show.genre_ids.map((id) => genreMap[id]).filter(Boolean);

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`${base}/television/shows/${showId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "television") }),
  });
  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`${base}/television/shows/${showId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "television") }),
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
          <GenreChooser domain={TELEVISION_GENRES} selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {showGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {showGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/g/${guildId}/television/genres/${g.id}`}>{g.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No genres linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove genre "${confirmUnlink.name}" from this show?`}
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
// Shows carry only personal notes — watch counts live on episodes, not the show.

function MyShowListSection({ showId }: { showId: number }) {
  const canRank = useCan("rank");
  const { data: entry, isLoading } = useTelevisionShowEntry(showId);
  const update = useUpdateTelevisionShowEntry(showId);
  const entryMutations = useEntryMutations("television/shows");
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (entry) setNotes(entry.notes ?? "");
  }, [entry]);

  if (!canRank) return null;
  const saving = update.isPending || entryMutations.add.isPending || entryMutations.remove.isPending;

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

      {isLoading ? (<LoadingState compact />) : !entry ? (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>
          Not in your list. <BusyButton busy={entryMutations.add.isPending} busyLabel="Adding…"
                                        onClick={() => entryMutations.add.mutate(showId)}>+ Add to my list</BusyButton>
        </p>
      ) : editing ? (
        <div className="detail-section-form">
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
        entry.notes
          ? <div className="detail-tags"><span className="detail-label">My notes</span><span>{entry.notes}</span></div>
          : <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No personal notes yet.</p>
      )}

      {confirmRemove && (
        <ConfirmDialog
          message="Remove this show from your list? Your personal notes for it will be lost. (Your episode rankings are separate and won't be affected.)"
          confirmLabel="Remove"
          busy={entryMutations.remove.isPending}
          onConfirm={() => entryMutations.remove.mutate(showId, { onSettled: () => { setConfirmRemove(false); setEditing(false); } })}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function TelevisionShowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sid = Number(id);
  const qc = useQueryClient();
  const { guildId, userId: me, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");

  const [editing, setEditing] = useState<{ episode: TelevisionEpisode } | "new" | null>(null);
  const [editingShow, setEditingShow] = useState(false);
  const [importingEpisode, setImportingEpisode] = useState<{ episode?: TelevisionEpisode } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ episode: TelevisionEpisode; rankingsDestroyed: number } | null>(null);
  const [confirmRemoveFromList, setConfirmRemoveFromList] = useState<TelevisionEpisode | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingUser, setViewingUser] = useState(me);
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: show, isLoading: showLoading, isError: showError } = useTelevisionShow(sid);
  const { data: ranked = [], isLoading: rankedLoading } = useRankedTelevisionEpisodes(sid, viewingUser);
  const isMine = viewingUser === me;

  const rankKey = rk(guildId, me, "television", "shows", sid, "episodes", "ranked");

  const moveEpisode = useMutation({
    mutationFn: (v: { episodeId: number; position: number }) =>
      api.put(`${base}/television/episodes/${v.episodeId}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows", sid, "episodes") }),
  });

  const adjustWatches = useMutation({
    mutationFn: ({ episodeId, watches }: { episodeId: number; watches: number }) =>
      api.put(`${base}/television/episodes/${episodeId}/entry`, { watches }),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows", sid, "episodes") }),
  });

  const removeEntry = useMutation({
    mutationFn: (episodeId: number) => api.delete(`${base}/television/episodes/${episodeId}/entry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows", sid, "episodes") }),
  });

  const remove = useMutation({
    mutationFn: (episodeId: number) => api.delete(`${base}/television/episodes/${episodeId}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "television", "shows", sid) });
      qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows", sid, "episodes") });
    },
  });

  async function confirmRemoval(episode: TelevisionEpisode) {
    setImpactFor(episode.id);
    setActionError(null);
    try {
      const { rankings_destroyed } = await api.get<{ rankings_destroyed: number }>(`${base}/television/episodes/${episode.id}/impact`);
      setConfirmDelete({ episode, rankingsDestroyed: rankings_destroyed });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setImpactFor(null);
    }
  }

  function toggleExpand(episodeId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(episodeId) ? next.delete(episodeId) : next.add(episodeId);
      return next;
    });
  }

  if (showLoading) return <section><LoadingState label="Loading show…" /></section>;
  if (showError || !show) return <section><p>Show not found.</p></section>;

  const allExpanded = ranked.length > 0 && expandedIds.size === ranked.length;
  const sortable = ranked.map((r) => ({ ...r.episode, position: r.position }));

  return (
    <section>
      <header className="page-head">
        <h1>
          {show.name}
          {show.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({show.name_en})</span>}
        </h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {canEdit && <button onClick={() => setEditingShow(true)}>✎ Edit</button>}
          {canEdit && <button onClick={() => setEditing("new")}>+ Add Episode</button>}
          {canEdit && <button onClick={() => setImportingEpisode({})}>Import Episode from TMDB</button>}
        </div>
      </header>
      {actionError && <p className="err">{actionError}</p>}
      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div><span className="detail-label">Release year</span><span>{show.release_year}</span></div>
          <div><span className="detail-label">Episodes</span><span>{show.episode_count}</span></div>
        </div>
        {show.soundtrack_albums.length > 0 && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Soundtrack</span>
            <span>
              {show.soundtrack_albums.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <Link to={`/g/${guildId}/music/albums/${a.id}`}>
                    {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
                  </Link>
                </span>
              ))}
            </span>
          </div>
        )}
        {show.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{show.notes}</span>
          </div>
        )}
      </div>

      <ShowPeopleSection showId={sid} show={show} />
      <ShowGenresSection showId={sid} show={show} />
      <LinksSection path="television/shows" section="television" ownerId={sid} />
      <MyShowListSection showId={sid} />

      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Episodes</h2>
        <div className="inline">
          <MemberPicker value={viewingUser} onChange={setViewingUser} />
          <button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(ranked.map((r) => r.episode.id)))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </header>

      <SortableList
          items={sortable}
          loading={rankedLoading}
          loadingLabel="Loading episodes…"
          empty={<p className="rank-empty">{isMine ? "No episodes ranked yet." : "This member hasn't ranked any episodes of this show yet."}</p>}
          pendingId={moveEpisode.isPending ? moveEpisode.variables?.episodeId ?? null : null}
          rowClassName="episode-row"
          disableDrag={!isMine}
          onReorder={(next) => qc.setQueryData(rankKey, next.map((e, i) => ({ ...ranked[i], position: i + 1, episode: e })))}
          onMove={(episodeId, position) => moveEpisode.mutate({ episodeId, position })}
          renderDetail={(e) =>
            expandedIds.has(e.id) ? (
              <div className="album-detail-dropdown">
                {e.genre_ids.length > 0 && (
                  <div className="album-detail-row">
                    <span className="detail-label">Genres</span>
                    <span>{e.genre_ids.length} linked</span>
                  </div>
                )}
                {e.links.length > 0 && (
                  <div className="album-detail-row">
                    <span className="detail-label">Links</span>
                    <span>
                      {e.links.map((l, i) => (
                        <span key={l.id}>{i > 0 && ", "}<a href={l.url} target="_blank" rel="noreferrer">{l.label ?? l.url}</a></span>
                      ))}
                    </span>
                  </div>
                )}
                {e.notes && <div className="album-detail-row"><span className="detail-label">Notes</span><span>{e.notes}</span></div>}
                {e.genre_ids.length === 0 && e.links.length === 0 && !e.notes && (
                  <span style={{ opacity: 0.5 }}>No extra info.</span>
                )}
              </div>
            ) : null
          }
          render={(e) => {
            const r = ranked.find((x) => x.episode.id === e.id)!;
            return (
              <>
                <span className="name">
                  <Link to={`/g/${guildId}/television/episodes/${e.id}`} className="plain-link">
                    {e.name}{e.name_en && <span style={{ opacity: 0.6 }}> ({e.name_en})</span>}
                  </Link>
                </span>
                <span className="meta">{e.release_year} · {fmtRuntime(e.runtime_minutes)}</span>
                {isMine ? (() => {
                  const counting = adjustWatches.isPending && adjustWatches.variables?.episodeId === e.id;
                  return (
                    <span className="listens-ctrl">
                      <button className="icon" title="Remove one watch" disabled={r.watches <= 1 || counting}
                              onClick={() => adjustWatches.mutate({ episodeId: e.id, watches: r.watches - 1 })}>−</button>
                      <span className="listens-count">{counting ? <Spinner size="sm" /> : `${r.watches}×`}</span>
                      <button className="icon" title="Add one watch" disabled={counting}
                              onClick={() => adjustWatches.mutate({ episodeId: e.id, watches: r.watches + 1 })}>+</button>
                    </span>
                  );
                })() : <span />}
                <button className="icon" title="Show details" onClick={() => toggleExpand(e.id)}>
                  {expandedIds.has(e.id) ? "▲" : "▼"}
                </button>
                {isMine
                  ? <button className="icon" title="Remove from my ranking" onClick={() => setConfirmRemoveFromList(e)}>✕ list</button>
                  : <span />}
                {canEdit ? <button className="icon" onClick={() => setEditing({ episode: e })}>✎</button> : <span />}
                {canEdit ? <button className="icon" title="Import credits from TMDB" onClick={() => setImportingEpisode({ episode: e })}>TMDB</button> : <span />}
                {canDelete ? (
                  <BusyButton className="icon" title="Delete from catalog" busy={impactFor === e.id} busyLabel={null}
                              onClick={() => void confirmRemoval(e)}>✕</BusyButton>
                ) : <span />}
              </>
            );
          }}
        />

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.episode.name}" from the guild catalog? ${confirmDelete.rankingsDestroyed} member ranking(s) will be destroyed.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.episode.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmRemoveFromList && (
        <ConfirmDialog
          message={`Remove "${confirmRemoveFromList.name}" from your list? Your watch count and personal notes for it will be lost.`}
          confirmLabel="Remove"
          busy={removeEntry.isPending}
          onConfirm={() => removeEntry.mutate(confirmRemoveFromList.id, { onSettled: () => setConfirmRemoveFromList(null) })}
          onCancel={() => setConfirmRemoveFromList(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TelevisionEpisodeForm
              show={show}
              initial={editing === "new" ? undefined : editing.episode}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}

      {editingShow && (
        <div className="modal-backdrop" onClick={() => setEditingShow(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TelevisionShowForm
              initial={show}
              onClose={() => {
                setEditingShow(false);
                qc.invalidateQueries({ queryKey: gk(guildId, "television", "shows", sid) });
              }}
            />
          </div>
        </div>
      )}

      {importingEpisode && (
        <div className="modal-backdrop" onClick={() => setImportingEpisode(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TmdbTelevisionEpisodeImportDialog
              show={show}
              episode={importingEpisode.episode}
              onClose={() => setImportingEpisode(null)}
              onSuccess={() => {
                setImportingEpisode(null);
                qc.invalidateQueries({ queryKey: gk(guildId, "television", "shows", sid) });
                qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows", sid, "episodes") });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
