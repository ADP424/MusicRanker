import { useMutation } from "@tanstack/react-query";
import { Check, Lock, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "../api/client";
import { useGuildApi, useNationalities } from "../api/hooks";
import type { NationalityEntry } from "../api/types";
import { UNKNOWN_NATIONALITY } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoadFailed } from "../components/LoadFailed";
import { LoadingState } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";
import { matchesAny } from "../search/textMatch";

const usage = (n: NationalityEntry) =>
  [
    n.people_count > 0 && `${n.people_count} ${n.people_count === 1 ? "person" : "people"}`,
    n.artist_count > 0 && `${n.artist_count} artist${n.artist_count === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ") || "Unused";

/** The guild's nationality list: add, rename (renames everyone holding it), delete. */
export function NationalitiesPage() {
  usePageTitle("Nationalities");
  const { base } = useGuildApi();
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const { data: nats = [], isLoading, isError, error, refetch } = useNationalities();
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);
  const [deleting, setDeleting] = useState<NationalityEntry | null>(null);

  const create = useMutation({
    mutationFn: (name: string) => api.post<NationalityEntry>(`${base}/nationalities`, { name }),
    onSuccess: () => setNewName(""),
  });
  const rename = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) =>
      api.patch<NationalityEntry>(`${base}/nationalities/${id}`, { name: value }),
    onSuccess: () => setRenaming(null),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`${base}/nationalities/${id}`) });

  const visible = useMemo(() => (q.trim() ? nats.filter((n) => matchesAny(q, n.name)) : nats), [nats, q]);
  const used = nats.filter((n) => n.people_count + n.artist_count > 0).length;

  if (isError) return <LoadFailed what="nationalities" error={error} onRetry={() => void refetch()} />;

  return (
    <section className="grid gap-4">
      <div>
        <h1>Nationalities</h1>
        <p className="text-sm text-muted-foreground">
          This guild's list for people and artists: {nats.length} {nats.length === 1 ? "nationality" : "nationalities"}, {used} in use.
        </p>
      </div>

      <Card className="flex-row items-center gap-3 px-5 py-3">
        <Lock className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{UNKNOWN_NATIONALITY}</div>
          <p className="text-sm text-muted-foreground">
            Always available and can't be changed. Anyone created without a nationality gets it; if only one of the
            two is known, it's used for both.
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-8" placeholder="Filter…" aria-label="Filter nationalities"
                 value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {canCreate && (
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate(newName.trim());
          }}>
            <Input className="w-56" placeholder="New nationality…" aria-label="New nationality" value={newName}
                   onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" variant="outline" disabled={!newName.trim() || create.isPending}><Plus /> Add</Button>
          </form>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Loading nationalities…" />
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{q.trim() ? "Nothing matches." : "The list is empty; everyone is Unknown."}</p>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {visible.map((n) => (
            <div key={n.id} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
              {renaming?.id === n.id ? (
                <form className="flex flex-1 items-center gap-1" onSubmit={(e) => {
                  e.preventDefault();
                  if (renaming.value.trim()) rename.mutate({ id: n.id, value: renaming.value.trim() });
                }}>
                  <Input autoFocus className="h-8 max-w-64" aria-label="Nationality name" value={renaming.value}
                         onChange={(e) => setRenaming({ id: n.id, value: e.target.value })}
                         onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }} />
                  <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save" disabled={rename.isPending}><Check /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setRenaming(null)}><X /></Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{n.name}</span>
                  <Badge variant={n.people_count + n.artist_count > 0 ? "secondary" : "outline"} className="font-normal">
                    {usage(n)}
                  </Badge>
                  {canEdit && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Rename ${n.name}`}
                            onClick={() => setRenaming({ id: n.id, value: n.name })}><Pencil /></Button>
                  )}
                  {canDelete && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${n.name}`}
                            onClick={() => setDeleting(n)}><Trash2 /></Button>
                  )}
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      {deleting && (
        <ConfirmDialog
          message={
            deleting.people_count + deleting.artist_count > 0
              ? `Delete “${deleting.name}”? ${usage(deleting)} hold it; they fall back to their other nationality, or Unknown.`
              : `Delete “${deleting.name}”? Nobody holds it.`
          }
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id, { onSettled: () => setDeleting(null) })}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
