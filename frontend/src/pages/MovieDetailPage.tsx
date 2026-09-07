import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useEntryMutations, useGuildApi, useMovieEntry, useMovieGenres, usePeople, useUpdateMovieEntry } from "../api/hooks";
import { gk } from "../api/keys";
import type { CastRole, Genre, Movie, Person } from "../api/types";
import { CAST_ROLE_LABELS, MOVIE_ROLES } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LinksSection } from "../components/LinksSection";
import { MovieForm } from "../components/MovieForm";
import { PersonForm } from "../components/PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../components/PersonPicker";
import { GenreChooser } from "../genre/GenreChooser";
import { MOVIE_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { BusyButton, InlineBusy, LoadingState } from "../components/Spinner";

function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`;
  return `${m}m`;
}

type PendingLink = { personId: number; role: CastRole };
function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

// ── People section ──────────────────────────────────────────────────────────

function MoviePeopleSection({ movieId, movie }: { movieId: number; movie: Movie }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const { data: allPeople = [], isLoading: peopleLoading } = usePeople();
  const [editing, setEditing] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<CastRole>("director");

  const castKeys = useMemo(() => new Set(movie.persons.map((p) => linkKey({ personId: p.id, role: p.role }))), [movie.persons]);

  const filteredPeople = useMemo(() => {
    return allPeople
      .filter((p) => matchesPersonSearch(p, searchField, search))
      .sort((a, b) => {
        const aKey = linkKey({ personId: a.id, role: addRole });
        const bKey = linkKey({ personId: b.id, role: addRole });
        return (castKeys.has(aKey) ? 0 : 1) - (castKeys.has(bKey) ? 0 : 1);
      });
  }, [search, searchField, allPeople, castKeys, addRole]);

  const invalidate = () => qc.invalidateQueries({ queryKey: gk(guildId, "movies", movieId) });

  const link = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: CastRole }) =>
      api.put(`${base}/movies/${movieId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: CastRole }) =>
      api.delete(`${base}/movies/${movieId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });

  function toggleLink(person: Person, role: CastRole) {
    const key = linkKey({ personId: person.id, role });
    if (castKeys.has(key)) unlink.mutate({ pid: person.id, role });
    else link.mutate({ pid: person.id, role });
  }

  const byRole: Partial<Record<CastRole, Movie["persons"]>> = {};
  for (const p of movie.persons) (byRole[p.role] ??= []).push(p);

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>People</h2>
          {(link.isPending || unlink.isPending) && <InlineBusy label="Saving…" />}
        </span>
        {canEdit && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
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
              roles={MOVIE_ROLES}
              roleLabels={CAST_ROLE_LABELS}
              activeRole={addRole}
              onRole={setAddRole}
              searchField={searchField}
              onSearchField={setSearchField}
              search={search}
              onSearch={setSearch}
              onNewPerson={() => setCreatingPerson(true)}
              people={filteredPeople}
              isChecked={(p, role) => castKeys.has(linkKey({ personId: p.id, role }))}
              onToggle={toggleLink}
              loading={peopleLoading}
              busy={link.isPending || unlink.isPending}
            />
          </div>
        </>
      )}

      {movie.persons.length > 0 ? (
        MOVIE_ROLES.filter((r) => byRole[r]?.length).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>{CAST_ROLE_LABELS[role]}</div>
            <ul className="sortable plain-list">
              {byRole[role]!.map((p) => (
                <li key={`${p.id}:${p.role}`} className="sortable-item">
                  <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                    <Link className="name" to={`/g/${guildId}/people/${p.id}`}>
                      {p.name}{p.name_en && <span style={{ opacity: 0.6 }}> ({p.name_en})</span>}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No people linked.</p>
      )}

      {creatingPerson && (
        <div className="modal-backdrop" onClick={() => setCreatingPerson(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PersonForm
              onClose={(savedName, savedId) => {
                setCreatingPerson(false);
                if (savedId != null) {
                  qc.invalidateQueries({ queryKey: gk(guildId, "people") });
                  link.mutate({ pid: savedId, role: addRole });
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

// ── Genres section ───────────────────────────────────────────────────────────

function MovieGenresSection({ movieId, movie }: { movieId: number; movie: Movie }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useMovieGenres();

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => { setGenreIds(new Set(movie.genre_ids)); }, [movie.genre_ids]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));
  const movieGenres = movie.genre_ids.map((id) => genreMap[id]).filter(Boolean);

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`${base}/movies/${movieId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "movies") }),
  });
  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`${base}/movies/${movieId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "movies") }),
  });

  function handleChange(next: Set<number>) {
    const prev = genreIds;
    for (const id of next) if (!prev.has(id)) addGenre.mutate(id);
    for (const id of prev) {
      if (!next.has(id)) {
        const g = genreMap[id];
        if (g) { setConfirmUnlink(g); return; }
      }
    }
    setGenreIds(next);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>Genres</h2>
          {(addGenre.isPending || removeGenre.isPending) && <InlineBusy label="Saving…" />}
        </span>
        {canEdit && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
          <GenreChooser domain={MOVIE_GENRES} selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {movieGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {movieGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/g/${guildId}/movies/genres/${g.id}`}>{g.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No genres linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove genre "${confirmUnlink.name}" from this movie?`}
          busy={removeGenre.isPending}
          onConfirm={() => {
            const id = confirmUnlink.id;
            setGenreIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
            removeGenre.mutate(id, { onSettled: () => setConfirmUnlink(null) });
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}

// ── My list section ──────────────────────────────────────────────────────────

function MyMovieListSection({ movieId }: { movieId: number }) {
  const canRank = useCan("rank");
  const { data: entry, isLoading } = useMovieEntry(movieId);
  const update = useUpdateMovieEntry(movieId);
  const entryMutations = useEntryMutations("movies");
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (entry) setNotes(entry.notes ?? "");
  }, [entry]);

  if (!canRank) return null;
  const saving = update.isPending || entryMutations.add.isPending || entryMutations.remove.isPending;

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>My List</h2>
          {saving && <InlineBusy label="Saving…" />}
        </span>
        {entry && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {isLoading ? (
        <LoadingState compact />
      ) : !entry ? (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>
          Not in your list. <BusyButton busy={entryMutations.add.isPending} busyLabel="Adding…"
                                        onClick={() => entryMutations.add.mutate(movieId)}>+ Add to my list</BusyButton>
        </p>
      ) : (
        <>
          <div className="artist-detail-grid">
            <div>
              <span className="detail-label">Watches</span>
              <span className="listens-ctrl">
                <button className="icon" title="Remove one watch" disabled={entry.watches <= 1}
                        onClick={() => update.mutate({ watches: entry.watches - 1 })}>−</button>
                <input
                  type="number" min={1} className="listens-input" value={entry.watches}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 1) update.mutate({ watches: n });
                  }}
                />
                <button className="icon" title="Add one watch"
                        onClick={() => update.mutate({ watches: entry.watches + 1 })}>+</button>
              </span>
            </div>
          </div>

          {editing ? (
            <div className="detail-section-form" style={{ marginTop: "0.75rem" }}>
              <label>My notes
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                <BusyButton busy={update.isPending} busyLabel="Saving…"
                            onClick={() => update.mutate({ notes: notes.trim() === "" ? null : notes })}>Save notes</BusyButton>
                <button className="danger" onClick={() => setConfirmRemove(true)}>✕ Remove from my list</button>
              </div>
            </div>
          ) : (
            entry.notes && (
              <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
                <span className="detail-label">My notes</span>
                <span>{entry.notes}</span>
              </div>
            )
          )}
        </>
      )}

      {confirmRemove && (
        <ConfirmDialog
          message="Remove this movie from your list? Your watch count and personal notes for it will be lost."
          confirmLabel="Remove"
          busy={entryMutations.remove.isPending}
          onConfirm={() => entryMutations.remove.mutate(movieId, { onSettled: () => { setConfirmRemove(false); setEditing(false); } })}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function MovieDetailPage() {
  const { id } = useParams<{ id: string }>();
  const movieId = Number(id);
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);

  const { data: movie, isLoading, isError } = useQuery({
    queryKey: gk(guildId, "movies", movieId),
    queryFn: () => api.get<Movie>(`${base}/movies/${movieId}`),
    enabled: !isNaN(movieId),
  });

  if (isLoading) return <section><LoadingState label="Loading movie…" /></section>;
  if (isError || !movie) return <section><p>Movie not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>
          {movie.name}{movie.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({movie.name_en})</span>}
        </h1>
        {canEdit && <button onClick={() => setEditing(true)}>✎ Edit</button>}
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div><span className="detail-label">Release year</span><span>{movie.release_year}</span></div>
          <div><span className="detail-label">Runtime</span><span>{fmtRuntime(movie.runtime_minutes)}</span></div>
        </div>
        {movie.soundtrack_albums.length > 0 && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Soundtrack</span>
            <span>
              {movie.soundtrack_albums.map((a, i) => (
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
        {movie.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{movie.notes}</span>
          </div>
        )}
      </div>

      <MoviePeopleSection movieId={movieId} movie={movie} />
      <MovieGenresSection movieId={movieId} movie={movie} />
      <LinksSection path="movies" section="movies" ownerId={movieId} />
      <MyMovieListSection movieId={movieId} />

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <MovieForm
              initial={movie}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: gk(guildId, "movies", movieId) });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
