import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReactNode } from "react";

type Item = { id: number; position?: number | null };

function Row<T extends Item>({ item, rowClassName, children }: { item: T; rowClassName?: string; children: ReactNode }) {
  const s = useSortable({ id: item.id });
  return (
    <li
      ref={s.setNodeRef}
      style={{
        transform: CSS.Transform.toString(s.transform),
        transition: s.transition,
        opacity: s.isDragging ? 0.4 : 1,
      }}
      className={`row${rowClassName ? ` ${rowClassName}` : ""}`}
      {...s.attributes}
    >
      <span className="handle" {...s.listeners}>⠿</span>
      <span className="pos">#{item.position}</span>
      {children}
    </li>
  );
}

export function SortableList<T extends Item>(props: {
  items: T[];
  onReorder: (items: T[]) => void;       // optimistic local update
  onMove: (id: number, position: number) => void; // API call
  render: (item: T) => ReactNode;
  rowClassName?: string;
}) {
  const { items, onReorder, onMove, render, rowClassName } = props;

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to   = items.findIndex((i) => i.id === over.id);
    // 1) instant visual feedback
    onReorder(
      arrayMove(items, from, to).map((it, i) => ({ ...it, position: i + 1 })),
    );
    // 2) single‑row API update
    onMove(Number(active.id), to + 1);
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ol className="sortable">
          {items.map((it) => (
            <Row key={it.id} item={it} rowClassName={rowClassName}>{render(it)}</Row>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}