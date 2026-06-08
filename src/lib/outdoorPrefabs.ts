/**
 * outdoorPrefabs.ts ── Prefab (compound spatial component) registry.
 *
 * A Prefab is a complete spatial composition (社交岛 / 抬高床菜园 / 入户挑檐 /
 * 景墙) that the user can drop as a single one-click block. The prefab's
 * actual mesh is generated procedurally inside PrefabRenderer (R3F),
 * NOT stored as 30 individual YardItems — keeps undo / save lean.
 *
 * Stored as a YardItem with type:"prefab" — see src/lib/types.ts.
 */

import type { PrefabKind } from "./types";

// ─── Param schemas (per kind) ──────────────────────────────────────

export interface SocialIslandParams {
  /** Footprint width × depth in metres. Default 6×4. */
  sizeM?: { w: number; d: number };
  /** Centre fire feature. Default "pit". */
  fireFeature?: "pit" | "table" | "none";
  /** Which way the kitchen counter faces (relative to prefab pivot). */
  kitchenFacing?: "north" | "south" | "east" | "west";
  /** Whether to draw the sunken bench seat ring. Default true. */
  sunkenSeat?: boolean;
}

export interface FarmBoxParams {
  /** How many beds. Default 4. */
  bedCount?: number;
  /** Bed shape arrangement. */
  bedShape?: "rect" | "U";
  /** What gets planted in the beds (visual only). */
  cropMix?: "herbs" | "veggies" | "mixed";
  /** Walking path between beds. Default true. */
  pathBetween?: boolean;
}

export interface PorteCochereParams {
  /** Parking slots covered by the canopy. Default 2. */
  carCount?: 1 | 2 | 3;
  /** Pillar treatment. */
  pillarStyle?: "round" | "square" | "none";
  /** Direction the cars face (relative to prefab pivot). Default "south". */
  facingDir?: "north" | "south" | "east" | "west";
}

export interface SlatWallParams {
  /** Wall length in metres. Default 6. */
  lengthM?: number;
  /** Wall height in metres. Default 1.8. */
  heightM?: number;
  /** Slat width / gap in cm. */
  slatCm?: number;
  gapCm?: number;
  /** Concrete back wall behind the slats. Default true (虚实结合). */
  backWall?: boolean;
}

export interface FenceSegmentParams {
  /** Segment length in metres. Default 4. */
  lengthM?: number;
  /** Fence height in metres. Default 1.8. */
  heightM?: number;
  /** Slat width in cm. Default 5. */
  slatCm?: number;
  /** Gap between slats in cm. Default 2. */
  gapCm?: number;
}

export interface ParkingAreaParams {
  /** Number of parking spots. Default 2. */
  spotCount?: 1 | 2 | 3 | 4;
  /** Orientation — which direction cars face. Default "south". */
  facingDir?: "north" | "south" | "east" | "west";
  /** Include driveway approach strip. Default true. */
  driveway?: boolean;
}

export type PrefabParams =
  | SocialIslandParams
  | FarmBoxParams
  | PorteCochereParams
  | SlatWallParams
  | FenceSegmentParams
  | ParkingAreaParams;

// ─── Registry ──────────────────────────────────────────────────────

export interface PrefabDef<P extends PrefabParams = PrefabParams> {
  kind: PrefabKind;
  /** UI label (zh). */
  label: string;
  /** UI label (en). */
  labelEn: string;
  /** Short description (tooltip). */
  desc: string;
  /** Short description (tooltip, en). */
  descEn: string;
  /** Single-character tag for the 2D plan glyph (≤ 4 chars). */
  glyphTag: string;
  /** Bounding-box footprint in cm — used for the 2D dashed envelope and
   *  for clearance checks. Computed from default params. */
  defaultFootprintCm: { w: number; d: number };
  /** Default params used when user drops via library (no UI for params yet). */
  defaultParams: P;
  /** Library category — drives which tab in the editor lists this prefab. */
  category: "core" | "boundary";
}

export const PREFAB_REGISTRY: PrefabDef[] = [
  {
    kind: "social_island",
    label: "社交岛",
    labelEn: "Social Island",
    desc: "下沉卡座 + 篝火 + 岛台 — 紧邻建筑，社交闭环",
    descEn: "Sunken seating + fire pit + island counter — adjacent, social loop",
    glyphTag: "SOC",
    defaultFootprintCm: { w: 600, d: 400 },
    defaultParams: {
      sizeM: { w: 6, d: 4 },
      fireFeature: "pit",
      kitchenFacing: "south",
      sunkenSeat: true,
    } satisfies SocialIslandParams,
    category: "core",
  },
  {
    kind: "farm_box",
    label: "抬高床菜园",
    labelEn: "Raised-Bed Garden",
    desc: "木质抬高床 + 草本 / 蔬菜 — 可食景观",
    descEn: "Wooden raised beds + herbs / vegetables — edible landscape",
    glyphTag: "AGR",
    defaultFootprintCm: { w: 500, d: 300 },
    defaultParams: {
      bedCount: 4,
      bedShape: "rect",
      cropMix: "herbs",
      pathBetween: true,
    } satisfies FarmBoxParams,
    category: "core",
  },
  {
    kind: "porte_cochere",
    label: "入户挑檐",
    labelEn: "Porte-Cochère",
    desc: "RC 板挑檐 + 隐形车位 — 摒弃独立车棚",
    descEn: "RC canopy + hidden parking — replaces standalone carport",
    glyphTag: "PCH",
    defaultFootprintCm: { w: 600, d: 400 },
    defaultParams: {
      carCount: 2,
      pillarStyle: "round",
      facingDir: "south",
    } satisfies PorteCochereParams,
    category: "core",
  },
  {
    kind: "slat_wall",
    label: "格栅景墙",
    labelEn: "Slat Feature Wall",
    desc: "竖向木格栅 + 后置混凝土 — 虚实结合",
    descEn: "Vertical wood slats + concrete backing — solid-void interplay",
    glyphTag: "WAL",
    defaultFootprintCm: { w: 600, d: 30 },
    defaultParams: {
      lengthM: 6,
      heightM: 1.8,
      slatCm: 5,
      gapCm: 2,
      backWall: true,
    } satisfies SlatWallParams,
    category: "boundary",
  },
  // ─── Structural prefabs (wrap existing detailed Pool/Pergola/etc) ───
  // No params yet — they render with the same defaults as the legacy
  // hardcoded versions. Extension point: add per-prefab params later
  // (pool size, pergola dimensions, outdoor kitchen layout).
  {
    kind: "pool",
    label: "无边泳池",
    labelEn: "Infinity Pool",
    desc: "Travertine 露台 + 无边瀑布 + 按摩浴 + 4 张躺椅 + 池畔小屋",
    descEn: "Travertine deck + infinity edge + spa + 4 loungers + poolside cabana",
    glyphTag: "POOL",
    defaultFootprintCm: { w: 1200, d: 1100 },
    defaultParams: {},
    category: "core",
  },
  {
    kind: "pergola_classic",
    label: "凉亭餐区",
    labelEn: "Pergola Dining",
    desc: "钢铝格栅顶 + 暗色框架 + 整套餐桌 6 椅",
    descEn: "Steel-aluminum louvered roof + dark frame + full dining set for 6",
    glyphTag: "PRG",
    defaultFootprintCm: { w: 530, d: 430 },
    defaultParams: {},
    category: "core",
  },
  {
    kind: "outdoor_kitchen",
    label: "户外厨房",
    labelEn: "Outdoor Kitchen",
    desc: "L 型岛台 + 嵌入式烧烤炉 + 顶部小型 pergola",
    descEn: "L-shaped island + built-in grill + small pergola overhead",
    glyphTag: "BBQ",
    defaultFootprintCm: { w: 320, d: 280 },
    defaultParams: {},
    category: "core",
  },
  {
    kind: "fountain",
    label: "喷泉",
    labelEn: "Fountain",
    desc: "石质圆形喷泉，中心立柱",
    descEn: "Round stone fountain with central pillar",
    glyphTag: "FNT",
    defaultFootprintCm: { w: 280, d: 280 },
    defaultParams: {},
    category: "core",
  },
  {
    kind: "fence_segment",
    label: "围栏段",
    labelEn: "Fence Segment",
    desc: "竖板木栅栏 — 可多段拼接围合地块边界",
    descEn: "Vertical-board wood fence — tile multiple segments to enclose the plot",
    glyphTag: "FNC",
    defaultFootprintCm: { w: 400, d: 20 },
    defaultParams: {
      lengthM: 4,
      heightM: 1.8,
      slatCm: 5,
      gapCm: 2,
    } satisfies FenceSegmentParams,
    category: "boundary",
  },
  {
    kind: "parking_area",
    label: "停车区",
    labelEn: "Parking Area",
    desc: "混凝土车位 + 进出车道 — 可拖至任意位置",
    descEn: "Concrete parking spots + driveway approach — drag anywhere",
    glyphTag: "PKG",
    defaultFootprintCm: { w: 550, d: 600 },
    defaultParams: {
      spotCount: 2,
      facingDir: "south",
      driveway: true,
    } satisfies ParkingAreaParams,
    category: "boundary",
  },
];

export function getPrefabDef(kind: PrefabKind): PrefabDef | undefined {
  return PREFAB_REGISTRY.find(p => p.kind === kind);
}

/** Resolve params with defaults. Use this in renderers — never trust the
 *  raw params from the store, since old saves may be missing fields the
 *  renderer added later. */
export function resolveParams<K extends PrefabKind>(
  kind: K,
  params: Record<string, unknown> | undefined,
):
  K extends "social_island"  ? Required<SocialIslandParams> :
  K extends "farm_box"       ? Required<FarmBoxParams> :
  K extends "porte_cochere"  ? Required<PorteCochereParams> :
  K extends "slat_wall"      ? Required<SlatWallParams> :
  K extends "fence_segment"  ? Required<FenceSegmentParams> :
  K extends "parking_area"   ? Required<ParkingAreaParams> :
  never;
export function resolveParams(
  kind: PrefabKind,
  params: Record<string, unknown> | undefined,
): unknown {
  const def = getPrefabDef(kind);
  if (!def) return {};
  // Shallow merge default → user params. Nested objects (sizeM) handled below.
  const merged: Record<string, unknown> = { ...(def.defaultParams as Record<string, unknown>), ...(params ?? {}) };
  // Special-case nested object params
  if (kind === "social_island") {
    const def_p = def.defaultParams as SocialIslandParams;
    const user_p = (params ?? {}) as SocialIslandParams;
    merged.sizeM = { ...(def_p.sizeM ?? { w: 6, d: 4 }), ...(user_p.sizeM ?? {}) };
  }
  return merged;
}
