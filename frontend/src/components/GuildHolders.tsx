import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";

import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { gk } from "../api/keys";

type Vertical = "artists" | "books" | "movies" | "games" | "television";

/** "In 3 members' lists: alice #2 of 140 · bob #9 of 12 …" */
export function GuildHolders({ vertical, id }: { vertical: Vertical; id: number }) {
  const { guildId, userId, base } = useGuildApi();
  const { data = [] } = useQuery({
    queryKey: gk(guildId, "social", "holders", vertical, id),
    queryFn: () => api.get<Array<{ user_id: number; username: string; position: number; of: number }>>(
      `${base}/social/holders?vertical=${vertical}&id=${id}`),
  });
  if (data.length === 0) return null;
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <Users className="size-4" />
      <span>In {data.length} member{data.length === 1 ? "'s" : "s'"} list{data.length === 1 ? "" : "s"}:</span>
      {data.map((h) => (
        <span key={h.user_id} className={h.user_id === userId ? "font-medium text-foreground" : undefined}>
          {h.user_id === userId ? "you" : h.username} #{h.position}<span className="text-xs"> of {h.of}</span>
        </span>
      ))}
    </p>
  );
}
