import { useQuery } from "@tanstack/react-query";
import { Merge, Pencil, Tags } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "../api/client";
import { DetailHeader, Facts, Section } from "../components/detail/DetailKit";
import { LoadFailed } from "../components/LoadFailed";
import { LoadingState } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";
import { type GenreDomain, type GenreLike, useGenreKey, useRouteBase } from "./config";
import { GenreForm } from "./GenreForm";
import { MergeTaxonDialog, TagTitlesDialog } from "./GenreTools";
import { GenreItems } from "./GenreItems";

export function GenreDetailPage({ domain }: { domain: GenreDomain }) {
  const gid = Number(useParams<{ id: string }>().id);
  const routeBase = useRouteBase(domain);
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const apiBase = domain.useApiBase();
  const key = useGenreKey(domain);

  const { data: genre, isLoading, isError, error, refetch } = useQuery({
    queryKey: key(gid),
    queryFn: () => api.get<GenreLike>(`${apiBase}/${gid}`),
    enabled: !isNaN(gid),
  });
  const { data: parents = [] } = useQuery({
    queryKey: key(gid, "parents"),
    queryFn: () => api.get<GenreLike[]>(`${apiBase}/${gid}/parents`),
    enabled: !isNaN(gid),
  });
  const { data: children = [] } = useQuery({
    queryKey: key(gid, "children"),
    queryFn: () => api.get<GenreLike[]>(`${apiBase}/${gid}/children`),
    enabled: !isNaN(gid),
  });

  const [tool, setTool] = useState<"merge" | "tag" | null>(null);
  usePageTitle(genre?.name);
  if (isLoading) return <LoadingState />;
  if (isError || !genre) return <LoadFailed what="genre" error={error} onRetry={() => void refetch()} />;

  const chips = (list: GenreLike[]) => (
    <span className="flex flex-wrap gap-1.5">
      {list.map((g) => <Badge key={g.id} variant="secondary" asChild><Link to={`${routeBase}/${g.id}`}>{g.name}</Link></Badge>)}
    </span>
  );
  const hasInfo = (genre.synonyms?.length ?? 0) > 0 || genre.notes || parents.length > 0 || children.length > 0;

  return (
    <div className="grid gap-5">
      <Link to={routeBase} className="text-sm text-muted-foreground hover:underline">← All {domain.noun}</Link>
      <DetailHeader
        title={genre.name}
        facts={[parents.length === 0 ? `Top-level ${domain.heading.toLowerCase()}` : null]}
        actions={canEdit && (
          <>
            <Button variant="outline" size="sm" onClick={() => setTool("tag")}><Tags className="size-4" /> Tag titles</Button>
            <Button variant="outline" size="sm" onClick={() => setTool("merge")}><Merge className="size-4" /> Merge a duplicate</Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
          </>
        )}
      />
      {hasInfo && (
        <Section title="About">
          <Facts items={[
            ["Also known as", genre.synonyms?.length ? genre.synonyms.join(", ") : null],
            ["Under", parents.length > 0 && chips(parents)],
            ["Includes", children.length > 0 && chips(children)],
            ["Notes", genre.notes],
          ]} />
        </Section>
      )}
      <GenreItems domain={domain} gid={gid} />

      {editing && <GenreForm domain={domain} initial={genre} onClose={() => setEditing(false)} />}
      {tool === "merge" && <MergeTaxonDialog domain={domain} keep={genre} onClose={() => setTool(null)} />}
      {tool === "tag" && <TagTitlesDialog domain={domain} taxon={genre} onClose={() => setTool(null)} />}
    </div>
  );
}
