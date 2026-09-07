import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../api/client";
import { useUpdateGenreMediaTypes } from "../api/hooks";
import { gk } from "../api/keys";
import type { Genre } from "../api/types";
import { useGuild } from "../guild/GuildProvider";
import { BusyButton, InlineBusy } from "../components/Spinner";
import { GenreChooser } from "./GenreChooser";
import type { GenreDomain, GenreLike } from "./config";

const MEDIA_TYPE_LABELS: Record<"is_music" | "is_movie" | "is_game" | "is_television", string> = {
  is_music: "Music",
  is_movie: "Movie",
  is_game: "Game",
  is_television: "Television",
};

export function GenreForm(props: {
  domain: GenreDomain;
  initial?: GenreLike;
  onClose: () => void;
}) {
  const { domain, initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const guild = useGuild();
  const apiBase = domain.useApiBase();
  const [parentsOpen, setParentsOpen] = useState(false);

  const [f, setF] = useState({
    name:     initial?.name ?? "",
    synonyms: (initial?.synonyms ?? []).join(", "),
    notes:    initial?.notes ?? "",
  });

  const { data: parents, isLoading: parentsLoading } = useQuery({
    queryKey: [domain.key, apiBase, initial?.id, "parents"],
    queryFn: () => api.get<GenreLike[]>(`${apiBase}/${initial!.id}/parents`),
    enabled: editing,
  });
  const [parentIds, setParentIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (parents) setParentIds(new Set(parents.map((p) => p.id)));
  }, [parents]);

  // Categories are only assignable to root (parentless) entries.
  const isRoot = parentIds.size === 0;
  const { data: categories = [] } = domain.useCategories();
  const [categoryIds, setCategoryIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setCategoryIds(new Set(initial?.category_ids ?? []));
  }, [initial]);

  // Which media types this genre applies to. On create, these are sent as
  // part of the POST body (defaulting to just the current domain's flag).
  // On edit, toggling one fires its own mutation immediately — separate from
  // the main save, since it's unrelated to this domain's
  // name/synonyms/notes/parents/categories.
  const initialGenre = initial as Genre | undefined;
  const defaultMediaTypes = () => ({
    is_music: initialGenre?.is_music ?? domain.mediaTypeFlag === "is_music",
    is_movie: initialGenre?.is_movie ?? domain.mediaTypeFlag === "is_movie",
    is_game: initialGenre?.is_game ?? domain.mediaTypeFlag === "is_game",
    is_television: initialGenre?.is_television ?? domain.mediaTypeFlag === "is_television",
  });
  const [mediaTypes, setMediaTypes] = useState(defaultMediaTypes);
  useEffect(() => {
    setMediaTypes(defaultMediaTypes());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGenre]);
  const updateMediaTypes = useUpdateGenreMediaTypes();

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name,
        synonyms: f.synonyms.trim()
          ? f.synonyms.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        notes: f.notes.trim() || null,
        // Only meaningful on create — domain.mediaTypeFlag domains ignore
        // these on PATCH (media types are edited via their own mutation).
        ...(!editing && domain.mediaTypeFlag ? mediaTypes : {}),
      };

      const genre = editing
        ? await api.patch<GenreLike>(`${apiBase}/${initial.id}`, body)
        : await api.post<GenreLike>(apiBase, body);

      const before = new Set((parents ?? []).map((p) => p.id));
      for (const id of parentIds)
        if (!before.has(id)) await api.put(`${apiBase}/${genre.id}/parents/${id}`);
      for (const id of before)
        if (!parentIds.has(id)) await api.delete(`${apiBase}/${genre.id}/parents/${id}`);

      if (isRoot) {
        const beforeCategories = new Set(initial?.category_ids ?? []);
        for (const id of categoryIds)
          if (!beforeCategories.has(id)) await api.put(`${apiBase}/${genre.id}/categories/${id}`);
        for (const id of beforeCategories)
          if (!categoryIds.has(id)) await api.delete(`${apiBase}/${genre.id}/categories/${id}`);
      }

      return genre;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [domain.key, apiBase] });
      qc.invalidateQueries({ queryKey: gk(guild.id, domain.key) });
      onClose();
    },
  });

  return (
    <dialog open className="modal">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} {domain.heading}</h2>

        <label>Name
          <input required value={f.name}
                 onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>

        <label>Synonyms <small>(comma‑separated)</small>
          <input value={f.synonyms}
                 onChange={(e) => setF({ ...f, synonyms: e.target.value })}
                 placeholder={domain.synonymPlaceholder} />
        </label>

        <label>Notes
          <textarea rows={3} value={f.notes}
                    onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </label>

        <fieldset>
          <legend
            className="collapsible-legend"
            onClick={() => setParentsOpen((o) => !o)}
          >
            Parent {domain.noun}
            <span className="collapse-arrow">{parentsOpen ? "▲" : "▼"}</span>
          </legend>
          {parentsOpen && (
            <GenreChooser
              domain={domain}
              selected={parentIds}
              onChange={setParentIds}
              excludeId={initial?.id}
            />
          )}
          {!parentsOpen && (
            <span className="collapsed-summary" onClick={() => setParentsOpen(true)}>
              {parentsLoading ? <InlineBusy label="Loading parents…" /> : parentIds.size > 0 ? `${parentIds.size} selected` : "None selected"}
            </span>
          )}
        </fieldset>

        {isRoot && categories.length > 0 && (
          <fieldset>
            <legend>Categories</legend>
            <div className="chips">
              {categories.map((c) => (
                <label key={c.id} className="chip">
                  <input
                    type="checkbox"
                    checked={categoryIds.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(categoryIds);
                      e.target.checked ? next.add(c.id) : next.delete(c.id);
                      setCategoryIds(next);
                    }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {domain.mediaTypeFlag && (
          <fieldset>
            <legend className="inline">Media types {updateMediaTypes.isPending && <InlineBusy />}</legend>
            <div className="chips">
              {(Object.keys(MEDIA_TYPE_LABELS) as Array<keyof typeof MEDIA_TYPE_LABELS>).map((flag) => (
                <label key={flag} className="chip">
                  <input
                    type="checkbox"
                    checked={mediaTypes[flag]}
                    onChange={(e) => {
                      const next = { ...mediaTypes, [flag]: e.target.checked };
                      setMediaTypes(next);
                      // While editing, each toggle is its own immediate save;
                      // while creating, the choice is just held in state and
                      // sent along with the rest of the form on submit.
                      if (editing) {
                        updateMediaTypes.mutate({ id: initial.id, [flag]: e.target.checked });
                      }
                    }}
                  />
                  {MEDIA_TYPE_LABELS[flag]}
                </label>
              ))}
            </div>
            {editing && updateMediaTypes.isError && (
              <p className="err">{(updateMediaTypes.error as Error).message}</p>
            )}
          </fieldset>
        )}

        <footer>
          <button type="button" onClick={onClose} disabled={save.isPending}>Cancel</button>
          <BusyButton type="submit" busy={save.isPending} busyLabel={editing ? "Saving…" : "Creating…"} disabled={parentsLoading}>
            {editing ? "Save" : "Create"}
          </BusyButton>
        </footer>
        {save.isError && <p className="err">{(save.error as Error).message}</p>}
      </form>
    </dialog>
  );
}
