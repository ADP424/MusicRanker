import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo } from "react";
import { api, primeCsrf, setUnauthorizedHandler } from "../api/client";
import { ak } from "../api/keys";

export interface Me { id: number; username: string; email: string }

const Ctx = createContext<{ me: Me | null; loading: boolean; logout: () => Promise<void> }>(null!);
export const useAuth = () => useContext(Ctx);
export const useMe = (): Me => {
  const { me } = useAuth();
  if (!me) throw new Error("useMe outside an authenticated route");
  return me;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  const { data: me = null, isLoading } = useQuery({
    queryKey: ak("me"),
    queryFn: async () => {
      await primeCsrf();
      return api.get<Me>("/auth/me").catch(() => null);
    },
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(ak("me"), null);
      qc.clear(); // never let one account see another's Infinity-cached data
    });
  }, [qc]);

  const value = useMemo(
    () => ({
      me,
      loading: isLoading,
      logout: async () => {
        await api.post("/auth/logout").catch(() => {});
        qc.setQueryData(ak("me"), null);
        qc.clear();
      },
    }),
    [me, isLoading, qc],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
