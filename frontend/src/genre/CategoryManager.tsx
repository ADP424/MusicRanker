import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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
  const qc = useQueryClient();
  const { data: categories = [] } = domain.useCategories();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<GenreCategory | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<GenreCategory | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: [domain.key, "categories"] });

  const create = useMutation({
    mutationFn: (name: string) => api.post<GenreCategory>(domain.categoryApiBase, { name }),
    onSuccess: () => {
      setNewName("");
      invalidate();
    },
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.patch<GenreCategory>(`${domain.categoryApiBase}/${id}`, { name }),
    onSuccess: () => {
      setRenaming(null);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${domain.categoryApiBase}/${id}`),
    onSuccess: invalidate,
  });

  return (
    <section className="category-manager">
      <header className="collapsible-legend" onClick={() => setOpen((o) => !o)}>
        <h3 style={{ margin: 0 }}>Categories</h3>
        <span className="collapse-arrow">{open ? "▲" : "▼"}</span>
      </header>

      {!open && (
        <span className="collapsed-summary" onClick={() => setOpen(true)}>
          {categories.length > 0 ? categories.map((c) => c.name).join(", ") : "None yet"}
        </span>
      )}

      {open && (
        <>
          <ul className="plain-list">
            {categories.map((c) => (
              <li key={c.id} className="row">
                {renaming?.id === c.id ? (
                  <form
                    style={{ display: "flex", gap: "0.5rem", flex: 1 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renameValue.trim()) rename.mutate({ id: c.id, name: renameValue.trim() });
                    }}
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                    />
                    <button type="submit" disabled={rename.isPending}>Save</button>
                    <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <span className="name">{c.name}</span>
                    <button className="icon" onClick={() => { setRenaming(c); setRenameValue(c.name); }}>✎</button>
                    <button className="icon" onClick={() => setConfirmDelete(c)}>✕</button>
                  </>
                )}
              </li>
            ))}
            {categories.length === 0 && <li><small>No categories yet.</small></li>}
          </ul>

          <form
            style={{ display: "flex", gap: "0.5rem" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate(newName.trim());
            }}
          >
            <input
              placeholder={`New category…`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" disabled={create.isPending || !newName.trim()}>+ Add</button>
          </form>
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete category "${confirmDelete.name}"?`}
          onConfirm={() => {
            remove.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}
