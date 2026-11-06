import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Link, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../api/client";
import { useGuildApi, usePeople } from "../api/hooks";
import type { Person } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FilterChip } from "../components/form/FormKit";
import { PersonForm } from "../components/PersonForm";
import { LoadingState, Spinner } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";

type PeopleSearchBy = "all" | "name" | "nationality" | "artist" | "book" | "movie" | "game" | "television";

const SEARCH_BY: Array<[PeopleSearchBy, string]> = [
  ["all", "Anywhere"], ["name", "Names"], ["nationality", "Nationalities"], ["artist", "Artists"], ["book", "Books"],
  ["movie", "Movies"], ["game", "Games"], ["television", "TV shows"],
];

/** A person's expanded row: what they're credited on. */
function PersonCredits({ person }: { person: Person }) {
  const groups: Array<[string, string[]]> = [
    ["Artists", person.artist_names], ["Books", person.book_names ?? []], ["Movies", person.movie_names],
    ["Games", person.game_names], ["Television", person.television_names],
  ];
  const shown = groups.filter(([, names]) => names.length > 0);
  if (shown.length === 0) return <p className="px-3 pb-3 pl-11 text-sm text-muted-foreground">Not credited on anything yet.</p>;
  return (
    <dl className="grid gap-1.5 px-3 pb-3 pl-11 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
      {shown.map(([label, names]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{[...new Set(names)].join(", ")}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PeoplePage() {
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const [editing, setEditing] = useState<{ person: Person } | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Person | null>(null);
  // Filters live in the URL, like the other list pages.
  const [params, setParams] = useSearchParams();
  const searchQ = params.get("q") ?? "";
  const searchBy = (params.get("in") ?? "all") as PeopleSearchBy;
  const showDupsOnly = params.get("dups") === "1";
  const setParam = (key: string, value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data: people = [], isLoading } = usePeople();

  const dupNameSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) {
      const key = p.name.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (p.name_en) {
        const keyEn = p.name_en.toLowerCase();
        counts.set(keyEn, (counts.get(keyEn) ?? 0) + 1);
      }
    }
    const dups = new Set<string>();
    for (const [name, count] of counts) {
      if (count > 1) dups.add(name);
    }
    return dups;
  }, [people]);

  const visiblePeople = useMemo(() => {
    let result = people;

    if (showDupsOnly) {
      result = result.filter(
        (p) => dupNameSet.has(p.name.toLowerCase()) || (p.name_en != null && dupNameSet.has(p.name_en.toLowerCase()))
      );
    }

    const needle = searchQ.trim().toLowerCase();
    if (!needle) return result;

    return result.filter((p) => {
      if (searchBy === "name" || searchBy === "all") {
        if (p.name.toLowerCase().includes(needle) || p.name_en?.toLowerCase().includes(needle)) return true;
      }
      if (searchBy === "nationality" || searchBy === "all") {
        if (
          p.core_nationality.toLowerCase().includes(needle) ||
          p.birth_nationality.toLowerCase().includes(needle)
        ) return true;
      }
      if (searchBy === "artist" || searchBy === "all") {
        if (p.artist_names.some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "book" || searchBy === "all") {
        if ((p.book_names ?? []).some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "movie" || searchBy === "all") {
        if (p.movie_names.some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "game" || searchBy === "all") {
        if (p.game_names.some((n) => n.toLowerCase().includes(needle))) return true;
      }
      if (searchBy === "television" || searchBy === "all") {
        if (p.television_names.some((n) => n.toLowerCase().includes(needle))) return true;
      }
      return false;
    });
  }, [searchQ, searchBy, showDupsOnly, dupNameSet, people]);

  const allExpanded = visiblePeople.length > 0 && expandedIds.size === visiblePeople.length;
  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${base}/persons/${id}`),
  });

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1>People</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? <Spinner size="sm" />
              : searchQ.trim() || showDupsOnly
                ? `${visiblePeople.length.toLocaleString()} of ${people.length.toLocaleString()}`
                : `${people.length.toLocaleString()} ${people.length === 1 ? "person" : "people"}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(visiblePeople.map((p) => p.id)))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </Button>
          {canEdit && <Button onClick={() => setEditing("new")}><Plus /> Add person</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-8" placeholder="Search people…" aria-label="Search people"
                 value={searchQ} onChange={(e) => setParam("q", e.target.value || null)} />
        </div>
        <select aria-label="Search in" value={searchBy}
                onChange={(e) => setParam("in", e.target.value === "all" ? null : e.target.value)}>
          {SEARCH_BY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <FilterChip active={showDupsOnly} onClick={() => setParam("dups", showDupsOnly ? null : "1")}
                    title="People who share a name with someone else">
          Duplicates
        </FilterChip>
      </div>

      {isLoading ? (
        <LoadingState label="Loading people…" />
      ) : visiblePeople.length === 0 ? (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          {people.length === 0 ? "No people in this guild yet. Importing a title adds its people." : "No people match."}
        </p>
      ) : (
        <PeopleList people={visiblePeople} render={(person) => {
          const open = expandedIds.has(person.id);
          return (
            <>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <Button variant="ghost" size="icon" className="size-7" aria-expanded={open}
                        aria-label={`${open ? "Hide" : "Show"} ${person.name}'s credits`} onClick={() => toggleExpand(person.id)}>
                  {open ? <ChevronDown /> : <ChevronRight />}
                </Button>
                <Link className="min-w-0 flex-1 truncate text-sm font-medium no-underline hover:underline" to={`/g/${guildId}/people/${person.id}`}>
                  {person.name}{person.name_en && <span className="font-normal text-muted-foreground"> ({person.name_en})</span>}
                </Link>
                <span className="hidden text-sm text-muted-foreground sm:inline">
                  {person.core_nationality}
                  {person.birth_nationality !== person.core_nationality && <> ({person.birth_nationality})</>}
                </span>
                {canEdit && (
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Edit ${person.name}`} onClick={() => setEditing({ person })}>
                    <Pencil />
                  </Button>
                )}
                {canDelete && (
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Delete ${person.name}`} onClick={() => setConfirmDelete(person)}>
                    <Trash2 />
                  </Button>
                )}
              </div>
              {open && <PersonCredits person={person} />}
            </>
          );
        }} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}"?`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {editing && (
        <PersonForm
          initial={editing === "new" ? undefined : editing.person}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/** Thousands of people: only the rows near the viewport are rendered. Rows
 * are measured, so an expanded one takes the room it needs. */
function PeopleList({ people, render }: { people: Person[]; render: (p: Person) => ReactNode }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => { setOffset(listRef.current?.offsetTop ?? 0); }, []);
  const v = useWindowVirtualizer({ count: people.length, estimateSize: () => 49, overscan: 12, scrollMargin: offset });
  return (
    <ul ref={listRef} className="relative rounded-lg border" style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((item) => {
        const person = people[item.index];
        return (
          <li key={person.id} data-index={item.index} ref={v.measureElement} className="absolute top-0 left-0 w-full border-b last:border-b-0"
              style={{ transform: `translateY(${item.start - v.options.scrollMargin}px)` }}>
            {render(person)}
          </li>
        );
      })}
    </ul>
  );
}
