import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import type { GenreCategory } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { GenreDomain } from "./config";

/**
 * Manages a genre domain's categories: unordered tags assignable to root
 * (parentless) entries, used to split the genre-picker filter into a
 * category dropdown plus the existing root-genre dropdown.
 */
export function CategoryManager({ domain }: { domain: GenreDomain }) {
  const categoryApiBase = domain.useCategoryApiBase();
  const { data: categories = [], isLoading } = domain.useCategories();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);
  const [deleting, setDeleting] = useState<GenreCategory | null>(null);

  const create = useMutation({
    mutationFn: (name: string) => api.post<GenreCategory>(categoryApiBase, { name }),
    onSuccess: () => setNewName(""),
  });
  const rename = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) => api.patch<GenreCategory>(`${categoryApiBase}/${id}`, { name: value }),
    onSuccess: () => setRenaming(null),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`${categoryApiBase}/${id}`) });

  return (
    <Card className="gap-3 px-5 py-3">
      <button type="button" data-slot="disclosure" aria-expanded={open} onClick={() => setOpen((o) => !o)}
              className="flex w-full items-center gap-3 text-left">
        <span className="font-semibold">Categories</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {isLoading ? "Loading…" : categories.length ? categories.map((c) => c.name).join(", ") : "None yet: group root genres under tags"}
          </span>
        )}
        <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-1.5">
            {categories.length === 0 && <span className="text-sm text-muted-foreground">No categories yet.</span>}
            {categories.map((c) => renaming?.id === c.id ? (
              <form key={c.id} className="flex items-center gap-1" onSubmit={(e) => {
                e.preventDefault();
                if (renaming.value.trim()) rename.mutate({ id: c.id, value: renaming.value.trim() });
              }}>
                <Input autoFocus className="h-7 w-40" aria-label="Category name" value={renaming.value}
                       onChange={(e) => setRenaming({ id: c.id, value: e.target.value })} />
                <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save" disabled={rename.isPending}><Check /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setRenaming(null)}><X /></Button>
              </form>
            ) : (
              <Badge key={c.id} variant="secondary" className="gap-1 pr-1">
                {c.name}
                <button type="button" data-slot="icon" aria-label={`Rename ${c.name}`} className="rounded p-0.5 hover:bg-background"
                        onClick={() => setRenaming({ id: c.id, value: c.name })}><Pencil className="size-3" /></button>
                <button type="button" data-slot="icon" aria-label={`Delete ${c.name}`} className="rounded p-0.5 hover:bg-background"
                        onClick={() => setDeleting(c)}><X className="size-3" /></button>
              </Badge>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate(newName.trim());
          }}>
            <Input className="max-w-64" placeholder="New category…" aria-label="New category" value={newName}
                   onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" size="sm" variant="outline" disabled={!newName.trim() || create.isPending}><Plus /> Add</Button>
          </form>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          message={`Delete the category “${deleting.name}”? Genres tagged with it keep everything else.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id, { onSettled: () => setDeleting(null) })}
          onCancel={() => setDeleting(null)}
        />
      )}
    </Card>
  );
}
