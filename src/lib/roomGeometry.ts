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

/** Shape picker label / icon for UI. */
export const SHAPE_PRESETS: Array<{ preset: ShapePreset; name: string; icon: string }> = [
  { preset: "rect",    name: "矩形",  icon: "▭" },
  { preset: "l-shape", name: "L型",   icon: "⌐" },
  { preset: "convex",  name: "凸字型", icon: "⎍" },
];
