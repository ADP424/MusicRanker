import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { usePeople, useTelevisionGenres, useTelevisionShowsRanked } from "../api/hooks";
import type { TelevisionPersonRef, TelevisionShow } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SortableList } from "../components/SortableList";
import { TelevisionShowForm } from "../components/TelevisionShowForm";
import { TmdbTelevisionImportDialog } from "../components/TmdbTelevisionImportDialog";
import { DupWarningBanner, useDupWarning } from "../hooks/useDupWarning";
import { useExpandAll } from "../hooks/useExpandAll";
import { useOptimisticDelete } from "../hooks/useOptimisticDelete";

type ShowSearchBy = "all" | "title" | "genre" | "person";

const ROLE_LABEL: Record<string, string> = {
  creator: "Creator",
  composer: "Composer",
  lead_actor: "Lead Actor",
  actor: "Actor",
  cameo_actor: "Cameo Actor",
};

export function TelevisionShowsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<{ show: TelevisionShow } | "new" | null>(null);
  const [showTmdbImport, setShowTmdbImport] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TelevisionShow | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<ShowSearchBy>("all");
  const { dupWarning, clear: clearDup, checkAfterSave } = useDupWarning("television show");

  const { data: shows = [] } = useTelevisionShowsRanked();
  const { data: genres = [] } = useTelevisionGenres();
  const { data: people = [] } = usePeople();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));
  const { expandedIds, toggle: toggleExpand, allExpanded, toggleAll } = useExpandAll(shows);

  const visibleShows = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return shows;

    const matchingIds = new Set<number>();

    if (searchBy === "title" || searchBy === "all") {
      for (const s of shows) {
        if (s.name.toLowerCase().includes(needle) || s.name_en?.toLowerCase().includes(needle)) matchingIds.add(s.id);
      }
    }

    if (searchBy === "genre" || searchBy === "all") {
      const matchingGenreIds = new Set(
        genres
          .filter((g) =>
            g.name.toLowerCase().includes(needle) ||
            g.synonyms?.some((syn) => syn.toLowerCase().includes(needle))
          )
          .map((g) => g.id)
      );
      for (const s of shows) {
        if (s.genre_ids.some((gid) => matchingGenreIds.has(gid))) matchingIds.add(s.id);
      }
    }

    if (searchBy === "person" || searchBy === "all") {
      const matchingPersonIds = new Set(
        people.filter((p) => p.name.toLowerCase().includes(needle) || p.name_en?.toLowerCase().includes(needle)).map((p) => p.id)
      );
      for (const s of shows) {
        if (s.persons.some((p) => matchingPersonIds.has(p.id))) matchingIds.add(s.id);
      }
    }

    return shows.filter((s) => matchingIds.has(s.id));
  }, [searchQ, searchBy, shows, genres, people]);

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) =>
      api.put(`/television/shows/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["television", "ranked"] }),
  });

  const remove = useOptimisticDelete<TelevisionShow>({
    queryKey: ["television", "ranked"],
    endpoint: (id) => `/television/shows/${id}`,
    invalidateKeys: [["television", "ranked"], ["television", "index"]],
  });

  function groupPersons(persons: TelevisionPersonRef[]) {
    const byRole: Record<string, TelevisionPersonRef[]> = {};
    for (const p of persons) {
      if (!byRole[p.role]) byRole[p.role] = [];
      byRole[p.role].push(p);
    }
    return byRole;
  }

  return (
    <section>
      <header className="page-head">
        <h1>Television</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={toggleAll}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          <button onClick={() => setEditing("new")}>+ Add</button>
          <button onClick={() => setShowTmdbImport(true)}>Import from TMDB</button>
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
          {(["all", "title", "genre", "person"] as ShowSearchBy[]).map((opt) => (
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
          <span className="search-count">{visibleShows.length} result{visibleShows.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <SortableList
        items={visibleShows}
        rowClassName="album-row"
        onReorder={(next) => qc.setQueryData(["television", "ranked"], next)}
        onMove={(id, position) => move.mutate({ id, position })}
        disableDrag={searchQ.trim().length > 0}
        renderDetail={(s) =>
          expandedIds.has(s.id) ? (
            <div className="album-detail-dropdown">
              {s.persons.length > 0 && (() => {
                const byRole = groupPersons(s.persons);
                const roleOrder = ["creator", "composer", "lead_actor", "actor", "cameo_actor"];
                return roleOrder
                  .filter((r) => byRole[r]?.length)
                  .map((role) => (
                    <div key={role} className="album-detail-row">
                      <span className="detail-label">{ROLE_LABEL[role] ?? role}</span>
                      <span>
                        {byRole[role].map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && ", "}
                            <Link className="plain-link" to={`/people/${p.id}`}>
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
                          <Link className="plain-link" to={`/television/genres/${id}`}>{genreMap[id]}</Link>
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
                        <Link to={`/music/albums/${a.id}`}>
                          {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
                        </Link>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {s.watch_link && (
                <div className="album-detail-row">
                  <span className="detail-label">Watch</span>
                  <a href={s.watch_link} target="_blank" rel="noreferrer">{s.watch_link}</a>
                </div>
              )}
              {s.notes && (
                <div className="album-detail-row">
                  <span className="detail-label">Notes</span>
                  <span>{s.notes}</span>
                </div>
              )}
              {s.persons.length === 0 && !s.watch_link && !s.notes && s.genre_ids.length === 0 && s.soundtrack_albums.length === 0 && (
                <span style={{ opacity: 0.5 }}>No extra info.</span>
              )}
            </div>
          ) : null
        }
        render={(s) => (
          <>
            <span className="name">
              <Link to={`/television/${s.id}`} className="plain-link">
                {s.name}{s.name_en && <span style={{ opacity: 0.6 }}> ({s.name_en})</span>}
              </Link>
              {s.watch_link && (
                <> <a href={s.watch_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.85em", opacity: 0.7, color: "inherit" }}>(link)</a></>
              )}
            </span>
            <span className="meta">
              {s.release_year} · {s.episode_count} episode{s.episode_count !== 1 ? "s" : ""}
              {s.persons.filter((p) => p.role === "creator").length > 0 && (
                <> · {s.persons.filter((p) => p.role === "creator").map((p) => p.name).join(", ")}</>
              )}
            </span>
            <button className="icon" title="Show details" onClick={() => toggleExpand(s.id)}>
              {expandedIds.has(s.id) ? "▲" : "▼"}
            </button>
            <button className="icon" onClick={() => setEditing({ show: s })}>✎</button>
            <button className="icon" onClick={() => setConfirmDelete(s)}>✕</button>
          </>
        )}
      />

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}" and all of its episodes?`}
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
            <TelevisionShowForm
              initial={editing === "new" ? undefined : editing.show}
              onClose={(savedName, savedId) => {
                setEditing(null);
                checkAfterSave(shows, savedName, savedId);
              }}
            />
          </div>
        </div>
      )}

      {showTmdbImport && (
        <div className="modal-backdrop" onClick={() => setShowTmdbImport(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TmdbTelevisionImportDialog
              onClose={() => setShowTmdbImport(false)}
              onSuccess={(showId) => navigate(`/television/${showId}`)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
