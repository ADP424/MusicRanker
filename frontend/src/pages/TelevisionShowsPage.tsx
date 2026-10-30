import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { useEntryMutations, useGuildApi, usePeople, useRankedTelevisionShows, useTelevisionCatalog, useTelevisionGenres } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { CastRole, TelevisionShow } from "../api/types";
import { CAST_ROLE_LABELS, TV_SHOW_ROLES } from "../api/types";
import { CatalogList } from "../components/CatalogList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MemberPicker } from "../components/MemberPicker";
import { SearchFilterBar } from "../components/SearchFilterBar";
import { SortableList } from "../components/SortableList";
import { BusyButton, Spinner } from "../components/Spinner";
import { TelevisionShowForm } from "../components/TelevisionShowForm";
import { TmdbTelevisionImportDialog } from "../components/TmdbTelevisionImportDialog";
import { useCan } from "../guild/GuildProvider";
import { matchesAny } from "../search/textMatch";

type ShowSearchBy = "all" | "title" | "genre" | "person" | "episode";
const SHOW_SEARCH_BY: ShowSearchBy[] = ["all", "title", "genre", "person", "episode"];
type View = "mine" | "catalog";

export function TelevisionShowsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { guildId, userId: me, base } = useGuildApi();
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const [view, setView] = useState<View>("mine");
  const [editing, setEditing] = useState<{ show: TelevisionShow } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ show: TelevisionShow; rankingsDestroyed: number } | null>(null);
  const [confirmRemoveFromList, setConfirmRemoveFromList] = useState<TelevisionShow | null>(null);
  const [showTmdbImport, setShowTmdbImport] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<ShowSearchBy>("all");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingUser, setViewingUser] = useState(me);
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: ranked = [], isLoading: rankedLoading } = useRankedTelevisionShows(viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useTelevisionCatalog();
  const { data: genres = [] } = useTelevisionGenres();
  const { data: people = [] } = usePeople();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));
  const entry = useEntryMutations("television/shows");
  const isMine = viewingUser === me;

  const rankKey = rk(guildId, me, "television", "shows", "ranked");

  function showMatches(s: TelevisionShow, needle: string): boolean {
    if (searchBy === "title" || searchBy === "all") {
      if (matchesAny(needle, s.name, s.name_en)) return true;
    }
    if (searchBy === "genre" || searchBy === "all") {
      const matchingGenreIds = new Set(
        genres.filter((g) => matchesAny(needle, g.name) || g.synonyms?.some((sy) => sy.toLowerCase().includes(needle))).map((g) => g.id)
      );
      if (s.genre_ids.some((gid) => matchingGenreIds.has(gid))) return true;
    }
    if (searchBy === "person" || searchBy === "all") {
      const matchingPersonIds = new Set(
        people.filter((p) => matchesAny(needle, p.name, p.name_en)).map((p) => p.id)
      );
      if (s.persons.some((p) => matchingPersonIds.has(p.id))) return true;
    }
    if (searchBy === "episode" || searchBy === "all") {
      if (s.episodes.some((e) => matchesAny(needle, e.name, e.name_en))) return true;
    }
    return false;
  }

  const visible = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return ranked;
    return ranked.filter((r) => showMatches(r.show, needle));
  }, [searchQ, searchBy, ranked, genres, people]);

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) => api.put(`${base}/television/shows/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows") }),
  });

  const remove = useMutation({
    mutationFn: (showId: number) => api.delete(`${base}/television/shows/${showId}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "television") });
      qc.invalidateQueries({ queryKey: rk(guildId, me, "television", "shows") });
    },
  });

  async function confirmRemoval(show: TelevisionShow) {
    setImpactFor(show.id);
    setActionError(null);
    try {
      const { rankings_destroyed } = await api.get<{ rankings_destroyed: number }>(`${base}/television/shows/${show.id}/impact`);
      setConfirmDelete({ show, rankingsDestroyed: rankings_destroyed });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setImpactFor(null);
    }
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function groupPersons(persons: TelevisionShow["persons"]) {
    const byRole: Partial<Record<CastRole, TelevisionShow["persons"]>> = {};
    for (const p of persons) (byRole[p.role] ??= []).push(p);
    return byRole;
  }

  function renderShowDetail(s: TelevisionShow) {
    if (!expandedIds.has(s.id)) return null;
    return (
      <div className="album-detail-dropdown">
        {s.persons.length > 0 && (() => {
          const byRole = groupPersons(s.persons);
          return TV_SHOW_ROLES.filter((r) => byRole[r]?.length).map((role) => (
            <div key={role} className="album-detail-row">
              <span className="detail-label">{CAST_ROLE_LABELS[role]}</span>
              <span>
                {byRole[role]!.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ", "}
                    <Link className="plain-link" to={`/g/${guildId}/people/${p.id}`}>
                      {p.name}{p.name_en && <span style={{ opacity: 0.6 }}> ({p.name_en})</span>}
                    </Link>
                  </span>
                ))}
              </span>
            </div>
          ));
        })()}
        {s.genre_ids.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Genres</span>
            <span>
              {s.genre_ids
                .filter((id) => genreMap[id])
                .sort((a, b) => genreMap[a].localeCompare(genreMap[b]))
                .map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link className="plain-link" to={`/g/${guildId}/television/genres/${id}`}>{genreMap[id]}</Link>
                  </span>
                ))}
            </span>
          </div>
        )}
        {s.soundtrack_albums.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Soundtrack</span>
            <span>
              {s.soundtrack_albums.map((a, i) => (
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
        {s.source_books.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Based on</span>
            <span>
              {s.source_books.map((b, i) => (
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
        {s.notes && (
          <div className="album-detail-row">
            <span className="detail-label">Notes</span>
            <span>{s.notes}</span>
          </div>
        )}
        {s.persons.length === 0 && !s.notes && s.genre_ids.length === 0 && s.soundtrack_albums.length === 0 && s.source_books.length === 0 && (
          <span style={{ opacity: 0.5 }}>No extra info.</span>
        )}
      </div>
    );
  }

  const allExpanded = visible.length > 0 && expandedIds.size === visible.length;
  const sortable = visible.map((r) => ({ ...r.show, position: r.position }));

  const catalogNeedle = searchQ.trim().toLowerCase();
  const visibleCatalog = useMemo(
    () => catalog.filter((s) => !catalogNeedle || showMatches(s, catalogNeedle)),
    [catalog, catalogNeedle, searchBy, genres, people],
  );

  return (
    <section>
      <header className="page-head">
        <h1>Television</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div className="view-toggle">
            <button className={view === "mine" ? "view-toggle-active" : ""} onClick={() => setView("mine")}>Ranking</button>
            <button className={view === "catalog" ? "view-toggle-active" : ""} onClick={() => setView("catalog")}>Catalog</button>
          </div>
          {view === "mine" && <MemberPicker value={viewingUser} onChange={setViewingUser} />}
          <button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(visible.map((r) => r.show.id)))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          {canCreate && <button onClick={() => setEditing("new")}>+ Add</button>}
          {canCreate && <button onClick={() => setShowTmdbImport(true)}>Import from TMDB</button>}
        </div>
      </header>
      {actionError && <p className="err">{actionError}</p>}
      <SearchFilterBar
        value={searchQ}
        onChange={setSearchQ}
        searchBy={searchBy}
        onSearchByChange={setSearchBy}
        options={SHOW_SEARCH_BY}
        count={
          view === "mine"
            ? (rankedLoading ? <Spinner size="sm" /> : (searchQ.trim().length > 0 ? `${visible.length} result${visible.length !== 1 ? "s" : ""}` : ""))
            : (catalogLoading ? <Spinner size="sm" /> : `${visibleCatalog.length} in catalog`)
        }
      />

      {view === "mine" && (
      <SortableList
        items={sortable}
        loading={rankedLoading}
        loadingLabel="Loading ranking…"
        empty={
          <p className="rank-empty">
            {ranked.length > 0 ? "No shows match your search." : isMine ? "No shows ranked yet." : "This member hasn't ranked any shows yet."}
          </p>
        }
        pendingId={move.isPending ? move.variables?.id ?? null : null}
        rowClassName="album-row"
        disableDrag={!isMine || searchQ.trim().length > 0}
        onReorder={(next) => qc.setQueryData(rankKey, next.map((s, i) => ({ ...ranked[i], position: i + 1, show: s })))}
        onMove={(id, position) => move.mutate({ id, position })}
        renderDetail={renderShowDetail}
        render={(s) => (
          <>
            <span className="name">
              <Link to={`/g/${guildId}/television/shows/${s.id}`} className="plain-link">
                {s.name}{s.name_en && <span style={{ opacity: 0.6 }}> ({s.name_en})</span>}
              </Link>
            </span>
            <span className="meta">
              {s.release_year} · {s.season_count} season{s.season_count !== 1 ? "s" : ""} · {s.episode_count} episode{s.episode_count !== 1 ? "s" : ""}
            </span>
            <span />
            <button className="icon" title="Show details" onClick={() => toggleExpand(s.id)}>
              {expandedIds.has(s.id) ? "▲" : "▼"}
            </button>
            {isMine
              ? <button className="icon" title="Remove from my ranking" onClick={() => setConfirmRemoveFromList(s)}>✕ list</button>
              : <span />}
            {canEdit ? <button className="icon" onClick={() => setEditing({ show: s })}>✎</button> : <span />}
            {canDelete ? (
              <BusyButton className="icon" title="Delete from catalog" busy={impactFor === s.id} busyLabel={null}
                          onClick={() => void confirmRemoval(s)}>✕</BusyButton>
            ) : <span />}
          </>
        )}
      />
      )}

      {view === "catalog" && (
        <CatalogList
          items={visibleCatalog}
          loading={catalogLoading}
          empty={<p><small>{catalog.length > 0 ? "No shows match your search." : "No shows in this guild's catalog yet."}</small></p>}
          rowClassName="catalog-row"
          renderDetail={renderShowDetail}
          render={(s) => (
            <>
              <span className="name">
                <Link to={`/g/${guildId}/television/shows/${s.id}`} className="plain-link">
                  {s.name}{s.name_en && <span style={{ opacity: 0.6 }}> ({s.name_en})</span>}
                </Link>
              </span>
              <span className="meta">
                {s.release_year} · {s.season_count} season{s.season_count !== 1 ? "s" : ""} · {s.episode_count} episode{s.episode_count !== 1 ? "s" : ""}
              </span>
              {s.in_my_list
                ? <span className="meta">in your list</span>
                : (
                  <BusyButton busy={entry.add.isPending && entry.add.variables === s.id} busyLabel="Adding…"
                              onClick={() => entry.add.mutate(s.id)}>+ Add to my list</BusyButton>
                )}
              <button className="icon" title="Show details" onClick={() => toggleExpand(s.id)}>
                {expandedIds.has(s.id) ? "▲" : "▼"}
              </button>
              {canEdit ? <button className="icon" onClick={() => setEditing({ show: s })}>✎</button> : <span />}
              {canDelete ? (
                <BusyButton className="icon" title="Delete from catalog" busy={impactFor === s.id} busyLabel={null}
                            onClick={() => void confirmRemoval(s)}>✕</BusyButton>
              ) : <span />}
            </>
          )}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.show.name}" from the guild catalog? ${confirmDelete.rankingsDestroyed} member ranking(s) will be destroyed.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.show.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmRemoveFromList && (
        <ConfirmDialog
          message={`Remove "${confirmRemoveFromList.name}" from your list? Your personal notes for it will be lost. (Episode rankings are separate and won't be affected.)`}
          confirmLabel="Remove"
          busy={entry.remove.isPending}
          onConfirm={() => entry.remove.mutate(confirmRemoveFromList.id, { onSettled: () => setConfirmRemoveFromList(null) })}
          onCancel={() => setConfirmRemoveFromList(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TelevisionShowForm
              initial={editing === "new" ? undefined : editing.show}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}

      {showTmdbImport && (
        <div className="modal-backdrop" onClick={() => setShowTmdbImport(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TmdbTelevisionImportDialog
              onClose={() => setShowTmdbImport(false)}
              onSuccess={(showId) => navigate(`/g/${guildId}/television/shows/${showId}`)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
