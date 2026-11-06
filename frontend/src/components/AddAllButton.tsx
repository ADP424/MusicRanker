import { useMutation } from "@tanstack/react-query";
import { ListPlus } from "lucide-react";
import { toast } from "sonner";

import { api } from "../api/client";
import { useGuildApi } from "../api/hooks";
import { useCan } from "../guild/GuildProvider";
import { Spinner } from "./Spinner";

/** "Add all episodes / seasons / albums to my list": appends whatever's
 * missing at the bottom, in airing (or release) order. */
export function AddAllButton({ path, noun }: { path: string; noun: string }) {
  const { base } = useGuildApi();
  const canRank = useCan("rank");
  const add = useMutation({
    mutationFn: () => api.post<{ added: number }>(`${base}/${path}`),
    onSuccess: (r) => toast(r.added ? `Added ${r.added} ${noun} to your list` : `All the ${noun} are already in your list`),
  });
  if (!canRank) return null;
  return (
    <button onClick={() => add.mutate()} disabled={add.isPending} title={`Append every ${noun.replace(/s$/, "")} you haven't added yet`}>
      {add.isPending ? <Spinner size="sm" /> : <ListPlus className="inline size-4" />} Add all {noun}
    </button>
  );
}
