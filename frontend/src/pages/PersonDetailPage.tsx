import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { gk } from "../api/keys";
import { useGuildApi, usePersonDetail } from "../api/hooks";
import { PersonForm } from "../components/PersonForm";
import { LoadingState } from "../components/Spinner";
import { BAND_ROLE_LABELS, CAST_ROLE_LABELS, GAME_ROLE_LABELS } from "../api/types";
import { useCan } from "../guild/GuildProvider";

export function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const pid = Number(id);
  const qc = useQueryClient();
  const { guildId } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);

  const { data, isLoading, isError } = usePersonDetail(pid);

  if (isLoading) return <section><LoadingState /></section>;
  if (isError || !data) return <section><p>Person not found.</p></section>;

  return (
    <section>
      <header className="page-head">
        <h1>{data.name}{data.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({data.name_en})</span>}</h1>
        {canEdit && <button onClick={() => setEditing(true)}>✎ Edit</button>}
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div>
            <span className="detail-label">Core nationality</span>
            <span>{data.core_nationality}</span>
          </div>
          {data.birth_nationality !== data.core_nationality && (
            <div>
              <span className="detail-label">Birth nationality</span>
              <span>{data.birth_nationality}</span>
            </div>
          )}
        </div>
        {data.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{data.notes}</span>
          </div>
        )}
      </div>

      {data.artists.length > 0 && (
        <>
          <h2>Artists</h2>
          <ul className="sortable plain-list">
            {data.artists.map((a) => (
              <li key={a.id} className="sortable-item">
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <Link className="name" to={`/g/${guildId}/music/artists/${a.id}`}>{a.name}</Link>
                  <span className="meta">{BAND_ROLE_LABELS[a.role] ?? a.role}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.movie_roles.length > 0 && (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Movie Roles</h2>
          <ul className="sortable plain-list">
            {data.movie_roles.map((r, i) => (
              <li key={i} className="sortable-item">
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <Link className="name" to={`/g/${guildId}/movies/${r.movie_id}`}>{r.movie_name}</Link>
                  <span className="meta">{CAST_ROLE_LABELS[r.role] ?? r.role}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.game_roles.length > 0 && (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Game Roles</h2>
          <ul className="sortable plain-list">
            {data.game_roles.map((r, i) => (
              <li key={i} className="sortable-item">
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <Link className="name" to={`/g/${guildId}/games/${r.game_id}`}>{r.game_name}</Link>
                  <span className="meta">{GAME_ROLE_LABELS[r.role] ?? r.role}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.television_roles.length > 0 && (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Television Roles</h2>
          <ul className="sortable plain-list">
            {data.television_roles.map((r, i) => (
              <li key={i} className="sortable-item">
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <Link className="name" to={`/g/${guildId}/television/shows/${r.show_id}`}>{r.show_name}</Link>
                  <span className="meta">{CAST_ROLE_LABELS[r.role] ?? r.role}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.television_episode_roles.length > 0 && (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Television Episode Roles</h2>
          <ul className="sortable plain-list">
            {data.television_episode_roles.map((r, i) => (
              <li key={i} className="sortable-item">
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <Link className="name" to={`/g/${guildId}/television/episodes/${r.episode_id}`}>
                    {r.show_name} — {r.episode_name}
                  </Link>
                  <span className="meta">{CAST_ROLE_LABELS[r.role] ?? r.role}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.artists.length === 0 && data.movie_roles.length === 0 && data.game_roles.length === 0 &&
        data.television_roles.length === 0 && data.television_episode_roles.length === 0 && (
        <p style={{ opacity: 0.5 }}>No linked artists, movie roles, game roles, or television roles yet.</p>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PersonForm
              initial={data}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: gk(guildId, "people", pid) });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
