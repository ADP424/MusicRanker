import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useArtists, useMoviesRanked, usePeople } from "../api/hooks";
import type { Person } from "../api/types";
import { CAST_ROLE_LABELS } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PersonForm } from "../components/PersonForm";
import { DupWarningBanner, useDupWarning } from "../hooks/useDupWarning";
import { useExpandAll } from "../hooks/useExpandAll";
import { useOptimisticDelete } from "../hooks/useOptimisticDelete";

type PeopleSearchBy = "all" | "name" | "nationality" | "artist" | "movie" | "game" | "television";

function PersonRow({ person }: { person: Person }) {
  const { data: artists = [] } = useArtists();
  const { data: movies = [] } = useMoviesRanked();

  const linkedArtists = artists.filter((a) => person.artist_ids.includes(a.id));
  const linkedMovies = movies.flatMap((m) =>
    m.persons
      .filter((p) => p.id === person.id)
      .map((p) => ({ movie: m, role: p.role }))
  );

  return (
    <div className="artist-detail-dropdown">
      {linkedArtists.length === 0 && linkedMovies.length === 0 && (
        <div style={{ opacity: 0.5, fontSize: 13 }}>No linked artists or movies</div>
      )}
      {linkedArtists.length > 0 && (
        <div>
          <div className="detail-label" style={{ marginBottom: "0.25rem" }}>Artists</div>
          {linkedArtists.map((a) => (
            <div key={a.id}>
              <Link to={`/music/artists/${a.id}`} className="plain-link">{a.name}</Link>
            </div>
          ))}
        </div>
      )}
      {linkedMovies.length > 0 && (
        <div style={{ marginTop: linkedArtists.length > 0 ? "0.5rem" : 0 }}>
          <div className="detail-label" style={{ marginBottom: "0.25rem" }}>Movies</div>
          {linkedMovies.map(({ movie, role }) => (
            <div key={movie.id}>
              <Link to={`/movies/${movie.id}`} className="plain-link">{movie.name}</Link>
              <span style={{ opacity: 0.6, fontSize: 11, marginLeft: 4 }}>({CAST_ROLE_LABELS[role]})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PeoplePage() {
  const [editing, setEditing] = useState<{ person: Person } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Person | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<PeopleSearchBy>("all");
  const [showDupsOnly, setShowDupsOnly] = useState(false);
  const { dupWarning, clear: clearDup, checkAfterSave } = useDupWarning("person");

  const { data: people = [] } = usePeople();

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
        if ((p.artist_names ?? []).some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "movie" || searchBy === "all") {
        if ((p.movie_names ?? []).some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "game" || searchBy === "all") {
        if ((p.game_names ?? []).some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "television" || searchBy === "all") {
        if ((p.television_names ?? []).some((n) => n.toLowerCase().includes(needle))) return true;
      }
      return false;
    });
  }, [searchQ, searchBy, showDupsOnly, dupNameSet, people]);

  const { expandedIds, toggle: toggleExpand, allExpanded, toggleAll } = useExpandAll(visiblePeople);

  const remove = useOptimisticDelete<Person>({
    queryKey: ["people"],
    endpoint: (id) => `/persons/${id}`,
  });

  return (
    <section>
      <header className="page-head">
        <h1>People</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={toggleAll}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          <button onClick={() => setEditing("new")}>+ Add</button>
        </div>
      </header>

      {dupWarning && <DupWarningBanner message={dupWarning} onDismiss={clearDup} />}

      <div className="search-bar">
        <input
          type="search"
          placeholder="Search…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <div className="search-by-chips">
          {(["all", "name", "nationality", "artist", "movie", "game", "television"] as PeopleSearchBy[]).map((opt) => (
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
        {(searchQ.trim().length > 0 || showDupsOnly) && (
          <span className="search-count">{visiblePeople.length} result{visiblePeople.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <ul className="sortable plain-list">
        {visiblePeople.map((person) => (
          <li key={person.id} className="sortable-item">
            <div className="row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
              <Link className="name" to={`/people/${person.id}`}>
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
                checkAfterSave(people, savedName, savedId);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
