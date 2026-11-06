import {
  DndContext, DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { LoadingState, Spinner } from "./Spinner";

type Item = { id: number; position?: number | null };

/** Handle, position, then whatever the caller renders; `rowClassName` can set its own columns. */
const ROW = "grid grid-cols-[1.5rem_2.75rem_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2";

function Row<T extends Item>({
  item, rowClassName, detail, disableDrag, pending, label, children,
}: {
  item: T;
  rowClassName?: string;
  detail?: ReactNode;
  disableDrag?: boolean;
  pending?: boolean;
  label?: string;
  children: ReactNode;
}) {
  const s = useSortable({ id: item.id, disabled: disableDrag || pending });
  return (
    <li
      ref={s.setNodeRef}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={cn("border-b bg-card last:border-b-0", s.isDragging && "relative z-10 opacity-60 shadow-lg")}
      aria-busy={pending || undefined}
    >
      <div className={cn(ROW, rowClassName)}>
        {/* The handle alone starts a drag, so text and buttons in the row stay
            clickable; it's a button so Space/arrows reorder from the keyboard. */}
        <button
          type="button"
          data-slot="drag-handle"
          ref={s.setActivatorNodeRef}
          className={cn(
            "flex size-6 items-center justify-center rounded text-muted-foreground",
            disableDrag ? "cursor-default opacity-30" : "cursor-grab hover:bg-accent active:cursor-grabbing",
          )}
          aria-label={disableDrag ? undefined : `Move ${label ?? `#${item.position}`} (Space to pick up, arrows to move)`}
          aria-hidden={disableDrag || undefined}
          tabIndex={disableDrag ? -1 : 0}
          {...(disableDrag ? {} : { ...s.attributes, ...s.listeners })}
        >
          <GripVertical className="size-4" />
        </button>
        <span className="text-sm text-muted-foreground tabular-nums" title={pending ? "Saving new position…" : undefined}>
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
  /** Names the row for screen readers' drag instructions. */
  itemLabel?: (item: T) => string;
  className?: string;
}) {
  const {
    items, onReorder, onMove, render, rowClassName, renderDetail, disableDrag,
    loading = false, loadingLabel = "Loading…", empty = null, pendingId = null, itemLabel, className,
  } = props;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ol className={cn("m-0 list-none p-0", className)}>
          {items.map((it) => (
            <Row
              key={it.id}
              item={it}
              rowClassName={rowClassName}
              detail={renderDetail?.(it)}
              disableDrag={disableDrag}
              pending={pendingId !== null && it.id === pendingId}
              label={itemLabel?.(it)}
            >
              {render(it)}
            </Row>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
