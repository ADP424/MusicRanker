import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import type { PersonDetail } from "../api/types";
import { type Credit, personCredits } from "./personCredits";

/** Moves some of a person's credits onto a new person: for two people who share
 *  a name, or undoing a merge that shouldn't have happened. */
export function SplitPersonDialog({ person, onClose }: { person: PersonDetail; onClose: () => void }) {
  const { guildId, base } = useGuildApi();
  const navigate = useNavigate();
  const credits = personCredits(person);
  const [name, setName] = useState(`${person.name} (2)`);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (c: Credit) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(c.key)) next.delete(c.key); else next.add(c.key);
    return next;
  });

  const split = useMutation({
    mutationFn: () => api.post<{ person_id: number; moved: number }>(`${base}/persons/${person.id}/split`, {
      name: name.trim(),
      credits: credits.filter((c) => picked.has(c.key)).map(({ kind, id, role }) => ({ kind, id, role })),
    }),
    onSuccess: (r) => {
      toast.success(`Created ${name.trim()}`, { description: `${r.moved} credit${r.moved === 1 ? "" : "s"} moved.` });
      onClose();
      navigate(`/g/${guildId}/people/${r.person_id}`);
    },
  });
  const all = picked.size === credits.length;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !split.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Split {person.name}</DialogTitle>
          <DialogDescription>
            Tick the credits that belong to someone else. They move to a new person; the rest stay here. TMDB/IGDB ids
            stay with {person.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="split-name">New person's name</Label>
          <Input id="split-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {credits.map((c) => (
            <li key={c.key}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50">
                <Checkbox checked={picked.has(c.key)} onCheckedChange={() => toggle(c)} />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{c.kindLabel} · {c.roleLabel}</span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter className="sm:justify-between">
          <span className="self-center text-sm text-muted-foreground">
            {picked.size} of {credits.length} selected{all ? ": that would leave nothing here" : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={split.isPending}>Cancel</Button>
            <Button disabled={!picked.size || all || !name.trim() || split.isPending} onClick={() => split.mutate()}>
              {split.isPending ? "Splitting…" : "Split"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
