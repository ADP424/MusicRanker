import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { gk } from "../api/keys";
import { useGuildApi, useNationalities } from "../api/hooks";
import type { Person } from "../api/types";
import { BusyButton } from "./Spinner";

const orNull = (s: string) => (s.trim() === "" ? null : s);

export function PersonForm(props: { initial?: Person; onClose: (savedName?: string, savedId?: number) => void }) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const { data: nats = [], isLoading: natsLoading } = useNationalities();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const [f, setF] = useState({
    name:              initial?.name              ?? "",
    name_en:           initial?.name_en           ?? "",
    birth_nationality: initial?.birth_nationality ?? "",
    core_nationality:  initial?.core_nationality  ?? "",
    notes:             initial?.notes             ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        name_en: orNull(f.name_en),
        birth_nationality: f.birth_nationality,
        core_nationality: f.core_nationality,
        notes: orNull(f.notes),
      };
      return editing
        ? api.patch<Person>(`${base}/persons/${initial.id}`, body)
        : api.post<Person>(`${base}/persons`, body);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: gk(guildId, "people") });
      onClose(saved.name, saved.id);
    },
  });

  const bind =
    <K extends keyof typeof f>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });

  return (
    <dialog ref={ref} className="modal" onClose={() => onClose()}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} Person</h2>

        <label>Name
          <input required value={f.name} onChange={bind("name")} />
        </label>

        <label><span className="label-text">English name <span className="info-icon" title="optional">ⓘ</span></span>
          <input value={f.name_en} onChange={bind("name_en")} placeholder="e.g. Ken Watanabe" />
        </label>

        <div className="grid-2">
          <label>Birth nationality
            <select required value={f.birth_nationality} disabled={natsLoading} onChange={bind("birth_nationality")}>
              <option value="">{natsLoading ? "Loading…" : "—"}</option>
              {nats.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label>Core nationality
            <select required value={f.core_nationality} disabled={natsLoading} onChange={bind("core_nationality")}>
              <option value="">{natsLoading ? "Loading…" : "—"}</option>
              {nats.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <label><span className="label-text">Notes <span className="info-icon" title="optional">ⓘ</span></span>
          <textarea rows={3} value={f.notes} onChange={bind("notes")} />
        </label>

        <footer>
          <button type="button" onClick={() => onClose()} disabled={save.isPending}>Cancel</button>
          <BusyButton type="submit" busy={save.isPending} busyLabel={editing ? "Saving…" : "Creating…"}>
            {editing ? "Save" : "Create"}
          </BusyButton>
        </footer>
        {save.isError && <p className="err">{(save.error as Error).message}</p>}
      </form>
    </dialog>
  );
}
