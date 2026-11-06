import { useMutation } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { useCan } from "../guild/GuildProvider";
import { Spinner } from "./Spinner";

/** The poster/cover and synopsis at the top of a detail page, with a link to
 * the provider and, for editors, a refresh that fills them in. */
export function MediaHero({ image, overview, external, refresh }: {
  image: string | null | undefined;
  overview: string | null | undefined;
  external?: { href: string; label: string } | null;
  /** e.g. { path: "movies/12/tmdb-refresh", source: "TMDB" } */
  refresh?: { path: string; source: string } | null;
}) {
  const { base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [expanded, setExpanded] = useState(false);
  const run = useMutation({
    mutationFn: () => api.post<{ filled: string[] }>(`${base}/${refresh!.path}`),
    onSuccess: (r) => toast.success(r.filled.length ? `Updated from ${refresh!.source}` : `Already up to date with ${refresh!.source}`),
  });

  const showRefresh = canEdit && refresh;
  if (!image && !overview && !external && !showRefresh) return null;
  return (
    <div className="mb-5 flex gap-4">
      {image && (
        <img src={image} alt="" loading="lazy"
             className="h-44 w-30 shrink-0 rounded-lg border object-cover shadow-sm sm:h-52 sm:w-36" />
      )}
      <div className="flex min-w-0 flex-col gap-2">
        {overview ? (
          <p className={`max-w-3xl text-sm leading-relaxed text-muted-foreground ${expanded ? "" : "line-clamp-5"}`}>
            {overview}
          </p>
        ) : !image && showRefresh ? (
          <p className="text-sm text-muted-foreground">No poster or synopsis yet.</p>
        ) : null}
        {overview && overview.length > 400 && (
          <button type="button" className="w-fit cursor-pointer text-xs text-muted-foreground hover:underline"
                  onClick={() => setExpanded((e) => !e)}>{expanded ? "Less" : "More"}</button>
        )}
        <div className="mt-auto flex flex-wrap gap-2">
          {external && (
            <Button asChild variant="outline" size="sm">
              <a href={external.href} target="_blank" rel="noreferrer">{external.label} <ExternalLink /></a>
            </Button>
          )}
          {showRefresh && (
            <Button variant="ghost" size="sm" disabled={run.isPending} onClick={() => run.mutate()}
                    title={`Fetch the synopsis and ${refresh.source === "IGDB" ? "cover" : "poster"} from ${refresh.source}`}>
              {run.isPending ? <Spinner size="sm" /> : <RefreshCw />} Refresh from {refresh.source}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
