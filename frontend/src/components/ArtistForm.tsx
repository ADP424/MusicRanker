import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import { useGuildApi, useNationalities } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { Artist } from "../api/types";
import { GenreChooser } from "../genre/GenreChooser";
import { MUSIC_GENRES } from "../genre/config";
import { useCan } from "../guild/GuildProvider";
import { commitLinks, LinksField, useLinksField } from "./LinksField";
import { BusyButton } from "./Spinner";

/** Empty string → null for optional text columns. */
const orNull = (s: string) => (s.trim() === "" ? null : s);

export function ArtistForm(props: {
  initial?: Artist;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const { data: nats = [], isLoading: natsLoading } = useNationalities();
  const [genreOpen, setGenreOpen] = useState(false);
  const [addToList, setAddToList] = useState(true);

  const [f, setF] = useState({
    name:              initial?.name              ?? "",
    name_en:           initial?.name_en           ?? "",
    birth_nationality: initial?.birth_nationality ?? "",
    core_nationality:  initial?.core_nationality  ?? "",
    notes:             initial?.notes             ?? "",
  });

  const [primaryGenreSet, setPrimaryGenreSet] = useState<Set<number>>(
    initial?.primary_genre != null ? new Set([initial.primary_genre]) : new Set()
  );
  const [links, setLinks] = useLinksField(initial?.links);

  const save = useMutation({
    mutationFn: async () => {
      const [genreId] = primaryGenreSet;
      const body = {
        name: f.name,
        name_en: orNull(f.name_en),
        birth_nationality: f.birth_nationality,
        core_nationality: f.core_nationality,
        primary_genre: genreId ?? null,
        notes: orNull(f.notes),
      };
      const artist = editing
        ? await api.patch<Artist>(`${base}/artists/${initial.id}`, body)
        : await api.post<Artist>(`${base}/artists`, body);
      await commitLinks(base, "artists", artist.id, links, editing ? initial.links : []);
      if (!editing && addToList && canRank) await api.put(`${base}/artists/${artist.id}/entry`, {});
      return artist;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: gk(guildId, "artists") });
      if (!editing && addToList) qc.invalidateQueries({ queryKey: rk(guildId, userId, "artists") });
      onClose(saved.name, saved.id);
    },
  });

  const bind =
    <K extends keyof typeof f>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });

  return (
    <dialog open className="modal">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} Artist</h2>

        <label>Name
          <input required value={f.name} onChange={bind("name")} />
        </label>

        <label><span className="label-text">English name <span className="info-icon" title="optional">ⓘ</span></span>
          <input value={f.name_en} onChange={bind("name_en")} />
        </label>

        <div className="grid-2">
          <label>Birth / formed nationality
            <select required value={f.birth_nationality} disabled={natsLoading}
                    onChange={bind("birth_nationality")}>
              <option value="">{natsLoading ? "Loading…" : "—"}</option>
              {nats.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label>Core nationality
            <select required value={f.core_nationality} disabled={natsLoading}
                    onChange={bind("core_nationality")}>
              <option value="">{natsLoading ? "Loading…" : "—"}</option>
              {nats.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <fieldset>
          <legend
            className="collapsible-legend"
            onClick={() => setGenreOpen((o) => !o)}
          >
            Primary genre <small>(pick one)</small>
            <span className="collapse-arrow">{genreOpen ? "▲" : "▼"}</span>
          </legend>
          {genreOpen && (
            <GenreChooser
              domain={MUSIC_GENRES}
              selected={primaryGenreSet}
              onChange={setPrimaryGenreSet}
              single
            />
          )}
          {!genreOpen && primaryGenreSet.size > 0 && (
            <span className="collapsed-summary" onClick={() => setGenreOpen(true)}>
              {primaryGenreSet.size} selected
            </span>
          )}
        </fieldset>

        <label><span className="label-text">Notes <span className="info-icon" title="optional">ⓘ</span></span>
          <textarea rows={3} value={f.notes} onChange={bind("notes")} />
        </label>

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
