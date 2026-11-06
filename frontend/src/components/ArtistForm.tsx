import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Batch } from "../api/client";
import { useGuildApi, useMusicGenres } from "../api/hooks";
import type { Artist } from "../api/types";
import { UNKNOWN_NATIONALITY } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { MUSIC_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { CheckField, Field, FieldRow, FormDialog, FormSection, NationalitySelect, orNull, withNationality } from "./form/FormKit";
import { commitLinks, LinksField, useLinksField } from "./LinksField";

export function ArtistForm(props: {
  initial?: Artist;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const { base } = useGuildApi();
  const canRank = useCan("rank");
  const { data: genres = [] } = useMusicGenres();
  const [addToList, setAddToList] = useState(true);

  const [f, setF] = useState({
    name:              initial?.name              ?? "",
    name_en:           initial?.name_en           ?? "",
    birth_nationality: initial?.birth_nationality ?? UNKNOWN_NATIONALITY,
    core_nationality:  initial?.core_nationality  ?? UNKNOWN_NATIONALITY,
    notes:             initial?.notes             ?? "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const setNat = (k: "birth_nationality" | "core_nationality") => (v: string) => setF((prev) => withNationality(prev, k, v));

  const [primaryGenre, setPrimaryGenre] = useState<Set<number>>(
    initial?.primary_genre != null ? new Set([initial.primary_genre]) : new Set(),
  );
  const [links, setLinks] = useLinksField(initial?.links);
  const [genreId] = primaryGenre;
  const genreName = genres.find((g) => g.id === genreId)?.name;

  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => {
      const body = {
        name: f.name.trim(),
        name_en: orNull(f.name_en),
        birth_nationality: f.birth_nationality,
        core_nationality: f.core_nationality,
        primary_genre: genreId ?? null,
        notes: orNull(f.notes),
      };
      const b = new Batch();
      if (editing) b.patch(`${base}/artists/${initial.id}`, body);
      else b.post(`${base}/artists`, body);
      const ref = editing ? initial.id : Batch.ref(0);
      commitLinks(b, base, "artists", ref, links, editing ? initial.links : []);
      if (!editing && addToList && canRank) b.put(`${base}/artists/${ref}/entry`, {});
      return (await b.run())[0] as Artist;
    },
    onSuccess: (saved) => onClose(saved.name, saved.id),
  });

  return (
    <FormDialog
      title={editing ? "Edit artist" : "New artist"}
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
        <Input required autoFocus={!editing} value={f.name} onChange={(e) => set("name")(e.target.value)} />
      </Field>
      <Field label="English name" optional>
        <Input value={f.name_en} onChange={(e) => set("name_en")(e.target.value)} />
      </Field>
      <FieldRow>
        <Field label="Birth / formed nationality">
          <NationalitySelect value={f.birth_nationality} onChange={setNat("birth_nationality")} />
        </Field>
        <Field label="Core nationality">
          <NationalitySelect value={f.core_nationality} onChange={setNat("core_nationality")} />
        </Field>
      </FieldRow>
      <FormSection title="Primary genre" summary={genreName ?? (genreId != null ? "1 selected" : "None")}>
        <GenreChooser domain={MUSIC_GENRES} selected={primaryGenre} onChange={setPrimaryGenre} single />
      </FormSection>
      <Field label="Notes" optional>
        <Textarea rows={3} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
      </Field>
      <LinksField links={links} onChange={setLinks} />
    </FormDialog>
  );
}
