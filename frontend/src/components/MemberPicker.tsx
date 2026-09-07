import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { gk } from "../api/keys";
import { useMe } from "../auth/AuthProvider";
import { useGuild } from "../guild/GuildProvider";
import { InlineBusy } from "./Spinner";

interface Member { user_id: number; username: string; role: string }

export function MemberPicker({ value, onChange }: { value: number; onChange: (id: number) => void }) {
  const guild = useGuild();
  const me = useMe();
  const { data: members = [], isLoading } = useQuery({
    queryKey: gk(guild.id, "members"),
    queryFn: () => api.get<Member[]>(`/guilds/${guild.id}/members`),
  });
  if (isLoading) return <InlineBusy label="Members…" />;
  if (members.length <= 1) return null;
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} title="Whose ranking to show">
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.user_id === me.id ? "My ranking" : `${m.username}'s ranking`}
        </option>
      ))}
    </select>
  );
}
