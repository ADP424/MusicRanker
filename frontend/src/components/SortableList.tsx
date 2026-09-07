import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReactNode } from "react";
import { LoadingState, Spinner } from "./Spinner";

type Item = { id: number; position?: number | null };

function Row<T extends Item>({
  item, rowClassName, detail, disableDrag, pending, children,
}: {
  item: T;
  rowClassName?: string;
  detail?: ReactNode;
  disableDrag?: boolean;
  pending?: boolean;
  children: ReactNode;
}) {
  const s = useSortable({ id: item.id, disabled: disableDrag || pending });
  return (
    <li
      ref={s.setNodeRef}
      style={{
        transform: CSS.Transform.toString(s.transform),
        transition: s.transition,
        opacity: s.isDragging ? 0.4 : 1,
      }}
      className="sortable-item"
      aria-busy={pending || undefined}
      {...s.attributes}
    >
      <div className={`row${rowClassName ? ` ${rowClassName}` : ""}`}>
        <span className="handle" {...(disableDrag ? {} : s.listeners)}
              style={disableDrag ? { opacity: 0.2, cursor: "default" } : undefined}>⠿</span>
        <span className="pos" title={pending ? "Saving new position…" : undefined}>
          {pending ? <Spinner size="sm" label="Saving position" /> : <>#{item.position}</>}
        </span>
        {children}
      </div>
      {detail}
    </li>
  );
}

export function SortableList<T extends Item>(props: {
  items: T[];
  onReorder: (items: T[]) => void;
  onMove: (id: number, position: number) => void;
  render: (item: T) => ReactNode;
  rowClassName?: string;
  renderDetail?: (item: T) => ReactNode;
  disableDrag?: boolean;
  /** Cold-fetch in progress: render a loading block instead of the list (and never the empty state). */
  loading?: boolean;
  loadingLabel?: ReactNode;
  /** Rendered when not loading and `items` is empty. */
  empty?: ReactNode;
  /** The row whose position is currently being saved shows a spinner in place of its number. */
  pendingId?: number | null;
}) {
  const {
    items, onReorder, onMove, render, rowClassName, renderDetail, disableDrag,
    loading = false, loadingLabel = "Loading…", empty = null, pendingId = null,
  } = props;

  if (loading) return <LoadingState label={loadingLabel} />;
  if (items.length === 0) return <>{empty}</>;

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to   = items.findIndex((i) => i.id === over.id);
    onReorder(
      arrayMove(items, from, to).map((it, i) => ({ ...it, position: i + 1 })),
    );
    onMove(Number(active.id), to + 1);
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ol className="sortable">
          {items.map((it) => (
            <Row
              key={it.id}
              item={it}
              rowClassName={rowClassName}
              detail={renderDetail?.(it)}
              disableDrag={disableDrag}
              pending={pendingId !== null && it.id === pendingId}
            >
              {render(it)}
            </Row>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
