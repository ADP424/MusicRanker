import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { Genre, GenreIn } from "../api/types";
import { GenreChooser } from "./GenreChooser";

export function GenreForm(props: {
  initial?: Genre;
  onClose: () => void;
  anchorTop?: number;
}) {
  const { initial, onClose, anchorTop } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();

  const [f, setF] = useState({
    name:     initial?.name ?? "",
    synonyms: (initial?.synonyms ?? []).join(", "),
    notes:    initial?.notes ?? "",
  });

  // Parent genres (edit mode only)
  const { data: parents = [] } = useQuery({
    queryKey: ["genres", initial?.id, "parents"],
    queryFn: () => api.get<Genre[]>(`/genres/${initial!.id}/parents`),
    enabled: editing,
  });
  const [parentIds, setParentIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setParentIds(new Set(parents.map((p) => p.id)));
  }, [parents]);

  const save = useMutation({
    mutationFn: async () => {
      const body: GenreIn = {
        name: f.name,
        synonyms: f.synonyms.trim()
          ? f.synonyms.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        notes: f.notes.trim() || null,
      };

      const genre = editing
        ? await api.patch<Genre>(`/genres/${initial.id}`, body)
        : await api.post<Genre>("/genres", body);

      // Sync parents
      const before = new Set(parents.map((p) => p.id));
      for (const id of parentIds)
        if (!before.has(id)) await api.put(`/genres/${genre.id}/parents/${id}`);
      for (const id of before)
        if (!parentIds.has(id)) await api.delete(`/genres/${genre.id}/parents/${id}`);

      return genre;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["genres"] });
      onClose();
    },
  });

  const style = anchorTop !== undefined ? { top: anchorTop } : undefined;

  return (
    <dialog open className="modal inline-modal" style={style}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} Genre</h2>

        <label>Name
          <input required value={f.name}
                 onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>

        <label>Synonyms <small>(comma‑separated)</small>
          <input value={f.synonyms}
                 onChange={(e) => setF({ ...f, synonyms: e.target.value })}
                 placeholder="Prog Rock, Prog" />
        </label>

        <label>Notes
          <textarea rows={3} value={f.notes}
                    onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </label>

        <fieldset>
          <legend>Parent genres</legend>
          <GenreChooser
            selected={parentIds}
            onChange={setParentIds}
            excludeId={initial?.id}
          />
        </fieldset>

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
