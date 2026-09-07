/**
 * Every cached query is scoped to a guild, and every *ranking* query is
 * additionally scoped to a user.
 *
 * The QueryClient runs `staleTime: Infinity, gcTime: Infinity`, so an unscoped
 * key like ["movies","ranked"] would cheerfully serve Guild A's movies as
 * Guild B's for the rest of the session. The `gk` prefix makes that impossible,
 * and `qc.clear()` on logout makes account-switching safe.
 */
export const gk = (guildId: number, ...rest: readonly unknown[]) => ["g", guildId, ...rest] as const;
export const rk = (guildId: number, userId: number, ...rest: readonly unknown[]) =>
  ["g", guildId, "u", userId, ...rest] as const;
export const ak = (...rest: readonly unknown[]) => ["auth", ...rest] as const;
