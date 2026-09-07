import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client";
import { useGuildApi, useTmdbTvImport, useTmdbTvLookup } from "../api/hooks";
import { rk } from "../api/keys";
import type {
  CastRole, TmdbTvEpisode, TmdbTvImportEpisodeIn, TmdbTvImportPersonIn, TmdbTvLookup, TmdbTvPerson,
} from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { BusyButton } from "./Spinner";
import { TelevisionGenreChooser } from "./TelevisionGenreChooser";
import { TmdbPersonRow, tmdbCreditDescription, type TmdbRowPerson } from "./TmdbPersonRow";

const epKey = (s: number, e: number) => `s${s}e${e}`;
const ACTOR_ROLES: CastRole[] = ["lead_actor", "actor", "cameo_actor"];

function toRow(p: TmdbTvPerson): TmdbRowPerson {
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

function seedResolutions(people: TmdbTvPerson[], into: Record<number, number | null>) {
  for (const p of people) {
    if (p.tmdb_id in into) continue;
    const v = p.db_matches.find((m) => m.filmography_overlap);
    if (v) into[p.tmdb_id] = v.person_id;
  }
}

/** The show step attaches each episode's director/composer automatically, so
 *  these rows only need an include checkbox — the cast of an episode is chosen
 *  in that episode's own import. */
function autoCrewLabel(e: TmdbTvEpisode): string {
  const by = (role: CastRole) => e.people.filter((p) => p.suggested_role === role).map((p) => p.name);
  const bits: string[] = [];
  const dirs = by("director");
  const comps = by("composer");
  if (dirs.length) bits.push(`Dir: ${dirs.join(", ")}`);
  if (comps.length) bits.push(`Comp: ${comps.join(", ")}`);
  return bits.join(" · ") || "no director/composer credited";
}

type PeopleState = { checked: Set<string>; roles: Record<string, CastRole> };

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
  // Percent in the UI, share on the wire. Crew credited on fewer than this
  // many of the show's episodes are left to the per-episode step.
  const [crewThreshold, setCrewThreshold] = useState("50");

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
  const [addToList, setAddToList] = useState(true);

  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const lookupMut = useTmdbTvLookup();
  const importMut = useTmdbTvImport();

  const allEpisodes = useMemo(() => (lookup?.seasons ?? []).flatMap((s) => s.episodes), [lookup]);

  const handleSearch = useCallback(() => {
    setError(null);
    const pct = Math.min(100, Math.max(0, parseFloat(crewThreshold || "50")));
    lookupMut.mutate(
      {
        title: title.trim(),
        year: year ? parseInt(year, 10) : undefined,
        include_episodes: includeEpisodes,
        include_specials: includeSpecials,
        crew_episode_threshold: pct / 100,
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
  }, [title, year, includeEpisodes, includeSpecials, crewThreshold, lookupMut]);

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

  function autoPeopleIn(e: TmdbTvEpisode): TmdbTvImportPersonIn[] {
    return e.people.map((p) => ({
      tmdb_id: p.tmdb_id,
      name: p.name,
      role: p.suggested_role, // director/composer — always automatic
      nationality: p.nationality_guess,
      existing_person_id: resolutions[p.tmdb_id] ?? null,
    }));
  }

  const showPeopleCount = useMemo(
    () => (lookup?.people ?? []).filter((_, i) => people.checked.has(`show:${i}`)).length,
    [lookup, people],
  );
  const episodeCount = includedEpisodes.size;

  const handleImport = useCallback(() => {
    if (!lookup) return;
    const episodes: TmdbTvImportEpisodeIn[] = [];
    for (const season of lookup.seasons) {
      for (const e of season.episodes) {
        const scope = epKey(e.season_number, e.episode_number);
        if (!includedEpisodes.has(scope)) continue;
        episodes.push({
          name: e.name,
          name_en: null,
          runtime_minutes: e.runtime,
          release_year: e.release_year,
          notes: null,
          people: autoPeopleIn(e),
          inherit_show_people: false, // cast is chosen per episode
          genre_ids: null,            // inherit the show's genres
        });
      }
    }
    const peopleIn = (list: TmdbTvPerson[]): TmdbTvImportPersonIn[] =>
      list
        .map((p, i): TmdbTvImportPersonIn | null => {
          const k = `show:${i}`;
          if (!people.checked.has(k)) return null;
          return {
            tmdb_id: p.tmdb_id,
            name: p.name,
            role: people.roles[k] ?? p.suggested_role,
            nationality: p.nationality_guess,
            existing_person_id: resolutions[p.tmdb_id] ?? null,
          };
        })
        .filter((x): x is TmdbTvImportPersonIn => x !== null);

    importMut.mutate(
      {
        name: lookup.name,
        name_en: null,
        release_year: lookup.release_year,
        notes: null,
        people: peopleIn(lookup.people),
        genre_ids: [...selectedGenres],
        episodes,
      },
      {
        async onSuccess(result) {
          if (addToList && canRank) {
            await api.put(`${base}/television/shows/${result.show_id}/entry`, {});
            qc.invalidateQueries({ queryKey: rk(guildId, userId, "television") });
          }
          onSuccess?.(result.show_id);
          onClose();
        },
        onError: (e) => setError(e.message),
      },
    );
  }, [
    lookup, includedEpisodes, people, resolutions, selectedGenres, importMut, onClose, onSuccess,
    addToList, canRank, base, qc, guildId, userId,
  ]);

  const unmappedGenres = useMemo(
    () => (lookup?.genres ?? []).filter((g) => !g.db_genre_id).map((g) => g.tmdb_name),
    [lookup],
  );

  const importing = importMut.isPending || importMut.isSuccess;

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
          <label>
            Crew episode threshold (%)
            <input value={crewThreshold} onChange={(e) => setCrewThreshold(e.target.value)} type="number" min={0} max={100} />
          </label>
          <p className="meta">
            TMDB's show credits are an aggregate of every episode. Cast and crew credited on
            fewer than this share of episodes are left to the per-episode step;
            creators and composers are always offered at show level.
          </p>
          <label className={`chip${includeEpisodes ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={includeEpisodes} onChange={(e) => setIncludeEpisodes(e.target.checked)} />
            Fetch episodes
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
              The show's own cast, plus creators, composers, and crew on ≥{" "}
              {(lookup.crew_episode_threshold * 100).toFixed(0)}% of episodes. A show is
              credited with a <strong>Creator</strong>, not a Director — per-episode
              directors live on their episodes.
            </p>
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
                <h3>Episodes ({allEpisodes.length} found, {episodeCount} selected)</h3>
                <button
                  type="button"
                  onClick={() => setIncludedEpisodes(new Set(allEpisodes.map((e) => epKey(e.season_number, e.episode_number))))}
                >Check All</button>
                <button type="button" onClick={() => setIncludedEpisodes(new Set())}>Uncheck All</button>
              </div>
              <p className="meta">
                Episodes are created with their title, runtime and air year, plus their
                director and composer (always automatic). Their cast is imported
                per-episode — every episode gets an Import button on the show page.
              </p>
              {lookup.seasons.map((season) => (
                <div key={season.season_number} className="tip-season">
                  <div className="tip-section-head">
                    <h4 style={{ margin: 0 }}>
                      {season.name}{" "}
                      <span className="meta">({season.episodes.length} episode{season.episodes.length !== 1 ? "s" : ""})</span>
                    </h4>
                    <button type="button" onClick={() => toggleSeason(season.season_number, true)}>All</button>
                    <button type="button" onClick={() => toggleSeason(season.season_number, false)}>None</button>
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
                          <div className="tip-credits">{autoCrewLabel(e)}</div>
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
                Add to my list
              </label>
            )}
            <button type="button" onClick={onClose} disabled={importing}>Cancel</button>
            <BusyButton type="button" className="tip-primary" busy={importing} busyLabel="Importing…" onClick={handleImport}>
              Import show + {episodeCount} episode{episodeCount !== 1 ? "s" : ""} + {showPeopleCount} show credits
            </BusyButton>
          </footer>
        </>
      )}
    </div>
  );
}
