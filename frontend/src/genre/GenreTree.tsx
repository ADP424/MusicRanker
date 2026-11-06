import { Pencil } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { GenreLike } from "./config";
import { edgeKey, type CycleReport } from "./cycles";
import { cn } from "@/lib/utils";

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
  genre: GenreLike;
}

interface EdgeLayout {
  from: number;
  to: number;
  /** Closes a cycle: still drawn (dashed), but excluded from the depth walk. */
  cyclic: boolean;
}

function computeLayout(
  genres: GenreLike[],
  backEdges: Set<string>,
): { nodes: NodeLayout[]; edges: EdgeLayout[]; width: number; height: number } {
  const byId = new Map(genres.map((g) => [g.id, g]));

  // parent -> children, built once. (This used to be a full rescan of `genres`
  // for every node popped off the queue, i.e. O(n²).)
  const childrenOf = new Map<number, number[]>();
  const parentCount = new Map<number, number>();
  for (const g of genres) {
    let parents = 0;
    for (const pid of g.parent_ids) {
      // Skip parents filtered out of this view, and skip cycle-closing links.
      if (!byId.has(pid) || backEdges.has(edgeKey(pid, g.id))) continue;
      parents++;
      const list = childrenOf.get(pid);
      if (list) list.push(g.id);
      else childrenOf.set(pid, [g.id]);
    }
    parentCount.set(g.id, parents);
  }

  // Longest-path depth, so edges always run left→right.
  //
  // This is a relaxation: a node is re-queued whenever a longer path to it is
  // found. On a cycle every lap yields a strictly larger `d`, so the `>= d`
  // early-out never fires and the loop never terminates — that is exactly how a
  // cyclical genre used to hang the tab. Two defences now: back edges are
  // removed above (so the graph here is acyclic by construction), and `ceiling`
  // caps `d` at the longest possible simple path in case a future change ever
  // lets the cycle report disagree with the data.
  const ceiling = genres.length;
  const depth = new Map<number, number>();
  const queue: Array<[number, number]> = [];
  for (const g of genres) if ((parentCount.get(g.id) ?? 0) === 0) queue.push([g.id, 0]);

  // Index cursor rather than shift() — shift() on a growing array is O(n²).
  for (let head = 0; head < queue.length; head++) {
    const [id, d] = queue[head];
    if ((depth.get(id) ?? -1) >= d) continue;
    depth.set(id, d);
    if (d >= ceiling) continue;
    for (const child of childrenOf.get(id) ?? []) queue.push([child, d + 1]);
  }
  for (const g of genres) if (!depth.has(g.id)) depth.set(g.id, 0);

  // Group by depth, sort alphabetically within each column
  const byDepth = new Map<number, GenreLike[]>();
  for (const g of genres) {
    const d = depth.get(g.id)!;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(g);
  }
  for (const [, list] of byDepth) list.sort((a, b) => a.name.localeCompare(b.name));

  let maxDepth = 0;
  for (const d of depth.values()) if (d > maxDepth) maxDepth = d;
  const colX = (d: number) => d * (NODE_W + COL_GAP);

  const nodes: NodeLayout[] = [];
  let maxY = 0;
  for (let d = 0; d <= maxDepth; d++) {
    const list = byDepth.get(d) ?? [];
    list.forEach((g, i) => {
      const y = i * (NODE_H + ROW_GAP);
      if (y > maxY) maxY = y;
      nodes.push({ id: g.id, x: colX(d), y, depth: d, genre: g });
    });
  }

  // Every link is drawn, including the ones that close a loop — hiding them
  // would make the bad data invisible.
  const edges: EdgeLayout[] = [];
  for (const g of genres) {
    for (const pid of g.parent_ids) {
      if (!byId.has(pid)) continue;
      edges.push({ from: pid, to: g.id, cyclic: backEdges.has(edgeKey(pid, g.id)) });
    }
  }

  return {
    nodes,
    edges,
    width: colX(maxDepth) + NODE_W,
    height: nodes.length ? maxY + NODE_H : NODE_H,
  };
}

// ─── SVG Edge ──────────────────────────────────────────────────────────────

function Edge({
  from, to, nodeMap, highlighted, dimmed, cyclic,
}: {
  from: number;
  to: number;
  nodeMap: Map<number, NodeLayout>;
  highlighted: boolean;
  dimmed: boolean;
  cyclic: boolean;
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
      stroke={cyclic ? "#c08000" : "currentColor"}
      strokeDasharray={cyclic ? "5 4" : undefined}
      strokeOpacity={dimmed ? 0.06 : highlighted ? 0.8 : cyclic ? 0.75 : 0.22}
      strokeWidth={highlighted ? 2 : 1.5}
      fill="none"
    />
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function GenreTree({
  genres,
  cycles,
  onEdit,
}: {
  genres: GenreLike[];
  /** Computed once by the caller (shared with the List-view warning banner) —
   *  don't recompute it here. */
  cycles: CycleReport;
  /** Omit for read-only viewers: no edit affordance is drawn. */
  onEdit?: (g: GenreLike) => void;
}) {
  const { nodes, edges, width, height } = useMemo(
    () => computeLayout(genres, cycles.backEdges),
    [genres, cycles],
  );
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
      className="relative w-full cursor-grab select-none overflow-hidden rounded-md border active:cursor-grabbing h-[80vh]"
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
                cyclic={e.cyclic}
              />
            );
          })}
        </svg>

        {/* Node layer */}
        {nodes.map((n) => {
          const isSelected = selected === n.id;
          const isConnected = connectedIds !== null && connectedIds.has(n.id);
          const isDimmed = connectedIds !== null && !isConnected;
          const isCyclic = cycles.nodeIds.has(n.id);
          const tip = [
            isCyclic ? "⚠ part of a circular parent chain" : "",
            n.genre.synonyms?.join(", ") ?? "",
          ].filter(Boolean).join(" — ");
          return (
            <div
              key={n.id}
              className={cn(
                "flex cursor-pointer items-center gap-1 rounded-md border bg-card px-2 text-xs select-none hover:border-foreground hover:bg-muted",
                isSelected && "border-foreground bg-accent font-semibold",
                isDimmed && "opacity-30",
                isCyclic && "border-dashed border-warning",
              )}
              style={{ position: "absolute", left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
              onClick={(e) => onNodeClick(n.id, e)}
              title={tip || undefined}
            >
              <span className="min-w-0 flex-1 truncate">{n.genre.name}</span>
              {onEdit && (
                <button
                  type="button"
                  data-slot="node-edit"
                  className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); onEdit(n.genre); }}
                  title="Edit"
                  aria-label={`Edit ${n.genre.name}`}
                ><Pencil className="size-3" /></button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
