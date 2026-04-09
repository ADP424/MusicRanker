import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { CastRole, GraphPerson, PersonGraph } from "../api/types";
import { CAST_ROLES } from "../api/types";

// ─── Force layout ──────────────────────────────────────────────────────────

const NODE_R = 28;
const ITERATIONS = 300;
const REPULSION = 6000;
const SPRING_LEN = 200;
const SPRING_K = 0.04;
const DAMPING = 0.85;

interface Pos { x: number; y: number }

function forceLayout(
  nodeIds: number[],
  edges: Array<{ a: number; b: number }>,
): Map<number, Pos> {
  if (nodeIds.length === 0) return new Map();

  const pos = new Map<number, Pos>();
  nodeIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / nodeIds.length;
    const r = 150 + nodeIds.length * 8;
    pos.set(id, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
  });

  const vel = new Map<number, Pos>(nodeIds.map((id) => [id, { x: 0, y: 0 }]));

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const force = new Map<number, Pos>(nodeIds.map((id) => [id, { x: 0, y: 0 }]));

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = nodeIds[i], b = nodeIds[j];
        const pa = pos.get(a)!, pb = pos.get(b)!;
        const dx = pa.x - pb.x, dy = pa.y - pb.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const mag = REPULSION / (dist * dist);
        const fx = (dx / dist) * mag, fy = (dy / dist) * mag;
        force.get(a)!.x += fx; force.get(a)!.y += fy;
        force.get(b)!.x -= fx; force.get(b)!.y -= fy;
      }
    }

    for (const { a, b } of edges) {
      const pa = pos.get(a), pb = pos.get(b);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const mag = SPRING_K * (dist - SPRING_LEN);
      const fx = (dx / dist) * mag, fy = (dy / dist) * mag;
      force.get(a)!.x += fx; force.get(a)!.y += fy;
      force.get(b)!.x -= fx; force.get(b)!.y -= fy;
    }

    for (const id of nodeIds) {
      const v = vel.get(id)!;
      const f = force.get(id)!;
      v.x = (v.x + f.x) * DAMPING;
      v.y = (v.y + f.y) * DAMPING;
      const p = pos.get(id)!;
      p.x += v.x;
      p.y += v.y;
    }
  }

  let minX = Infinity, minY = Infinity;
  for (const p of pos.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
  for (const p of pos.values()) { p.x -= minX - NODE_R * 2; p.y -= minY - NODE_R * 2; }

  return pos;
}

// ─── Edge tooltip ──────────────────────────────────────────────────────────

function edgeLabel(
  via_movie_ids: number[],
  via_artist_ids: number[],
  movies: Record<number, string>,
  artists: Record<number, string>,
): string {
  const parts: string[] = [];
  via_movie_ids.forEach((id) => { if (movies[id]) parts.push(movies[id]); });
  via_artist_ids.forEach((id) => { if (artists[id]) parts.push(artists[id]); });
  return parts.join(", ");
}

// ─── Role label ────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<CastRole, string> = {
  director: "Director",
  composer: "Composer",
  lead_actor: "Lead actor",
  actor: "Actor",
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

  if (!filters.moviePerson && !filters.musicArtist) return true; // no filter active

  if (filters.moviePerson && hasMovies) {
    // If specific role checkboxes are checked, require at least one match
    if (filters.movieRoles.size > 0) {
      if (person.movie_roles.some((r) => filters.movieRoles.has(r))) return true;
    } else {
      return true;
    }
  }
  if (filters.musicArtist && hasMusic) return true;

  return false;
}

// ─── Main component ─────────────────────────────────────────────────────────

export function PeopleGraphPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["people", "graph"],
    queryFn: () => api.get<PersonGraph>("/persons/graph"),
  });

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(false);
  const moved = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [selected, setSelected] = useState<number | null>(null);

  // Filters
  const [filterMoviePerson, setFilterMoviePerson] = useState(false);
  const [filterMovieRoles, setFilterMovieRoles] = useState<Set<CastRole>>(new Set());
  const [filterMusicArtist, setFilterMusicArtist] = useState(false);

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

  // Filtered persons
  const filteredPersons = useMemo(() => {
    if (!data) return [];
    return data.persons.filter((p) => personPassesFilter(p, filters));
  }, [data, filterMoviePerson, filterMovieRoles, filterMusicArtist]);

  const filteredPersonIds = useMemo(() => new Set(filteredPersons.map((p) => p.id)), [filteredPersons]);

  // Only edges where both endpoints are in the filtered set
  const filteredEdges = useMemo(() => {
    if (!data) return [];
    return data.edges.filter(
      (e) => filteredPersonIds.has(e.person_a) && filteredPersonIds.has(e.person_b),
    );
  }, [data, filteredPersonIds]);

  // Compute layout based on filtered persons/edges
  const { positions, canvasW, canvasH } = useMemo(() => {
    const nodeIds = filteredPersons.map((p) => p.id);
    const simEdges = filteredEdges.map((e) => ({ a: e.person_a, b: e.person_b }));
    const positions = forceLayout(nodeIds, simEdges);
    let maxX = 0, maxY = 0;
    for (const p of positions.values()) {
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { positions, canvasW: maxX + NODE_R * 3, canvasH: maxY + NODE_R * 3 };
  }, [filteredPersons, filteredEdges]);

  // Nodes/edges connected to selected (only within filtered set)
  const connectedIds = useMemo(() => {
    if (selected === null || !data) return null;
    if (!filteredPersonIds.has(selected)) return null;
    const ids = new Set<number>([selected]);
    for (const e of filteredEdges) {
      if (e.person_a === selected || e.person_b === selected) {
        ids.add(e.person_a);
        ids.add(e.person_b);
      }
    }
    return ids;
  }, [selected, filteredEdges, filteredPersonIds]);

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
    setZoom((z) => Math.max(0.15, Math.min(4, z - e.deltaY * 0.001)));
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

  // Determine which roles actually exist in the data
  const existingRoles = useMemo(() => {
    if (!data) return new Set<CastRole>();
    const roles = new Set<CastRole>();
    for (const p of data.persons) {
      for (const r of p.movie_roles) roles.add(r as CastRole);
    }
    return roles;
  }, [data]);

  if (isLoading) return <section><p>Loading…</p></section>;
  if (isError || !data) return <section><p>Failed to load graph.</p></section>;

  if (data.persons.length === 0) {
    return <section><p style={{ opacity: 0.5 }}>No people to display.</p></section>;
  }

  const personById = new Map(data.persons.map((p) => [p.id, p]));

  return (
    <section>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.75rem", alignItems: "flex-start", fontSize: "0.875rem" }}>
        {/* Movie people filter */}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 500, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={filterMoviePerson}
              onChange={(e) => setFilterMoviePerson(e.target.checked)}
            />
            Movie people
          </label>
          {filterMoviePerson && (
            <div style={{ marginLeft: "1.4rem", marginTop: "0.3rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              {CAST_ROLES.filter((r) => existingRoles.has(r)).map((role) => (
                <label key={role} style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", opacity: 0.85 }}>
                  <input
                    type="checkbox"
                    checked={filterMovieRoles.has(role)}
                    onChange={() => toggleRole(role)}
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
              {filterMovieRoles.size > 0 && (
                <button
                  onClick={() => setFilterMovieRoles(new Set())}
                  style={{ alignSelf: "flex-start", marginTop: "0.2rem", fontSize: "0.78rem", opacity: 0.55, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  clear roles
                </button>
              )}
            </div>
          )}
        </div>

        {/* Music artist filter */}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 500, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={filterMusicArtist}
              onChange={(e) => setFilterMusicArtist(e.target.checked)}
            />
            Music artists
          </label>
        </div>

        {/* Count */}
        <span style={{ opacity: 0.45, alignSelf: "center", marginLeft: "auto" }}>
          {filteredPersons.length} / {data.persons.length} people
        </span>
      </div>

      <div
        className="genre-tree-canvas"
        style={{ height: "78vh" }}
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
            width: canvasW,
            height: canvasH,
          }}
        >
          {/* SVG edge layer */}
          <svg
            style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
            width={canvasW}
            height={canvasH}
          >
            {filteredEdges.map((edge) => {
              const pa = positions.get(edge.person_a);
              const pb = positions.get(edge.person_b);
              if (!pa || !pb) return null;
              const hl =
                connectedIds !== null &&
                connectedIds.has(edge.person_a) &&
                connectedIds.has(edge.person_b);
              const dm = connectedIds !== null && !hl;
              const x1 = pa.x, y1 = pa.y, x2 = pb.x, y2 = pb.y;
              const label = edgeLabel(
                edge.via_movie_ids,
                edge.via_artist_ids,
                data.movies,
                data.artists,
              );
              return (
                <line
                  key={`${edge.person_a}-${edge.person_b}`}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="currentColor"
                  strokeOpacity={dm ? 0.06 : hl ? 0.7 : 0.18}
                  strokeWidth={hl ? 2 : 1.5}
                >
                  <title>{label}</title>
                </line>
              );
            })}
          </svg>

          {/* Node layer */}
          {filteredPersons.map((person) => {
            const p = positions.get(person.id);
            if (!p) return null;
            const isSelected = selected === person.id;
            const isConnected = connectedIds !== null && connectedIds.has(person.id);
            const isDimmed = connectedIds !== null && !isConnected;
            return (
              <div
                key={person.id}
                style={{
                  position: "absolute",
                  left: p.x - NODE_R,
                  top: p.y - NODE_R,
                  width: NODE_R * 2,
                  height: NODE_R * 2,
                  borderRadius: "50%",
                  border: `1.5px solid ${isSelected ? "currentColor" : "#8884"}`,
                  background: isSelected ? "#8883" : "Canvas",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  fontSize: "0.72rem",
                  fontWeight: isSelected ? 600 : 400,
                  cursor: "default",
                  opacity: isDimmed ? 0.2 : 1,
                  padding: "0.2rem",
                  boxSizing: "border-box",
                  lineHeight: 1.2,
                  userSelect: "none",
                  transition: "opacity 0.15s",
                }}
                onClick={(e) => onNodeClick(person.id, e)}
                title={person.name}
              >
                {person.name}
              </div>
            );
          })}
        </div>
      </div>

      {/* Info panel for selected person */}
      {selected !== null && (() => {
        const person = personById.get(selected);
        if (!person) return null;
        const myEdges = filteredEdges.filter(
          (e) => e.person_a === selected || e.person_b === selected,
        );
        return (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              border: "1px solid #8884",
              borderRadius: 6,
              fontSize: "0.875rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "0.5rem" }}>
              <strong style={{ fontSize: "1rem" }}>{person.name}</strong>
              <Link to={`/people/${person.id}`} style={{ opacity: 0.6, fontSize: "0.8rem" }}>
                view profile →
              </Link>
            </div>
            {myEdges.length === 0 ? (
              <p style={{ opacity: 0.5, margin: 0 }}>No connections.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {myEdges.map((edge) => {
                  const otherId = edge.person_a === selected ? edge.person_b : edge.person_a;
                  const other = personById.get(otherId);
                  const label = edgeLabel(edge.via_movie_ids, edge.via_artist_ids, data.movies, data.artists);
                  return (
                    <li key={otherId} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span
                        style={{ fontWeight: 500, cursor: "pointer" }}
                        onClick={() => setSelected(otherId)}
                      >
                        {other?.name ?? otherId}
                      </span>
                      <span style={{ opacity: 0.55 }}>via {label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })()}
    </section>
  );
}
