import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { ak } from "../api/keys";
import { LoadingState } from "../components/Spinner";

export type Capability =
  | "view" | "rank" | "catalog_create" | "catalog_edit" | "catalog_delete"
  | "merge_in" | "manage_members" | "manage_managers" | "guild_settings"
  | "guild_delete" | "transfer_ownership";

export type GuildRole =
  | "ranker" | "maintainer" | "maintainer_plus" | "maintainer_plus_plus" | "manager" | "owner";

export interface GuildSummary {
  id: number; name: string; role: GuildRole;
  capabilities: Capability[]; member_count: number;
}

const Ctx = createContext<GuildSummary>(null!);
export const useGuild = () => useContext(Ctx);

/** Drives every `+ Add` / `✎` / `✕` / import button in the app. */
export function useCan(cap: Capability): boolean {
  return useGuild().capabilities.includes(cap);
}

export const useGuilds = () => useQuery({ queryKey: ak("guilds"), queryFn: () => api.get<GuildSummary[]>("/guilds") });

export function GuildProvider({ children }: { children: React.ReactNode }) {
  const { guildId } = useParams<{ guildId: string }>();
  const { data: guilds, isLoading, isError } = useGuilds();
  if (isLoading) return <LoadingState label="Loading guild…" />;
  if (isError) return <p className="err" style={{ padding: "2rem" }}>Couldn't load your guilds. <Navigate to="/guilds" replace /></p>;
  const guild = guilds?.find((g) => g.id === Number(guildId));
  if (!guild) return <Navigate to="/guilds" replace />;
  return <Ctx.Provider value={guild}>{children}</Ctx.Provider>;
}
