import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { gk } from "../api/keys";
import type { GenreDomain } from "./config";

interface Item {
  id: number; name: string; name_en: string | null; year: number | null; context: string | null;
  in_my_list: boolean; my_position: number | null; direct: boolean;
}

/** Where each domain's titles live, for links. */
const ITEM_ROUTE: Record<string, string> = {
  genres: "music/albums", "movie-genres": "movies", "game-genres": "games",
  "television-genres": "television/shows", "book-genres": "books", "game-platforms": "games",
};
const NOUN: Record<string, string> = {
  genres: "albums", "movie-genres": "movies", "game-genres": "games",
  "television-genres": "shows", "book-genres": "books", "game-platforms": "games",
};

/** The titles in a genre (and its sub-genres), yours first in your order. */
export function GenreItems({ domain, gid }: { domain: GenreDomain; gid: number }) {
  const { guildId, base } = useGuildApi();
  const { data, isLoading } = useQuery({
    queryKey: gk(guildId, domain.key, gid, "items"),
    queryFn: () => api.get<{ sub_genres: number; items: Item[] }>(`${base}/taxonomy-items/${domain.key}/${gid}`),
  });
  const noun = NOUN[domain.key] ?? "titles";
  if (isLoading) return <Skeleton className="mt-6 h-40" />;
  if (!data) return null;
  const mine = data.items.filter((i) => i.in_my_list).length;

  return (
    <section className="mt-6 grid gap-2">
      <h2>
        {data.items.length} {noun}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {mine} in your list{data.sub_genres > 0 && ` · including ${data.sub_genres} ${domain.noun} beneath this one`}
        </span>
      </h2>
      {data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is tagged with this yet.</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border bg-card">
          {data.items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {it.my_position != null ? `#${it.my_position}` : ""}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <Link className="font-medium hover:underline" to={`/g/${guildId}/${ITEM_ROUTE[domain.key]}/${it.id}`}>
                  {it.name}{it.name_en && <span className="font-normal text-muted-foreground"> ({it.name_en})</span>}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">{[it.context, it.year].filter(Boolean).join(" · ")}</span>
              </span>
              {!it.direct && <Badge variant="outline" className="text-muted-foreground" title="Tagged with a genre beneath this one">sub-genre</Badge>}
              {it.in_my_list && it.my_position == null && <Badge variant="secondary">In your list</Badge>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
