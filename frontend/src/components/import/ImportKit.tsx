import { Search, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../ConfirmDialog";
import { CheckField, Field, Notice } from "../form/FormKit";
import { Modal } from "../Modal";
import { BusyButton } from "../Spinner";

/**
 * The shell of a TMDB/IGDB import: a wide card in a `Modal`. Children are the
 * search step or the review (sections, then an `ImportFooter`).
 */
export function ImportDialog({ title, onClose, error, reviewing = false, children }: {
  title: string;
  onClose: () => void;
  error?: string | null;
  /** A review is on screen: Esc or the X asks first instead of throwing it away. */
  reviewing?: boolean;
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const requestClose = () => { if (reviewing) setConfirming(true); else onClose(); };
  return (
    <Modal onClose={requestClose} title={title}>
      {confirming && (
        <ConfirmDialog title="Close this import?" message="Nothing has been imported yet, and your choices here will be lost."
                       confirmLabel="Close it" onConfirm={onClose} onCancel={() => setConfirming(false)} />
      )}
      <div className="flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-xl border bg-card text-card-foreground shadow-xl sm:max-h-[calc(100dvh-3rem)] max-w-4xl">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <h2 className="text-lg">{title}</h2>
          <Button type="button" variant="ghost" size="icon" className="-mt-1 -mr-2 size-8" aria-label="Close" onClick={requestClose}>
            <X />
          </Button>
        </div>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto px-5 pt-4">
          {error && <Notice tone="error">{error}</Notice>}
          {children}
        </div>
      </div>
    </Modal>
  );
}

/** Step one: title (or a pasted link / id) and an optional year. */
export function ImportSearch({
  source, title, onTitle, year, onYear, placeholder, minYear, busy, onSearch, onCancel, children,
}: {
  source: "TMDB" | "IGDB";
  title: string;
  onTitle: (v: string) => void;
  year: string;
  onYear: (v: string) => void;
  placeholder: string;
  minYear: number;
  busy: boolean;
  onSearch: () => void;
  onCancel: () => void;
  /** Extra options under the fields. */
  children?: ReactNode;
}) {
  return (
    <form className="grid gap-4 pb-4" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onSearch(); }}>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="Title">
          <Input value={title} onChange={(e) => onTitle(e.target.value)} placeholder={placeholder} autoFocus />
        </Field>
        <Field label="Year" optional>
          <Input value={year} onChange={(e) => onYear(e.target.value)} type="number" min={minYear} max={2099} />
        </Field>
      </div>
      {children}
      <div className="-mx-5 flex justify-end gap-2 border-t px-5 pt-3">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <BusyButton type="submit" busy={busy} busyLabel={`Searching ${source}…`} disabled={!title.trim()}>
          <Search /> Search {source}
        </BusyButton>
      </div>
    </form>
  );
}

/** The found title: name, year, a line of facts, and a way back to the search. */
export function ImportTitle({ title, year, facts, ambiguous, onNewSearch }: {
  title: string;
  year?: number | null;
  facts?: ReactNode;
  /** The search had several plausible results; the candidates strip offers the rest. */
  ambiguous?: boolean;
  onNewSearch?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-lg">
          {title}
          {year ? <span className="font-normal text-muted-foreground"> ({year})</span> : null}
        </h3>
        {facts && <p className="text-sm text-muted-foreground">{facts}</p>}
        {ambiguous && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="size-3.5 text-warning" /> Several matches: check it's the right one
          </p>
        )}
      </div>
      {onNewSearch && (
        <Button type="button" variant="outline" size="sm" onClick={onNewSearch}><Search /> New search</Button>
      )}
    </div>
  );
}

/** A titled block of the review (people, genres, seasons). */
export function ImportSection({ title, count, onAll, onNone, hint, children, actions }: {
  title: string;
  /** "12 of 40 selected", or any short tally. */
  count?: ReactNode;
  onAll?: () => void;
  onNone?: () => void;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 border-b pb-1.5">
        <h3 className="text-base">{title}</h3>
        {count != null && <span className="text-sm text-muted-foreground">{count}</span>}
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {onAll && <Button type="button" variant="ghost" size="sm" onClick={onAll}>Select all</Button>}
          {onNone && <Button type="button" variant="ghost" size="sm" onClick={onNone}>Clear</Button>}
        </div>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

/** "TMDB genres with no match here: …". */
export function Unmapped({ source, noun, names }: { source: string; noun: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {source} {noun} with no match here: <span className="text-foreground">{names.join(", ")}</span>. Add them as
      synonyms on the {noun} page to have them picked up next time.
    </p>
  );
}

/** Sticky footer of the review: "Add to my list", Cancel, Import. */
export function ImportFooter({ addToList, onCancel, importing, disabled, onImport, label, children }: {
  addToList?: { checked: boolean; onChange: (v: boolean) => void; label?: string } | null;
  onCancel: () => void;
  importing: boolean;
  disabled?: boolean;
  onImport: () => void;
  label: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-1 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t bg-card px-5 py-3">
      {(addToList || children) && (
        <div className="mr-auto flex flex-wrap items-center gap-4">
          {addToList && (
            <CheckField checked={addToList.checked} onChange={addToList.onChange}>{addToList.label ?? "Add to my list"}</CheckField>
          )}
          {children}
        </div>
      )}
      <Button type="button" variant="outline" onClick={onCancel} disabled={importing}>Cancel</Button>
      <BusyButton type="button" busy={importing} busyLabel="Importing…" disabled={disabled} onClick={onImport}>{label}</BusyButton>
    </div>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A tickable line that isn't a person: an episode to create, a season. */
export function ImportCheckRow({ checked, onToggle, title, detail, sub }: {
  checked: boolean;
  onToggle: () => void;
  title: ReactNode;
  detail?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <label className={cn("flex cursor-pointer gap-3 rounded-md border px-3 py-1.5 text-sm transition-colors",
      checked ? "border-primary/40 bg-primary/5" : "bg-card")}>
      <Checkbox className="mt-0.5" checked={checked} onCheckedChange={onToggle} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{title}</span>
          {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
        </span>
        {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
    </label>
  );
}
