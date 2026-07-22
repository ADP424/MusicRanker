import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useAlbumIndex, usePeople } from "../api/hooks";
import type { AlbumIndex, Game, GameBody, GameRole, Person } from "../api/types";
import { GAME_ROLES, GAME_ROLE_LABELS } from "../api/types";
import { GameGenreChooser } from "./GameGenreChooser";
import { GamePlatformChooser } from "./GamePlatformChooser";
import { PersonForm } from "./PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "./PersonPicker";

const orNull = (s: string) => (s.trim() === "" ? null : s);

// A pending person link: person_id + role
type PendingLink = { personId: number; role: GameRole };

function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

export function GameForm(props: {
  initial?: Game;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const [castOpen, setCastOpen] = useState(false);
  const [genreOpen, setGenreOpen] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const [soundtrackOpen, setSoundtrackOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [personDupWarning, setPersonDupWarning] = useState<string | null>(null);

  const [f, setF] = useState({
    name:          initial?.name          ?? "",
    name_en:       initial?.name_en       ?? "",
    release_year:  initial?.release_year  ?? new Date().getFullYear(),
    // kept as a string so the field can be genuinely empty (= null, "untracked")
    hours_played:  initial?.hours_played != null ? String(initial.hours_played) : "",
    play_link:     initial?.play_link     ?? "",
    notes:         initial?.notes         ?? "",
  });

  // Genre chooser — initialise from the genre_ids already on the game object
  const initialGenreIds = initial?.genre_ids ?? [];
  const [genreIds, setGenreIds] = useState<Set<number>>(
    () => new Set(initialGenreIds)
  );

  // Keep currentGenres in sync for the save diff
  const { data: currentGenres = initialGenreIds.map((id) => ({ id })) } = useQuery({
    queryKey: ["games", initial?.id, "genres"],
    queryFn: () => api.get<{ id: number; name: string }[]>(`/games/${initial!.id}/genres`),
    enabled: editing,
  });

  // Platform chooser — initialise from the platform_ids already on the game object
  const initialPlatformIds = initial?.platform_ids ?? [];
  const [platformIds, setPlatformIds] = useState<Set<number>>(
    () => new Set(initialPlatformIds)
  );

  // Keep currentPlatforms in sync for the save diff
  const { data: currentPlatforms = initialPlatformIds.map((id) => ({ id })) } = useQuery({
    queryKey: ["games", initial?.id, "platforms"],
    queryFn: () => api.get<{ id: number; name: string }[]>(`/games/${initial!.id}/platforms`),
    enabled: editing,
  });

  // Person links (set of PendingLink)
  const { data: allPeople = [] } = usePeople();
  const [castLinks, setCastLinks] = useState<Set<string>>(new Set()); // keys: "id:role"
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [castSearch, setCastSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<GameRole>("director");

  // Soundtrack album links
  const { data: allAlbums = [] } = useAlbumIndex();
  const [soundtrackIds, setSoundtrackIds] = useState<Set<number>>(
    () => new Set((initial?.soundtrack_albums ?? []).map((a) => a.id))
  );
  const [albumSearch, setAlbumSearch] = useState("");

  const [albumSortSnap, setAlbumSortSnap] = useState(() => soundtrackIds);
  useEffect(() => { setAlbumSortSnap(soundtrackIds); }, [albumSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredAlbums = useMemo(() => {
    const q = albumSearch.trim().toLowerCase();
    return (q ? allAlbums.filter((a: AlbumIndex) => a.name.toLowerCase().includes(q) || !!a.name_en?.toLowerCase().includes(q)) : allAlbums)
      .sort((a: AlbumIndex, b: AlbumIndex) => (albumSortSnap.has(a.id) ? 0 : 1) - (albumSortSnap.has(b.id) ? 0 : 1))
      .slice(0, 50);
  }, [albumSearch, allAlbums, albumSortSnap]);

  useEffect(() => {
    if (editing && initial.persons) {
      const links = initial.persons.map((r) => ({ personId: r.id, role: r.role }));
      setPendingLinks(links);
      setCastLinks(new Set(links.map(linkKey)));
    }
  }, [initial?.persons]); // eslint-disable-line react-hooks/exhaustive-deps

  const [castSortSnap, setCastSortSnap] = useState(() => castLinks);
  useEffect(() => { setCastSortSnap(castLinks); }, [castSearch, addRole]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredPeople = useMemo(() => {
    return allPeople
      .filter((p) => matchesPersonSearch(p, searchField, castSearch))
      .sort((a, b) => {
        const aKey = linkKey({ personId: a.id, role: addRole });
        const bKey = linkKey({ personId: b.id, role: addRole });
        return (castSortSnap.has(aKey) ? 0 : 1) - (castSortSnap.has(bKey) ? 0 : 1);
      });
  }, [castSearch, searchField, allPeople, castSortSnap, addRole]);

  function toggleLink(person: Person, role: GameRole) {
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
      const hours = f.hours_played.trim();
      const body: GameBody = {
        name: f.name,
        name_en: orNull(f.name_en),
        release_year: f.release_year,
        hours_played: hours === "" ? null : Number(hours),
        play_link: orNull(f.play_link),
        notes: orNull(f.notes),
      };

      let game: Game;
      if (editing) {
        game = await api.patch<Game>(`/games/${initial.id}`, body);
      } else {
        game = await api.post<Game>("/games", body);
      }

      // Diff person links
      const beforeLinks = new Set(
        (initial?.persons ?? []).map((r) => linkKey({ personId: r.id, role: r.role }))
      );
      for (const link of pendingLinks) {
        const key = linkKey(link);
        if (!beforeLinks.has(key)) {
          await api.put(`/games/${game.id}/persons/${link.personId}/${link.role}`);
        }
      }
      for (const key of beforeLinks) {
        if (!castLinks.has(key)) {
          const [personId, role] = key.split(":");
          await api.delete(`/games/${game.id}/persons/${personId}/${role}`);
        }
      }

      // Diff genres
      const beforeGenres = new Set(currentGenres.map((g) => g.id));
      for (const id of genreIds)
        if (!beforeGenres.has(id)) await api.put(`/games/${game.id}/genres/${id}`);
      for (const id of beforeGenres)
        if (!genreIds.has(id)) await api.delete(`/games/${game.id}/genres/${id}`);

      // Diff platforms
      const beforePlatforms = new Set(currentPlatforms.map((p) => p.id));
      for (const id of platformIds)
        if (!beforePlatforms.has(id)) await api.put(`/games/${game.id}/platforms/${id}`);
      for (const id of beforePlatforms)
        if (!platformIds.has(id)) await api.delete(`/games/${game.id}/platforms/${id}`);

      // Diff soundtrack albums
      const beforeSoundtrack = new Set((initial?.soundtrack_albums ?? []).map((a) => a.id));
      for (const id of soundtrackIds)
        if (!beforeSoundtrack.has(id)) await api.put(`/games/${game.id}/soundtrack/${id}`);
      for (const id of beforeSoundtrack)
        if (!soundtrackIds.has(id)) await api.delete(`/games/${game.id}/soundtrack/${id}`);

      return game;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["games", "ranked"] });
      qc.invalidateQueries({ queryKey: ["games", "index"] });
      if (editing) {
        qc.invalidateQueries({ queryKey: ["games", initial.id, "genres"] });
        qc.invalidateQueries({ queryKey: ["games", initial.id, "platforms"] });
      }
      onClose(saved.name, saved.id);
    },
  });

  const num = (k: "release_year") =>
    (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  const txt = (k: "name" | "name_en" | "hours_played" | "play_link" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  // Grouped summary of selected persons
  const selectedByRole = useMemo(() => {
    const map = Object.fromEntries(GAME_ROLES.map((r) => [r, [] as string[]])) as Record<GameRole, string[]>;
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
        <h2>{editing ? "Edit" : "New"} Game</h2>

        <label>Name
          <input required value={f.name} onChange={txt("name")} />
        </label>

        <label>English name <span style={{ opacity: 0.5, fontWeight: "normal", fontSize: 12 }}>(optional)</span>
          <input value={f.name_en} onChange={txt("name_en")} />
        </label>

        <div className="grid-2">
          <label>Release year
            <input required type="number" value={f.release_year} onChange={num("release_year")} />
          </label>
          <label>Hours played
            <input
              type="number"
              min={0}
              step={0.5}
              value={f.hours_played}
              onChange={txt("hours_played")}
              placeholder="untracked"
            />
          </label>
        </div>

        <label>Play link
          <input type="url" value={f.play_link} onChange={txt("play_link")} />
        </label>

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
                ? GAME_ROLES.filter((r) => selectedByRole[r].length > 0).map((r) =>
                    `${GAME_ROLE_LABELS[r]}: ${selectedByRole[r].join(", ")}`
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
                  {GAME_ROLES.filter((r) => selectedByRole[r].length > 0).map((r) => (
                    <div key={r}>
                      <strong>{GAME_ROLE_LABELS[r]}:</strong>{" "}
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

              <PersonPicker
                roles={GAME_ROLES}
                roleLabels={GAME_ROLE_LABELS}
                activeRole={addRole}
                onRole={setAddRole}
                searchField={searchField}
                onSearchField={setSearchField}
                search={castSearch}
                onSearch={setCastSearch}
                onNewPerson={() => setCreatingPerson(true)}
                people={filteredPeople}
                isChecked={(p, role) => castLinks.has(linkKey({ personId: p.id, role }))}
                onToggle={toggleLink}
              />
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
            <GameGenreChooser selected={genreIds} onChange={setGenreIds} />
          )}
          {!genreOpen && (
            <span className="collapsed-summary" onClick={() => setGenreOpen(true)}>
              {genreIds.size > 0 ? `${genreIds.size} selected` : "None selected"}
            </span>
          )}
        </fieldset>

        {/* ── Platforms ── */}
        <fieldset>
          <legend className="collapsible-legend" onClick={() => setPlatformOpen((o) => !o)}>
            Platforms
            <span className="collapse-arrow">{platformOpen ? "▲" : "▼"}</span>
          </legend>
          {platformOpen && (
            <GamePlatformChooser selected={platformIds} onChange={setPlatformIds} />
          )}
          {!platformOpen && (
            <span className="collapsed-summary" onClick={() => setPlatformOpen(true)}>
              {platformIds.size > 0 ? `${platformIds.size} selected` : "None selected"}
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
