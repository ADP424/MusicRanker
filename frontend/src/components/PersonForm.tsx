import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import { useNationalities } from "../api/hooks";
import type { Person, PersonBody } from "../api/types";

const orNull = (s: string) => (s.trim() === "" ? null : s);

export function PersonForm(props: { initial?: Person; onClose: (savedName?: string, savedId?: number) => void }) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const { data: nats = [] } = useNationalities();

  const [f, setF] = useState({
    name:              initial?.name              ?? "",
    birth_nationality: initial?.birth_nationality ?? "",
    core_nationality:  initial?.core_nationality  ?? "",
    notes:             initial?.notes             ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const body: PersonBody = {
        name: f.name,
        birth_nationality: f.birth_nationality,
        core_nationality: f.core_nationality,
        notes: orNull(f.notes),
      };
      return editing
        ? api.patch<Person>(`/persons/${initial.id}`, body)
        : api.post<Person>("/persons", body);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["people"] });
      onClose(saved.name, saved.id);
    },
  });

  const bind =
    <K extends keyof typeof f>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });

  return (
    <dialog open className="modal">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} Person</h2>

        <label>Name
          <input required value={f.name} onChange={bind("name")} />
        </label>

        <div className="grid-2">
          <label>Birth nationality
            <select required value={f.birth_nationality} onChange={bind("birth_nationality")}>
              <option value="">—</option>
              {nats.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label>Core nationality
            <select required value={f.core_nationality} onChange={bind("core_nationality")}>
              <option value="">—</option>
              {nats.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <label>Notes
          <textarea rows={3} value={f.notes} onChange={bind("notes")} />
        </label>

        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={save.isPending}>{editing ? "Save" : "Create"}</button>
        </footer>
        {save.isError && <p className="err">{(save.error as Error).message}</p>}
      </form>
    </dialog>
  );
}
