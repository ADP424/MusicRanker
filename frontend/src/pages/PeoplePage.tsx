import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { useGuildApi, usePeople } from "../api/hooks";
import { gk } from "../api/keys";
import type { Person } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PersonForm } from "../components/PersonForm";
import { LoadingState, Spinner } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";

type PeopleSearchBy = "all" | "name" | "nationality" | "artist" | "book" | "movie" | "game" | "television";

function PersonRow({ person }: { person: Person }) {
  const hasAny = person.artist_names.length > 0 || (person.book_names ?? []).length > 0 || person.movie_names.length > 0
    || person.game_names.length > 0 || person.television_names.length > 0;

  return (
    <div className="artist-detail-dropdown">
      {!hasAny && (
        <div style={{ opacity: 0.5, fontSize: 13 }}>No linked artists, books, movies, games, or shows</div>
      )}
      {person.artist_names.length > 0 && (
        <div>
          <div className="detail-label" style={{ marginBottom: "0.25rem" }}>Artists</div>
          <div>{person.artist_names.join(", ")}</div>
        </div>
      )}
      {(person.book_names ?? []).length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <div className="detail-label" style={{ marginBottom: "0.25rem" }}>Books</div>
          <div>{person.book_names.join(", ")}</div>
        </div>
      )}
      {person.movie_names.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <div className="detail-label" style={{ marginBottom: "0.25rem" }}>Movies</div>
          <div>{person.movie_names.join(", ")}</div>
        </div>
      )}
      {person.game_names.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <div className="detail-label" style={{ marginBottom: "0.25rem" }}>Games</div>
          <div>{person.game_names.join(", ")}</div>
        </div>
      )}
      {person.television_names.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <div className="detail-label" style={{ marginBottom: "0.25rem" }}>Television</div>
          <div>{person.television_names.join(", ")}</div>
        </div>
      )}
    </div>
  );
}

export function PeoplePage() {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const [editing, setEditing] = useState<{ person: Person } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Person | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<PeopleSearchBy>("all");
  const [showDupsOnly, setShowDupsOnly] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data: people = [], isLoading } = usePeople();

  const dupNameSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) {
      const key = p.name.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (p.name_en) {
        const keyEn = p.name_en.toLowerCase();
        counts.set(keyEn, (counts.get(keyEn) ?? 0) + 1);
      }
    }
    const dups = new Set<string>();
    for (const [name, count] of counts) {
      if (count > 1) dups.add(name);
    }
    return dups;
  }, [people]);

  const visiblePeople = useMemo(() => {
    let result = people;

    if (showDupsOnly) {
      result = result.filter(
        (p) => dupNameSet.has(p.name.toLowerCase()) || (p.name_en != null && dupNameSet.has(p.name_en.toLowerCase()))
      );
    }

    const needle = searchQ.trim().toLowerCase();
    if (!needle) return result;

    return result.filter((p) => {
      if (searchBy === "name" || searchBy === "all") {
        if (p.name.toLowerCase().includes(needle) || p.name_en?.toLowerCase().includes(needle)) return true;
      }
      if (searchBy === "nationality" || searchBy === "all") {
        if (
          p.core_nationality.toLowerCase().includes(needle) ||
          p.birth_nationality.toLowerCase().includes(needle)
        ) return true;
      }
      if (searchBy === "artist" || searchBy === "all") {
        if (p.artist_names.some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "book" || searchBy === "all") {
        if ((p.book_names ?? []).some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "movie" || searchBy === "all") {
        if (p.movie_names.some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "game" || searchBy === "all") {
        if (p.game_names.some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "television" || searchBy === "all") {
        if (p.television_names.some((n) => n.toLowerCase().includes(needle))) return true;
      }
      return false;
    });
  }, [searchQ, searchBy, showDupsOnly, dupNameSet, people]);

  const allExpanded = visiblePeople.length > 0 && expandedIds.size === visiblePeople.length;
  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${base}/persons/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: gk(guildId, "people") }),
  });

  return (
    <section>
      <header className="page-head">
        <h1>People</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(visiblePeople.map((p) => p.id)))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          {canEdit && <button onClick={() => setEditing("new")}>+ Add</button>}
        </div>
      </header>

      <div className="search-bar">
        <input
          type="search"
          placeholder="Search…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <div className="search-by-chips">
          {(["all", "name", "nationality", "artist", "book", "movie", "game", "television"] as PeopleSearchBy[]).map((opt) => (
            <button
              key={opt}
              className={`chip${searchBy === opt ? " chip-active" : ""}`}
              onClick={() => setSearchBy(opt)}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
        <button
          className={`chip${showDupsOnly ? " chip-active" : ""}`}
          onClick={() => setShowDupsOnly((v) => !v)}
        >
          Duplicates
        </button>
        {isLoading
          ? <span className="search-count"><Spinner size="sm" /></span>
          : (searchQ.trim().length > 0 || showDupsOnly) && (
            <span className="search-count">{visiblePeople.length} result{visiblePeople.length !== 1 ? "s" : ""}</span>
          )}
      </div>

      {isLoading ? (
        <LoadingState label="Loading people…" />
      ) : visiblePeople.length === 0 ? (
        <p className="rank-empty">
          {people.length === 0 ? "No people in this guild yet." : "No people match."}
        </p>
      ) : (
        <ul className="sortable plain-list">
          {visiblePeople.map((person) => (
            <li key={person.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
                <Link className="name" to={`/g/${guildId}/people/${person.id}`}>
                  {person.name}{person.name_en && <span style={{ opacity: 0.6 }}> ({person.name_en})</span>}
                </Link>
                <span className="meta">
                  {person.core_nationality}
                  {person.birth_nationality !== person.core_nationality && (
                    <> ({person.birth_nationality})</>
                  )}
                </span>
                <button className="icon" title="Show links" onClick={() => toggleExpand(person.id)}>
                  {expandedIds.has(person.id) ? "▲" : "▼"}
                </button>
                {canEdit ? <button className="icon" onClick={() => setEditing({ person })}>✎</button> : <span />}
                {canDelete ? <button className="icon" onClick={() => setConfirmDelete(person)}>✕</button> : <span />}
              </div>
              {expandedIds.has(person.id) && <PersonRow person={person} />}
            </li>
          ))}
        </ul>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}"?`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PersonForm
              initial={editing === "new" ? undefined : editing.person}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
