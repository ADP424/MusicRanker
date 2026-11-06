import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Batch } from "../api/client";
import { useGuildApi } from "../api/hooks";
import type { Movie } from "../api/types";
import { CAST_ROLE_LABELS, MOVIE_ROLES } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { MOVIE_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { CheckField, countSummary, diffIds, Field, FieldRow, FormDialog, FormSection, orNull } from "./form/FormKit";
import { PeopleField, usePeopleLinks } from "./form/PeopleField";
import { commitLinks, LinksField, useLinksField } from "./LinksField";

export function MovieForm(props: {
  initial?: Movie;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const { base } = useGuildApi();
  const canRank = useCan("rank");
  const [addToList, setAddToList] = useState(true);

  const [f, setF] = useState({
    name:            initial?.name    ?? "",
    name_en:         initial?.name_en ?? "",
    runtime_minutes: String(initial?.runtime_minutes ?? ""),
    release_year:    String(initial?.release_year ?? new Date().getFullYear()),
    notes:           initial?.notes   ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const people = usePeopleLinks(initial?.persons);
  const [genreIds, setGenreIds] = useState<Set<number>>(() => new Set(initial?.genre_ids ?? []));
  const [links, setLinks] = useLinksField(initial?.links);

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
      if (editing) b.patch(`${base}/movies/${initial.id}`, body);
      else b.post(`${base}/movies`, body);
      people.commit(b, `${base}/movies/${ref}`);
      diffIds(b, `${base}/movies/${ref}`, "genres", initial?.genre_ids ?? [], genreIds);
      commitLinks(b, base, "movies", ref, links, editing ? initial.links : []);
      if (!editing && addToList && canRank) b.put(`${base}/movies/${ref}/entry`, {});
      return (await b.run())[0] as Movie;
    },
    onSuccess: (saved) => onClose(saved.name, saved.id),
  });

  return (
    <FormDialog
      title={editing ? "Edit movie" : "New movie"}
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
        <Field label="Release year">
          <Input required type="number" value={f.release_year} onChange={set("release_year")} />
        </Field>
      </FieldRow>
      <Field label="Notes" optional>
        <Textarea rows={3} value={f.notes} onChange={set("notes")} />
      </Field>

      <PeopleField state={people} roles={MOVIE_ROLES} roleLabels={CAST_ROLE_LABELS} defaultRole="director" />
      <FormSection title="Genres" summary={countSummary(genreIds.size)}>
        <GenreChooser domain={MOVIE_GENRES} selected={genreIds} onChange={setGenreIds} />
      </FormSection>
      <LinksField links={links} onChange={setLinks} />
    </FormDialog>
  );
}
