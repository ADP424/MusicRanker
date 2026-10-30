import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { useGameCatalog, useGuildApi, useMovieCatalog, useTelevisionCatalog } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { Album, NamedRef, SoundtrackKind } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { matchesAny } from "../search/textMatch";
import { InlineBusy, LoadingState } from "./Spinner";

const KINDS: { kind: SoundtrackKind; label: string; field: keyof Album; route: string }[] = [
  { kind: "movie", label: "Movies", field: "soundtrack_movies", route: "movies" },
  { kind: "television_show", label: "TV shows", field: "soundtrack_television_shows", route: "television/shows" },
  { kind: "game", label: "Games", field: "soundtrack_games", route: "games" },
];

/** The movies, TV shows and games this album is the soundtrack for. Shown
 * read-only as links; editors toggle them on from the guild catalog. */
export function AlbumSoundtracksSection({ album }: { album: Album }) {
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<SoundtrackKind>("movie");
  const [search, setSearch] = useState("");

  const movies = useMovieCatalog();
  const shows = useTelevisionCatalog();
  const games = useGameCatalog();
  const catalog: Record<SoundtrackKind, { data?: NamedRef[]; isLoading: boolean }> = {
    movie: movies, television_show: shows, game: games,
  };

  const invalidate = () => {
    const other = kind === "movie" ? "movies" : kind === "game" ? "games" : "television";
    // Albums are cached per album and per artist discography; ranked rows embed
    // the full entity, so my ranked lists carry these links too.
    qc.invalidateQueries({ queryKey: gk(guildId, "albums") });
    qc.invalidateQueries({ queryKey: gk(guildId, "artists") });
    qc.invalidateQueries({ queryKey: rk(guildId, userId, "artists") });
    // The scored media show "Soundtrack" on their own pages.
    qc.invalidateQueries({ queryKey: gk(guildId, other) });
    qc.invalidateQueries({ queryKey: rk(guildId, userId, other) });
  };
  const link = useMutation({
    mutationFn: (id: number) => api.put(`${base}/albums/${album.id}/soundtracks/${kind}/${id}`),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: (id: number) => api.delete(`${base}/albums/${album.id}/soundtracks/${kind}/${id}`),
    onSuccess: invalidate,
  });

  const active = KINDS.find((k) => k.kind === kind)!;
  const linkedIds = new Set((album[active.field] as NamedRef[]).map((r) => r.id));
  const needle = search.trim().toLowerCase();
  const options = (catalog[kind].data ?? [])
    .filter((r) => !needle || matchesAny(needle, r.name, r.name_en))
    .sort((a, b) => (linkedIds.has(a.id) ? 0 : 1) - (linkedIds.has(b.id) ? 0 : 1) || a.name.localeCompare(b.name));
  const total = KINDS.reduce((n, k) => n + (album[k.field] as NamedRef[]).length, 0);

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>Soundtrack for</h2>
          {(link.isPending || unlink.isPending) && <InlineBusy label="Saving…" />}
        </span>
        {canEdit && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div className="view-toggle" style={{ marginBottom: "0.4rem" }}>
            {KINDS.map((k) => (
              <button key={k.kind} className={kind === k.kind ? "view-toggle-active" : ""}
                      onClick={() => setKind(k.kind)}>{k.label}</button>
            ))}
          </div>
          <input
            className="genre-search"
            type="search"
            placeholder={`Search ${active.label.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: "0.4rem" }}
          />
          {catalog[kind].isLoading ? (
            <LoadingState compact label={`Loading ${active.label.toLowerCase()}…`} />
          ) : (
            <div className="chips">
              {options.map((r) => (
                <label key={r.id} className="chip">
                  <input
                    type="checkbox"
                    checked={linkedIds.has(r.id)}
                    onChange={(e) => (e.target.checked ? link.mutate(r.id) : unlink.mutate(r.id))}
                  />
                  {r.name}{r.name_en && <span style={{ opacity: 0.6 }}> ({r.name_en})</span>}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {total > 0 ? (
        KINDS.filter((k) => (album[k.field] as NamedRef[]).length > 0).map((k) => (
          <div key={k.kind} style={{ marginBottom: "0.75rem" }}>
            <div className="detail-label" style={{ marginBottom: "0.25rem" }}>{k.label}</div>
            <ul className="sortable plain-list">
              {(album[k.field] as NamedRef[]).map((r) => (
                <li key={r.id} className="sortable-item">
                  <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                    <Link className="name" to={`/g/${guildId}/${k.route}/${r.id}`}>
                      {r.name}{r.name_en && <span style={{ opacity: 0.6 }}> ({r.name_en})</span>}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>Not linked as a soundtrack.</p>
      )}
    </section>
  );
}
