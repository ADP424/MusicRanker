import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoadingState } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";
import { matchesAny } from "../search/textMatch";
import { CategoryManager } from "./CategoryManager";
import { type GenreDomain, type GenreLike, useGenreKey, useRouteBase } from "./config";
import { findCycles } from "./cycles";
import { GenreForm } from "./GenreForm";
import { GenreTree } from "./GenreTree";

/** {genre id -> the set of category ids "in scope" for it}: a root genre's own
 * category_ids, or (for a non-root genre) the union of that same set walked
 * down from every one of its ancestors — i.e. filtering by a category shows
 * the tagged root(s) plus every descendant beneath them. */
function useCategoryScope(genres: GenreLike[]) {
  return useMemo(() => {
    const byId = new Map(genres.map((g) => [g.id, g]));
    const scope = new Map<number, Set<number>>();
    function scopeOf(id: number, seen = new Set<number>()): Set<number> {
      if (scope.has(id)) return scope.get(id)!;
      if (seen.has(id)) return new Set(); // guard against cyclical data
      seen.add(id);
      const g = byId.get(id);
      if (!g) return new Set();
      const union = new Set(g.category_ids);
      for (const pid of g.parent_ids) for (const cid of scopeOf(pid, seen)) union.add(cid);
      scope.set(id, union);
      return union;
    }
    for (const g of genres) scopeOf(g.id);
    return scope;
  }, [genres]);
}

export function GenresPage({ domain }: { domain: GenreDomain }) {
  const qc = useQueryClient();
  const apiBase = domain.useApiBase();
  const routeBase = useRouteBase(domain);
  const listKey = useGenreKey(domain)();
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const { data: genres = [], isLoading } = domain.useAll();
  const { data: categories = [] } = domain.useCategories();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "tree" ? "tree" : "list";
  const q = params.get("q") ?? "";
  const categoryFilter = params.get("category") ? Number(params.get("category")) : null;
  const set = (patch: Record<string, string | null>) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    return next;
  }, { replace: true });
  const [editing, setEditing] = useState<GenreLike | "new" | null>(null);
  const [deleting, setDeleting] = useState<GenreLike | null>(null);

  const categoryScope = useCategoryScope(genres);
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => genres.filter((g) =>
    (categoryFilter === null || categoryScope.get(g.id)?.has(categoryFilter))
    && (!needle || matchesAny(needle, g.name, ...(g.synonyms ?? []))),
  ), [genres, categoryScope, categoryFilter, needle]);
  const cycles = useMemo(() => findCycles(genres), [genres]);
  const byId = useMemo(() => new Map(genres.map((g) => [g.id, g])), [genres]);

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${apiBase}/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<GenreLike[]>(listKey);
      qc.setQueryData<GenreLike[]>(listKey, (old = []) => old.filter((g) => g.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => qc.setQueryData(listKey, ctx?.prev),
  });

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{domain.heading}s</h1>
          <p className="mt-1 text-sm text-muted-foreground">{genres.length} {domain.noun}</p>
        </div>
        {canCreate && <Button onClick={() => setEditing("new")}><Plus /> Add</Button>}
      </div>

      {cycles.hasCycles && (
        <Card className="gap-2 border-warning/50 bg-warning/10 px-5 py-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 text-warning" />
            {cycles.cycles.length} circular parent {cycles.cycles.length === 1 ? "chain" : "chains"} in this taxonomy
          </p>
          <p className="text-muted-foreground">
            The tree drops the link that closes each loop (drawn dashed) so it can still draw it. Open one to remove the wrong parent.
          </p>
          <ul className="grid gap-1">
            {cycles.cycles.map((loop, i) => (
              <li key={i}>
                {loop.map((id, j) => (
                  <span key={`${id}-${j}`}>
                    {j > 0 && " → "}
                    <button type="button" data-slot="link" className="font-medium underline-offset-2 hover:underline"
                            onClick={() => { const g = byId.get(id); if (g) setEditing(g); }}>
                      {byId.get(id)?.name ?? `#${id}`}
                    </button>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canEdit && <CategoryManager domain={domain} />}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => set({ view: v === "tree" ? "tree" : null })}>
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="tree">Tree</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-48 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-8" placeholder={`Search ${domain.noun}…`} aria-label={`Search ${domain.noun}`}
                 value={q} onChange={(e) => set({ q: e.target.value || null })} />
        </div>
        {categories.length > 0 && (
          <select aria-label="Category" value={categoryFilter ?? ""} onChange={(e) => set({ category: e.target.value || null })}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {(needle || categoryFilter !== null) && (
          <span className="text-sm text-muted-foreground">{visible.length} shown</span>
        )}
      </div>

      {isLoading ? <LoadingState label={`Loading ${domain.noun}…`} /> : view === "list" ? (
        visible.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {genres.length ? `No ${domain.noun} match.` : `No ${domain.noun} yet.`}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border bg-card">
            {[...visible].sort((a, b) => a.name.localeCompare(b.name)).map((g) => (
              <li key={g.id} className="flex items-center gap-3 border-b px-4 py-2 text-sm last:border-b-0">
                <span className="min-w-0 flex-1">
                  <Link to={`${routeBase}/${g.id}`} className="font-medium hover:underline">{g.name}</Link>
                  {g.synonyms?.length ? <span className="text-muted-foreground"> · aka {g.synonyms.join(", ")}</span> : null}
                  {g.parent_ids.length > 0 && (
                    <span className="block truncate text-xs text-muted-foreground">
                      under {g.parent_ids.map((id) => byId.get(id)?.name).filter(Boolean).join(", ")}
                    </span>
                  )}
                </span>
                {(canEdit || canDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${g.name}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEdit && <DropdownMenuItem onSelect={() => setEditing(g)}><Pencil /> Edit</DropdownMenuItem>}
                      {canDelete && <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(g)}><Trash2 /> Delete</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <GenreTree genres={visible} cycles={cycles} onEdit={canEdit ? (g) => setEditing(g) : undefined} />
      )}

      {deleting && (
        <ConfirmDialog
          message={`Delete “${deleting.name}”? Titles tagged with it lose the tag; its child ${domain.noun} stay.`}
          onConfirm={() => { remove.mutate(deleting.id); setDeleting(null); }}
          onCancel={() => setDeleting(null)}
        />
      )}
      {editing && (
        <>
          <GenreForm domain={domain} initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
        </>
      )}
    </div>
  );
}
