import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { Batch } from "../api/client";
import type { Link as LinkItem } from "../api/types";
import { safeHref } from "../lib/url";
import { FormGroup } from "./form/FormKit";

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
export function commitLinks(
  b: Batch, base: string, path: string, ownerId: number | string, links: PendingEntityLink[], before: LinkItem[],
) {
  const beforeIds = new Set(before.map((l) => l.id));
  const keptIds = new Set(links.filter((l) => l.id !== undefined).map((l) => l.id));
  for (const l of before) {
    if (!keptIds.has(l.id)) b.delete(`${base}/${path}/${ownerId}/links/${l.id}`);
  }
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (l.id !== undefined && beforeIds.has(l.id)) {
      const orig = before.find((o) => o.id === l.id)!;
      if (orig.label !== l.label || orig.url !== l.url || orig.position !== i) {
        b.patch(`${base}/${path}/${ownerId}/links/${l.id}`, { label: l.label, url: l.url, position: i });
      }
    } else {
      b.post(`${base}/${path}/${ownerId}/links`, { label: l.label, url: l.url, position: i });
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
  const valid = !url.trim() || safeHref(url.trim()) !== undefined;

  function add() {
    if (!url.trim() || !valid) return;
    onChange([...links, { label: label.trim() === "" ? null : label.trim(), url: url.trim() }]);
    setLabel("");
    setUrl("");
  }

  return (
    <FormGroup title={<span>Links {links.length > 0 && <span className="font-normal text-muted-foreground">{links.length}</span>}</span>}>
      {links.length > 0 && (
        <ul className="grid gap-1">
          {links.map((l, i) => (
            <li key={l.id ?? `new-${i}`} className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {l.label && <span className="font-medium">{l.label} · </span>}
                <span className="text-muted-foreground">{l.url}</span>
              </span>
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove ${l.label ?? l.url}`}
                      onClick={() => onChange(links.filter((_, idx) => idx !== i))}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Label (optional)" aria-label="Link label" value={label}
               onChange={(e) => setLabel(e.target.value)} className="w-36" />
        <Input placeholder="https://…" aria-label="Link URL" value={url} aria-invalid={!valid}
               onChange={(e) => setUrl(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
               className="min-w-48 flex-1" />
        <Button type="button" variant="outline" onClick={add} disabled={!url.trim() || !valid}><Plus /> Add</Button>
      </div>
      {!valid && <p className="text-xs text-destructive">Links must start with http:// or https://</p>}
    </FormGroup>
  );
}
