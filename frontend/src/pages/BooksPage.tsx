import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { useBookCatalog, useBookGenres, useEntryMutations, useGuildApi, usePeople, useRankedBooks } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { Book, BookRole } from "../api/types";
import { BOOK_ROLE_LABELS, BOOK_ROLES } from "../api/types";
import { BookForm } from "../components/BookForm";
import { CatalogList } from "../components/CatalogList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MemberPicker } from "../components/MemberPicker";
import { SearchFilterBar } from "../components/SearchFilterBar";
import { SortableList } from "../components/SortableList";
import { BusyButton, Spinner } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";
import { matchesAny } from "../search/textMatch";

type BookSearchBy = "all" | "title" | "genre" | "person";
const BOOK_SEARCH_BY: BookSearchBy[] = ["all", "title", "genre", "person"];
type View = "mine" | "catalog";

const ADAPTATIONS = [
  { label: "Adapted as (Movie)", field: "adaptation_movies", route: "movies" },
  { label: "Adapted as (TV)", field: "adaptation_television_shows", route: "television/shows" },
  { label: "Adapted as (Game)", field: "adaptation_games", route: "games" },
] as const;

function bookMeta(b: Book) {
  const authors = b.persons.filter((p) => p.role === "author").map((p) => p.name);
  return [
    String(b.release_year),
    b.word_count != null ? `${b.word_count.toLocaleString()} words` : null,
    authors.length ? authors.join(", ") : null,
  ].filter(Boolean).join(" · ");
}

export function BooksPage() {
  const qc = useQueryClient();
  const { guildId, userId: me, base } = useGuildApi();
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const [view, setView] = useState<View>("mine");
  const [editing, setEditing] = useState<{ book: Book } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ book: Book; rankingsDestroyed: number } | null>(null);
  const [confirmRemoveFromList, setConfirmRemoveFromList] = useState<Book | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<BookSearchBy>("all");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingUser, setViewingUser] = useState(me);
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: ranked = [], isLoading: rankedLoading } = useRankedBooks(viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useBookCatalog();
  const { data: genres = [] } = useBookGenres();
  const { data: people = [] } = usePeople();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));
  const entry = useEntryMutations("books");
  const isMine = viewingUser === me;

  const rankKey = rk(guildId, me, "books", "ranked");

  function bookMatches(b: Book, needle: string): boolean {
    if (searchBy === "title" || searchBy === "all") {
      if (matchesAny(needle, b.name, b.name_en, b.alias)) return true;
    }
    if (searchBy === "genre" || searchBy === "all") {
      const matchingGenreIds = new Set(
        genres.filter((g) => matchesAny(needle, g.name) || g.synonyms?.some((s) => s.toLowerCase().includes(needle))).map((g) => g.id)
      );
      if (b.genre_ids.some((gid) => matchingGenreIds.has(gid))) return true;
    }
    if (searchBy === "person" || searchBy === "all") {
      const matchingPersonIds = new Set(
        people.filter((p) => matchesAny(needle, p.name, p.name_en)).map((p) => p.id)
      );
      if (b.persons.some((p) => matchingPersonIds.has(p.id))) return true;
    }
    return false;
  }

  const visible = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return ranked;
    return ranked.filter((r) => bookMatches(r.book, needle));
  }, [searchQ, searchBy, ranked, genres, people]);

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) => api.put(`${base}/books/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "books") }),
  });

  const adjustReads = useMutation({
    mutationFn: ({ bookId, reads }: { bookId: number; reads: number }) =>
      api.put(`${base}/books/${bookId}/entry`, { reads }),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk(guildId, me, "books") }),
  });

  const remove = useMutation({
    mutationFn: (bookId: number) => api.delete(`${base}/books/${bookId}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "books") });
      qc.invalidateQueries({ queryKey: rk(guildId, me, "books") });
    },
  });

  async function confirmRemoval(book: Book) {
    setImpactFor(book.id);
    setActionError(null);
    try {
      const { rankings_destroyed } = await api.get<{ rankings_destroyed: number }>(`${base}/books/${book.id}/impact`);
      setConfirmDelete({ book, rankingsDestroyed: rankings_destroyed });
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

  function renderBookDetail(b: Book) {
    if (!expandedIds.has(b.id)) return null;
    const byRole: Partial<Record<BookRole, Book["persons"]>> = {};
    for (const p of b.persons) (byRole[p.role] ??= []).push(p);
    return (
      <div className="album-detail-dropdown">
        {BOOK_ROLES.filter((r) => byRole[r]?.length).map((role) => (
          <div key={role} className="album-detail-row">
            <span className="detail-label">{BOOK_ROLE_LABELS[role]}</span>
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
        ))}
        {b.alias && (
          <div className="album-detail-row">
            <span className="detail-label">Alias</span>
            <span>{b.alias}</span>
          </div>
        )}
        {b.genre_ids.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Genres</span>
            <span>
              {b.genre_ids
                .filter((id) => genreMap[id])
                .sort((a, c) => genreMap[a].localeCompare(genreMap[c]))
                .map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link className="plain-link" to={`/g/${guildId}/books/genres/${id}`}>{genreMap[id]}</Link>
                  </span>
                ))}
            </span>
          </div>
        )}
        {ADAPTATIONS.filter((k) => b[k.field].length > 0).map((k) => (
          <div key={k.field} className="album-detail-row">
            <span className="detail-label">{k.label}</span>
            <span>
              {b[k.field].map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ", "}
                  <Link to={`/g/${guildId}/${k.route}/${r.id}`}>
                    {r.name}{r.name_en && <span style={{ opacity: 0.6 }}> ({r.name_en})</span>}
                  </Link>
                </span>
              ))}
            </span>
          </div>
        ))}
        {b.notes && (
          <div className="album-detail-row">
            <span className="detail-label">Notes</span>
            <span>{b.notes}</span>
          </div>
        )}
        {b.persons.length === 0 && !b.alias && !b.notes && b.genre_ids.length === 0
          && ADAPTATIONS.every((k) => b[k.field].length === 0) && (
          <span style={{ opacity: 0.5 }}>No extra info.</span>
        )}
      </div>
    );
  }

  const allExpanded = visible.length > 0 && expandedIds.size === visible.length;
  const sortable = visible.map((r) => ({ ...r.book, position: r.position }));

  const catalogNeedle = searchQ.trim().toLowerCase();
  const visibleCatalog = useMemo(
    () => catalog.filter((b) => !catalogNeedle || bookMatches(b, catalogNeedle)),
    [catalog, catalogNeedle, searchBy, genres, people],
  );

  const title = (b: Book) => (
    <span className="name">
      <Link to={`/g/${guildId}/books/${b.id}`} className="plain-link">
        {b.name}{b.name_en && <span style={{ opacity: 0.6 }}> ({b.name_en})</span>}
      </Link>
    </span>
  );

  return (
    <section>
      <header className="page-head">
        <h1>Books</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div className="view-toggle">
            <button className={view === "mine" ? "view-toggle-active" : ""} onClick={() => setView("mine")}>Ranking</button>
            <button className={view === "catalog" ? "view-toggle-active" : ""} onClick={() => setView("catalog")}>Catalog</button>
          </div>
          {view === "mine" && <MemberPicker value={viewingUser} onChange={setViewingUser} />}
          <button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(visible.map((r) => r.book.id)))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          {canCreate && <button onClick={() => setEditing("new")}>+ Add</button>}
        </div>
      </header>
      {actionError && <p className="err">{actionError}</p>}
      <SearchFilterBar
        value={searchQ}
        onChange={setSearchQ}
        searchBy={searchBy}
        onSearchByChange={setSearchBy}
        options={BOOK_SEARCH_BY}
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
            {ranked.length > 0 ? "No books match your search." : isMine ? "No books ranked yet." : "This member hasn't ranked any books yet."}
          </p>
        }
        pendingId={move.isPending ? move.variables?.id ?? null : null}
        rowClassName="album-row"
        disableDrag={!isMine || searchQ.trim().length > 0}
        onReorder={(next) => qc.setQueryData(rankKey, next.map((b, i) => ({ ...ranked[i], position: i + 1, book: b })))}
        onMove={(id, position) => move.mutate({ id, position })}
        renderDetail={renderBookDetail}
        render={(b) => {
          const r = ranked.find((x) => x.book.id === b.id)!;
          return (
            <>
              {title(b)}
              <span className="meta">{bookMeta(b)}</span>
              {isMine ? (() => {
                const counting = adjustReads.isPending && adjustReads.variables?.bookId === b.id;
                return (
                  <span className="listens-ctrl">
                    <button
                      className="icon"
                      title="Remove one read"
                      disabled={r.reads <= 1 || counting}
                      onClick={() => adjustReads.mutate({ bookId: b.id, reads: r.reads - 1 })}
                    >−</button>
                    <span className="listens-count">{counting ? <Spinner size="sm" /> : `${r.reads}×`}</span>
                    <button
                      className="icon"
                      title="Add one read"
                      disabled={counting}
                      onClick={() => adjustReads.mutate({ bookId: b.id, reads: r.reads + 1 })}
                    >+</button>
                  </span>
                );
              })() : <span />}
              <button className="icon" title="Show details" onClick={() => toggleExpand(b.id)}>
                {expandedIds.has(b.id) ? "▲" : "▼"}
              </button>
              {isMine
                ? <button className="icon" title="Remove from my ranking" onClick={() => setConfirmRemoveFromList(b)}>✕ list</button>
                : <span />}
              {canEdit ? <button className="icon" onClick={() => setEditing({ book: b })}>✎</button> : <span />}
              {canDelete ? (
                <BusyButton className="icon" title="Delete from catalog" busy={impactFor === b.id} busyLabel={null}
                            onClick={() => void confirmRemoval(b)}>✕</BusyButton>
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
          empty={<p><small>{catalog.length > 0 ? "No books match your search." : "No books in this guild's catalog yet."}</small></p>}
          rowClassName="catalog-row"
          renderDetail={renderBookDetail}
          render={(b) => (
            <>
              {title(b)}
              <span className="meta">{bookMeta(b)}</span>
              {b.in_my_list
                ? <span className="meta">in your list</span>
                : (
                  <BusyButton busy={entry.add.isPending && entry.add.variables === b.id} busyLabel="Adding…"
                              onClick={() => entry.add.mutate(b.id)}>+ Add to my list</BusyButton>
                )}
              <button className="icon" title="Show details" onClick={() => toggleExpand(b.id)}>
                {expandedIds.has(b.id) ? "▲" : "▼"}
              </button>
              {canEdit ? <button className="icon" onClick={() => setEditing({ book: b })}>✎</button> : <span />}
              {canDelete ? (
                <BusyButton className="icon" title="Delete from catalog" busy={impactFor === b.id} busyLabel={null}
                            onClick={() => void confirmRemoval(b)}>✕</BusyButton>
              ) : <span />}
            </>
          )}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.book.name}" from the guild catalog? ${confirmDelete.rankingsDestroyed} member ranking(s) will be destroyed.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.book.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmRemoveFromList && (
        <ConfirmDialog
          message={`Remove "${confirmRemoveFromList.name}" from your list? Your read count and personal notes for it will be lost.`}
          confirmLabel="Remove"
          busy={entry.remove.isPending}
          onConfirm={() => entry.remove.mutate(confirmRemoveFromList.id, { onSettled: () => setConfirmRemoveFromList(null) })}
          onCancel={() => setConfirmRemoveFromList(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <BookForm
              initial={editing === "new" ? undefined : editing.book}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
