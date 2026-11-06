import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Batch } from "../api/client";
import { useGuildApi } from "../api/hooks";
import type { Game } from "../api/types";
import { GAME_ROLE_LABELS, GAME_ROLES } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { GAME_GENRES, GAME_PLATFORMS } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { CheckField, countSummary, diffIds, Field, FormDialog, FormSection, orNull } from "./form/FormKit";
import { PeopleField, usePeopleLinks } from "./form/PeopleField";
import { commitLinks, LinksField, useLinksField } from "./LinksField";

export function GameForm(props: {
  initial?: Game;
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
  const [platformIds, setPlatformIds] = useState<Set<number>>(() => new Set(initial?.platform_ids ?? []));
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
      if (editing) b.patch(`${base}/games/${initial.id}`, body);
      else b.post(`${base}/games`, body);
      people.commit(b, `${base}/games/${ref}`);
      diffIds(b, `${base}/games/${ref}`, "genres", initial?.genre_ids ?? [], genreIds);
      diffIds(b, `${base}/games/${ref}`, "platforms", initial?.platform_ids ?? [], platformIds);
      commitLinks(b, base, "games", ref, links, editing ? initial.links : []);
      if (!editing && addToList && canRank) b.put(`${base}/games/${ref}/entry`, {});
      return (await b.run())[0] as Game;
    },
    onSuccess: (saved) => onClose(saved.name, saved.id),
  });

  return (
    <FormDialog
      title={editing ? "Edit game" : "New game"}
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
      <Field label="Release year" className="sm:max-w-[calc(50%-0.5rem)]">
        <Input required type="number" value={f.release_year} onChange={set("release_year")} />
      </Field>
      <Field label="Notes" optional>
        <Textarea rows={3} value={f.notes} onChange={set("notes")} />
      </Field>

      <PeopleField state={people} roles={GAME_ROLES} roleLabels={GAME_ROLE_LABELS} defaultRole="director" />
      <FormSection title="Genres" summary={countSummary(genreIds.size)}>
        <GenreChooser domain={GAME_GENRES} selected={genreIds} onChange={setGenreIds} />
      </FormSection>
      <FormSection title="Platforms" summary={countSummary(platformIds.size)}>
        <GenreChooser domain={GAME_PLATFORMS} selected={platformIds} onChange={setPlatformIds} />
      </FormSection>
      <LinksField links={links} onChange={setLinks} />
    </FormDialog>
  );
}
