import { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { LoadingState } from "./Spinner";

type Item = { id: number };

/** Non-draggable list for "Catalog" views: every item in the guild, not just
 * what's in your personal ranking. Same expandable-detail-row shape as
 * SortableList, minus the drag handle and position number. */
export function CatalogList<T extends Item>(props: {
  items: T[];
  render: (item: T) => ReactNode;
  renderDetail?: (item: T) => ReactNode;
  rowClassName?: string;
  className?: string;
  loading?: boolean;
  loadingLabel?: ReactNode;
  /** Rendered when not loading and `items` is empty. */
  empty?: ReactNode;
}) {
  const { items, render, renderDetail, rowClassName, className, loading = false, loadingLabel = "Loading catalog…", empty = null } = props;
  if (loading) return <LoadingState label={loadingLabel} />;
  if (items.length === 0) return <>{empty}</>;
  return (
    <ul className={cn("m-0 list-none p-0", className)}>
      {items.map((it) => (
        <li key={it.id} className="border-b bg-card last:border-b-0">
          <div className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-3 py-2", rowClassName)}>{render(it)}</div>
          {renderDetail?.(it)}
        </li>
      ))}
    </ul>
  );
}
