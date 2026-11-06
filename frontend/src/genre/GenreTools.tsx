import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { api, Batch } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { gk } from "../api/keys";
import { ChipCheck, ChipList, FormDialog } from "../components/form/FormKit";
import type { GenreDomain, GenreLike } from "./config";

/** Fold another entry into this one: its titles, parents and children move here and its name becomes a synonym. */
export function MergeTaxonDialog({ domain, keep, onClose }: { domain: GenreDomain; keep: GenreLike; onClose: () => void }) {
  const apiBase = domain.useApiBase();
  const { data: all = [] } = domain.useAll();
  const [q, setQ] = useState("");
  const [dupId, setDupId] = useState<number | null>(null);
  const others = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((g) => g.id !== keep.id && (!needle || g.name.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 80);
  }, [all, keep.id, q]);
  const dup = all.find((g) => g.id === dupId);
  const merge = useMutation({
    meta: { errorToast: false },
    mutationFn: () => api.post<{ moved: number }>(`${apiBase}/${keep.id}/merge`, { duplicate_id: dupId }),
    onSuccess: () => {
      toast.success(`Merged ${dup?.name} into ${keep.name}`);
      onClose();
    },
  });

  return (
    <FormDialog
      title={`Merge into ${keep.name}`}
      onClose={onClose}
      onSubmit={() => merge.mutate()}
      busy={merge.isPending}
      error={merge.error}
      submitDisabled={dupId == null}
      submitLabel={dup ? `Merge ${dup.name}` : "Merge"}
      busyLabel="Merging…"
    >
      <p className="text-sm text-muted-foreground">
        Everything tagged with the duplicate moves to {keep.name}, its name is kept as a synonym, and it's deleted.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" autoFocus className="pl-8" placeholder={`Find the duplicate…`} aria-label="Find the duplicate"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ChipList>
        {others.map((g) => (
          <ChipCheck key={g.id} checked={dupId === g.id} onChange={(on) => setDupId(on ? g.id : null)}>{g.name}</ChipCheck>
        ))}
        {others.length === 0 && <span className="text-xs text-muted-foreground">Nothing matches.</span>}
      </ChipList>
    </FormDialog>
  );
}

/** What a domain's entries tag: where to search for titles, and the path that tags one. */
const TAGGABLE: Record<string, { kind: string; path: string; segment: string; noun: string }> = {
  genres: { kind: "album", path: "albums", segment: "genres", noun: "albums" },
  "movie-genres": { kind: "movie", path: "movies", segment: "genres", noun: "movies" },
  "game-genres": { kind: "game", path: "games", segment: "genres", noun: "games" },
  "television-genres": { kind: "show", path: "television/shows", segment: "genres", noun: "shows" },
  "book-genres": { kind: "book", path: "books", segment: "genres", noun: "books" },
  "game-platforms": { kind: "game", path: "games", segment: "platforms", noun: "games" },
};

interface Hit { id: number; name: string; year: number | null; context: string | null }

/** Tag many titles with this entry at once. */
export function TagTitlesDialog({ domain, taxon, onClose }: { domain: GenreDomain; taxon: GenreLike; onClose: () => void }) {
  const { guildId, base } = useGuildApi();
  const cfg = TAGGABLE[domain.key];
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<Map<number, Hit>>(new Map());
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const { data: hits = [] } = useQuery({
    queryKey: gk(guildId, "search", cfg.kind, term),
    queryFn: () => api.get<Hit[]>(`${base}/search?q=${encodeURIComponent(term)}&kinds=${cfg.kind}`),
    enabled: term.length > 0,
  });
  const shown = [...picked.values(), ...hits.filter((h) => !picked.has(h.id))];

  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => {
      const b = new Batch();
      for (const id of picked.keys()) b.put(`${base}/${cfg.path}/${id}/${cfg.segment}/${taxon.id}`);
      await b.run();
    },
    onSuccess: () => {
      toast.success(`Tagged ${picked.size} ${picked.size === 1 ? cfg.noun.slice(0, -1) : cfg.noun} with ${taxon.name}`);
      onClose();
    },
  });

  return (
    <FormDialog
      title={`Tag ${cfg.noun} with ${taxon.name}`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      busy={save.isPending}
      error={save.error}
      submitDisabled={picked.size === 0}
      submitLabel={picked.size ? `Tag ${picked.size}` : "Tag"}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" autoFocus className="pl-8" placeholder={`Search ${cfg.noun}…`} aria-label={`Search ${cfg.noun}`}
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ChipList>
        {shown.map((h) => (
          <ChipCheck key={h.id} checked={picked.has(h.id)} onChange={(on) => {
            const next = new Map(picked);
            if (on) next.set(h.id, h); else next.delete(h.id);
            setPicked(next);
          }}>
            {h.name}
            {(h.context || h.year) && <span className="text-muted-foreground">({[h.context, h.year].filter(Boolean).join(", ")})</span>}
          </ChipCheck>
        ))}
        {shown.length === 0 && <span className="text-xs text-muted-foreground">Search to find {cfg.noun}. You can search several times; ticks are kept.</span>}
      </ChipList>
    </FormDialog>
  );
}
