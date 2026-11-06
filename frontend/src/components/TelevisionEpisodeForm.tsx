import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Batch } from "../api/client";
import { useGuildApi } from "../api/hooks";
import type { CastRole, TelevisionEpisode, TelevisionSeason, TelevisionShow } from "../api/types";
import { CAST_ROLE_LABELS, TV_EPISODE_ROLES } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { TELEVISION_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { CheckField, countSummary, diffIds, Field, FieldRow, FormDialog, FormSection, orNull } from "./form/FormKit";
import { PeopleField, usePeopleLinks } from "./form/PeopleField";
import { commitLinks, LinksField, useLinksField } from "./LinksField";

export function TelevisionEpisodeForm(props: {
  show: TelevisionShow;
  season: TelevisionSeason;
  initial?: TelevisionEpisode;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { show, season, initial, onClose } = props;
  const editing = initial !== undefined;
  const { base } = useGuildApi();
  const canRank = useCan("rank");
  const [addToList, setAddToList] = useState(true);
  const [inherit, setInherit] = useState(true);

  const [f, setF] = useState({
    name:            initial?.name    ?? "",
    name_en:         initial?.name_en ?? "",
    runtime_minutes: String(initial?.runtime_minutes ?? ""),
    release_year:    String(initial?.release_year ?? season.release_year),
    notes:           initial?.notes   ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const people = usePeopleLinks(initial?.persons);
  const [genreIds, setGenreIds] = useState<Set<number>>(() => new Set(initial?.genre_ids ?? []));
  const [links, setLinks] = useLinksField(initial?.links);

  // A new episode: "inherit" prefills the pickers from the season (people) and
  // the show (genres), so what will be copied is visible and can be trimmed,
  // instead of the server grafting links on behind the form's back.
  const { setLinks: setPeople } = people;
  useEffect(() => {
    if (editing) return;
    setPeople(inherit
      ? season.persons
          .filter((p) => (TV_EPISODE_ROLES as readonly CastRole[]).includes(p.role))
          .map((p) => ({ personId: p.id, role: p.role }))
      : []);
    setGenreIds(new Set(inherit ? show.genre_ids : []));
  }, [editing, inherit, season.persons, show.genre_ids, setPeople]);

  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => {
      const body = {
        name: f.name.trim(),
        name_en: orNull(f.name_en),
        runtime_minutes: Number(f.runtime_minutes),
        release_year: Number(f.release_year),
        notes: orNull(f.notes),
      };
      const b = new Batch();
      const ref = editing ? initial.id : Batch.ref(0);
      if (editing) b.patch(`${base}/television/episodes/${initial.id}`, body);
      // People & genres go explicitly below, so the server mustn't add its own.
      else b.post(`${base}/television/seasons/${season.id}/episodes`, { ...body, inherit_from_parent: false });
      people.commit(b, `${base}/television/episodes/${ref}`);
      diffIds(b, `${base}/television/episodes/${ref}`, "genres", initial?.genre_ids ?? [], genreIds);
      commitLinks(b, base, "television/episodes", ref, links, editing ? initial.links : []);
      if (!editing && addToList && canRank) b.put(`${base}/television/episodes/${ref}/entry`, {});
      return (await b.run())[0] as TelevisionEpisode;
    },
    onSuccess: (saved) => onClose(saved.name, saved.id),
  });

  return (
    <FormDialog
      title={editing ? "Edit episode" : "New episode"}
      subtitle={`${show.name} · ${season.name}`}
      onClose={() => onClose()}
      onSubmit={() => save.mutate()}
      busy={save.isPending}
      error={save.error}
      submitLabel={editing ? "Save" : "Create"}
      busyLabel={editing ? "Saving…" : "Creating…"}
      footerStart={!editing && canRank && (
        <CheckField checked={addToList} onChange={setAddToList}>Add to my list</CheckField>
      )}
    >
      {!editing && (
        <CheckField checked={inherit} onChange={setInherit}>Start with the season's people and the show's genres</CheckField>
      )}
      <Field label="Name">
        <Input required autoFocus={!editing} value={f.name} onChange={set("name")} />
      </Field>
      <Field label="English name" optional>
        <Input value={f.name_en} onChange={set("name_en")} />
      </Field>
      <FieldRow>
        <Field label="Runtime (minutes)">
          <Input required type="number" min={0} value={f.runtime_minutes} onChange={set("runtime_minutes")} />
        </Field>
        <Field label="Air year">
          <Input required type="number" value={f.release_year} onChange={set("release_year")} />
        </Field>
      </FieldRow>
      <Field label="Notes" optional>
        <Textarea rows={3} value={f.notes} onChange={set("notes")} />
      </Field>

      <PeopleField state={people} roles={TV_EPISODE_ROLES} roleLabels={CAST_ROLE_LABELS} defaultRole="director"
                   note={!editing && inherit ? "Starts from the season's people; adjust as needed." : undefined} />
      <FormSection title="Genres" summary={countSummary(genreIds.size)}>
        <GenreChooser domain={TELEVISION_GENRES} selected={genreIds} onChange={setGenreIds} />
      </FormSection>
      <LinksField links={links} onChange={setLinks} />
      <p className="text-xs text-muted-foreground">Soundtrack albums are tracked on the show, not per episode.</p>
    </FormDialog>
  );
}
