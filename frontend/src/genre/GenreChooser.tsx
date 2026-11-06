import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { api } from "../api/client";
import { ChipCheck, ChipList, FilterChip } from "../components/form/FormKit";
import { LoadingState } from "../components/Spinner";
import { type GenreDomain, type GenreLike, useGenreKey } from "./config";

/**
 * Reusable hierarchical-taxonomy picker with:
 *  - a search bar
 *  - a category filter dropdown (defaults to "All"), which narrows...
 *  - ...the root filter chips (entries with no parents) shown below it
 *  - selecting a root filter shows ALL descendants, not just direct children
 *  - checkbox chips for the matching entries
 *
 * Shared by the music-genre, movie-genre, game-genre and game-platform
 * features via the `domain` prop; all user-facing nouns come from
 * `domain.noun`.
 */
export function GenreChooser(props: {
  domain: GenreDomain;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  /** If true, only a single genre can be selected (set of 0 or 1). */
  single?: boolean;
  /** Exclude this genre *and its descendants* (used for a genre's own parent picker). */
  excludeId?: number;
}) {
  const { domain, selected, onChange, single, excludeId } = props;
  const apiBase = domain.useApiBase();
  const key = useGenreKey(domain);
  const { data: allGenres = [], isLoading: genresLoading } = domain.useAll();
  const { data: categories = [] } = domain.useCategories();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [parentFilter, setParentFilter] = useState<number | null>(null);

  const { data: rootGenres = [] } = useQuery({
    queryKey: key("roots"),
    queryFn: () => api.get<GenreLike[]>(`${apiBase}/roots`),
  });

  // Fetch ALL descendants of the active filter (not just direct children)
  const { data: descendants = [], isLoading: descendantsLoading } = useQuery({
    queryKey: key(parentFilter, "descendants"),
    queryFn: () => api.get<GenreLike[]>(`${apiBase}/${parentFilter}/descendants`),
    enabled: parentFilter !== null,
  });
  // A root is part of its own scope — otherwise filtering by "Rock" makes
  // "Rock" itself unselectable. (Memoised: a fresh Set each render would
  // invalidate the `candidates` memo on every keystroke.)
  const scopeIds = useMemo(
    () => (parentFilter === null ? null : new Set<number>([parentFilter, ...descendants.map((g) => g.id)])),
    [parentFilter, descendants],
  );

  // A genre's "effective" categories are the union of categories carried by
  // its root ancestors (categories are only ever assigned to root entries).
  // Walk each genre's parent_ids up to its root(s) via BFS over allGenres.
  const genreById = useMemo(() => new Map(allGenres.map((g) => [g.id, g])), [allGenres]);

  // Nothing at or below `excludeId` may become its own ancestor. Excluding the
  // whole subtree — not just the entry itself — keeps this picker in step with
  // the server's cycle guard, so a selection can never come back as a 409.
  const blockedIds = useMemo(() => {
    if (excludeId === undefined) return null;
    const childrenOf = new Map<number, number[]>();
    for (const g of allGenres) {
      for (const pid of g.parent_ids) {
        const list = childrenOf.get(pid);
        if (list) list.push(g.id);
        else childrenOf.set(pid, [g.id]);
      }
    }
    const blocked = new Set<number>([excludeId]);
    const queue = [excludeId];
    while (queue.length) {
      const id = queue.pop()!;
      for (const child of childrenOf.get(id) ?? []) {
        if (blocked.has(child)) continue; // also terminates on already-cyclical data
        blocked.add(child);
        queue.push(child);
      }
    }
    return blocked;
  }, [excludeId, allGenres]);
  const effectiveCategoryIds = useMemo(() => {
    const cache = new Map<number, Set<number>>();
    function resolve(id: number, seen = new Set<number>()): Set<number> {
      if (cache.has(id)) return cache.get(id)!;
      if (seen.has(id)) return new Set(); // guard against cyclical data
      seen.add(id);
      const g = genreById.get(id);
      if (!g) return new Set();
      if (g.parent_ids.length === 0) {
        const own = new Set(g.category_ids);
        cache.set(id, own);
        return own;
      }
      const union = new Set<number>();
      for (const pid of g.parent_ids) for (const cid of resolve(pid, seen)) union.add(cid);
      cache.set(id, union);
      return union;
    }
    const map = new Map<number, Set<number>>();
    for (const g of allGenres) map.set(g.id, resolve(g.id));
    return map;
  }, [allGenres, genreById]);

  const visibleRoots = useMemo(() => {
    if (categoryFilter === null) return rootGenres;
    return rootGenres.filter((g) => g.category_ids.includes(categoryFilter));
  }, [rootGenres, categoryFilter]);

  const needle = search.trim().toLowerCase();

  // sortSnap is the selection set used for ordering. It updates when the filter
  // inputs change (needle, parentFilter) but NOT when the user checks/unchecks
  // a box — so the list never reorders mid-interaction.
  const [sortSnap, setSortSnap] = useState(() => selected);
  useEffect(() => { setSortSnap(selected); }, [needle, categoryFilter, parentFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = useMemo(() => {
    return allGenres
      .filter((g) => {
        if (blockedIds?.has(g.id)) return false;
        if (needle && !g.name.toLowerCase().includes(needle) &&
            !g.synonyms?.some((s) => s.toLowerCase().includes(needle))) return false;
        if (categoryFilter !== null && !effectiveCategoryIds.get(g.id)?.has(categoryFilter)) return false;
        if (scopeIds !== null && !scopeIds.has(g.id)) return false;
        return true;
      })
      .sort((a, b) => (sortSnap.has(a.id) ? 0 : 1) - (sortSnap.has(b.id) ? 0 : 1));
  }, [needle, categoryFilter, allGenres, blockedIds, effectiveCategoryIds, scopeIds, sortSnap]);

  function toggle(id: number, checked: boolean) {
    if (single) {
      onChange(checked ? new Set([id]) : new Set());
    } else {
      const next = new Set(selected);
      checked ? next.add(id) : next.delete(id);
      onChange(next);
    }
  }

  function selectCategory(id: number | null) {
    setCategoryFilter(id);
    // The active root filter may no longer belong to the new category.
    if (id !== null && parentFilter !== null) {
      const root = rootGenres.find((g) => g.id === parentFilter);
      if (!root?.category_ids.includes(id)) setParentFilter(null);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-8" placeholder={`Search ${domain.noun}…`} aria-label={`Search ${domain.noun}`}
                 value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {categories.length > 0 && (
          <select
            aria-label="Category"
            value={categoryFilter ?? ""}
            onChange={(e) => selectCategory(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>
      {visibleRoots.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={`Narrow to a top-level ${domain.heading.toLowerCase()}`}>
          <FilterChip active={parentFilter === null} onClick={() => setParentFilter(null)}>All</FilterChip>
          {visibleRoots.map((g) => (
            <FilterChip key={g.id} active={parentFilter === g.id}
                        onClick={() => setParentFilter(parentFilter === g.id ? null : g.id)}>
              {g.name}
            </FilterChip>
          ))}
        </div>
      )}
      {genresLoading || (parentFilter !== null && descendantsLoading) ? (
        <LoadingState compact label={`Loading ${domain.noun}…`} />
      ) : (
        <ChipList>
          {candidates.map((g) => (
            <ChipCheck key={g.id} checked={selected.has(g.id)} onChange={(on) => toggle(g.id, on)}>
              {g.name}
            </ChipCheck>
          ))}
          {candidates.length === 0 && <span className="text-xs text-muted-foreground">No {domain.noun} match.</span>}
        </ChipList>
      )}
    </div>
  );
}
