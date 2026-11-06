import { useState } from "react";

import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "./Spinner";

export function ConfirmDialog(props: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Heading; defaults to "Are you sure?". */
  title?: string;
  /** If set, the confirm button stays disabled until the user types this
   * text exactly — for actions destructive enough that a click alone
   * (e.g. a stray double-click) shouldn't be able to trigger them. */
  confirmText?: string;
  confirmLabel?: string;
  /** "danger" (default) for destructive actions; "default" for the rest. */
  tone?: "danger" | "default";
  /** While true the confirm button spins and the dialog refuses to close.
   * Callers keep the dialog mounted until their mutation settles:
   *   onConfirm={() => m.mutate(id, { onSettled: () => setConfirm(null) })}
   *   busy={m.isPending} */
  busy?: boolean;
}) {
  const { message, onConfirm, onCancel, title, confirmText, confirmLabel, tone = "danger", busy = false } = props;
  const [typed, setTyped] = useState("");
  const locked = confirmText !== undefined && typed !== confirmText;
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <AlertDialogContent aria-busy={busy || undefined} onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title ?? "Are you sure?"}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{message}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmText !== undefined && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span>
              Type <strong>{confirmText}</strong> to confirm
            </span>
            <Input autoFocus value={typed} disabled={busy} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText} />
          </label>
        )}
        <AlertDialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant={tone === "danger" ? "destructive" : "default"}
            disabled={locked || busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {busy && <Spinner size="sm" />}
            {busy ? "Working…" : confirmLabel ?? "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
