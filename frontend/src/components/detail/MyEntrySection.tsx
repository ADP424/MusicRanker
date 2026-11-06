import { useMutation, useQuery } from "@tanstack/react-query";
import { Minus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api/client";
import { useGuildApi } from "../../api/hooks";
import { rk } from "../../api/keys";
import { useCan } from "../../guild/GuildProvider";
import { ConfirmDialog } from "../ConfirmDialog";
import { Empty, Section } from "./DetailKit";

type Entry = Record<string, unknown> & { notes?: string | null };

/**
 * "My list" on any detail page, over `<entryPath>/entry` (GET / PUT / DELETE):
 * add or remove the entry, edit private notes, and a counter (watches, reads,
 * listens) or an hours field where the vertical has one.
 */
export function MyEntrySection({ entryPath, noun, counter, hours }: {
  /** "movies/12", "artists/3/albums/7", "television/episodes/40", ... */
  entryPath: string;
  noun: string;
  counter?: { key: "watches" | "reads" | "listens"; label: string };
  /** Games: hours played, a decimal that may be unknown. */
  hours?: boolean;
}) {
  const { guildId, userId, base } = useGuildApi();
  const canRank = useCan("rank");
  const url = `${base}/${entryPath}/entry`;
  const { data: entry, isLoading } = useQuery({
    queryKey: rk(guildId, userId, ...entryPath.split("/"), "entry"),
    queryFn: () => api.get<Entry | null>(url),
    enabled: canRank,
  });
  const put = useMutation({ mutationFn: (body: Record<string, unknown>) => api.put(url, body) });
  const remove = useMutation({ mutationFn: () => api.delete(url) });
  const [notes, setNotes] = useState("");
  const [hoursText, setHoursText] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    setNotes(entry?.notes ?? "");
    setHoursText(entry?.hours_played != null ? String(entry.hours_played) : "");
  }, [entry]);

  if (!canRank) return null;
  const count = counter && entry ? Number(entry[counter.key] ?? 1) : 1;
  const notesDirty = (entry?.notes ?? "") !== notes;

  return (
    <Section title="My list" busy={put.isPending || remove.isPending}
             actions={entry && (
               <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
                 <X className="size-4" /> Remove
               </Button>
             )}>
      {isLoading ? <Empty>Loading…</Empty> : !entry ? (
        <div className="flex flex-wrap items-center gap-3">
          <Empty>This {noun} isn't in your list.</Empty>
          <Button size="sm" disabled={put.isPending} onClick={() => put.mutate({})}><Plus className="size-4" /> Add to my list</Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {counter && (
            <div className="flex items-center gap-3 text-sm">
              <span className="w-24 text-muted-foreground">{counter.label}</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="size-8" aria-label={`One fewer ${counter.label.toLowerCase()}`}
                        disabled={count <= 1 || put.isPending} onClick={() => put.mutate({ [counter.key]: count - 1 })}>
                  <Minus className="size-4" />
                </Button>
                <span className="w-10 text-center font-medium tabular-nums">{count}</span>
                <Button variant="outline" size="icon" className="size-8" aria-label={`One more ${counter.label.toLowerCase()}`}
                        disabled={put.isPending} onClick={() => put.mutate({ [counter.key]: count + 1 })}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          )}
          {hours && (
            <form className="flex items-center gap-3 text-sm" onSubmit={(e) => {
              e.preventDefault();
              const v = hoursText.trim();
              put.mutate({ hours_played: v === "" ? null : Number(v) });
            }}>
              <label htmlFor="entry-hours" className="w-24 text-muted-foreground">Hours played</label>
              <Input id="entry-hours" type="number" min={0} step={0.5} className="w-28" value={hoursText}
                     onChange={(e) => setHoursText(e.target.value)} placeholder="Unknown" />
              {hoursText !== (entry.hours_played != null ? String(entry.hours_played) : "") && (
                <Button type="submit" size="sm" variant="outline" disabled={put.isPending}>Save</Button>
              )}
            </form>
          )}
          <div className="grid gap-1.5 text-sm">
            <label htmlFor="entry-notes" className="text-muted-foreground">My notes <span className="text-xs">(only you see these)</span></label>
            <Textarea id="entry-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            {notesDirty && (
              <div className="flex gap-2">
                <Button size="sm" disabled={put.isPending} onClick={() => put.mutate({ notes: notes.trim() === "" ? null : notes })}>
                  Save notes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNotes(entry.notes ?? "")}>Discard</Button>
              </div>
            )}
          </div>
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          message={`Remove this ${noun} from your list? Its place in your ranking${counter ? `, ${counter.label.toLowerCase()}` : ""} and your notes will be lost.`}
          confirmLabel="Remove"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(undefined, { onSettled: () => setConfirmRemove(false) })}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </Section>
  );
}
