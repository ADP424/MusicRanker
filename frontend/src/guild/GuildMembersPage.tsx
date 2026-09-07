import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { gk } from "../api/keys";
import { useMe } from "../auth/AuthProvider";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BusyButton, InlineBusy, LoadingState } from "../components/Spinner";
import { useCan, useGuild, type GuildRole } from "./GuildProvider";

interface Member { user_id: number; username: string; role: GuildRole }
interface Invite { id: number; username: string; role: GuildRole }

// `owner` is absent: it moves only via transfer-ownership.
const ASSIGNABLE: GuildRole[] = ["ranker", "maintainer", "maintainer_plus", "maintainer_plus_plus", "manager"];
const LABEL: Record<GuildRole, string> = {
  ranker: "Ranker (view + own ranking)",
  maintainer: "Maintainer (create)",
  maintainer_plus: "Maintainer+ (create, edit)",
  maintainer_plus_plus: "Maintainer++ (create, edit, delete)",
  manager: "Manager (+ members)",
  owner: "Owner",
};

export function GuildMembersPage() {
  const guild = useGuild();
  const me = useMe();
  const qc = useQueryClient();
  const isOwner = guild.role === "owner";
  const canManage = useCan("manage_members");

  const [invitee, setInvitee] = useState("");
  const [inviteRole, setInviteRole] = useState<GuildRole>("ranker");
  const [confirmKick, setConfirmKick] = useState<Member | null>(null);

  const base = `/guilds/${guild.id}`;
  const { data: members = [], isLoading: membersLoading } = useQuery({ queryKey: gk(guild.id, "members"), queryFn: () => api.get<Member[]>(`${base}/members`) });
  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: gk(guild.id, "invitations"),
    queryFn: () => api.get<Invite[]>(`${base}/invitations`),
    enabled: canManage,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: gk(guild.id, "members") });
    qc.invalidateQueries({ queryKey: gk(guild.id, "invitations") });
  };

  const invite = useMutation({
    mutationFn: () => api.post(`${base}/invitations`, { identifier: invitee.trim(), role: inviteRole }),
    onSuccess: () => { setInvitee(""); refresh(); },
  });
  const revoke = useMutation({ mutationFn: (id: number) => api.delete(`${base}/invitations/${id}`), onSuccess: refresh });
  const setRole = useMutation({
    mutationFn: ({ uid, role }: { uid: number; role: GuildRole }) => api.patch(`${base}/members/${uid}`, { role }),
    onSuccess: refresh,
  });
  const kick = useMutation({ mutationFn: (uid: number) => api.delete(`${base}/members/${uid}`), onSuccess: refresh });
  const transfer = useMutation({
    mutationFn: (uid: number) => api.post(`${base}/transfer-ownership`, { user_id: uid }),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["auth", "guilds"] }); },
  });

  /** B3: only the owner may touch a manager, and nobody may touch the owner. */
  const editable = (m: Member) =>
    canManage && m.user_id !== me.id && m.role !== "owner" && (m.role !== "manager" || isOwner);

  return (
    <main>
      <Link to="." className="back-link">← {guild.name}</Link>
      <header className="page-head"><h1>Members</h1></header>

      {membersLoading ? (
        <LoadingState label="Loading members…" />
      ) : (
        <ul className="plain-list">
          {members.map((m) => {
            const roleSaving = setRole.isPending && setRole.variables?.uid === m.user_id;
            return (
              <li key={m.user_id} className="row" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
                <span className="name">{m.username}{m.user_id === me.id && <span className="meta"> (you)</span>}</span>
                {editable(m) ? (
                  <span className="inline">
                    <select disabled={roleSaving} value={m.role} onChange={(e) => setRole.mutate({ uid: m.user_id, role: e.target.value as GuildRole })}>
                      {ASSIGNABLE.filter((r) => r !== "manager" || isOwner).map((r) => (
                        <option key={r} value={r}>{LABEL[r]}</option>
                      ))}
                    </select>
                    {roleSaving && <InlineBusy />}
                  </span>
                ) : (
                  <span className="meta">{LABEL[m.role]}</span>
                )}
                {isOwner && m.user_id !== me.id
                  ? <BusyButton busy={transfer.isPending && transfer.variables === m.user_id} busyLabel="Transferring…" disabled={transfer.isPending} onClick={() => transfer.mutate(m.user_id)}>Make owner</BusyButton>
                  : <span />}
                {editable(m) ? <button className="icon" onClick={() => setConfirmKick(m)}>✕</button> : <span />}
              </li>
            );
          })}
        </ul>
      )}
      {setRole.isError && <p className="err">{(setRole.error as Error).message}</p>}
      {transfer.isError && <p className="err">{(transfer.error as Error).message}</p>}

      {canManage && (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Invite</h2>
          <form className="inline" onSubmit={(e) => { e.preventDefault(); if (invitee.trim()) invite.mutate(); }}>
            <input placeholder="Username or email" value={invitee} onChange={(e) => setInvitee(e.target.value)} />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as GuildRole)}>
              {ASSIGNABLE.filter((r) => r !== "manager" || isOwner).map((r) => (
                <option key={r} value={r}>{LABEL[r]}</option>
              ))}
            </select>
            <BusyButton type="submit" busy={invite.isPending} busyLabel="Sending…">Send invite</BusyButton>
          </form>
          {invite.isError && <p className="err">{(invite.error as Error).message}</p>}
          <p className="meta">
            Invitees at Maintainer or above may bring one guild they own with them — see “Merge a guild in”.
          </p>

          {invitesLoading ? (
            <LoadingState compact />
          ) : invites.length > 0 && (
            <ul className="plain-list" style={{ marginTop: "0.75rem" }}>
              {invites.map((i) => (
                <li key={i.id} className="row" style={{ gridTemplateColumns: "1fr auto auto" }}>
                  <span className="name">{i.username}</span>
                  <span className="meta">pending · {LABEL[i.role]}</span>
                  <BusyButton className="icon" busy={revoke.isPending && revoke.variables === i.id} busyLabel={null} onClick={() => revoke.mutate(i.id)}>✕</BusyButton>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {confirmKick && (
        <ConfirmDialog
          message={`Remove ${confirmKick.username}? Their rankings in this guild are deleted.`}
          confirmLabel="Remove"
          busy={kick.isPending}
          onConfirm={() => kick.mutate(confirmKick.user_id, { onSettled: () => setConfirmKick(null) })}
          onCancel={() => setConfirmKick(null)}
        />
      )}
    </main>
  );
}
