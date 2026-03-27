import { useMemo, useRef, useState } from "react";
import type { Genre } from "../api/types";

// ─── Layout ────────────────────────────────────────────────────────────────

const NODE_W = 180;
const NODE_H = 32;
const COL_GAP = 80;
const ROW_GAP = 8;

interface NodeLayout {
  id: number;
  x: number;
  y: number;
  depth: number;
  genre: Genre;
}

function computeLayout(genres: Genre[]): {
  nodes: NodeLayout[];
  edges: { from: number; to: number }[];
  width: number;
  height: number;
} {
  const byId = new Map(genres.map((g) => [g.id, g]));

  // BFS from roots — assign each node its maximum depth so edges go left→right
  const depth = new Map<number, number>();
  const roots = genres.filter((g) => g.parent_ids.length === 0);
  const queue: Array<[number, number]> = roots.map((g) => [g.id, 0]);
  while (queue.length) {
    const [id, d] = queue.shift()!;
    if ((depth.get(id) ?? -1) >= d) continue;
    depth.set(id, d);
    const g = byId.get(id);
    if (!g) continue;
    for (const child of genres) {
      if (child.parent_ids.includes(id)) queue.push([child.id, d + 1]);
    }
  }
  for (const g of genres) {
    if (!depth.has(g.id)) depth.set(g.id, 0);
  }

  // Group by depth, sort alphabetically within each column
  const byDepth = new Map<number, Genre[]>();
  for (const g of genres) {
    const d = depth.get(g.id)!;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(g);
  }
  for (const [, list] of byDepth) list.sort((a, b) => a.name.localeCompare(b.name));

  const maxDepth = Math.max(0, ...depth.values());
  const colX = (d: number) => d * (NODE_W + COL_GAP);

  const nodes: NodeLayout[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    const list = byDepth.get(d) ?? [];
    list.forEach((g, i) => {
      nodes.push({ id: g.id, x: colX(d), y: i * (NODE_H + ROW_GAP), depth: d, genre: g });
    });
  }

  const edges: { from: number; to: number }[] = [];
  for (const g of genres) {
    for (const pid of g.parent_ids) edges.push({ from: pid, to: g.id });
  }

  const maxY = nodes.length ? Math.max(...nodes.map((n) => n.y)) + NODE_H : NODE_H;
  const width = colX(maxDepth) + NODE_W;
  return { nodes, edges, width, height: maxY };
}

// ─── SVG Edge ──────────────────────────────────────────────────────────────

function Edge({
  from, to, nodeMap, highlighted, dimmed,
}: {
  from: number;
  to: number;
  nodeMap: Map<number, NodeLayout>;
  highlighted: boolean;
  dimmed: boolean;
}) {
  const src = nodeMap.get(from);
  const dst = nodeMap.get(to);
  if (!src || !dst) return null;

  const x1 = src.x + NODE_W;
  const y1 = src.y + NODE_H / 2;
  const x2 = dst.x;
  const y2 = dst.y + NODE_H / 2;
  const cx = (x1 + x2) / 2;

  return (
    <path
      d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
      stroke="currentColor"
      strokeOpacity={dimmed ? 0.06 : highlighted ? 0.8 : 0.22}
      strokeWidth={highlighted ? 2 : 1.5}
      fill="none"
    />
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function GenreTree({
  genres,
  onEdit,
}: {
  genres: Genre[];
  onEdit: (g: Genre) => void;
}) {
  const { nodes, edges, width, height } = useMemo(() => computeLayout(genres), [genres]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Pan
  const [offset, setOffset] = useState({ x: 20, y: 20 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(false);
  const moved = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Selection (highlight connected edges/nodes)
  const [selected, setSelected] = useState<number | null>(null);

  // Compute connected node ids for highlighting
  const connectedIds = useMemo(() => {
    if (selected === null) return null;
    const ids = new Set<number>([selected]);
    for (const e of edges) {
      if (e.from === selected || e.to === selected) {
        ids.add(e.from);
        ids.add(e.to);
      }
    }
    return ids;
  }, [selected, edges]);

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = true;
    moved.current = false;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved.current = true;
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  }
  function onMouseUp() { dragging.current = false; }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(3, z - e.deltaY * 0.001)));
  }

  function onNodeClick(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (moved.current) return;
    setSelected((s) => (s === id ? null : id));
  }

  function onCanvasClick() {
    if (moved.current) return;
    setSelected(null);
  }

  return (
    <div
      className="genre-tree-canvas"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onClick={onCanvasClick}
    >
      <div
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          position: "relative",
          width,
          height,
        }}
      >
        {/* SVG layer for edges */}
        <svg
          style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
          width={width}
          height={height}
        >
          {edges.map((e) => {
            const hl = connectedIds !== null &&
              connectedIds.has(e.from) && connectedIds.has(e.to);
            const dm = connectedIds !== null && !hl;
            return (
              <Edge
                key={`${e.from}-${e.to}`}
                from={e.from} to={e.to}
                nodeMap={nodeMap}
                highlighted={hl}
                dimmed={dm}
              />
            );
          })}
        </svg>

        {/* Node layer */}
        {nodes.map((n) => {
          const isSelected = selected === n.id;
          const isConnected = connectedIds !== null && connectedIds.has(n.id);
          const isDimmed = connectedIds !== null && !isConnected;
          return (
            <div
              key={n.id}
              className={
                "genre-node" +
                (isSelected ? " genre-node-selected" : "") +
                (isDimmed ? " genre-node-dimmed" : "")
              }
              style={{ position: "absolute", left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
              onClick={(e) => onNodeClick(n.id, e)}
              title={n.genre.synonyms?.join(", ") || undefined}
            >
              <span className="genre-node-name">{n.genre.name}</span>
              <button
                className="genre-node-edit icon"
                onClick={(e) => { e.stopPropagation(); onEdit(n.genre); }}
                title="Edit"
              >✎</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
