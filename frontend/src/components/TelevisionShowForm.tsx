import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Batch } from "../api/client";
import { useGuildApi } from "../api/hooks";
import type { TelevisionShow } from "../api/types";
import { CAST_ROLE_LABELS, TV_SHOW_ROLES } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { TELEVISION_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { CheckField, countSummary, diffIds, Field, FormDialog, FormSection, orNull } from "./form/FormKit";
import { PeopleField, usePeopleLinks } from "./form/PeopleField";
import { commitLinks, LinksField, useLinksField } from "./LinksField";

export function TelevisionShowForm(props: {
  initial?: TelevisionShow;
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
        release_year: Number(f.release_year),
        notes: orNull(f.notes),
      };
      const b = new Batch();
      const ref = editing ? initial.id : Batch.ref(0);
      if (editing) b.patch(`${base}/television/shows/${initial.id}`, body);
      else b.post(`${base}/television/shows`, body);
      people.commit(b, `${base}/television/shows/${ref}`);
      diffIds(b, `${base}/television/shows/${ref}`, "genres", initial?.genre_ids ?? [], genreIds);
      commitLinks(b, base, "television/shows", ref, links, editing ? initial.links : []);
      if (!editing && addToList && canRank) b.put(`${base}/television/shows/${ref}/entry`, {});
      return (await b.run())[0] as TelevisionShow;
    },
    onSuccess: (saved) => onClose(saved.name, saved.id),
  });

  return (
    <FormDialog
      title={editing ? "Edit TV show" : "New TV show"}
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
      <Field label="First aired" className="sm:max-w-[calc(50%-0.5rem)]">
        <Input required type="number" value={f.release_year} onChange={set("release_year")} />
      </Field>
      <Field label="Notes" optional>
        <Textarea rows={3} value={f.notes} onChange={set("notes")} />
      </Field>

      <PeopleField state={people} roles={TV_SHOW_ROLES} roleLabels={CAST_ROLE_LABELS} defaultRole="creator" />
      <FormSection title="Genres" summary={countSummary(genreIds.size)}>
        <GenreChooser domain={TELEVISION_GENRES} selected={genreIds} onChange={setGenreIds} />
      </FormSection>
      <LinksField links={links} onChange={setLinks} />
    </FormDialog>
  );
}
