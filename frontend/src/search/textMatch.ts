/** Case-insensitive substring match against any number of optional strings —
 * the shared building block every list page's title/name/alias/genre/person
 * filter uses so "does this needle match" is defined once. */
export function matchesAny(needle: string, ...values: (string | null | undefined)[]): boolean {
  return values.some((v) => v != null && v.toLowerCase().includes(needle));
}
