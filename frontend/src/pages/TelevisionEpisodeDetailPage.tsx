import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useTelevisionGenres, usePeople } from "../api/hooks";
import type { CastRole, Genre, Person, TelevisionEpisode, TelevisionPersonRef, TelevisionShow } from "../api/types";
import { CAST_ROLE_LABELS, TV_EPISODE_ROLES } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TelevisionEpisodeForm } from "../components/TelevisionEpisodeForm";
import { TelevisionGenreChooser } from "../components/TelevisionGenreChooser";
import { TmdbTelevisionEpisodeImportDialog } from "../components/TmdbTelevisionEpisodeImportDialog";
import { PersonForm } from "../components/PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../components/PersonPicker";

function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m > 0 ? `${m}m` : ""}`.trim();
  return `${m}m`;
}

function EpisodePeopleSection({ episode }: { episode: TelevisionEpisode }) {
  const qc = useQueryClient();
  const { data: allPeople = [] } = usePeople();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<TelevisionPersonRef | null>(null);
  const [castSearch, setCastSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<CastRole>("director");
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const [castKeys, setCastKeys] = useState<Set<string>>(
    () => new Set(episode.persons.map((p) => `${p.id}:${p.role}`))
  );

  useEffect(() => {
    setCastKeys(new Set(episode.persons.map((p) => `${p.id}:${p.role}`)));
  }, [episode.persons]);

  const filteredPeople = useMemo(
    () => allPeople.filter((p) => matchesPersonSearch(p, searchField, castSearch)),
    [castSearch, searchField, allPeople],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["television", "episodes", episode.id] });

  const link = useMutation({
    mutationFn: ({ personId, role }: { personId: number; role: CastRole }) =>
      api.put(`/television/episodes/${episode.id}/persons/${personId}/${role}`),
    onSuccess: invalidate,
  });

  const unlink = useMutation({
    mutationFn: ({ personId, role }: { personId: number; role: CastRole }) =>
      api.delete(`/television/episodes/${episode.id}/persons/${personId}/${role}`),
    onSuccess: invalidate,
  });

  function toggleLink(person: Person, role: CastRole) {
    const key = `${person.id}:${role}`;
    if (castKeys.has(key)) {
      const ref = episode.persons.find((p) => p.id === person.id && p.role === role);
      if (ref) setConfirmUnlink(ref);
    } else {
      link.mutate({ personId: person.id, role });
      setCastKeys((prev) => new Set([...prev, key]));
    }
  }

  const byRole: Record<string, TelevisionPersonRef[]> = {};
  for (const p of episode.persons) {
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
              roles={TV_EPISODE_ROLES}
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

      {episode.persons.length > 0 ? (
        TV_EPISODE_ROLES.filter((r) => byRole[r]?.length).map((role) => (
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
                      <button className="icon" title="Remove" onClick={() => setConfirmUnlink(p)}>✕</button>
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
          message={`Remove "${confirmUnlink.name}" (${CAST_ROLE_LABELS[confirmUnlink.role]}) from this episode?`}
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

function EpisodeGenresSection({ episode }: { episode: TelevisionEpisode }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useTelevisionGenres();

  const { data: episodeGenres = [] } = useQuery({
    queryKey: ["television", "episodes", episode.id, "genres"],
    queryFn: () => api.get<Genre[]>(`/television/episodes/${episode.id}/genres`),
  });

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setGenreIds(new Set(episodeGenres.map((g) => g.id)));
  }, [episodeGenres]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`/television/episodes/${episode.id}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["television", "episodes", episode.id, "genres"] });
      qc.invalidateQueries({ queryKey: ["television", "episodes", episode.id] });
    },
  });

  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`/television/episodes/${episode.id}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["television", "episodes", episode.id, "genres"] });
      qc.invalidateQueries({ queryKey: ["television", "episodes", episode.id] });
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

      {episodeGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {episodeGenres.map((g) => (
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
          message={`Remove genre "${confirmUnlink.name}" from this episode?`}
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

export function TelevisionEpisodeDetailPage() {
  const { showId, episodeId } = useParams<{ showId: string; episodeId: string }>();
  const epId = Number(episodeId);
  const sid = Number(showId);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [tmdbImport, setTmdbImport] = useState(false);

  const { data: episode, isLoading, isError } = useQuery({
    queryKey: ["television", "episodes", epId],
    queryFn: () => api.get<TelevisionEpisode>(`/television/episodes/${epId}`),
    enabled: !isNaN(epId),
  });

  const { data: show } = useQuery({
    queryKey: ["television", "shows", sid],
    queryFn: () => api.get<TelevisionShow>(`/television/shows/${sid}`),
    enabled: !isNaN(sid),
  });

  if (isLoading) return <section><p>Loading…</p></section>;
  if (isError || !episode) return <section><p>Episode not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>
          {episode.name}{episode.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({episode.name_en})</span>}
          {episode.watch_link && (
            <> <a href={episode.watch_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.6em", opacity: 0.7, fontWeight: "normal", color: "inherit" }}>(link)</a></>
          )}
        </h1>
        <button onClick={() => setTmdbImport(true)} disabled={!show}>⬇ Import from TMDB</button>
        <button onClick={() => setEditing(true)}>✎ Edit</button>
      </header>

      <p style={{ marginTop: "-0.5rem" }}>
        <Link className="plain-link" to={`/television/${episode.show_id}`}>← {episode.show_name}</Link>
      </p>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div>
            <span className="detail-label">Release year</span>
            <span>{episode.release_year}</span>
          </div>
          <div>
            <span className="detail-label">Runtime</span>
            <span>{fmtRuntime(episode.runtime_minutes)}</span>
          </div>
          <div>
            <span className="detail-label">Watches</span>
            <span>{episode.watches}</span>
          </div>
          {/* Soundtracks are show-level; surfaced here read-only for context. */}
          {show && show.soundtrack_albums.length > 0 && (
            <div>
              <span className="detail-label">Soundtrack (show)</span>
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
        {episode.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{episode.notes}</span>
          </div>
        )}
      </div>

      <EpisodePeopleSection episode={episode} />
      <EpisodeGenresSection episode={episode} />

      {editing && show && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TelevisionEpisodeForm
              show={show}
              initial={episode}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: ["television", "episodes", epId] });
                qc.invalidateQueries({ queryKey: ["television", "shows", sid] });
              }}
            />
          </div>
        </div>
      )}

      {tmdbImport && show && (
        <div className="modal-backdrop" onClick={() => setTmdbImport(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TmdbTelevisionEpisodeImportDialog
              show={show}
              episode={episode}
              onClose={() => setTmdbImport(false)}
              onSuccess={() => {
                qc.invalidateQueries({ queryKey: ["television", "episodes", epId] });
                qc.invalidateQueries({ queryKey: ["television", "shows", sid] });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
