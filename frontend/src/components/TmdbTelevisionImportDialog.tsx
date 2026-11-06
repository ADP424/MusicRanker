import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useGuildApi, useTmdbTvImport, useTmdbTvLookup } from "../api/hooks";
import { rk } from "../api/keys";
import type { CastRole, TmdbTvImportPersonIn, TmdbTvImportSeasonIn, TmdbTvLookup } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { TELEVISION_GENRES } from "../genre/config";
import { CheckField } from "./form/FormKit";
import { EpisodeCrewReview, importSummary, UnmappedMapper, useWorkLinks } from "./import/ImportExtras";
import {
  ImportCheckRow, ImportDialog, ImportFooter, ImportSearch, ImportSection, ImportTitle, plural,
} from "./import/ImportKit";
import { TmdbPersonRow } from "./import/ImportPersonRow";
import { TelevisionGenreChooser } from "./TelevisionGenreChooser";
import { ACTOR_ROLES, autoCrewLabel, personIn, seedResolutions, toRow } from "./tmdbTvShared";
import { LookupSummary } from "./LookupSummary";

const epKey = (s: number, e: number) => `s${s}e${e}`;

type PeopleState = { checked: Set<string>; roles: Record<string, CastRole> };

/**
 * Whole-show TMDB import: creates the show, its seasons and their episodes.
 *
 * Show-level credits are only the creators plus whoever is credited on at least
 * 80% of the episodes of every season; each season and episode then has its own TMDB import on its
 * page for the people specific to it. "Populate down" copies the show's
 * people onto every season and episode in one go instead.
 */
export function TmdbTelevisionImportDialog({
  onClose,
  onSuccess,
  initial,
}: {
  onClose: () => void;
  onSuccess?: (showId: number) => void;
  /** Open on this TMDB title straight away (from a person's TMDB credits). */
  initial?: { tmdbId: number; title: string; year?: number | null };
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [year, setYear] = useState(initial?.year ? String(initial.year) : "");
  const [includeEpisodes, setIncludeEpisodes] = useState(true);
  const [includeSpecials, setIncludeSpecials] = useState(false);

  const [lookup, setLookup] = useState<TmdbTvLookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  // show-level people only; episodes carry their automatic crew as-is
  const [people, setPeople] = useState<PeopleState>({ checked: new Set(), roles: {} });
  // TMDB person id -> existing DB person (or null = create new). Shared across
  // the whole import: the same human must resolve identically on the show and
  // on any episode's automatic crew.
  const [resolutions, setResolutions] = useState<Record<number, number | null>>({});
  const [selectedGenres, setSelectedGenres] = useState<Set<number>>(new Set());
  const [includedEpisodes, setIncludedEpisodes] = useState<Set<string>>(new Set());
  const [populateDown, setPopulateDown] = useState(true);
  const [fullCast, setFullCast] = useState(false);
  const [addToList, setAddToList] = useState(true);
  // season numbers whose season + episodes go into my list too
  const [listedSeasons, setListedSeasons] = useState<Set<number>>(new Set());

  const qc = useQueryClient();
  const { guildId, userId } = useGuildApi();
  const canRank = useCan("rank");
  const lookupMut = useTmdbTvLookup();
  const importMut = useTmdbTvImport();
  const links = useWorkLinks(lookup?.name);

  const allEpisodes = useMemo(() => (lookup?.seasons ?? []).flatMap((s) => s.episodes), [lookup]);

  const handleSearch = useCallback((tmdbId?: number) => {
    setError(null);
    lookupMut.mutate(
      {
        title: title.trim(),
        year: year ? parseInt(year, 10) : undefined,
        tmdb_id: tmdbId,
        include_episodes: includeEpisodes,
        include_specials: includeSpecials,
      },
      {
        onSuccess(data) {
          setLookup(data);
          const checked = new Set<string>();
          const roles: Record<string, CastRole> = {};
          data.people.forEach((p, i) => {
            const k = `show:${i}`;
            checked.add(k);
            roles[k] = p.suggested_role;
          });
          setPeople({ checked, roles });
          setIncludedEpisodes(
            new Set(data.seasons.flatMap((s) => s.episodes.map((e) => epKey(e.season_number, e.episode_number)))),
          );
          setListedSeasons(new Set(data.seasons.map((s) => s.season_number)));

          const res: Record<number, number | null> = {};
          seedResolutions(data.people, res);
          for (const season of data.seasons) for (const e of season.episodes) seedResolutions(e.people, res);
          setResolutions(res);

          const gs = new Set<number>();
          for (const g of data.genres) if (g.db_genre_id) gs.add(g.db_genre_id);
          setSelectedGenres(gs);
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [title, year, includeEpisodes, includeSpecials, lookupMut]);

  // Once, on open: the lookup for the title we were opened on.
  useEffect(() => {
    if (initial) handleSearch(initial.tmdbId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const togglePerson = (key: string) =>
    setPeople((prev) => {
      const checked = new Set(prev.checked);
      checked.has(key) ? checked.delete(key) : checked.add(key);
      return { ...prev, checked };
    });

  const setRole = (key: string, r: CastRole) =>
    setPeople((prev) => ({ ...prev, roles: { ...prev.roles, [key]: r } }));

  const setResolution = (tmdbId: number, personId: number | null) =>
    setResolutions((prev) => ({ ...prev, [tmdbId]: personId }));

  function bulkScope(scope: string, count: number, on: boolean) {
    setPeople((prev) => {
      const checked = new Set(prev.checked);
      for (let i = 0; i < count; i++) {
        const k = `${scope}:${i}`;
        on ? checked.add(k) : checked.delete(k);
      }
      return { ...prev, checked };
    });
  }

  const toggleEpisode = (scope: string) =>
    setIncludedEpisodes((prev) => {
      const next = new Set(prev);
      next.has(scope) ? next.delete(scope) : next.add(scope);
      return next;
    });

  const toggleListed = (seasonNumber: number) =>
    setListedSeasons((prev) => {
      const next = new Set(prev);
      next.has(seasonNumber) ? next.delete(seasonNumber) : next.add(seasonNumber);
      return next;
    });

  function toggleSeason(seasonNumber: number, on: boolean) {
    const season = lookup?.seasons.find((s) => s.season_number === seasonNumber);
    if (!season) return;
    setIncludedEpisodes((prev) => {
      const next = new Set(prev);
      for (const e of season.episodes) {
        const k = epKey(e.season_number, e.episode_number);
        on ? next.add(k) : next.delete(k);
      }
      return next;
    });
  }

  const showPeopleCount = useMemo(
    () => (lookup?.people ?? []).filter((_, i) => people.checked.has(`show:${i}`)).length,
    [lookup, people],
  );
  const episodeCount = includedEpisodes.size;

  // A season with episodes on TMDB is imported iff at least one of them is
  // ticked; without "fetch episodes" every season is imported, empty.
  const seasonsIn = useMemo((): TmdbTvImportSeasonIn[] => {
    if (!lookup) return [];
    const out: TmdbTvImportSeasonIn[] = [];
    for (const season of lookup.seasons) {
      const episodes = season.episodes.filter((e) => includedEpisodes.has(epKey(e.season_number, e.episode_number)));
      if (season.episodes.length > 0 && episodes.length === 0) continue;
      out.push({
        name: season.name,
        name_en: null,
        season_number: season.season_number,
        release_year: season.release_year,
        overview: season.overview,
        poster_url: season.poster_url,
        notes: null,
        people: [],
        episodes: episodes.map((e) => ({
          name: e.name,
          name_en: null,
          episode_number: e.episode_number,
          overview: e.overview,
          still_url: e.still_url,
          runtime_minutes: e.runtime,
          release_year: e.release_year,
          notes: null,
          people: e.people.map((p) => personIn(p, p.suggested_role, resolutions)), // director/composer
          inherit_parent_people: false,
          genre_ids: null, // inherit the show's genres
        })),
        add_to_list: canRank && listedSeasons.has(season.season_number),
      });
    }
    return out;
  }, [lookup, includedEpisodes, resolutions, canRank, listedSeasons]);

  const handleImport = useCallback(() => {
    if (!lookup) return;
    importMut.mutate(
      {
        // Same convention as movies and people: `name` is the original, `name_en` the English one.
        ...(lookup.original_name && lookup.original_name.trim().toLowerCase() !== lookup.name.trim().toLowerCase()
          ? { name: lookup.original_name, name_en: lookup.name }
          : { name: lookup.name, name_en: null }),
        release_year: lookup.release_year,
        notes: null,
        tmdb_id: lookup.tmdb_id,
        overview: lookup.overview,
        poster_url: lookup.poster_url,
        people: lookup.people
          .map((p, i) => (people.checked.has(`show:${i}`) ? personIn(p, people.roles[`show:${i}`] ?? p.suggested_role, resolutions) : null))
          .filter((x): x is TmdbTvImportPersonIn => x !== null),
        genre_ids: [...selectedGenres],
        seasons: seasonsIn,
        populate_down: populateDown,
        full_episode_cast: fullCast,
        add_to_list: canRank && addToList,
      },
      {
        async onSuccess(result) {
          if (canRank && (addToList || seasonsIn.some((s) => s.add_to_list))) {
            qc.invalidateQueries({ queryKey: rk(guildId, userId, "television") });
          }
          await links.commit("television_show", result.show_id);
          importSummary(lookup.name, result);
          onSuccess?.(result.show_id);
          onClose();
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [
    lookup, people, resolutions, selectedGenres, seasonsIn, populateDown, importMut, onClose, onSuccess,
    addToList, canRank, qc, guildId, userId, fullCast, links,
  ]);

  const unmappedGenres = useMemo(
    () => (lookup?.genres ?? []).filter((g) => !g.db_genre_id).map((g) => g.tmdb_name),
    [lookup],
  );

  const importing = importMut.isPending || importMut.isSuccess;
  const seasonCount = seasonsIn.length;

  return (
    <ImportDialog title="Import a TV show from TMDB" onClose={onClose} error={error} reviewing={!!lookup}>
      {!lookup ? (
        <ImportSearch source="TMDB" title={title} onTitle={setTitle} year={year} onYear={setYear}
                      placeholder="Show title, or paste a TMDB link" minYear={1928}
                      busy={lookupMut.isPending} onSearch={() => handleSearch()} onCancel={onClose}>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <CheckField checked={includeEpisodes} onChange={setIncludeEpisodes}>Import episodes</CheckField>
            <CheckField checked={includeSpecials} onChange={setIncludeSpecials}>Include specials (season 0)</CheckField>
          </div>
          <p className="text-xs text-muted-foreground">
            At show level you're offered the creators and the main cast and crew (on at least 80% of the episodes
            of every season). Each season and episode has its own TMDB import for the rest. Looking up a long show
            fetches every season, so it can take a few seconds.
          </p>
        </ImportSearch>
      ) : (
        <>
          <ImportTitle
            title={lookup.name}
            year={lookup.release_year}
            facts={<>
              {plural(lookup.number_of_seasons, "season")} · {plural(lookup.number_of_episodes, "episode")}
              {lookup.episode_run_time ? ` · about ${lookup.episode_run_time} min each` : ""}
            </>}
            ambiguous={lookup.ambiguous}
            onNewSearch={() => { setLookup(null); setError(null); }}
          />
          <LookupSummary image={lookup.poster_url} overview={lookup.overview}
                         candidates={lookup.candidates} busy={lookupMut.isPending}
                         onPick={(c) => c.tmdb_id && handleSearch(c.tmdb_id)}
                         existing={lookup.existing_show_id ? { to: `/g/${guildId}/television/shows/${lookup.existing_show_id}`, label: "Open it" } : null} />

          <ImportSection
            title="Show cast & crew"
            count={`${showPeopleCount} of ${lookup.people.length} selected`}
            onAll={() => bulkScope("show", lookup.people.length, true)}
            onNone={() => bulkScope("show", lookup.people.length, false)}
            hint={<>
              The creators, plus everyone on at least 80% of the {lookup.episodes_counted} aired episodes of every
              included season. A show credits a Creator, not a Director: someone who directed every episode is
              offered as Creator here and keeps Director on the seasons and episodes.
            </>}
          >
            {lookup.people.length === 0 && <p className="text-sm text-muted-foreground">Nobody is credited on most episodes.</p>}
            <div className="grid gap-1.5">
              {lookup.people.map((p, i) => {
                const k = `show:${i}`;
                return (
                  <TmdbPersonRow
                    key={`${p.tmdb_id}-${p.job ?? p.billing_order ?? p.credit_type}-${i}`}
                    person={toRow(p)}
                    groupName={k}
                    checked={people.checked.has(k)}
                    role={people.roles[k] ?? p.suggested_role}
                    resolution={resolutions[p.tmdb_id]}
                    roleOptions={ACTOR_ROLES}
                    onToggle={() => togglePerson(k)}
                    onRoleChange={(r) => setRole(k, r)}
                    onResolve={(pid) => setResolution(p.tmdb_id, pid)}
                  />
                );
              })}
            </div>
            <CheckField checked={populateDown} onChange={setPopulateDown} className="mt-1">
              Populate down: also attach these people to every imported season and episode
              <span className="block text-xs text-muted-foreground">Creators stay on the show only.</span>
            </CheckField>
          </ImportSection>

          <ImportSection title="Genres" count={`${selectedGenres.size} selected`} hint="Episodes inherit the show's genres.">
            <TelevisionGenreChooser selected={selectedGenres} onChange={setSelectedGenres} />
            <UnmappedMapper source="TMDB" noun="genres" names={unmappedGenres} domain={TELEVISION_GENRES}
                            onMapped={(id) => setSelectedGenres((prev) => new Set(prev).add(id))} />
          </ImportSection>

          {lookup.seasons.length > 0 && (
            <ImportSection
              title="Seasons & episodes"
              count={includeEpisodes
                ? `${plural(lookup.seasons.length, "season")} · ${episodeCount} of ${allEpisodes.length} episodes selected`
                : plural(lookup.seasons.length, "season")}
              onAll={includeEpisodes ? () => setIncludedEpisodes(new Set(allEpisodes.map((e) => epKey(e.season_number, e.episode_number)))) : undefined}
              onNone={includeEpisodes ? () => setIncludedEpisodes(new Set()) : undefined}
              hint="Each season is created with its ticked episodes (title, runtime, air year), each episode with its own director and composer. A season with nothing ticked is skipped."
            >
              {includeEpisodes && (
                <CheckField checked={fullCast} onChange={setFullCast}>
                  Import the full cast of every episode
                  <span className="block text-xs text-muted-foreground">
                    Guest stars and all. One TMDB call per episode, so a long show takes a while. People with no
                    certain match are created.
                  </span>
                </CheckField>
              )}
              <div className="grid gap-3">
                {lookup.seasons.map((season) => (
                  <div key={season.season_number} className="grid gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold">{season.name}</h4>
                      <span className="text-xs text-muted-foreground">{season.release_year} · {plural(season.episode_count, "episode")}</span>
                      <div className="ml-auto flex flex-wrap items-center gap-3">
                        {canRank && (
                          <CheckField checked={listedSeasons.has(season.season_number)} onChange={() => toggleListed(season.season_number)} className="text-xs">
                            Add to my list
                          </CheckField>
                        )}
                        {season.episodes.length > 0 && (
                          <span className="flex gap-1 text-xs">
                            <button type="button" data-slot="link" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => toggleSeason(season.season_number, true)}>All</button>
                            <span className="text-muted-foreground">/</span>
                            <button type="button" data-slot="link" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => toggleSeason(season.season_number, false)}>None</button>
                          </span>
                        )}
                      </div>
                    </div>
                    {season.episodes.map((e) => {
                      const scope = epKey(e.season_number, e.episode_number);
                      return (
                        <ImportCheckRow key={scope} checked={includedEpisodes.has(scope)} onToggle={() => toggleEpisode(scope)}
                                        title={`E${e.episode_number} · ${e.name}`} detail={`${e.release_year} · ${e.runtime} min`}
                                        sub={autoCrewLabel(e.people)} />
                      );
                    })}
                  </div>
                ))}
              </div>
            </ImportSection>
          )}

          {includeEpisodes && (
            <EpisodeCrewReview episodes={allEpisodes.filter((e) => includedEpisodes.has(epKey(e.season_number, e.episode_number)))}
                               resolutions={resolutions} onResolve={setResolution} />
          )}

          {links.section}

          <ImportFooter
            addToList={canRank ? { checked: addToList, onChange: setAddToList, label: "Add the show to my list" } : null}
            onCancel={onClose}
            importing={importing}
            onImport={handleImport}
            label={`Import ${plural(seasonCount, "season")}, ${plural(episodeCount, "episode")}`}
          />
        </>
      )}
    </ImportDialog>
  );
}
