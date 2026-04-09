import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { useArtists, usePeople } from "../api/hooks";
import type { Person } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PersonForm } from "../components/PersonForm";

type PeopleSearchBy = "all" | "name" | "nationality";

function PersonRow({ person }: { person: Person }) {
  const { data: artists = [] } = useArtists();
  const qc = useQueryClient();

  const linkedArtists = artists.filter((a) => person.artist_ids.includes(a.id));

  const unlinkArtist = useMutation({
    mutationFn: (aid: number) => api.delete(`/persons/${person.id}/artists/${aid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people"] }),
  });

  return (
    <div className="artist-detail-dropdown">
      {linkedArtists.length > 0 && (
        <div className="detail-tags">
          <span className="detail-label">Artists</span>
          <span>
            {linkedArtists.map((a) => (
              <span key={a.id} style={{ marginRight: "0.5rem" }}>
                <Link to={`/music/artists/${a.id}`} className="plain-link">{a.name}</Link>
                <button
                  className="icon"
                  style={{ marginLeft: 4, fontSize: 10 }}
                  title="Unlink artist"
                  onClick={() => unlinkArtist.mutate(a.id)}
                >✕</button>
              </span>
            ))}
          </span>
        </div>
      )}
      {linkedArtists.length === 0 && (
        <div style={{ opacity: 0.5, fontSize: 13 }}>No linked artists</div>
      )}
    </div>
  );
}

export function PeoplePage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ person: Person } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Person | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<PeopleSearchBy>("all");
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const { data: people = [] } = usePeople();

  const visiblePeople = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return people;

    return people.filter((p) => {
      if (searchBy === "name" || searchBy === "all") {
        if (p.name.toLowerCase().includes(needle)) return true;
      }
      if (searchBy === "nationality" || searchBy === "all") {
        if (
          p.core_nationality.toLowerCase().includes(needle) ||
          p.birth_nationality.toLowerCase().includes(needle)
        ) return true;
      }
      return false;
    });
  }, [searchQ, searchBy, people]);

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/persons/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["people"] });
      const prev = qc.getQueryData<Person[]>(["people"]);
      qc.setQueryData<Person[]>(["people"], (old = []) => old.filter((p) => p.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => qc.setQueryData(["people"], ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["people"] }),
  });

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <section>
      <header className="page-head">
        <h1>People</h1>
        <button onClick={() => setEditing("new")}>+ Add</button>
      </header>

      {dupWarning && (
        <div className="dup-warning">
          <span>{dupWarning}</span>
          <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
        </div>
      )}

      <div className="search-bar">
        <input
          type="search"
          placeholder="Search…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <div className="search-by-chips">
          {(["all", "name", "nationality"] as PeopleSearchBy[]).map((opt) => (
            <button
              key={opt}
              className={`chip${searchBy === opt ? " chip-active" : ""}`}
              onClick={() => setSearchBy(opt)}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
        {searchQ.trim().length > 0 && (
          <span className="search-count">{visiblePeople.length} result{visiblePeople.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <ul className="sortable plain-list">
        {visiblePeople.map((person) => (
          <li key={person.id} className="sortable-item">
            <div className="row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
              <Link className="name" to={`/people/${person.id}`}>{person.name}</Link>
              <span className="meta">
                {person.core_nationality}
                {person.birth_nationality !== person.core_nationality && (
                  <> ({person.birth_nationality})</>
                )}
              </span>
              <button className="icon" title="Show links" onClick={() => toggleExpand(person.id)}>
                {expandedIds.has(person.id) ? "▲" : "▼"}
              </button>
              <button className="icon" onClick={() => setEditing({ person })}>✎</button>
              <button className="icon" onClick={() => setConfirmDelete(person)}>✕</button>
            </div>
            {expandedIds.has(person.id) && <PersonRow person={person} />}
          </li>
        ))}
      </ul>

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}"?`}
          onConfirm={() => {
            remove.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PersonForm
              initial={editing === "new" ? undefined : editing.person}
              onClose={(savedName, savedId) => {
                setEditing(null);
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = people.filter(
                    (p) => p.name.toLowerCase() === nameLower && p.id !== savedId
                  );
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
