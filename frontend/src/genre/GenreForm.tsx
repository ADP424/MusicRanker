import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, Batch } from "../api/client";
import { useUpdateGenreMediaTypes } from "../api/hooks";
import type { Genre } from "../api/types";
import {
  ChipCheck, countSummary, diffIds, Field, FormDialog, FormGroup, FormSection, Notice,
} from "../components/form/FormKit";
import { InlineBusy } from "../components/Spinner";
import { GenreChooser } from "./GenreChooser";
import { type GenreDomain, type GenreLike, useGenreKey } from "./config";

const MEDIA_TYPE_LABELS: Record<"is_music" | "is_movie" | "is_game" | "is_television" | "is_book", string> = {
  is_music: "Music",
  is_movie: "Movie",
  is_game: "Game",
  is_television: "Television",
  is_book: "Book",
};

export function GenreForm(props: {
  domain: GenreDomain;
  initial?: GenreLike;
  onClose: () => void;
}) {
  const { domain, initial, onClose } = props;
  const editing = initial !== undefined;
  const apiBase = domain.useApiBase();
  const key = useGenreKey(domain);

  const [f, setF] = useState({
    name:     initial?.name ?? "",
    synonyms: (initial?.synonyms ?? []).join(", "),
    notes:    initial?.notes ?? "",
  });

  const { data: parents, isLoading: parentsLoading } = useQuery({
    queryKey: key(initial?.id, "parents"),
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
    is_book: initialGenre?.is_book ?? domain.mediaTypeFlag === "is_book",
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

      const b = new Batch();
      if (editing) b.patch(`${apiBase}/${initial.id}`, body);
      else b.post(apiBase, body);
      const ref = editing ? initial.id : Batch.ref(0);

      diffIds(b, `${apiBase}/${ref}`, "parents", (parents ?? []).map((p) => p.id), parentIds);
      if (isRoot) diffIds(b, `${apiBase}/${ref}`, "categories", initial?.category_ids ?? [], categoryIds);

      return (await b.run())[0] as GenreLike;
    },
    meta: { errorToast: false },
    onSuccess: () => onClose(),
  });

  const toggleIn = (set: Set<number>, id: number, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id); else next.delete(id);
    return next;
  };

  return (
    <FormDialog
      title={`${editing ? "Edit" : "New"} ${domain.heading.toLowerCase()}`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      busy={save.isPending}
      error={save.error}
      submitDisabled={parentsLoading}
      submitLabel={editing ? "Save" : "Create"}
      busyLabel={editing ? "Saving…" : "Creating…"}
    >
      <Field label="Name">
        <Input required autoFocus={!editing} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Synonyms" optional hint="Comma-separated; searches and imports match these too">
        <Input value={f.synonyms} placeholder={domain.synonymPlaceholder}
               onChange={(e) => setF({ ...f, synonyms: e.target.value })} />
      </Field>
      <Field label="Notes" optional>
        <Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>

      <FormSection
        title={`Parent ${domain.noun}`}
        summary={parentsLoading ? <InlineBusy label="Loading…" /> : countSummary(parentIds.size)}
      >
        <GenreChooser domain={domain} selected={parentIds} onChange={setParentIds} excludeId={initial?.id} />
      </FormSection>

      {isRoot && categories.length > 0 && (
        <FormGroup title="Categories">
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <ChipCheck key={c.id} checked={categoryIds.has(c.id)}
                         onChange={(on) => setCategoryIds(toggleIn(categoryIds, c.id, on))}>
                {c.name}
              </ChipCheck>
            ))}
          </div>
        </FormGroup>
      )}

      {domain.mediaTypeFlag && (
        <FormGroup title={<span className="flex items-center gap-2">Media types {updateMediaTypes.isPending && <InlineBusy />}</span>}>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(MEDIA_TYPE_LABELS) as Array<keyof typeof MEDIA_TYPE_LABELS>).map((flag) => (
              <ChipCheck
                key={flag}
                checked={mediaTypes[flag]}
                onChange={(on) => {
                  setMediaTypes({ ...mediaTypes, [flag]: on });
                  // Editing: each toggle saves at once. Creating: it goes with the form.
                  if (editing) updateMediaTypes.mutate({ id: initial.id, [flag]: on });
                }}
              >
                {MEDIA_TYPE_LABELS[flag]}
              </ChipCheck>
            ))}
          </div>
          {editing && updateMediaTypes.isError && (
            <Notice tone="error">{(updateMediaTypes.error as Error).message}</Notice>
          )}
        </FormGroup>
      )}
    </FormDialog>
  );
}
