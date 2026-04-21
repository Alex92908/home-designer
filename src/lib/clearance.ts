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

import type { FurnitureCategory, FurnitureItem, PlacedItem, WindowConfig } from "./types";

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
  /** If set, the item's footprint should be within this many cm of at
   *  least one wall. Used for pieces that are unsafe or visually awkward
   *  when standing free in the middle of the room: wardrobes can topple,
   *  beds need a headboard wall, fridges need rear ventilation clearance
   *  from the wall but must still back up to one, etc. */
  hugWall?: number;
  /** Message when hug-wall is violated. Falls back to `reason`. */
  hugWallReason?: string;
  /** "required" shows red; "recommended" shows amber. */
  severity?: ClearanceSeverity;
}

// ─── Rule table (per category) ───────────────────────────────
// Missing categories = no clearance rules (plants, art, outdoor, etc.)

export const CLEARANCE_RULES: Partial<Record<FurnitureCategory, ClearanceRule>> = {
  // 客厅
  sofa:          { frontAisle: 40, halo: 10, reason: "沙发前留 40cm 给茶几，侧面 10cm 不憋屈", severity: "required" },
  coffee_table:  { halo: 30, reason: "茶几四周 30cm 方便绕行", severity: "recommended" },
  tv_unit:       { halo: 5, hugWall: 20, hugWallReason: "电视柜建议贴墙，便于走线+避免跌倒", reason: "电视柜前留 5cm 布线空间", severity: "recommended" },
  bookshelf:     { frontAisle: 60, halo: 5, hugWall: 15, hugWallReason: "书柜独立摆放有倾倒风险，建议贴墙或打膨胀螺丝固定", reason: "书柜前留 60cm 取书空间", severity: "required" },
  sideboard:     { frontAisle: 60, halo: 5, hugWall: 20, hugWallReason: "边柜建议贴墙，节省空间且更稳", reason: "边柜前留 60cm 开抽屉", severity: "recommended" },

  // 卧室
  bed:           { halo: 60, hugWall: 20, hugWallReason: "床头建议靠墙，有靠背更安心（风水与功能兼顾）", reason: "床两侧/床尾留 60cm 过道+铺床", severity: "required" },
  nightstand:    { halo: 5, reason: "床头柜紧贴床，预留 5cm 调整空间", severity: "recommended" },
  wardrobe:      { frontAisle: 75, halo: 5, hugWall: 10, hugWallReason: "衣柜独立摆放易倾倒（危险！），必须贴墙或打膨胀螺丝", reason: "衣柜前留 75cm 开门+站人", severity: "required" },
  dresser:       { frontAisle: 75, halo: 5, hugWall: 20, hugWallReason: "梳妆台建议贴墙，镜面更稳定", reason: "梳妆台前留 75cm 坐凳", severity: "required" },

  // 餐厅
  dining_table:  { halo: 75, reason: "餐桌四周 75cm 拉开椅子+走动", severity: "required" },
  dining_chair:  { halo: 0, reason: "", severity: "recommended" }, // 椅子跟随桌子，不单独校验

  // 厨房
  kitchen_cabinet: { frontAisle: 90, halo: 0, hugWall: 5,  hugWallReason: "橱柜须贴墙安装", reason: "橱柜前留 90cm 操作+开门", severity: "required" },
  refrigerator:    { frontAisle: 90, halo: 5, hugWall: 20, hugWallReason: "冰箱建议贴墙（散热留 5-10cm），独立摆放浪费空间", reason: "冰箱前留 90cm 开门取物+散热", severity: "required" },
  range_hood:      { halo: 0, hugWall: 5, hugWallReason: "油烟机须贴墙（与灶台对齐）", reason: "", severity: "recommended" },
  kitchen_sink:    { frontAisle: 80, halo: 0, hugWall: 5, hugWallReason: "水槽须嵌入橱柜、贴墙安装", reason: "水槽前留 80cm 洗涮站位", severity: "required" },

  // 卫生间
  toilet:           { frontAisle: 50, halo: 20, hugWall: 10, hugWallReason: "马桶须贴墙（下水管位置固定）", reason: "马桶前留 50cm，两侧 20cm", severity: "required" },
  bathtub:          { frontAisle: 60, halo: 5, reason: "浴缸前留 60cm 进出+擦身", severity: "required" },
  shower:           { frontAisle: 60, halo: 5, reason: "淋浴房前留 60cm 进出", severity: "required" },
  bathroom_vanity:  { frontAisle: 75, halo: 5, hugWall: 10, hugWallReason: "洗手台须贴墙（上下水管位置固定）", reason: "洗手台前留 75cm 弯腰+站立", severity: "required" },

  // 书房
  desk:          { frontAisle: 75, halo: 5, reason: "书桌前留 75cm 椅子+坐位", severity: "required" },
  office_chair:  { halo: 0, reason: "", severity: "recommended" },
  storage:       { frontAisle: 60, halo: 5, hugWall: 20, hugWallReason: "储物柜建议贴墙，节省空间+更稳", reason: "储物柜前留 60cm 开门", severity: "recommended" },
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

// ─── Door-swing geometry ─────────────────────────────────────
//
// Every door needs a quadrant of clear floor to swing open. We model it
// as a rectangle of door-width × door-width projected into the room —
// stricter than the true quadrant arc, but zero false negatives and
// much simpler to render/detect.

export type DoorWall = "bottom" | "top" | "left" | "right";

export interface DoorSwingZone {
  /** AABB of the swing clearance in room coordinates. */
  bbox: AABB;
  /** Which wall the door sits on (for label placement). */
  wall: DoorWall;
}

/** Returns the door-swing clearance zone, or null if the door length
 *  is zero (effectively no door). */
export function doorSwingZone(
  wall: DoorWall,
  doorPosCm: number,
  doorLenCm: number,
  roomW: number,
  roomD: number,
): DoorSwingZone | null {
  if (doorLenCm <= 0) return null;
  const L = doorLenCm;
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  if (wall === "bottom") {
    minX = doorPosCm; maxX = doorPosCm + L;
    minZ = roomD - L; maxZ = roomD;
  } else if (wall === "top") {
    minX = doorPosCm; maxX = doorPosCm + L;
    minZ = 0;          maxZ = L;
  } else if (wall === "left") {
    minX = 0;          maxX = L;
    minZ = doorPosCm; maxZ = doorPosCm + L;
  } else {
    minX = roomW - L; maxX = roomW;
    minZ = doorPosCm; maxZ = doorPosCm + L;
  }
  return {
    wall,
    bbox: {
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      w:  maxX - minX,
      d:  maxZ - minZ,
    },
  };
}

// ─── Relational rules (跨家具关系校验) ───────────────────────
//
// Some装修常识 is not about a single piece — it's about how two pieces
// relate. E.g. "sofa must be 2.5-4m from the TV" (viewing distance),
// "kitchen sink/stove/fridge form a triangle with each leg 120-270cm"
// (work triangle), "desk should be within 2m of a window" (daylight).
//
// These rules can't be expressed as halos. We model them as pairwise
// (or triple) constraints evaluated over placed items.

export interface DistanceRangeRule {
  kind: "distanceRange";
  /** First category in the pair. */
  a: FurnitureCategory;
  /** Second category in the pair. Must differ from `a`. */
  b: FurnitureCategory;
  /** Min center-to-center distance (cm). 0 = no lower bound. */
  minCm: number;
  /** Max center-to-center distance (cm). Infinity = no upper bound. */
  maxCm: number;
  /** If true, emit violation when nearest b is outside [min, max]. If
   *  false, only emit when BOTH categories are present AND specifically
   *  the pair violates — used for triangle-type rules. */
  requiresBoth: boolean;
  /** Message shown when distance < minCm. */
  tooCloseReason: string;
  /** Message shown when distance > maxCm. */
  tooFarReason: string;
  severity: ClearanceSeverity;
}

/** "Category X must have a window within maxCm". Used for rules like
 *  "desk should be within 2m of a window for daylight". */
export interface NeedsWindowRule {
  kind: "needsWindow";
  category: FurnitureCategory;
  maxCm: number;
  reason: string;
  severity: ClearanceSeverity;
}

export type RelationalRule = DistanceRangeRule | NeedsWindowRule;

export const RELATIONAL_RULES: RelationalRule[] = [
  // ── 客厅：电视-沙发观看距离 ──
  {
    kind: "distanceRange",
    a: "tv_unit",
    b: "sofa",
    minCm: 250,
    maxCm: 400,
    requiresBoth: true,
    tooCloseReason: "电视离沙发太近（建议 ≥2.5m），长时间观看伤眼",
    tooFarReason: "电视离沙发太远（建议 ≤4m），屏幕看不清",
    severity: "recommended",
  },

  // ── 厨房工作三角：水槽-灶台-冰箱，每段 120-270cm ──
  // 经典 fitted kitchen 规则。range_hood 代指灶台（本项目里油烟机与灶
  // 台成对出现、位置一致，用 range_hood 作为灶台位置锚点）。
  {
    kind: "distanceRange",
    a: "kitchen_sink",
    b: "range_hood",
    minCm: 120,
    maxCm: 270,
    requiresBoth: true,
    tooCloseReason: "水槽与灶台过近（建议 ≥1.2m），操作时互相干扰且烫伤风险高",
    tooFarReason: "水槽与灶台过远（建议 ≤2.7m），来回端水走动太多",
    severity: "recommended",
  },
  {
    kind: "distanceRange",
    a: "kitchen_sink",
    b: "refrigerator",
    minCm: 120,
    maxCm: 270,
    requiresBoth: true,
    tooCloseReason: "水槽与冰箱过近（建议 ≥1.2m），开冰箱门易被水溅到",
    tooFarReason: "水槽与冰箱过远（建议 ≤2.7m），洗切食材动线过长",
    severity: "recommended",
  },
  {
    kind: "distanceRange",
    a: "refrigerator",
    b: "range_hood",
    minCm: 120,
    maxCm: 270,
    requiresBoth: true,
    tooCloseReason: "冰箱与灶台过近（建议 ≥1.2m），高温影响冰箱制冷且有安全隐患",
    tooFarReason: "冰箱与灶台过远（建议 ≤2.7m），取食材-下锅动线过长",
    severity: "recommended",
  },

  // ── 书房：书桌距窗户 ≤2m（采光） ──
  {
    kind: "needsWindow",
    category: "desk",
    maxCm: 200,
    reason: "书桌距窗户过远（建议 ≤2m），白天读写需开灯，长期用眼疲劳",
    severity: "recommended",
  },
];

// ─── Violation detection ─────────────────────────────────────

export type ViolationKind = "wall" | "overlap" | "door" | "relational" | "window" | "hugWall";

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

export interface DoorInfo {
  hasDoor: boolean;
  wall: DoorWall;
  posCm: number;
  lenCm: number;
}

/** A visual link between two points (e.g. TV ↔ sofa viewing distance,
 *  or desk ↔ nearest window). Rendered as a dotted line with a distance
 *  label. Endpoints are either furniture instances or fixed room points
 *  (window midpoints). */
export interface RelationalLink {
  fromInstanceId: string;
  /** Target furniture instance ID — null if the target is a window. */
  toInstanceId: string | null;
  /** If target is a window, its midpoint in room coords; null otherwise. */
  toPoint?: { x: number; z: number };
  distanceCm: number;
  severity: ClearanceSeverity;
  /** true if this link currently violates its rule (shown red/amber),
   *  false if it's informational (shown green/muted). */
  violates: boolean;
}

/** Midpoint of a window in room coordinates. */
function windowMidpoint(win: WindowConfig, roomW: number, roomD: number): { x: number; z: number } {
  const mid = win.pos + win.len / 2;
  if (win.wall === "back")       return { x: mid,     z: 0 };
  if (win.wall === "front")      return { x: mid,     z: roomD };
  if (win.wall === "left")       return { x: 0,       z: mid };
  /* right */                    return { x: roomW,   z: mid };
}

export interface RoomEvaluation {
  items: EvaluatedItem[];
  doorSwing: DoorSwingZone | null;
  links: RelationalLink[];
}

/** Compute clearance zones + violations for every placed item in the room.
 *  Returns per-item evaluation suitable for rendering and reporting. */
/** How far a piece can sit from the wall and still count as "blocking" a
 *  window (cm). Furniture pressed against the wall with top above the
 *  sill definitely blocks; furniture a bit in front still blocks because
 *  its mass casts shadow and blocks airflow. */
const WINDOW_BLOCK_DEPTH_CM = 40;

/** Build a thin AABB along the wall where the window sits — used to test
 *  whether any furniture occupies the strip in front of the window. */
function windowStripBBox(
  win: WindowConfig,
  roomW: number,
  roomD: number,
): AABB {
  const D = WINDOW_BLOCK_DEPTH_CM;
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  if (win.wall === "back") {
    minX = win.pos; maxX = win.pos + win.len;
    minZ = 0;       maxZ = D;
  } else if (win.wall === "front") {
    minX = win.pos; maxX = win.pos + win.len;
    minZ = roomD - D; maxZ = roomD;
  } else if (win.wall === "left") {
    minX = 0;       maxX = D;
    minZ = win.pos; maxZ = win.pos + win.len;
  } else {
    minX = roomW - D; maxX = roomW;
    minZ = win.pos;    maxZ = win.pos + win.len;
  }
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    w:  maxX - minX,
    d:  maxZ - minZ,
  };
}

export function evaluateRoom(
  placedItems: PlacedItem[],
  getFurniture: (id: string) => FurnitureItem | undefined,
  roomW: number,
  roomD: number,
  door?: DoorInfo,
  windows: WindowConfig[] = [],
): RoomEvaluation {
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

  const swing = door && door.hasDoor
    ? doorSwingZone(door.wall, door.posCm, door.lenCm, roomW, roomD)
    : null;

  const evaluated: EvaluatedItem[] = items.map(it => {
    const violations: Violation[] = [];

    // Door-swing: anything whose footprint intrudes the swing area blocks the door.
    if (swing && overlaps(swing.bbox, it.bbox, 1)) {
      violations.push({
        instanceId: it.placed.instanceId,
        furnitureName: it.f.name,
        kind: "door",
        required: 0,
        reason: "阻挡门开合，门可能撞到家具",
        severity: "required",
      });
    }

    // Window-block: furniture tall enough to rise above the sill AND
    // sitting inside the window strip → blocks daylight / airflow.
    const fElev   = it.placed.elevationY ?? 0;
    const fScaleH = it.placed.scaleH ?? 1;
    const fTop    = fElev + it.f.height * fScaleH;
    for (const win of windows) {
      const sill = win.sill ?? 90;
      if (fTop <= sill) continue;
      const strip = windowStripBBox(win, roomW, roomD);
      if (overlaps(strip, it.bbox, 1)) {
        violations.push({
          instanceId: it.placed.instanceId,
          furnitureName: it.f.name,
          kind: "window",
          required: 0,
          reason: "家具高于窗台且位于窗前，遮挡采光与通风",
          severity: "required",
        });
        break;
      }
    }
    // Hug-wall: certain pieces (wardrobe, bed, fridge, toilet…) must sit
    // close to at least one wall. Compute min distance from item bbox to
    // any of the 4 walls; violation if min > threshold.
    if (it.rule?.hugWall != null) {
      const minX = it.bbox.cx - it.bbox.w / 2;
      const maxX = it.bbox.cx + it.bbox.w / 2;
      const minZ = it.bbox.cz - it.bbox.d / 2;
      const maxZ = it.bbox.cz + it.bbox.d / 2;
      const distToWall = Math.min(minX, minZ, roomW - maxX, roomD - maxZ);
      if (distToWall > it.rule.hugWall) {
        violations.push({
          instanceId: it.placed.instanceId,
          furnitureName: it.f.name,
          kind: "hugWall",
          required: Math.round(distToWall),
          reason: it.rule.hugWallReason ?? it.rule.reason,
          severity: it.rule.severity ?? "recommended",
        });
      }
    }

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

  // ── Relational rules: pairwise distance checks between categories ──
  const links: RelationalLink[] = [];
  for (const rule of RELATIONAL_RULES) {
    if (rule.kind === "needsWindow") {
      if (windows.length === 0) continue;
      const targets = items.filter(i => i.f.category === rule.category);
      for (const ti of targets) {
        let nearest: WindowConfig | null = null;
        let nearestD = Infinity;
        let nearestPt = { x: 0, z: 0 };
        for (const win of windows) {
          const mid = windowMidpoint(win, roomW, roomD);
          const dx = ti.bbox.cx - mid.x;
          const dz = ti.bbox.cz - mid.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < nearestD) { nearestD = d; nearest = win; nearestPt = mid; }
        }
        if (!nearest) continue;
        const violates = nearestD > rule.maxCm;
        links.push({
          fromInstanceId: ti.placed.instanceId,
          toInstanceId: null,
          toPoint: nearestPt,
          distanceCm: Math.round(nearestD),
          severity: rule.severity,
          violates,
        });
        if (violates) {
          const targetEval = evaluated.find(e => e.placed.instanceId === ti.placed.instanceId);
          if (targetEval) {
            targetEval.violations.push({
              instanceId: ti.placed.instanceId,
              furnitureName: ti.f.name,
              kind: "relational",
              required: rule.maxCm,
              reason: rule.reason,
              severity: rule.severity,
            });
          }
        }
      }
      continue;
    }
    if (rule.kind !== "distanceRange") continue;
    const as = items.filter(i => i.f.category === rule.a);
    const bs = items.filter(i => i.f.category === rule.b);
    if (as.length === 0 || bs.length === 0) {
      if (rule.requiresBoth) continue;
      continue;
    }
    // For each `a` item, find nearest `b` and evaluate.
    for (const ai of as) {
      let nearest: typeof bs[number] | null = null;
      let nearestD = Infinity;
      for (const bi of bs) {
        const dx = ai.bbox.cx - bi.bbox.cx;
        const dz = ai.bbox.cz - bi.bbox.cz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < nearestD) { nearestD = d; nearest = bi; }
      }
      if (!nearest) continue;
      const tooClose = nearestD < rule.minCm;
      const tooFar   = nearestD > rule.maxCm;
      const violates = tooClose || tooFar;
      links.push({
        fromInstanceId: ai.placed.instanceId,
        toInstanceId: nearest.placed.instanceId,
        distanceCm: Math.round(nearestD),
        severity: rule.severity,
        violates,
      });
      if (violates) {
        const targetEval = evaluated.find(e => e.placed.instanceId === ai.placed.instanceId);
        if (targetEval) {
          targetEval.violations.push({
            instanceId: ai.placed.instanceId,
            furnitureName: ai.f.name,
            kind: "relational",
            otherId: nearest.placed.instanceId,
            otherName: nearest.f.name,
            required: tooClose ? rule.minCm : rule.maxCm,
            reason: tooClose ? rule.tooCloseReason : rule.tooFarReason,
            severity: rule.severity,
          });
        }
      }
    }
  }

  return { items: evaluated, doorSwing: swing, links };
}
