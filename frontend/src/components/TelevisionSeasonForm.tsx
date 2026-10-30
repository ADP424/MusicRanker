import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { gk, rk } from "../api/keys";
import type { TelevisionSeason, TelevisionShow } from "../api/types";
import { useCan } from "../guild/GuildProvider";
import { commitLinks, LinksField, useLinksField } from "./LinksField";
import { BusyButton } from "./Spinner";

const orNull = (s: string) => (s.trim() === "" ? null : s);

/** Create or edit a season's own fields. Its people are edited on the season
 *  page (or imported from TMDB); a new season can start from the show's. */
export function TelevisionSeasonForm(props: {
  show: TelevisionShow;
  initial?: TelevisionSeason;
  onClose: (savedName?: string, savedId?: number) => void;
}) {
  const { show, initial, onClose } = props;
  const editing = initial !== undefined;
  const qc = useQueryClient();
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const [inheritFromShow, setInheritFromShow] = useState(true);
  const [addToList, setAddToList] = useState(true);

  const nextNumber = Math.max(0, ...show.seasons.map((s) => s.season_number ?? 0)) + 1;
  const [f, setF] = useState({
    name:          initial?.name          ?? `Season ${nextNumber}`,
    name_en:       initial?.name_en       ?? "",
    season_number: initial ? (initial.season_number != null ? String(initial.season_number) : "") : String(nextNumber),
    release_year:  initial?.release_year  ?? show.release_year,
    notes:         initial?.notes         ?? "",
  });
  const [links, setLinks] = useLinksField(initial?.links);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name, name_en: orNull(f.name_en),
        season_number: f.season_number.trim() === "" ? null : Number(f.season_number),
        release_year: f.release_year, notes: orNull(f.notes),
      };
      const season = editing
        ? await api.patch<TelevisionSeason>(`${base}/television/seasons/${initial.id}`, body)
        : await api.post<TelevisionSeason>(`${base}/television/shows/${show.id}/seasons`, {
            ...body, inherit_from_show: inheritFromShow,
          });
      await commitLinks(base, "television/seasons", season.id, links, editing ? initial.links : []);
      if (!editing && addToList && canRank) await api.put(`${base}/television/seasons/${season.id}/entry`, {});
      return season;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: gk(guildId, "television") });
      qc.invalidateQueries({ queryKey: rk(guildId, userId, "television", "shows", show.id, "seasons") });
      onClose(saved.name, saved.id);
    },
  });

  const txt = (k: "name" | "name_en" | "notes" | "season_number") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <dialog open className="modal">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{editing ? "Edit" : "New"} Season <span style={{ opacity: 0.6, fontWeight: "normal" }}>— {show.name}</span></h2>

        {!editing && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
            <input type="checkbox" checked={inheritFromShow} onChange={(e) => setInheritFromShow(e.target.checked)} />
            <span>Start with the show's people (creators stay on the show)</span>
          </label>
        )}

        <label>Name
          <input required value={f.name} onChange={txt("name")} />
        </label>

        <label><span className="label-text">English name <span className="info-icon" title="optional">ⓘ</span></span>
          <input value={f.name_en} onChange={txt("name_en")} />
        </label>

        <div className="grid-2">
          <label><span className="label-text">Season number <span className="info-icon" title="TMDB's season number (0 = specials); used by the TMDB import">ⓘ</span></span>
            <input type="number" min={0} value={f.season_number} onChange={txt("season_number")} />
          </label>
          <label>Release year
            <input required type="number" value={f.release_year} onChange={(e) => setF({ ...f, release_year: Number(e.target.value) })} />
          </label>
        </div>

        <label><span className="label-text">Notes <span className="info-icon" title="optional">ⓘ</span></span>
          <textarea rows={3} value={f.notes} onChange={txt("notes")} />
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
