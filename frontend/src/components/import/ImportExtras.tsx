import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api, Batch } from "../../api/client";
import { useGuildApi } from "../../api/hooks";
import { gk } from "../../api/keys";
import type { TmdbTvPerson } from "../../api/types";
import { CAST_ROLE_LABELS } from "../../api/types";
import type { GenreDomain, GenreLike } from "../../genre/config";
import { useCan } from "../../guild/GuildProvider";
import { ChipCheck } from "../form/FormKit";
import { ImportSection } from "./ImportKit";
import { TmdbPersonRow } from "./ImportPersonRow";
import { toRow } from "../tmdbTvShared";

const names = (list: { name: string }[]) =>
  list.slice(0, 6).map((p) => p.name).join(", ") + (list.length > 6 ? ` and ${list.length - 6} more` : "");

/** After an import: who was created and who was reused, so a wrong guess can be caught. */
export function importSummary(
  title: string,
  result: { created_people: { name: string }[]; reused_people: { name: string }[] },
) {
  const { created_people: created, reused_people: reused } = result;
  const parts = [
    created.length > 0 && `New: ${names(created)}.`,
    reused.length > 0 && `Already in the catalog: ${names(reused)}.`,
  ].filter(Boolean);
  toast.success(`Imported ${title}`, {
    description: parts.join(" ") || "No people were added.",
    duration: 10_000,
  });
}

/**
 * The provider's genres with no match here. Each can be pointed at an existing
 * entry (saved as a synonym, so it matches by itself next time) or created.
 */
export function UnmappedMapper({ source, noun, names: unmapped, domain, onMapped }: {
  source: string;
  noun: string;
  names: string[];
  domain: GenreDomain;
  /** The entry now standing for the name: tick it for this import. */
  onMapped: (id: number) => void;
}) {
  const canEdit = useCan("catalog_edit");
  const canCreate = useCan("catalog_create");
  const apiBase = domain.useApiBase();
  const { data: all = [] } = domain.useAll();
  const [done, setDone] = useState<Set<string>>(new Set());
  const sorted = useMemo(() => [...all].sort((a, b) => a.name.localeCompare(b.name)), [all]);

  const map = useMutation({
    meta: { errorToast: true },
    mutationFn: async ({ name, target }: { name: string; target: GenreLike | null }) => {
      if (target) {
        await api.patch(`${apiBase}/${target.id}`, { synonyms: [...(target.synonyms ?? []), name] });
        return target.id;
      }
      const created = await api.post<GenreLike>(apiBase, {
        name, synonyms: null, notes: null, ...(domain.mediaTypeFlag ? { [domain.mediaTypeFlag]: true } : {}),
      });
      return created.id;
    },
    onSuccess: (id, { name }) => {
      setDone((prev) => new Set(prev).add(name));
      onMapped(id);
    },
  });

  const left = unmapped.filter((n) => !done.has(n));
  if (left.length === 0) return null;
  return (
    <div className="grid gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm">
      <p className="text-xs text-muted-foreground">{source} {noun} with no match here:</p>
      {left.map((name) => (
        <div key={name} className="flex flex-wrap items-center gap-2">
          <span className="min-w-32 font-medium">{name}</span>
          {canEdit && (
            <select aria-label={`Map ${name} to`} className="h-7 max-w-56 py-0 text-xs" value="" disabled={map.isPending}
                    onChange={(e) => {
                      const target = all.find((g) => g.id === Number(e.target.value));
                      if (target) map.mutate({ name, target });
                    }}>
              <option value="">Same as…</option>
              {sorted.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          {canCreate && (
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={map.isPending}
                    onClick={() => map.mutate({ name, target: null })}>
              <Plus /> Create it
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export type WorkKind = "movie" | "television_show" | "game";
interface Hit { kind: string; id: number; name: string; year: number | null; context: string | null }

/**
 * Albums and books in the catalog whose name resembles the title being imported:
 * maybe its soundtrack, or what it's based on. Nothing is linked unless ticked.
 */
export function useWorkLinks(title: string | undefined) {
  const { guildId, base } = useGuildApi();
  const term = (title ?? "").split(":")[0].trim();
  const { data: hits = [] } = useQuery({
    queryKey: gk(guildId, "search", "import-links", term),
    queryFn: () => api.get<Hit[]>(`${base}/search?q=${encodeURIComponent(term)}&kinds=album&kinds=book`),
    enabled: term.length >= 2,
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const key = (h: Hit) => `${h.kind}:${h.id}`;

  return {
    section: hits.length === 0 ? null : (
      <ImportSection title="Link to the catalog" hint="These share a name with this title. Tick any that belong to it.">
        <div className="flex flex-wrap gap-1.5">
          {hits.map((h) => (
            <ChipCheck key={key(h)} checked={picked.has(key(h))} onChange={(on) => {
              const next = new Set(picked);
              if (on) next.add(key(h)); else next.delete(key(h));
              setPicked(next);
            }}>
              <span className="text-muted-foreground">{h.kind === "album" ? "Soundtrack:" : "Based on:"}</span>
              {h.name}
              {(h.context || h.year) && <span className="text-muted-foreground">({[h.context, h.year].filter(Boolean).join(", ")})</span>}
            </ChipCheck>
          ))}
        </div>
      </ImportSection>
    ),
    /** Writes the ticked links once the new title's id is known. A failure here
     *  doesn't undo the import, so it only warns. */
    async commit(kind: WorkKind, id: number) {
      const chosen = hits.filter((h) => picked.has(key(h)));
      if (chosen.length === 0) return;
      const b = new Batch();
      for (const h of chosen) {
        b.put(h.kind === "album" ? `${base}/albums/${h.id}/soundtracks/${kind}/${id}` : `${base}/books/${h.id}/adaptations/${kind}/${id}`);
      }
      await b.run().catch((e: Error) => toast.warning(`Imported, but the links weren't saved: ${e.message}`));
    },
  };
}

/**
 * The people a show or season import credits on its episodes without asking
 * (their director and composer). Anyone who only matches someone by name is
 * listed to be confirmed; everyone unmatched becomes a new person.
 */
export function EpisodeCrewReview({ episodes, resolutions, onResolve }: {
  episodes: { episode_number: number; season_number: number; people: TmdbTvPerson[] }[];
  resolutions: Record<number, number | null>;
  onResolve: (tmdbId: number, personId: number | null) => void;
}) {
  const { doubtful, brandNew } = useMemo(() => {
    const seen = new Map<number, { person: TmdbTvPerson; where: string[] }>();
    for (const e of episodes) {
      for (const p of e.people) {
        const entry = seen.get(p.tmdb_id) ?? { person: p, where: [] };
        entry.where.push(`S${e.season_number}E${e.episode_number}`);
        seen.set(p.tmdb_id, entry);
      }
    }
    const all = [...seen.values()];
    const known = (p: TmdbTvPerson) => p.parent_person_id != null || p.db_matches.some((m) => m.filmography_overlap);
    return {
      doubtful: all.filter(({ person: p }) => !known(p) && p.db_matches.length > 0),
      brandNew: all.filter(({ person: p }) => !known(p) && p.db_matches.length === 0).map(({ person }) => person),
    };
  }, [episodes]);

  if (doubtful.length === 0 && brandNew.length === 0) return null;
  return (
    <ImportSection
      title="Episode crew to check"
      count={doubtful.length > 0 ? `${doubtful.length} to confirm` : undefined}
      hint={brandNew.length > 0 ? `New people this will create: ${names(brandNew)}.` : undefined}
    >
      {doubtful.length > 0 && (
        <div className="grid gap-1.5">
          {doubtful.map(({ person: p, where }) => (
            <TmdbPersonRow
              key={p.tmdb_id}
              person={toRow(p)}
              groupName={`crew-${p.tmdb_id}`}
              role={p.suggested_role}
              resolution={resolutions[p.tmdb_id]}
              note={`${CAST_ROLE_LABELS[p.suggested_role]} on ${where.slice(0, 5).join(", ")}${where.length > 5 ? ` and ${where.length - 5} more` : ""}`}
              onRoleChange={() => undefined}
              onResolve={(id) => onResolve(p.tmdb_id, id)}
            />
          ))}
        </div>
      )}
    </ImportSection>
  );
}
