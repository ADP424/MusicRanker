import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Mail, Plus, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMenu } from "@/shell/AppShell";
import { api } from "../api/client";
import { ak } from "../api/keys";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ActivityIndicator, Spinner } from "../components/Spinner";
import { useGuilds, type GuildSummary } from "./GuildProvider";

const MAX_OWNED = 3;

interface Invitation { id: number; guild_id: number; guild_name: string; role: string; inviter: string | null }

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", manager: "Manager",
  maintainer_plus_plus: "Maintainer++", maintainer_plus: "Maintainer+",
  maintainer: "Maintainer", ranker: "Ranker",
};

export function GuildsPage() {
  const navigate = useNavigate();
  const { data: guilds = [], isLoading: guildsLoading } = useGuilds();
  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ak("invitations"),
    queryFn: () => api.get<Invitation[]>("/invitations"),
  });

  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<GuildSummary | null>(null);
  const [confirmLeave, setConfirmLeave] = useState<GuildSummary | null>(null);

  const create = useMutation({
    mutationFn: (name: string) => api.post<GuildSummary>("/guilds", { name }),
    meta: { errorToast: false },
    onSuccess: (g) => { setNewName(""); toast.success(`Created ${g.name}`); },
  });
  const respond = useMutation({
    mutationFn: ({ inv, action }: { inv: Invitation; action: "accept" | "decline" }) =>
      api.post(`/invitations/${inv.id}/${action}`),
    onSuccess: (_r, { inv, action }) => {
      if (action === "accept") navigate(`/g/${inv.guild_id}`);
      else toast(`Declined the invitation to ${inv.guild_name}`);
    },
  });
  const leave = useMutation({
    mutationFn: (id: number) => api.post(`/guilds/${id}/leave`),
    onSuccess: () => setConfirmLeave(null),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/guilds/${id}`),
    onSuccess: () => setConfirmDelete(null),
  });

  const owned = guilds.filter((g) => g.role === "owner").length;
  const atCap = owned >= MAX_OWNED;

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="flex h-14 items-center gap-3 border-b bg-background px-4 md:px-8">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Trophy className="size-4" />
        </span>
        <span className="font-semibold">Ranker</span>
        <div className="ml-auto flex items-center gap-3">
          <ActivityIndicator />
          <UserMenu />
        </div>
      </header>

      <div className="mx-auto grid max-w-3xl gap-8 px-4 py-10">
        <div>
          <h1>Your guilds</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A guild is a shared catalog. Everyone in it keeps their own ranking of it.
          </p>
        </div>

        {(invitesLoading || invites.length > 0) && (
          <section className="grid gap-3">
            <h2 className="flex items-center gap-2"><Mail className="size-4" /> Invitations</h2>
            {invitesLoading ? <Skeleton className="h-20" /> : invites.map((i) => {
              const busy = respond.isPending && respond.variables?.inv.id === i.id;
              return (
                <Card key={i.id} className="flex-row items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.guild_name}</p>
                    <p className="text-sm text-muted-foreground">
                      As {ROLE_LABEL[i.role] ?? i.role}{i.inviter && ` · invited by ${i.inviter}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" disabled={respond.isPending}
                            onClick={() => respond.mutate({ inv: i, action: "decline" })}>Decline</Button>
                    <Button size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ inv: i, action: "accept" })}>
                      {busy && respond.variables?.action === "accept" && <Spinner size="sm" />} Accept
                    </Button>
                  </div>
                </Card>
              );
            })}
          </section>
        )}

        <section className="grid gap-3">
          {guildsLoading ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : guilds.length === 0 ? (
            <Card className="items-center px-6 py-10 text-center">
              <p className="font-medium">You're not in any guilds yet.</p>
              <p className="text-sm text-muted-foreground">Create one below, or ask a friend to invite you.</p>
            </Card>
          ) : guilds.map((g) => (
            <Card key={g.id} className="group flex-row items-center gap-4 px-5 py-4 transition-colors hover:border-primary/40">
              <button
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 text-left"
                onClick={() => navigate(`/g/${g.id}`)}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary">
                  {g.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{g.name}</span>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="secondary">{ROLE_LABEL[g.role] ?? g.role}</Badge>
                    <span className="flex items-center gap-1"><Users className="size-3.5" />{g.member_count}</span>
                  </span>
                </span>
              </button>
              {/* B3: exactly one owner always exists, so the owner sees Delete and
                  everyone else sees Leave. There is no orphan state to reach. */}
              {g.role === "owner" ? (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmDelete(g)}>Delete</Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(g)}>Leave</Button>
              )}
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Card>
          ))}
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create a guild</CardTitle>
            <CardDescription>
              {atCap
                ? `You already own ${MAX_OWNED} guilds, the most one person can. Delete one or transfer its ownership to make room.`
                : `You own ${owned} of at most ${MAX_OWNED} guilds.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex gap-2"
                  onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create.mutate(newName.trim()); }}>
              <Input aria-label="New guild name" placeholder="Guild name" value={newName} maxLength={100}
                     disabled={atCap} onChange={(e) => setNewName(e.target.value)} />
              <Button type="submit" disabled={atCap || !newName.trim() || create.isPending}>
                {create.isPending ? <Spinner size="sm" /> : <Plus className="size-4" />} Create
              </Button>
            </form>
            {create.isError && <p className="mt-2 text-sm text-destructive">{(create.error as Error).message}</p>}
          </CardContent>
        </Card>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.name}?`}
          message="This deletes the guild's entire catalog and every member's rankings in it. It cannot be undone."
          confirmText={confirmDelete.name}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmLeave && (
        <ConfirmDialog
          title={`Leave ${confirmLeave.name}?`}
          message="Your rankings, notes and pairwise answers in this guild are deleted. You'd need a new invitation to rejoin."
          confirmLabel="Leave guild"
          busy={leave.isPending}
          onConfirm={() => leave.mutate(confirmLeave.id)}
          onCancel={() => setConfirmLeave(null)}
        />
      )}
    </div>
  );
}
