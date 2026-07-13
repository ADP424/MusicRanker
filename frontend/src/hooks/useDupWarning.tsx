import { useState } from "react";

interface Named { id: number; name: string }

/**
 * Post-save duplicate-name warning shared by the list pages. After a form
 * closes with the saved name/id, `checkAfterSave` scans the existing items for
 * another entry with the same (case-insensitive) name and, if found, shows a
 * warning banner.
 *
 * `noun` is the entity word used in the message ("artist" | "movie" | "person").
 */
export function useDupWarning(noun: string) {
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  function checkAfterSave<T extends Named>(
    items: T[],
    savedName?: string,
    savedId?: number,
  ) {
    if (savedName == null) return;
    const nameLower = savedName.toLowerCase();
    const dups = items.filter((it) => it.name.toLowerCase() === nameLower && it.id !== savedId);
    if (dups.length > 0) {
      setDupWarning(`Warning: another ${noun} named "${savedName}" already exists.`);
    }
  }

  const clear = () => setDupWarning(null);

  return { dupWarning, clear, checkAfterSave };
}

/** The banner element rendered when a duplicate warning is present. */
export function DupWarningBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="dup-warning">
      <span>{message}</span>
      <button className="icon" onClick={onDismiss}>✕</button>
    </div>
  );
}
