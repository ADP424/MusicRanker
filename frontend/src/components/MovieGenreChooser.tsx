import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useMovieGenres } from "../api/hooks";
import type { MovieGenre } from "../api/types";

export function MovieGenreChooser(props: {
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  single?: boolean;
  excludeId?: number;
}) {
  const { selected, onChange, single, excludeId } = props;
  const { data: allGenres = [] } = useMovieGenres();

  const [search, setSearch] = useState("");
  const [parentFilter, setParentFilter] = useState<number | null>(null);

  const { data: rootGenres = [] } = useQuery({
    queryKey: ["movie-genres", "roots"],
    queryFn: () => api.get<MovieGenre[]>("/movie-genres/roots"),
  });

  const { data: descendants = [] } = useQuery({
    queryKey: ["movie-genres", parentFilter, "descendants"],
    queryFn: () => api.get<MovieGenre[]>(`/movie-genres/${parentFilter}/descendants`),
    enabled: parentFilter !== null,
  });
  const descendantIds = new Set(descendants.map((g) => g.id));

  const needle = search.trim().toLowerCase();
  const [sortSnap, setSortSnap] = useState(() => selected);
  useEffect(() => { setSortSnap(selected); }, [needle, parentFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = useMemo(() => {
    return allGenres
      .filter((g) => {
        if (g.id === excludeId) return false;
        if (needle && !g.name.toLowerCase().includes(needle) &&
            !g.synonyms?.some((s) => s.toLowerCase().includes(needle))) return false;
        if (parentFilter !== null && !descendantIds.has(g.id)) return false;
        return true;
      })
      .sort((a, b) => (sortSnap.has(a.id) ? 0 : 1) - (sortSnap.has(b.id) ? 0 : 1));
  }, [needle, parentFilter, allGenres, excludeId, descendantIds, sortSnap]);

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
