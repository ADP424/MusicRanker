import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Person } from "../api/types";
import { InlineBusy, LoadingState } from "./Spinner";

export type PersonSearchField = "all" | "person" | "artist" | "book" | "movie" | "game" | "television";

export const PERSON_SEARCH_FIELDS: PersonSearchField[] = [
  "all", "person", "artist", "book", "movie", "game", "television",
];

const FIELD_LABEL: Record<PersonSearchField, string> = {
  all: "All",
  person: "Person",
  artist: "Artist",
  book: "Book",
  movie: "Movie",
  game: "Game",
  television: "TV",
};

const FIELD_PLACEHOLDER: Record<PersonSearchField, string> = {
  all: "Search people, artists, books, movies, games, TV shows…",
  person: "Search by person name…",
  artist: "Search by artist name…",
  book: "Search by book name…",
  movie: "Search by movie name…",
  game: "Search by game name…",
  television: "Search by show name…",
};

/**
 * Single source of truth for "does this person match the search box?".
 *
 * Every caller (MovieForm, GameForm, ArtistDetailPage, MovieDetailPage,
 * GameDetailPage) used to inline its own copy of this switch, which is how
 * the "game" field would otherwise have had to be added in five places.
 */
export function matchesPersonSearch(
  p: Person,
  field: PersonSearchField,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hit = (s: string) => s.toLowerCase().includes(q);
  const nameHit = hit(p.name) || !!p.name_en?.toLowerCase().includes(q);
  // `?? []` guards against a response cached by a build that predates game_names/television_names
  const artistHit = (p.artist_names ?? []).some(hit);
  const bookHit = (p.book_names ?? []).some(hit);
  const movieHit = (p.movie_names ?? []).some(hit);
  const gameHit = (p.game_names ?? []).some(hit);
  const televisionHit = (p.television_names ?? []).some(hit);
  switch (field) {
    case "person": return nameHit;
    case "artist": return artistHit;
    case "book":   return bookHit;
    case "movie":  return movieHit;
    case "game":   return gameHit;
    case "television": return televisionHit;
    default:       return nameHit || artistHit || bookHit || movieHit || gameHit || televisionHit;
  }
}

/** People shown at once (the ticked ones always are); the search box narrows the rest. */
const SHOWN = 60;

/**
 * Presentational person/role picker shared by MovieForm, GameForm,
 * ArtistDetailPage, MovieDetailPage and GameDetailPage. It renders the role
 * chips, the search-field chips, the search box + "New Person" button, and the
 * checkbox chip list.
 *
 * It is deliberately state-free: each caller owns its own link model (the forms
 * stage pending links and diff them on save; the detail sections mutate
 * immediately and confirm before unlinking). Callers pass the already-filtered
 * people plus `isChecked`/`onToggle`, so those divergent behaviours stay where
 * they belong.
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
  /** People list still on its cold fetch. */
  loading?: boolean;
  /** A link/unlink request for this picker is in flight. */
  busy?: boolean;
}) {
  const {
    roles, roleLabels, activeRole, onRole,
    searchField, onSearchField, search, onSearch, onNewPerson,
    people, isChecked, onToggle, buttonType = "button", loading = false, busy = false,
  } = props;
  // A guild can have thousands of people: show the ticked ones and the first
  // matches, and let the search box do the rest.
  const ticked = people.filter((p) => isChecked(p, activeRole));
  const rest = people.filter((p) => !isChecked(p, activeRole));
  const shown = [...ticked, ...rest.slice(0, SHOWN)];
  const hidden = rest.length - Math.min(rest.length, SHOWN);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Role">
        {roles.map((role) => (
          <button key={role} type="button" role="radio" aria-checked={activeRole === role} onClick={() => onRole(role)}
                  data-slot="chip"
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    activeRole === role ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
            {roleLabels[role]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-8" placeholder={FIELD_PLACEHOLDER[searchField]} value={search}
                 aria-label="Search people" onChange={(e) => onSearch(e.target.value)} />
        </div>
        <select aria-label="Search in" value={searchField} onChange={(e) => onSearchField(e.target.value as PersonSearchField)}>
          {PERSON_SEARCH_FIELDS.map((f) => <option key={f} value={f}>{f === "all" ? "Anywhere" : `${FIELD_LABEL[f]} names`}</option>)}
        </select>
        {busy && <InlineBusy label="Saving…" />}
        <Button type={buttonType} variant="outline" size="sm" onClick={onNewPerson}><Plus className="size-4" /> New person</Button>
      </div>
      {loading ? (
        <LoadingState compact label="Loading people…" />
      ) : (
        <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2">
          {shown.map((p) => {
            const on = isChecked(p, activeRole);
            return (
              <label key={p.id}
                     className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
                       on ? "border-primary/50 bg-primary/10" : "hover:bg-accent")}>
                <input type="checkbox" data-slot="checkbox-native" className="size-3.5" checked={on} onChange={() => onToggle(p, activeRole)} />
                {p.name}{p.name_en && <span className="text-muted-foreground">({p.name_en})</span>}
              </label>
            );
          })}
          {people.length === 0 && <span className="text-xs text-muted-foreground">No people match.</span>}
          {hidden > 0 && <span className="self-center text-xs text-muted-foreground">and {hidden.toLocaleString()} more: type to narrow</span>}
        </div>
      )}
    </div>
  );
}
