import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import {
  useGuildApi, useRankedTelevisionEpisodes, useTelevisionEpisodes, useTelevisionSeason, useTelevisionSeasonEntry,
  useTelevisionShow, useUpdateTelevisionSeasonEntry,
} from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { TelevisionEpisode } from "../api/types";
import { TV_SEASON_ROLES } from "../api/types";
import { CatalogList } from "../components/CatalogList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LinksSection } from "../components/LinksSection";
import { MemberPicker } from "../components/MemberPicker";
import { SortableList } from "../components/SortableList";
import { BusyButton, InlineBusy, LoadingState, Spinner } from "../components/Spinner";
import { TelevisionEpisodeForm } from "../components/TelevisionEpisodeForm";
import { TelevisionSeasonForm } from "../components/TelevisionSeasonForm";
import { TmdbTelevisionEpisodeImportDialog } from "../components/TmdbTelevisionEpisodeImportDialog";
import { TmdbTelevisionSeasonImportDialog } from "../components/TmdbTelevisionSeasonImportDialog";
import { TvPeopleSection } from "../components/TvPeopleSection";
import { useCan } from "../guild/GuildProvider";
import { fmtRuntime } from "./TelevisionShowDetailPage";

// ── My list section ──────────────────────────────────────────────────────────
// Seasons carry only personal notes — watch counts live on episodes.

function MySeasonListSection({ showId, seasonId }: { showId: number; seasonId: number }) {
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const { data: entry, isLoading } = useTelevisionSeasonEntry(seasonId);
  const update = useUpdateTelevisionSeasonEntry(showId, seasonId);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (entry) setNotes(entry.notes ?? "");
  }, [entry]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, "television", "shows", showId, "seasons") });
    qc.invalidateQueries({ queryKey: gk(guildId, "television", "seasons", seasonId) });
    qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "shows", showId, "seasons") });
    qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "seasons", seasonId, "entry") });
  };
  const add = useMutation({
    mutationFn: () => api.put(`${base}/television/seasons/${seasonId}/entry`, {}),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`${base}/television/seasons/${seasonId}/entry`),
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

      {isLoading ? (<LoadingState compact />) : !entry ? (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>
          Not in your list. <BusyButton busy={add.isPending} busyLabel="Adding…" onClick={() => add.mutate()}>+ Add to my list</BusyButton>
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
          message="Remove this season from your list? Your personal notes for it will be lost. (Your episode rankings are separate and won't be affected.)"
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

export function TelevisionSeasonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const seid = Number(id);
  const qc = useQueryClient();
  const { guildId, userId: me, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");

  const [editing, setEditing] = useState<{ episode: TelevisionEpisode } | "new" | null>(null);
  const [editingSeason, setEditingSeason] = useState(false);
  const [importingSeason, setImportingSeason] = useState(false);
  const [importingEpisode, setImportingEpisode] = useState<{ episode?: TelevisionEpisode } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ episode: TelevisionEpisode; rankingsDestroyed: number } | null>(null);
  const [confirmRemoveFromList, setConfirmRemoveFromList] = useState<TelevisionEpisode | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingUser, setViewingUser] = useState(me);
  const [view, setView] = useState<"mine" | "catalog">("mine");
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: season, isLoading: seasonLoading, isError: seasonError } = useTelevisionSeason(seid);
  const { data: show } = useTelevisionShow(season?.show_id ?? 0);
  const { data: ranked = [], isLoading: rankedLoading } = useRankedTelevisionEpisodes(seid, viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useTelevisionEpisodes(seid);
  const isMine = viewingUser === me;

  const rankKey = rk(guildId, me, "television", "seasons", seid, "episodes", "ranked");
  const invalidateMine = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, "television", "seasons", seid, "episodes") });
    qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "seasons", seid, "episodes") });
  };

  const moveEpisode = useMutation({
    mutationFn: (v: { episodeId: number; position: number }) =>
      api.put(`${base}/television/episodes/${v.episodeId}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "seasons", seid, "episodes") }),
  });

  const adjustWatches = useMutation({
    mutationFn: ({ episodeId, watches }: { episodeId: number; watches: number }) =>
      api.put(`${base}/television/episodes/${episodeId}/entry`, { watches }),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "seasons", seid, "episodes") }),
  });

  const addEntry = useMutation({
    mutationFn: (episodeId: number) => api.put(`${base}/television/episodes/${episodeId}/entry`, {}),
    onSuccess: invalidateMine,
  });

  const removeEntry = useMutation({
    mutationFn: (episodeId: number) => api.delete(`${base}/television/episodes/${episodeId}/entry`),
    onSuccess: invalidateMine,
  });

  const remove = useMutation({
    mutationFn: (episodeId: number) => api.delete(`${base}/television/episodes/${episodeId}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "television") });
      qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "seasons", seid, "episodes") });
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

  if (seasonLoading) return <section><LoadingState label="Loading season…" /></section>;
  if (seasonError || !season) return <section><p>Season not found.</p></section>;

  const shownIds = view === "mine" ? ranked.map((r) => r.episode.id) : catalog.map((e) => e.id);
  const allExpanded = shownIds.length > 0 && expandedIds.size === shownIds.length;

  const renderEpisodeDetail = (e: TelevisionEpisode) =>
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
    ) : null;

  const episodeLink = (e: TelevisionEpisode) => (
    <span className="name">
      <Link to={`/g/${guildId}/television/episodes/${e.id}`} className="plain-link">
        {e.name}{e.name_en && <span style={{ opacity: 0.6 }}> ({e.name_en})</span>}
      </Link>
    </span>
  );
  const catalogActions = (e: TelevisionEpisode) => (
    <>
      {canEdit && show ? <button className="icon" onClick={() => setEditing({ episode: e })}>✎</button> : <span />}
      {canEdit && show ? <button className="icon" title="Import credits from TMDB" onClick={() => setImportingEpisode({ episode: e })}>TMDB</button> : <span />}
      {canDelete ? (
        <BusyButton className="icon" title="Delete from catalog" busy={impactFor === e.id} busyLabel={null}
                    onClick={() => void confirmRemoval(e)}>✕</BusyButton>
      ) : <span />}
    </>
  );

  const sortable = ranked.map((r) => ({ ...r.episode, position: r.position }));

  return (
    <section>
      <Link to={`/g/${guildId}/television/shows/${season.show_id}`} className="back-link">
        ← {show?.name ?? "Show"}
      </Link>
      <header className="page-head">
        <h1>
          {season.name}
          {season.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({season.name_en})</span>}
        </h1>
        {show && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {canEdit && <button onClick={() => setEditingSeason(true)}>✎ Edit</button>}
            {canEdit && <button onClick={() => setImportingSeason(true)}>Import Season Credits from TMDB</button>}
            {canEdit && <button onClick={() => setEditing("new")}>+ Add Episode</button>}
            {canEdit && <button onClick={() => setImportingEpisode({})}>Import Episode from TMDB</button>}
          </div>
        )}
      </header>
      {actionError && <p className="err">{actionError}</p>}
      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          {season.season_number != null && <div><span className="detail-label">Season #</span><span>{season.season_number}</span></div>}
          <div><span className="detail-label">Release year</span><span>{season.release_year}</span></div>
          <div><span className="detail-label">Episodes</span><span>{season.episode_count}</span></div>
          <div><span className="detail-label">Runtime</span><span>{fmtRuntime(season.runtime_minutes)}</span></div>
        </div>
        {season.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{season.notes}</span>
          </div>
        )}
      </div>

      <TvPeopleSection
        path="television/seasons"
        ownerId={seid}
        persons={season.persons}
        roles={TV_SEASON_ROLES}
        defaultRole="director"
        populateDown={{
          label: "Populate down",
          confirm: `Attach this season's people to all ${season.episode_count} of its episodes? Anyone already credited is left as is.`,
        }}
      />
      <LinksSection path="television/seasons" section="television" ownerId={seid} />
      <MySeasonListSection showId={season.show_id} seasonId={seid} />

      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>Episodes</h2>
          <Link to={`/g/${guildId}/television/seasons/${seid}/rank`} style={{ fontSize: 13 }}>Rank episodes →</Link>
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
          loadingLabel="Loading episodes…"
          empty={<p className="rank-empty">{isMine ? "No episodes ranked yet." : "This member hasn't ranked any episodes of this season yet."}</p>}
          pendingId={moveEpisode.isPending ? moveEpisode.variables?.episodeId ?? null : null}
          rowClassName="episode-row"
          disableDrag={!isMine}
          onReorder={(next) => qc.setQueryData(rankKey, next.map((e, i) => ({ ...ranked[i], position: i + 1, episode: e })))}
          onMove={(episodeId, position) => moveEpisode.mutate({ episodeId, position })}
          renderDetail={renderEpisodeDetail}
          render={(e) => {
            const r = ranked.find((x) => x.episode.id === e.id)!;
            return (
              <>
                {episodeLink(e)}
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
                {catalogActions(e)}
              </>
            );
          }}
        />
      )}

      {view === "catalog" && (
        <CatalogList
          items={catalog}
          loading={catalogLoading}
          loadingLabel="Loading episodes…"
          empty={<p><small>No episodes in the catalog for this season yet.</small></p>}
          rowClassName="tv-catalog-row"
          renderDetail={renderEpisodeDetail}
          render={(e) => (
            <>
              {episodeLink(e)}
              <span className="meta">{e.release_year} · {fmtRuntime(e.runtime_minutes)}</span>
              {e.in_my_list
                ? <span className="meta">in your list</span>
                : (
                  <BusyButton busy={addEntry.isPending && addEntry.variables === e.id} busyLabel="Adding…"
                              onClick={() => addEntry.mutate(e.id)}>+ Add to my list</BusyButton>
                )}
              <button className="icon" title="Show details" onClick={() => toggleExpand(e.id)}>
                {expandedIds.has(e.id) ? "▲" : "▼"}
              </button>
              {catalogActions(e)}
            </>
          )}
        />
      )}

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

      {editing && show && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TelevisionEpisodeForm
              show={show}
              season={season}
              initial={editing === "new" ? undefined : editing.episode}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}

      {editingSeason && show && (
        <div className="modal-backdrop" onClick={() => setEditingSeason(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TelevisionSeasonForm show={show} initial={season} onClose={() => setEditingSeason(false)} />
          </div>
        </div>
      )}

      {importingSeason && show && (
        <div className="modal-backdrop" onClick={() => setImportingSeason(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TmdbTelevisionSeasonImportDialog
              show={show}
              season={season}
              onClose={() => setImportingSeason(false)}
              onSuccess={() => {
                setImportingSeason(false);
                qc.invalidateQueries({ queryKey: gk(guildId, "television") });
              }}
            />
          </div>
        </div>
      )}

      {importingEpisode && show && (
        <div className="modal-backdrop" onClick={() => setImportingEpisode(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TmdbTelevisionEpisodeImportDialog
              show={show}
              season={season}
              episode={importingEpisode.episode}
              onClose={() => setImportingEpisode(null)}
              onSuccess={() => {
                setImportingEpisode(null);
                qc.invalidateQueries({ queryKey: gk(guildId, "television") });
                qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "seasons", seid, "episodes") });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
