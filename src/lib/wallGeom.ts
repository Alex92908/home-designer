/**
 * Shared wall-hole geometry helper.
 *
 * Used by both RoomCanvas (single-room effect page) and FloorPlanExterior
 * (walkthrough). Subtracts a set of axis-aligned holes (doors, windows) from
 * a rectangular wall and returns the rectangles that tile the remaining
 * solid wall area. Each piece is rendered as a plane mesh — much cleaner
 * than a single ShapeGeometry with holes (which tessellates oddly and
 * shows triangular bright artefacts near the cutouts).
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Subtract non-overlapping rectangular holes from a wall [0..wallW]×[0..wallH]
 *  and return the rectangles that tile the remaining solid area. */
export function splitWallAroundHoles(
  wallW: number,
  wallH: number,
  holes: Rect[],
): Rect[] {
  const sorted = [...holes].sort((a, b) => a.x - b.x);
  const out: Rect[] = [];
  let cursorX = 0;
  for (const hole of sorted) {
    const hx = Math.max(0, hole.x);
    const hx2 = Math.min(wallW, hole.x + hole.w);
    if (hx2 <= cursorX) continue;
    if (hx > cursorX) {
      // Full-height strip between cursor and hole's left edge
      out.push({ x: cursorX, y: 0, w: hx - cursorX, h: wallH });
    }
    const hy = Math.max(0, hole.y);
    const hy2 = Math.min(wallH, hole.y + hole.h);
    // Strip below hole
    if (hy > 0) {
      out.push({
        x: Math.max(cursorX, hx),
        y: 0,
        w: hx2 - Math.max(cursorX, hx),
        h: hy,
      });
    }
    // Strip above hole
    if (hy2 < wallH) {
      out.push({
        x: Math.max(cursorX, hx),
        y: hy2,
        w: hx2 - Math.max(cursorX, hx),
        h: wallH - hy2,
      });
    }
    cursorX = Math.max(cursorX, hx2);
  }
  if (cursorX < wallW) {
    out.push({ x: cursorX, y: 0, w: wallW - cursorX, h: wallH });
  }
  return out;
}
