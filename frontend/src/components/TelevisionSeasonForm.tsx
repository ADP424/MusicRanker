import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Batch } from "../api/client";
import { useGuildApi } from "../api/hooks";
import type { TelevisionSeason, TelevisionShow } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { CheckField, Field, FieldRow, FormDialog, orNull } from "./form/FormKit";
import { commitLinks, LinksField, useLinksField } from "./LinksField";

/** Create or edit a season's own fields. Its people are edited on the season
 *  page (or imported from TMDB); a new season can start from the show's. */
export function TelevisionSeasonForm(props: {
  show: TelevisionShow;
  initial?: TelevisionSeason;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { show, initial, onClose } = props;
  const editing = initial !== undefined;
  const { base } = useGuildApi();
  const canRank = useCan("rank");
  const [inheritFromShow, setInheritFromShow] = useState(true);
  const [addToList, setAddToList] = useState(true);

  const nextNumber = Math.max(0, ...show.seasons.map((s) => s.season_number ?? 0)) + 1;
  const [f, setF] = useState({
    name:          initial?.name    ?? `Season ${nextNumber}`,
    name_en:       initial?.name_en ?? "",
    season_number: initial ? (initial.season_number != null ? String(initial.season_number) : "") : String(nextNumber),
    release_year:  String(initial?.release_year ?? show.release_year),
    notes:         initial?.notes   ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  const [links, setLinks] = useLinksField(initial?.links);

  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => {
      const body = {
        name: f.name.trim(),
        name_en: orNull(f.name_en),
        season_number: f.season_number.trim() === "" ? null : Number(f.season_number),
        release_year: Number(f.release_year),
        notes: orNull(f.notes),
      };
      const b = new Batch();
      if (editing) b.patch(`${base}/television/seasons/${initial.id}`, body);
      else b.post(`${base}/television/shows/${show.id}/seasons`, { ...body, inherit_from_show: inheritFromShow });
      const ref = editing ? initial.id : Batch.ref(0);
      commitLinks(b, base, "television/seasons", ref, links, editing ? initial.links : []);
      if (!editing && addToList && canRank) b.put(`${base}/television/seasons/${ref}/entry`, {});
      return (await b.run())[0] as TelevisionSeason;
    },
    onSuccess: (saved) => onClose(saved.name, saved.id),
  });

  return (
    <FormDialog
      title={editing ? "Edit season" : "New season"}
      subtitle={show.name}
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
        <CheckField checked={inheritFromShow} onChange={setInheritFromShow}>
          Start with the show's people (creators stay on the show)
        </CheckField>
      )}
      <Field label="Name">
        <Input required value={f.name} onChange={set("name")} />
      </Field>
      <Field label="English name" optional>
        <Input value={f.name_en} onChange={set("name_en")} />
      </Field>
      <FieldRow>
        <Field label="Season number" optional hint="TMDB's numbering (0 = specials); the import uses it">
          <Input type="number" min={0} value={f.season_number} onChange={set("season_number")} />
        </Field>
        <Field label="Air year">
          <Input required type="number" value={f.release_year} onChange={set("release_year")} />
        </Field>
      </FieldRow>
      <Field label="Notes" optional>
        <Textarea rows={3} value={f.notes} onChange={set("notes")} />
      </Field>
      <LinksField links={links} onChange={setLinks} />
    </FormDialog>
  );
}
