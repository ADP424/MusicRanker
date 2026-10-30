import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useEntryMutations, useGameEntry, useGameGenres, useGamePlatforms, useGuildApi, usePeople, useUpdateGameEntry } from "../api/hooks";
import { gk } from "../api/keys";
import type { Game, GamePlatform, GameRole, Genre, Person } from "../api/types";
import { GAME_ROLE_LABELS, GAME_ROLES } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GameForm } from "../components/GameForm";
import { LinksSection } from "../components/LinksSection";
import { PersonForm } from "../components/PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../components/PersonPicker";
import { GenreChooser } from "../genre/GenreChooser";
import { GAME_GENRES, GAME_PLATFORMS } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { BusyButton, InlineBusy, LoadingState } from "../components/Spinner";

type PendingLink = { personId: number; role: GameRole };
function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

// ── People section ──────────────────────────────────────────────────────────

function GamePeopleSection({ gameId, game }: { gameId: number; game: Game }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const { data: allPeople = [], isLoading: peopleLoading } = usePeople();
  const [editing, setEditing] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<GameRole>("director");

  const castKeys = useMemo(() => new Set(game.persons.map((p) => linkKey({ personId: p.id, role: p.role }))), [game.persons]);

  const filteredPeople = useMemo(() => {
    return allPeople
      .filter((p) => matchesPersonSearch(p, searchField, search))
      .sort((a, b) => {
        const aKey = linkKey({ personId: a.id, role: addRole });
        const bKey = linkKey({ personId: b.id, role: addRole });
        return (castKeys.has(aKey) ? 0 : 1) - (castKeys.has(bKey) ? 0 : 1);
      });
  }, [search, searchField, allPeople, castKeys, addRole]);

  const invalidate = () => qc.invalidateQueries({ queryKey: gk(guildId, "games", gameId) });

  const link = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: GameRole }) =>
      api.put(`${base}/games/${gameId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: GameRole }) =>
      api.delete(`${base}/games/${gameId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });

  function toggleLink(person: Person, role: GameRole) {
    const key = linkKey({ personId: person.id, role });
    if (castKeys.has(key)) unlink.mutate({ pid: person.id, role });
    else link.mutate({ pid: person.id, role });
  }

  const byRole: Partial<Record<GameRole, Game["persons"]>> = {};
  for (const p of game.persons) (byRole[p.role] ??= []).push(p);

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
              roles={GAME_ROLES}
              roleLabels={GAME_ROLE_LABELS}
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

      {game.persons.length > 0 ? (
        GAME_ROLES.filter((r) => byRole[r]?.length).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>{GAME_ROLE_LABELS[role]}</div>
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

function GameGenresSection({ gameId, game }: { gameId: number; game: Game }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useGameGenres();

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => { setGenreIds(new Set(game.genre_ids)); }, [game.genre_ids]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));
  const gameGenres = game.genre_ids.map((id) => genreMap[id]).filter(Boolean);

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`${base}/games/${gameId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "games") }),
  });
  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`${base}/games/${gameId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "games") }),
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
          <GenreChooser domain={GAME_GENRES} selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {gameGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {gameGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/g/${guildId}/games/genres/${g.id}`}>{g.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No genres linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove genre "${confirmUnlink.name}" from this game?`}
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

// ── Platforms section ────────────────────────────────────────────────────────

function GamePlatformsSection({ gameId, game }: { gameId: number; game: Game }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<GamePlatform | null>(null);
  const { data: allPlatforms = [] } = useGamePlatforms();

  const [platformIds, setPlatformIds] = useState<Set<number>>(new Set());
  useEffect(() => { setPlatformIds(new Set(game.platform_ids)); }, [game.platform_ids]);

  const platformMap = Object.fromEntries(allPlatforms.map((p) => [p.id, p]));
  const gamePlatforms = game.platform_ids.map((id) => platformMap[id]).filter(Boolean);

  const addPlatform = useMutation({
    mutationFn: (pid: number) => api.put(`${base}/games/${gameId}/platforms/${pid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "games") }),
  });
  const removePlatform = useMutation({
    mutationFn: (pid: number) => api.delete(`${base}/games/${gameId}/platforms/${pid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "games") }),
  });

  function handleChange(next: Set<number>) {
    const prev = platformIds;
    for (const id of next) if (!prev.has(id)) addPlatform.mutate(id);
    for (const id of prev) {
      if (!next.has(id)) {
        const p = platformMap[id];
        if (p) { setConfirmUnlink(p); return; }
      }
    }
    setPlatformIds(next);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>Platforms</h2>
          {(addPlatform.isPending || removePlatform.isPending) && <InlineBusy label="Saving…" />}
        </span>
        {canEdit && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
          <GenreChooser domain={GAME_PLATFORMS} selected={platformIds} onChange={handleChange} />
        </div>
      )}

      {gamePlatforms.length > 0 ? (
        <p style={{ margin: "0.25rem 0 0" }}>{gamePlatforms.map((p) => p.name).join(", ")}</p>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No platforms linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove platform "${confirmUnlink.name}" from this game?`}
          busy={removePlatform.isPending}
          onConfirm={() => {
            const id = confirmUnlink.id;
            setPlatformIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
            removePlatform.mutate(id, { onSettled: () => setConfirmUnlink(null) });
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}

// ── My list section ──────────────────────────────────────────────────────────

function MyGameListSection({ gameId }: { gameId: number }) {
  const canRank = useCan("rank");
  const { data: entry, isLoading } = useGameEntry(gameId);
  const update = useUpdateGameEntry(gameId);
  const entryMutations = useEntryMutations("games");
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
                                        onClick={() => entryMutations.add.mutate(gameId)}>+ Add to my list</BusyButton>
        </p>
      ) : (
        <>
          <div className="artist-detail-grid">
            <div>
              <span className="detail-label">Hours played</span>
              <span className="listens-ctrl">
                <button className="icon" title="Subtract half an hour"
                        disabled={entry.hours_played == null || Number(entry.hours_played) <= 0}
                        onClick={() => update.mutate({ hours_played: Math.max(0, Number(entry.hours_played ?? 0) - 0.5) })}
                >−</button>
                <input
                  type="number" min={0} step={0.5} className="listens-input"
                  value={entry.hours_played ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) update.mutate({ hours_played: n });
                  }}
                />
                <button className="icon" title="Add half an hour"
                        onClick={() => update.mutate({ hours_played: Number(entry.hours_played ?? 0) + 0.5 })}
                >+</button>
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
          message="Remove this game from your list? Your hours played and personal notes for it will be lost."
          confirmLabel="Remove"
          busy={entryMutations.remove.isPending}
          onConfirm={() => entryMutations.remove.mutate(gameId, { onSettled: () => { setConfirmRemove(false); setEditing(false); } })}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const gameId = Number(id);
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);

  const { data: game, isLoading, isError } = useQuery({
    queryKey: gk(guildId, "games", gameId),
    queryFn: () => api.get<Game>(`${base}/games/${gameId}`),
    enabled: !isNaN(gameId),
  });

  if (isLoading) return <section><LoadingState label="Loading game…" /></section>;
  if (isError || !game) return <section><p>Game not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>
          {game.name}{game.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({game.name_en})</span>}
        </h1>
        {canEdit && <button onClick={() => setEditing(true)}>✎ Edit</button>}
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div><span className="detail-label">Release year</span><span>{game.release_year}</span></div>
        </div>
        {game.soundtrack_albums.length > 0 && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Soundtrack</span>
            <span>
              {game.soundtrack_albums.map((a, i) => (
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
        {(game.source_books ?? []).length > 0 && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Based on</span>
            <span>
              {game.source_books.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ", "}
                  <Link to={`/g/${guildId}/books/${b.id}`}>
                    {b.name}{b.name_en && <span style={{ opacity: 0.6 }}> ({b.name_en})</span>}
                  </Link>
                </span>
              ))}
            </span>
          </div>
        )}
        {game.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{game.notes}</span>
          </div>
        )}
      </div>

      <GamePeopleSection gameId={gameId} game={game} />
      <GameGenresSection gameId={gameId} game={game} />
      <GamePlatformsSection gameId={gameId} game={game} />
      <LinksSection path="games" section="games" ownerId={gameId} />
      <MyGameListSection gameId={gameId} />

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <GameForm
              initial={game}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: gk(guildId, "games", gameId) });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
