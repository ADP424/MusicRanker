import type { Person } from "../api/types";

export type PersonSearchField = "all" | "person" | "artist" | "movie";

const FIELD_LABEL: Record<PersonSearchField, string> = {
  all: "All",
  person: "Person",
  artist: "Artist",
  movie: "Movie",
};

const FIELD_PLACEHOLDER: Record<PersonSearchField, string> = {
  all: "Search people, artists, movies…",
  person: "Search by person name…",
  artist: "Search by artist name…",
  movie: "Search by movie name…",
};

/**
 * Presentational person/role picker shared by MovieForm, ArtistDetailPage and
 * MovieDetailPage. It renders the role chips, the search-field chips, the
 * search box + "New Person" button, and the checkbox chip list.
 *
 * It is deliberately state-free: each caller owns its own link model (MovieForm
 * stages pending links and diffs them on save; the detail sections mutate
 * immediately, and MovieDetailPage confirms before unlinking). Callers pass the
 * already-filtered people plus `isChecked`/`onToggle`, so those divergent
 * behaviours stay where they belong.
 */
export function PersonPicker<R extends string>(props: {
  roles: readonly R[];
  roleLabels: Record<R, string>;
  activeRole: R;
  onRole: (role: R) => void;
  searchField: PersonSearchField;
  onSearchField: (field: PersonSearchField) => void;
  search: string;
  onSearch: (value: string) => void;
  onNewPerson: () => void;
  /** Already-filtered (and, if desired, sorted) list of people to show. */
  people: Person[];
  isChecked: (person: Person, role: R) => boolean;
  onToggle: (person: Person, role: R) => void;
  /** Some callers render inside a <form> and must avoid submit-on-click. */
  buttonType?: "button" | "submit";
}) {
  const {
    roles, roleLabels, activeRole, onRole,
    searchField, onSearchField, search, onSearch, onNewPerson,
    people, isChecked, onToggle, buttonType = "button",
  } = props;

  return (
    <>
      {/* Role selector */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        {roles.map((role) => (
          <label
            key={role}
            className={`chip${activeRole === role ? " chip-active" : ""}`}
            onClick={() => onRole(role)}
            style={{ cursor: "pointer" }}
          >
            {roleLabels[role]}
          </label>
        ))}
      </div>

      {/* Search-field selector */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem", flexWrap: "wrap" }}>
        {(["all", "person", "artist", "movie"] as PersonSearchField[]).map((f) => (
          <label
            key={f}
            className={`chip${searchField === f ? " chip-active" : ""}`}
            onClick={() => onSearchField(f)}
            style={{ cursor: "pointer" }}
          >
            {FIELD_LABEL[f]}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
        <input
          className="genre-search"
          type="search"
          placeholder={FIELD_PLACEHOLDER[searchField]}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          style={{ margin: 0, flex: 1 }}
        />
        <button type={buttonType} style={{ whiteSpace: "nowrap" }} onClick={onNewPerson}>
          + New Person
        </button>
      </div>

      <div className="chips">
        {people.map((p) => (
          <label key={p.id} className="chip">
            <input
              type="checkbox"
              checked={isChecked(p, activeRole)}
              onChange={() => onToggle(p, activeRole)}
            />
            {p.name}{p.name_en && <span style={{ opacity: 0.6 }}> ({p.name_en})</span>}
          </label>
        ))}
      </div>
    </>
  );
}
