import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { Spinner } from "../components/Spinner";

export interface PlaceCandidate {
  id: number;
  name: string;
  sub?: ReactNode; // a second line: year, artist…
}

/** Places one item in an already-ordered list by binary insertion: about
 * log2(n) "which is better?" questions instead of a full pairwise run. Each
 * answer is also saved as a pairwise comparison, so the Rank page starts from
 * what you've already said. Finishes with `onPlace(position)` (1-based). */
export function PlaceItemDialog({ item, ranked, comparisonsPath, onPlace, onClose, placing = false }: {
  item: PlaceCandidate;
  ranked: PlaceCandidate[]; // the list as it stands, best first, without `item`
  comparisonsPath: string;  // e.g. "movies", "artists/12/albums"
  onPlace: (position: number) => void;
  onClose: () => void;
  placing?: boolean;
}) {
  const { base } = useGuildApi();
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(ranked.length);
  const [asked, setAsked] = useState(0);
  const total = Math.max(1, Math.ceil(Math.log2(ranked.length + 1)));
  const done = lo >= hi;
  const mid = (lo + hi) >> 1;
  const other = ranked[mid];

  useEffect(() => {
    if (done && !placing) onPlace(lo + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  function answer(itemWins: boolean) {
    if (done) return;
    // Fire-and-forget: the comparison is a bonus for the Rank page, never a
    // reason to stall the questions.
    void api.put(`${base}/${comparisonsPath}/comparisons`, itemWins
      ? { winner_id: item.id, loser_id: other.id }
      : { winner_id: other.id, loser_id: item.id }).catch(() => {});
    setAsked((n) => n + 1);
    if (itemWins) setHi(mid); else setLo(mid + 1);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "1") answer(true);
      if (e.key === "ArrowRight" || e.key === "2") answer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const card = (c: PlaceCandidate, wins: boolean, hint: string) => (
    <button
      type="button"
      onClick={() => answer(wins)}
      className="flex min-h-28 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border bg-card p-4 text-center transition-colors hover:border-primary hover:bg-primary/5"
    >
      <span className="font-medium">{c.name}</span>
      {c.sub && <span className="text-sm text-muted-foreground">{c.sub}</span>}
      <span className="mt-1 text-xs text-muted-foreground">{hint}</span>
    </button>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !placing) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Where does {item.name} go?</DialogTitle>
          <DialogDescription>
            {done
              ? `Placing it at #${lo + 1}…`
              : `Which do you rank higher? Question ${asked + 1} of about ${total}.`}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            {card(item, true, "← or 1")}
            <span className="self-center text-sm text-muted-foreground">or</span>
            {card(other, false, "→ or 2")}
          </div>
        )}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Somewhere between #{lo + 1} and #{hi + 1}</span>
          <Button variant="ghost" size="sm" disabled={placing} onClick={onClose}>Leave it at the bottom</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
