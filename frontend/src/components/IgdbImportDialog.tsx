import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useGuildApi, useIgdbImport, useIgdbLookup } from "../api/hooks";
import type {
  GameRole,
  IgdbImportOut,
  IgdbImportPersonIn,
  IgdbLookup,
  IgdbPerson,
} from "../api/types";
import { GAME_ROLE_LABELS, GAME_ROLES } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { GAME_GENRES, GAME_PLATFORMS } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { Notice } from "./form/FormKit";
import { importSummary, UnmappedMapper, useWorkLinks } from "./import/ImportExtras";
import { ImportDialog, ImportFooter, ImportSearch, ImportSection, ImportTitle, plural } from "./import/ImportKit";
import { ImportPersonRow, type ImportRowPerson } from "./import/ImportPersonRow";
import { LookupSummary } from "./LookupSummary";

/** IGDB company ids and person ids are separate id spaces — namespace by source. */
const creditKey = (p: IgdbPerson) => `${p.source}:${p.igdb_id}`;

/** The IGDB credit shape -> the shared row's. */
function toRow(p: IgdbPerson): ImportRowPerson<GameRole> {
  return {
    name: p.name,
    description: p.source === "company" ? "Studio" : "Person",
    suggested_role: p.suggested_role,
    suggestion_reason: p.suggestion_reason,
    top_credits: p.top_credits,
    nationality_guess: p.nationality_guess,
    roleLocked: false,
    matches: p.db_matches.map((m) => ({
      person_id: m.person_id,
      person_name: m.person_name,
      has_entries: m.has_game_entries,
      filmography_overlap: m.filmography_overlap,
      summaries: [m.artist_summary],
    })),
  };
}

/* ── main component ──────────────────────────────────── */

export function IgdbImportDialog({
  onClose,
  onSuccess,
  mergeInto,
}: {
  onClose: () => void;
  onSuccess?: (gameId: number) => void;
  /** Add the credits to this game instead of creating one. */
  mergeInto?: { id: number; name: string; release_year: number; igdb_id: number | null };
}) {
  const [title, setTitle] = useState(mergeInto?.name ?? "");
  const [year, setYear] = useState(mergeInto ? String(mergeInto.release_year) : "");
  const [lookup, setLookup] = useState<IgdbLookup | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<GameRole[]>([]);
  const [resolutions, setResolutions] = useState<
    Record<string, number | null>
  >({});
  const [selectedGenres, setSelectedGenres] = useState<Set<number>>(new Set());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [addToList, setAddToList] = useState(true);

  const { guildId, base } = useGuildApi();
  const canRank = useCan("rank");
  const lookupMut = useIgdbLookup();
  const importMut = useIgdbImport();
  const mergeMut = useMutation({
    meta: { errorToast: false },
    mutationFn: ({ id, body }: { id: number; body: unknown }) =>
      api.post<{ people_linked: number } & Pick<IgdbImportOut, "created_people" | "reused_people">>(`${base}/games/igdb-import/credits/${id}`, body),
  });
  const links = useWorkLinks(mergeInto ? undefined : lookup?.title);

  /* ── search ──────────────────────────────────────── */

  const handleSearch = useCallback((igdbId?: number) => {
    setError(null);
    lookupMut.mutate(
      { title: title.trim(), year: year ? parseInt(year, 10) : undefined, igdb_id: igdbId },
      {
        onSuccess(data) {
          setLookup(data);
          // Developers are what IGDB is good for; tick them, and anyone already matched.
          setChecked(new Set(data.people.flatMap((p, i) =>
            p.suggested_role === "developer" || p.db_matches.some((m) => m.filmography_overlap) ? [i] : [])));
          setRoles(data.people.map((p) => p.suggested_role));
          const res: Record<string, number | null> = {};
          for (const p of data.people) {
            const k = creditKey(p);
            if (k in res) continue;
            const v = p.db_matches.find((m) => m.filmography_overlap)
              ?? (p.db_matches.length === 1 ? p.db_matches[0] : undefined);
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

  // Once, on open: the lookup for the game we're adding credits to.
  useEffect(() => {
    if (mergeInto) handleSearch(mergeInto.igdb_id ?? undefined);
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
  const lookupYear = useMemo(() => {
    const y = parseInt((lookup?.release_date ?? "").slice(0, 4), 10);
    return Number.isNaN(y) || y <= 0 ? 0 : y;
  }, [lookup]);
  const releaseYear = lookupYear || (parseInt(year, 10) || 0);

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

    if (mergeInto) {
      mergeMut.mutate(
        {
          id: mergeInto.id,
          body: {
            igdb_id: lookup.igdb_id, summary: lookup.summary, cover_url: lookup.cover_url,
            people, genre_ids: [...selectedGenres], platform_ids: [...selectedPlatforms],
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
        igdb_id: lookup.igdb_id,
        title: lookup.title,
        release_year: releaseYear,
        summary: lookup.summary,
        cover_url: lookup.cover_url,
        people,
        genre_ids: [...selectedGenres],
        add_to_list: addToList && canRank,
        platform_ids: [...selectedPlatforms],
      },
      {
        async onSuccess(result) {
          await links.commit("game", result.game_id);
          importSummary(lookup.title, result);
          onSuccess?.(result.game_id);
          onClose();
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [
    lookup, checked, roles, resolutions, selectedGenres, selectedPlatforms,
    releaseYear, importMut, mergeMut, mergeInto, links, onClose, onSuccess, addToList, canRank,
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

  const importing = importMut.isPending || importMut.isSuccess || mergeMut.isPending;

  return (
    <ImportDialog title={mergeInto ? `Import credits from IGDB · ${mergeInto.name}` : "Import a game from IGDB"}
                  onClose={onClose} error={error} reviewing={!!lookup}>
      {!lookup ? (
        <ImportSearch source="IGDB" title={title} onTitle={setTitle} year={year} onYear={setYear}
                      placeholder="Game title, or igdb:1234" minYear={1950}
                      busy={lookupMut.isPending} onSearch={() => handleSearch()} onCancel={onClose} />
      ) : (
        <>
          <ImportTitle title={lookup.title} year={releaseYear || null} ambiguous={lookup.ambiguous}
                       onNewSearch={() => { setLookup(null); setError(null); }} />
          <LookupSummary image={lookup.cover_url} overview={lookup.summary}
                         candidates={lookup.candidates} busy={lookupMut.isPending}
                         onPick={(c) => c.igdb_id && handleSearch(c.igdb_id)}
                         existing={!mergeInto && lookup.existing_game_id ? { to: `/g/${guildId}/games/${lookup.existing_game_id}`, label: "Open it" } : null} />
          {!lookupYear && !mergeInto && (
            <Notice tone={releaseYear >= 1950 ? "info" : "warning"}>
              <div className="flex flex-wrap items-center gap-2">
                IGDB has no release date for this title. Year:
                <input type="number" min={1950} max={2099} aria-label="Release year" className="h-7 w-24 py-0"
                       value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
            </Notice>
          )}

          <ImportSection title="Credits" count={`${checkedCount} of ${lookup.people.length} selected`}
                         onAll={checkAll} onNone={uncheckAll}
                         hint="Developers and anyone already in the catalog are ticked. Publishers aren't credited.">
            <div className="grid gap-1.5">
              {lookup.people.map((p, i) => (
                <ImportPersonRow
                  key={creditKey(p)}
                  person={toRow(p)}
                  groupName={creditKey(p)}
                  checked={checked.has(i)}
                  role={roles[i] ?? p.suggested_role}
                  resolution={resolutions[creditKey(p)]}
                  roleOptions={GAME_ROLES}
                  roleLabels={GAME_ROLE_LABELS}
                  credits="game credits"
                  onToggle={() => togglePerson(i)}
                  onRoleChange={(r) => setRole(i, r)}
                  onResolve={(pid) => setResolution(creditKey(p), pid)}
                />
              ))}
            </div>
          </ImportSection>

          <ImportSection title="Genres" count={`${selectedGenres.size} selected`}>
            <GenreChooser domain={GAME_GENRES} selected={selectedGenres} onChange={setSelectedGenres} />
            <UnmappedMapper source="IGDB" noun="genres" names={unmappedGenres} domain={GAME_GENRES}
                            onMapped={(id) => setSelectedGenres((prev) => new Set(prev).add(id))} />
          </ImportSection>

          <ImportSection title="Platforms" count={`${selectedPlatforms.size} selected`}>
            <GenreChooser domain={GAME_PLATFORMS} selected={selectedPlatforms} onChange={setSelectedPlatforms} />
            <UnmappedMapper source="IGDB" noun="platforms" names={unmappedPlatforms} domain={GAME_PLATFORMS}
                            onMapped={(id) => setSelectedPlatforms((prev) => new Set(prev).add(id))} />
          </ImportSection>

          {links.section}

          <ImportFooter
            addToList={!mergeInto && canRank ? { checked: addToList, onChange: setAddToList } : null}
            onCancel={onClose}
            importing={importing}
            disabled={releaseYear < 1950 && !mergeInto}
            onImport={handleImport}
            label={mergeInto ? `Add ${plural(checkedCount, "credit")}` : `Import with ${plural(checkedCount, "credit")}`}
          />
        </>
      )}
    </ImportDialog>
  );
}
