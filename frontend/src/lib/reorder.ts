/** The optimistic cache value for a drag-reorder of a ranked list: whole entries
 *  move (with their notes and watch/listen counts), only `position` is renumbered.
 *  `field` names the entry property holding the item, e.g. "movie". */
export function reorderEntries<E extends { position: number }, K extends keyof E>(
  entries: E[],
  next: ReadonlyArray<{ id: number }>,
  field: K,
): E[] {
  const byId = new Map(entries.map((e) => [(e[field] as { id: number }).id, e]));
  return next.flatMap((item, i) => {
    const entry = byId.get(item.id);
    return entry ? [{ ...entry, position: i + 1 }] : [];
  });
}
