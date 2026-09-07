import { useRef, useEffect, useState } from "react";
import { BusyButton } from "./Spinner";

export function ConfirmDialog(props: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** If set, the confirm button stays disabled until the user types this
   * text exactly — for actions destructive enough that a click alone
   * (e.g. a stray double-click) shouldn't be able to trigger them. */
  confirmText?: string;
  confirmLabel?: string;
  /** While true the confirm button spins and the dialog refuses to close.
   * Callers keep the dialog mounted until their mutation settles:
   *   onConfirm={() => m.mutate(id, { onSettled: () => setConfirm(null) })}
   *   busy={m.isPending} */
  busy?: boolean;
}) {
  const { message, onConfirm, onCancel, confirmText, confirmLabel, busy = false } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const locked = confirmText !== undefined && typed !== confirmText;
  return (
    <dialog
      ref={ref}
      className="modal confirm-dialog"
      aria-busy={busy || undefined}
      onCancel={(e) => { if (busy) e.preventDefault(); }}   // Esc while working
      onClose={() => { if (!busy) onCancel(); }}
    >
      <p>{message}</p>
      {confirmText !== undefined && (
        <label>
          Type <strong>{confirmText}</strong> to confirm
          <input
            autoFocus
            value={typed}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmText}
          />
        </label>
      )}
      <footer>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <BusyButton type="button" className="danger" disabled={locked} busy={busy} busyLabel="Working…" onClick={onConfirm}>
          {confirmLabel ?? "Delete"}
        </BusyButton>
      </footer>
    </dialog>
  );
}
