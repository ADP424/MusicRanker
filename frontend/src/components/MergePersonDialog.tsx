import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { gk } from "../api/keys";
import { Spinner } from "./Spinner";

interface Hit { id: number; name: string; name_en: string | null }

/** Folds a duplicate person into `keep`: their credits move over and the
 * duplicate is deleted. Starts the search from the person's own name, since
 * that's what a duplicate usually shares. */
export function MergePersonDialog({ keep, onClose }: { keep: Hit; onClose: () => void }) {
  const { guildId, base } = useGuildApi();
  const [q, setQ] = useState(keep.name.split(" ").slice(-1)[0] ?? keep.name);
  const [term, setTerm] = useState(q);
  const [picked, setPicked] = useState<Hit | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const hits = useQuery({
    queryKey: gk(guildId, "search", "person", term),
    queryFn: () => api.get<Hit[]>(`${base}/search?kinds=person&limit=20&q=${encodeURIComponent(term)}`),
    enabled: term.length > 0,
    placeholderData: (prev) => prev,
  });
  const others = (hits.data ?? []).filter((h) => h.id !== keep.id);

  const merge = useMutation({
    mutationFn: (dup: Hit) =>
      api.post<{ moved: number; already_had: number }>(`${base}/persons/${keep.id}/merge`, { duplicate_id: dup.id }),
    onSuccess: (r, dup) => {
      toast.success(`Merged ${dup.name} into ${keep.name}`, {
        description: `${r.moved} credit${r.moved === 1 ? "" : "s"} moved${r.already_had ? `, ${r.already_had} already on ${keep.name}` : ""}.`,
      });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !merge.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge a duplicate into {keep.name}</DialogTitle>
          <DialogDescription>
            Pick the other entry for the same person. Their movie, show, book, game and music credits move to
            {" "}{keep.name}, and the duplicate is deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus aria-label="Search people" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="max-h-64 overflow-y-auto rounded-md border">
          {hits.isFetching && others.length === 0 ? (
            <li className="flex justify-center py-4"><Spinner size="sm" /></li>
          ) : others.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">{term ? "No one else by that name." : "Type a name."}</li>
          ) : others.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => setPicked(h)}
                      className={cn("w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent",
                        picked?.id === h.id && "bg-primary/10 font-medium")}>
                {h.name}{h.name_en && <span className="text-muted-foreground"> ({h.name_en})</span>}
                <span className="ml-2 text-xs text-muted-foreground">#{h.id}</span>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={merge.isPending}>Cancel</Button>
          <Button disabled={!picked || merge.isPending} onClick={() => picked && merge.mutate(picked)}>
            {merge.isPending && <Spinner size="sm" />}
            {picked ? `Merge ${picked.name} in` : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
