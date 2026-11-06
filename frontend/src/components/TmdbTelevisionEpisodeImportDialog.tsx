import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useGuildApi, useTmdbTvEpisodeImport, useTmdbTvEpisodeLookup } from "../api/hooks";
import { rk } from "../api/keys";
import type {
  CastRole, TelevisionEpisode, TelevisionSeason, TelevisionShow, TmdbTvEpisodeLookup, TmdbTvImportPersonIn,
} from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckField, Field, Notice } from "./form/FormKit";
import { importSummary } from "./import/ImportExtras";
import { ImportDialog, ImportFooter, ImportSection, ImportTitle, plural } from "./import/ImportKit";
import { TmdbPersonRow } from "./import/ImportPersonRow";
import { BusyButton, LoadingState } from "./Spinner";
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
 * The lookup uses the episode's stored number when it has one, otherwise it
 * finds the episode by title within the season; the S/E inputs override both.
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
  const [epNumber, setEpNumber] = useState(episode?.episode_number != null ? String(episode.episode_number) : "");

  const [lookup, setLookup] = useState<TmdbTvEpisodeLookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<Record<number, CastRole>>({});
  const [resolutions, setResolutions] = useState<Record<number, number | null>>({});
  const [inheritSeasonPeople, setInheritSeasonPeople] = useState(true);
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
          episode_number: e.episode_number,
          overview: e.overview,
          still_url: e.still_url,
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
          importSummary(lookup.episode.name, result);
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
    <ImportDialog title={`${episode ? "Import episode credits" : "Import an episode"} from TMDB · ${show.name}, ${season.name}`}
                  onClose={onClose} error={error} reviewing={!!lookup}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); runLookup(); }}>
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <Field label="Show title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Year"><Input value={year} onChange={(e) => setYear(e.target.value)} type="number" /></Field>
        </div>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_6rem_6rem_auto]">
          <Field label="Episode title">
            <Input value={episodeName} onChange={(e) => setEpisodeName(e.target.value)} placeholder="Matched against TMDB" />
          </Field>
          <Field label="Season"><Input value={seasonNumber} onChange={(e) => setSeasonNumber(e.target.value)} type="number" min={0} placeholder="auto" /></Field>
          <Field label="Episode"><Input value={epNumber} onChange={(e) => setEpNumber(e.target.value)} type="number" min={1} placeholder="auto" /></Field>
          <BusyButton type="submit" variant={lookup ? "outline" : "default"} busy={lookupMut.isPending} busyLabel={lookup ? "Reloading…" : "Looking up…"}>
            {lookup ? "Reload" : "Find episode"}
          </BusyButton>
        </div>
      </form>
      {lookupMut.isPending && !lookup && <LoadingState label="Looking up the episode on TMDB…" />}
      {notFound && <Notice tone="warning">Couldn't find that episode by title. Enter its season and episode number.</Notice>}
      {!lookup && (
        <div className="-mx-5 flex justify-end border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      )}

      {lookup && (
        <>
          <ImportTitle title={`S${lookup.episode.season_number}E${lookup.episode.episode_number} · ${lookup.episode.name}`}
                       facts={`${lookup.episode.release_year} · ${lookup.episode.runtime} min`}
                       ambiguous={lookup.show_ambiguous} />
          {lookup.show_name !== show.name && (
            <Notice tone="warning">TMDB matched "{lookup.show_name}"; importing into "{show.name}".</Notice>
          )}

          <ImportSection
            title="This episode's cast & crew"
            count={`${checked.size} of ${lookup.episode.people.length} selected`}
            onAll={() => setChecked(new Set(lookup.episode.people.map((_, i) => i)))}
            onNone={() => setChecked(new Set())}
            hint="The full cast, guest stars and crew. People already on the season are preselected. Credits already on the episode are kept."
          >
            <div className="grid gap-1.5">
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
              <CheckField checked={inheritSeasonPeople} onChange={setInheritSeasonPeople}>Also attach all of the season's people</CheckField>
              {episode && (
                <CheckField checked={updateFields} onChange={setUpdateFields}>Also overwrite title, runtime and year from TMDB</CheckField>
              )}
            </div>
          </ImportSection>

          <ImportFooter
            addToList={!episode && canRank ? { checked: addToList, onChange: setAddToList } : null}
            onCancel={onClose}
            importing={importing}
            onImport={handleImport}
            label={`Import ${plural(checked.size, "credit")}`}
          />
        </>
      )}
    </ImportDialog>
  );
}
