import { useCallback, useEffect, useState } from "react";
import { useTmdbTvEpisodeImport, useTmdbTvEpisodeLookup } from "../api/hooks";
import type {
  CastRole, TelevisionEpisode, TelevisionShow, TmdbTvEpisodeLookup, TmdbTvImportPersonIn, TmdbTvPerson,
} from "../api/types";
import { TmdbPersonRow, tmdbCreditDescription, type TmdbRowPerson } from "./TmdbPersonRow";

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
      artist_summary: m.artist_summary,
      game_summary: m.game_summary,
    })),
  };
}

/**
 * Per-episode TMDB import — the same review flow as the show dialog, scoped to
 * one episode's own cast and crew.
 *
 * With `episode` it merges into that existing row (the show-level import
 * creates episodes with only title/runtime/year + director/composer, so this is
 * how they get cast); without it, it appends a new episode to the show.
 *
 * Our episodes don't store season/episode numbers, so the lookup finds the
 * episode by title and the S/E inputs are only a manual override.
 */
export function TmdbTelevisionEpisodeImportDialog({
  show,
  episode,
  onClose,
  onSuccess,
}: {
  show: TelevisionShow;
  episode?: TelevisionEpisode;
  onClose: () => void;
  onSuccess?: (episodeId: number) => void;
}) {
  const [title, setTitle] = useState(show.name);
  const [year, setYear] = useState(String(show.release_year));
  const [episodeName, setEpisodeName] = useState(episode?.name ?? "");
  const [season, setSeason] = useState("");
  const [epNumber, setEpNumber] = useState("");

  const [lookup, setLookup] = useState<TmdbTvEpisodeLookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<Record<number, CastRole>>({});
  const [resolutions, setResolutions] = useState<Record<number, number | null>>({});
  const [inheritShowPeople, setInheritShowPeople] = useState(false);
  const [updateFields, setUpdateFields] = useState(false);
  const [watches, setWatches] = useState(String(episode?.watches ?? 1));

  const lookupMut = useTmdbTvEpisodeLookup();
  const importMut = useTmdbTvEpisodeImport();

  const runLookup = useCallback(() => {
    setError(null);
    lookupMut.mutate(
      {
        tmdb_show_id: lookup?.tmdb_show_id ?? null,
        title: title.trim() || null,
        year: year ? parseInt(year, 10) : null,
        season_number: season ? parseInt(season, 10) : null,
        episode_number: epNumber ? parseInt(epNumber, 10) : null,
        episode_name: episodeName.trim() || null,
      },
      {
        onSuccess(data) {
          setLookup(data);
          setSeason(String(data.episode.season_number));
          setEpNumber(String(data.episode.episode_number));
          const c = new Set<number>();
          const r: Record<number, CastRole> = {};
          const res: Record<number, number | null> = {};
          data.episode.people.forEach((p, i) => {
            c.add(i);
            r[i] = p.suggested_role;
            const v = p.db_matches.find((m) => m.has_screen_entries);
            if (v) res[p.tmdb_id] = v.person_id;
          });
          setChecked(c);
          setRoles(r);
          setResolutions(res);
        },
        onError: (e) => setError(e.message),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, year, season, epNumber, episodeName, lookupMut]);

  // Opened from an episode row/page: we already know what to look for.
  useEffect(() => {
    if (episode) runLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImport = useCallback(() => {
    if (!lookup) return;
    const e = lookup.episode;
    const people: TmdbTvImportPersonIn[] = e.people
      .map((p, i): TmdbTvImportPersonIn | null => {
        if (!checked.has(i)) return null;
        return {
          tmdb_id: p.tmdb_id,
          name: p.name,
          role: roles[i] ?? p.suggested_role,
          nationality: p.nationality_guess,
          existing_person_id: resolutions[p.tmdb_id] ?? null,
        };
      })
      .filter((x): x is TmdbTvImportPersonIn => x !== null);

    importMut.mutate(
      {
        show_id: show.id,
        episode_id: episode?.id ?? null,
        update_episode_fields: episode ? updateFields : false,
        episode: {
          name: e.name,
          name_en: null,
          runtime_minutes: e.runtime,
          release_year: e.release_year,
          watches: Math.max(1, parseInt(watches || "1", 10)),
          watch_link: null,
          notes: null,
          people,
          inherit_show_people: inheritShowPeople,
          genre_ids: null, // inherit the show's genres
        },
      },
      {
        onSuccess(result) {
          onSuccess?.(result.episode_id);
          onClose();
        },
        onError: (err) => setError(err.message),
      },
    );
  }, [lookup, checked, roles, resolutions, inheritShowPeople, updateFields, watches, show.id, episode, importMut, onClose, onSuccess]);

  const notFound = lookupMut.isError && !lookup;

  return (
    <div className="modal tmdb-import-panel">
      <h2>
        {episode ? "Import Episode Credits from TMDB" : "Import Episode from TMDB"}
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
          Episode title
          <input value={episodeName} onChange={(e) => setEpisodeName(e.target.value)} placeholder="matched against TMDB" />
        </label>
        <label>
          Season
          <input value={season} onChange={(e) => setSeason(e.target.value)} type="number" min={0} placeholder="auto" />
        </label>
        <label>
          Episode #
          <input value={epNumber} onChange={(e) => setEpNumber(e.target.value)} type="number" min={1} placeholder="auto" />
        </label>
        <button type="submit" disabled={lookupMut.isPending}>
          {lookupMut.isPending ? "Loading…" : lookup ? "Reload" : "Find episode"}
        </button>
        {!lookup && <button type="button" onClick={onClose}>Cancel</button>}
      </form>
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
            <label className={`chip${inheritShowPeople ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={inheritShowPeople} onChange={(e) => setInheritShowPeople(e.target.checked)} />
              Also inherit the show's people (creator excluded)
            </label>
            {episode ? (
              <label className={`chip${updateFields ? " chip-active" : ""}`} style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={updateFields} onChange={(e) => setUpdateFields(e.target.checked)} />
                Also overwrite title / runtime / year from TMDB
              </label>
            ) : (
              <label>
                Watches
                <input type="number" min={1} value={watches} onChange={(e) => setWatches(e.target.value)} />
              </label>
            )}
            <p className="meta">
              Credits already on this episode are kept; only missing ones are added.
              Genres come from the show.
            </p>
          </section>

          <footer className="tip-footer">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className="tip-primary" disabled={importMut.isPending} onClick={handleImport}>
              {importMut.isPending ? "Importing…" : `Import ${checked.size} credit${checked.size !== 1 ? "s" : ""}`}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
