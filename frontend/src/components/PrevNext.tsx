import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

/** ‹ previous · next › among siblings in airing order (episodes of a season,
 * seasons of a show). Renders nothing until the siblings are known. */
export function PrevNext<T extends { id: number; name: string }>({ items, current, href, noun }: {
  items: T[] | undefined;
  current: number;
  href: (item: T) => string;
  noun: string;
}) {
  const i = items?.findIndex((x) => x.id === current) ?? -1;
  if (!items || i < 0) return null;
  const prev = items[i - 1];
  const next = items[i + 1];
  return (
    <nav aria-label={`Other ${noun}s`} className="mb-3 flex items-center justify-between gap-3 text-sm">
      {prev ? (
        <Link to={href(prev)} className="flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4 shrink-0" /><span className="truncate">{prev.name}</span>
        </Link>
      ) : <span />}
      <span className="shrink-0 text-xs text-muted-foreground">{noun} {i + 1} of {items.length}</span>
      {next ? (
        <Link to={href(next)} className="flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground">
          <span className="truncate">{next.name}</span><ChevronRight className="size-4 shrink-0" />
        </Link>
      ) : <span />}
    </nav>
  );
}
