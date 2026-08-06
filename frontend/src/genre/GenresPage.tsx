import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CategoryManager } from "./CategoryManager";
import { GenreForm } from "./GenreForm";
import { GenreTree } from "./GenreTree";
import { findCycles } from "./cycles";
import type { GenreDomain, GenreLike } from "./config";

type View = "list" | "tree";

/** {genre id -> the set of category ids "in scope" for it}: a root genre's own
 * category_ids, or (for a non-root genre) the union of that same set walked
 * down from every one of its ancestors — i.e. filtering by a category shows
 * the tagged root(s) plus every descendant beneath them. */
function useCategoryScope(genres: GenreLike[]) {
  return useMemo(() => {
    const byId = new Map(genres.map((g) => [g.id, g]));
    const childrenOf = new Map<number, number[]>();
    for (const g of genres) {
      for (const pid of g.parent_ids) {
        if (!childrenOf.has(pid)) childrenOf.set(pid, []);
        childrenOf.get(pid)!.push(g.id);
      }
    }

    const scope = new Map<number, Set<number>>();
    function scopeOf(id: number, seen = new Set<number>()): Set<number> {
      if (scope.has(id)) return scope.get(id)!;
      if (seen.has(id)) return new Set(); // guard against cyclical data
      seen.add(id);
      const g = byId.get(id);
      if (!g) return new Set();
      const own = new Set(g.category_ids);
      if (g.parent_ids.length === 0) {
        scope.set(id, own);
        return own;
      }
      const union = new Set(own);
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
  const { data: genres = [] } = domain.useAll();
  const { data: categories = [] } = domain.useCategories();
  const [view, setView] = useState<View>("list");
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [editing, setEditing] = useState<GenreLike | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GenreLike | null>(null);

  const categoryScope = useCategoryScope(genres);
  const visibleGenres = useMemo(() => {
    if (categoryFilter === null) return genres;
    return genres.filter((g) => categoryScope.get(g.id)?.has(categoryFilter));
  }, [genres, categoryScope, categoryFilter]);

  // Computed once here and threaded to both the warning banner (List and Tree
  // views alike) and GenreTree's layout, rather than each computing its own.
  const cycles = useMemo(() => findCycles(genres), [genres]);
  const genreById = useMemo(() => new Map(genres.map((g) => [g.id, g])), [genres]);

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${domain.apiBase}/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: [domain.key] });
      const prev = qc.getQueryData<GenreLike[]>([domain.key]);
      qc.setQueryData<GenreLike[]>([domain.key], (old = []) => old.filter((g) => g.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => qc.setQueryData([domain.key], ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: [domain.key] }),
  });

  return (
    <section>
      <header className="page-head">
        <h1>{domain.heading}s</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <div className="view-toggle">
            <button
              className={view === "list" ? "view-toggle-active" : ""}
              onClick={() => setView("list")}
            >List</button>
            <button
              className={view === "tree" ? "view-toggle-active" : ""}
              onClick={() => setView("tree")}
            >Tree</button>
          </div>
          <button onClick={() => setEditing("new")}>+ Add</button>
        </div>
      </header>

      {cycles.hasCycles && (
        <div className="cycle-warning">
          <strong>
            ⚠ {cycles.cycles.length} circular parent{" "}
            {cycles.cycles.length === 1 ? "chain" : "chains"} in this taxonomy.
          </strong>{" "}
          The tree view drops the link that closes each loop so it can still draw
          (and shows it dashed), but the data is wrong. Click a name to edit it and
          remove the offending parent.
          <ul>
            {cycles.cycles.map((loop, i) => (
              <li key={i}>
                {loop.map((id, j) => (
                  <span key={`${id}-${j}`}>
                    {j > 0 && " → "}
                    <button
                      type="button"
                      className="cycle-link"
                      onClick={() => {
                        const g = genreById.get(id);
                        if (g) setEditing(g);
                      }}
                    >
                      {genreById.get(id)?.name ?? `#${id}`}
                    </button>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <CategoryManager domain={domain} />

      {categories.length > 0 && (
        <select
          className="genre-category-select"
          value={categoryFilter ?? ""}
          onChange={(e) => setCategoryFilter(e.target.value === "" ? null : Number(e.target.value))}
          style={{ marginBottom: "1rem" }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {view === "list" && (
        <ul className="plain-list">
          {visibleGenres.map((g) => (
            <li key={g.id} className="row">
              <Link className="name" to={`${domain.routeBase}/${g.id}`}>{g.name}</Link>
              <span className="meta">
                {g.synonyms?.length ? `aka ${g.synonyms.join(", ")}` : ""}
              </span>
              <button className="icon" onClick={() => setEditing(g)}>✎</button>
              <button className="icon" onClick={() => setConfirmDelete(g)}>✕</button>
            </li>
          ))}
          {visibleGenres.length === 0 && <li><small>No {domain.noun} match.</small></li>}
        </ul>
      )}

      {view === "tree" && (
        <GenreTree genres={visibleGenres} cycles={cycles} onEdit={(g) => setEditing(g)} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}"?`}
          onConfirm={() => {
            remove.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <GenreForm
              domain={domain}
              initial={editing === "new" ? undefined : editing}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
