import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useGenres } from "../api/hooks";
import type { Album, AlbumBody, ArtistRef, Genre } from "../api/types";
import { GenreChooser } from "./GenreChooser";

const orNull = (s: string) => (s.trim() === "" ? null : s);

export function AlbumForm(props: {
  artistId: number;
  initial?: Album;
  onClose: () => void;
}) {
  const { artistId, initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  useGenres(); // warm cache
  const [artistsOpen, setArtistsOpen] = useState(false);
  const [genreOpen, setGenreOpen] = useState(false);

  const initMin = initial ? Math.floor(initial.runtime_seconds / 60) : 0;
  const initSec = initial ? initial.runtime_seconds % 60 : 0;

  const [f, setF] = useState({
    name:         initial?.name         ?? "",
    min:          initMin,
    sec:          initSec,
    release_year: initial?.release_year ?? new Date().getFullYear(),
    alias:        initial?.alias        ?? "",
    alias_link:   initial?.alias_link   ?? "",
    listens:      initial?.listens      ?? 1,
    listen_link:  initial?.listen_link  ?? "",
    notes:        initial?.notes        ?? "",
  });

  const { data: currentGenres = [] } = useQuery({
    queryKey: ["albums", initial?.id, "genres"],
    queryFn: () => api.get<Genre[]>(`/albums/${initial!.id}/genres`),
    enabled: editing,
  });
  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (currentGenres.length) setGenreIds(new Set(currentGenres.map((g) => g.id)));
  }, [currentGenres]);

  const { data: currentArtists = [] } = useQuery({
    queryKey: ["albums", initial?.id, "artists"],
    queryFn: () => api.get<ArtistRef[]>(`/albums/${initial!.id}/artists`),
    enabled: editing,
  });
  const { data: allArtists = [] } = useQuery({
    queryKey: ["artists"],
    queryFn: () => api.get<ArtistRef[]>("/artists"),
  });
  const [artistIds, setArtistIds] = useState<Set<number>>(new Set());
  const [artistSearch, setArtistSearch] = useState("");
  useEffect(() => {
    if (currentArtists.length) {
      setArtistIds(new Set(currentArtists.map((a) => a.id)));
    } else if (!editing) {
      setArtistIds(new Set([artistId]));
    }
  }, [currentArtists, editing, artistId]);

  const save = useMutation({
    mutationFn: async () => {
      const body: AlbumBody = {
        name: f.name,
        runtime_seconds: f.min * 60 + f.sec,
        release_year: f.release_year,
        alias: orNull(f.alias),
        alias_link: orNull(f.alias_link),
        listens: f.listens,
        listen_link: orNull(f.listen_link),
        notes: orNull(f.notes),
      };

      let album: Album;
      if (editing) {
        album = await api.patch<Album>(`/albums/${initial.id}`, body);
      } else {
        album = await api.post<Album>("/albums", body);
      }

      if (editing) {
        const beforeArtists = new Set(currentArtists.map((a) => a.id));
        for (const id of artistIds)
          if (!beforeArtists.has(id)) await api.put(`/albums/${album.id}/artists/${id}`);
        for (const id of beforeArtists)
          if (!artistIds.has(id)) await api.delete(`/albums/${album.id}/artists/${id}`);
      } else {
        for (const id of artistIds)
          await api.put(`/albums/${album.id}/artists/${id}`);
      }

      const before = new Set(currentGenres.map((g) => g.id));
      for (const id of genreIds)
        if (!before.has(id)) await api.put(`/albums/${album.id}/genres/${id}`);
      for (const id of before)
        if (!genreIds.has(id)) await api.delete(`/albums/${album.id}/genres/${id}`);

      return album;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artists", artistId, "albums"] });
      qc.invalidateQueries({ queryKey: ["albums", "index"] });
      onClose();
    },
  });

  const num =
    (k: "min" | "sec" | "release_year" | "listens") =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setF({ ...f, [k]: Number(e.target.value) });
  const txt =
    (k: "name" | "alias" | "alias_link" | "listen_link" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });

  const [artistSortSnap, setArtistSortSnap] = useState(() => artistIds);
  useEffect(() => { setArtistSortSnap(artistIds); }, [artistSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredArtists = useMemo(() => {
    const q = artistSearch.trim().toLowerCase();
    return allArtists
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => (artistSortSnap.has(a.id) ? 0 : 1) - (artistSortSnap.has(b.id) ? 0 : 1));
  }, [artistSearch, allArtists, artistSortSnap]);

  return (
    <dialog open className="modal">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} Album</h2>

        <label>Name
          <input required value={f.name} onChange={txt("name")} />
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

        <div className="grid-2">
          <label>Alias <small>(if released under a different name)</small>
            <input value={f.alias} onChange={txt("alias")} />
          </label>
          <label>Alias link
            <input type="url" value={f.alias_link} onChange={txt("alias_link")} />
          </label>
        </div>

        <div className="grid-2">
          <label>Listens
            <input type="number" min={1} value={f.listens}
                   onChange={num("listens")} />
          </label>
          <label>Listen link
            <input type="url" value={f.listen_link}
                   onChange={txt("listen_link")} />
          </label>
        </div>

        <label>Notes
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
                    {a.name}
                  </label>
                ))}
              </div>
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
            <GenreChooser selected={genreIds} onChange={setGenreIds} />
          )}
          {!genreOpen && (
            <span className="collapsed-summary" onClick={() => setGenreOpen(true)}>
              {genreIds.size > 0 ? `${genreIds.size} selected` : "None selected"}
            </span>
          )}
        </fieldset>

        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={save.isPending}>
            {editing ? "Save" : "Create"}
          </button>
        </footer>
        {save.isError && <p className="err">{(save.error as Error).message}</p>}
      </form>
    </dialog>
  );
}
