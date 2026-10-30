import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useGuildApi, usePeople } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { Book, BookRole, Person } from "../api/types";
import { BOOK_ROLE_LABELS, BOOK_ROLES } from "../api/types";
import { BOOK_GENRES } from "../genre/config";
import { GenreChooser } from "../genre/GenreChooser";
import { useCan } from "../guild/GuildProvider";
import { commitLinks, LinksField, useLinksField } from "./LinksField";
import { PersonForm } from "./PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "./PersonPicker";
import { BusyButton } from "./Spinner";

const orNull = (s: string) => (s.trim() === "" ? null : s);

type PendingLink = { personId: number; role: BookRole };

function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

export function BookForm(props: {
  initial?: Book;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [genreOpen, setGenreOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [personDupWarning, setPersonDupWarning] = useState<string | null>(null);
  const [addToList, setAddToList] = useState(true);

  const [f, setF] = useState({
    name:         initial?.name         ?? "",
    name_en:      initial?.name_en      ?? "",
    word_count:   initial?.word_count != null ? String(initial.word_count) : "",
    release_year: initial?.release_year ?? new Date().getFullYear(),
    alias:        initial?.alias        ?? "",
    notes:        initial?.notes        ?? "",
  });

  const [genreIds, setGenreIds] = useState<Set<number>>(() => new Set(initial?.genre_ids ?? []));
  const [links, setLinks] = useLinksField(initial?.links);

  const { data: allPeople = [], isLoading: peopleLoading } = usePeople();
  const [personLinks, setPersonLinks] = useState<Set<string>>(new Set());
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [personSearch, setPersonSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<BookRole>("author");

  useEffect(() => {
    if (editing && initial.persons) {
      const links = initial.persons.map((r) => ({ personId: r.id, role: r.role }));
      setPendingLinks(links);
      setPersonLinks(new Set(links.map(linkKey)));
    }
  }, [initial?.persons]); // eslint-disable-line react-hooks/exhaustive-deps

  const [personSortSnap, setPersonSortSnap] = useState(() => personLinks);
  useEffect(() => { setPersonSortSnap(personLinks); }, [personSearch, addRole]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredPeople = useMemo(() => {
    return allPeople
      .filter((p) => matchesPersonSearch(p, searchField, personSearch))
      .sort((a, b) => {
        const aKey = linkKey({ personId: a.id, role: addRole });
        const bKey = linkKey({ personId: b.id, role: addRole });
        return (personSortSnap.has(aKey) ? 0 : 1) - (personSortSnap.has(bKey) ? 0 : 1);
      });
  }, [personSearch, searchField, allPeople, personSortSnap, addRole]);

  function toggleLink(person: Person, role: BookRole) {
    const key = linkKey({ personId: person.id, role });
    const next = new Set(personLinks);
    const nextLinks = [...pendingLinks];
    if (next.has(key)) {
      next.delete(key);
      const idx = nextLinks.findIndex((l) => linkKey(l) === key);
      if (idx >= 0) nextLinks.splice(idx, 1);
    } else {
      next.add(key);
      nextLinks.push({ personId: person.id, role });
    }
    setPersonLinks(next);
    setPendingLinks(nextLinks);
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name,
        name_en: orNull(f.name_en),
        word_count: f.word_count.trim() === "" ? null : Number(f.word_count),
        release_year: f.release_year,
        alias: orNull(f.alias),
        notes: orNull(f.notes),
      };

      let book: Book;
      if (editing) {
        book = await api.patch<Book>(`${base}/books/${initial.id}`, body);
      } else {
        book = await api.post<Book>(`${base}/books`, body);
      }

      const beforeLinks = new Set(
        (initial?.persons ?? []).map((r) => linkKey({ personId: r.id, role: r.role }))
      );
      for (const link of pendingLinks) {
        if (!beforeLinks.has(linkKey(link))) {
          await api.put(`${base}/books/${book.id}/persons/${link.personId}/${link.role}`);
        }
      }
      for (const key of beforeLinks) {
        if (!personLinks.has(key)) {
          const [personId, role] = key.split(":");
          await api.delete(`${base}/books/${book.id}/persons/${personId}/${role}`);
        }
      }

      const before = new Set(initial?.genre_ids ?? []);
      for (const id of genreIds)
        if (!before.has(id)) await api.put(`${base}/books/${book.id}/genres/${id}`);
      for (const id of before)
        if (!genreIds.has(id)) await api.delete(`${base}/books/${book.id}/genres/${id}`);

      await commitLinks(base, "books", book.id, links, editing ? initial.links : []);

      if (!editing && addToList && canRank) await api.put(`${base}/books/${book.id}/entry`, {});

      return book;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: gk(guildId, "books") });
      // Person names on the people pages list their books.
      qc.invalidateQueries({ queryKey: gk(guildId, "people") });
      if (!editing && addToList) qc.invalidateQueries({ queryKey: rk(guildId, userId, "books") });
      onClose(saved.name, saved.id);
    },
  });

  const num = (k: "release_year") =>
    (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  const txt = (k: "name" | "name_en" | "word_count" | "alias" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const selectedByRole = useMemo(() => {
    const map = Object.fromEntries(BOOK_ROLES.map((r) => [r, [] as string[]])) as Record<BookRole, string[]>;
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
              setPersonLinks((prev) => new Set([...prev, key]));
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
        <h2>{editing ? "Edit" : "New"} Book</h2>

        <label>Name
          <input required value={f.name} onChange={txt("name")} />
        </label>

        <label><span className="label-text">English name <span className="info-icon" title="optional">ⓘ</span></span>
          <input value={f.name_en} onChange={txt("name_en")} />
        </label>

        <div className="grid-2">
          <label><span className="label-text">Word count <span className="info-icon" title="optional">ⓘ</span></span>
            <input type="number" min={0} step={1} value={f.word_count} onChange={txt("word_count")} />
          </label>
          <label>Publication year
            <input required type="number" value={f.release_year} onChange={num("release_year")} />
          </label>
        </div>

        <label><span className="label-text">Alias <span className="info-icon" title="if published under a different name, e.g. a pen name or alternate title">ⓘ</span></span>
          <input value={f.alias} onChange={txt("alias")} />
        </label>

        <label><span className="label-text">Notes <span className="info-icon" title="optional">ⓘ</span></span>
          <textarea rows={3} value={f.notes} onChange={txt("notes")} />
        </label>

        {/* ── People / roles ── */}
        <fieldset>
          <legend className="collapsible-legend" onClick={() => setPeopleOpen((o) => !o)}>
            People
            <span className="collapse-arrow">{peopleOpen ? "▲" : "▼"}</span>
          </legend>
          {!peopleOpen && (
            <span className="collapsed-summary" onClick={() => setPeopleOpen(true)}>
              {pendingLinks.length > 0
                ? BOOK_ROLES.filter((r) => selectedByRole[r].length > 0).map((r) =>
                    `${BOOK_ROLE_LABELS[r]}: ${selectedByRole[r].join(", ")}`
                  ).join(" · ")
                : "None selected"}
            </span>
          )}
          {peopleOpen && (
            <>
              {personDupWarning && (
                <div className="dup-warning">
                  <span>{personDupWarning}</span>
                  <button type="button" className="icon" onClick={() => setPersonDupWarning(null)}>✕</button>
                </div>
              )}
              {pendingLinks.length > 0 && (
                <div style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                  {BOOK_ROLES.filter((r) => selectedByRole[r].length > 0).map((r) => (
                    <div key={r}>
                      <strong>{BOOK_ROLE_LABELS[r]}:</strong>{" "}
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
                roles={BOOK_ROLES}
                roleLabels={BOOK_ROLE_LABELS}
                activeRole={addRole}
                onRole={setAddRole}
                searchField={searchField}
                onSearchField={setSearchField}
                search={personSearch}
                onSearch={setPersonSearch}
                onNewPerson={() => setCreatingPerson(true)}
                people={filteredPeople}
                isChecked={(p, role) => personLinks.has(linkKey({ personId: p.id, role }))}
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
            <GenreChooser domain={BOOK_GENRES} selected={genreIds} onChange={setGenreIds} />
          )}
          {!genreOpen && (
            <span className="collapsed-summary" onClick={() => setGenreOpen(true)}>
              {genreIds.size > 0 ? `${genreIds.size} selected` : "None selected"}
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
