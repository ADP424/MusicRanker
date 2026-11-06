import { X } from "lucide-react";
import { useMemo, useState } from "react";

import type { Batch } from "../../api/client";
import { usePeople } from "../../api/hooks";
import type { Person } from "../../api/types";
import { PersonForm } from "../PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../PersonPicker";
import { FormSection, Notice } from "./FormKit";

export type PendingPerson<R extends string> = { personId: number; role: R };

const key = (personId: number, role: string) => `${personId}:${role}`;

/**
 * A form's staged person credits: starts from the entity's current ones and is
 * written by `commit` (PUT the new, DELETE the dropped) once the entity id is
 * known, as part of the form's batch.
 */
export function usePeopleLinks<R extends string>(initial?: readonly { id: number; role: R }[]) {
  const [before] = useState<PendingPerson<R>[]>(() => (initial ?? []).map((p) => ({ personId: p.id, role: p.role })));
  const [links, setLinks] = useState(before);
  const keys = useMemo(() => new Set(links.map((l) => key(l.personId, l.role))), [links]);

  return {
    links,
    setLinks,
    has: (personId: number, role: R) => keys.has(key(personId, role)),
    toggle: (personId: number, role: R) =>
      setLinks((ls) => ls.some((l) => l.personId === personId && l.role === role)
        ? ls.filter((l) => !(l.personId === personId && l.role === role))
        : [...ls, { personId, role }]),
    /** `prefix` is the entity's path, e.g. `${base}/movies/${ref}`. */
    commit(b: Batch, prefix: string) {
      const was = new Set(before.map((l) => key(l.personId, l.role)));
      for (const l of links) if (!was.has(key(l.personId, l.role))) b.put(`${prefix}/persons/${l.personId}/${l.role}`);
      for (const l of before) if (!keys.has(key(l.personId, l.role))) b.delete(`${prefix}/persons/${l.personId}/${l.role}`);
    },
  };
}

export type PeopleLinks<R extends string> = ReturnType<typeof usePeopleLinks<R>>;

/** The "People" section of an entity form: who's credited, by role, plus the picker. */
export function PeopleField<R extends string>({ state, roles, roleLabels, defaultRole, note }: {
  state: PeopleLinks<R>;
  roles: readonly R[];
  roleLabels: Record<R, string>;
  defaultRole: R;
  note?: string;
}) {
  const { data: allPeople = [], isLoading } = usePeople();
  const byId = useMemo(() => new Map(allPeople.map((p) => [p.id, p])), [allPeople]);
  const [role, setRole] = useState<R>(defaultRole);
  const [search, setSearch] = useState("");
  const [field, setField] = useState<PersonSearchField>("all");
  const [creating, setCreating] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const grouped = roles
    .map((r) => ({ role: r, people: state.links.filter((l) => l.role === r).map((l) => byId.get(l.personId)).filter((p): p is Person => !!p) }))
    .filter((g) => g.people.length > 0);
  const summary = grouped.length
    ? grouped.map((g) => `${roleLabels[g.role]}: ${g.people.map((p) => p.name).join(", ")}`).join(" · ")
    : "None selected";

  const filtered = useMemo(() => allPeople.filter((p) => matchesPersonSearch(p, field, search)), [allPeople, field, search]);

  return (
    <FormSection title="People" summary={summary}>
      {creating && (
        <PersonForm
          onClose={(savedName, savedId) => {
            setCreating(false);
            if (savedId == null) return;
            state.toggle(savedId, role);
            const lower = savedName?.toLowerCase();
            if (allPeople.some((p) => p.id !== savedId && p.name.toLowerCase() === lower)) {
              setDupWarning(`Another person named "${savedName}" already exists. Merge them from the person's page if it's the same one.`);
            }
          }}
        />
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {dupWarning && <Notice tone="warning" onDismiss={() => setDupWarning(null)}>{dupWarning}</Notice>}
      {grouped.length > 0 && (
        <div className="grid gap-1.5 text-sm">
          {grouped.map((g) => (
            <div key={g.role} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-2">
              <span className="pt-0.5 text-xs text-muted-foreground">{roleLabels[g.role]}</span>
              <div className="flex flex-wrap gap-1.5">
                {g.people.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs">
                    {p.name}
                    <button type="button" data-slot="remove" aria-label={`Remove ${p.name} as ${roleLabels[g.role]}`}
                            className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                            onClick={() => state.toggle(p.id, g.role)}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <PersonPicker
        roles={roles}
        roleLabels={roleLabels}
        activeRole={role}
        onRole={setRole}
        searchField={field}
        onSearchField={setField}
        search={search}
        onSearch={setSearch}
        onNewPerson={() => setCreating(true)}
        people={filtered}
        isChecked={(p, r) => state.has(p.id, r)}
        onToggle={(p, r) => state.toggle(p.id, r)}
        loading={isLoading}
      />
    </FormSection>
  );
}
