import { useMutation, useQuery } from "@tanstack/react-query";
import { Crown, Mail, MoreHorizontal, UserMinus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../api/client";
import { gk } from "../api/keys";
import { useMe } from "../auth/AuthProvider";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Spinner } from "../components/Spinner";
import { useCan, useGuild, type GuildRole } from "./GuildProvider";
import { ROLE_LABEL } from "./GuildsPage";

interface Member { user_id: number; username: string; role: GuildRole }
interface Invite { id: number; username: string; role: GuildRole }

// `owner` is absent: it moves only via transfer-ownership.
const ASSIGNABLE: GuildRole[] = ["ranker", "maintainer", "maintainer_plus", "maintainer_plus_plus", "manager"];
const CAN_DO: Record<GuildRole, string> = {
  ranker: "views the catalog and keeps their own ranking",
  maintainer: "can also add to the catalog",
  maintainer_plus: "can also edit the catalog",
  maintainer_plus_plus: "can also delete from the catalog",
  manager: "can also manage members",
  owner: "owns the guild",
};

type Pending =
  | { kind: "kick"; member: Member }
  | { kind: "transfer"; member: Member };

export function GuildMembersPage() {
  const guild = useGuild();
  const me = useMe();
  const isOwner = guild.role === "owner";
  const canManage = useCan("manage_members");

  const [invitee, setInvitee] = useState("");
  const [inviteRole, setInviteRole] = useState<GuildRole>("ranker");
  const [pending, setPending] = useState<Pending | null>(null);

  const base = `/guilds/${guild.id}`;
  const members = useQuery({ queryKey: gk(guild.id, "members"), queryFn: () => api.get<Member[]>(`${base}/members`) });
  const invites = useQuery({
    queryKey: gk(guild.id, "invitations"),
    queryFn: () => api.get<Invite[]>(`${base}/invitations`),
    enabled: canManage,
  });

  const invite = useMutation({
    mutationFn: () => api.post(`${base}/invitations`, { identifier: invitee.trim(), role: inviteRole }),
    meta: { errorToast: false },
    onSuccess: () => {
      toast.success(invitee.includes("@") ? `If ${invitee.trim()} has an account here, they've been invited` : `Invited ${invitee.trim()}`);
      setInvitee("");
    },
  });
  const revoke = useMutation({ mutationFn: (id: number) => api.delete(`${base}/invitations/${id}`) });
  const setRole = useMutation({
    mutationFn: ({ uid, role }: { uid: number; role: GuildRole }) => api.patch(`${base}/members/${uid}`, { role }),
    onSuccess: (_r, { role }) => toast.success(`Role changed to ${ROLE_LABEL[role]}`),
  });
  const kick = useMutation({ mutationFn: (uid: number) => api.delete(`${base}/members/${uid}`) });
  const transfer = useMutation({
    mutationFn: (uid: number) => api.post(`${base}/transfer-ownership`, { user_id: uid }),
    onSuccess: () => toast.success("Ownership transferred. You're a manager now."),
  });

  /** B3: only the owner may touch a manager, and nobody may touch the owner. */
  const editable = (m: Member) =>
    canManage && m.user_id !== me.id && m.role !== "owner" && (m.role !== "manager" || isOwner);
  const roleChoices = ASSIGNABLE.filter((r) => r !== "manager" || isOwner);

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <h1>Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone here shares {guild.name}'s catalog and keeps their own ranking of it.
        </p>
      </div>

      <Card className="py-2">
        <CardContent className="grid gap-1 px-2">
          {members.isLoading ? (
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)
          ) : (members.data ?? []).map((m) => {
            const roleSaving = setRole.isPending && setRole.variables?.uid === m.user_id;
            return (
              <div key={m.user_id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/40">
                <Avatar className="size-8"><AvatarFallback>{m.username.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.username}{m.user_id === me.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{CAN_DO[m.role]}</p>
                </div>
                {editable(m) ? (
                  <span className="flex items-center gap-2">
                    {roleSaving && <Spinner size="sm" />}
                    <select aria-label={`${m.username}'s role`} disabled={roleSaving}
                            className="h-8 rounded-md border bg-background px-2 text-sm" value={m.role}
                            onChange={(e) => setRole.mutate({ uid: m.user_id, role: e.target.value as GuildRole })}>
                      {roleChoices.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </span>
                ) : (
                  <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                    {m.role === "owner" && <Crown />}{ROLE_LABEL[m.role]}
                  </Badge>
                )}
                {(editable(m) || (isOwner && m.user_id !== me.id)) ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.username}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isOwner && m.user_id !== me.id && (
                        <DropdownMenuItem onSelect={() => setPending({ kind: "transfer", member: m })}>
                          <Crown /> Make owner…
                        </DropdownMenuItem>
                      )}
                      {editable(m) && (
                        <DropdownMenuItem variant="destructive" onSelect={() => setPending({ kind: "kick", member: m })}>
                          <UserMinus /> Remove from guild…
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : <span className="w-8" />}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Mail className="size-4" /> Invite someone</CardTitle>
            <CardDescription>
              They need an account already. Invitees at Maintainer or above may bring one guild they own with
              them; see “Merge a guild in”. Unanswered invitations expire after 30 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (invitee.trim()) invite.mutate(); }}>
              <Input aria-label="Username or email" className="min-w-48 flex-1" placeholder="Username or email"
                     value={invitee} onChange={(e) => setInvitee(e.target.value)} />
              <select aria-label="Role" className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={inviteRole} onChange={(e) => setInviteRole(e.target.value as GuildRole)}>
                {roleChoices.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <Button type="submit" disabled={!invitee.trim() || invite.isPending}>
                {invite.isPending && <Spinner size="sm" />} Send invite
              </Button>
            </form>
            {invite.isError && <p className="text-sm text-destructive">{(invite.error as Error).message}</p>}

            {(invites.data ?? []).length > 0 && (
              <div className="grid gap-1">
                <p className="text-sm font-medium">Pending</p>
                {(invites.data ?? []).map((i) => (
                  <div key={i.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                    <span className="flex-1 font-medium">{i.username}</span>
                    <Badge variant="outline">{ROLE_LABEL[i.role]}</Badge>
                    <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${i.username}'s invitation`}
                            disabled={revoke.isPending && revoke.variables === i.id} onClick={() => revoke.mutate(i.id)}>
                      {revoke.isPending && revoke.variables === i.id ? <Spinner size="sm" /> : <X />}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {pending?.kind === "kick" && (
        <ConfirmDialog
          title={`Remove ${pending.member.username}?`}
          message="Their rankings, notes and pairwise answers in this guild are deleted. They'd need a new invitation to rejoin."
          confirmLabel="Remove"
          busy={kick.isPending}
          onConfirm={() => kick.mutate(pending.member.user_id, { onSettled: () => setPending(null) })}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === "transfer" && (
        <ConfirmDialog
          title={`Make ${pending.member.username} the owner?`}
          message={`A guild has exactly one owner. ${pending.member.username} becomes it, and you become a manager: you can't delete the guild or take ownership back yourself.`}
          confirmText={pending.member.username}
          confirmLabel="Transfer ownership"
          busy={transfer.isPending}
          onConfirm={() => transfer.mutate(pending.member.user_id, { onSettled: () => setPending(null) })}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
