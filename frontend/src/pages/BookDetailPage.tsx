import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import { gk } from "../api/keys";
import { useBookEntry, useBookGenres, useEntryMutations, useGuildApi, usePeople, useUpdateBookEntry } from "../api/hooks";
import type { Book, BookRole, Genre, Person } from "../api/types";
import { BOOK_ROLE_LABELS, BOOK_ROLES } from "../api/types";
import { BookAdaptationsSection } from "../components/BookAdaptationsSection";
import { BookForm } from "../components/BookForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LinksSection } from "../components/LinksSection";
import { PersonForm } from "../components/PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../components/PersonPicker";
import { GenreChooser } from "../genre/GenreChooser";
import { BOOK_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { BusyButton, InlineBusy, LoadingState } from "../components/Spinner";

function fmtWords(words: number) {
  return words.toLocaleString();
}

type PendingLink = { personId: number; role: BookRole };
function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

// ── People section ──────────────────────────────────────────────────────────

function BookPeopleSection({ bookId, book }: { bookId: number; book: Book }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const { data: allPeople = [], isLoading: peopleLoading } = usePeople();
  const [editing, setEditing] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<BookRole>("author");

  const linkedKeys = useMemo(() => new Set(book.persons.map((p) => linkKey({ personId: p.id, role: p.role }))), [book.persons]);

  const filteredPeople = useMemo(() => {
    return allPeople
      .filter((p) => matchesPersonSearch(p, searchField, search))
      .sort((a, b) => {
        const aKey = linkKey({ personId: a.id, role: addRole });
        const bKey = linkKey({ personId: b.id, role: addRole });
        return (linkedKeys.has(aKey) ? 0 : 1) - (linkedKeys.has(bKey) ? 0 : 1);
      });
  }, [search, searchField, allPeople, linkedKeys, addRole]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, "books") });
    qc.invalidateQueries({ queryKey: gk(guildId, "people") });
  };

  const link = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: BookRole }) =>
      api.put(`${base}/books/${bookId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: BookRole }) =>
      api.delete(`${base}/books/${bookId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });

  function toggleLink(person: Person, role: BookRole) {
    const key = linkKey({ personId: person.id, role });
    if (linkedKeys.has(key)) unlink.mutate({ pid: person.id, role });
    else link.mutate({ pid: person.id, role });
  }

  const byRole: Partial<Record<BookRole, Book["persons"]>> = {};
  for (const p of book.persons) (byRole[p.role] ??= []).push(p);

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
              roles={BOOK_ROLES}
              roleLabels={BOOK_ROLE_LABELS}
              activeRole={addRole}
              onRole={setAddRole}
              searchField={searchField}
              onSearchField={setSearchField}
              search={search}
              onSearch={setSearch}
              onNewPerson={() => setCreatingPerson(true)}
              people={filteredPeople}
              isChecked={(p, role) => linkedKeys.has(linkKey({ personId: p.id, role }))}
              onToggle={toggleLink}
              loading={peopleLoading}
              busy={link.isPending || unlink.isPending}
            />
          </div>
        </>
      )}

      {book.persons.length > 0 ? (
        BOOK_ROLES.filter((r) => byRole[r]?.length).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>{BOOK_ROLE_LABELS[role]}</div>
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

// ── Genres section ─────────────────────────────────────────────────────────────

function BookGenresSection({ bookId, book }: { bookId: number; book: Book }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useBookGenres();

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => { setGenreIds(new Set(book.genre_ids)); }, [book.genre_ids]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));
  const bookGenres = book.genre_ids.map((id) => genreMap[id]).filter(Boolean);

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`${base}/books/${bookId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "books") }),
  });
  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`${base}/books/${bookId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "books") }),
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
          <GenreChooser domain={BOOK_GENRES} selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {bookGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {bookGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/g/${guildId}/books/genres/${g.id}`}>{g.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No genres linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove genre "${confirmUnlink.name}" from this book?`}
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

function MyBookListSection({ bookId }: { bookId: number }) {
  const canRank = useCan("rank");
  const { data: entry, isLoading } = useBookEntry(bookId);
  const update = useUpdateBookEntry(bookId);
  const entryMutations = useEntryMutations("books");
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
                                        onClick={() => entryMutations.add.mutate(bookId)}>+ Add to my list</BusyButton>
        </p>
      ) : (
        <>
          <div className="artist-detail-grid">
            <div>
              <span className="detail-label">Reads</span>
              <span className="listens-ctrl">
                <button className="icon" title="Remove one read" disabled={entry.reads <= 1}
                        onClick={() => update.mutate({ reads: entry.reads - 1 })}>−</button>
                <input
                  type="number" min={1} className="listens-input" value={entry.reads}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 1) update.mutate({ reads: n });
                  }}
                />
                <button className="icon" title="Add one read"
                        onClick={() => update.mutate({ reads: entry.reads + 1 })}>+</button>
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
          message="Remove this book from your list? Your read count and personal notes for it will be lost."
          confirmLabel="Remove"
          busy={entryMutations.remove.isPending}
          onConfirm={() => entryMutations.remove.mutate(bookId, { onSettled: () => { setConfirmRemove(false); setEditing(false); } })}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function BookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const bookId = Number(id);
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);

  const { data: book, isLoading, isError } = useQuery({
    queryKey: gk(guildId, "books", bookId),
    queryFn: () => api.get<Book>(`${base}/books/${bookId}`),
    enabled: !isNaN(bookId),
  });

  if (isLoading) return <section><LoadingState label="Loading book…" /></section>;
  if (isError || !book) return <section><p>Book not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>
          {book.name}{book.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({book.name_en})</span>}
        </h1>
        {canEdit && <button onClick={() => setEditing(true)}>✎ Edit</button>}
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div><span className="detail-label">Publication year</span><span>{book.release_year}</span></div>
          {book.word_count != null && (
            <div><span className="detail-label">Word count</span><span>{fmtWords(book.word_count)}</span></div>
          )}
          {book.alias && (
            <div><span className="detail-label">Alias</span><span>{book.alias}</span></div>
          )}
        </div>
        {book.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{book.notes}</span>
          </div>
        )}
      </div>

      <BookPeopleSection bookId={bookId} book={book} />
      <BookGenresSection bookId={bookId} book={book} />
      <BookAdaptationsSection book={book} />
      <LinksSection path="books" section="books" ownerId={bookId} />
      <MyBookListSection bookId={bookId} />

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <BookForm
              initial={book}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: gk(guildId, "books", bookId) });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
