import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import {
  useGuildApi, useTelevisionEpisode, useTelevisionEpisodeEntry, useTelevisionGenres, useTelevisionSeason,
  useTelevisionShow, useUpdateTelevisionEpisodeEntry,
} from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { Genre, TelevisionEpisode } from "../api/types";
import { TV_EPISODE_ROLES } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LinksSection } from "../components/LinksSection";
import { TelevisionEpisodeForm } from "../components/TelevisionEpisodeForm";
import { TvPeopleSection } from "../components/TvPeopleSection";
import { GenreChooser } from "../genre/GenreChooser";
import { TELEVISION_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { BusyButton, InlineBusy, LoadingState } from "../components/Spinner";

function fmtRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`;
  return `${m}m`;
}

// ── Genres section ───────────────────────────────────────────────────────────

function EpisodeGenresSection({ episodeId, episode }: { episodeId: number; episode: TelevisionEpisode }) {
  const qc = useQueryClient();
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<Genre | null>(null);
  const { data: allGenres = [] } = useTelevisionGenres();

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => { setGenreIds(new Set(episode.genre_ids)); }, [episode.genre_ids]);

  const genreMap = Object.fromEntries(allGenres.map((g) => [g.id, g]));
  const episodeGenres = episode.genre_ids.map((id) => genreMap[id]).filter(Boolean);

  const addGenre = useMutation({
    mutationFn: (gid: number) => api.put(`${base}/television/episodes/${episodeId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "television") }),
  });
  const removeGenre = useMutation({
    mutationFn: (gid: number) => api.delete(`${base}/television/episodes/${episodeId}/genres/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gk(guildId, "television") }),
  });

  function handleChange(next: Set<number>) {
    const prev = genreIds;
    for (const id of next) if (!prev.has(id)) addGenre.mutate(id);
    for (const id of prev) {
      if (!next.has(id)) {
        const g = genreMap[id];
        if (g) { setConfirmUnlink(g); return; }
      }
    }
    setGenreIds(next);
  }

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>Genres</h2>
          {(addGenre.isPending || removeGenre.isPending) && <InlineBusy label="Saving…" />}
        </span>
        {canEdit && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {editing && (
        <div style={{ marginBottom: "0.75rem" }}>
          <GenreChooser domain={TELEVISION_GENRES} selected={genreIds} onChange={handleChange} />
        </div>
      )}

      {episodeGenres.length > 0 ? (
        <ul className="sortable plain-list">
          {episodeGenres.map((g) => (
            <li key={g.id} className="sortable-item">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <Link className="name" to={`/g/${guildId}/television/genres/${g.id}`}>{g.name}</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>No genres linked.</p>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          message={`Remove genre "${confirmUnlink.name}" from this episode?`}
          busy={removeGenre.isPending}
          onConfirm={() => {
            const id = confirmUnlink.id;
            setGenreIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
            removeGenre.mutate(id, { onSettled: () => setConfirmUnlink(null) });
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}

// ── My list section ──────────────────────────────────────────────────────────

function MyEpisodeListSection({ seasonId, episodeId }: { seasonId: number; episodeId: number }) {
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const { data: entry, isLoading } = useTelevisionEpisodeEntry(episodeId);
  const update = useUpdateTelevisionEpisodeEntry(seasonId, episodeId);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (entry) setNotes(entry.notes ?? "");
  }, [entry]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: gk(guildId, "television", "seasons", seasonId, "episodes") });
    qc.invalidateQueries({ queryKey: gk(guildId, "television", "episodes", episodeId) });
    qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "seasons", seasonId, "episodes") });
    qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "episodes", episodeId, "entry") });
  };
  const add = useMutation({
    mutationFn: () => api.put(`${base}/television/episodes/${episodeId}/entry`, {}),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`${base}/television/episodes/${episodeId}/entry`),
    onSuccess: invalidate,
  });

  if (!canRank) return null;
  const saving = update.isPending || add.isPending || remove.isPending;

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <header className="page-head" style={{ marginBottom: "0.5rem" }}>
        <span className="inline">
          <h2 style={{ margin: 0 }}>My List</h2>
          {saving && <InlineBusy label="Saving…" />}
        </span>
        {entry && (
          <button style={{ fontSize: 12 }} onClick={() => setEditing((o) => !o)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>

      {isLoading ? (
        <LoadingState compact />
      ) : !entry ? (
        <p style={{ opacity: 0.5, margin: "0.25rem 0 0" }}>
          Not in your list. <BusyButton busy={add.isPending} busyLabel="Adding…" onClick={() => add.mutate()}>+ Add to my list</BusyButton>
        </p>
      ) : (
        <>
          <div className="artist-detail-grid">
            <div>
              <span className="detail-label">Watches</span>
              <span className="listens-ctrl">
                <button className="icon" title="Remove one watch" disabled={entry.watches <= 1}
                        onClick={() => update.mutate({ watches: entry.watches - 1 })}>−</button>
                <input
                  type="number" min={1} className="listens-input" value={entry.watches}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 1) update.mutate({ watches: n });
                  }}
                />
                <button className="icon" title="Add one watch"
                        onClick={() => update.mutate({ watches: entry.watches + 1 })}>+</button>
              </span>
            </div>
          </div>

          {editing ? (
            <div className="detail-section-form" style={{ marginTop: "0.75rem" }}>
              <label>My notes
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                <BusyButton busy={update.isPending} busyLabel="Saving…"
                            onClick={() => update.mutate({ notes: notes.trim() === "" ? null : notes })}>Save notes</BusyButton>
                <button className="danger" onClick={() => setConfirmRemove(true)}>✕ Remove from my list</button>
              </div>
            </div>
          ) : (
            entry.notes && (
              <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
                <span className="detail-label">My notes</span>
                <span>{entry.notes}</span>
              </div>
            )
          )}
        </>
      )}

      {confirmRemove && (
        <ConfirmDialog
          message="Remove this episode from your list? Your watch count and personal notes for it will be lost."
          confirmLabel="Remove"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(undefined, { onSettled: () => { setConfirmRemove(false); setEditing(false); } })}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function TelevisionEpisodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const eid = Number(id);
  const qc = useQueryClient();
  const { guildId } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);

  const { data: episode, isLoading, isError } = useTelevisionEpisode(eid);
  const { data: show } = useTelevisionShow(episode?.show_id ?? 0);
  const { data: season, isLoading: seasonLoading } = useTelevisionSeason(episode?.season_id ?? 0);

  if (isLoading) return <section><LoadingState label="Loading episode…" /></section>;
  if (isError || !episode) return <section><p>Episode not found.</p></section>;

  return (
    <section>
      <span className="back-link">
        <Link to={`/g/${guildId}/television/shows/${episode.show_id}`}>← {show?.name ?? "Show"}</Link>
        {" / "}
        <Link to={`/g/${guildId}/television/seasons/${episode.season_id}`}>{season?.name ?? "Season"}</Link>
      </span>
      <header className="page-head">
        <h1>
          {episode.name}{episode.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({episode.name_en})</span>}
        </h1>
        {canEdit && show && season && <button onClick={() => setEditing(true)}>✎ Edit</button>}
      </header>

      <div className="artist-detail-dropdown" style={{ marginBottom: "1.5rem" }}>
        <div className="artist-detail-grid">
          <div><span className="detail-label">Release year</span><span>{episode.release_year}</span></div>
          <div><span className="detail-label">Runtime</span><span>{fmtRuntime(episode.runtime_minutes)}</span></div>
        </div>
        {episode.notes && (
          <div className="detail-tags" style={{ marginTop: "0.5rem" }}>
            <span className="detail-label">Notes</span>
            <span>{episode.notes}</span>
          </div>
        )}
      </div>

      <TvPeopleSection
        path="television/episodes"
        ownerId={eid}
        persons={episode.persons}
        roles={TV_EPISODE_ROLES}
        defaultRole="director"
      />
      <EpisodeGenresSection episodeId={eid} episode={episode} />
      <LinksSection path="television/episodes" section="television" ownerId={eid} />
      {seasonLoading ? <LoadingState compact label="Loading season…" /> : season && <MyEpisodeListSection seasonId={season.id} episodeId={eid} />}

      {editing && show && season && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TelevisionEpisodeForm
              show={show}
              season={season}
              initial={episode}
              onClose={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: gk(guildId, "television", "episodes", eid) });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
