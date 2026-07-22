import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { useGameGenres, useGamePlatforms, useGamesRanked, usePeople } from "../api/hooks";
import type { Game, GamePersonRef } from "../api/types";
import { GAME_ROLES, GAME_ROLE_LABELS } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GameForm } from "../components/GameForm";
import { IgdbImportDialog } from "../components/IgdbImportDialog";
import { SortableList } from "../components/SortableList";
import { useDupWarning, DupWarningBanner } from "../hooks/useDupWarning";
import { useExpandAll } from "../hooks/useExpandAll";
import { useOptimisticDelete } from "../hooks/useOptimisticDelete";

type GameSearchBy = "all" | "title" | "genre" | "platform" | "person";

export function GamesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<{ game: Game } | "new" | null>(null);
  const [showIgdbImport, setShowIgdbImport] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Game | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchBy, setSearchBy] = useState<GameSearchBy>("all");
  const { dupWarning, clear: clearDup, checkAfterSave } = useDupWarning("game");

  const { data: games = [] } = useGamesRanked();
  const { data: genres = [] } = useGameGenres();
  const { data: platforms = [] } = useGamePlatforms();
  const { data: people = [] } = usePeople();
  const genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));
  const platformMap = Object.fromEntries(platforms.map((p) => [p.id, p.name]));
  const { expandedIds, toggle: toggleExpand, allExpanded, toggleAll } = useExpandAll(games);

  const visibleGames = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return games;

    const matchingIds = new Set<number>();

    if (searchBy === "title" || searchBy === "all") {
      for (const g of games) {
        if (g.name.toLowerCase().includes(needle) || g.name_en?.toLowerCase().includes(needle)) matchingIds.add(g.id);
      }
    }

    if (searchBy === "genre" || searchBy === "all") {
      const matchingGenreIds = new Set(
        genres
          .filter((g) =>
            g.name.toLowerCase().includes(needle) ||
            g.synonyms?.some((s) => s.toLowerCase().includes(needle))
          )
          .map((g) => g.id)
      );
      for (const g of games) {
        if (g.genre_ids.some((gid) => matchingGenreIds.has(gid))) matchingIds.add(g.id);
      }
    }

    if (searchBy === "platform" || searchBy === "all") {
      const matchingPlatformIds = new Set(
        platforms
          .filter((p) =>
            p.name.toLowerCase().includes(needle) ||
            p.synonyms?.some((s) => s.toLowerCase().includes(needle))
          )
          .map((p) => p.id)
      );
      for (const g of games) {
        if (g.platform_ids.some((pid) => matchingPlatformIds.has(pid))) matchingIds.add(g.id);
      }
    }

    if (searchBy === "person" || searchBy === "all") {
      const matchingPersonIds = new Set(
        people.filter((p) => p.name.toLowerCase().includes(needle) || p.name_en?.toLowerCase().includes(needle)).map((p) => p.id)
      );
      for (const g of games) {
        if (g.persons.some((p) => matchingPersonIds.has(p.id))) matchingIds.add(g.id);
      }
    }

    return games.filter((g) => matchingIds.has(g.id));
  }, [searchQ, searchBy, games, genres, platforms, people]);

  const move = useMutation({
    mutationFn: (v: { id: number; position: number }) =>
      api.put(`/games/${v.id}/position`, { position: v.position }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["games", "ranked"] }),
  });

  const remove = useOptimisticDelete<Game>({
    queryKey: ["games", "ranked"],
    endpoint: (id) => `/games/${id}`,
    invalidateKeys: [["games", "ranked"], ["games", "index"]],
  });

  // Group persons by role for display
  function groupPersons(persons: GamePersonRef[]) {
    const byRole: Record<string, GamePersonRef[]> = {};
    for (const p of persons) {
      if (!byRole[p.role]) byRole[p.role] = [];
      byRole[p.role].push(p);
    }
    return byRole;
  }

  return (
    <section>
      <header className="page-head">
        <h1>Games</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={toggleAll}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          <button onClick={() => setEditing("new")}>+ Add</button>
          <button onClick={() => setShowIgdbImport(true)}>Import from IGDB</button>
        </div>
      </header>

      {dupWarning && <DupWarningBanner message={dupWarning} onDismiss={clearDup} />}

      <div className="search-bar">
        <input
          type="search"
          placeholder="Search games…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <div className="search-by-chips">
          {(["all", "title", "genre", "platform", "person"] as GameSearchBy[]).map((opt) => (
            <button
              key={opt}
              className={`chip${searchBy === opt ? " chip-active" : ""}`}
              onClick={() => setSearchBy(opt)}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
        {searchQ.trim().length > 0 && (
          <span className="search-count">{visibleGames.length} result{visibleGames.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <SortableList
        items={visibleGames}
        rowClassName="album-row"
        onReorder={(next) => qc.setQueryData(["games", "ranked"], next)}
        onMove={(id, position) => move.mutate({ id, position })}
        disableDrag={searchQ.trim().length > 0}
        renderDetail={(g) =>
          expandedIds.has(g.id) ? (
            <div className="album-detail-dropdown">
              {g.persons.length > 0 && (() => {
                const byRole = groupPersons(g.persons);
                return GAME_ROLES
                  .filter((r) => byRole[r]?.length)
                  .map((role) => (
                    <div key={role} className="album-detail-row">
                      <span className="detail-label">{GAME_ROLE_LABELS[role]}</span>
                      <span>
                        {byRole[role].map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && ", "}
                            <Link className="plain-link" to={`/people/${p.id}`}>
                              {p.name}{p.name_en && <span style={{ opacity: 0.6 }}> ({p.name_en})</span>}
                            </Link>
                          </span>
                        ))}
                      </span>
                    </div>
                  ));
              })()}
              {g.genre_ids.length > 0 && (
                <div className="album-detail-row">
                  <span className="detail-label">Genres</span>
                  <span>
                    {g.genre_ids
                      .filter((id) => genreMap[id])
                      .sort((a, b) => genreMap[a].localeCompare(genreMap[b]))
                      .map((id, i) => (
                        <span key={id}>
                          {i > 0 && ", "}
                          <Link className="plain-link" to={`/games/genres/${id}`}>{genreMap[id]}</Link>
                        </span>
                      ))}
                  </span>
                </div>
              )}
              {g.platform_ids.length > 0 && (
                <div className="album-detail-row">
                  <span className="detail-label">Platforms</span>
                  <span>
                    {g.platform_ids
                      .filter((id) => platformMap[id])
                      .sort((a, b) => platformMap[a].localeCompare(platformMap[b]))
                      .map((id, i) => (
                        <span key={id}>
                          {i > 0 && ", "}
                          <Link className="plain-link" to={`/games/platforms/${id}`}>{platformMap[id]}</Link>
                        </span>
                      ))}
                  </span>
                </div>
              )}
              {g.soundtrack_albums.length > 0 && (
                <div className="album-detail-row">
                  <span className="detail-label">Soundtrack</span>
                  <span>
                    {g.soundtrack_albums.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && ", "}
                        <Link to={`/music/albums/${a.id}`}>
                          {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
                        </Link>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {g.play_link && (
                <div className="album-detail-row">
                  <span className="detail-label">Play</span>
                  <a href={g.play_link} target="_blank" rel="noreferrer">{g.play_link}</a>
                </div>
              )}
              {g.notes && (
                <div className="album-detail-row">
                  <span className="detail-label">Notes</span>
                  <span>{g.notes}</span>
                </div>
              )}
              {g.persons.length === 0 && !g.play_link && !g.notes && g.genre_ids.length === 0 &&
                g.platform_ids.length === 0 && g.soundtrack_albums.length === 0 && (
                <span style={{ opacity: 0.5 }}>No extra info.</span>
              )}
            </div>
          ) : null
        }
        render={(g) => (
          <>
            <span className="name">
              <Link to={`/games/${g.id}`} className="plain-link">
                {g.name}{g.name_en && <span style={{ opacity: 0.6 }}> ({g.name_en})</span>}
              </Link>
              {g.play_link && (
                <> <a href={g.play_link} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontStyle: "italic", fontSize: "0.85em", opacity: 0.7, color: "inherit" }}>(link)</a></>
              )}
            </span>
            <span className="meta">
              {g.release_year}
              {g.platform_ids.length > 0 && (
                <> · {g.platform_ids.map((id) => platformMap[id]).filter(Boolean).join(", ")}</>
              )}
              {g.persons.filter((p) => p.role === "director").length > 0 && (
                <> · {g.persons.filter((p) => p.role === "director").map((p) => p.name).join(", ")}</>
              )}
            </span>
            {g.hours_played != null && (
              <span className="listens-count">{g.hours_played}h</span>
            )}
            <button className="icon" title="Show details" onClick={() => toggleExpand(g.id)}>
              {expandedIds.has(g.id) ? "▲" : "▼"}
            </button>
            <button className="icon" onClick={() => setEditing({ game: g })}>✎</button>
            <button className="icon" onClick={() => setConfirmDelete(g)}>✕</button>
          </>
        )}
      />

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}"?`}
          onConfirm={() => {
            remove.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <GameForm
              initial={editing === "new" ? undefined : editing.game}
              onClose={(savedName, savedId) => {
                setEditing(null);
                checkAfterSave(games, savedName, savedId);
              }}
            />
          </div>
        </div>
      )}

      {showIgdbImport && (
        <div className="modal-backdrop" onClick={() => setShowIgdbImport(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <IgdbImportDialog
              onClose={() => setShowIgdbImport(false)}
              onSuccess={(gameId) => navigate(`/games/${gameId}`)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
