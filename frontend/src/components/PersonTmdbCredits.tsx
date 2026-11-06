import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Download, ExternalLink, Link2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { gk } from "../api/keys";
import { CAST_ROLE_LABELS, type CastRole, type PersonTmdb, type PersonTmdbCredit } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { Spinner } from "./Spinner";
import { TmdbImportDialog } from "./TmdbImportDialog";
import { TmdbTelevisionImportDialog } from "./TmdbTelevisionImportDialog";

type Filter = "all" | "unlinked" | "missing";

// Talk shows, documentaries about them, archive footage, "thanks": real credits,
// but not ones the catalog would link.
const APPEARANCE = /^(self|himself|herself|themselves)\b|archiv|thanks|in memory/i;
const isAppearance = (c: PersonTmdbCredit) => c.roles.every((r) => APPEARANCE.test(r.label));

const status = (c: PersonTmdbCredit) =>
  c.local_id == null ? "missing" : c.linked_roles.length ? "linked" : "unlinked";

/** The person's whole TMDB filmography against the catalog: what's linked, what's
 *  in the catalog but not linked to them (Link), and what isn't in the catalog
 *  (Import). Fetched on demand, since it calls out to TMDB. */
export function PersonTmdbCredits({ personId, personName }: { personId: number; personName: string }) {
  const { guildId, base } = useGuildApi();
  const navigate = useNavigate();
  const canEdit = useCan("catalog_edit");
  const canCreate = useCan("catalog_create");
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState<PersonTmdbCredit | null>(null);
  const [showAppearances, setShowAppearances] = useState(false);

  const q = useQuery({
    queryKey: gk(guildId, "people", personId, "tmdb-credits"),
    queryFn: () => api.get<PersonTmdb>(`${base}/persons/${personId}/tmdb-credits`),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const setId = useMutation({
    mutationFn: (tmdbId: number | null) => api.put(`${base}/persons/${personId}/tmdb-id`, { tmdb_id: tmdbId }),
  });
  const link = useMutation({
    mutationFn: ({ c, role }: { c: PersonTmdbCredit; role: CastRole }) =>
      api.put(`${base}/${c.media === "movie" ? "movies" : "television/shows"}/${c.local_id}/persons/${personId}/${role}`),
    onSuccess: (_, { c, role }) => toast.success(`Linked as ${CAST_ROLE_LABELS[role]} on ${c.title}`),
  });

  if (!open) {
    return (
      <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="font-medium">TMDB filmography</p>
          <p className="text-sm text-muted-foreground">
            Everything TMDB credits {personName} with, and which of it is in the catalog and linked.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Compare with TMDB</Button>
      </Card>
    );
  }

  const data = q.data;
  const appearances = (data?.credits ?? []).filter(isAppearance).length;
  const credits = (data?.credits ?? []).filter((c) =>
    (filter === "all" || status(c) === filter) && (showAppearances || !isAppearance(c) || status(c) === "linked"));
  const counts = {
    linked: data?.credits.filter((c) => status(c) === "linked").length ?? 0,
    unlinked: data?.credits.filter((c) => status(c) === "unlinked").length ?? 0,
    missing: data?.credits.filter((c) => status(c) === "missing").length ?? 0,
  };

  return (
    <Card className="gap-4 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {data?.profile_url && <img src={data.profile_url} alt="" className="size-12 rounded-full object-cover" />}
          <div>
            <p className="font-medium">TMDB filmography</p>
            {data?.tmdb_id != null && (
              <p className="text-sm text-muted-foreground">
                {counts.linked} linked · {counts.unlinked} in the catalog, not linked · {counts.missing} not in the catalog
              </p>
            )}
          </div>
        </div>
        {data?.tmdb_id != null && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <a href={`https://www.themoviedb.org/person/${data.tmdb_id}`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> TMDB
              </a>
            </Button>
            {canEdit && (
              <Button variant="ghost" size="sm" disabled={setId.isPending}
                      title="This isn't them: forget the TMDB person and search again"
                      onClick={() => setId.mutate(null)}>
                <RefreshCw className="size-4" /> Wrong person?
              </Button>
            )}
          </div>
        )}
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-6"><Spinner label="Asking TMDB…" /></div>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : data && data.tmdb_id == null ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            {data.candidates.length
              ? `Which TMDB person is ${personName}?${canEdit ? "" : " (Someone who can edit the catalog has to pick.)"}`
              : `TMDB has no one called ${personName}.`}
          </p>
          <ul className="grid gap-1.5">
            {data.candidates.map((p) => (
              <li key={p.tmdb_id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                {p.profile_url
                  ? <img src={p.profile_url} alt="" className="size-10 rounded-full object-cover" />
                  : <span className="size-10 rounded-full bg-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.name} {p.department && <span className="font-normal text-muted-foreground">· {p.department}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{p.known_for.join(", ") || "—"}</p>
                </div>
                <Button variant="ghost" size="icon" asChild aria-label={`${p.name} on TMDB`}>
                  <a href={`https://www.themoviedb.org/person/${p.tmdb_id}`} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
                {canEdit && (
                  <Button size="sm" disabled={setId.isPending} onClick={() => setId.mutate(p.tmdb_id)}>This is them</Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : data ? (
        <>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All ({data.credits.length})</TabsTrigger>
              <TabsTrigger value="unlinked">Not linked ({counts.unlinked})</TabsTrigger>
              <TabsTrigger value="missing">Not in catalog ({counts.missing})</TabsTrigger>
            </TabsList>
          </Tabs>
          {appearances > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showAppearances} onChange={(e) => setShowAppearances(e.target.checked)} />
              Show {appearances} appearance{appearances === 1 ? "" : "s"} as themselves, archive footage and thanks
            </label>
          )}
          <ul className="max-h-[40rem] divide-y overflow-y-auto rounded-md border">
            {credits.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">Nothing here.</li>}
            {credits.map((c) => {
              const st = status(c);
              const linkable = [...new Set(c.roles.map((r) => r.role).filter((r): r is CastRole => !!r))]
                .filter((r) => !c.linked_roles.includes(r));
              const path = c.media === "movie" ? "movies" : "television/shows";
              return (
                <li key={`${c.media}-${c.tmdb_id}`} className="flex items-center gap-3 px-3 py-2">
                  {c.poster_url
                    ? <img src={c.poster_url} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />
                    : <span className="h-12 w-8 shrink-0 rounded bg-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {c.local_id != null
                        ? <Link to={`/g/${guildId}/${path}/${c.local_id}`} className="font-medium hover:underline">{c.title}</Link>
                        : <span className="font-medium">{c.title}</span>}
                      <span className="text-muted-foreground"> · {c.year ?? "—"}</span>
                      <Badge variant="outline" className="ml-2 align-middle">{c.media === "movie" ? "Movie" : "TV"}</Badge>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{c.roles.map((r) => r.label).join(" · ")}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {c.linked_roles.map((r) => (
                      <Badge key={r} variant="secondary" className="gap-1"><Check className="size-3" />{CAST_ROLE_LABELS[r]}</Badge>
                    ))}
                    {st !== "missing" && canEdit && linkable.map((r) => (
                      <Button key={r} variant="outline" size="sm" disabled={link.isPending}
                              onClick={() => link.mutate({ c, role: r })}>
                        <Link2 className="size-3.5" /> Link as {CAST_ROLE_LABELS[r]}
                      </Button>
                    ))}
                    {st === "missing" && canCreate && (
                      <Button variant="outline" size="sm" onClick={() => setImporting(c)}>
                        <Download className="size-3.5" /> Import
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {importing && (
        importing.media === "movie" ? (
            <TmdbImportDialog
              initial={{ tmdbId: importing.tmdb_id, title: importing.title, year: importing.year }}
              onClose={() => setImporting(null)}
              onSuccess={(id) => { setImporting(null); toast.success(`Imported ${importing.title}`, {
                action: { label: "Open", onClick: () => navigate(`/g/${guildId}/movies/${id}`) } }); }}
            />
          ) : (
            <TmdbTelevisionImportDialog
              initial={{ tmdbId: importing.tmdb_id, title: importing.title, year: importing.year }}
              onClose={() => setImporting(null)}
              onSuccess={(id) => { setImporting(null); toast.success(`Imported ${importing.title}`, {
                action: { label: "Open", onClick: () => navigate(`/g/${guildId}/television/shows/${id}`) } }); }}
            />
          )
      )}
    </Card>
  );
}
