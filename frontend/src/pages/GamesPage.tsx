import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { useEntryMutations, useGameCatalog, useGameGenres, useGamePlatforms, useGuildApi, usePeople, useRankedGames } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { Game, GameRole } from "../api/types";
import { GAME_ROLES, GAME_ROLE_LABELS } from "../api/types";
import { CatalogList } from "../components/CatalogList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GameForm } from "../components/GameForm";
import { IgdbImportDialog } from "../components/IgdbImportDialog";
import { MemberPicker } from "../components/MemberPicker";
import { SearchFilterBar } from "../components/SearchFilterBar";
import { SortableList } from "../components/SortableList";
import { BusyButton, Spinner } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";
import { matchesAny } from "../search/textMatch";

type GameSearchBy = "all" | "title" | "genre" | "platform" | "person";
const GAME_SEARCH_BY: GameSearchBy[] = ["all", "title", "genre", "platform", "person"];
type View = "mine" | "catalog";

export function GamesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { guildId, userId: me, base } = useGuildApi();
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const [view, setView] = useState<View>("mine");
  const [editing, setEditing] = useState<{ game: Game } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ game: Game; rankingsDestroyed: number } | null>(null);
  const [confirmRemoveFromList, setConfirmRemoveFromList] = useState<Game | null>(null);
  const [showIgdbImport, setShowIgdbImport] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<GameSearchBy>("all");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingUser, setViewingUser] = useState(me);
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: ranked = [], isLoading: rankedLoading } = useRankedGames(viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useGameCatalog();
  const { data: genres = [] } = useGameGenres();
  const { data: platforms = [] } = useGamePlatforms();
  const { data: people = [] } = usePeople();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));
  const platformMap = Object.fromEntries(platforms.map((p) => [p.id, p.name]));
  const entry = useEntryMutations("games");
  const isMine = viewingUser === me;

  const rankKey = rk(guildId, me, "games", "ranked");

  function gameMatches(g: Game, needle: string): boolean {
    if (searchBy === "title" || searchBy === "all") {
      if (matchesAny(needle, g.name, g.name_en)) return true;
    }
    if (searchBy === "genre" || searchBy === "all") {
      const matchingGenreIds = new Set(
        genres.filter((gn) => matchesAny(needle, gn.name) || gn.synonyms?.some((s) => s.toLowerCase().includes(needle))).map((gn) => gn.id)
      );
      if (g.genre_ids.some((gid) => matchingGenreIds.has(gid))) return true;
    }
    if (searchBy === "platform" || searchBy === "all") {
      const matchingPlatformIds = new Set(
        platforms.filter((p) => matchesAny(needle, p.name) || p.synonyms?.some((s) => s.toLowerCase().includes(needle))).map((p) => p.id)
      );
      if (g.platform_ids.some((pid) => matchingPlatformIds.has(pid))) return true;
    }
    if (searchBy === "person" || searchBy === "all") {
      const matchingPersonIds = new Set(
        people.filter((p) => matchesAny(needle, p.name, p.name_en)).map((p) => p.id)
      );
      if (g.persons.some((p) => matchingPersonIds.has(p.id))) return true;
    }
    return false;
  }

  const visible = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return ranked;
    return ranked.filter((r) => gameMatches(r.game, needle));
  }, [searchQ, searchBy, ranked, genres, platforms, people]);

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) => api.put(`${base}/games/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "games") }),
  });

  const adjustHours = useMutation({
    mutationFn: ({ gameId, hours }: { gameId: number; hours: number | null }) =>
      api.put(`${base}/games/${gameId}/entry`, { hours_played: hours }),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "games") }),
  });

  const remove = useMutation({
    mutationFn: (gameId: number) => api.delete(`${base}/games/${gameId}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "games") });
      qc.invalidateQueries({ queryKey: rk(guildId, me, "games") });
    },
  });

  async function confirmRemoval(game: Game) {
    setImpactFor(game.id);
    setActionError(null);
    try {
      const { rankings_destroyed } = await api.get<{ rankings_destroyed: number }>(`${base}/games/${game.id}/impact`);
      setConfirmDelete({ game, rankingsDestroyed: rankings_destroyed });
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

  function groupPersons(persons: Game["persons"]) {
    const byRole: Partial<Record<GameRole, Game["persons"]>> = {};
    for (const p of persons) (byRole[p.role] ??= []).push(p);
    return byRole;
  }

  function renderGameDetail(g: Game) {
    if (!expandedIds.has(g.id)) return null;
    return (
      <div className="album-detail-dropdown">
        {g.persons.length > 0 && (() => {
          const byRole = groupPersons(g.persons);
          return GAME_ROLES.filter((r) => byRole[r]?.length).map((role) => (
            <div key={role} className="album-detail-row">
              <span className="detail-label">{GAME_ROLE_LABELS[role]}</span>
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
        {g.genre_ids.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Genres</span>
            <span>
              {g.genre_ids
                .filter((id) => genreMap[id])
                .sort((a, b) => genreMap[a].localeCompare(genreMap[b]))
                .map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link className="plain-link" to={`/g/${guildId}/games/genres/${id}`}>{genreMap[id]}</Link>
                  </span>
                ))}
            </span>
          </div>
        )}
        {g.platform_ids.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Platforms</span>
            <span>
              {g.platform_ids
                .filter((id) => platformMap[id])
                .sort((a, b) => platformMap[a].localeCompare(platformMap[b]))
                .map((id, i) => (
                  <span key={id}>{i > 0 && ", "}{platformMap[id]}</span>
                ))}
            </span>
          </div>
        )}
        {g.soundtrack_albums.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Soundtrack</span>
            <span>
              {g.soundtrack_albums.map((a, i) => (
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
        {g.source_books.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Based on</span>
            <span>
              {g.source_books.map((b, i) => (
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
        {g.notes && (
          <div className="album-detail-row">
            <span className="detail-label">Notes</span>
            <span>{g.notes}</span>
          </div>
        )}
        {g.persons.length === 0 && !g.notes && g.genre_ids.length === 0 && g.platform_ids.length === 0 && g.soundtrack_albums.length === 0 && g.source_books.length === 0 && (
          <span style={{ opacity: 0.5 }}>No extra info.</span>
        )}
      </div>
    );
  }

  const allExpanded = visible.length > 0 && expandedIds.size === visible.length;
  const sortable = visible.map((r) => ({ ...r.game, position: r.position }));

  const catalogNeedle = searchQ.trim().toLowerCase();
  const visibleCatalog = useMemo(
    () => catalog.filter((g) => !catalogNeedle || gameMatches(g, catalogNeedle)),
    [catalog, catalogNeedle, searchBy, genres, platforms, people],
  );

  return (
    <section>
      <header className="page-head">
        <h1>Games</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div className="view-toggle">
            <button className={view === "mine" ? "view-toggle-active" : ""} onClick={() => setView("mine")}>Ranking</button>
            <button className={view === "catalog" ? "view-toggle-active" : ""} onClick={() => setView("catalog")}>Catalog</button>
          </div>
          {view === "mine" && <MemberPicker value={viewingUser} onChange={setViewingUser} />}
          <button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(visible.map((r) => r.game.id)))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          {canCreate && <button onClick={() => setEditing("new")}>+ Add</button>}
          {canCreate && <button onClick={() => setShowIgdbImport(true)}>Import from IGDB</button>}
        </div>
      </header>
      {actionError && <p className="err">{actionError}</p>}
      <SearchFilterBar
        value={searchQ}
        onChange={setSearchQ}
        searchBy={searchBy}
        onSearchByChange={setSearchBy}
        options={GAME_SEARCH_BY}
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
            {ranked.length > 0 ? "No games match your search." : isMine ? "No games ranked yet." : "This member hasn't ranked any games yet."}
          </p>
        }
        pendingId={move.isPending ? move.variables?.id ?? null : null}
        rowClassName="album-row"
        disableDrag={!isMine || searchQ.trim().length > 0}
        onReorder={(next) => qc.setQueryData(rankKey, next.map((g, i) => ({ ...ranked[i], position: i + 1, game: g })))}
        onMove={(id, position) => move.mutate({ id, position })}
        renderDetail={renderGameDetail}
        render={(g) => {
          const r = ranked.find((x) => x.game.id === g.id)!;
          return (
            <>
              <span className="name">
                <Link to={`/g/${guildId}/games/${g.id}`} className="plain-link">
                  {g.name}{g.name_en && <span style={{ opacity: 0.6 }}> ({g.name_en})</span>}
                </Link>
              </span>
              <span className="meta">
                {g.release_year}
                {r.hours_played != null && <> · {r.hours_played}h</>}
              </span>
              {isMine ? (() => {
                const counting = adjustHours.isPending && adjustHours.variables?.gameId === g.id;
                return (
                  <span className="listens-ctrl">
                    <button
                      className="icon"
                      title="Subtract half an hour"
                      disabled={r.hours_played == null || Number(r.hours_played) <= 0 || counting}
                      onClick={() => adjustHours.mutate({ gameId: g.id, hours: Math.max(0, Number(r.hours_played ?? 0) - 0.5) })}
                    >−</button>
                    <span className="listens-count">{counting ? <Spinner size="sm" /> : `${r.hours_played ?? "—"}h`}</span>
                    <button
                      className="icon"
                      title="Add half an hour"
                      disabled={counting}
                      onClick={() => adjustHours.mutate({ gameId: g.id, hours: Number(r.hours_played ?? 0) + 0.5 })}
                    >+</button>
                  </span>
                );
              })() : <span />}
              <button className="icon" title="Show details" onClick={() => toggleExpand(g.id)}>
                {expandedIds.has(g.id) ? "▲" : "▼"}
              </button>
              {isMine
                ? <button className="icon" title="Remove from my ranking" onClick={() => setConfirmRemoveFromList(g)}>✕ list</button>
                : <span />}
              {canEdit ? <button className="icon" onClick={() => setEditing({ game: g })}>✎</button> : <span />}
              {canDelete ? (
                <BusyButton className="icon" title="Delete from catalog" busy={impactFor === g.id} busyLabel={null}
                            onClick={() => void confirmRemoval(g)}>✕</BusyButton>
              ) : <span />}
            </>
          );
        }}
      />
      )}

      {view === "catalog" && (
        <CatalogList
          items={visibleCatalog}
          loading={catalogLoading}
          empty={<p><small>{catalog.length > 0 ? "No games match your search." : "No games in this guild's catalog yet."}</small></p>}
          rowClassName="catalog-row"
          renderDetail={renderGameDetail}
          render={(g) => (
            <>
              <span className="name">
                <Link to={`/g/${guildId}/games/${g.id}`} className="plain-link">
                  {g.name}{g.name_en && <span style={{ opacity: 0.6 }}> ({g.name_en})</span>}
                </Link>
              </span>
              <span className="meta">{g.release_year}</span>
              {g.in_my_list
                ? <span className="meta">in your list</span>
                : (
                  <BusyButton busy={entry.add.isPending && entry.add.variables === g.id} busyLabel="Adding…"
                              onClick={() => entry.add.mutate(g.id)}>+ Add to my list</BusyButton>
                )}
              <button className="icon" title="Show details" onClick={() => toggleExpand(g.id)}>
                {expandedIds.has(g.id) ? "▲" : "▼"}
              </button>
              {canEdit ? <button className="icon" onClick={() => setEditing({ game: g })}>✎</button> : <span />}
              {canDelete ? (
                <BusyButton className="icon" title="Delete from catalog" busy={impactFor === g.id} busyLabel={null}
                            onClick={() => void confirmRemoval(g)}>✕</BusyButton>
              ) : <span />}
            </>
          )}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.game.name}" from the guild catalog? ${confirmDelete.rankingsDestroyed} member ranking(s) will be destroyed.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.game.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmRemoveFromList && (
        <ConfirmDialog
          message={`Remove "${confirmRemoveFromList.name}" from your list? Your hours played and personal notes for it will be lost.`}
          confirmLabel="Remove"
          busy={entry.remove.isPending}
          onConfirm={() => entry.remove.mutate(confirmRemoveFromList.id, { onSettled: () => setConfirmRemoveFromList(null) })}
          onCancel={() => setConfirmRemoveFromList(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <GameForm
              initial={editing === "new" ? undefined : editing.game}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}

      {showIgdbImport && (
        <div className="modal-backdrop" onClick={() => setShowIgdbImport(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <IgdbImportDialog
              onClose={() => setShowIgdbImport(false)}
              onSuccess={(gameId) => navigate(`/g/${guildId}/games/${gameId}`)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
