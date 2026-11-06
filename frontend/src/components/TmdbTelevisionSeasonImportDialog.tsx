import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useGuildApi, useTmdbTvSeasonImport, useTmdbTvSeasonLookup } from "../api/hooks";
import { rk } from "../api/keys";
import type { CastRole, TelevisionSeason, TelevisionShow, TmdbTvImportPersonIn, TmdbTvSeasonLookup } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckField, Field, Notice } from "./form/FormKit";
import { EpisodeCrewReview, importSummary } from "./import/ImportExtras";
import { ImportCheckRow, ImportDialog, ImportFooter, ImportSection, ImportTitle, plural } from "./import/ImportKit";
import { TmdbPersonRow } from "./import/ImportPersonRow";
import { BusyButton, LoadingState } from "./Spinner";
import { ACTOR_ROLES, autoCrewLabel, parentNote, personIn, seedResolutions, toRow } from "./tmdbTvShared";

/**
 * Per-season TMDB import — the show dialog's review flow, one layer down.
 *
 * Offers everyone credited on at least 80% of the season's episodes. People already on
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
  const [fullCast, setFullCast] = useState(false);
  const [title, setTitle] = useState(show.name);
  const [year, setYear] = useState(String(show.release_year));
  const [seasonNumber, setSeasonNumber] = useState(String(season?.season_number ?? nextNumber));

  const [lookup, setLookup] = useState<TmdbTvSeasonLookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<Record<number, CastRole>>({});
  const [resolutions, setResolutions] = useState<Record<number, number | null>>({});
  const [episodesOn, setEpisodesOn] = useState<Set<number>>(new Set());
  const [populateDown, setPopulateDown] = useState(true);
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
        full_episode_cast: fullCast,
        season: {
          name: s.name,
          name_en: null,
          season_number: s.season_number,
          release_year: s.release_year,
          notes: null,
          overview: s.overview,
          poster_url: s.poster_url,
          people: s.people
            .map((p, i) => (checked.has(i) ? personIn(p, roles[i] ?? p.suggested_role, resolutions) : null))
            .filter((x): x is TmdbTvImportPersonIn => x !== null),
          episodes: s.episodes
            .filter((e) => episodesOn.has(e.episode_number))
            .map((e) => ({
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
          importSummary(s.name, result);
          onSuccess?.(result.season_id);
          onClose();
        },
        onError: (err) => setError(err.message),
      },
    );
  }, [
    lookup, checked, roles, resolutions, episodesOn, populateDown, updateFields, show.id, season, importMut, fullCast,
    onClose, onSuccess, addToList, canRank, base, qc, guildId, userId,
  ]);

  const notFound = lookupMut.isError && !lookup;
  const importing = importMut.isPending || importMut.isSuccess;
  const existingNames = new Set((season?.episodes ?? []).map((e) => e.name.trim().toLowerCase()));

  return (
    <ImportDialog title={`${season ? `Import ${season.name}` : "Import a season"} from TMDB · ${show.name}`} onClose={onClose} error={error} reviewing={!!lookup}>
      <form className="grid items-end gap-3 sm:grid-cols-[1fr_7rem_6rem_auto]" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); runLookup(); }}>
        <Field label="Show title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Year"><Input value={year} onChange={(e) => setYear(e.target.value)} type="number" /></Field>
        <Field label="Season"><Input value={seasonNumber} onChange={(e) => setSeasonNumber(e.target.value)} type="number" min={0} required /></Field>
        <BusyButton type="submit" variant={lookup ? "outline" : "default"} busy={lookupMut.isPending} busyLabel={lookup ? "Reloading…" : "Looking up…"}>
          {lookup ? "Reload" : "Find season"}
        </BusyButton>
      </form>
      {lookupMut.isPending && !lookup && <LoadingState label="Looking up the season on TMDB…" />}
      {notFound && <Notice tone="warning">Couldn't find that season on TMDB. Check the show title, year and season number.</Notice>}
      {!lookup && (
        <div className="-mx-5 flex justify-end border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      )}

      {lookup && (
        <>
          <ImportTitle title={lookup.season.name}
                       facts={`${lookup.season.release_year} · ${plural(lookup.season.episode_count, "episode")}`}
                       ambiguous={lookup.show_ambiguous} />
          {lookup.show_name !== show.name && (
            <Notice tone="warning">TMDB matched "{lookup.show_name}"; importing into "{show.name}".</Notice>
          )}

          <ImportSection
            title="Season cast & crew"
            count={`${checked.size} of ${lookup.season.people.length} selected`}
            onAll={() => setChecked(new Set(lookup.season.people.map((_, i) => i)))}
            onNone={() => setChecked(new Set())}
            hint={`Everyone on at least 80% of this season's ${lookup.season.episodes_counted} episodes. People already on the show are preselected.`}
          >
            {lookup.season.people.length === 0 && <p className="text-sm text-muted-foreground">Nobody is credited on most of this season's episodes.</p>}
            <div className="grid gap-1.5">
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
                      if (next.has(i)) next.delete(i); else next.add(i);
                      return next;
                    })
                  }
                  onRoleChange={(r) => setRoles((prev) => ({ ...prev, [i]: r }))}
                  onResolve={(pid) => setResolutions((prev) => ({ ...prev, [p.tmdb_id]: pid }))}
                />
              ))}
            </div>
            <div className="mt-1 grid gap-2">
              <CheckField checked={populateDown} onChange={setPopulateDown}>
                Populate down: also attach this season's people to every one of its episodes
              </CheckField>
              {season && (
                <CheckField checked={updateFields} onChange={setUpdateFields}>Also overwrite name, number and year from TMDB</CheckField>
              )}
            </div>
          </ImportSection>

          <ImportSection
            title="Episodes"
            count={`${episodesOn.size} of ${lookup.season.episodes.length} selected`}
            onAll={() => setEpisodesOn(new Set(lookup.season.episodes.map((e) => e.episode_number)))}
            onNone={() => setEpisodesOn(new Set())}
            hint="Ticked episodes already in this season (same title) are left as they are; the rest are created with their director and composer."
          >
            <CheckField checked={fullCast} onChange={setFullCast}>
              Import the full cast of every ticked episode
              <span className="block text-xs text-muted-foreground">
                Guest stars and all, including on episodes already here. One TMDB call per episode.
              </span>
            </CheckField>
            <div className="grid gap-1.5">
              {lookup.season.episodes.map((e) => {
                const exists = existingNames.has(e.name.trim().toLowerCase());
                return (
                  <ImportCheckRow
                    key={e.episode_number}
                    checked={episodesOn.has(e.episode_number)}
                    onToggle={() =>
                      setEpisodesOn((prev) => {
                        const next = new Set(prev);
                        if (next.has(e.episode_number)) next.delete(e.episode_number); else next.add(e.episode_number);
                        return next;
                      })
                    }
                    title={`E${e.episode_number} · ${e.name}`}
                    detail={`${e.release_year} · ${e.runtime} min${exists ? " · already in this season" : ""}`}
                    sub={autoCrewLabel(e.people)}
                  />
                );
              })}
            </div>
          </ImportSection>

          <EpisodeCrewReview episodes={lookup.season.episodes.filter((e) => episodesOn.has(e.episode_number))}
                             resolutions={resolutions}
                             onResolve={(id, pid) => setResolutions((prev) => ({ ...prev, [id]: pid }))} />

          <ImportFooter
            addToList={!season && canRank ? { checked: addToList, onChange: setAddToList } : null}
            onCancel={onClose}
            importing={importing}
            onImport={handleImport}
            label={`Import ${plural(checked.size, "credit")}, ${plural(episodesOn.size, "episode")}`}
          />
        </>
      )}
    </ImportDialog>
  );
}
