import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** The name of whatever a detail page shows, for the breadcrumbs and the
 * browser tab. List pages need nothing: the shell names them from the route. */
const Ctx = createContext<{ title: string | null; set: (t: string | null) => void }>({ title: null, set: () => {} });

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, set] = useState<string | null>(null);
  return <Ctx.Provider value={{ title, set }}>{children}</Ctx.Provider>;
}

export function usePageTitle(title: string | null | undefined) {
  const { set } = useContext(Ctx);
  useEffect(() => {
    set(title ?? null);
    return () => set(null);
  }, [title, set]);
}

export const usePageTitleValue = () => useContext(Ctx).title;
