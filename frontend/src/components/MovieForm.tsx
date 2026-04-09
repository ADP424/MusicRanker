import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useAlbumIndex, usePeople } from "../api/hooks";
import type { AlbumIndex, CastRole, Movie, MovieBody, Person } from "../api/types";
import { CAST_ROLES } from "../api/types";
import { MovieGenreChooser } from "./MovieGenreChooser";
import { PersonForm } from "./PersonForm";

const orNull = (s: string) => (s.trim() === "" ? null : s);

const ROLE_LABEL: Record<CastRole, string> = {
  director:   "Director",
  composer:   "Composer",
  actor:      "Actor",
  lead_actor: "Lead Actor",
};

// A pending person link: person_id + role
type PendingLink = { personId: number; role: CastRole };

function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

export function MovieForm(props: {
  initial?: Movie;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const [castOpen, setCastOpen] = useState(false);
  const [genreOpen, setGenreOpen] = useState(false);
  const [soundtrackOpen, setSoundtrackOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [personDupWarning, setPersonDupWarning] = useState<string | null>(null);

  const [f, setF] = useState({
    name:            initial?.name            ?? "",
    runtime_minutes: initial?.runtime_minutes ?? 0,
    release_year:    initial?.release_year    ?? new Date().getFullYear(),
    watches:         initial?.watches         ?? 1,
    watch_link:      initial?.watch_link      ?? "",
    notes:           initial?.notes           ?? "",
  });

  // Genre chooser — initialise from the genre_ids already on the movie object
  const initialGenreIds = initial?.genre_ids ?? [];
  const [genreIds, setGenreIds] = useState<Set<number>>(
    () => new Set(initialGenreIds)
  );

  // Keep currentGenres in sync for the save diff
  const { data: currentGenres = initialGenreIds.map((id) => ({ id })) } = useQuery({
    queryKey: ["movies", initial?.id, "genres"],
    queryFn: () => api.get<{ id: number; name: string }[]>(`/movies/${initial!.id}/genres`),
    enabled: editing,
  });

  // Person links (set of PendingLink)
  const { data: allPeople = [] } = usePeople();
  const [castLinks, setCastLinks] = useState<Set<string>>(new Set()); // keys: "id:role"
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [castSearch, setCastSearch] = useState("");
  const [addRole, setAddRole] = useState<CastRole>("director");

  // Soundtrack album links
  const { data: allAlbums = [] } = useAlbumIndex();
  const [soundtrackIds, setSoundtrackIds] = useState<Set<number>>(
    () => new Set((initial?.soundtrack_albums ?? []).map((a) => a.id))
  );
  const [albumSearch, setAlbumSearch] = useState("");

  const filteredAlbums = useMemo(() => {
    const q = albumSearch.trim().toLowerCase();
    return (q ? allAlbums.filter((a: AlbumIndex) => a.name.toLowerCase().includes(q)) : allAlbums)
      .slice(0, 50);
  }, [albumSearch, allAlbums]);

  useEffect(() => {
    if (editing && initial.persons) {
      const links = initial.persons.map((r) => ({ personId: r.id, role: r.role }));
      setPendingLinks(links);
      setCastLinks(new Set(links.map(linkKey)));
    }
  }, [initial?.persons]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredPeople = useMemo(() => {
    const q = castSearch.trim().toLowerCase();
    return allPeople.filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [castSearch, allPeople]);

  function toggleLink(person: Person, role: CastRole) {
    const key = linkKey({ personId: person.id, role });
    const next = new Set(castLinks);
    const nextLinks = [...pendingLinks];
    if (next.has(key)) {
      next.delete(key);
      const idx = nextLinks.findIndex((l) => linkKey(l) === key);
      if (idx >= 0) nextLinks.splice(idx, 1);
    } else {
      next.add(key);
      nextLinks.push({ personId: person.id, role });
    }
    setCastLinks(next);
    setPendingLinks(nextLinks);
  }

  const save = useMutation({
    mutationFn: async () => {
      const body: MovieBody = {
        name: f.name,
        runtime_minutes: f.runtime_minutes,
        release_year: f.release_year,
        watches: f.watches,
        watch_link: orNull(f.watch_link),
        notes: orNull(f.notes),
      };

      let movie: Movie;
      if (editing) {
        movie = await api.patch<Movie>(`/movies/${initial.id}`, body);
      } else {
        movie = await api.post<Movie>("/movies", body);
      }

      // Diff person links
      const beforeLinks = new Set(
        (initial?.persons ?? []).map((r) => linkKey({ personId: r.id, role: r.role }))
      );
      for (const link of pendingLinks) {
        const key = linkKey(link);
        if (!beforeLinks.has(key)) {
          await api.put(`/movies/${movie.id}/persons/${link.personId}/${link.role}`);
        }
      }
      for (const key of beforeLinks) {
        if (!castLinks.has(key)) {
          const [personId, role] = key.split(":");
          await api.delete(`/movies/${movie.id}/persons/${personId}/${role}`);
        }
      }

      // Diff genres
      const before = new Set(currentGenres.map((g) => g.id));
      for (const id of genreIds)
        if (!before.has(id)) await api.put(`/movies/${movie.id}/genres/${id}`);
      for (const id of before)
        if (!genreIds.has(id)) await api.delete(`/movies/${movie.id}/genres/${id}`);

      // Diff soundtrack albums
      const beforeSoundtrack = new Set((initial?.soundtrack_albums ?? []).map((a) => a.id));
      for (const id of soundtrackIds)
        if (!beforeSoundtrack.has(id)) await api.put(`/movies/${movie.id}/soundtrack/${id}`);
      for (const id of beforeSoundtrack)
        if (!soundtrackIds.has(id)) await api.delete(`/movies/${movie.id}/soundtrack/${id}`);

      return movie;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["movies", "ranked"] });
      qc.invalidateQueries({ queryKey: ["movies", "index"] });
      if (editing) {
        qc.invalidateQueries({ queryKey: ["movies", initial.id, "genres"] });
      }
      onClose(saved.name, saved.id);
    },
  });

  const num = (k: "runtime_minutes" | "release_year" | "watches") =>
    (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  const txt = (k: "name" | "watch_link" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  // Grouped summary of selected persons
  const selectedByRole = useMemo(() => {
    const map: Record<CastRole, string[]> = { director: [], composer: [], actor: [], lead_actor: [] };
    for (const link of pendingLinks) {
      const p = allPeople.find((p) => p.id === link.personId);
      if (p) map[link.role].push(p.name);
    }
    return map;
  }, [pendingLinks, allPeople]);

  return (
    <dialog open className="modal">
      {creatingPerson && (
        <PersonForm
          onClose={(savedName, savedId) => {
            setCreatingPerson(false);
            if (savedId != null) {
              qc.invalidateQueries({ queryKey: ["people"] });
              const key = linkKey({ personId: savedId, role: addRole });
              setCastLinks((prev) => new Set([...prev, key]));
              setPendingLinks((prev) => [...prev, { personId: savedId, role: addRole }]);
            }
            if (savedName != null) {
              const nameLower = savedName.toLowerCase();
              const dups = allPeople.filter((p) => p.name.toLowerCase() === nameLower && p.id !== savedId);
              if (dups.length > 0) setPersonDupWarning(`Warning: another person named "${savedName}" already exists.`);
            }
          }}
        />
      )}
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} Movie</h2>

        <label>Name
          <input required value={f.name} onChange={txt("name")} />
        </label>

        <div className="grid-2">
          <label>Runtime (minutes)
            <input type="number" min={1} value={f.runtime_minutes} onChange={num("runtime_minutes")} />
          </label>
          <label>Release year
            <input required type="number" value={f.release_year} onChange={num("release_year")} />
          </label>
        </div>

        <div className="grid-2">
          <label>Watches
            <input type="number" min={1} value={f.watches} onChange={num("watches")} />
          </label>
          <label>Watch link
            <input type="url" value={f.watch_link} onChange={txt("watch_link")} />
          </label>
        </div>

        <label>Notes
          <textarea rows={3} value={f.notes} onChange={txt("notes")} />
        </label>

        {/* ── People / roles ── */}
        <fieldset>
          <legend className="collapsible-legend" onClick={() => setCastOpen((o) => !o)}>
            People
            <span className="collapse-arrow">{castOpen ? "▲" : "▼"}</span>
          </legend>
          {!castOpen && (
            <span className="collapsed-summary" onClick={() => setCastOpen(true)}>
              {pendingLinks.length > 0
                ? CAST_ROLES.filter((r) => selectedByRole[r].length > 0).map((r) =>
                    `${ROLE_LABEL[r]}: ${selectedByRole[r].join(", ")}`
                  ).join(" · ")
                : "None selected"}
            </span>
          )}
          {castOpen && (
            <>
              {personDupWarning && (
                <div className="dup-warning">
                  <span>{personDupWarning}</span>
                  <button type="button" className="icon" onClick={() => setPersonDupWarning(null)}>✕</button>
                </div>
              )}
              {/* Selected links summary */}
              {pendingLinks.length > 0 && (
                <div style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                  {CAST_ROLES.filter((r) => selectedByRole[r].length > 0).map((r) => (
                    <div key={r}>
                      <strong>{ROLE_LABEL[r]}:</strong>{" "}
                      {selectedByRole[r].map((name, i) => (
                        <span key={i}>
                          {i > 0 && ", "}
                          <span
                            style={{ cursor: "pointer", textDecoration: "underline dotted", opacity: 0.8 }}
                            onClick={() => {
                              const p = allPeople.find((p) => p.name === name);
                              if (p) toggleLink(p, r);
                            }}
                            title="Click to remove"
                          >{name}</span>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Role selector */}
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                {CAST_ROLES.map((role) => (
                  <label key={role} className={`chip${addRole === role ? " chip-active" : ""}`}
                    onClick={() => setAddRole(role)} style={{ cursor: "pointer" }}>
                    {ROLE_LABEL[role]}
                  </label>
                ))}
              </div>

              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
                <input
                  className="genre-search"
                  type="search"
                  placeholder="Search people…"
                  value={castSearch}
                  onChange={(e) => setCastSearch(e.target.value)}
                  style={{ margin: 0, flex: 1 }}
                />
                <button type="button" style={{ whiteSpace: "nowrap" }} onClick={() => setCreatingPerson(true)}>
                  + New Person
                </button>
              </div>
              <div className="chips">
                {filteredPeople.map((p) => {
                  const key = linkKey({ personId: p.id, role: addRole });
                  return (
                    <label key={p.id} className="chip">
                      <input
                        type="checkbox"
                        checked={castLinks.has(key)}
                        onChange={() => toggleLink(p, addRole)}
                      />
                      {p.name}
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </fieldset>

        {/* ── Genres ── */}
        <fieldset>
          <legend className="collapsible-legend" onClick={() => setGenreOpen((o) => !o)}>
            Genres
            <span className="collapse-arrow">{genreOpen ? "▲" : "▼"}</span>
          </legend>
          {genreOpen && (
            <MovieGenreChooser selected={genreIds} onChange={setGenreIds} />
          )}
          {!genreOpen && (
            <span className="collapsed-summary" onClick={() => setGenreOpen(true)}>
              {genreIds.size > 0 ? `${genreIds.size} selected` : "None selected"}
            </span>
          )}
        </fieldset>

        {/* ── Soundtrack ── */}
        <fieldset>
          <legend className="collapsible-legend" onClick={() => setSoundtrackOpen((o) => !o)}>
            Soundtrack
            <span className="collapse-arrow">{soundtrackOpen ? "▲" : "▼"}</span>
          </legend>
          {!soundtrackOpen && (
            <span className="collapsed-summary" onClick={() => setSoundtrackOpen(true)}>
              {soundtrackIds.size > 0
                ? allAlbums.filter((a: AlbumIndex) => soundtrackIds.has(a.id)).map((a: AlbumIndex) => a.name).join(", ")
                : "None selected"}
            </span>
          )}
          {soundtrackOpen && (
            <>
              {soundtrackIds.size > 0 && (
                <div style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                  {allAlbums
                    .filter((a: AlbumIndex) => soundtrackIds.has(a.id))
                    .map((a: AlbumIndex) => (
                      <span key={a.id} style={{ marginRight: "0.5rem" }}>
                        <span
                          style={{ cursor: "pointer", textDecoration: "underline dotted", opacity: 0.8 }}
                          onClick={() => setSoundtrackIds((prev) => { const next = new Set(prev); next.delete(a.id); return next; })}
                          title="Click to remove"
                        >{a.name}</span>
                      </span>
                    ))}
                </div>
              )}
              <input
                className="genre-search"
                type="search"
                placeholder="Search albums…"
                value={albumSearch}
                onChange={(e) => setAlbumSearch(e.target.value)}
              />
              <div className="chips">
                {filteredAlbums.map((a: AlbumIndex) => (
                  <label key={a.id} className="chip">
                    <input
                      type="checkbox"
                      checked={soundtrackIds.has(a.id)}
                      onChange={(e) => {
                        const next = new Set(soundtrackIds);
                        e.target.checked ? next.add(a.id) : next.delete(a.id);
                        setSoundtrackIds(next);
                      }}
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            </>
          )}
        </fieldset>

        <footer>
          <button type="button" onClick={() => onClose()}>Cancel</button>
          <button type="submit" disabled={save.isPending}>{editing ? "Save" : "Create"}</button>
        </footer>
        {save.isError && <p className="err">{(save.error as Error).message}</p>}
      </form>
    </dialog>
  );
}
