import { ReactNode } from "react";

/** Shared "search box + search-by chips + result count" bar used by every
 * catalog/ranking list page (Artists, Movies, Games, Television). Each page
 * supplies its own `SearchBy` union and does its own matching (see
 * `matchesNeedle` / the per-page `useMemo` filters) — this component is pure
 * presentation so the chip set can vary per vertical (e.g. Games adds
 * "platform", Television adds "episode"). */
export function SearchFilterBar<SearchBy extends string>(props: {
  value: string;
  onChange: (v: string) => void;
  searchBy: SearchBy;
  onSearchByChange: (v: SearchBy) => void;
  options: SearchBy[];
  labels?: Partial<Record<SearchBy, string>>;
  count: ReactNode;
}) {
  const { value, onChange, searchBy, onSearchByChange, options, labels, count } = props;
  return (
    <div className="search-bar">
      <input
        type="search"
        placeholder="Search…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="search-by-chips">
        {options.map((opt) => (
          <button
            key={opt}
            className={`chip${searchBy === opt ? " chip-active" : ""}`}
            onClick={() => onSearchByChange(opt)}
          >
            {labels?.[opt] ?? opt.charAt(0).toUpperCase() + opt.slice(1)}
          </button>
        ))}
      </div>
      <span className="search-count">{count}</span>
    </div>
  );
}
