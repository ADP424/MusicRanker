import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The overlay every form/dialog opens in. Radix supplies the focus trap, Esc to
 * close, `aria-modal` and an inert page behind. A click outside deliberately
 * does *not* close it: that used to discard half-filled forms.
 *
 * `title` names the dialog for screen readers when the content has no heading
 * of its own that it wires up.
 */
export function Modal({
  onClose, children, title = "Dialog", className,
}: {
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 outline-none sm:items-center sm:p-6",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
