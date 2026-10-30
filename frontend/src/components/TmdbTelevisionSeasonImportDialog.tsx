import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useGuildApi, useTmdbTvSeasonImport, useTmdbTvSeasonLookup } from "../api/hooks";
import { rk } from "../api/keys";
import type { CastRole, TelevisionSeason, TelevisionShow, TmdbTvImportPersonIn, TmdbTvSeasonLookup } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { BusyButton, LoadingState } from "./Spinner";
import { TmdbPersonRow } from "./TmdbPersonRow";
import { ACTOR_ROLES, autoCrewLabel, parentNote, personIn, seedResolutions, toRow } from "./tmdbTvShared";

/**
 * Per-season TMDB import — the show dialog's review flow, one layer down.
 *
 * Offers everyone credited on every episode of the season. People already on
 * the show come preselected (and say so); the rest are opt-in. With `season`
 * it merges into that existing season; without, it adds a new season to the
 * show. Either way the ticked episodes are made to exist in the season — ones
 * already there (same title) are left alone.
 */
export function TmdbTelevisionSeasonImportDialog({
  show,
  season,
  onClose,
  onSuccess,
}: {
  show: TelevisionShow;
  season?: TelevisionSeason;
  onClose: () => void;
  onSuccess?: (seasonId: number) => void;
}) {
  const nextNumber = Math.max(0, ...show.seasons.map((s) => s.season_number ?? 0)) + 1;
  const [title, setTitle] = useState(show.name);
  const [year, setYear] = useState(String(show.release_year));
  const [seasonNumber, setSeasonNumber] = useState(String(season?.season_number ?? nextNumber));

  const [lookup, setLookup] = useState<TmdbTvSeasonLookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<Record<number, CastRole>>({});
  const [resolutions, setResolutions] = useState<Record<number, number | null>>({});
  const [episodesOn, setEpisodesOn] = useState<Set<number>>(new Set());
  const [populateDown, setPopulateDown] = useState(false);
  const [updateFields, setUpdateFields] = useState(false);
  const [addToList, setAddToList] = useState(true);

  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const lookupMut = useTmdbTvSeasonLookup();
  const importMut = useTmdbTvSeasonImport();

  const runLookup = useCallback(() => {
    setError(null);
    lookupMut.mutate(
      {
        show_id: show.id,
        tmdb_show_id: lookup?.tmdb_show_id ?? null,
        title: title.trim() || null,
        year: year ? parseInt(year, 10) : null,
        season_number: parseInt(seasonNumber || "1", 10),
      },
      {
        onSuccess(data) {
          setLookup(data);
          const people = data.season.people;
          setChecked(new Set(people.flatMap((p, i) => (p.parent_roles.length > 0 ? [i] : []))));
          setRoles(Object.fromEntries(people.map((p, i) => [i, p.suggested_role])));
          const res: Record<number, number | null> = {};
          seedResolutions(people, res);
          for (const e of data.season.episodes) seedResolutions(e.people, res);
          setResolutions(res);
          setEpisodesOn(new Set(data.season.episodes.map((e) => e.episode_number)));
        },
        onError: (e) => setError(e.message),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, year, seasonNumber, lookupMut, show.id]);

  // Opened from an existing season that knows its TMDB number: look it up straight away.
  useEffect(() => {
    if (season?.season_number != null) runLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImport = useCallback(() => {
    if (!lookup) return;
    const s = lookup.season;
    importMut.mutate(
      {
        show_id: show.id,
        season_id: season?.id ?? null,
        update_season_fields: season ? updateFields : false,
        populate_down: populateDown,
        season: {
          name: s.name,
          name_en: null,
          season_number: s.season_number,
          release_year: s.release_year,
          notes: null,
          people: s.people
            .map((p, i) => (checked.has(i) ? personIn(p, roles[i] ?? p.suggested_role, resolutions) : null))
            .filter((x): x is TmdbTvImportPersonIn => x !== null),
          episodes: s.episodes
            .filter((e) => episodesOn.has(e.episode_number))
            .map((e) => ({
              name: e.name,
              name_en: null,
              runtime_minutes: e.runtime,
              release_year: e.release_year,
              notes: null,
              people: e.people.map((p) => personIn(p, p.suggested_role, resolutions)), // director/composer
              inherit_parent_people: false,
              genre_ids: null,
            })),
        },
      },
      {
        async onSuccess(result) {
          if (!season && addToList && canRank) {
            await api.put(`${base}/television/seasons/${result.season_id}/entry`, {});
            qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "shows", show.id, "seasons") });
          }
          onSuccess?.(result.season_id);
          onClose();
        },
        onError: (err) => setError(err.message),
      },
    );
  }, [
    lookup, checked, roles, resolutions, episodesOn, populateDown, updateFields, show.id, season, importMut,
    onClose, onSuccess, addToList, canRank, base, qc, guildId, userId,
  ]);

  const notFound = lookupMut.isError && !lookup;
  const importing = importMut.isPending || importMut.isSuccess;
  const existingNames = new Set((season?.episodes ?? []).map((e) => e.name.trim().toLowerCase()));

  return (
    <div className="modal tmdb-import-panel">
      <h2>
        {season ? `Import ${season.name} from TMDB` : "Import Season from TMDB"}
        <span style={{ opacity: 0.6, fontWeight: "normal" }}> — {show.name}</span>
      </h2>
      {error && <p className="tip-error">{error}</p>}

      <form className="tip-search" onSubmit={(e) => { e.preventDefault(); runLookup(); }}>
        <label>
          Show title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Year
          <input value={year} onChange={(e) => setYear(e.target.value)} type="number" />
        </label>
        <label>
          Season #
          <input value={seasonNumber} onChange={(e) => setSeasonNumber(e.target.value)} type="number" min={0} required />
        </label>
        <BusyButton type="submit" busy={lookupMut.isPending} busyLabel={lookup ? "Reloading…" : "Looking up…"}>{lookup ? "Reload" : "Find season"}</BusyButton>
        {!lookup && <button type="button" onClick={onClose}>Cancel</button>}
      </form>
      {lookupMut.isPending && !lookup && <LoadingState label="Looking up the season on TMDB…" />}
      {notFound && <p className="tip-warn">Couldn't find that season on TMDB — check the show title, year and season number.</p>}

      {lookup && (
        <>
          <div className="tip-movie-header">
            <h3>
              {lookup.season.name}
              <span className="tip-runtime"> — {lookup.season.release_year} · {lookup.season.episode_count} episodes</span>
            </h3>
            {lookup.show_ambiguous && <span className="tip-warn">⚠ Multiple show matches — used most popular</span>}
          </div>
          {lookup.show_name !== show.name && (
            <p className="tip-warn">TMDB matched "{lookup.show_name}" — importing into "{show.name}".</p>
          )}

          <section className="tip-section">
            <div className="tip-section-head">
              <h3>Season Cast &amp; Crew ({lookup.season.people.length} shown, {checked.size} selected)</h3>
              <button type="button" onClick={() => setChecked(new Set(lookup.season.people.map((_, i) => i)))}>Check All</button>
              <button type="button" onClick={() => setChecked(new Set())}>Uncheck All</button>
            </div>
            <p className="meta">
              Everyone credited on all {lookup.season.episodes_counted} episodes of this season. People already
              on the show are preselected.
            </p>
            {lookup.season.people.length === 0 && <p className="meta">Nobody is credited on every episode of this season.</p>}
            <div className="tip-people-list">
              {lookup.season.people.map((p, i) => (
                <TmdbPersonRow
                  key={`${p.tmdb_id}-${p.suggested_role}-${i}`}
                  person={toRow(p)}
                  groupName={`season-${i}`}
                  checked={checked.has(i)}
                  role={roles[i] ?? p.suggested_role}
                  resolution={resolutions[p.tmdb_id]}
                  roleOptions={ACTOR_ROLES}
                  note={parentNote(p, "show")}
                  onToggle={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      next.has(i) ? next.delete(i) : next.add(i);
                      return next;
                    })
                  }
                  onRoleChange={(r) => setRoles((prev) => ({ ...prev, [i]: r }))}
                  onResolve={(pid) => setResolutions((prev) => ({ ...prev, [p.tmdb_id]: pid }))}
                />
              ))}
            </div>
            <label className={`chip${populateDown ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={populateDown} onChange={(e) => setPopulateDown(e.target.checked)} />
              Populate down: also attach this season's people to every one of its episodes
            </label>
            {season && (
              <label className={`chip${updateFields ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={updateFields} onChange={(e) => setUpdateFields(e.target.checked)} />
                Also overwrite name / number / year from TMDB
              </label>
            )}
          </section>

          <section className="tip-section">
            <div className="tip-section-head">
              <h3>Episodes ({lookup.season.episodes.length} found, {episodesOn.size} selected)</h3>
              <button type="button" onClick={() => setEpisodesOn(new Set(lookup.season.episodes.map((e) => e.episode_number)))}>Check All</button>
              <button type="button" onClick={() => setEpisodesOn(new Set())}>Uncheck All</button>
            </div>
            <p className="meta">
              Ticked episodes already in this season (same title) are left as they are; the rest are created
              with their director and composer.
            </p>
            {lookup.season.episodes.map((e) => {
              const on = episodesOn.has(e.episode_number);
              const exists = existingNames.has(e.name.trim().toLowerCase());
              return (
                <div key={e.episode_number} className={`tip-row${on ? " tip-row--checked" : ""}`}>
                  <label className="tip-check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setEpisodesOn((prev) => {
                          const next = new Set(prev);
                          next.has(e.episode_number) ? next.delete(e.episode_number) : next.add(e.episode_number);
                          return next;
                        })
                      }
                    />
                  </label>
                  <div className="tip-body">
                    <div className="tip-main">
                      <strong className="tip-name">E{e.episode_number} — {e.name}</strong>
                      <span className="tip-desc">{e.release_year} · {e.runtime} min{exists ? " · already in this season" : ""}</span>
                    </div>
                    <div className="tip-credits">{autoCrewLabel(e.people)}</div>
                  </div>
                </div>
              );
            })}
          </section>

          <footer className="tip-footer">
            {!season && canRank && (
              <label className="checkbox-label tip-add-to-list">
                <input type="checkbox" checked={addToList} onChange={(e) => setAddToList(e.target.checked)} />
                Add to my list
              </label>
            )}
            <button type="button" onClick={onClose} disabled={importing}>Cancel</button>
            <BusyButton type="button" className="tip-primary" busy={importing} busyLabel="Importing…" onClick={handleImport}>
              Import {checked.size} credit{checked.size !== 1 ? "s" : ""} + {episodesOn.size} episode{episodesOn.size !== 1 ? "s" : ""}
            </BusyButton>
          </footer>
        </>
      )}
    </div>
  );
}
