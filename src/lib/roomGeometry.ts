/**
 * Polygon helpers for non-rectangular rooms (L 型 / 凸字型 / etc.).
 *
 * Coordinate conventions (matches PlacedItem.x/z):
 *  - cm units
 *  - room's back-left corner is the origin (0, 0)
 *  - +x goes right, +z goes "forward / toward the front wall"
 *  - polygon points are CCW when viewed from above
 *
 * When `RoomShape` is absent, the room is treated as a plain rectangle
 * of `{ 0..width, 0..depth }`, which is what every part of the app
 * already assumes today.
 */

export type ShapePreset = "rect" | "l-shape" | "convex" | "custom";

export interface RoomShape {
  preset: ShapePreset;
  /** CCW polygon, cm, origin at room back-left. */
  points: Array<[number, number]>;
}

/** Plain rectangle for the given dims (fallback / "rect" preset). */
export function rectShape(width: number, depth: number): RoomShape {
  return {
    preset: "rect",
    points: [[0, 0], [width, 0], [width, depth], [0, depth]],
  };
}

/** L-shape: bite a 40% × 40% chunk out of the front-right corner.
 *
 *  ┌────────────────┐
 *  │                │
 *  │                │
 *  │      ┌─────────┤
 *  │      │
 *  └──────┘
 */
export function lShape(width: number, depth: number): RoomShape {
  const biteW = width * 0.4;
  const biteD = depth * 0.4;
  return {
    preset: "l-shape",
    points: [
      [0, 0],
      [width, 0],
      [width, depth - biteD],
      [width - biteW, depth - biteD],
      [width - biteW, depth],
      [0, depth],
    ],
  };
}

/** 凸字型: middle bump out on the front. 25% inset on each side, 25% extra depth in the middle.
 *
 *  ┌────────────────┐
 *  │                │
 *  │                │
 *  │                │
 *  └──┐          ┌──┘
 *     │          │
 *     └──────────┘
 */
export function convexShape(width: number, depth: number): RoomShape {
  const inset = width * 0.25;
  const bump  = depth * 0.25;
  return {
    preset: "convex",
    points: [
      [0, 0],
      [width, 0],
      [width, depth],
      [width - inset, depth],
      [width - inset, depth + bump],
      [inset, depth + bump],
      [inset, depth],
      [0, depth],
    ],
  };
}

/** Build a preset polygon for the given dims. */
export function buildShape(preset: ShapePreset, width: number, depth: number): RoomShape {
  switch (preset) {
    case "l-shape": return lShape(width, depth);
    case "convex":  return convexShape(width, depth);
    case "rect":
    default:        return rectShape(width, depth);
  }
}

/** Bounding box of a polygon, cm. */
export function polygonBounds(points: Array<[number, number]>) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  return { minX, maxX, minZ, maxZ };
}

/** Ray-cast point-in-polygon (returns true if (x,z) is inside pts). */
export function pointInPolygon(pts: Array<[number, number]>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    const intersects = (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// ─── Edge helpers (for placing doors/windows on polygon walls) ──

export type WallFacing = "back" | "front" | "left" | "right";

export interface EdgeInfo {
  /** Index into `points` of this edge's start vertex. */
  i: number;
  x1: number; z1: number;      // start (cm)
  x2: number; z2: number;      // end   (cm)
  length: number;              // cm
  /** Inward-facing unit normal (CCW polygon). */
  nx: number; nz: number;
  /** Which cardinal wall this edge faces (by dominant outward-normal axis). */
  facing: WallFacing;
}

export function getEdges(points: Array<[number, number]>): EdgeInfo[] {
  const edges: EdgeInfo[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    const dx = x2 - x1, dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 1e-3) continue;
    // CCW polygon ⇒ inward normal is 90° left of direction: (-dz, dx)/len
    const nx = -dz / length;
    const nz =  dx / length;
    const ox = -nx, oz = -nz;    // outward normal
    let facing: WallFacing;
    if (Math.abs(ox) >= Math.abs(oz)) facing = ox > 0 ? "right" : "left";
    else                              facing = oz > 0 ? "front" : "back";
    edges.push({ i, x1, z1, x2, z2, length, nx, nz, facing });
  }
  return edges;
}

/** Map the user's "back/front/left/right" door wall (cm offset along that
 *  wall, measured from the conventional "start") onto a polygon edge +
 *  offset along that edge. Returns null if no matching polygon edge
 *  contains the requested span. `bbox` is the room's bounding box. */
export function findEdgeForWall(
  points: Array<[number, number]>,
  wall: WallFacing,
  posCm: number,
  lenCm: number,
  bbox: { maxX: number; maxZ: number },
  edgeIndexHint?: number,
): { edgeIndex: number; startCm: number; edge: EdgeInfo } | null {
  const edges = getEdges(points);

  // Explicit hint path: caller knows exactly which polygon edge owns this
  // hole, and `posCm` is already in edge-local coords (cm from edge start).
  // Used for inner-corner walls of L / convex rooms that the cardinal
  // bbox-projection scheme below can't reach.
  if (edgeIndexHint != null) {
    const e = edges.find(x => x.i === edgeIndexHint);
    if (e && posCm >= -1 && posCm + lenCm <= e.length + 1) {
      return { edgeIndex: e.i, startCm: Math.max(0, posCm), edge: e };
    }
    // Fall through to legacy lookup if the hint is stale (e.g. polygon was
    // edited and the indexed edge no longer exists / is too short).
  }

  // Legacy: project the (wall, posCm) tuple to a world point on the bbox
  // perimeter, then find the polygon edge whose line passes through it.
  //   back:  (posCm, 0)           running +x
  //   right: (maxX,  posCm)       running +z
  //   front: (posCm, maxZ)        running +x
  //   left:  (0,     posCm)       running +z
  let wx: number, wz: number;
  if (wall === "back")       { wx = posCm;         wz = 0; }
  else if (wall === "front") { wx = posCm;         wz = bbox.maxZ; }
  else if (wall === "right") { wx = bbox.maxX;     wz = posCm; }
  else                       { wx = 0;             wz = posCm; }

  const candidates = edges.filter(e => e.facing === wall);
  for (const e of candidates) {
    const dx = e.x2 - e.x1, dz = e.z2 - e.z1;
    const t = ((wx - e.x1) * dx + (wz - e.z1) * dz) / e.length;
    const perpDist = Math.abs((wx - e.x1) * e.nx + (wz - e.z1) * e.nz);
    if (perpDist < 2 && t >= -1 && t + lenCm <= e.length + 1) {
      return { edgeIndex: e.i, startCm: Math.max(0, t), edge: e };
    }
  }
  return null;
}

/** Shape picker label / icon for UI. */
export const SHAPE_PRESETS: Array<{ preset: ShapePreset; name: string; icon: string }> = [
  { preset: "rect",    name: "矩形",  icon: "▭" },
  { preset: "l-shape", name: "L型",   icon: "⌐" },
  { preset: "convex",  name: "凸字型", icon: "⎍" },
];
