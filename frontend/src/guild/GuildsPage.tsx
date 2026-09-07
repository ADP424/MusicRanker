import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { ak } from "../api/keys";
import { useAuth } from "../auth/AuthProvider";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ActivityIndicator, BusyButton, LoadingState } from "../components/Spinner";
import { useGuilds, type GuildSummary } from "./GuildProvider";

const MAX_OWNED = 3;

interface Invitation { id: number; guild_id: number; guild_name: string; role: string; inviter: string | null }

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", manager: "Manager",
  maintainer_plus_plus: "Maintainer++", maintainer_plus: "Maintainer+",
  maintainer: "Maintainer", ranker: "Ranker",
};

export function GuildsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me, logout } = useAuth();
  const { data: guilds = [], isLoading: guildsLoading } = useGuilds();
  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ak("invitations"),
    queryFn: () => api.get<Invitation[]>("/invitations"),
  });

  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<GuildSummary | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ak("guilds") });
    qc.invalidateQueries({ queryKey: ak("invitations") });
  };

  const create = useMutation({
    mutationFn: (name: string) => api.post<GuildSummary>("/guilds", { name }),
    onSuccess: () => { setNewName(""); refresh(); },
  });
  const respond = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "accept" | "decline" }) =>
      api.post(`/invitations/${id}/${action}`),
    onSuccess: refresh,
  });
  const leave = useMutation({ mutationFn: (id: number) => api.post(`/guilds/${id}/leave`), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/guilds/${id}`), onSuccess: refresh });

  const owned = guilds.filter((g) => g.role === "owner").length;

  return (
    <div className="guilds-page">
      <div className="guilds-topbar">
        <ActivityIndicator />
        <span className="meta">{me?.username}</span>
        <button className="top-bar-link" onClick={() => logout().then(() => navigate("/login"))}>Sign out</button>
      </div>

      <h1 className="home-title">Your guilds</h1>

      <div className="guilds-content">
        {(invitesLoading || invites.length > 0) && (
          <section className="guilds-section">
            <h2>Invitations</h2>
            {invitesLoading ? (
              <LoadingState compact label="Checking invitations…" />
            ) : (
              <ul className="guild-list">
                {invites.map((i) => (
                  <li key={i.id} className="guild-card">
                    <div className="guild-card-main">
                      <span className="guild-card-name">{i.guild_name}</span>
                      <span className="meta">
                        as {ROLE_LABEL[i.role] ?? i.role}{i.inviter && ` · invited by ${i.inviter}`}
                      </span>
                    </div>
                    <div className="guild-card-actions">
                      <BusyButton busy={respond.isPending && respond.variables?.id === i.id && respond.variables.action === "accept"} busyLabel="Joining…" disabled={respond.isPending} onClick={() => respond.mutate({ id: i.id, action: "accept" })}>Accept</BusyButton>
                      <BusyButton busy={respond.isPending && respond.variables?.id === i.id && respond.variables.action === "decline"} busyLabel="Declining…" disabled={respond.isPending} onClick={() => respond.mutate({ id: i.id, action: "decline" })}>Decline</BusyButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="guilds-section">
          <h2>Guilds</h2>
          {guildsLoading ? (
            <LoadingState label="Loading your guilds…" />
          ) : guilds.length === 0 ? (
            <p className="rank-empty">You're not in any guilds yet. Create one below.</p>
          ) : (
            <ul className="guild-list">
              {guilds.map((g) => (
                <li key={g.id} className="guild-card">
                  <button className="guild-card-main guild-card-link" onClick={() => navigate(`/g/${g.id}`)}>
                    <span className="guild-card-name">{g.name}</span>
                    <span className="meta">{ROLE_LABEL[g.role] ?? g.role} · {g.member_count} member{g.member_count !== 1 ? "s" : ""}</span>
                  </button>
                  <div className="guild-card-actions">
                    {/* B3: exactly one owner always exists, so the owner sees Delete and
                        everyone else sees Leave. There is no orphan state to reach. */}
                    {g.role === "owner"
                      ? <button className="danger" onClick={() => setConfirmDelete(g)}>Delete</button>
                      : <BusyButton busy={leave.isPending && leave.variables === g.id} busyLabel="Leaving…" onClick={() => leave.mutate(g.id)}>Leave</BusyButton>}
                    <button onClick={() => navigate(`/g/${g.id}`)}>Open →</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="guilds-section">
          <h2>Create a guild</h2>
          <form className="inline"
                onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create.mutate(newName.trim()); }}>
            <input placeholder="New guild name…" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <BusyButton type="submit" busy={create.isPending} busyLabel="Creating…" disabled={owned >= MAX_OWNED || !newName.trim()}>+ Create guild</BusyButton>
            <span className="meta">{owned} / {MAX_OWNED} owned</span>
          </form>
          {create.isError && <p className="err">{(create.error as Error).message}</p>}
        </section>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}" and its entire catalog? Every member's rankings in it are destroyed. This cannot be undone.`}
          confirmText={confirmDelete.name}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.id, { onSettled: () => setConfirmDelete(null) })}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
