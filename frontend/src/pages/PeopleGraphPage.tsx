import * as d3 from "d3-force";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePersonGraph, useGuildApi } from "../api/hooks";
import type { GraphHub, GraphHubKind, GraphPerson } from "../api/types";
import {
  BAND_ROLE_LABELS, BAND_ROLES, BOOK_ROLE_LABELS, BOOK_ROLES, CAST_ROLE_LABELS, GAME_ROLE_LABELS, GAME_ROLES, MOVIE_ROLES,
} from "../api/types";
import { LoadingState } from "../components/Spinner";

// ─── Constants ─────────────────────────────────────────────────────────────

const PERSON_R = 18;
const HUB_R = 12; // artist/album/book/movie/game/show/episode hub nodes
const PERSON_COLOR = "#6b8cba";
const EDGE_COLOR_DEFAULT = "rgba(150,150,150,0.18)";
const EDGE_COLOR_HL = "rgba(150,150,150,0.75)";
const EDGE_COLOR_DIM = "rgba(150,150,150,0.05)";

// A filter group is one vertical; TV covers both shows and episodes.
type Group = "music" | "books" | "movies" | "games" | "television";

interface HubConfig {
  label: string;
  color: string;
  group: Group;
  path: (hub: GraphHub) => string; // relative to /g/:guildId
}

const HUBS: Record<GraphHubKind, HubConfig> = {
  artist: { label: "Artist", color: "#6ba06b", group: "music", path: (h) => `music/artists/${h.id}` },
  album: { label: "Album", color: "#a3c46b", group: "music", path: (h) => `music/albums/${h.id}` },
  book: { label: "Book", color: "#b5626b", group: "books", path: (h) => `books/${h.id}` },
  movie: { label: "Movie", color: "#c47c3e", group: "movies", path: (h) => `movies/${h.id}` },
  game: { label: "Game", color: "#9b6bc4", group: "games", path: (h) => `games/${h.id}` },
  show: { label: "TV show", color: "#3fa3a3", group: "television", path: (h) => `television/shows/${h.id}` },
  episode: { label: "TV episode", color: "#b89a3a", group: "television", path: (h) => `television/episodes/${h.id}` },
};
const HUB_KINDS = Object.keys(HUBS) as GraphHubKind[];

const ALL_CAST_LABELS: Record<string, string> = CAST_ROLE_LABELS;

interface GroupConfig {
  label: string; // filter checkbox label
  short: string; // search pill label
  color: string;
  kinds: GraphHubKind[];
  roles: Array<[string, string]>; // [role, label], in display order
}

const GROUPS: Record<Group, GroupConfig> = {
  music: {
    label: "Music people", short: "Music", color: HUBS.artist.color, kinds: ["artist"],
    roles: BAND_ROLES.map((r) => [r, BAND_ROLE_LABELS[r]]),
  },
  books: {
    label: "Book people", short: "Books", color: HUBS.book.color, kinds: ["book"],
    roles: BOOK_ROLES.map((r) => [r, BOOK_ROLE_LABELS[r]]),
  },
  movies: {
    label: "Movie people", short: "Movies", color: HUBS.movie.color, kinds: ["movie"],
    roles: MOVIE_ROLES.map((r) => [r, CAST_ROLE_LABELS[r]]),
  },
  games: {
    label: "Game people", short: "Games", color: HUBS.game.color, kinds: ["game"],
    roles: GAME_ROLES.map((r) => [r, GAME_ROLE_LABELS[r]]),
  },
  television: {
    label: "TV people", short: "TV", color: HUBS.show.color, kinds: ["show", "episode"],
    roles: ["creator", "director", "composer", "lead_actor", "actor", "cameo_actor"].map((r) => [r, ALL_CAST_LABELS[r]]),
  },
};
const GROUP_KEYS = Object.keys(GROUPS) as Group[];

function roleLabel(kind: GraphHubKind, role: string): string {
  return GROUPS[HUBS[kind].group].roles.find(([r]) => r === role)?.[1] ?? role;
}

const personUid = (id: number) => `p-${id}`;
const hubUid = (kind: GraphHubKind, id: number) => `${kind}-${id}`;
const personLabel = (p: GraphPerson) => (p.name_en ? `${p.name} (${p.name_en})` : p.name);
const hubLabel = (h: GraphHub) => (h.kind === "episode" && h.show_name ? `${h.show_name} — ${h.name}` : h.name);

// ─── Filters ───────────────────────────────────────────────────────────────

type Filters = Record<Group, { on: boolean; roles: Set<string> }>;

const EMPTY_FILTERS: Filters = {
  music: { on: false, roles: new Set() },
  books: { on: false, roles: new Set() },
  movies: { on: false, roles: new Set() },
  games: { on: false, roles: new Set() },
  television: { on: false, roles: new Set() },
};

function personGroupRoles(person: GraphPerson, group: Group): string[] {
  return GROUPS[group].kinds.flatMap((k) => person.roles[k] ?? []);
}

function personPassesFilter(person: GraphPerson, filters: Filters): boolean {
  const active = GROUP_KEYS.filter((g) => filters[g].on);
  if (active.length === 0) return true;
  return active.some((g) => {
    const roles = personGroupRoles(person, g);
    if (roles.length === 0) return false;
    const wanted = filters[g].roles;
    return wanted.size === 0 || roles.some((r) => wanted.has(r));
  });
}

// ─── D3 node/link types ────────────────────────────────────────────────────

type NodeKind = "person" | GraphHubKind;

interface SimNode extends d3.SimulationNodeDatum {
  uid: string; // "p-{id}" | "{hubKind}-{id}"
  label: string;
  kind: NodeKind;
  id_: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
}

const nodeColor = (kind: NodeKind) => (kind === "person" ? PERSON_COLOR : HUBS[kind].color);

// ─── Search result type ───────────────────────────────────────────────────

type SearchKind = "all" | "person" | Group;

interface SearchResult {
  uid: string;
  label: string;
  kind: NodeKind;
  id_: number;
}

// ─── Hit-test helper ──────────────────────────────────────────────────────

function hitTest(nodes: SimNode[], canvasX: number, canvasY: number): SimNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const r = node.kind === "person" ? PERSON_R : HUB_R;
    const dx = canvasX - x;
    const dy = canvasY - y;
    if (dx * dx + dy * dy <= r * r) return node;
  }
  return null;
}

// ─── Main component ─────────────────────────────────────────────────────────

export function PeopleGraphPage() {
  const { guildId } = useGuildApi();
  const { data, isLoading, isError } = usePersonGraph();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const transform = useRef({ x: 0, y: 0, k: 1 });
  const dragging = useRef(false);
  const moved = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const [selected, setSelected] = useState<string | null>(null); // uid
  const [, forceRedraw] = useState(0);

  // Filters
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchKind, setSearchKind] = useState<SearchKind>("all");

  function setGroupOn(group: Group, on: boolean) {
    setFilters((prev) => ({ ...prev, [group]: { ...prev[group], on } }));
  }

  function setGroupRoles(group: Group, roles: Set<string>) {
    setFilters((prev) => ({ ...prev, [group]: { ...prev[group], roles } }));
  }

  function toggleRole(group: Group, role: string) {
    const next = new Set(filters[group].roles);
    if (next.has(role)) next.delete(role); else next.add(role);
    setGroupRoles(group, next);
  }

  // Derived lookup maps
  const hubByUid = useMemo(() => {
    if (!data) return new Map<string, GraphHub>();
    return new Map(data.hubs.map((h) => [hubUid(h.kind, h.id), h]));
  }, [data]);

  const personById = useMemo(() => {
    if (!data) return new Map<number, GraphPerson>();
    return new Map(data.persons.map((p) => [p.id, p]));
  }, [data]);

  // Filtered persons
  const filteredPersons = useMemo(() => {
    if (!data) return [];
    return data.persons.filter((p) => personPassesFilter(p, filters));
  }, [data, filters]);

  const filteredPersonUids = useMemo(
    () => new Set(filteredPersons.map((p) => personUid(p.id))),
    [filteredPersons],
  );

  // Build sim nodes + links from filtered data. Every hub with at least one
  // visible person shows up, even if it doesn't connect two people; albums
  // hang off their visible artists rather than linking to people directly.
  const { simNodes, simLinks } = useMemo(() => {
    if (!data) return { simNodes: [], simLinks: [] };

    const nodeMap = new Map<string, SimNode>();

    for (const p of filteredPersons) {
      const uid = personUid(p.id);
      nodeMap.set(uid, { uid, label: personLabel(p), kind: "person", id_: p.id });
    }

    function hubNode(kind: GraphHubKind, id: number): SimNode {
      const uid = hubUid(kind, id);
      let node = nodeMap.get(uid);
      if (!node) {
        const hub = hubByUid.get(uid);
        node = { uid, label: hub ? hubLabel(hub) : String(id), kind, id_: id };
        nodeMap.set(uid, node);
      }
      return node;
    }

    const simLinks: SimLink[] = [];

    for (const edge of data.edges) {
      const pUid = personUid(edge.person_id);
      if (!filteredPersonUids.has(pUid)) continue;
      simLinks.push({ source: nodeMap.get(pUid)!, target: hubNode(edge.kind, edge.target_id) });
    }

    for (const { album_id, artist_id } of data.album_artists) {
      const artist = nodeMap.get(hubUid("artist", artist_id));
      if (!artist) continue; // none of the artist's people are visible
      simLinks.push({ source: artist, target: hubNode("album", album_id) });
    }

    return { simNodes: Array.from(nodeMap.values()), simLinks };
  }, [filteredPersons, filteredPersonUids, data, hubByUid]);

  // ─── D3 simulation ──────────────────────────────────────────────────────

  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const selectedRef = useRef<string | null>(null);
  const connectedRef = useRef<Set<string> | null>(null);
  const simSettledRef = useRef(false); // true once the sim has run fitView at least once

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const drawDirect = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { x, y, k } = transform.current;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);

    const nodes = nodesRef.current;
    const links = linksRef.current;
    const sel = selectedRef.current;
    const conn = connectedRef.current;

    // Draw edges
    for (const link of links) {
      const sx = link.source.x ?? 0, sy = link.source.y ?? 0;
      const tx = link.target.x ?? 0, ty = link.target.y ?? 0;
      const hl = conn !== null && conn.has(link.source.uid) && conn.has(link.target.uid);
      const dm = conn !== null && !hl;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = dm ? EDGE_COLOR_DIM : hl ? EDGE_COLOR_HL : EDGE_COLOR_DEFAULT;
      ctx.lineWidth = hl ? 1.5 : 1;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      const nx = node.x ?? 0, ny = node.y ?? 0;
      const r = node.kind === "person" ? PERSON_R : HUB_R;
      const isSelected = node.uid === sel;
      const isConnected = conn !== null && conn.has(node.uid);
      const isDimmed = conn !== null && !isConnected;

      ctx.globalAlpha = isDimmed ? 0.15 : 1;

      const baseColor = nodeColor(node.kind);

      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? baseColor : baseColor + "44";
      ctx.fill();
      ctx.strokeStyle = isSelected ? baseColor : baseColor + "99";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Labels
      ctx.fillStyle = isDimmed ? "#666" : "#ccc";
      const isHub = node.kind !== "person";
      const fontSize = isHub ? 9 : (isSelected ? 11 : 10);
      ctx.font = `${isSelected ? "bold " : ""}${fontSize}px sans-serif`;
      ctx.textAlign = "center";

      if (isHub) {
        ctx.textBaseline = "top";
        ctx.fillText(node.label, nx, ny + r + 3, 120);
      } else {
        ctx.textBaseline = "middle";
        const maxW = r * 2 - 4;
        const words = node.label.split(" ");
        const lines: string[] = [];
        let line = "";
        for (const word of words) {
          const test = line ? `${line} ${word}` : word;
          if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
          else line = test;
        }
        if (line) lines.push(line);
        const lineH = fontSize + 2;
        const startY = ny - ((lines.length - 1) * lineH) / 2;
        for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], nx, startY + i * lineH, maxW);
      }

      ctx.globalAlpha = 1;
    }
  }, []);

  const fitView = useCallback(() => {
    const nodes = nodesRef.current;
    const container = containerRef.current;
    if (nodes.length === 0 || !container) return;
    const { clientWidth: cw, clientHeight: ch } = container;
    if (cw === 0 || ch === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? 0, y = n.y ?? 0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const pad = 60;
    const graphW = maxX - minX + pad * 2;
    const graphH = maxY - minY + pad * 2;
    const k = Math.max(0.1, Math.min(4, Math.min(cw / graphW, ch / graphH)));
    transform.current = {
      x: cw / 2 - ((minX + maxX) / 2) * k,
      y: ch / 2 - ((minY + maxY) / 2) * k,
      k,
    };
    drawDirect();
  }, [drawDirect]);

  // Resize canvas to container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    function resize() {
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      // If sim has already settled, re-fit to the new dimensions; otherwise just redraw
      if (simSettledRef.current) fitView(); else drawDirect();
    }

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    return () => ro.disconnect();
  }, [drawDirect, fitView]);

  // Build/restart simulation when filtered data changes
  useEffect(() => {
    nodesRef.current = simNodes;
    linksRef.current = simLinks;
    simSettledRef.current = false;

    if (simRef.current) simRef.current.stop();

    if (simNodes.length === 0) { drawDirect(); return; }

    simNodes.forEach((node, i) => {
      if (node.x === undefined) {
        const angle = (2 * Math.PI * i) / simNodes.length;
        const r = 100 + simNodes.length * 4;
        node.x = r * Math.cos(angle);
        node.y = r * Math.sin(angle);
      }
    });

    let tick = 0;
    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force("link", d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.uid).distance(120).strength(0.4))
      .force("charge", d3.forceManyBody<SimNode>().strength((d) => (d.kind === "person" ? -300 : -150)))
      .force("collision", d3.forceCollide<SimNode>((d) => (d.kind === "person" ? PERSON_R + 4 : HUB_R + 4)))
      .alphaDecay(0.03)
      .on("tick", () => { if (tick++ < 30) fitView(); else drawDirect(); })
      .on("end", () => { simSettledRef.current = true; fitView(); });

    simRef.current = sim;
    return () => { sim.stop(); };
  }, [simNodes, simLinks, drawDirect, fitView]);

  useEffect(() => { drawDirect(); }, [selected, drawDirect]);

  // ─── Selection helper ────────────────────────────────────────────────────

  function selectNode(uid: string | null) {
    selectedRef.current = uid;
    if (uid !== null) {
      const connUids = new Set<string>([uid]);
      for (const link of linksRef.current) {
        if (link.source.uid === uid || link.target.uid === uid) {
          connUids.add(link.source.uid);
          connUids.add(link.target.uid);
        }
      }
      connectedRef.current = connUids;
    } else {
      connectedRef.current = null;
    }
    setSelected(uid);
    forceRedraw((n) => n + 1);
  }

  // ─── Pan / zoom ─────────────────────────────────────────────────────────

  function canvasToWorld(cx: number, cy: number) {
    const { x, y, k } = transform.current;
    return { x: (cx - x) / k, y: (cy - y) / k };
  }

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = true;
    moved.current = false;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved.current = true;
    transform.current = { ...transform.current, x: transform.current.x + dx, y: transform.current.y + dy };
    lastMouse.current = { x: e.clientX, y: e.clientY };
    drawDirect();
  }

  function onMouseUp() { dragging.current = false; }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { x, y, k } = transform.current;
    const newK = Math.max(0.1, Math.min(6, k * Math.pow(0.999, e.deltaY)));
    transform.current = {
      x: mx - (mx - x) * (newK / k),
      y: my - (my - y) * (newK / k),
      k: newK,
    };
    drawDirect();
  }

  function onCanvasClick(e: React.MouseEvent) {
    if (moved.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const { x: wx, y: wy } = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitTest(nodesRef.current, wx, wy);
    const uid = hit ? hit.uid : null;
    selectNode(uid === selected ? null : uid);
  }

  function centerOn(uid: string) {
    const node = nodesRef.current.find((n) => n.uid === uid);
    if (!node || !containerRef.current) return;
    const { clientWidth: w, clientHeight: h } = containerRef.current;
    const { k } = transform.current;
    transform.current = { x: w / 2 - (node.x ?? 0) * k, y: h / 2 - (node.y ?? 0) * k, k };
    drawDirect();
  }

  // ─── Derived data ────────────────────────────────────────────────────────

  // Roles that actually occur per group, so the filter only offers useful ones
  const existingRoles = useMemo(() => {
    const out = Object.fromEntries(GROUP_KEYS.map((g) => [g, new Set<string>()])) as Record<Group, Set<string>>;
    if (!data) return out;
    for (const p of data.persons) for (const g of GROUP_KEYS) for (const r of personGroupRoles(p, g)) out[g].add(r);
    return out;
  }, [data]);

  // All searchable items: people plus every hub
  const searchPool = useMemo((): SearchResult[] => {
    if (!data) return [];
    const results: SearchResult[] = [];
    for (const p of data.persons) results.push({ uid: personUid(p.id), label: personLabel(p), kind: "person", id_: p.id });
    for (const h of data.hubs) results.push({ uid: hubUid(h.kind, h.id), label: hubLabel(h), kind: h.kind, id_: h.id });
    return results;
  }, [data]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return searchPool
      .filter((r) => {
        if (searchKind === "person" && r.kind !== "person") return false;
        if (searchKind !== "all" && searchKind !== "person" && (r.kind === "person" || HUBS[r.kind].group !== searchKind)) return false;
        return r.label.toLowerCase().includes(q);
      })
      .slice(0, 10);
  }, [searchQuery, searchPool, searchKind]);

  function handleSearchSelect(result: SearchResult) {
    setSearchQuery("");
    setSearchOpen(false);
    selectNode(result.uid);
    setTimeout(() => centerOn(result.uid), 0);
  }

  // Info panel: what to show depends on whether a person or hub is selected
  const selectedNode = useMemo(
    () => (selected ? nodesRef.current.find((n) => n.uid === selected) ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, simNodes], // simNodes change triggers re-eval
  );

  // For a selected person: list the visible hub nodes they connect to
  const personConnections = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== "person" || !data) return [];
    const personId = selectedNode.id_;
    const visibleHubs = new Set(nodesRef.current.filter((n) => n.kind !== "person").map((n) => n.uid));
    return data.edges
      .filter((e) => e.person_id === personId && visibleHubs.has(hubUid(e.kind, e.target_id)))
      .map((e) => {
        const uid = hubUid(e.kind, e.target_id);
        const hub = hubByUid.get(uid);
        return { uid, label: hub ? hubLabel(hub) : String(e.target_id), kind: e.kind, roles: e.roles };
      });
  }, [selectedNode, data, hubByUid, simNodes]);

  // For a selected hub: list its visible neighbours — people (with their roles),
  // plus albums for an artist or artists for an album.
  const hubConnections = useMemo(() => {
    if (!selectedNode || selectedNode.kind === "person" || !data) return [];
    const { kind, id_, uid } = selectedNode;
    const rolesByPerson = new Map(
      data.edges.filter((e) => e.kind === kind && e.target_id === id_).map((e) => [personUid(e.person_id), e.roles]),
    );
    const out: Array<{ uid: string; label: string; kind: NodeKind; roles: string[] }> = [];
    for (const link of simLinks) {
      const other = link.source.uid === uid ? link.target : link.target.uid === uid ? link.source : null;
      if (other) out.push({ uid: other.uid, label: other.label, kind: other.kind, roles: rolesByPerson.get(other.uid) ?? [] });
    }
    return out;
  }, [selectedNode, data, simLinks]);

  // ─── Legend ──────────────────────────────────────────────────────────────

  const Legend = () => (
    <div style={{ display: "flex", gap: "1rem", fontSize: "0.78rem", opacity: 0.7, flexWrap: "wrap" }}>
      {([["Person", PERSON_COLOR], ...HUB_KINDS.map((k) => [HUBS[k].label, HUBS[k].color])] as const).map(([label, color]) => (
        <span key={label} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: color }} />
          {label}
        </span>
      ))}
    </div>
  );

  const Dot = ({ color, size = 7 }: { color: string; size?: number }) => (
    <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", flexShrink: 0, background: color }} />
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  const selectedPerson = selectedNode?.kind === "person" ? personById.get(selectedNode.id_) : null;
  const selectedHubNode = selectedNode && selectedNode.kind !== "person" ? selectedNode : null;
  const selectedHub = selectedHubNode ? hubByUid.get(selectedHubNode.uid) ?? null : null;

  const SEARCH_KINDS: SearchKind[] = ["all", "person", ...GROUP_KEYS];
  const kindLabel = (k: SearchKind) => (k === "all" ? "All" : k === "person" ? "People" : GROUPS[k].short);
  const kindColor = (k: SearchKind) => (k === "all" ? undefined : k === "person" ? PERSON_COLOR : GROUPS[k].color);

  const overlayMessage = isLoading ? "Loading…"
    : isError ? "Failed to load graph."
    : data && data.persons.length === 0 ? "No people to display."
    : null;

  return (
    <section>
      {/* Filter + search bar — hidden until data is ready */}
      <div style={{ display: overlayMessage ? "none" : "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.75rem", alignItems: "flex-start", fontSize: "0.875rem" }}>
        {/* Per-vertical people filters */}
        {GROUP_KEYS.map((g) => {
          const { on, roles } = filters[g];
          const offered = GROUPS[g].roles.filter(([r]) => existingRoles[g].has(r));
          return (
            <div key={g}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 500, cursor: "pointer" }}>
                <input type="checkbox" checked={on} onChange={(e) => setGroupOn(g, e.target.checked)} />
                {GROUPS[g].label}
              </label>
              {on && offered.length > 0 && (
                <div style={{ marginLeft: "1.4rem", marginTop: "0.3rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                  {offered.map(([role, label]) => (
                    <label key={role} style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", opacity: 0.85 }}>
                      <input type="checkbox" checked={roles.has(role)} onChange={() => toggleRole(g, role)} />
                      {label}
                    </label>
                  ))}
                  {roles.size > 0 && (
                    <button onClick={() => setGroupRoles(g, new Set())}
                      style={{ alignSelf: "flex-start", marginTop: "0.2rem", fontSize: "0.78rem", opacity: 0.55, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      clear roles
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Search */}
        <div style={{ position: "relative", marginLeft: "auto" }}>
          {/* Type filter pills */}
          <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.3rem", justifyContent: "flex-end" }}>
            {SEARCH_KINDS.map((k) => (
              <button key={k} onClick={() => setSearchKind(k)}
                style={{
                  fontSize: "0.72rem", padding: "0.15rem 0.5rem", borderRadius: 10,
                  border: `1px solid ${kindColor(k) ?? "#8884"}`,
                  background: searchKind === k ? (kindColor(k) ?? "#8884") : "transparent",
                  color: searchKind === k ? "#fff" : undefined,
                  cursor: "pointer", opacity: searchKind === k ? 1 : 0.6,
                }}>
                {kindLabel(k)}
              </button>
            ))}
          </div>
          <input
            type="search"
            placeholder={`Search ${kindLabel(searchKind).toLowerCase()}…`}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSearchQuery(""); setSearchOpen(false); }
              if (e.key === "Enter" && searchResults.length > 0) handleSearchSelect(searchResults[0]);
            }}
            style={{ fontSize: "0.875rem", padding: "0.3rem 0.6rem", borderRadius: 4, border: "1px solid #8884", width: 200 }}
          />
          {searchOpen && searchResults.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
              background: "Canvas", border: "1px solid #8884", borderRadius: 4,
              boxShadow: "0 4px 12px #0003", marginTop: 2,
            }}>
              {searchResults.map((r) => (
                <div key={r.uid} onMouseDown={() => handleSearchSelect(r)}
                  style={{ padding: "0.4rem 0.6rem", cursor: "pointer", fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#8882")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <Dot color={nodeColor(r.kind)} />
                  {r.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Count + legend */}
        <span style={{ opacity: 0.45, alignSelf: "center" }}>
          {filteredPersons.length} / {data?.persons.length ?? 0} people
        </span>
        <Legend />
      </div>

      {/* Canvas — always mounted so ResizeObserver attaches before data loads */}
      <div ref={containerRef} className="genre-tree-canvas" style={{ height: "78vh", cursor: dragging.current ? "grabbing" : "grab", position: "relative" }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel}>
        <canvas ref={canvasRef} onClick={onCanvasClick} style={{ display: "block" }} />
        {overlayMessage && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            {isLoading ? <LoadingState label="Loading graph…" /> : <span style={{ opacity: 0.5 }}>{overlayMessage}</span>}
          </div>
        )}
      </div>

      {/* Info panel — person selected */}
      {selectedPerson && (
        <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", border: "1px solid #8884", borderRadius: 6, fontSize: "0.875rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "0.5rem" }}>
            <strong style={{ fontSize: "1rem" }}>{selectedPerson.name}{selectedPerson.name_en && <span style={{ opacity: 0.6, fontWeight: "normal" }}> ({selectedPerson.name_en})</span>}</strong>
            <Link to={`/g/${guildId}/people/${selectedPerson.id}`} style={{ opacity: 0.6, fontSize: "0.8rem" }}>view profile →</Link>
            <button onClick={() => centerOn(selected!)}
              style={{ marginLeft: "auto", opacity: 0.5, background: "none", border: "none", cursor: "pointer", fontSize: "0.78rem" }}>
              center
            </button>
          </div>
          {personConnections.length === 0 ? (
            <p style={{ opacity: 0.5, margin: 0 }}>No visible connections.</p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1.2rem" }}>
              {personConnections.map((conn) => (
                <span key={conn.uid} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <Dot color={HUBS[conn.kind].color} />
                  <span style={{ opacity: 0.55, fontSize: "0.78rem" }}>{HUBS[conn.kind].label.toLowerCase()}</span>
                  <button onClick={() => selectNode(conn.uid)}
                    style={{ fontWeight: 500, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "inherit" }}>
                    {conn.label}
                  </button>
                  <span style={{ opacity: 0.55, fontSize: "0.78rem" }}>{conn.roles.map((r) => roleLabel(conn.kind, r)).join(", ")}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info panel — hub selected */}
      {selectedHubNode && selectedHub && (
        <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", border: "1px solid #8884", borderRadius: 6, fontSize: "0.875rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "0.5rem" }}>
            <span style={{ alignSelf: "center", display: "flex" }}><Dot color={HUBS[selectedHub.kind].color} size={9} /></span>
            <strong style={{ fontSize: "1rem" }}>{selectedHubNode.label}</strong>
            <Link to={`/g/${guildId}/${HUBS[selectedHub.kind].path(selectedHub)}`} style={{ opacity: 0.6, fontSize: "0.8rem" }}>
              view {HUBS[selectedHub.kind].label.toLowerCase()} →
            </Link>
            <button onClick={() => centerOn(selected!)}
              style={{ marginLeft: "auto", opacity: 0.5, background: "none", border: "none", cursor: "pointer", fontSize: "0.78rem" }}>
              center
            </button>
          </div>
          {hubConnections.length === 0 ? (
            <p style={{ opacity: 0.5, margin: 0 }}>No visible connections.</p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1.2rem" }}>
              {hubConnections.map((conn) => (
                <span key={conn.uid} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  {conn.kind !== "person" && (
                    <>
                      <Dot color={HUBS[conn.kind].color} />
                      <span style={{ opacity: 0.55, fontSize: "0.78rem" }}>{HUBS[conn.kind].label.toLowerCase()}</span>
                    </>
                  )}
                  <button onClick={() => selectNode(conn.uid)}
                    style={{ fontWeight: 500, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "inherit" }}>
                    {conn.label}
                  </button>
                  <span style={{ opacity: 0.55, fontSize: "0.78rem" }}>{conn.roles.map((r) => roleLabel(selectedHub.kind, r)).join(", ")}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
