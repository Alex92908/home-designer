/**
 * poissonDisc.ts — Poisson Disc Sampling for procedural vegetation.
 *
 * Generates a set of 2-D points that are:
 *   • At least `minDist` apart from every other point (no clumping)
 *   • Distributed pseudo-randomly (not on a grid — looks "grown", not "placed")
 *
 * Used in PrefabRenderer to fill FarmBox beds and lawn areas with plants.
 * Algorithm: Bridson's fast Poisson-disc sampling (O(n)).
 *
 * Coordinate system: local metres, origin = polygon centroid.
 */

export interface Point2 { x: number; z: number }

/**
 * Generate Poisson-disc points inside an axis-aligned rectangle.
 *
 * @param w         Rectangle half-width (metres)
 * @param d         Rectangle half-depth (metres)
 * @param minDist   Minimum distance between any two points (metres)
 * @param seed      Deterministic seed (integer) so the same prefab
 *                  always produces the same plant layout
 * @returns Array of {x, z} points in [-w, w] × [-d, d]
 */
export function poissonRect(
  w: number,
  d: number,
  minDist: number,
  seed = 42,
): Point2[] {
  // ── Seeded LCG pseudo-random ─────────────────────────────────────
  let s = seed >>> 0;
  function rand(): number {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  }

  const W = w * 2, D = d * 2;       // full rectangle size
  const cellSize = minDist / Math.SQRT2;
  const cols = Math.ceil(W / cellSize);
  const rows = Math.ceil(D / cellSize);

  // Background grid — stores index+1 of the point in that cell (0 = empty)
  const grid = new Int32Array(cols * rows);
  const points: Point2[] = [];
  const active: number[] = [];      // indices into `points`

  function gridIdx(px: number, pz: number): number {
    const c = Math.floor((px + w) / cellSize);
    const r = Math.floor((pz + d) / cellSize);
    return r * cols + c;
  }

  function addPoint(px: number, pz: number): void {
    const idx = points.length;
    points.push({ x: px, z: pz });
    active.push(idx);
    grid[gridIdx(px, pz)] = idx + 1;
  }

  // Seed with a random point inside the rectangle
  addPoint((rand() - 0.5) * W, (rand() - 0.5) * D);

  const K = 30; // max attempts per active point
  while (active.length > 0) {
    const ai = (rand() * active.length) | 0;
    const pi = active[ai];
    const p  = points[pi];
    let found = false;

    for (let k = 0; k < K; k++) {
      // Random point in annulus [minDist, 2*minDist]
      const angle = rand() * Math.PI * 2;
      const r     = minDist * (1 + rand());
      const qx    = p.x + Math.cos(angle) * r;
      const qz    = p.z + Math.sin(angle) * r;

      if (qx < -w || qx > w || qz < -d || qz > d) continue;

      // Check against neighbouring grid cells
      const gc = Math.floor((qx + w) / cellSize);
      const gr = Math.floor((qz + d) / cellSize);
      let tooClose = false;

      outer: for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = gr + dr, nc = gc + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const ni = grid[nr * cols + nc];
          if (!ni) continue;
          const n = points[ni - 1];
          const dx = n.x - qx, dz = n.z - qz;
          if (dx * dx + dz * dz < minDist * minDist) { tooClose = true; break outer; }
        }
      }

      if (!tooClose) { addPoint(qx, qz); found = true; break; }
    }

    if (!found) active.splice(ai, 1);
  }

  return points;
}

/**
 * Generate Poisson-disc points clipped to a convex polygon.
 * Points outside the polygon are discarded after generation.
 *
 * @param polygon  Array of [x, z] vertices (metres, closed polygon)
 * @param minDist  Minimum distance between points
 * @param seed     Deterministic seed
 */
export function poissonPolygon(
  polygon: Array<[number, number]>,
  minDist: number,
  seed = 42,
): Point2[] {
  if (polygon.length < 3) return [];

  // Compute AABB
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const hw = (maxX - minX) / 2, hd = (maxZ - minZ) / 2;

  const candidates = poissonRect(hw, hd, minDist, seed);

  // Point-in-polygon (ray casting)
  function inside(px: number, pz: number): boolean {
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, zi] = polygon[i];
      const [xj, zj] = polygon[j];
      if ((zi > pz) !== (zj > pz) &&
          px < (xj - xi) * (pz - zi) / (zj - zi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  return candidates
    .map(p => ({ x: p.x + cx, z: p.z + cz }))
    .filter(p => inside(p.x, p.z));
}
