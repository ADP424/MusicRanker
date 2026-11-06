/** Names of each entry and everything above it, so filtering by "Rock" also finds "Post-Rock". */
export function taxonomyNames<G extends { id: number; name: string; parent_ids: number[] }>(all: G[]) {
  const byId = new Map(all.map((g) => [g.id, g]));
  const memo = new Map<number, string[]>();
  const up = (id: number, seen: Set<number>): string[] => {
    const known = memo.get(id);
    if (known) return known;
    const g = byId.get(id);
    if (!g || seen.has(id)) return []; // unknown, or cyclical data
    seen.add(id);
    const names = [...new Set([g.name, ...g.parent_ids.flatMap((p) => up(p, seen))])];
    memo.set(id, names);
    return names;
  };
  return (ids: Iterable<number>) => [...new Set([...ids].flatMap((id) => up(id, new Set())))];
}
