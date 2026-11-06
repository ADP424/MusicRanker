import { useQueryClient } from "@tanstack/react-query";
import { GitMerge, Pencil, Split } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { gk } from "../api/keys";
import { useGuildApi, usePersonDetail } from "../api/hooks";
import { LoadFailed } from "../components/LoadFailed";
import { MergePersonDialog } from "../components/MergePersonDialog";
import { type Credit, type CreditKind, personCredits } from "../components/personCredits";
import { PersonForm } from "../components/PersonForm";
import { PersonTmdbCredits } from "../components/PersonTmdbCredits";
import { LoadingState } from "../components/Spinner";
import { SplitPersonDialog } from "../components/SplitPersonDialog";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";

const GROUPS: { label: string; kinds: CreditKind[] }[] = [
  { label: "Music", kinds: ["artist"] },
  { label: "Books", kinds: ["book"] },
  { label: "Movies", kinds: ["movie"] },
  { label: "Television", kinds: ["show"] },
  { label: "Seasons & episodes", kinds: ["season", "episode"] },
  { label: "Games", kinds: ["game"] },
];

/** One row per title, with every role the person holds on it. */
function byTitle(credits: Credit[]): Array<{ first: Credit; roles: string[] }> {
  const rows = new Map<string, { first: Credit; roles: string[] }>();
  for (const c of credits) {
    const k = `${c.kind}:${c.id}`;
    const row = rows.get(k);
    if (row) row.roles.push(c.roleLabel);
    else rows.set(k, { first: c, roles: [c.roleLabel] });
  }
  return [...rows.values()].sort((a, b) => a.first.title.localeCompare(b.first.title));
}

export function PersonDetailPage() {
  const pid = Number(useParams<{ id: string }>().id);
  const qc = useQueryClient();
  const { guildId } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [dialog, setDialog] = useState<"edit" | "merge" | "split" | null>(null);

  const { data, isLoading, isError, error: loadError, refetch: reload } = usePersonDetail(pid);

  usePageTitle(data?.name);
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <LoadFailed what="person" error={loadError} onRetry={() => void reload()} />;

  const credits = personCredits(data);
  const close = () => setDialog(null);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            {data.name}
            {data.name_en && <span className="font-normal text-muted-foreground"> ({data.name_en})</span>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.core_nationality}
            {data.birth_nationality !== data.core_nationality && ` (born ${data.birth_nationality})`}
            {" · "}{credits.length} credit{credits.length === 1 ? "" : "s"}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog("merge")}
                    title="Fold another entry for the same person into this one">
              <GitMerge className="size-4" /> Merge a duplicate
            </Button>
            {credits.length > 1 && (
              <Button variant="outline" size="sm" onClick={() => setDialog("split")}
                      title="Move some credits to a new person: for two people sharing a name">
                <Split className="size-4" /> Split
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setDialog("edit")}>
              <Pencil className="size-4" /> Edit
            </Button>
          </div>
        )}
      </div>

      {data.notes && <p className="max-w-3xl text-sm whitespace-pre-line">{data.notes}</p>}

      {credits.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not credited on anything in the catalog yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {GROUPS.map((g) => {
            const rows = byTitle(credits.filter((c) => g.kinds.includes(c.kind)));
            if (!rows.length) return null;
            return (
              <Card key={g.label} className="gap-0 py-0">
                <h2 className="border-b px-4 py-2.5 text-base">
                  {g.label} <span className="text-sm font-normal text-muted-foreground">{rows.length}</span>
                </h2>
                <ul className="max-h-96 divide-y overflow-y-auto">
                  {rows.map(({ first, roles }) => (
                    <li key={first.key} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <Link to={`/g/${guildId}/${first.to}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                        {first.title}
                      </Link>
                      {g.kinds.length > 1 && <span className="shrink-0 text-xs text-muted-foreground">{first.kindLabel}</span>}
                      <span className="flex shrink-0 flex-wrap justify-end gap-1">
                        {roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <PersonTmdbCredits personId={pid} personName={data.name} />

      {dialog === "merge" && <MergePersonDialog keep={data} onClose={close} />}
      {dialog === "split" && <SplitPersonDialog person={data} onClose={close} />}
      {dialog === "edit" && (
        <>
          <PersonForm
            initial={data}
            onClose={() => {
              close();
              void qc.invalidateQueries({ queryKey: gk(guildId, "people", pid) });
            }}
          />
        </>
      )}
    </div>
  );
}
