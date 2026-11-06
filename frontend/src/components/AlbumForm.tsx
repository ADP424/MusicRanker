import { useMutation } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Batch } from "../api/client";
import { useArtistCatalog, useGuildApi } from "../api/hooks";
import type { Album } from "../api/types";
import { MUSIC_GENRES } from "../genre/config";
import { GenreChooser } from "../genre/GenreChooser";
import { useCan } from "../guild/GuildProvider";
import {
  CheckField, ChipCheck, ChipList, countSummary, diffIds, Field, FieldRow, FormDialog, FormSection, orNull,
} from "./form/FormKit";
import { commitLinks, LinksField, useLinksField } from "./LinksField";
import { LoadingState } from "./Spinner";

/** Ticks artists from the catalog. Mounted only while its section is open, so
 *  the catalog loads on demand. */
function ArtistPicker({ selected, onChange }: { selected: Set<number>; onChange: (next: Set<number>) => void }) {
  const { data: artists = [], isLoading } = useArtistCatalog();
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return artists
      .filter((a) => !q || a.name.toLowerCase().includes(q) || !!a.name_en?.toLowerCase().includes(q))
      .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)))
      .slice(0, 80);
    // Order by the selection as it was when the search changed, so ticking doesn't reshuffle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artists, search]);

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" className="pl-8" placeholder="Search artists…" aria-label="Search artists"
               value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {isLoading ? <LoadingState compact label="Loading artists…" /> : (
        <ChipList>
          {shown.map((a) => (
            <ChipCheck key={a.id} checked={selected.has(a.id)} onChange={(on) => {
              const next = new Set(selected);
              if (on) next.add(a.id); else next.delete(a.id);
              onChange(next);
            }}>
              {a.name}{a.name_en && <span className="text-muted-foreground">({a.name_en})</span>}
            </ChipCheck>
          ))}
          {shown.length === 0 && <span className="text-xs text-muted-foreground">No artists match.</span>}
        </ChipList>
      )}
    </>
  );
}

export function AlbumForm(props: {
  artistId: number;
  initial?: Album;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { artistId, initial, onClose } = props;
  const editing = initial !== undefined;
  const { base } = useGuildApi();
  const canRank = useCan("rank");
  const [addToList, setAddToList] = useState(true);

  const [f, setF] = useState({
    name:         initial?.name    ?? "",
    name_en:      initial?.name_en ?? "",
    min:          initial ? String(Math.floor(initial.runtime_seconds / 60)) : "",
    sec:          initial ? String(initial.runtime_seconds % 60) : "0",
    release_year: String(initial?.release_year ?? new Date().getFullYear()),
    alias:        initial?.alias   ?? "",
    notes:        initial?.notes   ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const [genreIds, setGenreIds] = useState<Set<number>>(() => new Set(initial?.genre_ids ?? []));
  const [artistIds, setArtistIds] = useState<Set<number>>(
    () => new Set(editing ? initial.artists.map((a) => a.id) : [artistId]),
  );
  const [links, setLinks] = useLinksField(initial?.links);

  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => {
      const body = {
        name: f.name.trim(),
        name_en: orNull(f.name_en),
        runtime_seconds: Number(f.min) * 60 + Number(f.sec || 0),
        release_year: Number(f.release_year),
        alias: orNull(f.alias),
        notes: orNull(f.notes),
      };
      const b = new Batch();
      const ref = editing ? initial.id : Batch.ref(0);
      if (editing) {
        b.patch(`${base}/albums/${initial.id}`, body);
        diffIds(b, `${base}/albums/${ref}`, "artists", initial.artists.map((a) => a.id), artistIds);
      } else {
        b.post(`${base}/albums`, { ...body, artist_ids: [...artistIds] });
      }
      diffIds(b, `${base}/albums/${ref}`, "genres", initial?.genre_ids ?? [], genreIds);
      commitLinks(b, base, "albums", ref, links, editing ? initial.links : []);
      // An album is ranked within each of its artists' discographies.
      if (!editing && addToList && canRank) {
        for (const a of artistIds) b.put(`${base}/artists/${a}/albums/${ref}/entry`, {});
      }
      return (await b.run())[0] as Album;
    },
    onSuccess: (album) => onClose(album.name, album.id),
  });

  const initialNames = new Map((initial?.artists ?? []).map((a) => [a.id, a.name]));
  const artistSummary = [...artistIds].every((id) => initialNames.has(id))
    ? [...artistIds].map((id) => initialNames.get(id)).join(", ") || "None selected"
    : countSummary(artistIds.size);

  return (
    <FormDialog
      title={editing ? "Edit album" : "New album"}
      onClose={() => onClose()}
      onSubmit={() => save.mutate()}
      busy={save.isPending}
      error={save.error}
      submitDisabled={artistIds.size === 0}
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
      <FieldRow>
        <div className="grid content-start gap-1.5 text-sm">
          <span className="font-medium">Runtime</span>
          <div className="flex items-center gap-2">
            <Input required type="number" min={0} aria-label="Minutes" className="w-20" value={f.min} onChange={set("min")} />
            <span className="text-muted-foreground">min</span>
            <Input type="number" min={0} max={59} aria-label="Seconds" className="w-20" value={f.sec} onChange={set("sec")} />
            <span className="text-muted-foreground">sec</span>
          </div>
        </div>
        <Field label="Release year">
          <Input required type="number" value={f.release_year} onChange={set("release_year")} />
        </Field>
      </FieldRow>
      <Field label="Alias" optional hint="If released under a different name">
        <Input value={f.alias} onChange={set("alias")} />
      </Field>
      <Field label="Notes" optional>
        <Textarea rows={3} value={f.notes} onChange={set("notes")} />
      </Field>

      <FormSection title="Artists" summary={artistSummary}>
        <ArtistPicker selected={artistIds} onChange={setArtistIds} />
        {artistIds.size === 0 && <p className="text-xs text-destructive">An album needs at least one artist.</p>}
      </FormSection>
      <FormSection title="Genres" summary={countSummary(genreIds.size)}>
        <GenreChooser domain={MUSIC_GENRES} selected={genreIds} onChange={setGenreIds} />
      </FormSection>
      <LinksField links={links} onChange={setLinks} />
    </FormDialog>
  );
}
