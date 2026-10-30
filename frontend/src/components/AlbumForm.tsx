import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useArtistCatalog, useGuildApi, useMusicGenres } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { Album } from "../api/types";
import { MUSIC_GENRES } from "../genre/config";
import { GenreChooser } from "../genre/GenreChooser";
import { useCan } from "../guild/GuildProvider";
import { commitLinks, LinksField, useLinksField } from "./LinksField";
import { BusyButton, LoadingState } from "./Spinner";

const orNull = (s: string) => (s.trim() === "" ? null : s);

export function AlbumForm(props: {
  artistId: number;
  initial?: Album;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { artistId, initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  useMusicGenres(); // warm cache
  const [artistsOpen, setArtistsOpen] = useState(false);
  const [genreOpen, setGenreOpen] = useState(false);
  const [addToList, setAddToList] = useState(true);

  const initMin = initial ? Math.floor(initial.runtime_seconds / 60) : 0;
  const initSec = initial ? initial.runtime_seconds % 60 : 0;

  const [f, setF] = useState({
    name:         initial?.name         ?? "",
    name_en:      initial?.name_en      ?? "",
    min:          initMin,
    sec:          initSec,
    release_year: initial?.release_year ?? new Date().getFullYear(),
    alias:        initial?.alias        ?? "",
    notes:        initial?.notes        ?? "",
  });

  const [genreIds, setGenreIds] = useState<Set<number>>(new Set(initial?.genre_ids ?? []));
  const [links, setLinks] = useLinksField(initial?.links);

  const { data: allArtists = [], isLoading: artistsLoading } = useArtistCatalog();
  const [artistIds, setArtistIds] = useState<Set<number>>(
    () => new Set(editing ? initial.artists.map((a) => a.id) : [artistId])
  );
  const [artistSearch, setArtistSearch] = useState("");

  const before = useMemo(
    () => ({ artists: new Set(initial?.artists.map((a) => a.id) ?? []), genres: new Set(initial?.genre_ids ?? []) }),
    [initial],
  );

  const save = useMutation({
    mutationFn: async () => {
      const runtime_seconds = f.min * 60 + f.sec;
      let album: Album;
      if (editing) {
        album = await api.patch<Album>(`${base}/albums/${initial.id}`, {
          name: f.name, name_en: orNull(f.name_en), runtime_seconds, release_year: f.release_year,
          alias: orNull(f.alias), notes: orNull(f.notes),
        });
        for (const id of artistIds) if (!before.artists.has(id)) await api.put(`${base}/albums/${album.id}/artists/${id}`);
        for (const id of before.artists) if (!artistIds.has(id)) await api.delete(`${base}/albums/${album.id}/artists/${id}`);
        for (const id of genreIds) if (!before.genres.has(id)) await api.put(`${base}/albums/${album.id}/genres/${id}`);
        for (const id of before.genres) if (!genreIds.has(id)) await api.delete(`${base}/albums/${album.id}/genres/${id}`);
        await commitLinks(base, "albums", album.id, links, initial.links);
      } else {
        album = await api.post<Album>(`${base}/albums`, {
          name: f.name, name_en: orNull(f.name_en), runtime_seconds, release_year: f.release_year,
          alias: orNull(f.alias), notes: orNull(f.notes), artist_ids: [...artistIds],
        });
        for (const id of genreIds) await api.put(`${base}/albums/${album.id}/genres/${id}`);
        await commitLinks(base, "albums", album.id, links, []);
        if (addToList && canRank) {
          for (const id of artistIds) await api.put(`${base}/artists/${id}/albums/${album.id}/entry`, {});
        }
      }
      return album;
    },
    onSuccess: (album) => {
      qc.invalidateQueries({ queryKey: gk(guildId, "artists", artistId, "albums") });
      qc.invalidateQueries({ queryKey: gk(guildId, "artists") });
      // New entries (on create) or carried-over ranks (on linking a co-artist) can land in
      // any credited artist's list, not just this one's.
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "artists") });
      onClose(album.name, album.id);
    },
  });

  const num =
    (k: "min" | "sec" | "release_year") =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setF({ ...f, [k]: Number(e.target.value) });
  const txt =
    (k: "name" | "name_en" | "alias" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });

  const [artistSortSnap, setArtistSortSnap] = useState(() => artistIds);
  useEffect(() => { setArtistSortSnap(artistIds); }, [artistSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredArtists = useMemo(() => {
    const q = artistSearch.trim().toLowerCase();
    return allArtists
      .filter((a) => !q || a.name.toLowerCase().includes(q) || !!a.name_en?.toLowerCase().includes(q))
      .sort((a, b) => (artistSortSnap.has(a.id) ? 0 : 1) - (artistSortSnap.has(b.id) ? 0 : 1));
  }, [artistSearch, allArtists, artistSortSnap]);

  return (
    <dialog open className="modal">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} Album</h2>

        <label>Name
          <input required value={f.name} onChange={txt("name")} />
        </label>

        <label><span className="label-text">English name <span className="info-icon" title="optional">ⓘ</span></span>
          <input value={f.name_en} onChange={txt("name_en")} />
        </label>

        <div className="grid-2">
          <label>Runtime
            <div className="inline">
              <input type="number" min={0} value={f.min}
                     onChange={num("min")} style={{ width: "4rem" }} /> min
              <input type="number" min={0} max={59} value={f.sec}
                     onChange={num("sec")} style={{ width: "4rem" }} /> sec
            </div>
          </label>
          <label>Release year
            <input required type="number" value={f.release_year}
                   onChange={num("release_year")} />
          </label>
        </div>

        <label><span className="label-text">Alias <span className="info-icon" title="if released under a different name">ⓘ</span></span>
          <input value={f.alias} onChange={txt("alias")} />
        </label>

        <label><span className="label-text">Notes <span className="info-icon" title="optional">ⓘ</span></span>
          <textarea rows={3} value={f.notes} onChange={txt("notes")} />
        </label>

        <fieldset>
          <legend
            className="collapsible-legend"
            onClick={() => setArtistsOpen((o) => !o)}
          >
            Artists
            <span className="collapse-arrow">{artistsOpen ? "▲" : "▼"}</span>
          </legend>
          {artistsOpen && (
            <>
              <input
                className="genre-search"
                type="search"
                placeholder="Search artists…"
                value={artistSearch}
                onChange={(e) => setArtistSearch(e.target.value)}
              />
              {artistsLoading ? (
                <LoadingState compact label="Loading artists…" />
              ) : (
                <div className="chips">
                  {filteredArtists.map((a) => (
                    <label key={a.id} className="chip">
                      <input
                        type="checkbox"
                        checked={artistIds.has(a.id)}
                        onChange={(e) => {
                          const next = new Set(artistIds);
                          e.target.checked ? next.add(a.id) : next.delete(a.id);
                          setArtistIds(next);
                        }}
                      />
                      {a.name}{a.name_en && <span style={{ opacity: 0.6 }}> ({a.name_en})</span>}
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          {!artistsOpen && (
            <span className="collapsed-summary" onClick={() => setArtistsOpen(true)}>
              {artistIds.size} selected
            </span>
          )}
        </fieldset>

        <fieldset>
          <legend
            className="collapsible-legend"
            onClick={() => setGenreOpen((o) => !o)}
          >
            Genres
            <span className="collapse-arrow">{genreOpen ? "▲" : "▼"}</span>
          </legend>
          {genreOpen && (
            <GenreChooser domain={MUSIC_GENRES} selected={genreIds} onChange={setGenreIds} />
          )}
          {!genreOpen && (
            <span className="collapsed-summary" onClick={() => setGenreOpen(true)}>
              {genreIds.size > 0 ? `${genreIds.size} selected` : "None selected"}
            </span>
          )}
        </fieldset>

        <LinksField links={links} onChange={setLinks} />

        {!editing && canRank && (
          <label className="checkbox-label">
            <input type="checkbox" checked={addToList} onChange={(e) => setAddToList(e.target.checked)} />
            Add to my list
          </label>
        )}

        <footer>
          <button type="button" onClick={() => onClose()} disabled={save.isPending}>Cancel</button>
          <BusyButton type="submit" busy={save.isPending} busyLabel={editing ? "Saving…" : "Creating…"}>
            {editing ? "Save" : "Create"}
          </BusyButton>
        </footer>
        {save.isError && <p className="err">{(save.error as Error).message}</p>}
      </form>
    </dialog>
  );
}
