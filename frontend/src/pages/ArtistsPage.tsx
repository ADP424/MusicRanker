import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { gk, rk } from "../api/keys";
import { useArtistCatalog, useEntryMutations, useGuildApi, useMusicGenres, usePeople, useRankedArtists } from "../api/hooks";
import type { Artist, RankedArtist } from "../api/types";
import { ArtistForm } from "../components/ArtistForm";
import { CatalogList } from "../components/CatalogList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MemberPicker } from "../components/MemberPicker";
import { SearchFilterBar } from "../components/SearchFilterBar";
import { SortableList } from "../components/SortableList";
import { BusyButton, Spinner } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";
import { matchesAny } from "../search/textMatch";

type ArtistSearchBy = "all" | "title" | "genre" | "person" | "album";
const ARTIST_SEARCH_BY: ArtistSearchBy[] = ["all", "title", "genre", "person", "album"];
type View = "mine" | "catalog";

interface PendingDelete {
  artist: Artist;
  rankingsDestroyed: number;
}

export function ArtistsPage() {
  const qc = useQueryClient();
  const { guildId, userId: me, base } = useGuildApi();
  const [view, setView] = useState<View>("mine");
  const [viewingUser, setViewingUser] = useState(me);
  const [editing, setEditing] = useState<{ artist: Artist } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PendingDelete | null>(null);
  const [confirmRemoveFromList, setConfirmRemoveFromList] = useState<Artist | null>(null);
  const [search, setSearch] = useState("");
  const [searchBy, setSearchBy] = useState<ArtistSearchBy>("all");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const isMine = viewingUser === me;

  const { data: catalog = [], isLoading: catalogLoading } = useArtistCatalog();
  const { data: ranked = [], isLoading: rankedLoading } = useRankedArtists(viewingUser);
  const { data: genres = [] } = useMusicGenres();
  const { data: people = [] } = usePeople();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));
  const entry = useEntryMutations("artists");

  function artistMatches(a: Artist, needle: string): boolean {
    if (searchBy === "title" || searchBy === "all") {
      if (matchesAny(needle, a.name, a.name_en)) return true;
    }
    if (searchBy === "genre" || searchBy === "all") {
      const matchingGenreIds = new Set(
        genres.filter((g) => matchesAny(needle, g.name) || g.synonyms?.some((s) => s.toLowerCase().includes(needle))).map((g) => g.id)
      );
      if (a.primary_genre != null && matchingGenreIds.has(a.primary_genre)) return true;
      if (a.albums.some((al) => al.genre_ids.some((gid) => matchingGenreIds.has(gid)))) return true;
    }
    if (searchBy === "person" || searchBy === "all") {
      const matchingPersonIds = new Set(
        people.filter((p) => matchesAny(needle, p.name, p.name_en)).map((p) => p.id)
      );
      if (a.persons.some((p) => matchingPersonIds.has(p.id))) return true;
    }
    if (searchBy === "album" || searchBy === "all") {
      if (a.albums.some((al) => matchesAny(needle, al.name, al.name_en, al.alias))) return true;
    }
    return false;
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function renderArtistDetail(a: Artist) {
    const primaryGenre = a.primary_genre != null ? genreMap[a.primary_genre] : undefined;
    return (
      <div className="album-detail-dropdown">
        <div className="album-detail-row">
          <span className="detail-label">Nationality</span>
          <span>
            {a.core_nationality}
            {a.birth_nationality !== a.core_nationality && ` (${a.birth_nationality})`}
          </span>
        </div>
        {primaryGenre && (
          <div className="album-detail-row">
            <span className="detail-label">Primary Genre</span>
            <Link className="plain-link" to={`/g/${guildId}/music/genres/${a.primary_genre}`}>{primaryGenre}</Link>
          </div>
        )}
        {a.links.length > 0 && (
          <div className="album-detail-row">
            <span className="detail-label">Links</span>
            <span>
              {a.links.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ", "}
                  <a href={l.url} target="_blank" rel="noreferrer">{l.label ?? l.url}</a>
                </span>
              ))}
            </span>
          </div>
        )}
        {a.notes && (
          <div className="album-detail-row">
            <span className="detail-label">Notes</span>
            <span>{a.notes}</span>
          </div>
        )}
      </div>
    );
  }

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${base}/artists/${id}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: gk(guildId, "artists") });
      qc.invalidateQueries({ queryKey: rk(guildId, me) });
    },
  });

  const needle = search.trim().toLowerCase();
  const visibleCatalog = useMemo(
    () => catalog.filter((a) => !needle || artistMatches(a, needle)),
    [catalog, needle, searchBy, genres, people],
  );
  const visibleRanked = useMemo(
    () => ranked.filter((r) => !needle || artistMatches(r.artist, needle)),
    [ranked, needle, searchBy, genres, people],
  );
  // SortableList wants {id, position}; unwrap the ranked rows for it.
  const sortable = visibleRanked.map((r) => ({ ...r.artist, position: r.position }));

  async function confirmRemoval(artist: Artist) {
    setImpactFor(artist.id);
    setActionError(null);
    try {
      const { rankings_destroyed } = await api.get<{ rankings_destroyed: number }>(`${base}/artists/${artist.id}/impact`);
      setConfirmDelete({ artist, rankingsDestroyed: rankings_destroyed });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setImpactFor(null);
    }
  }

  const deleteButton = (a: Artist) =>
    canDelete ? (
      <BusyButton className="icon" title="Delete from catalog" busy={impactFor === a.id} busyLabel={null}
                  onClick={() => void confirmRemoval(a)}>✕</BusyButton>
    ) : <span />;

  return (
    <section>
      <header className="page-head">
        <h1>Artists</h1>
        <div className="inline">
          <div className="view-toggle">
            <button className={view === "mine" ? "view-toggle-active" : ""} onClick={() => setView("mine")}>Ranking</button>
            <button className={view === "catalog" ? "view-toggle-active" : ""} onClick={() => setView("catalog")}>Catalog</button>
          </div>
          {view === "mine" && <MemberPicker value={viewingUser} onChange={setViewingUser} />}
          {canCreate && <button onClick={() => setEditing("new")}>+ Add</button>}
        </div>
      </header>
      {actionError && <p className="err">{actionError}</p>}
      <SearchFilterBar
        value={search}
        onChange={setSearch}
        searchBy={searchBy}
        onSearchByChange={setSearchBy}
        options={ARTIST_SEARCH_BY}
        count={
          view === "mine"
            ? rankedLoading ? <Spinner size="sm" /> : `${visibleRanked.length} ranked`
            : catalogLoading ? <Spinner size="sm" /> : `${visibleCatalog.length} in catalog`
        }
      />

      {view === "mine" && (
        <SortableList
          items={sortable}
          loading={rankedLoading}
          loadingLabel="Loading ranking…"
          empty={
            <p className="rank-empty">
              {ranked.length > 0
                ? <>No artists match “{search.trim()}”.</>
                : isMine
                  ? <>Nothing here yet. Switch to <strong>Catalog</strong> and add the artists you listen to.</>
                  : <>This member hasn't ranked any artists yet.</>}
            </p>
          }
          pendingId={entry.move.isPending ? entry.move.variables?.id ?? null : null}
          rowClassName="album-row"
          disableDrag={!isMine || needle.length > 0}
          onReorder={(next) =>
            qc.setQueryData(rk(guildId, me, "artists", "ranked"),
              next.map((a, i) => ({ ...visibleRanked[i], position: i + 1, artist: a })) as RankedArtist[])
          }
          onMove={(id, position) => entry.move.mutate({ id, position })}
          renderDetail={(a) => (expandedIds.has(a.id) ? renderArtistDetail(a) : null)}
          render={(a) => (
            <>
              <Link className="name" to={`/g/${guildId}/music/artists/${a.id}`}>
                {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
              </Link>
              <span className="meta">
                {a.core_nationality}
                {a.birth_nationality !== a.core_nationality && <> ({a.birth_nationality})</>}
                {" · "}{a.album_count} album{a.album_count !== 1 ? "s" : ""}
              </span>
              <span />
              <button className="icon" title="Show details" onClick={() => toggleExpand(a.id)}>
                {expandedIds.has(a.id) ? "▲" : "▼"}
              </button>
              {isMine
                ? <button className="icon" title="Remove from my ranking" onClick={() => setConfirmRemoveFromList(a)}>✕ list</button>
                : <span />}
              {canEdit ? <button className="icon" onClick={() => setEditing({ artist: a })}>✎</button> : <span />}
              {deleteButton(a)}
            </>
          )}
        />
      )}

      {view === "catalog" && (
        <CatalogList
          items={visibleCatalog}
          loading={catalogLoading}
          empty={
            <p><small>{catalog.length > 0 ? `No artists match “${search.trim()}”.` : "No artists in this guild's catalog yet."}</small></p>
          }
          rowClassName="catalog-row"
          renderDetail={(a) => (expandedIds.has(a.id) ? renderArtistDetail(a) : null)}
          render={(a) => (
            <>
              <Link className="name" to={`/g/${guildId}/music/artists/${a.id}`}>
                {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
              </Link>
              <span className="meta">{a.core_nationality} · {a.album_count} album{a.album_count !== 1 ? "s" : ""}</span>
              {a.in_my_list
                ? <span className="meta">in your list</span>
                : (
                  <BusyButton
                    busy={entry.add.isPending && entry.add.variables === a.id}
                    busyLabel="Adding…"
                    onClick={() => entry.add.mutate(a.id)}
                  >+ Add to my list</BusyButton>
                )}
              <button className="icon" title="Show details" onClick={() => toggleExpand(a.id)}>
                {expandedIds.has(a.id) ? "▲" : "▼"}
              </button>
              {canEdit ? <button className="icon" onClick={() => setEditing({ artist: a })}>✎</button> : <span />}
              {deleteButton(a)}
            </>
          )}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.artist.name}" from the guild catalog? ${confirmDelete.rankingsDestroyed} member ranking(s) will be destroyed.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.artist.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmRemoveFromList && (
        <ConfirmDialog
          message={`Remove "${confirmRemoveFromList.name}" from your list? Your personal notes for it will be lost. (Your album rankings for this artist are separate and won't be affected.)`}
          confirmLabel="Remove"
          busy={entry.remove.isPending}
          onConfirm={() => entry.remove.mutate(confirmRemoveFromList.id, { onSettled: () => setConfirmRemoveFromList(null) })}
          onCancel={() => setConfirmRemoveFromList(null)}
        />
      )}
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <ArtistForm initial={editing === "new" ? undefined : editing.artist} onClose={() => setEditing(null)} />
          </div>
        </div>
      )}
    </section>
  );
}
