import { useCallback, useMemo, useState } from "react";

import { useIgdbImport, useIgdbLookup } from "../api/hooks";
import type {
  GameRole,
  IgdbImportPersonIn,
  IgdbLookup,
  IgdbPerson,
} from "../api/types";
import { GAME_ROLE_LABELS, GAME_ROLES } from "../api/types";
import { GameGenreChooser } from "./GameGenreChooser";
import { GamePlatformChooser } from "./GamePlatformChooser";

/** IGDB company ids and person ids are separate id spaces — namespace by source. */
const creditKey = (p: IgdbPerson) => `${p.source}:${p.igdb_id}`;

/* ── single person row ───────────────────────────────── */

function PersonRow({
  person,
  index,
  checked,
  role,
  resolution,
  onToggle,
  onRoleChange,
  onResolve,
}: {
  person: IgdbPerson;
  index: number;
  checked: boolean;
  role: GameRole;
  resolution: number | null | undefined;
  onToggle: () => void;
  onRoleChange: (r: GameRole) => void;
  onResolve: (personId: number | null) => void;
}) {
  const verifiedMatch = person.db_matches.find((m) => m.has_game_entries);
  const zeroGameMatches = person.db_matches.filter(
    (m) => !m.has_game_entries,
  );

  // Overridden = verified match exists but user explicitly changed away from it
  const isOverridden =
    verifiedMatch != null &&
    resolution !== undefined &&
    resolution !== verifiedMatch.person_id;

  return (
    <div className={`tip-row${checked ? " tip-row--checked" : ""}`}>
      <label className="tip-check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </label>

      <div className="tip-body">
        <div className="tip-main">
          <strong className="tip-name">{person.name}</strong>
          <span className="tip-desc">{person.source}</span>
          <select
            className="tip-role-select"
            value={role}
            onChange={(e) => onRoleChange(e.target.value as GameRole)}
          >
            {GAME_ROLES.map((r) => (
              <option key={r} value={r}>
                {GAME_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <span className="tip-nat">{person.nationality_guess}</span>
        </div>

        {person.top_credits.length > 0 && (
          <div className="tip-credits">
            {person.top_credits.slice(0, 3).join("  ·  ")}
          </div>
        )}

        <div className="tip-suggestion">💡 {person.suggestion_reason}</div>

        {/* Verified match, not overridden — compact green badge with override button */}
        {verifiedMatch && !isOverridden && (
          <div className="tip-match tip-match--ok">
            ✓ Matched: {verifiedMatch.person_name} (#{verifiedMatch.person_id})
            <button
              type="button"
              className="tip-override"
              onClick={() => onResolve(null)}
            >
              Not this person
            </button>
          </div>
        )}

        {/* Verified match overridden — show all candidates as radio group */}
        {verifiedMatch && isOverridden && (
          <div className="tip-match tip-match--warn">
            <p>⚠ Match overridden — select alternative:</p>
            {person.db_matches.map((m) => (
              <div key={m.person_id} className="tip-conflict-option">
                <label>
                  <input
                    type="radio"
                    name={`resolve-${index}`}
                    checked={resolution === m.person_id}
                    onChange={() => onResolve(m.person_id)}
                  />
                  Use <strong>{m.person_name}</strong> (#{m.person_id})
                  {!m.has_game_entries && " — no games"}
                </label>
                {!m.has_game_entries && (
                  <div className="tip-artist-summary">{m.artist_summary}</div>
                )}
              </div>
            ))}
            <label className="tip-conflict-option">
              <input
                type="radio"
                name={`resolve-${index}`}
                checked={resolution === null}
                onChange={() => onResolve(null)}
              />
              Create new person
            </label>
          </div>
        )}

        {/* No verified match, zero-game matches exist */}
        {!verifiedMatch && zeroGameMatches.length > 0 && (
          <div className="tip-match tip-match--warn">
            <p>⚠ Name match with <strong>no game entries</strong>:</p>
            {zeroGameMatches.map((m) => (
              <div key={m.person_id} className="tip-conflict-option">
                <label>
                  <input
                    type="radio"
                    name={`resolve-${index}`}
                    checked={resolution === m.person_id}
                    onChange={() => onResolve(m.person_id)}
                  />
                  Use existing <strong>{m.person_name}</strong> (#{m.person_id})
                </label>
                <div className="tip-artist-summary">{m.artist_summary}</div>
              </div>
            ))}
            <label className="tip-conflict-option">
              <input
                type="radio"
                name={`resolve-${index}`}
                checked={resolution === null || resolution === undefined}
                onChange={() => onResolve(null)}
              />
              Create new person
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── main component ──────────────────────────────────── */

export function IgdbImportDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: (gameId: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [lookup, setLookup] = useState<IgdbLookup | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<GameRole[]>([]);
  const [resolutions, setResolutions] = useState<
    Record<string, number | null>
  >({});
  const [selectedGenres, setSelectedGenres] = useState<Set<number>>(new Set());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const lookupMut = useIgdbLookup();
  const importMut = useIgdbImport();

  /* ── search ──────────────────────────────────────── */

  const handleSearch = useCallback(() => {
    setError(null);
    lookupMut.mutate(
      { title: title.trim(), year: year ? parseInt(year, 10) : undefined },
      {
        onSuccess(data) {
          setLookup(data);
          setChecked(new Set());
          setRoles(data.people.map((p) => p.suggested_role));
          const res: Record<string, number | null> = {};
          for (const p of data.people) {
            const k = creditKey(p);
            if (k in res) continue;
            const v = p.db_matches.find((m) => m.has_game_entries);
            if (v) res[k] = v.person_id;
          }
          setResolutions(res);
          const gs = new Set<number>();
          for (const g of data.genres) if (g.db_genre_id) gs.add(g.db_genre_id);
          setSelectedGenres(gs);
          const ps = new Set<number>();
          for (const p of data.platforms) if (p.db_platform_id) ps.add(p.db_platform_id);
          setSelectedPlatforms(ps);
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [title, year, lookupMut]);

  /* ── people toggles ──────────────────────────────── */

  const togglePerson = (i: number) =>
    setChecked((prev) => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });

  const checkAll = () => {
    if (lookup) setChecked(new Set(lookup.people.map((_, i) => i)));
  };
  const uncheckAll = () => setChecked(new Set());

  const setRole = (i: number, r: GameRole) =>
    setRoles((prev) => {
      const n = [...prev];
      n[i] = r;
      return n;
    });

  const setResolution = (key: string, personId: number | null) =>
    setResolutions((prev) => ({ ...prev, [key]: personId }));

  /* ── import ──────────────────────────────────────── */

  const checkedCount = checked.size;

  // IGDB's first_release_date is genuinely absent for a lot of older/indie
  // titles; fall back to the year the user typed rather than posting 0.
  const releaseYear = useMemo(() => {
    const fromLookup = parseInt((lookup?.release_date ?? "").slice(0, 4), 10);
    if (!Number.isNaN(fromLookup) && fromLookup > 0) return fromLookup;
    const typed = parseInt(year, 10);
    return Number.isNaN(typed) ? 0 : typed;
  }, [lookup, year]);

  const handleImport = useCallback(() => {
    if (!lookup) return;
    const people: IgdbImportPersonIn[] = lookup.people
      .map((p, i): IgdbImportPersonIn | null => {
        if (!checked.has(i)) return null;
        return {
          igdb_id: p.igdb_id,
          source: p.source,
          name: p.name,
          role: roles[i] ?? p.suggested_role,
          nationality: p.nationality_guess,
          existing_person_id: resolutions[creditKey(p)] ?? null,
        };
      })
      .filter((x): x is IgdbImportPersonIn => x !== null);

    importMut.mutate(
      {
        title: lookup.title,
        release_year: releaseYear,
        people,
        genre_ids: [...selectedGenres],
        platform_ids: [...selectedPlatforms],
      },
      {
        onSuccess(result) {
          onSuccess?.(result.game_id);
          onClose();
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [
    lookup, checked, roles, resolutions, selectedGenres, selectedPlatforms,
    releaseYear, importMut, onClose, onSuccess,
  ]);

  const unmappedGenres = useMemo(
    () =>
      (lookup?.genres ?? [])
        .filter((g) => !g.db_genre_id)
        .map((g) => g.igdb_name),
    [lookup],
  );

  const unmappedPlatforms = useMemo(
    () =>
      (lookup?.platforms ?? [])
        .filter((p) => !p.db_platform_id)
        .map((p) => p.igdb_name),
    [lookup],
  );

  /* ── render ──────────────────────────────────────── */

  return (
    <div className="modal tmdb-import-panel">
      <h2>Import Game from IGDB</h2>

      {error && <p className="tip-error">{error}</p>}

      {/* search form */}
      {!lookup && (
        <form
          className="tip-search"
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
        >
          <label>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Game title"
              autoFocus
            />
          </label>
          <label>
            Year
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="optional"
              type="number"
              min={1970}
              max={2099}
            />
          </label>
          <button type="submit" disabled={!title.trim() || lookupMut.isPending}>
            {lookupMut.isPending ? "Searching…" : "Search IGDB"}
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </form>
      )}

      {/* results */}
      {lookup && (
        <>
          {/* game header */}
          <div className="tip-movie-header">
            <h3>
              {lookup.title}
              {releaseYear ? ` (${releaseYear})` : ""}
            </h3>
            {lookup.ambiguous && (
              <span className="tip-warn">
                ⚠ Multiple matches — showing highest-rated
              </span>
            )}
            <button
              type="button"
              className="icon"
              onClick={() => {
                setLookup(null);
                setError(null);
              }}
              title="New search"
            >
              ↩
            </button>
          </div>

          {releaseYear === 0 && (
            <p className="tip-warn">
              ⚠ IGDB has no release date for this title — enter a year above and re-search to import.
            </p>
          )}

          {/* people */}
          <section className="tip-section">
            <div className="tip-section-head">
              <h3>
                Credits ({lookup.people.length} total, {checkedCount}{" "}
                selected)
              </h3>
              <button type="button" onClick={checkAll}>Check All</button>
              <button type="button" onClick={uncheckAll}>Uncheck All</button>
            </div>

            <div className="tip-people-list">
              {lookup.people.map((p, i) => (
                <PersonRow
                  key={creditKey(p)}
                  person={p}
                  index={i}
                  checked={checked.has(i)}
                  role={roles[i] ?? p.suggested_role}
                  resolution={resolutions[creditKey(p)]}
                  onToggle={() => togglePerson(i)}
                  onRoleChange={(r) => setRole(i, r)}
                  onResolve={(pid) => setResolution(creditKey(p), pid)}
                />
              ))}
            </div>
          </section>

          {/* genres */}
          <section className="tip-section">
            <h3>Genres</h3>
            <GameGenreChooser selected={selectedGenres} onChange={setSelectedGenres} />
            {unmappedGenres.length > 0 && (
              <p className="tip-warn">
                Unmapped IGDB genres: {unmappedGenres.join(", ")}
              </p>
            )}
          </section>

          {/* platforms */}
          <section className="tip-section">
            <h3>Platforms</h3>
            <GamePlatformChooser selected={selectedPlatforms} onChange={setSelectedPlatforms} />
            {unmappedPlatforms.length > 0 && (
              <p className="tip-warn">
                Unmapped IGDB platforms: {unmappedPlatforms.join(", ")}
              </p>
            )}
          </section>

          {/* footer */}
          <footer className="tip-footer">
            <button type="button" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="tip-primary"
              disabled={importMut.isPending || releaseYear === 0}
              onClick={handleImport}
            >
              {importMut.isPending
                ? "Importing…"
                : `Import Game + ${checkedCount} people`}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
