import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useGuildApi, useTmdbTvImport, useTmdbTvLookup } from "../api/hooks";
import { rk } from "../api/keys";
import type { CastRole, TmdbTvImportPersonIn, TmdbTvImportSeasonIn, TmdbTvLookup } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { BusyButton } from "./Spinner";
import { TelevisionGenreChooser } from "./TelevisionGenreChooser";
import { TmdbPersonRow } from "./TmdbPersonRow";
import { ACTOR_ROLES, autoCrewLabel, personIn, seedResolutions, toRow } from "./tmdbTvShared";

const epKey = (s: number, e: number) => `s${s}e${e}`;

type PeopleState = { checked: Set<string>; roles: Record<string, CastRole> };

/**
 * Whole-show TMDB import: creates the show, its seasons and their episodes.
 *
 * Show-level credits are only the creators plus whoever is credited on every
 * single episode; each season and episode then has its own TMDB import on its
 * page for the people specific to it. "Populate down" copies the show's
 * people onto every season and episode in one go instead.
 */
export function TmdbTelevisionImportDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: (showId: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
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
  const [populateDown, setPopulateDown] = useState(false);
  const [addToList, setAddToList] = useState(true);
  // season numbers whose season + episodes go into my list too
  const [listedSeasons, setListedSeasons] = useState<Set<number>>(new Set());

  const qc = useQueryClient();
  const { guildId, userId } = useGuildApi();
  const canRank = useCan("rank");
  const lookupMut = useTmdbTvLookup();
  const importMut = useTmdbTvImport();

  const allEpisodes = useMemo(() => (lookup?.seasons ?? []).flatMap((s) => s.episodes), [lookup]);

  const handleSearch = useCallback(() => {
    setError(null);
    lookupMut.mutate(
      {
        title: title.trim(),
        year: year ? parseInt(year, 10) : undefined,
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
        notes: null,
        people: [],
        episodes: episodes.map((e) => ({
          name: e.name,
          name_en: null,
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
        name: lookup.name,
        name_en: null,
        release_year: lookup.release_year,
        notes: null,
        people: lookup.people
          .map((p, i) => (people.checked.has(`show:${i}`) ? personIn(p, people.roles[`show:${i}`] ?? p.suggested_role, resolutions) : null))
          .filter((x): x is TmdbTvImportPersonIn => x !== null),
        genre_ids: [...selectedGenres],
        seasons: seasonsIn,
        populate_down: populateDown,
        add_to_list: canRank && addToList,
      },
      {
        onSuccess(result) {
          if (canRank && (addToList || seasonsIn.some((s) => s.add_to_list))) {
            qc.invalidateQueries({ queryKey: rk(guildId, userId, "television") });
          }
          onSuccess?.(result.show_id);
          onClose();
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [
    lookup, people, resolutions, selectedGenres, seasonsIn, populateDown, importMut, onClose, onSuccess,
    addToList, canRank, qc, guildId, userId,
  ]);

  const unmappedGenres = useMemo(
    () => (lookup?.genres ?? []).filter((g) => !g.db_genre_id).map((g) => g.tmdb_name),
    [lookup],
  );

  const importing = importMut.isPending || importMut.isSuccess;
  const seasonCount = seasonsIn.length;

  return (
    <div className="modal tmdb-import-panel">
      <h2>Import TV Show from TMDB</h2>
      {error && <p className="tip-error">{error}</p>}

      {!lookup && (
        <form className="tip-search" onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Show title" autoFocus />
          </label>
          <label>
            Year
            <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="optional" type="number" min={1928} max={2099} />
          </label>
          <p className="meta">
            Only the show's creators and people credited on <strong>every single episode</strong> are
            offered at show level. Each season and episode has its own TMDB import for the rest.
          </p>
          <label className={`chip${includeEpisodes ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={includeEpisodes} onChange={(e) => setIncludeEpisodes(e.target.checked)} />
            Import episodes
          </label>
          <label className={`chip${includeSpecials ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={includeSpecials} onChange={(e) => setIncludeSpecials(e.target.checked)} />
            Include specials (season 0)
          </label>
          <BusyButton type="submit" busy={lookupMut.isPending} busyLabel="Searching TMDB…" disabled={!title.trim()}>Search TMDB</BusyButton>
          <button type="button" onClick={onClose}>Cancel</button>
        </form>
      )}

      {lookup && (
        <>
          <div className="tip-movie-header">
            <h3>
              {lookup.name}
              {lookup.release_year ? ` (${lookup.release_year})` : ""}
              <span className="tip-runtime">
                {" "}— {lookup.number_of_seasons} season{lookup.number_of_seasons !== 1 ? "s" : ""},{" "}
                {lookup.number_of_episodes} episode{lookup.number_of_episodes !== 1 ? "s" : ""}
                {lookup.episode_run_time ? ` · ~${lookup.episode_run_time} min/ep` : ""}
              </span>
            </h3>
            {lookup.ambiguous && <span className="tip-warn">⚠ Multiple matches — showing most popular</span>}
            <button type="button" className="icon" onClick={() => { setLookup(null); setError(null); }} title="New search">↩</button>
          </div>

          <section className="tip-section">
            <div className="tip-section-head">
              <h3>Show Cast &amp; Crew ({lookup.people.length} shown, {showPeopleCount} selected)</h3>
              <button type="button" onClick={() => bulkScope("show", lookup.people.length, true)}>Check All</button>
              <button type="button" onClick={() => bulkScope("show", lookup.people.length, false)}>Uncheck All</button>
            </div>
            <p className="meta">
              The creators, plus everyone credited on all {lookup.episodes_counted} aired episodes of the
              included seasons. A show is credited with a <strong>Creator</strong>, not a Director — someone
              who directed every episode is offered as Creator here and keeps Director on the seasons and
              episodes below.
            </p>
            {lookup.people.length === 0 && <p className="meta">Nobody is credited on every episode.</p>}
            <div className="tip-people-list">
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
            <label className={`chip${populateDown ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={populateDown} onChange={(e) => setPopulateDown(e.target.checked)} />
              Populate down: also attach these people to every imported season and episode
            </label>
            <p className="meta">
              Saves running the TMDB import on each season and episode when the show-wide people are all you
              need there. Creators stay on the show only.
            </p>
          </section>

          <section className="tip-section">
            <h3>Genres</h3>
            <p className="meta">Episodes inherit the show's genres.</p>
            <TelevisionGenreChooser selected={selectedGenres} onChange={setSelectedGenres} />
            {unmappedGenres.length > 0 && <p className="tip-warn">Unmapped TMDB genres: {unmappedGenres.join(", ")}</p>}
          </section>

          {lookup.seasons.length > 0 && (
            <section className="tip-section">
              <div className="tip-section-head">
                <h3>
                  Seasons &amp; Episodes ({lookup.seasons.length} season{lookup.seasons.length !== 1 ? "s" : ""}
                  {includeEpisodes && `, ${allEpisodes.length} episodes found, ${episodeCount} selected`})
                </h3>
                {includeEpisodes && (
                  <>
                    <button
                      type="button"
                      onClick={() => setIncludedEpisodes(new Set(allEpisodes.map((e) => epKey(e.season_number, e.episode_number))))}
                    >Check All</button>
                    <button type="button" onClick={() => setIncludedEpisodes(new Set())}>Uncheck All</button>
                  </>
                )}
              </div>
              <p className="meta">
                Each season is created with its episodes (title, runtime, air year), and each episode gets its
                own director and composer automatically. A season with no episodes ticked is skipped.
              </p>
              {lookup.seasons.map((season) => (
                <div key={season.season_number} className="tip-season">
                  <div className="tip-section-head">
                    <h4 style={{ margin: 0 }}>
                      {season.name}{" "}
                      <span className="meta">({season.release_year} · {season.episode_count} episode{season.episode_count !== 1 ? "s" : ""})</span>
                    </h4>
                    {season.episodes.length > 0 && (
                      <>
                        <button type="button" onClick={() => toggleSeason(season.season_number, true)}>All</button>
                        <button type="button" onClick={() => toggleSeason(season.season_number, false)}>None</button>
                      </>
                    )}
                    {canRank && (
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={listedSeasons.has(season.season_number)}
                          onChange={() => toggleListed(season.season_number)}
                        />
                        Add season{season.episodes.length > 0 ? " + its episodes" : ""} to my list
                      </label>
                    )}
                  </div>
                  {season.episodes.map((e) => {
                    const scope = epKey(e.season_number, e.episode_number);
                    const included = includedEpisodes.has(scope);
                    return (
                      <div key={scope} className={`tip-row${included ? " tip-row--checked" : ""}`}>
                        <label className="tip-check">
                          <input type="checkbox" checked={included} onChange={() => toggleEpisode(scope)} />
                        </label>
                        <div className="tip-body">
                          <div className="tip-main">
                            <strong className="tip-name">S{e.season_number}E{e.episode_number} — {e.name}</strong>
                            <span className="tip-desc">{e.release_year} · {e.runtime} min</span>
                          </div>
                          <div className="tip-credits">{autoCrewLabel(e.people)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          )}

          <footer className="tip-footer">
            {canRank && (
              <label className="checkbox-label tip-add-to-list">
                <input type="checkbox" checked={addToList} onChange={(e) => setAddToList(e.target.checked)} />
                Add show to my list
              </label>
            )}
            <button type="button" onClick={onClose} disabled={importing}>Cancel</button>
            <BusyButton type="button" className="tip-primary" busy={importing} busyLabel="Importing…" onClick={handleImport}>
              Import show + {seasonCount} season{seasonCount !== 1 ? "s" : ""} + {episodeCount} episode{episodeCount !== 1 ? "s" : ""}
              {" "}+ {showPeopleCount} show credit{showPeopleCount !== 1 ? "s" : ""}
            </BusyButton>
          </footer>
        </>
      )}
    </div>
  );
}
