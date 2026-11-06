import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SIZE = { sm: "size-4", md: "size-5", lg: "size-7" } as const;

export function Spinner({ size = "md", label = "Loading", className }: {
  size?: keyof typeof SIZE; label?: string; className?: string;
}) {
  return <Loader2 role="status" aria-label={label} className={cn("inline shrink-0 animate-spin text-muted-foreground", SIZE[size], className)} />;
}

/** Page- or section-level "we're fetching" block. Use `compact` inside sections/fieldsets. */
export function LoadingState({
  label = "Loading…",
  compact = false,
  className,
}: { label?: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center gap-2 text-sm text-muted-foreground", compact ? "py-2" : "py-10", className)}
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
    <span className="inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground" role="status" aria-live="polite">
      <Spinner size="sm" />
      {label}
    </span>
  );
}

/**
 * A Button that disables itself and shows a spinner while `busy`.
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
}: ComponentProps<typeof Button> & { busy?: boolean; busyLabel?: ReactNode }) {
  const content = busy && busyLabel !== undefined ? busyLabel : children;
  return (
    <Button {...rest} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <Spinner size="sm" className="text-current" />}
      {content}
    </Button>
  );
}

/** App-wide "a request is in flight" marker, driven straight off the QueryClient. */
export function ActivityIndicator() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  if (!fetching && !mutating) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
      <Spinner size="sm" />
      {mutating ? "Saving…" : "Loading…"}
    </span>
  );
}
