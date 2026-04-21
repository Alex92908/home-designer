// ─── Ergonomic clearance rules for furniture placement ───────
//
// These rules encode the "common sense" distances every interior designer
// knows but most first-time home owners don't. They drive real-time
// fit/aisle validation in the floor plan — BuildCores-style decision
// support for independent home designers.
//
// All distances are centimeters. Sources: general Chinese residential
// 人体工程学 handbooks (GB/T standards + 宜家 / 小红书 装修避坑 common
// ranges). Values are intentionally on the lighter side of "recommended"
// to avoid false positives in typical 小户型.

import type { FurnitureCategory, FurnitureItem, PlacedItem } from "./types";

export type ClearanceSeverity = "required" | "recommended";

export interface ClearanceRule {
  /** Uniform clearance around the item's footprint (cm). Use for pieces
   *  where every side needs walk-around space (bed, dining table). */
  halo?: number;
  /** Extra clearance in front of the item (local +depth direction when
   *  rotation=0). Use for sofas (茶几位), wardrobes/fridges (开门+站位),
   *  desks (坐位), toilets (前方空间) etc. */
  frontAisle?: number;
  /** Extra clearance behind the item. Rarely used (most pieces back
   *  against a wall). Non-zero means the item needs airflow etc. */
  backAisle?: number;
  /** Human-readable reason, shown in violation panel. */
  reason: string;
  /** "required" shows red; "recommended" shows amber. */
  severity?: ClearanceSeverity;
}

// ─── Rule table (per category) ───────────────────────────────
// Missing categories = no clearance rules (plants, art, outdoor, etc.)

export const CLEARANCE_RULES: Partial<Record<FurnitureCategory, ClearanceRule>> = {
  // 客厅
  sofa:          { frontAisle: 40, halo: 10, reason: "沙发前留 40cm 给茶几，侧面 10cm 不憋屈", severity: "required" },
  coffee_table:  { halo: 30, reason: "茶几四周 30cm 方便绕行", severity: "recommended" },
  tv_unit:       { frontAisle: 250, halo: 5, reason: "电视柜距沙发建议 2.5m 以上护眼", severity: "recommended" },
  bookshelf:     { frontAisle: 60, halo: 5, reason: "书柜前留 60cm 取书空间", severity: "required" },
  sideboard:     { frontAisle: 60, halo: 5, reason: "边柜前留 60cm 开抽屉", severity: "recommended" },

  // 卧室
  bed:           { halo: 60, reason: "床两侧/床尾留 60cm 过道+铺床", severity: "required" },
  nightstand:    { halo: 5, reason: "床头柜紧贴床，预留 5cm 调整空间", severity: "recommended" },
  wardrobe:      { frontAisle: 75, halo: 5, reason: "衣柜前留 75cm 开门+站人", severity: "required" },
  dresser:       { frontAisle: 75, halo: 5, reason: "梳妆台前留 75cm 坐凳", severity: "required" },

  // 餐厅
  dining_table:  { halo: 75, reason: "餐桌四周 75cm 拉开椅子+走动", severity: "required" },
  dining_chair:  { halo: 0, reason: "", severity: "recommended" }, // 椅子跟随桌子，不单独校验

  // 厨房
  kitchen_cabinet: { frontAisle: 90, halo: 0, reason: "橱柜前留 90cm 操作+开门", severity: "required" },
  refrigerator:    { frontAisle: 90, halo: 5, reason: "冰箱前留 90cm 开门取物+散热", severity: "required" },
  range_hood:      { halo: 0, reason: "", severity: "recommended" },
  kitchen_sink:    { frontAisle: 80, halo: 0, reason: "水槽前留 80cm 洗涮站位", severity: "required" },

  // 卫生间
  toilet:           { frontAisle: 50, halo: 20, reason: "马桶前留 50cm，两侧 20cm", severity: "required" },
  bathtub:          { frontAisle: 60, halo: 5, reason: "浴缸前留 60cm 进出+擦身", severity: "required" },
  shower:           { frontAisle: 60, halo: 5, reason: "淋浴房前留 60cm 进出", severity: "required" },
  bathroom_vanity:  { frontAisle: 75, halo: 5, reason: "洗手台前留 75cm 弯腰+站立", severity: "required" },

  // 书房
  desk:          { frontAisle: 75, halo: 5, reason: "书桌前留 75cm 椅子+坐位", severity: "required" },
  office_chair:  { halo: 0, reason: "", severity: "recommended" },
  storage:       { frontAisle: 60, halo: 5, reason: "储物柜前留 60cm 开门", severity: "recommended" },
};

// ─── Geometry helpers ────────────────────────────────────────

export interface AABB {
  /** Center x in room coordinates (cm from left wall). */
  cx: number;
  /** Center z in room coordinates (cm from back wall). */
  cz: number;
  /** Full width (cm). */
  w: number;
  /** Full depth (cm). */
  d: number;
}

/** The world-space footprint of a placed item, accounting for scale/rotation. */
export function itemBBox(placed: PlacedItem, f: FurnitureItem): AABB {
  const sw = placed.scaleW ?? 1;
  const sd = placed.scaleD ?? 1;
  const rot90 = placed.rotation === 90 || placed.rotation === 270;
  const w = (rot90 ? f.depth * sd : f.width  * sw);
  const d = (rot90 ? f.width  * sw : f.depth * sd);
  return { cx: placed.x, cz: placed.z, w, d };
}

/** AABB overlap (strictly positive overlap area). */
export function overlaps(a: AABB, b: AABB, tolerance = 0.5): boolean {
  return (
    Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 - tolerance &&
    Math.abs(a.cz - b.cz) < (a.d + b.d) / 2 - tolerance
  );
}

/** Expanded bbox: grows uniformly by `halo`, then tacks on directional
 *  frontAisle/backAisle on the local-front side based on rotation. */
export function clearanceBBox(placed: PlacedItem, f: FurnitureItem, rule: ClearanceRule): AABB {
  const base = itemBBox(placed, f);
  const halo = rule.halo ?? 0;

  // Start with uniform halo
  let minX = base.cx - base.w / 2 - halo;
  let maxX = base.cx + base.w / 2 + halo;
  let minZ = base.cz - base.d / 2 - halo;
  let maxZ = base.cz + base.d / 2 + halo;

  // Apply directional aisles. Local +Z (front) rotates with the piece.
  // SVG/room convention: rotation=0 → front points +Z (toward front wall).
  const front = rule.frontAisle ?? 0;
  const back  = rule.backAisle  ?? 0;
  const r = ((placed.rotation ?? 0) % 360 + 360) % 360;
  const applyFront = (dir: 0 | 90 | 180 | 270, amount: number) => {
    if (amount <= 0) return;
    if (dir === 0)        maxZ += amount;
    else if (dir === 90)  minX -= amount;
    else if (dir === 180) minZ -= amount;
    else                  maxX += amount;
  };
  const applyBack = (dir: 0 | 90 | 180 | 270, amount: number) => {
    if (amount <= 0) return;
    if (dir === 0)        minZ -= amount;
    else if (dir === 90)  maxX += amount;
    else if (dir === 180) maxZ += amount;
    else                  minX -= amount;
  };
  const dir = (r as 0 | 90 | 180 | 270);
  applyFront(dir, front);
  applyBack(dir,  back);

  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    w:  maxX - minX,
    d:  maxZ - minZ,
  };
}

// ─── Violation detection ─────────────────────────────────────

export type ViolationKind = "wall" | "overlap";

export interface Violation {
  instanceId: string;
  furnitureName: string;
  kind: ViolationKind;
  /** Item the clearance overlaps with (for "overlap"), or null for "wall". */
  otherId?: string;
  otherName?: string;
  /** Required distance in cm that is not satisfied. */
  required: number;
  reason: string;
  severity: ClearanceSeverity;
}

export interface EvaluatedItem {
  placed: PlacedItem;
  f: FurnitureItem;
  rule?: ClearanceRule;
  /** Clearance zone in room coordinates (for rendering), or null if no rule. */
  zone: AABB | null;
  /** Zone minus the item footprint itself — the "required empty space". */
  /** Violations produced by this item. */
  violations: Violation[];
}

/** Compute clearance zones + violations for every placed item in the room.
 *  Returns per-item evaluation suitable for rendering and reporting. */
export function evaluateRoom(
  placedItems: PlacedItem[],
  getFurniture: (id: string) => FurnitureItem | undefined,
  roomW: number,
  roomD: number,
): EvaluatedItem[] {
  const items = placedItems
    .map(p => {
      const f = getFurniture(p.furnitureId);
      if (!f) return null;
      const rule = CLEARANCE_RULES[f.category];
      const zone = rule && (rule.halo || rule.frontAisle || rule.backAisle)
        ? clearanceBBox(p, f, rule)
        : null;
      return { placed: p, f, rule, zone, bbox: itemBBox(p, f) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const evaluated: EvaluatedItem[] = items.map(it => {
    const violations: Violation[] = [];
    if (it.rule && it.zone && it.rule.reason) {
      const sev = it.rule.severity ?? "recommended";

      // Wall violations — any side of the zone extends outside [0, roomW] × [0, roomD].
      // We only flag the extra clearance, not the item itself (that's handled
      // by the existing clamping code).
      const minX = it.zone.cx - it.zone.w / 2;
      const maxX = it.zone.cx + it.zone.w / 2;
      const minZ = it.zone.cz - it.zone.d / 2;
      const maxZ = it.zone.cz + it.zone.d / 2;

      // Compute deficit = how far the clearance is pushed past a wall.
      const wallDeficit = Math.max(0, -minX, -minZ, maxX - roomW, maxZ - roomD);
      if (wallDeficit > 1) {
        violations.push({
          instanceId: it.placed.instanceId,
          furnitureName: it.f.name,
          kind: "wall",
          required: Math.round(wallDeficit),
          reason: it.rule.reason,
          severity: sev,
        });
      }

      // Overlap with other items' footprints.
      for (const other of items) {
        if (other.placed.instanceId === it.placed.instanceId) continue;
        if (overlaps(it.zone, other.bbox, 1)) {
          violations.push({
            instanceId: it.placed.instanceId,
            furnitureName: it.f.name,
            kind: "overlap",
            otherId: other.placed.instanceId,
            otherName: other.f.name,
            required: 0,
            reason: it.rule.reason,
            severity: sev,
          });
        }
      }
    }

    return {
      placed: it.placed,
      f: it.f,
      rule: it.rule,
      zone: it.zone,
      violations,
    };
  });

  return evaluated;
}
