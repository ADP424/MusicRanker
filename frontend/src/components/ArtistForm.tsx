import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import { useNationalities } from "../api/hooks";
import type { Artist, ArtistBody } from "../api/types";
import { GenreChooser } from "./GenreChooser";

/** Empty string → null for optional text columns. */
const orNull = (s: string) => (s.trim() === "" ? null : s);

export function ArtistForm(props: {
  initial?: Artist;
  onClose: () => void;
}) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const { data: nats = [] } = useNationalities();
  const [genreOpen, setGenreOpen] = useState(false);

  const [f, setF] = useState({
    name:              initial?.name              ?? "",
    discography_link:  initial?.discography_link  ?? "",
    birth_nationality: initial?.birth_nationality ?? "",
    core_nationality:  initial?.core_nationality  ?? "",
    notes:             initial?.notes             ?? "",
  });

  const [primaryGenreSet, setPrimaryGenreSet] = useState<Set<number>>(
    initial?.primary_genre != null ? new Set([initial.primary_genre]) : new Set()
  );

  const save = useMutation({
    mutationFn: () => {
      const [genreId] = primaryGenreSet;
      const body: ArtistBody = {
        name: f.name,
        discography_link: f.discography_link,
        birth_nationality: f.birth_nationality,
        core_nationality: f.core_nationality,
        primary_genre: genreId ?? null,
        notes: orNull(f.notes),
      };
      return editing
        ? api.patch(`/artists/${initial.id}`, body)
        : api.post("/artists", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artists"] });
      onClose();
    },
  });

  const bind =
    <K extends keyof typeof f>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });

  return (
    <dialog open className="modal">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} Artist</h2>

        <label>Name
          <input required value={f.name} onChange={bind("name")} />
        </label>

        <label>Discography link
          <input required type="url"
                 value={f.discography_link} onChange={bind("discography_link")} />
        </label>

        <div className="grid-2">
          <label>Birth / formed nationality
            <select required value={f.birth_nationality}
                    onChange={bind("birth_nationality")}>
              <option value="">—</option>
              {nats.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label>Core nationality
            <select required value={f.core_nationality}
                    onChange={bind("core_nationality")}>
              <option value="">—</option>
              {nats.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <fieldset>
          <legend
            className="collapsible-legend"
            onClick={() => setGenreOpen((o) => !o)}
          >
            Primary genre <small>(pick one)</small>
            <span className="collapse-arrow">{genreOpen ? "▲" : "▼"}</span>
          </legend>
          {genreOpen && (
            <GenreChooser
              selected={primaryGenreSet}
              onChange={setPrimaryGenreSet}
              single
            />
          )}
          {!genreOpen && primaryGenreSet.size > 0 && (
            <span className="collapsed-summary" onClick={() => setGenreOpen(true)}>
              {primaryGenreSet.size} selected
            </span>
          )}
        </fieldset>

        <label>Notes
          <textarea rows={3} value={f.notes} onChange={bind("notes")} />
        </label>

        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={save.isPending}>
            {editing ? "Save" : "Create"}
          </button>
        </footer>
        {save.isError && <p className="err">{(save.error as Error).message}</p>}
      </form>
    </dialog>
  );
}
