import * as d3 from "d3-force";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePersonGraph, useGuildApi } from "../api/hooks";
import type { GraphHub, GraphHubKind, GraphHubRelation, GraphPerson } from "../api/types";
import {
  BAND_ROLE_LABELS, BAND_ROLES, BOOK_ROLE_LABELS, BOOK_ROLES, CAST_ROLE_LABELS, GAME_ROLE_LABELS, GAME_ROLES, MOVIE_ROLES,
} from "../api/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { LoadingState } from "../components/Spinner";

// ─── Constants ─────────────────────────────────────────────────────────────

const PERSON_R = 18;
const HUB_R = 12; // artist/album/book/movie/game/show/season/episode hub nodes
const PERSON_COLOR = "#6b8cba";
const EDGE_COLOR_DEFAULT = "rgba(150,150,150,0.18)";
const EDGE_COLOR_HL = "rgba(150,150,150,0.75)";
const EDGE_COLOR_DIM = "rgba(150,150,150,0.05)";

// A filter group is one vertical; TV covers shows, seasons and episodes.
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
  season: { label: "TV season", color: "#5b8fd6", group: "television", path: (h) => `television/seasons/${h.id}` },
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
    label: "TV people", short: "TV", color: HUBS.show.color, kinds: ["show", "season", "episode"],
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
const hubLabel = (h: GraphHub) =>
  (h.kind === "season" || h.kind === "episode") && h.show_name ? `${h.show_name} — ${h.name}` : h.name;

// Hub-to-hub links: the tree ones are drawn dashed, the cross-media ones dotted.
const RELATION_LABEL: Record<GraphHubRelation, string> = {
  album_artist: "album", season_show: "season", episode_season: "episode",
  adaptation: "adaptation", soundtrack: "soundtrack",
};
const CROSS_MEDIA: GraphHubRelation[] = ["adaptation", "soundtrack"];

// ─── Filters ───────────────────────────────────────────────────────────────

type Filters = Record<Group, { on: boolean; roles: Set<string> }>;

// URL shape: ?off=books,games&roles=movies:director|composer;music:vocals&detail=1
function filtersFromParams(params: URLSearchParams): Filters {
  const off = new Set((params.get("off") ?? "").split(",").filter(Boolean));
  const roles = new Map(
    (params.get("roles") ?? "").split(";").filter(Boolean).map((part) => {
      const [g, rs = ""] = part.split(":");
      return [g, new Set(rs.split("|").filter(Boolean))] as const;
    }),
  );
  return Object.fromEntries(
    GROUP_KEYS.map((g) => [g, { on: !off.has(g), roles: roles.get(g) ?? new Set<string>() }]),
  ) as Filters;
}

function filtersToParams(filters: Filters, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  const off = GROUP_KEYS.filter((g) => !filters[g].on);
  const roles = GROUP_KEYS.filter((g) => filters[g].roles.size > 0)
    .map((g) => `${g}:${[...filters[g].roles].join("|")}`);
  if (off.length) next.set("off", off.join(",")); else next.delete("off");
  if (roles.length) next.set("roles", roles.join(";")); else next.delete("roles");
  return next;
}

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
  relation?: GraphHubRelation; // hub-to-hub links only
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

// Canvas text can't use CSS variables, so read the theme at draw time.
function labelColor(dimmed: boolean): string {
  const dark = document.documentElement.classList.contains("dark");
  if (dimmed) return dark ? "#555" : "#bbb";
  return dark ? "#d4d4d8" : "#3f3f46";
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

  // Filters live in the URL so a refresh or Back keeps them.
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const setFilters = (update: (prev: Filters) => Filters) =>
    setParams((p) => filtersToParams(update(filtersFromParams(p)), p), { replace: true });
  // Off by default: season/episode edges that only repeat a role held higher up.
  const showDetail = params.get("detail") === "1";
  const onlyMine = params.get("mine") === "1";
  const setShowDetail = (on: boolean) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (on) next.set("detail", "1"); else next.delete("detail");
    return next;
  }, { replace: true });

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
    setFilters((prev) => {
      const next = new Set(prev[group].roles);
      if (next.has(role)) next.delete(role); else next.add(role);
      return { ...prev, [group]: { ...prev[group], roles: next } };
    });
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
    let persons = data.persons.filter((p) => personPassesFilter(p, filters));
    if (onlyMine) {
      const mine = new Set(data.mine.map((m) => hubUid(m.kind, m.id)));
      const credited = new Set(data.edges.filter((e) => mine.has(hubUid(e.kind, e.target_id))).map((e) => e.person_id));
      persons = persons.filter((p) => credited.has(p.id));
    }
    return persons;
  }, [data, filters, onlyMine]);

  const filteredPersonUids = useMemo(
    () => new Set(filteredPersons.map((p) => personUid(p.id))),
    [filteredPersons],
  );

  // "Only what I've ranked": credits on anything else aren't drawn.
  const mineUids = useMemo(
    () => (onlyMine && data ? new Set(data.mine.map((m) => hubUid(m.kind, m.id))) : null),
    [onlyMine, data],
  );

  // Person edges as displayed: without the detail toggle, a season/episode
  // edge loses the roles its parent already carries, and goes if none remain.
  const visibleEdges = useMemo(() => {
    if (!data) return [];
    return data.edges.flatMap((e) => {
      if (mineUids && !mineUids.has(hubUid(e.kind, e.target_id))) return [];
      if (showDetail || e.inherited.length === 0) return [e];
      const roles = e.roles.filter((r) => !e.inherited.includes(r));
      return roles.length ? [{ ...e, roles }] : [];
    });
  }, [data, showDetail, mineUids]);

  // Build sim nodes + links from filtered data. Every hub with at least one
  // visible person shows up, even if it doesn't connect two people. Albums hang
  // off their visible artists, episodes off seasons off shows (adding the
  // parents so the tree stays connected), and adaptation / soundtrack links
  // join hubs that are already on screen.
  const full = useMemo(() => {
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

    for (const edge of visibleEdges) {
      const pUid = personUid(edge.person_id);
      if (!filteredPersonUids.has(pUid)) continue;
      simLinks.push({ source: nodeMap.get(pUid)!, target: hubNode(edge.kind, edge.target_id) });
    }

    const byRelation = (r: GraphHubRelation) => data.hub_links.filter((l) => l.relation === r);
    for (const l of byRelation("album_artist")) {
      const artist = nodeMap.get(hubUid("artist", l.to_id));
      if (!artist) continue; // none of the artist's people are visible
      simLinks.push({ source: hubNode("album", l.from_id), target: artist, relation: l.relation });
    }
    // Episodes first, so a season pulled in by an episode then gets its show.
    for (const relation of ["episode_season", "season_show"] as const) {
      for (const l of byRelation(relation)) {
        const child = nodeMap.get(hubUid(l.from_kind, l.from_id));
        if (!child) continue;
        simLinks.push({ source: child, target: hubNode(l.to_kind, l.to_id), relation });
      }
    }
    for (const relation of CROSS_MEDIA) {
      for (const l of byRelation(relation)) {
        const a = nodeMap.get(hubUid(l.from_kind, l.from_id));
        const b = nodeMap.get(hubUid(l.to_kind, l.to_id));
        if (a && b) simLinks.push({ source: a, target: b, relation });
      }
    }

    return { simNodes: Array.from(nodeMap.values()), simLinks };
  }, [filteredPersons, filteredPersonUids, data, hubByUid, visibleEdges]);

  // Focus mode: only what's within `hops` links of one node. A whole guild is
  // thousands of nodes; this is how you read one corner of it.
  const focus = params.get("focus");
  const hops = Math.min(4, Math.max(1, Number(params.get("hops")) || 2));
  const setFocus = (uid: string | null, n = hops) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (uid) { next.set("focus", uid); next.set("hops", String(n)); } else { next.delete("focus"); next.delete("hops"); }
    return next;
  }, { replace: true });
  const { simNodes, simLinks } = useMemo(() => {
    if (!focus || !full.simNodes.some((n) => n.uid === focus)) return full;
    const near = new Map<string, string[]>();
    for (const l of full.simLinks) {
      (near.get(l.source.uid) ?? near.set(l.source.uid, []).get(l.source.uid)!).push(l.target.uid);
      (near.get(l.target.uid) ?? near.set(l.target.uid, []).get(l.target.uid)!).push(l.source.uid);
    }
    const keep = new Set([focus]);
    let frontier = [focus];
    for (let i = 0; i < hops && frontier.length; i++) {
      const next: string[] = [];
      for (const uid of frontier) for (const o of near.get(uid) ?? []) if (!keep.has(o)) { keep.add(o); next.push(o); }
      frontier = next;
    }
    return {
      simNodes: full.simNodes.filter((n) => keep.has(n.uid)),
      simLinks: full.simLinks.filter((l) => keep.has(l.source.uid) && keep.has(l.target.uid)),
    };
  }, [full, focus, hops]);
  const focusNode = focus ? full.simNodes.find((n) => n.uid === focus) ?? null : null;

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
      ctx.setLineDash(!link.relation ? [] : CROSS_MEDIA.includes(link.relation) ? [1.5, 3] : [5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
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
      ctx.fillStyle = labelColor(isDimmed);
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

  // For a selected person: their credits. TV credits roll up to one entry per
  // show ("S1–S3 · 4 episodes"), the way the person page lists them; the rest
  // are listed when their hub is on screen.
  const personConnections = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== "person" || !data) return [];
    const personId = selectedNode.id_;
    const visibleHubs = new Set(nodesRef.current.filter((n) => n.kind !== "person").map((n) => n.uid));
    const out: Connection[] = [];
    const shows = new Map<number, { name: string; seasons: Set<number>; episodes: number; roles: string[] }>();
    for (const e of data.edges) {
      if (e.person_id !== personId) continue;
      const uid = hubUid(e.kind, e.target_id);
      const hub = hubByUid.get(uid);
      if (e.kind === "show" || e.kind === "season" || e.kind === "episode") {
        const showId = e.kind === "show" ? e.target_id : hub?.show_id;
        if (showId == null) continue;
        const entry = shows.get(showId) ?? { name: "", seasons: new Set(), episodes: 0, roles: [] };
        if (e.kind === "show") entry.name = hub?.name ?? entry.name;
        else entry.name ||= hub?.show_name ?? "";
        if (e.kind === "season" && hub?.season_number != null) entry.seasons.add(hub.season_number);
        if (e.kind === "episode") entry.episodes += 1;
        for (const r of e.roles) if (!entry.roles.includes(r)) entry.roles.push(r);
        shows.set(showId, entry);
      } else if (visibleHubs.has(uid)) {
        out.push({ uid, label: hub ? hubLabel(hub) : String(e.target_id), kind: e.kind, roles: e.roles });
      }
    }
    for (const [showId, s] of shows) {
      const parts = [
        s.seasons.size ? seasonRanges([...s.seasons]) : null,
        s.episodes ? `${s.episodes} episode${s.episodes === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      out.push({ uid: hubUid("show", showId), label: s.name, kind: "show", roles: s.roles, detail: parts.join(" · ") });
    }
    return out;
    // simNodes: re-read nodesRef (what is on screen) whenever the graph is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, data, hubByUid, simNodes]);

  // For a selected hub: list its visible neighbours — people (with their roles)
  // and linked hubs (albums/artists, the TV tree, adaptations, soundtracks).
  const hubConnections = useMemo(() => {
    if (!selectedNode || selectedNode.kind === "person" || !data) return [];
    const { kind, id_, uid } = selectedNode;
    const rolesByPerson = new Map(
      visibleEdges.filter((e) => e.kind === kind && e.target_id === id_).map((e) => [personUid(e.person_id), e.roles]),
    );
    const out: Connection[] = [];
    for (const link of simLinks) {
      const other = link.source.uid === uid ? link.target : link.target.uid === uid ? link.source : null;
      if (!other) continue;
      out.push({
        uid: other.uid, label: other.label, kind: other.kind,
        roles: rolesByPerson.get(other.uid) ?? [],
        detail: link.relation && CROSS_MEDIA.includes(link.relation) ? RELATION_LABEL[link.relation] : undefined,
      });
    }
    return out;
  }, [selectedNode, data, simLinks, visibleEdges]);

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

  const connectionList = (conns: Connection[], roleKind: (c: Connection) => GraphHubKind | null) =>
    conns.length === 0 ? (
      <p className="text-sm text-muted-foreground">No visible connections.</p>
    ) : (
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {conns.map((c) => {
          const rk = roleKind(c);
          return (
            <span key={c.uid} className="flex items-center gap-1.5">
              {c.kind !== "person" && (
                <>
                  <Dot color={HUBS[c.kind].color} />
                  <span className="text-xs text-muted-foreground">{HUBS[c.kind].label.toLowerCase()}</span>
                </>
              )}
              <button className="cursor-pointer font-medium hover:underline" onClick={() => selectNode(c.uid)}>
                {c.label}
              </button>
              {c.detail && <span className="text-xs text-muted-foreground">({c.detail})</span>}
              {rk && c.roles.length > 0 && (
                <span className="text-xs text-muted-foreground">{c.roles.map((r) => roleLabel(rk, r)).join(", ")}</span>
              )}
            </span>
          );
        })}
      </div>
    );

  return (
    <section className="grid gap-3">
      {/* Filter + search bar — hidden until data is ready */}
      <div className={cn("flex flex-wrap items-start gap-x-6 gap-y-3 text-sm", overlayMessage && "hidden")}>
        {/* Per-vertical people filters */}
        {GROUP_KEYS.map((g) => {
          const { on, roles } = filters[g];
          const offered = GROUPS[g].roles.filter(([r]) => existingRoles[g].has(r));
          return (
            <div key={g} className="grid gap-1.5">
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <Checkbox checked={on} onCheckedChange={(v) => setGroupOn(g, v === true)} />
                <Dot color={GROUPS[g].color} />
                {GROUPS[g].label}
              </label>
              {on && offered.length > 0 && (
                <div className="ml-6 grid gap-1">
                  {offered.map(([role, label]) => (
                    <label key={role} className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                      <Checkbox checked={roles.has(role)} onCheckedChange={() => toggleRole(g, role)} />
                      {label}
                    </label>
                  ))}
                  {roles.size > 0 && (
                    <Button variant="link" size="sm" className="h-auto justify-start p-0 text-xs"
                            onClick={() => setGroupRoles(g, new Set())}>
                      clear roles
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <label className="flex cursor-pointer items-center gap-2" title="Show season and episode credits that only repeat a role the person already has on the show or season">
          <Switch checked={showDetail} onCheckedChange={setShowDetail} />
          Season &amp; episode detail
        </label>

        <label className="flex cursor-pointer items-center gap-2" title="Only people credited on something in your own lists">
          <Switch checked={onlyMine} onCheckedChange={(on) => setParams((p) => {
            const next = new URLSearchParams(p);
            if (on) next.set("mine", "1"); else next.delete("mine");
            return next;
          }, { replace: true })} />
          Only what I've ranked
        </label>

        {/* Search */}
        <div className="relative ml-auto grid gap-1.5">
          <div className="flex justify-end gap-1">
            {SEARCH_KINDS.map((k) => (
              <button key={k} onClick={() => setSearchKind(k)}
                className={cn(
                  "cursor-pointer rounded-full border px-2 py-0.5 text-xs transition-opacity",
                  searchKind === k ? "text-white opacity-100" : "opacity-60 hover:opacity-90",
                )}
                style={{
                  borderColor: kindColor(k) ?? "var(--border)",
                  background: searchKind === k ? (kindColor(k) ?? "var(--muted-foreground)") : "transparent",
                }}>
                {kindLabel(k)}
              </button>
            ))}
          </div>
          <Input
            type="search"
            className="w-56"
            aria-label="Search the graph"
            placeholder={`Search ${kindLabel(searchKind).toLowerCase()}…`}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSearchQuery(""); setSearchOpen(false); }
              if (e.key === "Enter" && searchResults.length > 0) handleSearchSelect(searchResults[0]);
            }}
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border bg-popover shadow-md">
              {searchResults.map((r) => (
                <div key={r.uid} onMouseDown={() => handleSearchSelect(r)}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-accent">
                  <Dot color={nodeColor(r.kind)} />
                  {r.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {focusNode && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
          Showing what's within
          {[1, 2, 3, 4].map((n) => (
            <Button key={n} size="sm" variant={n === hops ? "default" : "outline"} className="h-7 px-2.5"
                    onClick={() => setFocus(focus, n)}>
              {n}
            </Button>
          ))}
          link{hops === 1 ? "" : "s"} of <strong>{focusNode.label}</strong>
          <Button variant="link" size="sm" className="ml-auto h-auto p-0" onClick={() => setFocus(null)}>Show everything</Button>
        </div>
      )}

      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", overlayMessage && "hidden")}>
        <span>
          {simNodes.filter((n) => n.kind === "person").length} / {data?.persons.length ?? 0} people
          {!focusNode && " · select a node and choose Focus here to explore its neighbourhood"}
        </span>
        {([["Person", PERSON_COLOR], ...HUB_KINDS.map((k) => [HUBS[k].label, HUBS[k].color])] as const).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5"><Dot color={color} size={9} />{label}</span>
        ))}
        <span className="flex items-center gap-1.5"><LineSample dash="5 4" />part of</span>
        <span className="flex items-center gap-1.5"><LineSample dash="1.5 3" />adaptation / soundtrack</span>
      </div>

      {/* Canvas — always mounted so ResizeObserver attaches before data loads */}
      <div ref={containerRef} className="relative w-full cursor-grab select-none overflow-hidden rounded-md border active:cursor-grabbing h-[72vh]"
        style={{ cursor: dragging.current ? "grabbing" : "grab" }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel}>
        <canvas ref={canvasRef} onClick={onCanvasClick} className="block" />
        {overlayMessage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {isLoading ? <LoadingState label="Loading graph…" /> : <span className="text-muted-foreground">{overlayMessage}</span>}
          </div>
        )}
      </div>

      {/* Info panel — person selected */}
      {selectedPerson && (
        <div className="grid gap-2 rounded-lg border bg-card p-4">
          <div className="flex items-baseline gap-3">
            <strong className="text-base">
              {selectedPerson.name}
              {selectedPerson.name_en && <span className="font-normal text-muted-foreground"> ({selectedPerson.name_en})</span>}
            </strong>
            <Link to={`/g/${guildId}/people/${selectedPerson.id}`} className="text-xs text-muted-foreground hover:underline">
              view profile →
            </Link>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setFocus(selected)}>Focus here</Button>
            <Button variant="ghost" size="sm" onClick={() => centerOn(selected!)}>Center</Button>
          </div>
          {connectionList(personConnections, (c) => (c.kind === "person" ? null : c.kind))}
        </div>
      )}

      {/* Info panel — hub selected */}
      {selectedHubNode && selectedHub && (
        <div className="grid gap-2 rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <Dot color={HUBS[selectedHub.kind].color} size={9} />
            <strong className="text-base">{selectedHubNode.label}</strong>
            <Link to={`/g/${guildId}/${HUBS[selectedHub.kind].path(selectedHub)}`} className="text-xs text-muted-foreground hover:underline">
              view {HUBS[selectedHub.kind].label.toLowerCase()} →
            </Link>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setFocus(selected)}>Focus here</Button>
            <Button variant="ghost" size="sm" onClick={() => centerOn(selected!)}>Center</Button>
          </div>
          {connectionList(hubConnections, () => selectedHub.kind)}
        </div>
      )}
    </section>
  );
}

interface Connection {
  uid: string;
  label: string;
  kind: NodeKind;
  roles: string[];
  detail?: string;
}

function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />;
}

function LineSample({ dash }: { dash: string }) {
  return (
    <svg width="22" height="6" aria-hidden>
      <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dash} />
    </svg>
  );
}

// [1, 2, 3, 5] -> "S1–S3, S5"
function seasonRanges(nums: number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `S${sorted[i]}` : `S${sorted[i]}–S${sorted[j]}`);
    i = j;
  }
  return parts.join(", ");
}
