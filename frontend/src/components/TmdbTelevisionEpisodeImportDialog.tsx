import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useGuildApi, useTmdbTvEpisodeImport, useTmdbTvEpisodeLookup } from "../api/hooks";
import { rk } from "../api/keys";
import type {
  CastRole, TelevisionEpisode, TelevisionSeason, TelevisionShow, TmdbTvEpisodeLookup, TmdbTvImportPersonIn,
} from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { BusyButton, LoadingState } from "./Spinner";
import { TmdbPersonRow } from "./TmdbPersonRow";
import { ACTOR_ROLES, parentNote, personIn, seedResolutions, toRow } from "./tmdbTvShared";

/**
 * Per-episode TMDB import — the episode's entire cast, guest stars and crew,
 * the way a movie import shows them. People already on the season come
 * preselected (and say so); the rest are opt-in.
 *
 * With `episode` it merges into that existing row (the show/season import
 * creates episodes with only title/runtime/year + director/composer, so this is
 * how they get cast); without it, it appends a new episode to the season.
 *
 * Our episodes don't store their episode number, so the lookup finds the
 * episode by title within the season and the S/E inputs are a manual override.
 */
export function TmdbTelevisionEpisodeImportDialog({
  show,
  season,
  episode,
  onClose,
  onSuccess,
}: {
  show: TelevisionShow;
  season: TelevisionSeason;
  episode?: TelevisionEpisode;
  onClose: () => void;
  onSuccess?: (episodeId: number) => void;
}) {
  const [title, setTitle] = useState(show.name);
  const [year, setYear] = useState(String(show.release_year));
  const [episodeName, setEpisodeName] = useState(episode?.name ?? "");
  const [seasonNumber, setSeasonNumber] = useState(season.season_number != null ? String(season.season_number) : "");
  const [epNumber, setEpNumber] = useState("");

  const [lookup, setLookup] = useState<TmdbTvEpisodeLookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<Record<number, CastRole>>({});
  const [resolutions, setResolutions] = useState<Record<number, number | null>>({});
  const [inheritSeasonPeople, setInheritSeasonPeople] = useState(false);
  const [updateFields, setUpdateFields] = useState(false);
  const [addToList, setAddToList] = useState(true);

  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const lookupMut = useTmdbTvEpisodeLookup();
  const importMut = useTmdbTvEpisodeImport();

  const runLookup = useCallback(() => {
    setError(null);
    lookupMut.mutate(
      {
        season_id: season.id,
        tmdb_show_id: lookup?.tmdb_show_id ?? null,
        title: title.trim() || null,
        year: year ? parseInt(year, 10) : null,
        season_number: seasonNumber ? parseInt(seasonNumber, 10) : null,
        episode_number: epNumber ? parseInt(epNumber, 10) : null,
        episode_name: episodeName.trim() || null,
      },
      {
        onSuccess(data) {
          setLookup(data);
          setSeasonNumber(String(data.episode.season_number));
          setEpNumber(String(data.episode.episode_number));
          const people = data.episode.people;
          setChecked(new Set(people.flatMap((p, i) => (p.parent_roles.length > 0 ? [i] : []))));
          setRoles(Object.fromEntries(people.map((p, i) => [i, p.suggested_role])));
          const res: Record<number, number | null> = {};
          seedResolutions(people, res);
          setResolutions(res);
        },
        onError: (e) => setError(e.message),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, year, seasonNumber, epNumber, episodeName, lookupMut, season.id]);

  // Opened from an episode row/page: we already know what to look for.
  useEffect(() => {
    if (episode) runLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImport = useCallback(() => {
    if (!lookup) return;
    const e = lookup.episode;
    const people = e.people
      .map((p, i) => (checked.has(i) ? personIn(p, roles[i] ?? p.suggested_role, resolutions) : null))
      .filter((x): x is TmdbTvImportPersonIn => x !== null);

    importMut.mutate(
      {
        season_id: season.id,
        episode_id: episode?.id ?? null,
        update_episode_fields: episode ? updateFields : false,
        episode: {
          name: e.name,
          name_en: null,
          runtime_minutes: e.runtime,
          release_year: e.release_year,
          notes: null,
          people,
          inherit_parent_people: inheritSeasonPeople,
          genre_ids: null, // inherit the show's genres
        },
      },
      {
        async onSuccess(result) {
          if (!episode && addToList && canRank) {
            await api.put(`${base}/television/episodes/${result.episode_id}/entry`, {});
            qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "seasons", season.id, "episodes") });
          }
          onSuccess?.(result.episode_id);
          onClose();
        },
        onError: (err) => setError(err.message),
      },
    );
  }, [
    lookup, checked, roles, resolutions, inheritSeasonPeople, updateFields, season.id, episode, importMut, onClose,
    onSuccess, addToList, canRank, base, qc, guildId, userId,
  ]);

  const notFound = lookupMut.isError && !lookup;
  const importing = importMut.isPending || importMut.isSuccess;

  return (
    <div className="modal tmdb-import-panel">
      <h2>
        {episode ? "Import Episode Credits from TMDB" : "Import Episode from TMDB"}
        <span style={{ opacity: 0.6, fontWeight: "normal" }}> — {show.name} · {season.name}</span>
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
          Episode title
          <input value={episodeName} onChange={(e) => setEpisodeName(e.target.value)} placeholder="matched against TMDB" />
        </label>
        <label>
          Season
          <input value={seasonNumber} onChange={(e) => setSeasonNumber(e.target.value)} type="number" min={0} placeholder="auto" />
        </label>
        <label>
          Episode #
          <input value={epNumber} onChange={(e) => setEpNumber(e.target.value)} type="number" min={1} placeholder="auto" />
        </label>
        <BusyButton type="submit" busy={lookupMut.isPending} busyLabel={lookup ? "Reloading…" : "Looking up…"}>{lookup ? "Reload" : "Find episode"}</BusyButton>
        {!lookup && <button type="button" onClick={onClose}>Cancel</button>}
      </form>
      {lookupMut.isPending && !lookup && <LoadingState label="Looking up the episode on TMDB…" />}
      {notFound && (
        <p className="tip-warn">
          Couldn't find that episode by title — enter its season and episode number above.
        </p>
      )}

      {lookup && (
        <>
          <div className="tip-movie-header">
            <h3>
              S{lookup.episode.season_number}E{lookup.episode.episode_number} — {lookup.episode.name}
              <span className="tip-runtime"> — {lookup.episode.release_year} · {lookup.episode.runtime} min</span>
            </h3>
            {lookup.show_ambiguous && <span className="tip-warn">⚠ Multiple show matches — used most popular</span>}
          </div>
          {lookup.show_name !== show.name && (
            <p className="tip-warn">TMDB matched "{lookup.show_name}" — importing into "{show.name}".</p>
          )}

          <section className="tip-section">
            <div className="tip-section-head">
              <h3>This episode's cast &amp; crew ({lookup.episode.people.length} total, {checked.size} selected)</h3>
              <button type="button" onClick={() => setChecked(new Set(lookup.episode.people.map((_, i) => i)))}>Check All</button>
              <button type="button" onClick={() => setChecked(new Set())}>Uncheck All</button>
            </div>
            <p className="meta">The episode's full cast, guest stars and crew. People already on the season are preselected.</p>
            <div className="tip-people-list">
              {lookup.episode.people.map((p, i) => (
                <TmdbPersonRow
                  key={`${p.tmdb_id}-${i}`}
                  person={toRow(p)}
                  groupName={String(i)}
                  checked={checked.has(i)}
                  role={roles[i] ?? p.suggested_role}
                  resolution={resolutions[p.tmdb_id]}
                  roleOptions={ACTOR_ROLES}
                  note={parentNote(p, "season")}
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
          </section>

          <section className="tip-section">
            <label className={`chip${inheritSeasonPeople ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={inheritSeasonPeople} onChange={(e) => setInheritSeasonPeople(e.target.checked)} />
              Also attach all of the season's people
            </label>
            {episode && (
              <label className={`chip${updateFields ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={updateFields} onChange={(e) => setUpdateFields(e.target.checked)} />
                Also overwrite title / runtime / year from TMDB
              </label>
            )}
            <p className="meta">
              Credits already on this episode are kept; only missing ones are added.
              Genres come from the show.
            </p>
          </section>

          <footer className="tip-footer">
            {!episode && canRank && (
              <label className="checkbox-label tip-add-to-list">
                <input type="checkbox" checked={addToList} onChange={(e) => setAddToList(e.target.checked)} />
                Add to my list
              </label>
            )}
            <button type="button" onClick={onClose} disabled={importing}>Cancel</button>
            <BusyButton type="button" className="tip-primary" busy={importing} busyLabel="Importing…" onClick={handleImport}>
              Import {checked.size} credit{checked.size !== 1 ? "s" : ""}
            </BusyButton>
          </footer>
        </>
      )}
    </div>
  );
}
