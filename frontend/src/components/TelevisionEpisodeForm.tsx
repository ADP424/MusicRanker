import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { usePeople } from "../api/hooks";
import type {
  CastRole, Person, TelevisionEpisode, TelevisionEpisodeCreate, TelevisionEpisodePatch, TelevisionShow,
} from "../api/types";
import { CAST_ROLE_LABELS, TV_EPISODE_ROLES } from "../api/types";
import { TelevisionGenreChooser } from "./TelevisionGenreChooser";
import { PersonForm } from "./PersonForm";
import { matchesPersonSearch, PERSON_SEARCH_FIELDS, type PersonSearchField } from "./PersonPicker";

const orNull = (s: string) => (s.trim() === "" ? null : s);

type PendingLink = { personId: number; role: CastRole };

function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

export function TelevisionEpisodeForm(props: {
  show: TelevisionShow;
  initial?: TelevisionEpisode;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { show, initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const [castOpen, setCastOpen] = useState(false);
  const [genreOpen, setGenreOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [personDupWarning, setPersonDupWarning] = useState<string | null>(null);

  const [f, setF] = useState({
    name:            initial?.name            ?? "",
    name_en:         initial?.name_en         ?? "",
    runtime_minutes: initial?.runtime_minutes ?? 0,
    release_year:    initial?.release_year    ?? show.release_year,
    watches:         initial?.watches         ?? 1,
    watch_link:      initial?.watch_link      ?? "",
    notes:           initial?.notes           ?? "",
  });
  const [inheritFromShow, setInheritFromShow] = useState(true);

  const initialGenreIds = initial?.genre_ids ?? [];
  const [genreIds, setGenreIds] = useState<Set<number>>(() => new Set(initialGenreIds));

  const { data: currentGenres = initialGenreIds.map((id) => ({ id })) } = useQuery({
    queryKey: ["television", "episodes", initial?.id, "genres"],
    queryFn: () => api.get<{ id: number; name: string }[]>(`/television/episodes/${initial!.id}/genres`),
    enabled: editing,
  });

  const { data: allPeople = [] } = usePeople();
  const [castLinks, setCastLinks] = useState<Set<string>>(new Set());
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [castSearch, setCastSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<CastRole>("director");

  useEffect(() => {
    if (editing && initial.persons) {
      const links = initial.persons.map((r) => ({ personId: r.id, role: r.role }));
      setPendingLinks(links);
      setCastLinks(new Set(links.map(linkKey)));
    }
  }, [initial?.persons]); // eslint-disable-line react-hooks/exhaustive-deps

  // New episodes: the "inherit" checkbox has to reflect — and let you drop —
  // what will actually be copied, so prefill the pickers from the show rather
  // than letting the server graft links on behind the form's back.
  const inheritedLinks = useMemo<PendingLink[]>(
    () =>
      show.persons
        .filter((p) => TV_EPISODE_ROLES.includes(p.role))
        .map((p) => ({ personId: p.id, role: p.role })),
    [show.persons],
  );

  useEffect(() => {
    if (editing) return;
    const links = inheritFromShow ? inheritedLinks : [];
    setPendingLinks(links);
    setCastLinks(new Set(links.map(linkKey)));
    setGenreIds(new Set(inheritFromShow ? show.genre_ids : []));
  }, [editing, inheritFromShow, inheritedLinks, show.genre_ids]);

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
      let episode: TelevisionEpisode;
      if (editing) {
        const body: TelevisionEpisodePatch = {
          name: f.name,
          name_en: orNull(f.name_en),
          runtime_minutes: f.runtime_minutes,
          release_year: f.release_year,
          watches: f.watches,
          watch_link: orNull(f.watch_link),
          notes: orNull(f.notes),
        };
        episode = await api.patch<TelevisionEpisode>(`/television/episodes/${initial.id}`, body);
      } else {
        const body: TelevisionEpisodeCreate = {
          name: f.name,
          name_en: orNull(f.name_en),
          runtime_minutes: f.runtime_minutes,
          release_year: f.release_year,
          watches: f.watches,
          watch_link: orNull(f.watch_link),
          notes: orNull(f.notes),
          // People & genres are sent explicitly below, pre-seeded from the show
          // when "inherit" is ticked — so the server must not add its own.
          inherit_from_show: false,
        };
        episode = await api.post<TelevisionEpisode>(`/television/shows/${show.id}/episodes`, body);
      }

      const beforeLinks = new Set(
        (initial?.persons ?? []).map((r) => linkKey({ personId: r.id, role: r.role }))
      );
      for (const link of pendingLinks) {
        const key = linkKey(link);
        if (!beforeLinks.has(key)) {
          await api.put(`/television/episodes/${episode.id}/persons/${link.personId}/${link.role}`);
        }
      }
      for (const key of beforeLinks) {
        if (!castLinks.has(key)) {
          const [personId, role] = key.split(":");
          await api.delete(`/television/episodes/${episode.id}/persons/${personId}/${role}`);
        }
      }

      const before = new Set(currentGenres.map((g) => g.id));
      for (const id of genreIds)
        if (!before.has(id)) await api.put(`/television/episodes/${episode.id}/genres/${id}`);
      for (const id of before)
        if (!genreIds.has(id)) await api.delete(`/television/episodes/${episode.id}/genres/${id}`);

      return episode;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["television", "shows", show.id] });
      qc.invalidateQueries({ queryKey: ["television", "ranked"] });
      qc.invalidateQueries({ queryKey: ["television", "index"] });
      if (editing) {
        qc.invalidateQueries({ queryKey: ["television", "episodes", initial.id, "genres"] });
      }
      onClose(saved.name, saved.id);
    },
  });

  const num = (k: "runtime_minutes" | "release_year" | "watches") =>
    (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  const txt = (k: "name" | "name_en" | "watch_link" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const selectedByRole = useMemo(() => {
    const map = Object.fromEntries(TV_EPISODE_ROLES.map((r) => [r, [] as string[]])) as Record<CastRole, string[]>;
    for (const link of pendingLinks) {
      const p = allPeople.find((p) => p.id === link.personId);
      if (p) map[link.role]?.push(p.name);
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
        <h2>{editing ? "Edit" : "New"} Episode <span style={{ opacity: 0.6, fontWeight: "normal" }}>— {show.name}</span></h2>

        {!editing && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
            <input
              type="checkbox"
              checked={inheritFromShow}
              onChange={(e) => setInheritFromShow(e.target.checked)}
            />
            <span>Inherit the show's people &amp; genres</span>
          </label>
        )}

        <label>Name
          <input required value={f.name} onChange={txt("name")} />
        </label>

        <label><span className="label-text">English name <span className="info-icon" title="optional">ⓘ</span></span>
          <input value={f.name_en} onChange={txt("name_en")} />
        </label>

        <div className="grid-2">
          <label>Runtime (minutes)
            <input type="number" min={0} value={f.runtime_minutes} onChange={num("runtime_minutes")} />
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

        <label><span className="label-text">Notes <span className="info-icon" title="optional">ⓘ</span></span>
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
                ? TV_EPISODE_ROLES.filter((r) => selectedByRole[r].length > 0).map((r) =>
                    `${CAST_ROLE_LABELS[r]}: ${selectedByRole[r].join(", ")}`
                  ).join(" · ")
                : "None selected"}
            </span>
          )}
          {castOpen && (
            <>
              {!editing && inheritFromShow && (
                <p style={{ opacity: 0.6, fontSize: "0.85em", marginTop: 0 }}>
                  Starts from the show's people; adjust below if needed.
                </p>
              )}
              {personDupWarning && (
                <div className="dup-warning">
                  <span>{personDupWarning}</span>
                  <button type="button" className="icon" onClick={() => setPersonDupWarning(null)}>✕</button>
                </div>
              )}
              {pendingLinks.length > 0 && (
                <div style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                  {TV_EPISODE_ROLES.filter((r) => selectedByRole[r].length > 0).map((r) => (
                    <div key={r}>
                      <strong>{CAST_ROLE_LABELS[r]}:</strong>{" "}
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

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                {TV_EPISODE_ROLES.map((role) => (
                  <label key={role} className={`chip${addRole === role ? " chip-active" : ""}`}
                    onClick={() => setAddRole(role)} style={{ cursor: "pointer" }}>
                    {CAST_ROLE_LABELS[role]}
                  </label>
                ))}
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem", flexWrap: "wrap" }}>
                {PERSON_SEARCH_FIELDS.map((sf) => (
                  <label
                    key={sf}
                    className={`chip${searchField === sf ? " chip-active" : ""}`}
                    onClick={() => setSearchField(sf)}
                    style={{ cursor: "pointer" }}
                  >
                    {sf === "all" ? "All" : sf === "person" ? "Person" : sf === "artist" ? "Artist" : sf === "movie" ? "Movie" : sf === "game" ? "Game" : "TV"}
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
                <input
                  className="genre-search"
                  type="search"
                  placeholder="Search people, artists, movies, games, TV shows…"
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
            <TelevisionGenreChooser selected={genreIds} onChange={setGenreIds} />
          )}
          {!genreOpen && (
            <span className="collapsed-summary" onClick={() => setGenreOpen(true)}>
              {genreIds.size > 0 ? `${genreIds.size} selected` : "None selected"}
            </span>
          )}
        </fieldset>

        <p className="meta">Soundtrack albums are tracked on the show, not per episode.</p>

        <footer>
          <button type="button" onClick={() => onClose()}>Cancel</button>
          <button type="submit" disabled={save.isPending}>{editing ? "Save" : "Create"}</button>
        </footer>
        {save.isError && <p className="err">{(save.error as Error).message}</p>}
      </form>
    </dialog>
  );
}
