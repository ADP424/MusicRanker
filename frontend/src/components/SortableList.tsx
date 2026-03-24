import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReactNode } from "react";

type Item = { id: number; position?: number | null };

function Row<T extends Item>({
  item, rowClassName, detail, children,
}: {
  item: T;
  rowClassName?: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  const s = useSortable({ id: item.id });
  return (
    <li
      ref={s.setNodeRef}
      style={{
        transform: CSS.Transform.toString(s.transform),
        transition: s.transition,
        opacity: s.isDragging ? 0.4 : 1,
      }}
      className="sortable-item"
      {...s.attributes}
    >
      <div className={`row${rowClassName ? ` ${rowClassName}` : ""}`}>
        <span className="handle" {...s.listeners}>⠿</span>
        <span className="pos">#{item.position}</span>
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
}) {
  const { items, onReorder, onMove, render, rowClassName, renderDetail } = props;

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
            >
              {render(it)}
            </Row>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
