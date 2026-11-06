import { useMutation } from "@tanstack/react-query";
import { CopyCheck, Pencil, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "../../api/client";
import { useGuildApi, usePeople } from "../../api/hooks";
import type { Person } from "../../api/types";
import { useCan } from "../../guild/GuildProvider";
import { ConfirmDialog } from "../ConfirmDialog";
import { PersonForm } from "../PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "../PersonPicker";
import { Empty, Section } from "./DetailKit";

interface Credit<R extends string> { id: number; name: string; name_en?: string | null; role: R }

/**
 * The People card of any detail page: credits grouped by role, and (for
 * catalog editors) a picker that links/unlinks people immediately through
 * `<path>/<ownerId>/persons/<person>/<role>`.
 */
export function PeopleSection<R extends string>({
  path, ownerId, persons, roles, roleLabels, defaultRole, title = "People", scanHref, populateDown,
}: {
  /** "movies", "books", "games", "artists", "television/shows", ... */
  path: string;
  ownerId: number;
  persons: Credit<R>[];
  roles: readonly R[];
  roleLabels: Record<R, string>;
  defaultRole: R;
  title?: string;
  /** Guild-relative link to a TMDB/IGDB scan scoped to this entry. */
  scanHref?: string;
  /** Copy these people onto everything beneath (a show's seasons and episodes). */
  populateDown?: { label: string; confirm: string };
}) {
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const { data: allPeople = [], isLoading: peopleLoading } = usePeople(editing);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<R>(defaultRole);
  const [confirmPopulate, setConfirmPopulate] = useState(false);

  const held = useMemo(() => new Set(persons.map((p) => `${p.id}:${p.role}`)), [persons]);
  const matching = useMemo(
    () => allPeople.filter((p) => matchesPersonSearch(p, searchField, search)),
    [allPeople, searchField, search],
  );

  const link = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: R }) => api.put(`${base}/${path}/${ownerId}/persons/${pid}/${role}`),
  });
  const unlink = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: R }) => api.delete(`${base}/${path}/${ownerId}/persons/${pid}/${role}`),
  });
  const populate = useMutation({
    mutationFn: () => api.post<{ links_added: number }>(`${base}/${path}/${ownerId}/populate-down`, {}),
    onSuccess: (r) => toast.success(r.links_added === 0
      ? "Everything below already had these people."
      : `Added ${r.links_added} credit${r.links_added === 1 ? "" : "s"} below.`),
  });

  const toggle = (p: Person, role: R) => {
    if (held.has(`${p.id}:${role}`)) unlink.mutate({ pid: p.id, role });
    else link.mutate({ pid: p.id, role });
  };

  const byRole = roles
    .map((role) => [role, persons.filter((p) => p.role === role)] as const)
    .filter(([, list]) => list.length > 0);

  return (
    <Section
      title={title}
      count={new Set(persons.map((p) => p.id)).size || undefined}
      busy={link.isPending || unlink.isPending || populate.isPending}
      actions={canEdit && (
        <>
          {scanHref && (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/g/${guildId}/${scanHref}`} title="Look on TMDB/IGDB for people in your catalog credited on this">
                <ScanSearch className="size-4" /> Scan
              </Link>
            </Button>
          )}
          {populateDown && persons.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmPopulate(true)}>
              <CopyCheck className="size-4" /> {populateDown.label}
            </Button>
          )}
          <Button variant={editing ? "default" : "outline"} size="sm" onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : <><Pencil className="size-4" /> Edit</>}
          </Button>
        </>
      )}
    >
      {editing && (
        <PersonPicker
          roles={roles} roleLabels={roleLabels} activeRole={addRole} onRole={setAddRole}
          searchField={searchField} onSearchField={setSearchField} search={search} onSearch={setSearch}
          onNewPerson={() => setCreating(true)} people={matching}
          isChecked={(p, role) => held.has(`${p.id}:${role}`)} onToggle={toggle}
          loading={peopleLoading} busy={link.isPending || unlink.isPending}
        />
      )}

      {byRole.length === 0 ? <Empty>No one credited yet.</Empty> : (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
          {byRole.map(([role, list]) => (
            <div key={role} className="contents">
              <dt className="text-muted-foreground">{roleLabels[role]}</dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-1">
                {list.map((p) => (
                  <Link key={p.id} to={`/g/${guildId}/people/${p.id}`} className="font-medium hover:underline">
                    {p.name}{p.name_en && <span className="font-normal text-muted-foreground"> ({p.name_en})</span>}
                  </Link>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {creating && (
        <>
          <PersonForm
            onClose={(savedName, savedId) => {
              setCreating(false);
              if (savedId != null) link.mutate({ pid: savedId, role: addRole });
              if (savedName != null && allPeople.some((p) => p.id !== savedId && p.name.toLowerCase() === savedName.toLowerCase())) {
                toast.warning(`Another person is already called "${savedName}"`, {
                  description: "If it's the same person, open one of them and use Merge a duplicate.",
                });
              }
            }}
          />
        </>
      )}
      {confirmPopulate && populateDown && (
        <ConfirmDialog
          title={populateDown.label}
          message={populateDown.confirm}
          confirmLabel="Copy down"
          tone="default"
          busy={populate.isPending}
          onConfirm={() => populate.mutate(undefined, { onSettled: () => setConfirmPopulate(false) })}
          onCancel={() => setConfirmPopulate(false)}
        />
      )}
    </Section>
  );
}
