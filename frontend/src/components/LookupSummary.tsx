import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import type { LookupCandidate } from "../api/types";

/** Under an import dialog's title: the poster and synopsis TMDB/IGDB gave, a
 * warning before anything is reviewed when the title is already in the
 * catalog, and the other search results to switch to. */
export function LookupSummary({ image, overview, existing, candidates = [], onPick, busy = false }: {
  image: string | null | undefined;
  overview: string | null | undefined;
  existing?: { to: string; label: string } | null;
  candidates?: LookupCandidate[];
  onPick?: (c: LookupCandidate) => void;
  busy?: boolean;
}) {
  if (!image && !overview && !existing && candidates.length === 0) return null;
  return (
    <div className="mb-3 grid gap-3">
      {existing && (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <TriangleAlert className="size-4 shrink-0 text-warning" />
          <span>This looks like it's already in the catalog.</span>
          <Link className="ml-auto font-medium underline" to={existing.to}>{existing.label}</Link>
        </p>
      )}
      {(image || overview) && (
        <div className="flex gap-3">
          {image && <img src={image} alt="" loading="lazy" className="h-36 w-24 shrink-0 rounded-md border object-cover" />}
          {overview && <p className="line-clamp-6 text-sm text-muted-foreground">{overview}</p>}
        </div>
      )}
      {candidates.length > 0 && onPick && (
        <div className="grid gap-1.5">
          <p className="text-xs text-muted-foreground">Not the right one? Other matches:</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {candidates.map((c) => {
              const pic = c.poster_url ?? c.cover_url;
              return (
                <button key={c.tmdb_id ?? c.igdb_id} type="button" disabled={busy} onClick={() => onPick(c)}
                        className="flex w-24 shrink-0 cursor-pointer flex-col gap-1 rounded-md border p-1.5 text-left text-xs hover:border-primary disabled:opacity-50">
                  {pic
                    ? <img src={pic} alt="" loading="lazy" className="h-24 w-full rounded-sm object-cover" />
                    : <span className="flex h-24 w-full items-center justify-center rounded-sm bg-muted text-muted-foreground">?</span>}
                  <span className="line-clamp-2 font-medium">{c.title}</span>
                  <span className="text-muted-foreground">{c.year ?? "—"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
