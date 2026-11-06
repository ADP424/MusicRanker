import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useGuildApi, useTmdbImport, useTmdbLookup } from "../api/hooks";
import type { CastRole, TmdbImportOut, TmdbImportPersonIn, TmdbLookup, TmdbPerson } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { MOVIE_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { importSummary, UnmappedMapper, useWorkLinks } from "./import/ImportExtras";
import { ImportDialog, ImportFooter, ImportSearch, ImportSection, ImportTitle, plural } from "./import/ImportKit";
import { type ImportRowPerson, TmdbPersonRow, tmdbCreditDescription } from "./import/ImportPersonRow";
import { Notice } from "./form/FormKit";
import { LookupSummary } from "./LookupSummary";

/** The movie API's credit shape -> the shared row's media-agnostic shape. */
function toRow(p: TmdbPerson): ImportRowPerson<CastRole> {
  return {
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
      summaries: [m.artist_summary, m.game_summary],
    })),
  };
}

/** Ticked by default: the director(s) and composer(s), the top-billed cast,
 * and anyone already in the catalog with a matching filmography. */
function defaultTicks(data: TmdbLookup): Set<number> {
  const out = new Set<number>();
  data.people.forEach((p, i) => {
    const crew = p.credit_type === "crew";
    const topBilled = p.credit_type === "cast" && (p.billing_order ?? 99) < 8;
    if (crew || topBilled || p.db_matches.some((m) => m.filmography_overlap)) out.add(i);
  });
  return out;
}

/* ── main component ──────────────────────────────────── */

export function TmdbImportDialog({
  onClose,
  onSuccess,
  initial,
  mergeInto,
}: {
  onClose: () => void;
  onSuccess?: (movieId: number) => void;
  /** Open on this TMDB title straight away (from a person's TMDB credits). */
  initial?: { tmdbId: number; title: string; year?: number | null };
  /** Add the credits to this movie instead of creating one. */
  mergeInto?: { id: number; name: string; release_year: number; tmdb_id: number | null };
}) {
  const [title, setTitle] = useState(initial?.title ?? mergeInto?.name ?? "");
  const [year, setYear] = useState(initial?.year ? String(initial.year) : mergeInto ? String(mergeInto.release_year) : "");
  const [lookup, setLookup] = useState<TmdbLookup | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<CastRole[]>([]);
  const [resolutions, setResolutions] = useState<
    Record<number, number | null>
  >({});
  const [selectedGenres, setSelectedGenres] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [addToList, setAddToList] = useState(true);

  const { guildId, base } = useGuildApi();
  const canRank = useCan("rank");
  const lookupMut = useTmdbLookup();
  const importMut = useTmdbImport();
  const mergeMut = useMutation({
    meta: { errorToast: false },
    mutationFn: ({ id, body }: { id: number; body: unknown }) =>
      api.post<{ people_linked: number } & Pick<TmdbImportOut, "created_people" | "reused_people">>(`${base}/movies/tmdb-import/credits/${id}`, body),
  });
  const links = useWorkLinks(mergeInto ? undefined : lookup?.title);

  /* ── search ──────────────────────────────────────── */

  const handleSearch = useCallback((tmdbId?: number) => {
    setError(null);
    lookupMut.mutate(
      { title: title.trim(), year: year ? parseInt(year, 10) : undefined, tmdb_id: tmdbId },
      {
        onSuccess(data) {
          setLookup(data);
          setChecked(defaultTicks(data));
          setRoles(data.people.map((p) => p.suggested_role));
          const res: Record<number, number | null> = {};
          for (const p of data.people) {
            if (p.tmdb_id in res) continue;
            // A verified match, or else the only person by that name: reuse
            // them rather than creating a duplicate.
            const v = p.db_matches.find((m) => m.filmography_overlap)
              ?? (p.db_matches.length === 1 ? p.db_matches[0] : undefined);
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

  // Once, on open: the lookup for the title we were opened on.
  useEffect(() => {
    if (initial) handleSearch(initial.tmdbId);
    else if (mergeInto) handleSearch(mergeInto.tmdb_id ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

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

    if (mergeInto) {
      mergeMut.mutate(
        {
          id: mergeInto.id,
          body: {
            tmdb_id: lookup.tmdb_id, overview: lookup.overview, poster_url: lookup.poster_url,
            people, genre_ids: [...selectedGenres],
          },
        },
        {
          onSuccess(result) {
            importSummary(`${result.people_linked} credit${result.people_linked === 1 ? "" : "s"} for ${mergeInto.name}`, result);
            onClose();
          },
          onError: (e) => setError(e.message),
        },
      );
      return;
    }

    importMut.mutate(
      {
        tmdb_id: lookup.tmdb_id,
        title: lookup.title,
        original_title: lookup.original_title,
        overview: lookup.overview,
        poster_url: lookup.poster_url,
        runtime_minutes: lookup.runtime,
        release_year: releaseYear,
        people,
        genre_ids: [...selectedGenres],
        add_to_list: addToList && canRank,
      },
      {
        async onSuccess(result) {
          await links.commit("movie", result.movie_id);
          importSummary(lookup.title, result);
          onSuccess?.(result.movie_id);
          onClose();
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [
    lookup, checked, roles, resolutions, selectedGenres,
    releaseYear, importMut, mergeMut, mergeInto, links, onClose, onSuccess, addToList, canRank,
  ]);

  const unmappedGenres = useMemo(
    () =>
      (lookup?.genres ?? [])
        .filter((g) => !g.db_genre_id)
        .map((g) => g.tmdb_name),
    [lookup],
  );

  /* ── render ──────────────────────────────────────── */

  const importing = importMut.isPending || importMut.isSuccess || mergeMut.isPending;

  return (
    <ImportDialog title={mergeInto ? `Import credits from TMDB · ${mergeInto.name}` : "Import a movie from TMDB"}
                  onClose={onClose} error={error} reviewing={!!lookup}>
      {!lookup ? (
        <ImportSearch source="TMDB" title={title} onTitle={setTitle} year={year} onYear={setYear}
                      placeholder="Movie title, or paste a TMDB link" minYear={1888}
                      busy={lookupMut.isPending} onSearch={() => handleSearch()} onCancel={onClose} />
      ) : (
        <>
          <ImportTitle title={lookup.title} year={releaseYear || null} facts={lookup.runtime ? `${lookup.runtime} min` : undefined}
                       ambiguous={lookup.ambiguous} onNewSearch={() => { setLookup(null); setError(null); }} />
          <LookupSummary image={lookup.poster_url} overview={lookup.overview}
                         candidates={lookup.candidates} busy={lookupMut.isPending}
                         onPick={(c) => c.tmdb_id && handleSearch(c.tmdb_id)}
                         existing={!mergeInto && lookup.existing_movie_id ? { to: `/g/${guildId}/movies/${lookup.existing_movie_id}`, label: "Open it" } : null} />
          {releaseYear === 0 && !mergeInto && (
            <Notice tone="warning">TMDB has no release date for this title, and a movie can't be imported without a year.</Notice>
          )}

          <ImportSection title="Cast & crew" count={`${checkedCount} of ${lookup.people.length} selected`}
                         onAll={checkAll} onNone={uncheckAll}
                         hint="Directors, composers, the top-billed cast and anyone already in the catalog are ticked.">
            <div className="grid gap-1.5">
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
          </ImportSection>

          <ImportSection title="Genres" count={`${selectedGenres.size} selected`}>
            <GenreChooser domain={MOVIE_GENRES} selected={selectedGenres} onChange={setSelectedGenres} />
            <UnmappedMapper source="TMDB" noun="genres" names={unmappedGenres} domain={MOVIE_GENRES}
                            onMapped={(id) => setSelectedGenres((prev) => new Set(prev).add(id))} />
          </ImportSection>

          {links.section}

          <ImportFooter
            addToList={!mergeInto && canRank ? { checked: addToList, onChange: setAddToList } : null}
            onCancel={onClose}
            importing={importing}
            disabled={releaseYear === 0 && !mergeInto}
            onImport={handleImport}
            label={mergeInto ? `Add ${plural(checkedCount, "credit")}` : `Import with ${plural(checkedCount, "person", "people")}`}
          />
        </>
      )}
    </ImportDialog>
  );
}
