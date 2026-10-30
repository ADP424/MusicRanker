import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useGuildApi, usePeople } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { CastRole, Person, TelevisionEpisode, TelevisionSeason, TelevisionShow } from "../api/types";
import { CAST_ROLE_LABELS, TV_EPISODE_ROLES } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { TELEVISION_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { commitLinks, LinksField, useLinksField } from "./LinksField";
import { PersonForm } from "./PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "./PersonPicker";
import { BusyButton } from "./Spinner";

const orNull = (s: string) => (s.trim() === "" ? null : s);

type PendingLink = { personId: number; role: CastRole };

function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

export function TelevisionEpisodeForm(props: {
  show: TelevisionShow;
  season: TelevisionSeason;
  initial?: TelevisionEpisode;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { show, season, initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const [castOpen, setCastOpen] = useState(false);
  const [genreOpen, setGenreOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [personDupWarning, setPersonDupWarning] = useState<string | null>(null);
  const [inheritFromParent, setInheritFromParent] = useState(true);
  const [addToList, setAddToList] = useState(true);

  const [f, setF] = useState({
    name:            initial?.name            ?? "",
    name_en:         initial?.name_en         ?? "",
    runtime_minutes: initial?.runtime_minutes ?? 0,
    release_year:    initial?.release_year    ?? season.release_year,
    notes:           initial?.notes           ?? "",
  });

  const [genreIds, setGenreIds] = useState<Set<number>>(() => new Set(initial?.genre_ids ?? []));
  const [links, setLinks] = useLinksField(initial?.links);

  const { data: allPeople = [], isLoading: peopleLoading } = usePeople();
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

  // New episodes: the "inherit" checkbox reflects — and lets you drop — what
  // will actually be copied, so prefill the pickers from the season (people)
  // and show (genres) rather than letting the server graft links on behind the
  // form's back.
  const inheritedLinks = useMemo<PendingLink[]>(
    () =>
      season.persons
        .filter((p) => (TV_EPISODE_ROLES as readonly CastRole[]).includes(p.role))
        .map((p) => ({ personId: p.id, role: p.role })),
    [season.persons],
  );

  useEffect(() => {
    if (editing) return;
    const links = inheritFromParent ? inheritedLinks : [];
    setPendingLinks(links);
    setCastLinks(new Set(links.map(linkKey)));
    setGenreIds(new Set(inheritFromParent ? show.genre_ids : []));
  }, [editing, inheritFromParent, inheritedLinks, show.genre_ids]);

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
        episode = await api.patch<TelevisionEpisode>(`${base}/television/episodes/${initial.id}`, {
          name: f.name, name_en: orNull(f.name_en), runtime_minutes: f.runtime_minutes,
          release_year: f.release_year, notes: orNull(f.notes),
        });
      } else {
        episode = await api.post<TelevisionEpisode>(`${base}/television/seasons/${season.id}/episodes`, {
          name: f.name, name_en: orNull(f.name_en), runtime_minutes: f.runtime_minutes,
          release_year: f.release_year, notes: orNull(f.notes),
          // People & genres are sent explicitly below, pre-seeded from the
          // season/show when "inherit" is ticked — so the server must not add its own.
          inherit_from_parent: false,
        });
      }

      const beforeLinks = new Set(
        (initial?.persons ?? []).map((r) => linkKey({ personId: r.id, role: r.role }))
      );
      for (const link of pendingLinks) {
        const key = linkKey(link);
        if (!beforeLinks.has(key)) {
          await api.put(`${base}/television/episodes/${episode.id}/persons/${link.personId}/${link.role}`);
        }
      }
      for (const key of beforeLinks) {
        if (!castLinks.has(key)) {
          const [personId, role] = key.split(":");
          await api.delete(`${base}/television/episodes/${episode.id}/persons/${personId}/${role}`);
        }
      }

      const before = new Set(initial?.genre_ids ?? []);
      for (const id of genreIds)
        if (!before.has(id)) await api.put(`${base}/television/episodes/${episode.id}/genres/${id}`);
      for (const id of before)
        if (!genreIds.has(id)) await api.delete(`${base}/television/episodes/${episode.id}/genres/${id}`);

      await commitLinks(base, "television/episodes", episode.id, links, editing ? initial.links : []);

      if (!editing && addToList && canRank) await api.put(`${base}/television/episodes/${episode.id}/entry`, {});

      return episode;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: gk(guildId, "television") });
      if (!editing && addToList) {
        qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "seasons", season.id, "episodes") });
      }
      onClose(saved.name, saved.id);
    },
  });

  const num = (k: "runtime_minutes" | "release_year") =>
    (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  const txt = (k: "name" | "name_en" | "notes") =>
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
        <h2>{editing ? "Edit" : "New"} Episode <span style={{ opacity: 0.6, fontWeight: "normal" }}>— {show.name} · {season.name}</span></h2>

        {!editing && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
            <input
              type="checkbox"
              checked={inheritFromParent}
              onChange={(e) => setInheritFromParent(e.target.checked)}
            />
            <span>Inherit the season's people &amp; the show's genres</span>
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
              {!editing && inheritFromParent && (
                <p style={{ opacity: 0.6, fontSize: "0.85em", marginTop: 0 }}>
                  Starts from the season's people; adjust below if needed.
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
            <GenreChooser domain={TELEVISION_GENRES} selected={genreIds} onChange={setGenreIds} />
          )}
          {!genreOpen && (
            <span className="collapsed-summary" onClick={() => setGenreOpen(true)}>
              {genreIds.size > 0 ? `${genreIds.size} selected` : "None selected"}
            </span>
          )}
        </fieldset>

        <p className="meta">Soundtrack albums are tracked on the show, not per episode.</p>

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
