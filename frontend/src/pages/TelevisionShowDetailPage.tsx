import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useTelevisionGenres, usePeople } from "../api/hooks";
import type { CastRole, Genre, TelevisionEpisode, TelevisionPersonRef, TelevisionShow, Person } from "../api/types";
import { CAST_ROLE_LABELS, TV_SHOW_ROLES, hasActingCredit } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TelevisionShowForm } from "../components/TelevisionShowForm";
import { TelevisionEpisodeForm } from "../components/TelevisionEpisodeForm";
import { TelevisionGenreChooser } from "../components/TelevisionGenreChooser";
import { TmdbTelevisionEpisodeImportDialog } from "../components/TmdbTelevisionEpisodeImportDialog";
import { PersonForm } from "../components/PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../components/PersonPicker";
import { SortableList } from "../components/SortableList";

function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m > 0 ? `${m}m` : ""}`.trim();
  return `${m}m`;
}

// ── People section ─────────────────────────────────────────────────────────────

function ShowPeopleSection({ show }: { show: TelevisionShow }) {
  const qc = useQueryClient();
  const { data: allPeople = [] } = usePeople();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<TelevisionPersonRef | null>(null);
  const [castSearch, setCastSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<CastRole>("creator");
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const [castKeys, setCastKeys] = useState<Set<string>>(
    () => new Set(show.persons.map((p) => `${p.id}:${p.role}`))
  );

  useEffect(() => {
    setCastKeys(new Set(show.persons.map((p) => `${p.id}:${p.role}`)));
  }, [show.persons]);

  const filteredPeople = useMemo(
    () => allPeople.filter((p) => matchesPersonSearch(p, searchField, castSearch)),
    [castSearch, searchField, allPeople],
  );

  const link = useMutation({
    mutationFn: ({ personId, role }: { personId: number; role: CastRole }) =>
      api.put(`/television/shows/${show.id}/persons/${personId}/${role}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["television", "shows", show.id] });
      qc.invalidateQueries({ queryKey: ["television", "ranked"] });
    },
  });

  const unlink = useMutation({
    mutationFn: ({ personId, role }: { personId: number; role: CastRole }) =>
      api.delete(`/television/shows/${show.id}/persons/${personId}/${role}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["television", "shows", show.id] });
      qc.invalidateQueries({ queryKey: ["television", "ranked"] });
    },
  });

  function toggleLink(person: Person, role: CastRole) {
    const key = `${person.id}:${role}`;
    if (castKeys.has(key)) {
      const ref = show.persons.find((p) => p.id === person.id && p.role === role);
      if (ref) setConfirmUnlink(ref);
    } else {
      link.mutate({ personId: person.id, role });
      setCastKeys((prev) => new Set([...prev, key]));
    }
  }

  const byRole: Record<string, TelevisionPersonRef[]> = {};
  for (const p of show.persons) {
    if (!byRole[p.role]) byRole[p.role] = [];
    byRole[p.role].push(p);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>People</h2>
        <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
          {editing ? "Done" : "Edit"}
        </button>
      </header>

      {editing && (
        <>
          {dupWarning && (
            <div className="dup-warning">
              <span>{dupWarning}</span>
              <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
            </div>
          )}

          <div style={{ marginBottom: "0.75rem" }}>
            <PersonPicker
              roles={TV_SHOW_ROLES}
              roleLabels={CAST_ROLE_LABELS}
              activeRole={addRole}
              onRole={setAddRole}
              searchField={searchField}
              onSearchField={setSearchField}
              search={castSearch}
              onSearch={setCastSearch}
              onNewPerson={() => setCreatingPerson(true)}
              people={filteredPeople}
              isChecked={(p, role) => castKeys.has(`${p.id}:${role}`)}
              onToggle={toggleLink}
            />
          </div>
        </>
      )}

      {show.persons.length > 0 ? (
        TV_SHOW_ROLES.filter((r) => byRole[r]?.length).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>
              {CAST_ROLE_LABELS[role]}
            </div>
            <ul className="sortable plain-list">
              {byRole[role].map((p) => (
                <li key={`${p.id}:${p.role}`} className="sortable-item">
                  <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                    <Link className="name" to={`/people/${p.id}`}>
                      {p.name}{p.name_en && <span style={{ opacity: 0.6 }}> ({p.name_en})</span>}
                    </Link>
                    {editing && (
                      <button
                        className="icon"
                        title="Remove"
                        onClick={() => setConfirmUnlink(p)}
                      >✕</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No people linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove "${confirmUnlink.name}" (${CAST_ROLE_LABELS[confirmUnlink.role]}) from this show?`}
          onConfirm={() => {
            unlink.mutate({ personId: confirmUnlink.id, role: confirmUnlink.role });
            setCastKeys((prev) => {
              const next = new Set(prev);
              next.delete(`${confirmUnlink!.id}:${confirmUnlink!.role}`);
              return next;
            });
            setConfirmUnlink(null);
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}

      {creatingPerson && (
        <div className="modal-backdrop" onClick={() => setCreatingPerson(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PersonForm
              onClose={(savedName, savedId) => {
                setCreatingPerson(false);
                if (savedId != null) {
                  qc.invalidateQueries({ queryKey: ["people"] });
                  link.mutate({ personId: savedId, role: addRole });
                  setCastKeys((prev) => new Set([...prev, `${savedId}:${addRole}`]));
                }
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = allPeople.filter((p) => p.name.toLowerCase() === nameLower && p.id !== savedId);
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

// ── Genres section ─────────────────────────────────────────────────────────────

function GenresSection({ show }: { show: TelevisionShow }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useTelevisionGenres();

  const { data: showGenres = [] } = useQuery({
    queryKey: ["television", "shows", show.id, "genres"],
    queryFn: () => api.get<Genre[]>(`/television/shows/${show.id}/genres`),
  });

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setGenreIds(new Set(showGenres.map((g) => g.id)));
  }, [showGenres]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`/television/shows/${show.id}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["television", "shows", show.id, "genres"] });
      qc.invalidateQueries({ queryKey: ["television", "shows", show.id] });
    },
  });

  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`/television/shows/${show.id}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["television", "shows", show.id, "genres"] });
      qc.invalidateQueries({ queryKey: ["television", "shows", show.id] });
    },
  });

  function handleChange(next: Set<number>) {
    const prev = genreIds;
    for (const id of next) {
      if (!prev.has(id)) addGenre.mutate(id);
    }
    for (const id of prev) {
      if (!next.has(id)) {
        const g = genreMap[id];
        if (g) {
          setConfirmUnlink(g);
          return;
        }
      }
    }
    setGenreIds(next);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Genres</h2>
        <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
          {editing ? "Done" : "Edit"}
        </button>
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
          <TelevisionGenreChooser selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {showGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {showGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/television/genres/${g.id}`}>{g.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No genres linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove genre "${confirmUnlink.name}" from this show?`}
          onConfirm={() => {
            removeGenre.mutate(confirmUnlink.id);
            setGenreIds((prev) => {
              const next = new Set(prev);
              next.delete(confirmUnlink!.id);
              return next;
            });
            setConfirmUnlink(null);
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}

// ── Episodes section ───────────────────────────────────────────────────────────

function EpisodesSection({ show }: { show: TelevisionShow }) {
  const qc = useQueryClient();
  const key = ["television", "shows", show.id];
  const [editing, setEditing] = useState<{ episode: TelevisionEpisode } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TelevisionEpisode | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  // `null` = closed; `{}` = new episode; `{ episode }` = import credits into it
  const [tmdbImport, setTmdbImport] = useState<{ episode?: TelevisionEpisode } | null>(null);

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) =>
      api.put(`/television/episodes/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const adjustWatches = useMutation({
    mutationFn: ({ episodeId, delta }: { episodeId: number; delta: 1 | -1 }) => {
      const ep = show.episodes.find((e) => e.id === episodeId)!;
      return api.patch<TelevisionEpisode>(`/television/episodes/${episodeId}`, { watches: ep.watches + delta });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/television/episodes/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TelevisionShow>(key);
      qc.setQueryData<TelevisionShow>(key, (old) =>
        old ? { ...old, episodes: old.episodes.filter((e) => e.id !== id) } : old
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const allExpanded = show.episodes.length > 0 && expandedIds.size === show.episodes.length;

  return (
    <>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Episodes</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(show.episodes.map((e) => e.id)))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          <button onClick={() => setEditing("new")}>+ Add Episode</button>
          <button onClick={() => setTmdbImport({})}>Import episode from TMDB</button>
        </div>
      </header>

      {show.episodes.length === 0 ? (
        <p style={{ opacity: 0.5 }}>No episodes yet.</p>
      ) : (
        <SortableList
          items={show.episodes}
          rowClassName="episode-row"
          onReorder={(next) => qc.setQueryData(key, (old: TelevisionShow | undefined) => old ? { ...old, episodes: next } : old)}
          onMove={(id, position) => move.mutate({ id, position })}
          renderDetail={(e) =>
            expandedIds.has(e.id) ? (
              <div className="album-detail-dropdown">
                {e.persons.length > 0 && (
                  <div className="album-detail-row">
                    <span className="detail-label">People</span>
                    <span>
                      {e.persons.map((p, i) => (
                        <span key={`${p.id}:${p.role}`}>
                          {i > 0 && ", "}
                          <Link className="plain-link" to={`/people/${p.id}`}>{p.name}</Link>
                          {" "}<span style={{ opacity: 0.6 }}>({CAST_ROLE_LABELS[p.role]})</span>
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {e.watch_link && (
                  <div className="album-detail-row">
                    <span className="detail-label">Watch</span>
                    <a href={e.watch_link} target="_blank" rel="noreferrer">{e.watch_link}</a>
                  </div>
                )}
                {e.notes && (
                  <div className="album-detail-row">
                    <span className="detail-label">Notes</span>
                    <span>{e.notes}</span>
                  </div>
                )}
                {e.persons.length === 0 && !e.watch_link && !e.notes && (
                  <span style={{ opacity: 0.5 }}>No extra info.</span>
                )}
              </div>
            ) : null
          }
          render={(e) => (
            <>
              <span className="name">
                <Link to={`/television/${show.id}/episodes/${e.id}`} className="plain-link">
                  {e.name}{e.name_en && <span style={{ opacity: 0.6 }}> ({e.name_en})</span>}
                </Link>
              </span>
              <span className="meta">
                {e.release_year} · {fmtRuntime(e.runtime_minutes)}
              </span>
              <span className="listens-ctrl">
                <button
                  className="icon"
                  title="Remove one watch"
                  disabled={e.watches <= 1}
                  onClick={() => adjustWatches.mutate({ episodeId: e.id, delta: -1 })}
                >−</button>
                <span className="listens-count">{e.watches}×</span>
                <button
                  className="icon"
                  title="Add one watch"
                  onClick={() => adjustWatches.mutate({ episodeId: e.id, delta: 1 })}
                >+</button>
              </span>
              {/* Uncast episodes (the state the show-level import leaves them in)
                  get a one-click cast import; once anyone's cast, re-importing
                  lives on the episode's own page. */}
              <span className="icon-slot">
                {!hasActingCredit(e.persons) && (
                  <button className="icon" title="Import cast & crew from TMDB"
                          onClick={() => setTmdbImport({ episode: e })}>⬇</button>
                )}
              </span>
              <button className="icon" title="Show details" onClick={() => toggleExpand(e.id)}>
                {expandedIds.has(e.id) ? "▲" : "▼"}
              </button>
              <button className="icon" onClick={() => setEditing({ episode: e })}>✎</button>
              <button className="icon" onClick={() => setConfirmDelete(e)}>✕</button>
            </>
          )}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete episode "${confirmDelete.name}"?`}
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
            <TelevisionEpisodeForm
              show={show}
              initial={editing === "new" ? undefined : editing.episode}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}

      {tmdbImport && (
        <div className="modal-backdrop" onClick={() => setTmdbImport(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TmdbTelevisionEpisodeImportDialog
              show={show}
              episode={tmdbImport.episode}
              onClose={() => setTmdbImport(null)}
              onSuccess={() => qc.invalidateQueries({ queryKey: key })}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function TelevisionShowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const showId = Number(id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data: show, isLoading, isError } = useQuery({
    queryKey: ["television", "shows", showId],
    queryFn: () => api.get<TelevisionShow>(`/television/shows/${showId}`),
    enabled: !isNaN(showId),
  });

  if (isLoading) return <section><p>Loading…</p></section>;
  if (isError || !show) return <section><p>Television show not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>
          {show.name}{show.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({show.name_en})</span>}
          {show.watch_link && (
            <> <a href={show.watch_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.6em", opacity: 0.7, fontWeight: "normal", color: "inherit" }}>(link)</a></>
          )}
        </h1>
        <button onClick={() => setEditing(true)}>✎ Edit</button>
      </header>

      <div className="page-tabs">
        <NavLink to={`/television/${showId}`} end>Overview</NavLink>
        <NavLink to={`/television/${showId}/rank`}>Rank Episodes</NavLink>
      </div>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div>
            <span className="detail-label">Release year</span>
            <span>{show.release_year}</span>
          </div>
          <div>
            <span className="detail-label">Episodes</span>
            <span>{show.episode_count}</span>
          </div>
          <div>
            <span className="detail-label">Total runtime</span>
            <span>{fmtRuntime(show.total_runtime_minutes)}</span>
          </div>
          <div>
            <span className="detail-label">Total watches</span>
            <span>{show.total_watches}</span>
          </div>
          {show.soundtrack_albums.length > 0 && (
            <div>
              <span className="detail-label">Soundtrack</span>
              <span>
                {show.soundtrack_albums.map((a, i) => (
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
        </div>
        {show.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{show.notes}</span>
          </div>
        )}
      </div>

      <ShowPeopleSection show={show} />
      <GenresSection show={show} />
      <EpisodesSection show={show} />

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TelevisionShowForm
              initial={show}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: ["television", "shows", showId] });
                qc.invalidateQueries({ queryKey: ["television", "ranked"] });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
