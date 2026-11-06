import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import type { Person } from "../api/types";
import { UNKNOWN_NATIONALITY } from "../api/types";
import { Field, FieldRow, FormDialog, NationalitySelect, orNull, withNationality } from "./form/FormKit";

export function PersonForm(props: { initial?: Person; onClose: (savedName?: string, savedId?: number) => void }) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const { base } = useGuildApi();

  const [f, setF] = useState({
    name:              initial?.name              ?? "",
    name_en:           initial?.name_en           ?? "",
    birth_nationality: initial?.birth_nationality ?? UNKNOWN_NATIONALITY,
    core_nationality:  initial?.core_nationality  ?? UNKNOWN_NATIONALITY,
    notes:             initial?.notes             ?? "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const setNat = (k: "birth_nationality" | "core_nationality") => (v: string) => setF((prev) => withNationality(prev, k, v));

  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        name_en: orNull(f.name_en),
        birth_nationality: f.birth_nationality,
        core_nationality: f.core_nationality,
        notes: orNull(f.notes),
      };
      return editing
        ? api.patch<Person>(`${base}/persons/${initial.id}`, body)
        : api.post<Person>(`${base}/persons`, body);
    },
    onSuccess: (saved) => onClose(saved.name, saved.id),
  });

  return (
    <FormDialog
      title={editing ? "Edit person" : "New person"}
      onClose={() => onClose()}
      onSubmit={() => save.mutate()}
      busy={save.isPending}
      error={save.error}
      submitLabel={editing ? "Save" : "Create"}
      busyLabel={editing ? "Saving…" : "Creating…"}
    >
      <Field label="Name">
        <Input required autoFocus value={f.name} onChange={(e) => set("name")(e.target.value)} />
      </Field>
      <Field label="English name" optional>
        <Input value={f.name_en} onChange={(e) => set("name_en")(e.target.value)} placeholder="e.g. Ken Watanabe" />
      </Field>
      <FieldRow>
        <Field label="Birth nationality">
          <NationalitySelect value={f.birth_nationality} onChange={setNat("birth_nationality")} />
        </Field>
        <Field label="Core nationality">
          <NationalitySelect value={f.core_nationality} onChange={setNat("core_nationality")} />
        </Field>
      </FieldRow>
      <Field label="Notes" optional>
        <Textarea rows={3} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
