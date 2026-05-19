/**
 * yardAutoLayout — auto-generate walkway paths between zones and the
 * house. The first slice of docs/yard-design-references.md §6.4
 * auto-layout pipeline; only the path inference step is implemented
 * here. Zone generation already lives in outdoorAssets.ts as static
 * preset templates.
 *
 * Algorithm — for each non-lawn zone:
 *   1. compute zone centroid (representative point inside the polygon)
 *   2. find the nearest house wall edge midpoint
 *   3. build an orthogonal Manhattan path from centroid → edge midpoint
 *      that turns at most once and avoids passing through other zones
 *      (best-effort; if a clean L-shape isn't found, fall back to a
 *      straight line)
 *   4. emit a YardPath with sensible width + material per zone kind
 *
 * Coords are in centimetres, centered on the house origin — same as
 * YardZone polygon (absolute, after the zone's x/z offset is applied
 * to its polygon points).
 */

import type { YardItem, YardZone } from "./types";
import { isYardZone } from "./types";

export type AutoPath = {
  id: string;
  points: Array<[number, number]>;
  widthCm: number;
  material: "stone" | "gravel" | "grass" | "brick";
};

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Build a YardZone's absolute-coord polygon (zone.polygon is relative to zone.x/z). */
function absPolygon(zone: YardZone): Array<[number, number]> {
  return zone.polygon.map(([px, pz]) => [zone.x + px, zone.z + pz] as [number, number]);
}

/** Polygon centroid (signed-area weighted). Works for convex + concave. */
function polygonCentroid(pts: Array<[number, number]>): [number, number] {
  if (pts.length === 0) return [0, 0];
  let cx = 0, cz = 0, area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const f = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
    area += f;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-3) {
    // degenerate — fall back to arithmetic mean
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const mz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [mx, mz];
  }
  return [cx / (6 * area), cz / (6 * area)];
}

/** Project (px, pz) to the closest point ON the boundary of the house
 *  AABB. Used as the path's house-side endpoint. */
function nearestHouseEdgePoint(px: number, pz: number, house: Box): [number, number] {
  // Clamp inside the AABB, then snap to the nearest edge.
  const cx = Math.max(house.minX, Math.min(house.maxX, px));
  const cz = Math.max(house.minZ, Math.min(house.maxZ, pz));
  // Already outside on at least one axis → cx/cz already on edge.
  // Inside both axes → push to the closer edge.
  const outsideX = px < house.minX || px > house.maxX;
  const outsideZ = pz < house.minZ || pz > house.maxZ;
  if (outsideX || outsideZ) return [cx, cz];
  // Centroid is INSIDE house (unusual but possible if zone overlaps
  // house — caller probably has a bigger problem). Snap to the edge
  // closest in absolute terms.
  const dLeft   = Math.abs(px - house.minX);
  const dRight  = Math.abs(px - house.maxX);
  const dTop    = Math.abs(pz - house.minZ);
  const dBottom = Math.abs(pz - house.maxZ);
  const m = Math.min(dLeft, dRight, dTop, dBottom);
  if (m === dLeft)   return [house.minX, pz];
  if (m === dRight)  return [house.maxX, pz];
  if (m === dTop)    return [px, house.minZ];
  return [px, house.maxZ];
}

/** True iff segment (a, b) intersects polygon `poly` (as edges or by
 *  having either endpoint strictly inside).
 *  Cheap enough for our handful of zones; avoid for large polygons. */
function segmentIntersectsPolygon(
  a: [number, number],
  b: [number, number],
  poly: Array<[number, number]>,
): boolean {
  if (poly.length < 3) return false;
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    if (segmentsIntersect(a, b, p1, p2)) return true;
  }
  return false;
}

function pointInPolygon(p: [number, number], poly: Array<[number, number]>): boolean {
  // Ray-cast east, count crossings.
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect = ((zi > p[1]) !== (zj > p[1])) &&
      (p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(
  a: [number, number], b: [number, number],
  c: [number, number], d: [number, number],
): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

/** Try two L-shaped paths between p1 and p2:
 *    L-east: (p1) → (p2.x, p1.z) → (p2)
 *    L-west: (p1) → (p1.x, p2.z) → (p2)
 *  Pick whichever has both segments not crossing any blocker polygon.
 *  If neither works, fall back to the direct straight line. */
function buildPath(
  p1: [number, number],
  p2: [number, number],
  blockers: Array<Array<[number, number]>>,
): Array<[number, number]> {
  const corner1: [number, number] = [p2[0], p1[1]];
  const corner2: [number, number] = [p1[0], p2[1]];
  const tryRoute = (corner: [number, number]) => {
    for (const poly of blockers) {
      if (segmentIntersectsPolygon(p1, corner, poly)) return false;
      if (segmentIntersectsPolygon(corner, p2, poly)) return false;
    }
    return true;
  };
  if (tryRoute(corner1)) return [p1, corner1, p2];
  if (tryRoute(corner2)) return [p1, corner2, p2];
  return [p1, p2]; // straight fallback — caller may still want this
}

const PATH_DEFAULTS: Record<YardZone["zoneKind"], { widthCm: number; material: AutoPath["material"] } | null> = {
  social:  { widthCm: 100, material: "stone"  },
  private: { widthCm:  80, material: "stone"  },
  utility: { widthCm: 120, material: "gravel" },
  agro:    { widthCm:  60, material: "brick"  },
  lawn:    null, // no path generated; lawn is traversed via mown corridors
};

/** Snap to nearest 25 cm — keeps generated paths consistent with the
 *  manual-draw grid (`SNAP_CM = 25` in YardPlan.tsx). */
function snap25(v: number): number {
  return Math.round(v / 25) * 25;
}

function snapPt(p: [number, number]): [number, number] {
  return [snap25(p[0]), snap25(p[1])];
}

/**
 * Public entry — generate one path per non-lawn zone from its centroid
 * to the nearest house edge. Returns an array suitable for
 * `addYardPath(...)` calls.
 *
 * Skips zones whose centroid is inside the house (data error — would
 * generate a degenerate zero-length path). Also skips lawn zones
 * (decoratively traversed, not walked).
 */
export function autoGenerateYardPaths(
  items: YardItem[],
  house: Box,
): AutoPath[] {
  const zones = items.filter(isYardZone);
  const out: AutoPath[] = [];
  const allPolys = zones.map(absPolygon);

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const cfg = PATH_DEFAULTS[zone.zoneKind];
    if (!cfg) continue; // lawn → no path

    const poly = allPolys[i];
    const centroid = polygonCentroid(poly);
    // Skip if centroid is inside the house (zone overlap with house —
    // bad data; auto-path can't help).
    if (
      centroid[0] >= house.minX && centroid[0] <= house.maxX &&
      centroid[1] >= house.minZ && centroid[1] <= house.maxZ
    ) {
      continue;
    }
    const houseEnd = nearestHouseEdgePoint(centroid[0], centroid[1], house);
    // Push the house-side endpoint 30 cm OUTWARD from the wall so the
    // path renders just outside the house outline, not on top of it.
    const OUT = 30;
    const dx = centroid[0] - houseEnd[0];
    const dz = centroid[1] - houseEnd[1];
    const len = Math.hypot(dx, dz) || 1;
    const houseEndOut: [number, number] = [
      houseEnd[0] + (dx / len) * OUT,
      houseEnd[1] + (dz / len) * OUT,
    ];

    // Blockers: every OTHER zone's polygon (skip self).
    const blockers = allPolys.filter((_, k) => k !== i);
    const route = buildPath(snapPt(houseEndOut), snapPt(centroid), blockers);
    if (route.length < 2) continue;
    out.push({
      id: `auto-${zone.id}-${Date.now()}-${i}`,
      points: route,
      widthCm: cfg.widthCm,
      material: cfg.material,
    });
  }
  return out;
}
