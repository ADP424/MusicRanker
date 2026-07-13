import { useState } from "react";

interface HasId { id: number }

/**
 * Tracks which rows are expanded, with a toggle and an "expand/collapse all"
 * control.
 *
 * `items` is the set that "all expanded" is measured against — callers pass
 * whichever list they consider complete. ArtistsPage/MoviesPage pass the full
 * list; PeoplePage passes only the *visible* rows, so "all" means "all
 * currently shown". This difference is intentional and preserved by letting the
 * caller choose the array.
 */
export function useExpandAll<T extends HasId>(items: T[]) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const allExpanded =
    items.length > 0 && items.every((it) => expandedIds.has(it.id));

  function toggleAll() {
    setExpandedIds(allExpanded ? new Set() : new Set(items.map((it) => it.id)));
  }

  return { expandedIds, toggle, allExpanded, toggleAll };
}
