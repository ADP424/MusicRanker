import { useMutation } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "../../api/client";
import { useGuildApi } from "../../api/hooks";
import { useCan } from "../../guild/GuildProvider";
import { Empty, Section } from "./DetailKit";

/**
 * Genres (or a game's platforms) on a detail page: badges linking to each, and
 * for catalog editors a chooser whose ticks apply immediately through
 * `<path>/<ownerId>/<segment>/<id>`.
 */
export function TaxonomySection({ title = "Genres", path, ownerId, segment = "genres", ids, names, linkTo, chooser }: {
  title?: string;
  /** "movies", "television/episodes", ... */
  path: string;
  ownerId: number;
  segment?: "genres" | "platforms";
  ids: number[];
  /** id -> name, for the ones to show. */
  names: Map<number, string>;
  /** Guild-relative page of one genre/platform. */
  linkTo: (id: number) => string;
  chooser: (selected: Set<number>, onChange: (next: Set<number>) => void) => ReactNode;
}) {
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  // Ticks show at once; the server catches up behind them.
  const [optimistic, setOptimistic] = useState<Set<number> | null>(null);
  const selected = optimistic ?? new Set(ids);

  const set = useMutation({
    mutationFn: async ({ add, remove }: { add: number[]; remove: number[] }) => {
      for (const id of add) await api.put(`${base}/${path}/${ownerId}/${segment}/${id}`);
      for (const id of remove) await api.delete(`${base}/${path}/${ownerId}/${segment}/${id}`);
    },
    onSettled: () => setOptimistic(null),
  });

  const change = (next: Set<number>) => {
    const add = [...next].filter((id) => !selected.has(id));
    const remove = [...selected].filter((id) => !next.has(id));
    setOptimistic(next);
    set.mutate({ add, remove });
  };

  const shown = [...selected].filter((id) => names.has(id)).sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));

  return (
    <Section
      title={title}
      busy={set.isPending}
      actions={canEdit && (
        <Button variant={editing ? "default" : "outline"} size="sm" onClick={() => setEditing((e) => !e)}>
          {editing ? "Done" : <><Pencil className="size-4" /> Edit</>}
        </Button>
      )}
    >
      {shown.length === 0 ? <Empty>None yet.</Empty> : (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((id) => (
            <Badge key={id} variant="secondary" asChild>
              <Link to={`/g/${guildId}/${linkTo(id)}`}>{names.get(id)}</Link>
            </Badge>
          ))}
        </div>
      )}
      {editing && chooser(selected, change)}
    </Section>
  );
}
