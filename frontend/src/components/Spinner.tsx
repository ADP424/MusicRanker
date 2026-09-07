import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Spinner({ size = "md", label = "Loading" }: { size?: "sm" | "md" | "lg"; label?: string }) {
  return <span className={`spinner spinner-${size}`} role="status" aria-label={label} />;
}

/** Page- or section-level "we're fetching" block. Use `compact` inside sections/fieldsets. */
export function LoadingState({
  label = "Loading…",
  compact = false,
  className,
}: { label?: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div
      className={`loading-state${compact ? " loading-state-compact" : ""}${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
    >
      <Spinner size={compact ? "sm" : "lg"} />
      <span>{label}</span>
    </div>
  );
}

/** Small spinner + optional text for section headers, rows, and summaries. */
export function InlineBusy({ label }: { label?: ReactNode }) {
  return (
    <span className="loading-inline" role="status" aria-live="polite">
      <Spinner size="sm" />
      {label}
    </span>
  );
}

/**
 * A <button> that disables itself and shows a spinner while `busy`.
 * - `busyLabel` replaces the children while busy ("Saving…").
 * - `busyLabel={null}` shows the spinner alone — for icon buttons.
 * - Omit `busyLabel` to keep the children and prepend a spinner.
 */
export function BusyButton({
  busy = false,
  busyLabel,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: ReactNode }) {
  const content = busy && busyLabel !== undefined ? busyLabel : children;
  return (
    <button {...rest} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <Spinner size="sm" />}
      {content}
    </button>
  );
}

/** App-wide "a request is in flight" marker, driven straight off the QueryClient. */
export function ActivityIndicator() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  if (!fetching && !mutating) return null;
  return (
    <span className="activity-indicator" role="status" aria-live="polite">
      <Spinner size="sm" />
      {mutating ? "Saving…" : "Loading…"}
    </span>
  );
}
