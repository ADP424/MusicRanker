import * as d3 from "d3-force";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { CastRole, GraphPerson, PersonGraph } from "../api/types";
import { CAST_ROLES } from "../api/types";

// ─── Constants ─────────────────────────────────────────────────────────────

const PERSON_R = 18;
const HUB_R = 12; // movie/artist hub nodes
const PERSON_COLOR = "#6b8cba";
const MOVIE_COLOR = "#c47c3e";
const ARTIST_COLOR = "#6ba06b";
const EDGE_COLOR_DEFAULT = "rgba(150,150,150,0.18)";
const EDGE_COLOR_HL = "rgba(150,150,150,0.75)";
const EDGE_COLOR_DIM = "rgba(150,150,150,0.05)";

// ─── Role label ────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<CastRole, string> = {
  director: "Director",
  composer: "Composer",
  lead_actor: "Lead actor",
  actor: "Actor",
  cameo_actor: "Cameo Actor",
};

// ─── Filters ───────────────────────────────────────────────────────────────

interface Filters {
  moviePerson: boolean;
  movieRoles: Set<CastRole>;
  musicArtist: boolean;
}

function personPassesFilter(person: GraphPerson, filters: Filters): boolean {
  const hasMovies = person.movie_roles.length > 0;
  const hasMusic = person.artist_ids.length > 0;

  if (!filters.moviePerson && !filters.musicArtist) return true;

  if (filters.moviePerson && hasMovies) {
    if (filters.movieRoles.size > 0) {
      if (person.movie_roles.some((r) => filters.movieRoles.has(r))) return true;
    } else {
      return true;
    }
  }
  if (filters.musicArtist && hasMusic) return true;

  return false;
}

// ─── D3 node/link types ────────────────────────────────────────────────────

interface SimNode extends d3.SimulationNodeDatum {
  uid: string; // "p-{id}" | "m-{id}" | "a-{id}"
  label: string;
  kind: "person" | "movie" | "artist";
  id_: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
}

// ─── Search result type ───────────────────────────────────────────────────

type SearchKind = "all" | "person" | "movie" | "artist";

interface SearchResult {
  uid: string;
  label: string;
  kind: "person" | "movie" | "artist";
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
  const { data, isLoading, isError } = useQuery({
    queryKey: ["people", "graph"],
    queryFn: () => api.get<PersonGraph>("/persons/graph"),
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const transform = useRef({ x: 0, y: 0, k: 1 });
  const dragging = useRef(false);
  const moved = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const [selected, setSelected] = useState<string | null>(null); // uid
  const [, forceRedraw] = useState(0);

  // Filters
  const [filterMoviePerson, setFilterMoviePerson] = useState(false);
  const [filterMovieRoles, setFilterMovieRoles] = useState<Set<CastRole>>(new Set());
  const [filterMusicArtist, setFilterMusicArtist] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchKind, setSearchKind] = useState<SearchKind>("all");

  function toggleRole(role: CastRole) {
    setFilterMovieRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  }

  const filters: Filters = {
    moviePerson: filterMoviePerson,
    movieRoles: filterMovieRoles,
    musicArtist: filterMusicArtist,
  };

  // Derived lookup maps
  const movieById = useMemo(() => {
    if (!data) return new Map<number, string>();
    return new Map(data.movies.map((m) => [m.id, m.name]));
  }, [data]);

  const artistById = useMemo(() => {
    if (!data) return new Map<number, string>();
    return new Map(data.artists.map((a) => [a.id, a.name]));
  }, [data]);

  const personById = useMemo(() => {
    if (!data) return new Map<number, GraphPerson>();
    return new Map(data.persons.map((p) => [p.id, p]));
  }, [data]);

  // Filtered persons
  const filteredPersons = useMemo(() => {
    if (!data) return [];
    return data.persons.filter((p) => personPassesFilter(p, filters));
  }, [data, filterMoviePerson, filterMovieRoles, filterMusicArtist]);

  const filteredPersonUids = useMemo(
    () => new Set(filteredPersons.map((p) => `p-${p.id}`)),
    [filteredPersons],
  );

  // Build bipartite sim nodes + links from filtered data
  const { simNodes, simLinks } = useMemo(() => {
    if (!data) return { simNodes: [], simLinks: [] };

    const nodeMap = new Map<string, SimNode>();

    for (const p of filteredPersons) {
      const uid = `p-${p.id}`;
      nodeMap.set(uid, { uid, label: p.name, kind: "person", id_: p.id });
    }

    const links: Array<{ sourceUid: string; targetUid: string }> = [];

    for (const edge of data.edges) {
      const personUid = `p-${edge.person_id}`;
      if (!filteredPersonUids.has(personUid)) continue;

      const hubUid =
        edge.target_type === "movie" ? `m-${edge.target_id}` : `a-${edge.target_id}`;

      if (!nodeMap.has(hubUid)) {
        const label =
          edge.target_type === "movie"
            ? (movieById.get(edge.target_id) ?? String(edge.target_id))
            : (artistById.get(edge.target_id) ?? String(edge.target_id));
        nodeMap.set(hubUid, {
          uid: hubUid,
          label,
          kind: edge.target_type === "movie" ? "movie" : "artist",
          id_: edge.target_id,
        });
      }

      links.push({ sourceUid: personUid, targetUid: hubUid });
    }

    // Prune hub nodes connected to only 1 filtered person
    const hubDegree = new Map<string, number>();
    for (const { targetUid } of links) {
      if (!targetUid.startsWith("p-")) {
        hubDegree.set(targetUid, (hubDegree.get(targetUid) ?? 0) + 1);
      }
    }
    for (const [uid, deg] of hubDegree) {
      if (deg < 2) nodeMap.delete(uid);
    }

    const filteredLinks = links.filter(
      ({ sourceUid, targetUid }) => nodeMap.has(sourceUid) && nodeMap.has(targetUid),
    );

    const simNodes = Array.from(nodeMap.values());
    const nodeByUid = new Map(simNodes.map((n) => [n.uid, n]));
    const simLinks: SimLink[] = filteredLinks.map(({ sourceUid, targetUid }) => ({
      source: nodeByUid.get(sourceUid)!,
      target: nodeByUid.get(targetUid)!,
    }));

    return { simNodes, simLinks };
  }, [filteredPersons, filteredPersonUids, data, movieById, artistById]);

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

      const baseColor =
        node.kind === "person" ? PERSON_COLOR : node.kind === "movie" ? MOVIE_COLOR : ARTIST_COLOR;

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

  const existingRoles = useMemo(() => {
    if (!data) return new Set<CastRole>();
    const roles = new Set<CastRole>();
    for (const p of data.persons) for (const r of p.movie_roles) roles.add(r as CastRole);
    return roles;
  }, [data]);

  // All searchable items across all three kinds
  const searchPool = useMemo((): SearchResult[] => {
    if (!data) return [];
    const results: SearchResult[] = [];
    for (const p of data.persons) results.push({ uid: `p-${p.id}`, label: p.name, kind: "person", id_: p.id });
    for (const m of data.movies) results.push({ uid: `m-${m.id}`, label: m.name, kind: "movie", id_: m.id });
    for (const a of data.artists) results.push({ uid: `a-${a.id}`, label: a.name, kind: "artist", id_: a.id });
    return results;
  }, [data]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return searchPool
      .filter((r) => {
        if (searchKind !== "all" && r.kind !== searchKind) return false;
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
    if (!selected || !data || !selected.startsWith("p-")) return [];
    const personId = parseInt(selected.slice(2));
    const visibleHubs = new Set(nodesRef.current.filter((n) => n.kind !== "person").map((n) => n.uid));
    return data.edges
      .filter((e) => e.person_id === personId)
      .map((e) => {
        const hubUid = e.target_type === "movie" ? `m-${e.target_id}` : `a-${e.target_id}`;
        if (!visibleHubs.has(hubUid)) return null;
        return {
          uid: hubUid,
          label: e.target_type === "movie"
            ? (movieById.get(e.target_id) ?? String(e.target_id))
            : (artistById.get(e.target_id) ?? String(e.target_id)),
          kind: e.target_type as "movie" | "artist",
          id_: e.target_id,
        };
      })
      .filter(Boolean) as Array<{ uid: string; label: string; kind: "movie" | "artist"; id_: number }>;
  }, [selected, data, movieById, artistById, simNodes]);

  // For a selected hub: list the visible people connected to it
  const hubConnections = useMemo(() => {
    if (!selected || !data || selected.startsWith("p-")) return [];
    const visiblePersonUids = new Set(nodesRef.current.filter((n) => n.kind === "person").map((n) => n.uid));
    return data.edges
      .filter((e) => {
        const hubUid = e.target_type === "movie" ? `m-${e.target_id}` : `a-${e.target_id}`;
        return hubUid === selected && visiblePersonUids.has(`p-${e.person_id}`);
      })
      .map((e) => {
        const person = personById.get(e.person_id);
        return person ? { uid: `p-${e.person_id}`, label: person.name, id_: e.person_id } : null;
      })
      .filter(Boolean) as Array<{ uid: string; label: string; id_: number }>;
  }, [selected, data, personById, simNodes]);

  // ─── Legend ──────────────────────────────────────────────────────────────

  const Legend = () => (
    <div style={{ display: "flex", gap: "1rem", fontSize: "0.78rem", opacity: 0.7 }}>
      {([["Person", PERSON_COLOR], ["Movie", MOVIE_COLOR], ["Artist", ARTIST_COLOR]] as const).map(([label, color]) => (
        <span key={label} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: color }} />
          {label}
        </span>
      ))}
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  const selectedPerson = selected?.startsWith("p-") ? personById.get(parseInt(selected.slice(2))) : null;
  const selectedHub = selected && !selected.startsWith("p-") ? selectedNode : null;

  const KIND_LABELS: Record<SearchKind, string> = { all: "All", person: "People", movie: "Movies", artist: "Artists" };
  const KIND_COLORS: Partial<Record<SearchKind, string>> = { person: PERSON_COLOR, movie: MOVIE_COLOR, artist: ARTIST_COLOR };

  const overlayMessage = isLoading ? "Loading…"
    : isError ? "Failed to load graph."
    : data && data.persons.length === 0 ? "No people to display."
    : null;

  return (
    <section>
      {/* Filter + search bar — hidden until data is ready */}
      <div style={{ display: overlayMessage ? "none" : "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.75rem", alignItems: "flex-start", fontSize: "0.875rem" }}>
        {/* Movie people filter */}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 500, cursor: "pointer" }}>
            <input type="checkbox" checked={filterMoviePerson} onChange={(e) => setFilterMoviePerson(e.target.checked)} />
            Movie people
          </label>
          {filterMoviePerson && (
            <div style={{ marginLeft: "1.4rem", marginTop: "0.3rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              {CAST_ROLES.filter((r) => existingRoles.has(r)).map((role) => (
                <label key={role} style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", opacity: 0.85 }}>
                  <input type="checkbox" checked={filterMovieRoles.has(role)} onChange={() => toggleRole(role)} />
                  {ROLE_LABELS[role]}
                </label>
              ))}
              {filterMovieRoles.size > 0 && (
                <button onClick={() => setFilterMovieRoles(new Set())}
                  style={{ alignSelf: "flex-start", marginTop: "0.2rem", fontSize: "0.78rem", opacity: 0.55, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  clear roles
                </button>
              )}
            </div>
          )}
        </div>

        {/* Music artist filter */}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 500, cursor: "pointer" }}>
            <input type="checkbox" checked={filterMusicArtist} onChange={(e) => setFilterMusicArtist(e.target.checked)} />
            Music artists
          </label>
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginLeft: "auto" }}>
          {/* Type filter pills */}
          <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.3rem", justifyContent: "flex-end" }}>
            {(["all", "person", "movie", "artist"] as SearchKind[]).map((k) => (
              <button key={k} onClick={() => setSearchKind(k)}
                style={{
                  fontSize: "0.72rem", padding: "0.15rem 0.5rem", borderRadius: 10,
                  border: `1px solid ${KIND_COLORS[k] ?? "#8884"}`,
                  background: searchKind === k ? (KIND_COLORS[k] ?? "#8884") : "transparent",
                  color: searchKind === k ? "#fff" : undefined,
                  cursor: "pointer", opacity: searchKind === k ? 1 : 0.6,
                }}>
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <input
            type="search"
            placeholder={`Search ${KIND_LABELS[searchKind].toLowerCase()}…`}
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
                  <span style={{
                    display: "inline-block", width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                    background: r.kind === "person" ? PERSON_COLOR : r.kind === "movie" ? MOVIE_COLOR : ARTIST_COLOR,
                  }} />
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
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5, pointerEvents: "none" }}>
            {overlayMessage}
          </div>
        )}
      </div>

      {/* Info panel — person selected */}
      {selectedPerson && (
        <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", border: "1px solid #8884", borderRadius: 6, fontSize: "0.875rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "0.5rem" }}>
            <strong style={{ fontSize: "1rem" }}>{selectedPerson.name}</strong>
            <Link to={`/people/${selectedPerson.id}`} style={{ opacity: 0.6, fontSize: "0.8rem" }}>view profile →</Link>
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
                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: conn.kind === "movie" ? MOVIE_COLOR : ARTIST_COLOR }} />
                  <span style={{ opacity: 0.55, fontSize: "0.78rem" }}>{conn.kind}</span>
                  <button onClick={() => selectNode(conn.uid)}
                    style={{ fontWeight: 500, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "inherit" }}>
                    {conn.label}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info panel — hub (movie/artist) selected */}
      {selectedHub && (
        <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", border: "1px solid #8884", borderRadius: 6, fontSize: "0.875rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "0.5rem" }}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: selectedHub.kind === "movie" ? MOVIE_COLOR : ARTIST_COLOR, flexShrink: 0, alignSelf: "center" }} />
            <strong style={{ fontSize: "1rem" }}>{selectedHub.label}</strong>
            <Link
              to={selectedHub.kind === "movie" ? `/movies/${selectedHub.id_}` : `/music/artists/${selectedHub.id_}`}
              style={{ opacity: 0.6, fontSize: "0.8rem" }}>
              view {selectedHub.kind} →
            </Link>
            <button onClick={() => centerOn(selected!)}
              style={{ marginLeft: "auto", opacity: 0.5, background: "none", border: "none", cursor: "pointer", fontSize: "0.78rem" }}>
              center
            </button>
          </div>
          {hubConnections.length === 0 ? (
            <p style={{ opacity: 0.5, margin: 0 }}>No visible people connected.</p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1.2rem" }}>
              {hubConnections.map((conn) => (
                <button key={conn.uid} onClick={() => selectNode(conn.uid)}
                  style={{ fontWeight: 500, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "inherit" }}>
                  {conn.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
