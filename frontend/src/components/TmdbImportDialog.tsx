import { useCallback, useMemo, useState } from "react";

import { useTmdbImport, useTmdbLookup } from "../api/hooks";
import type {
  CastRole,
  TmdbImportPersonIn,
  TmdbLookup,
  TmdbPerson,
} from "../api/types";
import { CAST_ROLE_LABELS } from "../api/types";
import { MovieGenreChooser } from "./MovieGenreChooser";

const CAST_ROLE_OPTIONS: CastRole[] = ["lead_actor", "actor", "cameo_actor"];

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
  person: TmdbPerson;
  index: number;
  checked: boolean;
  role: CastRole;
  resolution: number | null | undefined;
  onToggle: () => void;
  onRoleChange: (r: CastRole) => void;
  onResolve: (personId: number | null) => void;
}) {
  const isCrew = person.credit_type === "crew";
  const verifiedMatch = person.db_matches.find((m) => m.has_movie_entries);
  const zeroMovieMatches = person.db_matches.filter(
    (m) => !m.has_movie_entries,
  );

  // Overridden = verified match exists but user explicitly changed away from it
  const isOverridden =
    verifiedMatch != null &&
    resolution !== undefined &&
    resolution !== verifiedMatch.person_id;

  const desc = isCrew
    ? (person.job ?? "Crew")
    : `as ${person.character ?? "?"} (#${(person.billing_order ?? 0) + 1})`;

  return (
    <div className={`tip-row${checked ? " tip-row--checked" : ""}`}>
      <label className="tip-check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </label>

      <div className="tip-body">
        <div className="tip-main">
          <strong className="tip-name">{person.name}</strong>
          <span className="tip-desc">{desc}</span>
          {isCrew ? (
            <span className="tip-role-fixed">{CAST_ROLE_LABELS[role]}</span>
          ) : (
            <select
              className="tip-role-select"
              value={role}
              onChange={(e) => onRoleChange(e.target.value as CastRole)}
            >
              {CAST_ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {CAST_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          )}
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
                  {!m.has_movie_entries && " — no movies"}
                </label>
                {!m.has_movie_entries && (
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

        {/* No verified match, zero-movie matches exist */}
        {!verifiedMatch && zeroMovieMatches.length > 0 && (
          <div className="tip-match tip-match--warn">
            <p>⚠ Name match with <strong>no movie entries</strong>:</p>
            {zeroMovieMatches.map((m) => (
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

export function TmdbImportDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: (movieId: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [lookup, setLookup] = useState<TmdbLookup | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<CastRole[]>([]);
  const [resolutions, setResolutions] = useState<
    Record<number, number | null>
  >({});
  const [selectedGenres, setSelectedGenres] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const lookupMut = useTmdbLookup();
  const importMut = useTmdbImport();

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
          const res: Record<number, number | null> = {};
          for (const p of data.people) {
            if (p.tmdb_id in res) continue;
            const v = p.db_matches.find((m) => m.has_movie_entries);
            if (v) res[p.tmdb_id] = v.person_id;
          }
          setResolutions(res);
          const gs = new Set<number>();
          for (const g of data.genres) if (g.db_genre_id) gs.add(g.db_genre_id);
          setSelectedGenres(gs);
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

  const setRole = (i: number, r: CastRole) =>
    setRoles((prev) => {
      const n = [...prev];
      n[i] = r;
      return n;
    });

  const setResolution = (tmdbId: number, personId: number | null) =>
    setResolutions((prev) => ({ ...prev, [tmdbId]: personId }));

  /* ── import ──────────────────────────────────────── */

  const checkedCount = checked.size;
  const releaseYear = lookup
    ? parseInt((lookup.release_date ?? "0000").slice(0, 4), 10)
    : 0;

  const handleImport = useCallback(() => {
    if (!lookup) return;
    const people: TmdbImportPersonIn[] = lookup.people
      .map((p, i): TmdbImportPersonIn | null => {
        if (!checked.has(i)) return null;
        return {
          tmdb_id: p.tmdb_id,
          name: p.name,
          role: roles[i] ?? p.suggested_role,
          nationality: p.nationality_guess,
          existing_person_id: resolutions[p.tmdb_id] ?? null,
        };
      })
      .filter((x): x is TmdbImportPersonIn => x !== null);

    importMut.mutate(
      {
        title: lookup.title,
        original_title: lookup.original_title,
        runtime_minutes: lookup.runtime,
        release_year: releaseYear,
        people,
        genre_ids: [...selectedGenres],
      },
      {
        onSuccess(result) {
          onSuccess?.(result.movie_id);
          onClose();
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [
    lookup, checked, roles, resolutions, selectedGenres,
    releaseYear, importMut, onClose, onSuccess,
  ]);

  const unmappedGenres = useMemo(
    () =>
      (lookup?.genres ?? [])
        .filter((g) => !g.db_genre_id)
        .map((g) => g.tmdb_name),
    [lookup],
  );

  /* ── render ──────────────────────────────────────── */

  return (
    <div className="modal tmdb-import-panel">
      <h2>Import Movie from TMDB</h2>

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
              placeholder="Movie title"
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
              min={1888}
              max={2099}
            />
          </label>
          <button type="submit" disabled={!title.trim() || lookupMut.isPending}>
            {lookupMut.isPending ? "Searching…" : "Search TMDB"}
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </form>
      )}

      {/* results */}
      {lookup && (
        <>
          {/* movie header */}
          <div className="tip-movie-header">
            <h3>
              {lookup.title}
              {releaseYear ? ` (${releaseYear})` : ""}
              <span className="tip-runtime"> — {lookup.runtime} min</span>
            </h3>
            {lookup.ambiguous && (
              <span className="tip-warn">
                ⚠ Multiple matches — showing most popular
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

          {/* people */}
          <section className="tip-section">
            <div className="tip-section-head">
              <h3>
                Cast &amp; Crew ({lookup.people.length} total, {checkedCount}{" "}
                selected)
              </h3>
              <button type="button" onClick={checkAll}>Check All</button>
              <button type="button" onClick={uncheckAll}>Uncheck All</button>
            </div>

            <div className="tip-people-list">
              {lookup.people.map((p, i) => (
                <PersonRow
                  key={`${p.tmdb_id}-${p.job ?? p.billing_order ?? p.credit_type}`}
                  person={p}
                  index={i}
                  checked={checked.has(i)}
                  role={roles[i] ?? p.suggested_role}
                  resolution={resolutions[p.tmdb_id]}
                  onToggle={() => togglePerson(i)}
                  onRoleChange={(r) => setRole(i, r)}
                  onResolve={(pid) => setResolution(p.tmdb_id, pid)}
                />
              ))}
            </div>
          </section>

          {/* genres */}
          <section className="tip-section">
            <h3>Genres</h3>
            <MovieGenreChooser selected={selectedGenres} onChange={setSelectedGenres} />
            {unmappedGenres.length > 0 && (
              <p className="tip-warn">
                Unmapped TMDB genres: {unmappedGenres.join(", ")}
              </p>
            )}
          </section>

          {/* footer */}
          <footer className="tip-footer">
            <button type="button" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="tip-primary"
              disabled={importMut.isPending || checkedCount === 0}
              onClick={handleImport}
            >
              {importMut.isPending
                ? "Importing…"
                : `Import Movie + ${checkedCount} people`}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
