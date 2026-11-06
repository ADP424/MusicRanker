import { ChevronRight, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { Batch } from "../../api/client";
import { useNationalities } from "../../api/hooks";
import { UNKNOWN_NATIONALITY } from "../../api/types";
import { ConfirmDialog } from "../ConfirmDialog";
import { Modal } from "../Modal";
import { BusyButton } from "../Spinner";

/**
 * The shell every create/edit form opens in: a card in a `Modal` (focus trap,
 * Esc to cancel, outside clicks ignored) with a title bar, a body and a
 * Cancel / submit footer. The body is the form; `onSubmit` runs on Enter or
 * the submit button, so native `required` checks happen first.
 */
export function FormDialog({
  title, subtitle, onClose, onSubmit, busy = false, error, submitLabel, busyLabel = "Saving…",
  submitDisabled, wide, children, footerStart,
}: {
  title: string;
  /** Muted text after the title, e.g. the show a season belongs to. */
  subtitle?: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  busy?: boolean;
  error?: unknown;
  submitLabel: string;
  busyLabel?: string;
  submitDisabled?: boolean;
  wide?: boolean;
  children: ReactNode;
  /** Left side of the footer (e.g. "Add to my list"). */
  footerStart?: ReactNode;
}) {
  // Touched = any field changed. Chips and text inputs fire `change`; Radix
  // checkboxes and the remove-a-credit buttons are clicks.
  const touched = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (touched.current && !busy) setConfirmDiscard(true);
    else onClose();
  };

  return (
    <Modal onClose={requestClose} title={title}>
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard your changes?"
          message="What you've entered here hasn't been saved."
          confirmLabel="Discard"
          onConfirm={onClose}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
      <form
        onChange={() => { touched.current = true; }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-slot="checkbox"],[data-slot="remove"]')) touched.current = true;
        }}
        onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onSubmit(); }}
        className={cn("flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-xl border bg-card text-card-foreground shadow-xl sm:max-h-[calc(100dvh-3rem)]", wide ? "max-w-3xl" : "max-w-2xl")}
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <h2 className="min-w-0 text-lg">
            {title}
            {subtitle && <span className="font-normal text-muted-foreground"> · {subtitle}</span>}
          </h2>
          <Button type="button" variant="ghost" size="icon" className="-mt-1 -mr-2 size-8" aria-label="Close" onClick={requestClose}>
            <X />
          </Button>
        </div>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto px-5 py-4">{children}</div>
        {error != null && (
          <div className="border-t px-5 py-3"><Notice tone="error">{error instanceof Error ? error.message : String(error)}</Notice></div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          {footerStart && <div className="mr-auto">{footerStart}</div>}
          <Button type="button" variant="outline" onClick={requestClose} disabled={busy}>Cancel</Button>
          <BusyButton type="submit" busy={busy} busyLabel={busyLabel} disabled={submitDisabled}>{submitLabel}</BusyButton>
        </div>
      </form>
    </Modal>
  );
}

/** A labelled control. The label wraps its child, so a click on it focuses the input. */
export function Field({ label, optional, hint, children, className }: {
  label: ReactNode;
  optional?: boolean;
  /** One line of help under the control. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid content-start gap-1.5 text-sm", className)}>
      <span className="font-medium">
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Two fields side by side from `sm` up. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/** A bordered group that folds away, showing `summary` while closed. */
export function FormSection({ title, summary, defaultOpen = false, children }: {
  title: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-slot="section-trigger"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent/50"
        >
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="shrink-0 font-medium">{title}</span>
          {!open && summary && <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 border-t px-3 py-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** A bordered group that's always open. */
export function FormGroup({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 rounded-lg border px-3 py-3">
      <div className="flex items-center justify-between gap-2 text-sm font-medium">{title}{actions}</div>
      {children}
    </div>
  );
}

/** A checkbox with its label. */
export function CheckField({ checked, onChange, children, className }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm", className)}>
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span>{children}</span>
    </label>
  );
}

/** A tickable pill, for picking several things from a long list. */
export function ChipCheck({ checked, onChange, children, disabled }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        checked ? "border-primary/50 bg-primary/10" : "hover:bg-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input type="checkbox" data-slot="checkbox-native" className="size-3.5 accent-primary" checked={checked}
             disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** A one-of-many pill (role, filter). */
export function FilterChip({ active, onClick, children, title }: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      data-slot="chip"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** A row of pills that wraps, scrolling once it's tall. */
export function ChipList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2", className)}>{children}</div>;
}

const TONE = {
  warning: "border-warning/50 bg-warning/10",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "bg-muted/50",
  success: "border-success/40 bg-success/10",
} as const;

/** An inline message box. */
export function Notice({ tone = "info", onDismiss, children, className }: {
  tone?: keyof typeof TONE;
  onDismiss?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === "error" ? "alert" : undefined}
         className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", TONE[tone], className)}>
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" data-slot="dismiss" aria-label="Dismiss" onClick={onDismiss}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** The nationality `<select>` (birth / core) used by the person and artist forms:
 *  "Unknown" on its own first (always there), then the guild's list. */
export function NationalitySelect({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { data: nats = [], isLoading } = useNationalities();
  const current = value || UNKNOWN_NATIONALITY;
  // A value the list no longer has (just renamed elsewhere) still shows.
  const stray = current !== UNKNOWN_NATIONALITY && !isLoading && !nats.some((n) => n.name === current);
  return (
    <select value={current} disabled={isLoading} onChange={(e) => onChange(e.target.value)}>
      <option value={UNKNOWN_NATIONALITY}>{isLoading ? "Loading…" : UNKNOWN_NATIONALITY}</option>
      <optgroup label="Nationalities">
        {stray && <option>{current}</option>}
        {nats.map((n) => <option key={n.id}>{n.name}</option>)}
      </optgroup>
    </select>
  );
}

type NationalityPair = { birth_nationality: string; core_nationality: string };

/** Sets one nationality; if the other is still Unknown it takes the same value
 *  (the server applies the same rule, so the form just shows it early). */
export function withNationality<T extends NationalityPair>(prev: T, key: keyof NationalityPair, value: string): T {
  const other: keyof NationalityPair = key === "birth_nationality" ? "core_nationality" : "birth_nationality";
  const fill = value !== UNKNOWN_NATIONALITY && prev[other] === UNKNOWN_NATIONALITY;
  return { ...prev, [key]: value, ...(fill ? { [other]: value } : {}) };
}

/** Empty string → null for optional text columns. */
export const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

/** Records the PUT/DELETEs that turn `before` into `after` for an id junction
 *  (`<prefix>/<segment>/<id>`), e.g. a movie's genres. */
export function diffIds(b: Batch, prefix: string, segment: string, before: Iterable<number>, after: Set<number>) {
  const was = new Set(before);
  for (const id of after) if (!was.has(id)) b.put(`${prefix}/${segment}/${id}`);
  for (const id of was) if (!after.has(id)) b.delete(`${prefix}/${segment}/${id}`);
}

/** "3 selected" / "None selected". */
export const countSummary = (n: number) => (n > 0 ? `${n} selected` : "None selected");
