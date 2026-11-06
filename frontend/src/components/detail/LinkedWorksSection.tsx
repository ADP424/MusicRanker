import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "../../api/client";
import { useGuildApi } from "../../api/hooks";
import { gk } from "../../api/keys";
import type { NamedRef } from "../../api/types";
import { useCan } from "../../guild/GuildProvider";
import { Empty, Section } from "./DetailKit";

type WorkKind = "movie" | "television_show" | "game";
const KINDS: { kind: WorkKind; label: string; search: string; route: string }[] = [
  { kind: "movie", label: "Movies", search: "movie", route: "movies" },
  { kind: "television_show", label: "TV shows", search: "show", route: "television/shows" },
  { kind: "game", label: "Games", search: "game", route: "games" },
];

interface Hit { id: number; name: string; name_en: string | null; year: number | null }

/**
 * Movies, shows and games tied to this entry: what a book was adapted into,
 * what an album is the soundtrack for. Editors find works with the guild
 * search and link them through `<path>/<kind>/<id>`.
 */
export function LinkedWorksSection({ title, path, linked, emptyText }: {
  title: string;
  /** "books/12/adaptations" or "albums/7/soundtracks". */
  path: string;
  linked: Record<WorkKind, NamedRef[]>;
  emptyText: string;
}) {
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<WorkKind>("movie");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const active = KINDS.find((k) => k.kind === kind)!;
  const hits = useQuery({
    queryKey: gk(guildId, "search", active.search, term),
    queryFn: () => api.get<Hit[]>(`${base}/search?kinds=${active.search}&limit=12&q=${encodeURIComponent(term)}`),
    enabled: editing && term.length > 0,
    placeholderData: (prev) => prev,
  });
  const link = useMutation({ mutationFn: ({ k, id }: { k: WorkKind; id: number }) => api.put(`${base}/${path}/${k}/${id}`) });
  const unlink = useMutation({ mutationFn: ({ k, id }: { k: WorkKind; id: number }) => api.delete(`${base}/${path}/${k}/${id}`) });

  const total = KINDS.reduce((n, k) => n + linked[k.kind].length, 0);
  const linkedIds = new Set(linked[kind].map((r) => r.id));

  return (
    <Section
      title={title}
      count={total || undefined}
      busy={link.isPending || unlink.isPending}
      actions={canEdit && (
        <Button variant={editing ? "default" : "outline"} size="sm" onClick={() => setEditing((e) => !e)}>
          {editing ? "Done" : <><Pencil className="size-4" /> Edit</>}
        </Button>
      )}
    >
      {total === 0 ? <Empty>{emptyText}</Empty> : (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[6rem_1fr]">
          {KINDS.filter((k) => linked[k.kind].length).map((k) => (
            <div key={k.kind} className="contents">
              <dt className="text-muted-foreground">{k.label}</dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-1">
                {linked[k.kind].map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1">
                    <Link to={`/g/${guildId}/${k.route}/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    {editing && (
                      <button type="button" aria-label={`Unlink ${r.name}`} data-slot="icon"
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={() => unlink.mutate({ k: k.kind, id: r.id })}>
                        <X className="size-3.5" />
                      </button>
                    )}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {editing && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="Kind">
              {KINDS.map((k) => (
                <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} data-slot="chip"
                        onClick={() => setKind(k.kind)}
                        className={cn("rounded px-2.5 py-1 text-xs", kind === k.kind ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
                  {k.label}
                </button>
              ))}
            </div>
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" className="pl-8" placeholder={`Find ${active.label.toLowerCase()} in the catalog…`}
                     aria-label="Find in the catalog" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {term && (
            <ul className="divide-y rounded-md border text-sm">
              {(hits.data ?? []).length === 0 && !hits.isFetching && (
                <li className="px-3 py-2 text-muted-foreground">Nothing in the catalog matches.</li>
              )}
              {(hits.data ?? []).map((h) => {
                const on = linkedIds.has(h.id);
                return (
                  <li key={h.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate">
                      {h.name}{h.year && <span className="text-muted-foreground"> · {h.year}</span>}
                    </span>
                    <Button size="sm" variant={on ? "secondary" : "outline"} disabled={link.isPending || unlink.isPending}
                            onClick={() => (on ? unlink : link).mutate({ k: kind, id: h.id })}>
                      {on ? <><X className="size-3.5" /> Unlink</> : <><Plus className="size-3.5" /> Link</>}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}
