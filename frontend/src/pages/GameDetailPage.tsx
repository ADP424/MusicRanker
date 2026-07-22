import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { useAlbumIndex, useGameGenres, useGamePlatforms, usePeople } from "../api/hooks";
import type { AlbumIndex, Game, GamePersonRef, GamePlatform, GameRole, Genre, Person } from "../api/types";
import { GAME_ROLES, GAME_ROLE_LABELS } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GameForm } from "../components/GameForm";
import { GameGenreChooser } from "../components/GameGenreChooser";
import { GamePlatformChooser } from "../components/GamePlatformChooser";
import { PersonForm } from "../components/PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../components/PersonPicker";

// ── People section ─────────────────────────────────────────────────────────────

function GamePeopleSection({ game }: { game: Game }) {
  const qc = useQueryClient();
  const { data: allPeople = [] } = usePeople();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<GamePersonRef | null>(null);
  const [castSearch, setCastSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<GameRole>("director");
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const [castKeys, setCastKeys] = useState<Set<string>>(
    () => new Set(game.persons.map((p) => `${p.id}:${p.role}`))
  );

  useEffect(() => {
    setCastKeys(new Set(game.persons.map((p) => `${p.id}:${p.role}`)));
  }, [game.persons]);

  const filteredPeople = useMemo(
    () => allPeople.filter((p) => matchesPersonSearch(p, searchField, castSearch)),
    [castSearch, searchField, allPeople],
  );

  const link = useMutation({
    mutationFn: ({ personId, role }: { personId: number; role: GameRole }) =>
      api.put(`/games/${game.id}/persons/${personId}/${role}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games", game.id] });
      qc.invalidateQueries({ queryKey: ["games", "ranked"] });
    },
  });

  const unlink = useMutation({
    mutationFn: ({ personId, role }: { personId: number; role: GameRole }) =>
      api.delete(`/games/${game.id}/persons/${personId}/${role}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games", game.id] });
      qc.invalidateQueries({ queryKey: ["games", "ranked"] });
    },
  });

  function toggleLink(person: Person, role: GameRole) {
    const key = `${person.id}:${role}`;
    if (castKeys.has(key)) {
      const ref = game.persons.find((p) => p.id === person.id && p.role === role);
      if (ref) setConfirmUnlink(ref);
    } else {
      link.mutate({ personId: person.id, role });
      setCastKeys((prev) => new Set([...prev, key]));
    }
  }

  // Group persons by role for display
  const byRole: Record<string, GamePersonRef[]> = {};
  for (const p of game.persons) {
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
              isChecked={(p, role) => castKeys.has(`${p.id}:${role}`)}
              onToggle={toggleLink}
            />
          </div>
        </>
      )}

      {game.persons.length > 0 ? (
        GAME_ROLES.filter((r) => byRole[r]?.length).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>
              {GAME_ROLE_LABELS[role]}
            </div>
            <ul className="sortable plain-list">
              {byRole[role].map((p) => (
                <li key={`${p.id}:${p.role}`} className="sortable-item">
                  <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                    <Link className="name" to={`/people/${p.id}`}>
                      {p.name}{p.name_en && <span style={{ opacity: 0.6 }}> ({p.name_en})</span>}
                    </Link>
                    {editing && (
                      <button
                        className="icon"
                        title="Remove"
                        onClick={() => setConfirmUnlink(p)}
                      >✕</button>
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
          message={`Remove "${confirmUnlink.name}" (${GAME_ROLE_LABELS[confirmUnlink.role]}) from this game?`}
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

// ── Genres section ─────────────────────────────────────────────────────────────

function GameGenresSection({ game }: { game: Game }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useGameGenres();

  const { data: gameGenres = [] } = useQuery({
    queryKey: ["games", game.id, "genres"],
    queryFn: () => api.get<Genre[]>(`/games/${game.id}/genres`),
  });

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setGenreIds(new Set(gameGenres.map((g) => g.id)));
  }, [gameGenres]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`/games/${game.id}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games", game.id, "genres"] });
      qc.invalidateQueries({ queryKey: ["games", game.id] });
    },
  });

  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`/games/${game.id}/genres/${gid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games", game.id, "genres"] });
      qc.invalidateQueries({ queryKey: ["games", game.id] });
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
          <GameGenreChooser selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {gameGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {gameGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/games/genres/${g.id}`}>{g.name}</Link>
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

// ── Platforms section ──────────────────────────────────────────────────────────

function GamePlatformsSection({ game }: { game: Game }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<GamePlatform | null>(null);
  const { data: allPlatforms = [] } = useGamePlatforms();

  const { data: gamePlatforms = [] } = useQuery({
    queryKey: ["games", game.id, "platforms"],
    queryFn: () => api.get<GamePlatform[]>(`/games/${game.id}/platforms`),
  });

  const [platformIds, setPlatformIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setPlatformIds(new Set(gamePlatforms.map((p) => p.id)));
  }, [gamePlatforms]);

  const platformMap = Object.fromEntries(allPlatforms.map((p) => [p.id, p]));

  const addPlatform = useMutation({
    mutationFn: (pid: number) => api.put(`/games/${game.id}/platforms/${pid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games", game.id, "platforms"] });
      qc.invalidateQueries({ queryKey: ["games", game.id] });
    },
  });

  const removePlatform = useMutation({
    mutationFn: (pid: number) => api.delete(`/games/${game.id}/platforms/${pid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games", game.id, "platforms"] });
      qc.invalidateQueries({ queryKey: ["games", game.id] });
    },
  });

  function handleChange(next: Set<number>) {
    const prev = platformIds;
    for (const id of next) {
      if (!prev.has(id)) addPlatform.mutate(id);
    }
    for (const id of prev) {
      if (!next.has(id)) {
        const p = platformMap[id];
        if (p) {
          setConfirmUnlink(p);
          return;
        }
      }
    }
    setPlatformIds(next);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Platforms</h2>
        <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
          {editing ? "Done" : "Edit"}
        </button>
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
          <GamePlatformChooser selected={platformIds} onChange={handleChange} />
        </div>
      )}

      {gamePlatforms.length > 0 ? (
        <ul className="sortable plain-list">
          {gamePlatforms.map((p) => (
            <li key={p.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/games/platforms/${p.id}`}>{p.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No platforms linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove platform "${confirmUnlink.name}" from this game?`}
          onConfirm={() => {
            removePlatform.mutate(confirmUnlink.id);
            setPlatformIds((prev) => {
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

// ── Soundtrack section ─────────────────────────────────────────────────────────

function GameSoundtrackSection({ game }: { game: Game }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [albumSearch, setAlbumSearch] = useState("");
  const { data: allAlbums = [] } = useAlbumIndex();

  const linkedIds = new Set(game.soundtrack_albums.map((a) => a.id));

  const link = useMutation({
    mutationFn: (aid: number) => api.put(`/games/${game.id}/soundtrack/${aid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games", game.id] });
      qc.invalidateQueries({ queryKey: ["games", "ranked"] });
    },
  });

  const unlink = useMutation({
    mutationFn: (aid: number) => api.delete(`/games/${game.id}/soundtrack/${aid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games", game.id] });
      qc.invalidateQueries({ queryKey: ["games", "ranked"] });
    },
  });

  const filteredAlbums = useMemo(() => {
    const q = albumSearch.trim().toLowerCase();
    return (q
      ? allAlbums.filter((a: AlbumIndex) => a.name.toLowerCase().includes(q) || !!a.name_en?.toLowerCase().includes(q))
      : allAlbums
    ).filter((a: AlbumIndex) => !linkedIds.has(a.id)).slice(0, 50);
  }, [albumSearch, allAlbums, linkedIds]);

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Soundtrack</h2>
        <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
          {editing ? "Done" : "Edit"}
        </button>
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
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
                <input type="checkbox" checked={false} onChange={() => link.mutate(a.id)} />
                {a.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {game.soundtrack_albums.length > 0 ? (
        <ul className="sortable plain-list">
          {game.soundtrack_albums.map((a) => (
            <li key={a.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                <Link className="name" to={`/music/albums/${a.id}`}>
                  {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
                </Link>
                {editing && (
                  <button className="icon" title="Remove" onClick={() => unlink.mutate(a.id)}>✕</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No soundtrack albums linked.</p>
      )}
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const gameId = Number(id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data: game, isLoading, isError } = useQuery({
    queryKey: ["games", gameId],
    queryFn: () => api.get<Game>(`/games/${gameId}`),
    enabled: !isNaN(gameId),
  });

  if (isLoading) return <section><p>Loading…</p></section>;
  if (isError || !game) return <section><p>Game not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>
          {game.name}{game.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({game.name_en})</span>}
          {game.play_link && (
            <> <a href={game.play_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.6em", opacity: 0.7, fontWeight: "normal", color: "inherit" }}>(link)</a></>
          )}
        </h1>
        <button onClick={() => setEditing(true)}>✎ Edit</button>
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div>
            <span className="detail-label">Release year</span>
            <span>{game.release_year}</span>
          </div>
          <div>
            <span className="detail-label">Hours played</span>
            <span>{game.hours_played != null ? `${game.hours_played}h` : "untracked"}</span>
          </div>
        </div>
        {game.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{game.notes}</span>
          </div>
        )}
      </div>

      <GamePeopleSection game={game} />
      <GameGenresSection game={game} />
      <GamePlatformsSection game={game} />
      <GameSoundtrackSection game={game} />

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <GameForm
              initial={game}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: ["games", gameId] });
                qc.invalidateQueries({ queryKey: ["games", "ranked"] });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
