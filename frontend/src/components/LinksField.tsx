import { useState } from "react";

import { api } from "../api/client";
import type { Link as LinkItem } from "../api/types";

export type PendingEntityLink = { id?: number; label: string | null; url: string };

/**
 * Local (uncommitted) editor for an entity's external links, used inside
 * create/edit form dialogs. Starts from `initial` (empty for a new entity,
 * the entity's current links when editing) and tracks edits purely in
 * memory; the parent form calls `commitLinks` after it knows the owner id
 * to sync additions/edits/removals to the links API in one go.
 */
export function useLinksField(initial: LinkItem[] = []) {
  const [links, setLinks] = useState<PendingEntityLink[]>(
    initial.map((l) => ({ id: l.id, label: l.label, url: l.url })),
  );
  return [links, setLinks] as const;
}

/** Diffs `links` against `before` and issues the add/patch/delete calls needed
 * to bring the owner's link list in sync. Call after the owner entity exists. */
export async function commitLinks(
  base: string, path: string, ownerId: number, links: PendingEntityLink[], before: LinkItem[],
) {
  const beforeIds = new Set(before.map((l) => l.id));
  const keptIds = new Set(links.filter((l) => l.id !== undefined).map((l) => l.id));
  for (const l of before) {
    if (!keptIds.has(l.id)) await api.delete(`${base}/${path}/${ownerId}/links/${l.id}`);
  }
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (l.id !== undefined && beforeIds.has(l.id)) {
      const orig = before.find((b) => b.id === l.id)!;
      if (orig.label !== l.label || orig.url !== l.url || orig.position !== i) {
        await api.patch(`${base}/${path}/${ownerId}/links/${l.id}`, { label: l.label, url: l.url, position: i });
      }
    } else {
      await api.post(`${base}/${path}/${ownerId}/links`, { label: l.label, url: l.url, position: i });
    }
  }
}

export function LinksField(props: {
  links: PendingEntityLink[];
  onChange: (links: PendingEntityLink[]) => void;
}) {
  const { links, onChange } = props;
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  function add() {
    if (!url.trim()) return;
    onChange([...links, { label: label.trim() === "" ? null : label.trim(), url: url.trim() }]);
    setLabel("");
    setUrl("");
  }

  function remove(i: number) {
    onChange(links.filter((_, idx) => idx !== i));
  }

  return (
    <fieldset>
      <legend>Links</legend>
      {links.length > 0 && (
        <ul className="plain-list" style={{ marginBottom: "0.5rem" }}>
          {links.map((l, i) => (
            <li key={l.id ?? `new-${i}`} className="row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
              <span>{l.label ? `${l.label} — ` : ""}{l.url}</span>
              <button type="button" style={{ fontSize: 12 }} onClick={() => remove(i)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="inline">
        <input
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ maxWidth: "9rem" }}
        />
        <input
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          style={{ flex: 1 }}
        />
        <button type="button" onClick={add}>Add</button>
      </div>
    </fieldset>
  );
}
