import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { useEntryMutations, useGuildApi, useMovieCatalog, useMovieGenres, usePeople, useRankedMovies } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { CastRole, Movie } from "../api/types";
import { CAST_ROLE_LABELS, MOVIE_ROLES } from "../api/types";
import { CatalogList } from "../components/CatalogList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MemberPicker } from "../components/MemberPicker";
import { MovieForm } from "../components/MovieForm";
import { SearchFilterBar } from "../components/SearchFilterBar";
import { SortableList } from "../components/SortableList";
import { BusyButton, Spinner } from "../components/Spinner";
import { TmdbImportDialog } from "../components/TmdbImportDialog";
import { useCan } from "../guild/GuildProvider";
import { matchesAny } from "../search/textMatch";

type MovieSearchBy = "all" | "title" | "genre" | "person";
const MOVIE_SEARCH_BY: MovieSearchBy[] = ["all", "title", "genre", "person"];
type View = "mine" | "catalog";

function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`;
  return `${m}m`;
}

export function MoviesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { guildId, userId: me, base } = useGuildApi();
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const [view, setView] = useState<View>("mine");
  const [editing, setEditing] = useState<{ movie: Movie } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ movie: Movie; rankingsDestroyed: number } | null>(null);
  const [confirmRemoveFromList, setConfirmRemoveFromList] = useState<Movie | null>(null);
  const [showTmdbImport, setShowTmdbImport] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<MovieSearchBy>("all");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingUser, setViewingUser] = useState(me);
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: ranked = [], isLoading: rankedLoading } = useRankedMovies(viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useMovieCatalog();
  const { data: genres = [] } = useMovieGenres();
  const { data: people = [] } = usePeople();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));
  const entry = useEntryMutations("movies");
  const isMine = viewingUser === me;

  const rankKey = rk(guildId, me, "movies", "ranked");

  function movieMatches(m: Movie, needle: string): boolean {
    if (searchBy === "title" || searchBy === "all") {
      if (matchesAny(needle, m.name, m.name_en)) return true;
    }
    if (searchBy === "genre" || searchBy === "all") {
      const matchingGenreIds = new Set(
        genres.filter((g) => matchesAny(needle, g.name) || g.synonyms?.some((s) => s.toLowerCase().includes(needle))).map((g) => g.id)
      );
      if (m.genre_ids.some((gid) => matchingGenreIds.has(gid))) return true;
    }
    if (searchBy === "person" || searchBy === "all") {
      const matchingPersonIds = new Set(
        people.filter((p) => matchesAny(needle, p.name, p.name_en)).map((p) => p.id)
      );
      if (m.persons.some((p) => matchingPersonIds.has(p.id))) return true;
    }
    return false;
  }

  const visible = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return ranked;
    return ranked.filter((r) => movieMatches(r.movie, needle));
  }, [searchQ, searchBy, ranked, genres, people]);

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) => api.put(`${base}/movies/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "movies") }),
  });

  const adjustWatches = useMutation({
    mutationFn: ({ movieId, watches }: { movieId: number; watches: number }) =>
      api.put(`${base}/movies/${movieId}/entry`, { watches }),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "movies") }),
  });

  const remove = useMutation({
    mutationFn: (movieId: number) => api.delete(`${base}/movies/${movieId}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "movies") });
      qc.invalidateQueries({ queryKey: rk(guildId, me, "movies") });
    },
  });

  async function confirmRemoval(movie: Movie) {
    setImpactFor(movie.id);
    setActionError(null);
    try {
      const { rankings_destroyed } = await api.get<{ rankings_destroyed: number }>(`${base}/movies/${movie.id}/impact`);
      setConfirmDelete({ movie, rankingsDestroyed: rankings_destroyed });
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

  function groupPersons(persons: Movie["persons"]) {
    const byRole: Partial<Record<CastRole, Movie["persons"]>> = {};
    for (const p of persons) {
      (byRole[p.role] ??= []).push(p);
    }
    return byRole;
  }

  function renderMovieDetail(m: Movie) {
    if (!expandedIds.has(m.id)) return null;
    return (
      <div className="album-detail-dropdown">
        {m.persons.length > 0 && (() => {
          const byRole = groupPersons(m.persons);
          return MOVIE_ROLES.filter((r) => byRole[r]?.length).map((role) => (
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
        {m.genre_ids.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Genres</span>
            <span>
              {m.genre_ids
                .filter((id) => genreMap[id])
                .sort((a, b) => genreMap[a].localeCompare(genreMap[b]))
                .map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link className="plain-link" to={`/g/${guildId}/movies/genres/${id}`}>{genreMap[id]}</Link>
                  </span>
                ))}
            </span>
          </div>
        )}
        {m.soundtrack_albums.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Soundtrack</span>
            <span>
              {m.soundtrack_albums.map((a, i) => (
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
        {m.source_books.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Based on</span>
            <span>
              {m.source_books.map((b, i) => (
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
        {m.notes && (
          <div className="album-detail-row">
            <span className="detail-label">Notes</span>
            <span>{m.notes}</span>
          </div>
        )}
        {m.persons.length === 0 && !m.notes && m.genre_ids.length === 0 && m.soundtrack_albums.length === 0 && m.source_books.length === 0 && (
          <span style={{ opacity: 0.5 }}>No extra info.</span>
        )}
      </div>
    );
  }

  const allExpanded = visible.length > 0 && expandedIds.size === visible.length;
  const sortable = visible.map((r) => ({ ...r.movie, position: r.position }));

  const catalogNeedle = searchQ.trim().toLowerCase();
  const visibleCatalog = useMemo(
    () => catalog.filter((m) => !catalogNeedle || movieMatches(m, catalogNeedle)),
    [catalog, catalogNeedle, searchBy, genres, people],
  );

  return (
    <section>
      <header className="page-head">
        <h1>Movies</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div className="view-toggle">
            <button className={view === "mine" ? "view-toggle-active" : ""} onClick={() => setView("mine")}>Ranking</button>
            <button className={view === "catalog" ? "view-toggle-active" : ""} onClick={() => setView("catalog")}>Catalog</button>
          </div>
          {view === "mine" && <MemberPicker value={viewingUser} onChange={setViewingUser} />}
          <button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(visible.map((r) => r.movie.id)))}>
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
        options={MOVIE_SEARCH_BY}
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
            {ranked.length > 0 ? "No movies match your search." : isMine ? "No movies ranked yet." : "This member hasn't ranked any movies yet."}
          </p>
        }
        pendingId={move.isPending ? move.variables?.id ?? null : null}
        rowClassName="album-row"
        disableDrag={!isMine || searchQ.trim().length > 0}
        onReorder={(next) => qc.setQueryData(rankKey, next.map((m, i) => ({ ...ranked[i], position: i + 1, movie: m })))}
        onMove={(id, position) => move.mutate({ id, position })}
        renderDetail={renderMovieDetail}
        render={(m) => {
          const r = ranked.find((x) => x.movie.id === m.id)!;
          return (
            <>
              <span className="name">
                <Link to={`/g/${guildId}/movies/${m.id}`} className="plain-link">
                  {m.name}{m.name_en && <span style={{ opacity: 0.6 }}> ({m.name_en})</span>}
                </Link>
              </span>
              <span className="meta">
                {m.release_year} · {fmtRuntime(m.runtime_minutes)}
                {m.persons.filter((p) => p.role === "director").length > 0 && (
                  <> · {m.persons.filter((p) => p.role === "director").map((p) => p.name).join(", ")}</>
                )}
              </span>
              {isMine ? (() => {
                const counting = adjustWatches.isPending && adjustWatches.variables?.movieId === m.id;
                return (
                  <span className="listens-ctrl">
                    <button
                      className="icon"
                      title="Remove one watch"
                      disabled={r.watches <= 1 || counting}
                      onClick={() => adjustWatches.mutate({ movieId: m.id, watches: r.watches - 1 })}
                    >−</button>
                    <span className="listens-count">{counting ? <Spinner size="sm" /> : `${r.watches}×`}</span>
                    <button
                      className="icon"
                      title="Add one watch"
                      disabled={counting}
                      onClick={() => adjustWatches.mutate({ movieId: m.id, watches: r.watches + 1 })}
                    >+</button>
                  </span>
                );
              })() : <span />}
              <button className="icon" title="Show details" onClick={() => toggleExpand(m.id)}>
                {expandedIds.has(m.id) ? "▲" : "▼"}
              </button>
              {isMine
                ? <button className="icon" title="Remove from my ranking" onClick={() => setConfirmRemoveFromList(m)}>✕ list</button>
                : <span />}
              {canEdit ? <button className="icon" onClick={() => setEditing({ movie: m })}>✎</button> : <span />}
              {canDelete ? (
                <BusyButton className="icon" title="Delete from catalog" busy={impactFor === m.id} busyLabel={null}
                            onClick={() => void confirmRemoval(m)}>✕</BusyButton>
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
          empty={<p><small>{catalog.length > 0 ? "No movies match your search." : "No movies in this guild's catalog yet."}</small></p>}
          rowClassName="catalog-row"
          renderDetail={renderMovieDetail}
          render={(m) => (
            <>
              <span className="name">
                <Link to={`/g/${guildId}/movies/${m.id}`} className="plain-link">
                  {m.name}{m.name_en && <span style={{ opacity: 0.6 }}> ({m.name_en})</span>}
                </Link>
              </span>
              <span className="meta">{m.release_year} · {fmtRuntime(m.runtime_minutes)}</span>
              {m.in_my_list
                ? <span className="meta">in your list</span>
                : (
                  <BusyButton busy={entry.add.isPending && entry.add.variables === m.id} busyLabel="Adding…"
                              onClick={() => entry.add.mutate(m.id)}>+ Add to my list</BusyButton>
                )}
              <button className="icon" title="Show details" onClick={() => toggleExpand(m.id)}>
                {expandedIds.has(m.id) ? "▲" : "▼"}
              </button>
              {canEdit ? <button className="icon" onClick={() => setEditing({ movie: m })}>✎</button> : <span />}
              {canDelete ? (
                <BusyButton className="icon" title="Delete from catalog" busy={impactFor === m.id} busyLabel={null}
                            onClick={() => void confirmRemoval(m)}>✕</BusyButton>
              ) : <span />}
            </>
          )}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.movie.name}" from the guild catalog? ${confirmDelete.rankingsDestroyed} member ranking(s) will be destroyed.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.movie.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmRemoveFromList && (
        <ConfirmDialog
          message={`Remove "${confirmRemoveFromList.name}" from your list? Your watch count and personal notes for it will be lost.`}
          confirmLabel="Remove"
          busy={entry.remove.isPending}
          onConfirm={() => entry.remove.mutate(confirmRemoveFromList.id, { onSettled: () => setConfirmRemoveFromList(null) })}
          onCancel={() => setConfirmRemoveFromList(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <MovieForm
              initial={editing === "new" ? undefined : editing.movie}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}

      {showTmdbImport && (
        <div className="modal-backdrop" onClick={() => setShowTmdbImport(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TmdbImportDialog
              onClose={() => setShowTmdbImport(false)}
              onSuccess={(movieId) => navigate(`/g/${guildId}/movies/${movieId}`)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
