import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import { useGenres } from "../api/hooks";
import type { Genre } from "../api/types";

/**
 * Reusable genre picker with:
 *  - a search bar
 *  - root-genre filter chips (genres with no parents)
 *  - selecting a filter shows ALL descendants, not just direct children
 *  - checkbox chips for the matching genres
 */
export function GenreChooser(props: {
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  /** If true, only a single genre can be selected (set of 0 or 1). */
  single?: boolean;
  /** Exclude this genre id from the list (e.g. when editing a genre's own parents). */
  excludeId?: number;
}) {
  const { selected, onChange, single, excludeId } = props;
  const { data: allGenres = [] } = useGenres();

  const [search, setSearch] = useState("");
  const [parentFilter, setParentFilter] = useState<number | null>(null);

  const { data: rootGenres = [] } = useQuery({
    queryKey: ["genres", "roots"],
    queryFn: () => api.get<Genre[]>("/genres/roots"),
  });

  // Fetch ALL descendants of the active filter (not just direct children)
  const { data: descendants = [] } = useQuery({
    queryKey: ["genres", parentFilter, "descendants"],
    queryFn: () => api.get<Genre[]>(`/genres/${parentFilter}/descendants`),
    enabled: parentFilter !== null,
  });
  const descendantIds = new Set(descendants.map((g) => g.id));

  const needle = search.trim().toLowerCase();

  const candidates = allGenres.filter((g) => {
    if (g.id === excludeId) return false;
    if (needle && !g.name.toLowerCase().includes(needle) &&
        !g.synonyms?.some((s) => s.toLowerCase().includes(needle))) return false;
    if (parentFilter !== null && !descendantIds.has(g.id)) return false;
    return true;
  });

  function toggle(id: number, checked: boolean) {
    if (single) {
      onChange(checked ? new Set([id]) : new Set());
    } else {
      const next = new Set(selected);
      checked ? next.add(id) : next.delete(id);
      onChange(next);
    }
  }

  return (
    <div className="genre-chooser">
      <div className="genre-chooser-controls">
        <input
          className="genre-search"
          type="search"
          placeholder="Search genres…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="chips genre-filters">
          <label
            className={`chip${parentFilter === null ? " chip-active" : ""}`}
            onClick={() => setParentFilter(null)}
          >
            All
          </label>
          {rootGenres.map((g) => (
            <label
              key={g.id}
              className={`chip${parentFilter === g.id ? " chip-active" : ""}`}
              onClick={() => setParentFilter(parentFilter === g.id ? null : g.id)}
            >
              {g.name}
            </label>
          ))}
        </div>
      </div>
      <div className="chips">
        {candidates.map((g) => (
          <label key={g.id} className="chip">
            <input
              type="checkbox"
              checked={selected.has(g.id)}
              onChange={(e) => toggle(g.id, e.target.checked)}
            />
            {g.name}
          </label>
        ))}
        {candidates.length === 0 && <small>No genres match.</small>}
      </div>
    </div>
  );
}
