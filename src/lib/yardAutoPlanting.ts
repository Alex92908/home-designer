/**
 * yardAutoPlanting — auto-scatter trees over empty yard areas with
 * proper canopy spacing (§6.6 in docs/yard-design-references.md).
 *
 * Uses `poissonDisc.ts` (Bridson) for the placement so the result looks
 * "grown", not gridded. Min-distance per sample = 2 × tree canopy radius
 * so adjacent crowns barely touch but don't overlap — the same rule a
 * landscape architect applies.
 *
 * Avoidance: house bbox, existing zone polygons (planting should stay in
 * lawn / open ground), and any already-placed tree (don't double up on
 * user-curated specimens).
 */

import type { YardItem, YardZone, YardSingleton } from "./types";
import { isYardZone, isYardSingleton } from "./types";
import { poissonRect } from "./poissonDisc";

/** Mature canopy radius (metres) per tree kind. Used both for spacing
 *  (Poisson minDist = 2 × radius) and as the "watering ring" UI hint.
 *  Numbers tuned to ASLA standard mature spread / 2. */
export const TREE_CANOPY_RADIUS_M: Record<string, number> = {
  "tree.apple":   3.0,
  "tree.birch":   3.5,
  "tree.bonsai":  0.8,
  "tree.cypress": 2.0,
  "tree.maple":   5.0,
  "tree.oak":     7.0,
  "tree.olive":   4.0,
  "tree.palm":    3.0,
  "tree.pine":    4.5,
};

/** Tree kinds eligible for auto-scatter, with a relative weight that
 *  biases the random choice. Smaller / ornamental trees are weighted
 *  higher so the auto result doesn't become a forest of giant oaks. */
// Oak (r=7m) is too big for auto-scatter spacing — it forces an
// 11+ m sep against any neighbour and produces near-empty yards. Drop
// it from the rotation; users can place specimen oaks manually.
const SCATTER_KINDS: Array<{ kind: string; weight: number }> = [
  { kind: "tree.birch",   weight: 3 },
  { kind: "tree.apple",   weight: 2 },
  { kind: "tree.cypress", weight: 2 },
  { kind: "tree.maple",   weight: 1 },
  { kind: "tree.pine",    weight: 1 },
  { kind: "tree.olive",   weight: 1 },
];

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

function pointInPoly(p: [number, number], poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) &&
        p[0] < (xj - xi) * (p[1] - zi) / (zj - zi + 1e-9) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function absPolygon(zone: YardZone): Array<[number, number]> {
  return zone.polygon.map(([px, pz]) => [zone.x + px, zone.z + pz] as [number, number]);
}

/** Weighted random choice from SCATTER_KINDS using rng() in [0,1). */
function pickKind(rng: () => number): string {
  const total = SCATTER_KINDS.reduce((s, k) => s + k.weight, 0);
  let r = rng() * total;
  for (const k of SCATTER_KINDS) {
    r -= k.weight;
    if (r <= 0) return k.kind;
  }
  return SCATTER_KINDS[0].kind;
}

/**
 * Generate a list of new tree singletons to add. Coords are in cm
 * (matches YardItem.x / z), origin = house center on the ground plane.
 *
 * @param items       Current yard items (used to avoid overlap with
 *                    existing zones + existing trees).
 * @param house       House footprint AABB in cm, centered coords.
 * @param lotHalfCm   Yard plan half-extent in cm (default 1500 = ±15 m).
 * @param minSpacingM Override default canopy spacing. Smaller = denser.
 *                    Default 7 m — covers the largest canopy radius in
 *                    SCATTER_KINDS (maple r=5) with a 1 m buffer.
 *                    Lower values produce canopy-overlap warnings.
 * @param maxCount    Cap the number of trees added in one call.
 *                    Default 10 — keeps the result usable, not a forest.
 */
export function autoScatterTrees(
  items: YardItem[],
  house: Box,
  lotHalfCm = 1500,
  minSpacingM = 7,
  maxCount = 10,
): YardSingleton[] {
  const lotHalfM = lotHalfCm / 100;
  // Build avoidance set: house AABB + zone polygons + existing trees' canopy.
  const zones = items.filter(isYardZone);
  const zonePolysM = zones.map(z => absPolygon(z).map(([x, z2]) => [x / 100, z2 / 100] as [number, number]));
  const houseM: Box = {
    minX: house.minX / 100, maxX: house.maxX / 100,
    minZ: house.minZ / 100, maxZ: house.maxZ / 100,
  };
  const existingTrees: Array<{ x: number; z: number; rM: number }> = items
    .filter(isYardSingleton)
    .filter(s => s.kind?.startsWith("tree."))
    .map(s => ({
      x: s.x / 100,
      z: s.z / 100,
      rM: (TREE_CANOPY_RADIUS_M[s.kind] ?? 3) * (s.scale ?? 1),
    }));

  // Sample using minSpacing — Poisson guarantees ≥ minSpacing between any
  // two emitted points; we additionally reject points that fall on the
  // house, inside any zone, or inside an existing canopy.
  const samples = poissonRect(lotHalfM, lotHalfM, minSpacingM, Date.now() & 0xffff);

  const accepted: Array<{ x: number; z: number; kind: string }> = [];
  // Seeded RNG for kind/scale selection (separate from Poisson's RNG)
  let s2 = 1337;
  const rng = () => {
    s2 = (Math.imul(1664525, s2) + 1013904223) >>> 0;
    return s2 / 0xffffffff;
  };

  for (const p of samples) {
    if (accepted.length >= maxCount) break;
    // House avoidance — leave a 2 m setback from house wall
    const HOUSE_PAD = 2.0;
    if (
      p.x >= houseM.minX - HOUSE_PAD && p.x <= houseM.maxX + HOUSE_PAD &&
      p.z >= houseM.minZ - HOUSE_PAD && p.z <= houseM.maxZ + HOUSE_PAD
    ) continue;
    // Zone avoidance — trees go in open ground only
    let inZone = false;
    for (const poly of zonePolysM) {
      if (pointInPoly([p.x, p.z], poly)) { inZone = true; break; }
    }
    if (inZone) continue;
    // Existing-tree canopy avoidance
    let tooCloseToTree = false;
    for (const t of existingTrees) {
      const dx = t.x - p.x, dz = t.z - p.z;
      if (dx * dx + dz * dz < (t.rM + 2) * (t.rM + 2)) { tooCloseToTree = true; break; }
    }
    if (tooCloseToTree) continue;
    accepted.push({ x: p.x, z: p.z, kind: pickKind(rng) });
  }

  // Emit YardSingleton items, coords back to cm.
  return accepted.map((a, i) => ({
    id: `auto-tree-${Date.now()}-${i}`,
    type: "singleton" as const,
    kind: a.kind,
    x: Math.round(a.x * 100),
    z: Math.round(a.z * 100),
    scale: 0.9 + rng() * 0.3, // 0.9 – 1.2 for natural variation
  }));
}
