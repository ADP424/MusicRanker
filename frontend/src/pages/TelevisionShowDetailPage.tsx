import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import {
  useEntryMutations, useGuildApi, useRankedTelevisionSeasons, useTelevisionGenres, useTelevisionSeasons,
  useTelevisionShow, useTelevisionShowEntry, useUpdateTelevisionShowEntry,
} from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { Genre, TelevisionSeason, TelevisionShow } from "../api/types";
import { TV_SHOW_ROLES } from "../api/types";
import { CatalogList } from "../components/CatalogList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LinksSection } from "../components/LinksSection";
import { MemberPicker } from "../components/MemberPicker";
import { SortableList } from "../components/SortableList";
import { BusyButton, InlineBusy, LoadingState } from "../components/Spinner";
import { TelevisionSeasonForm } from "../components/TelevisionSeasonForm";
import { TelevisionShowForm } from "../components/TelevisionShowForm";
import { TmdbTelevisionSeasonImportDialog } from "../components/TmdbTelevisionSeasonImportDialog";
import { TvPeopleSection } from "../components/TvPeopleSection";
import { GenreChooser } from "../genre/GenreChooser";
import { TELEVISION_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";

export function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`;
  return `${m}m`;
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
          message="Remove this show from your list? Your personal notes for it will be lost. (Your season and episode rankings are separate and won't be affected.)"
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

type SeasonImpact = { rankings_destroyed: number; episodes_destroyed: number; episode_rankings_destroyed: number };

export function TelevisionShowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sid = Number(id);
  const qc = useQueryClient();
  const { guildId, userId: me, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");

  const [editing, setEditing] = useState<{ season: TelevisionSeason } | "new" | null>(null);
  const [editingShow, setEditingShow] = useState(false);
  const [importingSeason, setImportingSeason] = useState<{ season?: TelevisionSeason } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ season: TelevisionSeason; impact: SeasonImpact } | null>(null);
  const [confirmRemoveFromList, setConfirmRemoveFromList] = useState<TelevisionSeason | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingUser, setViewingUser] = useState(me);
  const [view, setView] = useState<"mine" | "catalog">("mine");
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: show, isLoading: showLoading, isError: showError } = useTelevisionShow(sid);
  const { data: ranked = [], isLoading: rankedLoading } = useRankedTelevisionSeasons(sid, viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useTelevisionSeasons(sid);
  const isMine = viewingUser === me;

  const rankKey = rk(guildId, me, "television", "shows", sid, "seasons", "ranked");
  const invalidateMine = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, "television", "shows", sid, "seasons") });
    qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows", sid, "seasons") });
  };

  const moveSeason = useMutation({
    mutationFn: (v: { seasonId: number; position: number }) =>
      api.put(`${base}/television/seasons/${v.seasonId}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows", sid, "seasons") }),
  });

  const addEntry = useMutation({
    mutationFn: (seasonId: number) => api.put(`${base}/television/seasons/${seasonId}/entry`, {}),
    onSuccess: invalidateMine,
  });

  const removeEntry = useMutation({
    mutationFn: (seasonId: number) => api.delete(`${base}/television/seasons/${seasonId}/entry`),
    onSuccess: invalidateMine,
  });

  const remove = useMutation({
    mutationFn: (seasonId: number) => api.delete(`${base}/television/seasons/${seasonId}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "television") });
      qc.invalidateQueries({ queryKey: rk(guildId, me, "television") });
    },
  });

  async function confirmRemoval(season: TelevisionSeason) {
    setImpactFor(season.id);
    setActionError(null);
    try {
      const impact = await api.get<SeasonImpact>(`${base}/television/seasons/${season.id}/impact`);
      setConfirmDelete({ season, impact });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setImpactFor(null);
    }
  }

  function toggleExpand(seasonId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(seasonId) ? next.delete(seasonId) : next.add(seasonId);
      return next;
    });
  }

  if (showLoading) return <section><LoadingState label="Loading show…" /></section>;
  if (showError || !show) return <section><p>Show not found.</p></section>;

  const shownIds = view === "mine" ? ranked.map((r) => r.season.id) : catalog.map((s) => s.id);
  const allExpanded = shownIds.length > 0 && expandedIds.size === shownIds.length;

  const seasonLink = (s: TelevisionSeason) => (
    <span className="name">
      <Link to={`/g/${guildId}/television/seasons/${s.id}`} className="plain-link">
        {s.name}{s.name_en && <span style={{ opacity: 0.6 }}> ({s.name_en})</span>}
      </Link>
    </span>
  );
  const seasonMeta = (s: TelevisionSeason) => (
    <span className="meta">
      {s.release_year} · {s.episode_count} episode{s.episode_count !== 1 ? "s" : ""}
      {s.runtime_minutes > 0 && ` · ${fmtRuntime(s.runtime_minutes)}`}
    </span>
  );
  const catalogActions = (s: TelevisionSeason) => (
    <>
      {canEdit ? <button className="icon" title="Edit season" onClick={() => setEditing({ season: s })}>✎</button> : <span />}
      {canEdit ? <button className="icon" title="Import season credits from TMDB" onClick={() => setImportingSeason({ season: s })}>TMDB</button> : <span />}
      {canDelete ? (
        <BusyButton className="icon" title="Delete from catalog" busy={impactFor === s.id} busyLabel={null}
                    onClick={() => void confirmRemoval(s)}>✕</BusyButton>
      ) : <span />}
    </>
  );

  const renderSeasonDetail = (s: TelevisionSeason) =>
    expandedIds.has(s.id) ? (
      <div className="album-detail-dropdown">
        {s.persons.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">People</span>
            <span>{s.persons.map((p) => p.name).filter((n, i, a) => a.indexOf(n) === i).join(", ")}</span>
          </div>
        )}
        {s.links.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Links</span>
            <span>
              {s.links.map((l, i) => (
                <span key={l.id}>{i > 0 && ", "}<a href={l.url} target="_blank" rel="noreferrer">{l.label ?? l.url}</a></span>
              ))}
            </span>
          </div>
        )}
        {s.notes && <div className="album-detail-row"><span className="detail-label">Notes</span><span>{s.notes}</span></div>}
        {s.persons.length === 0 && s.links.length === 0 && !s.notes && (
          <span style={{ opacity: 0.5 }}>No extra info.</span>
        )}
      </div>
    ) : null;

  const sortable = ranked.map((r) => ({ ...r.season, position: r.position }));

  return (
    <section>
      <header className="page-head">
        <h1>
          {show.name}
          {show.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({show.name_en})</span>}
        </h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {canEdit && <button onClick={() => setEditingShow(true)}>✎ Edit</button>}
          {canEdit && <button onClick={() => setEditing("new")}>+ Add Season</button>}
          {canEdit && <button onClick={() => setImportingSeason({})}>Import Season from TMDB</button>}
        </div>
      </header>
      {actionError && <p className="err">{actionError}</p>}
      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div><span className="detail-label">Release year</span><span>{show.release_year}</span></div>
          <div><span className="detail-label">Seasons</span><span>{show.season_count}</span></div>
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
        {(show.source_books ?? []).length > 0 && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Based on</span>
            <span>
              {show.source_books.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ", "}
                  <Link to={`/g/${guildId}/books/${b.id}`}>
                    {b.name}{b.name_en && <span style={{ opacity: 0.6 }}> ({b.name_en})</span>}
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

      <TvPeopleSection
        path="television/shows"
        ownerId={sid}
        persons={show.persons}
        roles={TV_SHOW_ROLES}
        defaultRole="creator"
        populateDown={{
          label: "Populate down",
          confirm: `Attach the show's people to all ${show.season_count} season(s) and ${show.episode_count} episode(s)? Creators stay on the show; anyone already credited is left as is.`,
        }}
      />
      <ShowGenresSection showId={sid} show={show} />
      <LinksSection path="television/shows" section="television" ownerId={sid} />
      <MyShowListSection showId={sid} />

      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>Seasons</h2>
          <Link to={`/g/${guildId}/television/shows/${sid}/rank`} style={{ fontSize: 13 }}>Rank seasons →</Link>
        </span>
        <div className="inline">
          <div className="view-toggle">
            <button className={view === "mine" ? "view-toggle-active" : ""} onClick={() => setView("mine")}>Ranking</button>
            <button className={view === "catalog" ? "view-toggle-active" : ""} onClick={() => setView("catalog")}>Catalog</button>
          </div>
          {view === "mine" && <MemberPicker value={viewingUser} onChange={setViewingUser} />}
          <button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(shownIds))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </header>

      {view === "mine" && (
        <SortableList
          items={sortable}
          loading={rankedLoading}
          loadingLabel="Loading seasons…"
          empty={<p className="rank-empty">{isMine ? "No seasons ranked yet." : "This member hasn't ranked any seasons of this show yet."}</p>}
          pendingId={moveSeason.isPending ? moveSeason.variables?.seasonId ?? null : null}
          rowClassName="season-row"
          disableDrag={!isMine}
          onReorder={(next) => qc.setQueryData(rankKey, next.map((s, i) => ({ ...ranked[i], position: i + 1, season: s })))}
          onMove={(seasonId, position) => moveSeason.mutate({ seasonId, position })}
          renderDetail={renderSeasonDetail}
          render={(s) => (
            <>
              {seasonLink(s)}
              {seasonMeta(s)}
              <button className="icon" title="Show details" onClick={() => toggleExpand(s.id)}>
                {expandedIds.has(s.id) ? "▲" : "▼"}
              </button>
              {isMine
                ? <button className="icon" title="Remove from my ranking" onClick={() => setConfirmRemoveFromList(s)}>✕ list</button>
                : <span />}
              {catalogActions(s)}
            </>
          )}
        />
      )}

      {view === "catalog" && (
        <CatalogList
          items={catalog}
          loading={catalogLoading}
          loadingLabel="Loading seasons…"
          empty={<p><small>No seasons in the catalog for this show yet.</small></p>}
          rowClassName="tv-catalog-row"
          renderDetail={renderSeasonDetail}
          render={(s) => (
            <>
              {seasonLink(s)}
              {seasonMeta(s)}
              {s.in_my_list
                ? <span className="meta">in your list</span>
                : (
                  <BusyButton busy={addEntry.isPending && addEntry.variables === s.id} busyLabel="Adding…"
                              onClick={() => addEntry.mutate(s.id)}>+ Add to my list</BusyButton>
                )}
              <button className="icon" title="Show details" onClick={() => toggleExpand(s.id)}>
                {expandedIds.has(s.id) ? "▲" : "▼"}
              </button>
              {catalogActions(s)}
            </>
          )}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.season.name}" from the guild catalog? This also deletes its ${confirmDelete.impact.episodes_destroyed} episode(s). ${confirmDelete.impact.rankings_destroyed} season ranking(s) and ${confirmDelete.impact.episode_rankings_destroyed} episode ranking(s) will be destroyed.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.season.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmRemoveFromList && (
        <ConfirmDialog
          message={`Remove "${confirmRemoveFromList.name}" from your list? Your personal notes for it will be lost. (Your episode rankings are separate and won't be affected.)`}
          confirmLabel="Remove"
          busy={removeEntry.isPending}
          onConfirm={() => removeEntry.mutate(confirmRemoveFromList.id, { onSettled: () => setConfirmRemoveFromList(null) })}
          onCancel={() => setConfirmRemoveFromList(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TelevisionSeasonForm
              show={show}
              initial={editing === "new" ? undefined : editing.season}
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

      {importingSeason && (
        <div className="modal-backdrop" onClick={() => setImportingSeason(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TmdbTelevisionSeasonImportDialog
              show={show}
              season={importingSeason.season}
              onClose={() => setImportingSeason(null)}
              onSuccess={() => {
                setImportingSeason(null);
                qc.invalidateQueries({ queryKey: gk(guildId, "television") });
                qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows", sid, "seasons") });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
