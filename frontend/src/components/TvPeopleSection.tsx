import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { useGuildApi, usePeople } from "../api/hooks";
import { gk } from "../api/keys";
import type { CastRole, Person, TelevisionPersonRef } from "../api/types";
import { CAST_ROLE_LABELS } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { ConfirmDialog } from "./ConfirmDialog";
import { PersonForm } from "./PersonForm";
import { matchesPersonSearch, PersonPicker, type PersonSearchField } from "./PersonPicker";
import { BusyButton, InlineBusy } from "./Spinner";

type PendingLink = { personId: number; role: CastRole };
function linkKey(l: PendingLink) { return `${l.personId}:${l.role}`; }

/**
 * The People section of a show, season or episode page: its credits grouped
 * by role, plus an inline picker to link/unlink people.
 *
 * `populateDown` adds a button that copies these people onto everything
 * beneath (a show's seasons and episodes, or a season's episodes).
 */
export function TvPeopleSection({
  path,
  ownerId,
  persons,
  roles,
  defaultRole,
  populateDown,
}: {
  /** "television/shows" | "television/seasons" | "television/episodes" */
  path: string;
  ownerId: number;
  persons: TelevisionPersonRef[];
  roles: CastRole[];
  defaultRole: CastRole;
  populateDown?: { label: string; confirm: string };
}) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const { data: allPeople = [], isLoading: peopleLoading } = usePeople();
  const [editing, setEditing] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<PersonSearchField>("all");
  const [addRole, setAddRole] = useState<CastRole>(defaultRole);
  const [confirmPopulate, setConfirmPopulate] = useState(false);
  const [populated, setPopulated] = useState<number | null>(null);

  const castKeys = useMemo(() => new Set(persons.map((p) => linkKey({ personId: p.id, role: p.role }))), [persons]);

  const filteredPeople = useMemo(() => {
    return allPeople
      .filter((p) => matchesPersonSearch(p, searchField, search))
      .sort((a, b) => {
        const aKey = linkKey({ personId: a.id, role: addRole });
        const bKey = linkKey({ personId: b.id, role: addRole });
        return (castKeys.has(aKey) ? 0 : 1) - (castKeys.has(bKey) ? 0 : 1);
      });
  }, [search, searchField, allPeople, castKeys, addRole]);

  const invalidate = () => qc.invalidateQueries({ queryKey: gk(guildId, "television") });

  const link = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: CastRole }) =>
      api.put(`${base}/${path}/${ownerId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: ({ pid, role }: { pid: number; role: CastRole }) =>
      api.delete(`${base}/${path}/${ownerId}/persons/${pid}/${role}`),
    onSuccess: invalidate,
  });
  const populate = useMutation({
    mutationFn: () => api.post<{ links_added: number }>(`${base}/${path}/${ownerId}/populate-down`, {}),
    onSuccess: (r) => { setPopulated(r.links_added); invalidate(); },
  });

  function toggleLink(person: Person, role: CastRole) {
    const key = linkKey({ personId: person.id, role });
    if (castKeys.has(key)) unlink.mutate({ pid: person.id, role });
    else link.mutate({ pid: person.id, role });
  }

  const byRole: Partial<Record<CastRole, TelevisionPersonRef[]>> = {};
  for (const p of persons) (byRole[p.role] ??= []).push(p);

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>People</h2>
          {(link.isPending || unlink.isPending) && <InlineBusy label="Saving…" />}
        </span>
        {canEdit && (
          <span className="inline">
            {populateDown && persons.length > 0 && (
              <BusyButton style={{ fontSize: 12 }} busy={populate.isPending} busyLabel="Copying…"
                          onClick={() => { setPopulated(null); setConfirmPopulate(true); }}>
                {populateDown.label}
              </BusyButton>
            )}
            <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
              {editing ? "Done" : "Edit"}
            </button>
          </span>
        )}
      </header>
      {populated !== null && (
        <p className="meta" style={{ marginTop: 0 }}>
          {populated === 0 ? "Everything below already had these people." : `Added ${populated} credit${populated !== 1 ? "s" : ""} below.`}
        </p>
      )}
      {populate.isError && <p className="err">{(populate.error as Error).message}</p>}

      {editing && (
        <>
          {dupWarning && (
            <div className="dup-warning">
              <span>{dupWarning}</span>
              <button className="icon" onClick={() => setDupWarning(null)}>✕</button>
            </div>
          )}
          <div style={{ marginBottom: "0.75rem" }}>
            <PersonPicker
              roles={roles}
              roleLabels={CAST_ROLE_LABELS}
              activeRole={addRole}
              onRole={setAddRole}
              searchField={searchField}
              onSearchField={setSearchField}
              search={search}
              onSearch={setSearch}
              onNewPerson={() => setCreatingPerson(true)}
              people={filteredPeople}
              isChecked={(p, role) => castKeys.has(linkKey({ personId: p.id, role }))}
              onToggle={toggleLink}
              loading={peopleLoading}
              busy={link.isPending || unlink.isPending}
            />
          </div>
        </>
      )}

      {persons.length > 0 ? (
        roles.filter((r) => byRole[r]?.length).map((role) => (
          <div key={role} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>{CAST_ROLE_LABELS[role]}</div>
            <ul className="sortable plain-list">
              {byRole[role]!.map((p) => (
                <li key={`${p.id}:${p.role}`} className="sortable-item">
                  <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                    <Link className="name" to={`/g/${guildId}/people/${p.id}`}>
                      {p.name}{p.name_en && <span style={{ opacity: 0.6 }}> ({p.name_en})</span>}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No people linked.</p>
      )}

      {confirmPopulate && populateDown && (
        <ConfirmDialog
          message={populateDown.confirm}
          confirmLabel="Copy"
          busy={populate.isPending}
          onConfirm={() => populate.mutate(undefined, { onSettled: () => setConfirmPopulate(false) })}
          onCancel={() => setConfirmPopulate(false)}
        />
      )}

      {creatingPerson && (
        <div className="modal-backdrop" onClick={() => setCreatingPerson(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PersonForm
              onClose={(savedName, savedId) => {
                setCreatingPerson(false);
                if (savedId != null) {
                  qc.invalidateQueries({ queryKey: gk(guildId, "people") });
                  link.mutate({ pid: savedId, role: addRole });
                }
                if (savedName != null) {
                  const nameLower = savedName.toLowerCase();
                  const dups = allPeople.filter((p) => p.name.toLowerCase() === nameLower && p.id !== savedId);
                  if (dups.length > 0) setDupWarning(`Warning: another person named "${savedName}" already exists.`);
                }
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
