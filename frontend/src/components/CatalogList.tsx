import { ReactNode } from "react";
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
  loading?: boolean;
  loadingLabel?: ReactNode;
  /** Rendered when not loading and `items` is empty. */
  empty?: ReactNode;
}) {
  const { items, render, renderDetail, rowClassName, loading = false, loadingLabel = "Loading catalog…", empty = null } = props;
  if (loading) return <LoadingState label={loadingLabel} />;
  if (items.length === 0) return <>{empty}</>;
  return (
    <ul className="sortable plain-list">
      {items.map((it) => (
        <li key={it.id} className="sortable-item">
          <div className={`row${rowClassName ? ` ${rowClassName}` : ""}`}>{render(it)}</div>
          {renderDetail?.(it)}
        </li>
      ))}
    </ul>
  );
}
