/** Case-insensitive substring match against any number of optional strings —
 * the shared building block every list page's title/name/alias/genre/person
 * filter uses so "does this needle match" is defined once. */
export function matchesAny(needle: string, ...values: (string | null | undefined)[]): boolean {
  return values.some((v) => v != null && v.toLowerCase().includes(needle));
}

/** Ids of the genres / platforms whose name or a synonym contains `needle`. */
export function taxonIdsMatching(
  needle: string, taxa: ReadonlyArray<{ id: number; name: string; synonyms?: string[] | null }>,
): Set<number> {
  return new Set(taxa.filter((t) => matchesAny(needle, t.name, ...(t.synonyms ?? []))).map((t) => t.id));
}

/** Whether any credited person's name contains `needle`. Entities carry their
 * people's names, so this needs no people list. */
export function personNamed(needle: string, persons: ReadonlyArray<{ name: string; name_en: string | null }>): boolean {
  return persons.some((p) => matchesAny(needle, p.name, p.name_en));
}
