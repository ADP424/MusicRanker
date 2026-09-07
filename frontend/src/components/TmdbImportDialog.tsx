import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { api } from "../api/client";
import { useGuildApi, useTmdbImport, useTmdbLookup } from "../api/hooks";
import { rk } from "../api/keys";
import type { CastRole, TmdbImportPersonIn, TmdbLookup, TmdbPerson } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { MOVIE_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { BusyButton } from "./Spinner";
import { TmdbPersonRow, tmdbCreditDescription, type TmdbRowPerson } from "./TmdbPersonRow";

/** The movie API's credit shape -> the shared row's media-agnostic shape. */
function toRow(p: TmdbPerson): TmdbRowPerson {
  return {
    tmdb_id: p.tmdb_id,
    name: p.name,
    description: tmdbCreditDescription(p),
    suggested_role: p.suggested_role,
    suggestion_reason: p.suggestion_reason,
    top_credits: p.top_credits,
    nationality_guess: p.nationality_guess,
    roleLocked: p.credit_type === "crew",
    matches: p.db_matches.map((m) => ({
      person_id: m.person_id,
      person_name: m.person_name,
      has_entries: m.has_screen_entries,
      filmography_overlap: m.filmography_overlap,
      artist_summary: m.artist_summary,
      game_summary: m.game_summary,
    })),
  };
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
  const [addToList, setAddToList] = useState(true);

  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
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
            const v = p.db_matches.find((m) => m.filmography_overlap);
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
  // TMDB leaves `release_date` empty for some titles. `parseInt("")` is NaN,
  // and NaN serialises to JSON `null`, which the importer rejects with a 422.
  const releaseYear = useMemo(() => {
    const y = parseInt((lookup?.release_date ?? "").slice(0, 4), 10);
    return Number.isNaN(y) || y <= 0 ? 0 : y;
  }, [lookup]);

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
        async onSuccess(result) {
          if (addToList && canRank) {
            await api.put(`${base}/movies/${result.movie_id}/entry`, {});
            qc.invalidateQueries({ queryKey: rk(guildId, userId, "movies") });
          }
          onSuccess?.(result.movie_id);
          onClose();
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [
    lookup, checked, roles, resolutions, selectedGenres,
    releaseYear, importMut, onClose, onSuccess, addToList, canRank, base, qc, guildId, userId,
  ]);

  const unmappedGenres = useMemo(
    () =>
      (lookup?.genres ?? [])
        .filter((g) => !g.db_genre_id)
        .map((g) => g.tmdb_name),
    [lookup],
  );

  /* ── render ──────────────────────────────────────── */

  const importing = importMut.isPending || importMut.isSuccess;

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
          <BusyButton type="submit" busy={lookupMut.isPending} busyLabel="Searching TMDB…" disabled={!title.trim()}>Search TMDB</BusyButton>
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

          {releaseYear === 0 && (
            <p className="tip-warn">
              ⚠ TMDB has no release date for this title — it can't be imported without a year.
            </p>
          )}

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
                <TmdbPersonRow
                  key={`${p.tmdb_id}-${p.job ?? p.billing_order ?? p.credit_type}`}
                  person={toRow(p)}
                  groupName={String(i)}
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
            <GenreChooser domain={MOVIE_GENRES} selected={selectedGenres} onChange={setSelectedGenres} />
            {unmappedGenres.length > 0 && (
              <p className="tip-warn">
                Unmapped TMDB genres: {unmappedGenres.join(", ")}
              </p>
            )}
          </section>

          {/* footer */}
          <footer className="tip-footer">
            {canRank && (
              <label className="checkbox-label tip-add-to-list">
                <input type="checkbox" checked={addToList} onChange={(e) => setAddToList(e.target.checked)} />
                Add to my list
              </label>
            )}
            <button type="button" onClick={onClose} disabled={importing}>Cancel</button>
            <BusyButton type="button" className="tip-primary" busy={importing} busyLabel="Importing…" disabled={releaseYear === 0} onClick={handleImport}>
              Import Movie + {checkedCount} people
            </BusyButton>
          </footer>
        </>
      )}
    </div>
  );
}
