import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, Minus, MoreHorizontal, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "../../api/client";
import { useGuildApi } from "../../api/hooks";
import { useCan } from "../../guild/GuildProvider";
import { reorderEntries } from "../../lib/reorder";
import { CatalogList } from "../CatalogList";
import { ConfirmDialog } from "../ConfirmDialog";
import { MemberPicker } from "../MemberPicker";
import { SortableList } from "../SortableList";
import { Section } from "./DetailKit";

export interface ChildItem { id: number; name: string; name_en: string | null; in_my_list: boolean }

/**
 * The list under a parent on a detail page (a show's seasons, a season's
 * episodes, an artist's albums): your ranking of them, draggable, with another
 * member's for comparison, or the whole catalog with "Add to my list". The
 * same shape as the main list pages, scaled down.
 */
export function ChildList<T extends ChildItem, E extends { position: number }>({
  title, noun, field, ranked, rankedLoading, rankKey, catalog, catalogLoading, viewingUser, onViewingUser,
  href, meta, detail, entryPath, rankedExtra, catalogMenu, headerActions, removeNote,
}: {
  title: string;
  noun: [singular: string, plural: string];
  /** The entry property holding the item: "season", "episode", "album". */
  field: keyof E & string;
  ranked: E[];
  rankedLoading: boolean;
  /** Cache key of my ranked list, for the optimistic reorder. */
  rankKey: readonly unknown[];
  catalog: T[];
  catalogLoading: boolean;
  viewingUser: number;
  onViewingUser: (id: number) => void;
  /** Guild-relative page of one item. */
  href: (t: T) => string;
  meta: (t: T) => ReactNode;
  /** Shown when a row is expanded. */
  detail?: (t: T) => ReactNode;
  /** "television/seasons/5": `<path>/entry` and `<path>/position`. */
  entryPath: (t: T) => string;
  /** Extra controls on my ranked rows (a watches counter...). */
  rankedExtra?: (t: T, e: E) => ReactNode;
  /** Catalog actions for one item (edit, import, delete) as menu items. */
  catalogMenu?: (t: T) => ReactNode;
  headerActions?: ReactNode;
  removeNote?: string;
}) {
  const qc = useQueryClient();
  const { guildId, userId: me, base } = useGuildApi();
  const canRank = useCan("rank");
  const [view, setView] = useState<"mine" | "catalog">("mine");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [removing, setRemoving] = useState<T | null>(null);
  const isMine = viewingUser === me;

  const add = useMutation({ mutationFn: (t: T) => api.put(`${base}/${entryPath(t)}/entry`, {}) });
  const remove = useMutation({ mutationFn: (t: T) => api.delete(`${base}/${entryPath(t)}/entry`) });
  const move = useMutation({
    mutationFn: ({ t, position }: { t: T; position: number }) => api.put(`${base}/${entryPath(t)}/position`, { position }),
  });

  const itemOf = (e: E) => e[field] as unknown as T;
  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const titleCell = (t: T) => (
    <span className="min-w-0">
      <Link to={`/g/${guildId}/${href(t)}`} className="block truncate font-medium hover:underline">
        {t.name}{t.name_en && <span className="font-normal text-muted-foreground"> ({t.name_en})</span>}
      </Link>
      <span className="block truncate text-xs text-muted-foreground">{meta(t)}</span>
    </span>
  );
  const expandButton = (t: T) => detail ? (
    <Button variant="ghost" size="icon-sm" aria-label={expanded.has(t.id) ? "Hide details" : "Show details"}
            aria-expanded={expanded.has(t.id)} onClick={() => toggle(t.id)}>
      <ChevronDown className={cn("transition-transform", expanded.has(t.id) && "rotate-180")} />
    </Button>
  ) : <span />;
  const detailRow = (t: T) => detail && expanded.has(t.id)
    ? <div className="border-t bg-muted/30 px-4 py-3 text-sm">{detail(t)}</div>
    : null;
  const menu = (t: T, e?: E) => {
    const catalogItems = catalogMenu?.(t);
    const mine = e && isMine && canRank;
    if (!mine && !catalogItems) return <span />;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {mine && (
            <>
              <DropdownMenuItem disabled={e.position === 1} onSelect={() => move.mutate({ t, position: 1 })}>
                <ArrowUpToLine /> Move to top
              </DropdownMenuItem>
              <DropdownMenuItem disabled={e.position === ranked.length} onSelect={() => move.mutate({ t, position: ranked.length })}>
                <ArrowDownToLine /> Move to bottom
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRemoving(t)}><X /> Remove from my list</DropdownMenuItem>
              {catalogItems && <DropdownMenuSeparator />}
            </>
          )}
          {catalogItems}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const empty = (text: string) => <p className="px-4 py-6 text-center text-sm text-muted-foreground">{text}</p>;
  const sortable = ranked.map((e) => ({ ...itemOf(e), position: e.position }));

  return (
    <Section
      title={title}
      count={view === "mine" ? ranked.length : catalog.length}
      busy={add.isPending || remove.isPending || move.isPending}
      actions={headerActions}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as "mine" | "catalog")}>
          <TabsList>
            <TabsTrigger value="mine">Ranking</TabsTrigger>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === "mine" && <MemberPicker value={viewingUser} onChange={onViewingUser} />}
      </div>

      {view === "mine" ? (
        <SortableList
          className="overflow-hidden rounded-lg border"
          items={sortable}
          loading={rankedLoading}
          loadingLabel={`Loading ${noun[1]}…`}
          empty={<div className="rounded-lg border">{empty(isMine
            ? `No ${noun[1]} in your list yet. Add them from the Catalog tab.`
            : `This member hasn't ranked any ${noun[1]} here yet.`)}</div>}
          rowClassName="grid-cols-[1.5rem_2.75rem_minmax(0,1fr)_auto_auto_auto]"
          disableDrag={!isMine || !canRank}
          pendingId={move.isPending ? move.variables?.t.id ?? null : null}
          itemLabel={(t) => t.name}
          onReorder={(next) => {
            void qc.cancelQueries({ queryKey: rankKey });
            qc.setQueryData(rankKey, reorderEntries(ranked, next, field as never));
          }}
          onMove={(id, position) => {
            const t = sortable.find((x) => x.id === id);
            if (t) move.mutate({ t, position });
          }}
          renderDetail={detailRow}
          render={(t) => {
            const e = ranked.find((x) => itemOf(x).id === t.id)!;
            return (
              <>
                {titleCell(t)}
                <span className="hidden sm:block">{isMine && rankedExtra?.(t, e)}</span>
                {expandButton(t)}
                {menu(t, e)}
              </>
            );
          }}
        />
      ) : (
        <CatalogList
          className="overflow-hidden rounded-lg border"
          items={catalog}
          loading={catalogLoading}
          loadingLabel={`Loading ${noun[1]}…`}
          empty={<div className="rounded-lg border">{empty(`No ${noun[1]} in the catalog yet.`)}</div>}
          renderDetail={detailRow}
          render={(t) => (
            <>
              {titleCell(t)}
              {t.in_my_list ? <Badge variant="secondary">In your list</Badge> : canRank ? (
                <Button variant="outline" size="sm" disabled={add.isPending && add.variables?.id === t.id} onClick={() => add.mutate(t)}>
                  <Plus /> <span className="hidden sm:inline">Add to my list</span>
                </Button>
              ) : <span />}
              {expandButton(t)}
              {menu(t)}
            </>
          )}
        />
      )}

      {removing && (
        <ConfirmDialog
          message={`Remove “${removing.name}” from your list? Its place in your ranking and your notes for it will be lost.${removeNote ? ` ${removeNote}` : ""}`}
          confirmLabel="Remove"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(removing, { onSettled: () => setRemoving(null) })}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Section>
  );
}

/** A − n× + counter for a row (watches, listens). */
export function RowCounter({ value, label, busy, onChange }: {
  value: number; label: string; busy?: boolean; onChange: (n: number) => void;
}) {
  return (
    <span className="flex items-center gap-0.5 text-xs">
      <Button variant="ghost" size="icon-sm" aria-label={`One fewer ${label}`} disabled={value <= 1 || busy}
              onClick={() => onChange(value - 1)}>
        <Minus />
      </Button>
      <span className="w-7 text-center tabular-nums" title={`${value} ${label}`}>{value}×</span>
      <Button variant="ghost" size="icon-sm" aria-label={`One more ${label}`} disabled={busy} onClick={() => onChange(value + 1)}>
        <Plus />
      </Button>
    </span>
  );
}
