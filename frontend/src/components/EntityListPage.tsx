import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronsDownUp, ChevronsUpDown, Hash, ListPlus, MoreHorizontal, Pencil,
  Plus, Scale, Search, Trash2, X,
} from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api, Batch } from "../api/client";
import { useEntryMutations, useGuildApi } from "../api/hooks";
import { gk, rk } from "../api/keys";
import { useCan } from "../guild/GuildProvider";
import { reorderEntries } from "../lib/reorder";
import { PlaceItemDialog } from "../rank/PlaceItemDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { MemberPicker } from "./MemberPicker";
import { Modal } from "./Modal";
import { SortableList } from "./SortableList";
import { Spinner } from "./Spinner";

/** What every catalog entity has. */
export interface ListEntity {
  id: number;
  name: string;
  name_en: string | null;
  in_my_list?: boolean;
}

/** What every personal-list row has; the entity sits under a per-vertical key. */
export interface ListEntry {
  position: number;
  notes: string | null;
}

type Section = "artists" | "books" | "movies" | "games" | "television/shows";
type View = "mine" | "catalog";

export interface EntityListProps<T extends ListEntity, R extends ListEntry> {
  title: string;
  noun: [string, string];             // ["movie", "movies"]
  section: Section;                   // API path, and the ranking cache key's vertical
  route: string;                      // detail pages live at /g/:id/<route>/:entityId
  entityKey: string;                  // where the entity sits on a ranked row: "movie"
  ranked: (userId: number) => UseQueryResult<R[]>;
  catalog: () => UseQueryResult<T[]>;
  searchBy: readonly string[];        // first is "all"
  matches: (item: T, needle: string, by: string) => boolean;
  meta: (item: T) => ReactNode;
  year?: (item: T) => number | null;
  /** A poster/cover thumbnail, when the vertical has them. */
  image?: (item: T) => string | null;
  detail: (item: T) => ReactNode;
  /** Extra controls on your own ranked rows, e.g. the watch counter. */
  entryControls?: (entry: R) => ReactNode;
  /** What the entry endpoint needs to recreate a removed row (for Undo). */
  restoreBody: (entry: R) => Record<string, unknown>;
  /** What's lost when you remove it from your list, for the Undo toast. */
  form: (initial: T | undefined, close: () => void) => ReactNode;
  importer?: { label: string; render: (close: () => void) => ReactNode };
  /** Extra filters on both views: each offers the values found in the data. */
  facets?: ListFacet<T>[];
  /** Extra catalog sorts, highest first. */
  sorts?: { key: string; label: string; value: (item: T) => number | null }[];
  /** The `/overview/list-counts` section, enabling "Most in members' lists". */
  countsSection?: "music" | "books" | "movies" | "television" | "games";
  /** Header actions beside Add / Import. */
  actions?: ReactNode;
}

export interface ListFacet<T> {
  key: string;
  label: string;
  values: (item: T) => string[];
}

/** Catalogs bigger than this render only the rows near the viewport. */
const VIRTUAL_FROM = 300;

function CatalogRows<T extends { id: number }>({ items, row }: { items: T[]; row: (item: T) => ReactNode }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => { setOffset(listRef.current?.offsetTop ?? 0); }, []);
  const big = items.length > VIRTUAL_FROM;
  const v = useWindowVirtualizer({
    count: big ? items.length : 0, estimateSize: () => 65, overscan: 10, scrollMargin: offset,
  });
  if (!big) {
    return <ul className="overflow-hidden rounded-lg border bg-card">{items.map((t) => <li key={t.id} className="border-b last:border-b-0">{row(t)}</li>)}</ul>;
  }
  return (
    <ul ref={listRef} className="relative overflow-hidden rounded-lg border bg-card" style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((item) => (
        <li key={items[item.index].id} data-index={item.index} ref={v.measureElement}
            className="absolute top-0 left-0 w-full border-b last:border-b-0"
            style={{ transform: `translateY(${item.start - v.options.scrollMargin}px)` }}>
          {row(items[item.index])}
        </li>
      ))}
    </ul>
  );
}

const entityOf = <T,>(r: ListEntry, key: string) => (r as unknown as Record<string, T>)[key];

export function EntityListPage<T extends ListEntity, R extends ListEntry>(p: EntityListProps<T, R>) {
  const qc = useQueryClient();
  const { guildId, userId: me, base } = useGuildApi();
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const canRank = useCan("rank");

  // View state lives in the URL, so refresh and Back keep it.
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | null>) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) if (v === null || v === "") next.delete(k); else next.set(k, v);
    return next;
  }, { replace: true });
  const view: View = params.get("view") === "catalog" ? "catalog" : "mine";
  const viewingUser = Number(params.get("member")) || me;
  const q = params.get("q") ?? "";
  const by = p.searchBy.includes(params.get("by") ?? "") ? params.get("by")! : p.searchBy[0];
  const missingOnly = params.get("missing") === "1";
  const extraSorts = p.sorts ?? [];
  const sortKeys = ["name", "year", "newest", ...(p.countsSection ? ["members"] : []), ...extraSorts.map((s) => s.key)];
  const sort: string = sortKeys.includes(params.get("sort") ?? "") ? params.get("sort")! : "name";
  const isMine = viewingUser === me;

  const ranked = p.ranked(viewingUser);
  const catalog = p.catalog();
  const entry = useEntryMutations(p.section);
  const rankKey = rk(guildId, me, ...p.section.split("/"), "ranked");

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<{ item: T; impact: number } | null>(null);
  const [impactFor, setImpactFor] = useState<number | null>(null);
  const [placing, setPlacing] = useState<T | null>(null);
  const [moveTo, setMoveTo] = useState<{ item: T; value: string } | null>(null);

  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const bulkAdd = useMutation({
    mutationFn: async (ids: number[]) => {
      // A batch is capped; a very long selection goes in several.
      for (let i = 0; i < ids.length; i += 250) {
        const b = new Batch();
        for (const id of ids.slice(i, i + 250)) b.put(`${base}/${p.section}/${id}/entry`, {});
        await b.run();
      }
    },
    onSuccess: (_, ids) => {
      toast.success(`Added ${ids.length} ${ids.length === 1 ? p.noun[0] : p.noun[1]} to your list`);
      setPicked(new Set());
      setSelecting(false);
    },
  });
  const listCounts = useQuery({
    queryKey: gk(guildId, "list-counts", p.countsSection),
    queryFn: () => api.get<Record<number, number>>(`${base}/overview/list-counts/${p.countsSection}`),
    enabled: sort === "members" && !!p.countsSection,
  });

  // Filters: the vertical's own, and the decade wherever there's a year.
  const yearOf = p.year;
  const facets = useMemo<ListFacet<T>[]>(() => [
    ...(p.facets ?? []),
    ...(yearOf ? [{
      key: "decade", label: "decades",
      values: (t: T) => { const y = yearOf(t); return y ? [`${Math.floor(y / 10) * 10}s`] : []; },
    }] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [p.facets]);
  const chosen = facets.map((f) => [f, params.get(`f_${f.key}`)] as const).filter(([, v]) => v);
  const chosenSig = chosen.map(([f, v]) => `${f.key}=${v}`).join("&");
  const passes = useCallback((t: T) => chosen.every(([f, v]) => f.values(t).includes(v!)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `chosen` is rebuilt each render; its signature is what changes
    [chosenSig]);
  const filtering = chosen.length > 0;

  const needle = q.trim().toLowerCase();
  const rows = ranked.data ?? [];
  const facetOptions = useMemo(() => {
    const items = [...(catalog.data ?? []), ...rows.map((r) => entityOf<T>(r, p.entityKey))];
    return facets.map((f) => {
      const values = [...new Set(items.flatMap((t) => f.values(t)))];
      return { facet: f, options: f.key === "decade" ? values.sort().reverse() : values.sort((a, b) => a.localeCompare(b)) };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.data, rows, facets]);
  const visibleRanked = useMemo(
    () => rows.filter((r) => {
      const t = entityOf<T>(r, p.entityKey);
      return passes(t) && (!needle || p.matches(t, needle, by));
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, needle, by, p.matches, passes],
  );
  const visibleCatalog = useMemo(() => {
    let list = (catalog.data ?? []).filter((t) => passes(t) && (!needle || p.matches(t, needle, by)) && (!missingOnly || !t.in_my_list));
    if (sort === "year" && p.year) list = [...list].sort((a, b) => (p.year!(b) ?? 0) - (p.year!(a) ?? 0));
    else if (sort === "newest") list = [...list].sort((a, b) => b.id - a.id);
    else if (sort === "members") {
      const counts = listCounts.data ?? {};
      list = [...list].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.name.localeCompare(b.name));
    } else if (extraSorts.some((s) => s.key === sort)) {
      const value = extraSorts.find((s) => s.key === sort)!.value;
      list = [...list].sort((a, b) => (value(b) ?? -1) - (value(a) ?? -1));
    }
    else list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.data, needle, by, missingOnly, sort, p.matches, p.year, passes, listCounts.data]);

  const rowById = useMemo(() => new Map(rows.map((r) => [entityOf<T>(r, p.entityKey).id, r])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows]);
  const sortable = visibleRanked.map((r) => ({ ...entityOf<T>(r, p.entityKey), position: r.position }));
  const shownIds = view === "mine" ? sortable.map((t) => t.id) : visibleCatalog.map((t) => t.id);
  const allExpanded = shownIds.length > 0 && shownIds.every((id) => expanded.has(id));
  const toggle = (id: number) => setExpanded((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const inList = (catalog.data ?? []).filter((t) => t.in_my_list).length;
  const total = catalog.data?.length;

  // ── actions ──
  function moveItem(item: T, position: number, undoing = false) {
    const target = Math.max(1, Math.min(rows.length, position));
    const from = rows.findIndex((r) => entityOf<T>(r, p.entityKey).id === item.id);
    if (from < 0) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(target - 1, 0, moved);
    qc.cancelQueries({ queryKey: rankKey });
    qc.setQueryData(rankKey, next.map((r, i) => ({ ...r, position: i + 1 })));
    entry.move.mutate({ id: item.id, position: target });
    if (!undoing) offerUndo(item, from + 1, target);
  }

  function offerUndo(item: T, from: number, to: number) {
    if (from === to) return;
    toast(`Moved ${item.name} to #${to}`, {
      id: `move-${p.section}`, // a run of moves shares one toast
      action: { label: "Undo", onClick: () => moveItem(item, from, true) },
    });
  }

  function removeFromList(r: R) {
    const item = entityOf<T>(r, p.entityKey);
    const restore = { ...p.restoreBody(r), notes: r.notes, position: r.position };
    entry.remove.mutate(item.id, {
      onSuccess: () => toast(`Removed ${item.name} from your list`, {
        action: {
          label: "Undo",
          onClick: () => void api.put(`${base}/${p.section}/${item.id}/entry`, restore)
            .then(() => qc.invalidateQueries({ queryKey: rk(guildId, me) }))
            .catch((e: Error) => toast.error(`Couldn't restore it: ${e.message}`)),
        },
      }),
    });
  }

  function addToList(item: T) {
    entry.add.mutate(item.id, {
      onSuccess: () => {
        if (rows.length === 0) { toast.success(`Added ${item.name} to your list`); return; }
        toast.success(`Added ${item.name} at the bottom of your list`, {
          action: { label: "Place it now", onClick: () => setPlacing(item) },
        });
      },
    });
  }

  async function askDelete(item: T) {
    setImpactFor(item.id);
    try {
      const { rankings_destroyed } = await api.get<{ rankings_destroyed: number }>(`${base}/${p.section}/${item.id}/impact`);
      setDeleting({ item, impact: rankings_destroyed });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImpactFor(null);
    }
  }
  const remove = (id: number) => api.delete(`${base}/${p.section}/${id}`);
  const [removing, setRemoving] = useState(false);

  // ── rendering ──
  const name = (t: T) => (
    <Link className="truncate font-medium hover:underline" to={`/g/${guildId}/${p.route}/${t.id}`}>
      {t.name}{t.name_en && <span className="font-normal text-muted-foreground"> ({t.name_en})</span>}
    </Link>
  );

  // Thumbnail (when the vertical has artwork), name, and the meta line.
  const titleCell = (t: T) => {
    const src = p.image?.(t);
    return (
      <span className="flex min-w-0 items-center gap-3">
        {p.image && (src
          ? <img src={src} alt="" loading="lazy" className="h-12 w-8 shrink-0 rounded-sm border object-cover" />
          : <span className="h-12 w-8 shrink-0 rounded-sm border bg-muted" aria-hidden />)}
        <span className="flex min-w-0 flex-col">
          {name(t)}
          <span className="truncate text-xs text-muted-foreground">{p.meta(t)}</span>
        </span>
      </span>
    );
  };

  const expandButton = (t: T) => (
    <Button variant="ghost" size="icon-sm" aria-label={expanded.has(t.id) ? "Hide details" : "Show details"}
            aria-expanded={expanded.has(t.id)} onClick={() => toggle(t.id)}>
      <ChevronDown className={cn("transition-transform", expanded.has(t.id) && "rotate-180")} />
    </Button>
  );

  const catalogMenuItems = (t: T) => (
    <>
      {canEdit && <DropdownMenuItem onSelect={() => setEditing(t)}><Pencil /> Edit</DropdownMenuItem>}
      {canDelete && (
        <DropdownMenuItem variant="destructive" onSelect={() => void askDelete(t)}>
          <Trash2 /> Delete from catalog
        </DropdownMenuItem>
      )}
    </>
  );

  const menu = (t: T, r?: R) => {
    const mine = r && isMine && canRank;
    if (!mine && !canEdit && !canDelete) return <span />;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`} disabled={impactFor === t.id}>
            {impactFor === t.id ? <Spinner size="sm" /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {mine && (
            <>
              {rows.length > 1 && <DropdownMenuItem onSelect={() => setPlacing(t)}><Scale /> Place by comparing…</DropdownMenuItem>}
              <DropdownMenuItem disabled={r.position === 1} onSelect={() => moveItem(t, 1)}><ArrowUpToLine /> Move to top</DropdownMenuItem>
              <DropdownMenuItem disabled={r.position === rows.length} onSelect={() => moveItem(t, rows.length)}>
                <ArrowDownToLine /> Move to bottom
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMoveTo({ item: t, value: String(r.position) })}><Hash /> Move to position…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => removeFromList(r)}><X /> Remove from my list</DropdownMenuItem>
              {(canEdit || canDelete) && <DropdownMenuSeparator />}
            </>
          )}
          {catalogMenuItems(t)}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const detail = (t: T) => (expanded.has(t.id) ? <div className="border-t bg-muted/30 px-4 py-3 text-sm md:pl-24">{p.detail(t)}</div> : null);

  const error = (q: UseQueryResult<unknown>, what: string) => (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 px-4 py-10 text-center text-sm">
      <p>Couldn't load {what}: {(q.error as Error)?.message ?? "unknown error"}</p>
      <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Try again</Button>
    </div>
  );

  const empty = (text: ReactNode, action?: ReactNode) => (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
      <p>{text}</p>
      {action}
    </div>
  );

  const loading = (
    <div className="grid gap-2">
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}
    </div>
  );

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto">{p.title}</h1>
        {p.actions}
        {canCreate && p.importer && (
          <Button variant="outline" onClick={() => setImporting(true)}>{p.importer.label}</Button>
        )}
        {canCreate && <Button onClick={() => setEditing("new")}><Plus /> Add {p.noun[0]}</Button>}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => set({ view: v === "catalog" ? "catalog" : null })}>
          <TabsList>
            <TabsTrigger value="mine">Ranking</TabsTrigger>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === "mine" && (
          <MemberPicker value={viewingUser} onChange={(id) => set({ member: id === me ? null : String(id) })} />
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label={`Search ${p.noun[1]}`} className="w-56 pl-8"
                 placeholder={`Search ${p.noun[1]}…`} value={q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        {p.searchBy.length > 1 && (
          <select aria-label="Search in" className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={by} onChange={(e) => set({ by: e.target.value === p.searchBy[0] ? null : e.target.value })}>
            {p.searchBy.map((o) => <option key={o} value={o}>{o === "all" ? "Everything" : o[0].toUpperCase() + o.slice(1)}</option>)}
          </select>
        )}
        {view === "catalog" && (
          <>
            <select aria-label="Sort" className="h-9 rounded-md border bg-background px-2 text-sm" value={sort}
                    onChange={(e) => set({ sort: e.target.value === "name" ? null : e.target.value })}>
              <option value="name">A–Z</option>
              {p.year && <option value="year">Newest release</option>}
              <option value="newest">Recently added</option>
              {p.countsSection && <option value="members">Most in members' lists</option>}
              {extraSorts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={missingOnly} onCheckedChange={(v) => set({ missing: v === true ? "1" : null })} />
              Not in my list
            </label>
          </>
        )}
        {facetOptions.filter(({ options }) => options.length > 1).map(({ facet, options }) => (
          <select key={facet.key} aria-label={`Filter by ${facet.label}`} className="h-9 max-w-44 rounded-md border bg-background px-2 text-sm"
                  value={params.get(`f_${facet.key}`) ?? ""} onChange={(e) => set({ [`f_${facet.key}`]: e.target.value || null })}>
            <option value="">All {facet.label}</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        {filtering && (
          <Button variant="ghost" size="sm" onClick={() => set(Object.fromEntries(facets.map((f) => [`f_${f.key}`, null])))}>
            <X /> Clear filters
          </Button>
        )}
        {view === "catalog" && canRank && (
          <Button variant={selecting ? "secondary" : "outline"} size="sm" onClick={() => { setSelecting((v) => !v); setPicked(new Set()); }}>
            <ListPlus /> {selecting ? "Stop selecting" : "Select several"}
          </Button>
        )}
        <span className="grow" />
        <span className="text-sm text-muted-foreground">
          {view === "mine"
            ? ranked.isLoading ? <Spinner size="sm" /> : needle || filtering ? `${visibleRanked.length} of ${rows.length}` : `${rows.length} ranked`
            : catalog.isLoading ? <Spinner size="sm" />
              : `${needle || missingOnly || filtering ? `${visibleCatalog.length} of ` : ""}${total} in catalog · ${inList} in your list`}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={allExpanded ? "Collapse all" : "Expand all"} title={allExpanded ? "Collapse all" : "Expand all"}
                onClick={() => setExpanded(allExpanded ? new Set() : new Set(shownIds))}>
          {allExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
        </Button>
      </div>

      {view === "mine" && (
        ranked.isError ? error(ranked, "the ranking") : ranked.isLoading ? loading : (
          <SortableList
            className="overflow-hidden rounded-lg border bg-card"
            items={sortable}
            empty={rows.length > 0
              ? empty(<>No {p.noun[1]} match these filters.</>)
              : isMine
                ? empty(<>Your {p.noun[0]} ranking is empty. Add {p.noun[1]} from the catalog to start it.</>,
                    <Button variant="outline" size="sm" onClick={() => set({ view: "catalog", missing: "1" })}>
                      <ListPlus /> Browse the catalog
                    </Button>)
                : empty(<>This member hasn't ranked any {p.noun[1]} yet.</>)}
            pendingId={entry.move.isPending ? entry.move.variables?.id ?? null : null}
            rowClassName="entity-row !grid-cols-[1.5rem_2.75rem_minmax(0,1fr)_auto_auto_auto] !gap-2 !py-2"
            disableDrag={!isMine || !canRank}
            itemLabel={(t) => t.name}
            onReorder={(next) => {
              if (needle || filtering) return; // only part of the list is on screen: `onMove` handles it
              qc.cancelQueries({ queryKey: rankKey });
              qc.setQueryData(rankKey, reorderEntries(rows, next, p.entityKey as never));
            }}
            onMove={(id, position) => {
              if (needle || filtering) {
                // `position` is among the rows shown; the real target is where that row sits now.
                const item = sortable.find((t) => t.id === id);
                if (item) moveItem(item, sortable[position - 1].position);
                return;
              }
              entry.move.mutate({ id, position });
              const from = rows.findIndex((r) => entityOf<T>(r, p.entityKey).id === id);
              if (from >= 0) offerUndo(entityOf<T>(rows[from], p.entityKey), from + 1, position);
            }}
            renderDetail={detail}
            render={(t) => {
              const r = rowById.get(t.id)!;
              return (
                <>
                  {titleCell(t)}
                  <span className="hidden sm:block">{isMine && p.entryControls ? p.entryControls(r) : null}</span>
                  {expandButton(t)}
                  {menu(t, r)}
                </>
              );
            }}
          />
        )
      )}

      {view === "catalog" && (
        catalog.isError ? error(catalog, "the catalog") : catalog.isLoading ? loading : visibleCatalog.length === 0 ? (
          (catalog.data ?? []).length > 0
            ? empty(missingOnly && !needle ? <>Everything in the catalog is already in your list.</> : <>No {p.noun[1]} match these filters.</>)
            : empty(<>No {p.noun[1]} in this guild's catalog yet.</>,
                canCreate && (
                  <span className="flex gap-2">
                    {p.importer && <Button variant="outline" size="sm" onClick={() => setImporting(true)}>{p.importer.label}</Button>}
                    <Button size="sm" onClick={() => setEditing("new")}><Plus /> Add {p.noun[0]}</Button>
                  </span>
                ))
        ) : (
          <CatalogRows items={visibleCatalog} row={(t) => (
              <>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-3 py-2">
                  {selecting && !t.in_my_list ? (
                    <Checkbox aria-label={`Select ${t.name}`} checked={picked.has(t.id)} onCheckedChange={(on) => {
                      const next = new Set(picked);
                      if (on === true) next.add(t.id); else next.delete(t.id);
                      setPicked(next);
                    }} />
                  ) : <span />}
                  {titleCell(t)}
                  {t.in_my_list ? (
                    <Badge variant="secondary">In your list</Badge>
                  ) : canRank ? (
                    <Button variant="outline" size="sm" disabled={entry.add.isPending && entry.add.variables === t.id}
                            onClick={() => addToList(t)}>
                      {entry.add.isPending && entry.add.variables === t.id ? <Spinner size="sm" /> : <Plus />}
                      <span className="hidden sm:inline">Add to my list</span>
                    </Button>
                  ) : <span />}
                  {expandButton(t)}
                  {canEdit || canDelete ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`} disabled={impactFor === t.id}>
                          {impactFor === t.id ? <Spinner size="sm" /> : <MoreHorizontal />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">{catalogMenuItems(t)}</DropdownMenuContent>
                    </DropdownMenu>
                  ) : <span />}
                </div>
                {detail(t)}
              </>
          )} />
        )
      )}

      {selecting && view === "catalog" && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2 shadow-lg">
          <span className="text-sm font-medium">{picked.size} selected</span>
          <Button variant="ghost" size="sm"
                  onClick={() => setPicked(new Set(visibleCatalog.filter((t) => !t.in_my_list).map((t) => t.id)))}>
            Select all shown
          </Button>
          {picked.size > 0 && <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Clear</Button>}
          <span className="grow" />
          <Button size="sm" disabled={picked.size === 0 || bulkAdd.isPending} onClick={() => bulkAdd.mutate([...picked])}>
            {bulkAdd.isPending ? <Spinner size="sm" className="text-current" /> : <ListPlus />} Add to my list
          </Button>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.item.name}?`}
          message={`This removes it from the guild catalog for everyone.${deleting.impact
            ? ` ${deleting.impact} member ranking${deleting.impact === 1 ? "" : "s"} of it will be deleted too.` : ""}`}
          busy={removing}
          onConfirm={() => {
            setRemoving(true);
            remove(deleting.item.id)
              .then(() => qc.invalidateQueries({ queryKey: ["g", guildId] }))
              .catch((e: Error) => toast.error(e.message))
              .finally(() => { setRemoving(false); setDeleting(null); });
          }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {moveTo && (
        <Modal onClose={() => setMoveTo(null)}>
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            const n = Number(moveTo.value);
            if (n >= 1) moveItem(moveTo.item, n);
            setMoveTo(null);
          }}>
            <h2>Move {moveTo.item.name}</h2>
            <label className="grid gap-1.5 text-sm">
              New position (1–{rows.length})
              <Input autoFocus type="number" min={1} max={rows.length} value={moveTo.value}
                     onChange={(e) => setMoveTo({ ...moveTo, value: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setMoveTo(null)}>Cancel</Button>
              <Button type="submit">Move</Button>
            </div>
          </form>
        </Modal>
      )}

      {placing && (
        <PlaceItemDialog
          item={{ id: placing.id, name: placing.name }}
          ranked={rows
            .map((r) => entityOf<T>(r, p.entityKey))
            .filter((t) => t.id !== placing.id)
            .map((t) => ({ id: t.id, name: t.name, sub: p.meta(t) }))}
          comparisonsPath={p.section}
          placing={entry.move.isPending}
          onClose={() => setPlacing(null)}
          onPlace={(position) => {
            moveItem(placing, position);
            toast.success(`Placed ${placing.name} at #${position}`);
            setPlacing(null);
          }}
        />
      )}

      {editing && (
        p.form(editing === "new" ? undefined : editing, () => setEditing(null))
      )}
      {importing && p.importer && (
        p.importer.render(() => setImporting(false))
      )}
    </section>
  );
}

/** The expanded-row body: label / value pairs, skipping empty values. */
export function DetailRows({ rows, empty = "No extra info." }: { rows: Array<[string, ReactNode]>; empty?: string }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0));
  if (shown.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-1.5">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "A, B, C" as links. */
export function LinkList({ items, to }: { items: Array<{ id: number; name: string; name_en?: string | null }>; to: (id: number) => string }) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((it, i) => (
        <span key={it.id}>
          {i > 0 && ", "}
          <Link className="hover:underline" to={to(it.id)}>
            {it.name}{it.name_en && <span className="text-muted-foreground"> ({it.name_en})</span>}
          </Link>
        </span>
      ))}
    </>
  );
}
