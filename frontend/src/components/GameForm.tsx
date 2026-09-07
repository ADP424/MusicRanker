import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useGuildApi, usePeople } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { Game, GameRole, Person } from "../api/types";
import { GAME_ROLE_LABELS, GAME_ROLES } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { GAME_GENRES, GAME_PLATFORMS } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { commitLinks, LinksField, useLinksField } from "./LinksField";
import { PersonForm } from "./PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "./PersonPicker";
import { BusyButton } from "./Spinner";

const orNull = (s: string) => (s.trim() === "" ? null : s);

type PendingLink = { personId: number; role: GameRole };

function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

export function GameForm(props: {
  initial?: Game;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const [castOpen, setCastOpen] = useState(false);
  const [genreOpen, setGenreOpen] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [personDupWarning, setPersonDupWarning] = useState<string | null>(null);
  const [addToList, setAddToList] = useState(true);

  const [f, setF] = useState({
    name:         initial?.name         ?? "",
    name_en:      initial?.name_en      ?? "",
    release_year: initial?.release_year ?? new Date().getFullYear(),
    notes:        initial?.notes        ?? "",
  });

  const [genreIds, setGenreIds] = useState<Set<number>>(() => new Set(initial?.genre_ids ?? []));
  const [platformIds, setPlatformIds] = useState<Set<number>>(() => new Set(initial?.platform_ids ?? []));
  const [links, setLinks] = useLinksField(initial?.links);

  const { data: allPeople = [], isLoading: peopleLoading } = usePeople();
  const [castLinks, setCastLinks] = useState<Set<string>>(new Set());
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [castSearch, setCastSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<GameRole>("director");

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
      const body = {
        name: f.name,
        name_en: orNull(f.name_en),
        release_year: f.release_year,
        notes: orNull(f.notes),
      };

      let game: Game;
      if (editing) {
        game = await api.patch<Game>(`${base}/games/${initial.id}`, body);
      } else {
        game = await api.post<Game>(`${base}/games`, body);
      }

      const beforeLinks = new Set(
        (initial?.persons ?? []).map((r) => linkKey({ personId: r.id, role: r.role }))
      );
      for (const link of pendingLinks) {
        const key = linkKey(link);
        if (!beforeLinks.has(key)) {
          await api.put(`${base}/games/${game.id}/persons/${link.personId}/${link.role}`);
        }
      }
      for (const key of beforeLinks) {
        if (!castLinks.has(key)) {
          const [personId, role] = key.split(":");
          await api.delete(`${base}/games/${game.id}/persons/${personId}/${role}`);
        }
      }

      const beforeGenres = new Set(initial?.genre_ids ?? []);
      for (const id of genreIds)
        if (!beforeGenres.has(id)) await api.put(`${base}/games/${game.id}/genres/${id}`);
      for (const id of beforeGenres)
        if (!genreIds.has(id)) await api.delete(`${base}/games/${game.id}/genres/${id}`);

      const beforePlatforms = new Set(initial?.platform_ids ?? []);
      for (const id of platformIds)
        if (!beforePlatforms.has(id)) await api.put(`${base}/games/${game.id}/platforms/${id}`);
      for (const id of beforePlatforms)
        if (!platformIds.has(id)) await api.delete(`${base}/games/${game.id}/platforms/${id}`);

      await commitLinks(base, "games", game.id, links, editing ? initial.links : []);

      if (!editing && addToList && canRank) await api.put(`${base}/games/${game.id}/entry`, {});

      return game;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: gk(guildId, "games") });
      if (!editing && addToList) qc.invalidateQueries({ queryKey: rk(guildId, userId, "games") });
      onClose(saved.name, saved.id);
    },
  });

  const num = (k: "release_year") =>
    (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  const txt = (k: "name" | "name_en" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const selectedByRole = useMemo(() => {
    const map = Object.fromEntries(GAME_ROLES.map((r) => [r, [] as string[]])) as Record<GameRole, string[]>;
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
              qc.invalidateQueries({ queryKey: gk(guildId, "people") });
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

        <label><span className="label-text">English name <span className="info-icon" title="optional">ⓘ</span></span>
          <input value={f.name_en} onChange={txt("name_en")} />
        </label>

        <label>Release year
          <input required type="number" value={f.release_year} onChange={num("release_year")} />
        </label>

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
                loading={peopleLoading}
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
            <GenreChooser domain={GAME_GENRES} selected={genreIds} onChange={setGenreIds} />
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
            <GenreChooser domain={GAME_PLATFORMS} selected={platformIds} onChange={setPlatformIds} />
          )}
          {!platformOpen && (
            <span className="collapsed-summary" onClick={() => setPlatformOpen(true)}>
              {platformIds.size > 0 ? `${platformIds.size} selected` : "None selected"}
            </span>
          )}
        </fieldset>

        <LinksField links={links} onChange={setLinks} />

        {!editing && canRank && (
          <label className="checkbox-label">
            <input type="checkbox" checked={addToList} onChange={(e) => setAddToList(e.target.checked)} />
            Add to my list
          </label>
        )}

        <footer>
          <button type="button" onClick={() => onClose()} disabled={save.isPending}>Cancel</button>
          <BusyButton type="submit" busy={save.isPending} busyLabel={editing ? "Saving…" : "Creating…"}>
            {editing ? "Save" : "Create"}
          </BusyButton>
        </footer>
        {save.isError && <p className="err">{(save.error as Error).message}</p>}
      </form>
    </dialog>
  );
}
