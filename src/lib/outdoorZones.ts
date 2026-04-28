/**
 * outdoorZones.ts ── narrative-flow zones for the yard.
 *
 * A Zone is a polygon region with a semantic role (社交核心 / 私密休闲 /
 * 功能配套 / 农作 / 草地). It drives default paving material, allowed
 * prefabs, and visual chrome (border, label) in both 2D and 3D editors.
 *
 * Stored as a YardItem with type:"zone" — see src/lib/types.ts.
 */

import type { ZoneKind } from "./types";

export interface ZoneStyle {
  /** UI label (zh) — shown on the 2D plan and library card. */
  label: string;
  /** Short explanation for tooltip. */
  desc: string;
  /** Default paving material id from textures.ts (procedural). */
  defaultPavingId: string;
  /** Solid hex color for paving fallback when texture unavailable. */
  fallbackColor: string;
  /** 2D plan fill color (semi-transparent overlay). */
  planFill: string;
  /** 2D plan border color. */
  planStroke: string;
  /** Recommended Hero Tree count inside this zone (display hint). */
  heroTreeCount: number;
}

// 2D plan colours tuned for DARK canvas (#0f1117) — strokes lifted to
// brighter pastels so they're visible against the black, fills stay
// translucent. 3D fallback colours unchanged (they target the lit
// outdoor scene, not the SVG plan).
export const ZONE_STYLES: Record<ZoneKind, ZoneStyle> = {
  social: {
    label: "社交核心区",
    desc: "泳池 / BBQ / 下沉卡座 — 紧邻建筑",
    defaultPavingId: "outdoor-travertine",
    fallbackColor: "#C8BBA5",            // 3D travertine wash (warm beige)
    planFill: "rgba(251,191,36,0.10)",   // amber translucent
    planStroke: "#FCD34D",               // bright amber for dark bg
    heroTreeCount: 1,
  },
  private: {
    label: "私密休闲区",
    desc: "凉亭 / 茶座 / 冥想 — 中段过渡",
    defaultPavingId: "outdoor-wood-deck",
    fallbackColor: "#6B4F30",            // 3D teak wood
    planFill: "rgba(217,119,6,0.10)",
    planStroke: "#FB923C",               // warm orange (wood deck)
    heroTreeCount: 1,
  },
  utility: {
    label: "功能配套区",
    desc: "停车 / 入户 / 服务 — 外围",
    defaultPavingId: "outdoor-polished-concrete",
    fallbackColor: "#9A9A95",            // 3D concrete grey
    planFill: "rgba(156,163,175,0.10)",
    planStroke: "#9CA3AF",               // neutral grey
    heroTreeCount: 0,
  },
  agro: {
    label: "菜园 / 抬高床",
    desc: "可食景观 — 草本 / 蔬菜",
    defaultPavingId: "outdoor-crushed-gravel",
    fallbackColor: "#8E7956",            // 3D decomposed granite
    planFill: "rgba(132,204,22,0.10)",
    planStroke: "#A3E635",               // lime green (planting)
    heroTreeCount: 0,
  },
  lawn: {
    label: "草坪",
    desc: "柔过渡，运动 / 阳光",
    defaultPavingId: "outdoor-lawn-turf",
    fallbackColor: "#688F4C",            // 3D mowed lawn
    planFill: "rgba(74,222,128,0.10)",
    planStroke: "#4ADE80",               // bright lawn green
    heroTreeCount: 1,
  },
};

/** Polygon area in cm² — shoelace formula. Used for inspector badges. */
export function polygonArea(pts: Array<[number, number]>): number {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    s += x1 * z2 - x2 * z1;
  }
  return Math.abs(s) / 2;
}

/** Polygon centroid in cm — used to position floating labels. */
export function polygonCentroid(pts: Array<[number, number]>): [number, number] {
  if (pts.length === 0) return [0, 0];
  if (pts.length < 3) return pts[0];
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const cross = x1 * z2 - x2 * z1;
    a += cross;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
  }
  a /= 2;
  if (a === 0) return pts[0];
  return [cx / (6 * a), cz / (6 * a)];
}

/** Axis-aligned bounding box of a polygon (cm). */
export function polygonBounds(pts: Array<[number, number]>): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (pts.length === 0) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** Build a regular rectangular zone polygon centred on (0,0). cm. */
export function rectZone(widthCm: number, depthCm: number): Array<[number, number]> {
  const hw = widthCm / 2, hd = depthCm / 2;
  return [
    [-hw, -hd],
    [ hw, -hd],
    [ hw,  hd],
    [-hw,  hd],
  ];
}
