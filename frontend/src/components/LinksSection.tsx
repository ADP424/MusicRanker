import { ExternalLink, Pencil, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLinkMutations, useLinks } from "../api/hooks";
import { useCan } from "../guild/GuildProvider";
import { safeHref } from "../lib/url";
import { Empty, Section } from "./detail/DetailKit";

/**
 * Editable list of external links (listen/watch, discography, official site,
 * etc.) for a catalog entity. `path` is the URL segment for the owner
 * (e.g. "albums", "artists", "movies", "games", "television/shows",
 * "television/episodes"); `section` is its list-cache key prefix for
 * invalidation (e.g. "albums", "television").
 */
export function LinksSection(props: { path: string; section: string; ownerId: number }) {
  const { path, section, ownerId } = props;
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const { data: links = [] } = useLinks(path, ownerId);
  const { add, remove } = useLinkMutations(section, path, ownerId);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    add.mutate(
      { label: label.trim() === "" ? null : label.trim(), url: url.trim(), position: links.length },
      { onSuccess: () => { setLabel(""); setUrl(""); } },
    );
  }

  return (
    <Section
      title="Links"
      busy={add.isPending || remove.isPending}
      actions={canEdit && (
        <Button variant={editing ? "default" : "outline"} size="sm" onClick={() => setEditing((o) => !o)}>
          {editing ? "Done" : <><Pencil className="size-4" /> Edit</>}
        </Button>
      )}
    >
      {links.length === 0 ? <Empty>No links yet.</Empty> : (
        <ul className="grid gap-1 text-sm">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <a href={safeHref(l.url)} target="_blank" rel="noreferrer"
                 className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:underline">
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{l.label ?? l.url}</span>
              </a>
              {editing && (
                <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${l.label ?? l.url}`}
                        onClick={() => remove.mutate(l.id)}>
                  <X className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
          <Input aria-label="Link label" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} className="w-40" />
          <Input aria-label="Link URL" required placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-48 flex-1" />
          <Button type="submit" size="sm" disabled={add.isPending}>Add</Button>
        </form>
      )}
    </Section>
  );
}
