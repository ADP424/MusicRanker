import { useState } from "react";

import { useLinkMutations, useLinks } from "../api/hooks";
import type { Link as LinkItem } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { ConfirmDialog } from "./ConfirmDialog";

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
  const [confirmDelete, setConfirmDelete] = useState<LinkItem | null>(null);

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
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Links</h2>
        {canEdit && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {links.length > 0 ? (
        <ul className="plain-list">
          {links.map((l) => (
            <li key={l.id} className="row" style={{ gridTemplateColumns: editing ? "1fr auto" : "1fr", alignItems: "center" }}>
              <a href={l.url} target="_blank" rel="noreferrer">{l.label ?? l.url}</a>
              {editing && (
                <button type="button" style={{ fontSize: 12 }} onClick={() => setConfirmDelete(l)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No links yet.</p>
      )}

      {editing && (
        <form onSubmit={handleAdd} className="inline" style={{ marginTop: "0.5rem" }}>
          <input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ maxWidth: "9rem" }} />
          <input required placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
          <button type="submit" disabled={add.isPending}>Add</button>
        </form>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Remove the link "${confirmDelete.label ?? confirmDelete.url}"?`}
          onConfirm={() => { remove.mutate(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}
