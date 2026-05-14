/**
 * Outdoor smart-suggestions engine — the differentiator from Houzz / VizTerra
 * / iScape. Indoor we already have clearance.ts for furniture; this brings
 * the same "professional rule-of-thumb" to the yard.
 *
 * Each YardItem is checked against a small set of distance / proximity
 * heuristics drawn from real landscape architecture practice + fire
 * code basics:
 *   - BBQ < 3 m to house  →  fire hazard (required)
 *   - Pool < 1.5 m to house wall  →  humidity / structural concern
 *   - Large tree < 4 m to house  →  root + canopy issues
 *   - Crops > 25 m from house  →  inconvenient to harvest
 *   - Two heavy items overlapping (footprint)
 *   - Plant cluster overcrowded (>6 plantings within 2 m)
 *
 * The function is a pure transform: takes (items, houseFootprint) and
 * returns the violation list. The UI layer decides how to surface
 * (warning chips, ring overlays on canvas, etc).
 */

import type { YardItem, YardSingleton, YardPrefab } from "./types";
import { isYardSingleton, isYardPrefab } from "./types";
import { getOutdoorAssetByKind } from "./outdoorAssets";

export type OutdoorSeverity = "required" | "recommended";
export type OutdoorViolationKind =
  | "fireHazard"
  | "tooCloseToHouse"
  | "tooFarFromHouse"
  | "overlap"
  | "cluttered"
  | "blocksDriveway";

export interface OutdoorViolation {
  /** YardItem id this violation attaches to. */
  itemId: string;
  /** Optional second item involved (overlap, cluttered). */
  otherId?: string;
  kind: OutdoorViolationKind;
  severity: OutdoorSeverity;
  /** Human-readable reason — both languages, locale picks. */
  reasonZh: string;
  reasonEn: string;
  /** Required clearance (m) so the UI can quote the rule. */
  requiredM?: number;
  /** Actual measured distance (m). */
  actualM?: number;
}

export interface HouseFootprintCm {
  minX: number; maxX: number; minZ: number; maxZ: number;
}

/** Shortest distance (m) from a point (cm) to the house bbox edge,
 *  negative if the point is inside the bbox. */
function distToHouseM(xCm: number, zCm: number, fp: HouseFootprintCm): number {
  const dx = Math.max(fp.minX - xCm, 0, xCm - fp.maxX);
  const dz = Math.max(fp.minZ - zCm, 0, zCm - fp.maxZ);
  if (dx === 0 && dz === 0) {
    // Inside bbox — return negative magnitude of how deep
    const depth = Math.min(xCm - fp.minX, fp.maxX - xCm, zCm - fp.minZ, fp.maxZ - zCm);
    return -depth / 100;
  }
  return Math.hypot(dx, dz) / 100;
}

/** Centre-to-centre distance (m) between two yard items. */
function dist2M(a: YardItem, b: YardItem): number {
  return Math.hypot(a.x - b.x, a.z - b.z) / 100;
}

/** Per-asset class: how big a circle (m radius) does this thing claim
 *  on the ground — used for footprint-overlap checks. */
function itemFootprintM(item: YardSingleton): number {
  const a = getOutdoorAssetByKind(item.kind);
  if (!a) return 0.6;
  return (a.radiusCm / 100) * (item.scale ?? 1);
}

/** Categorise an item as a "fire source" — currently just the campfire,
 *  but extensible to BBQ models when we add them. */
function isFireSource(kind: string): boolean {
  return kind === "feature.campfire" || kind.includes("bbq") || kind.includes("grill");
}

/** Heavy / structural items that don't want to be against the house wall. */
function isHeavyFeature(kind: string): boolean {
  return (
    kind === "feature.tent" ||
    kind === "feature.canoe" ||
    kind === "feature.bridgeWood" ||
    kind === "feature.campfire"
  );
}

/** Crops the user expects to harvest regularly — flag if too far. */
function isCrop(kind: string): boolean {
  return kind.startsWith("feature.crop");
}

/** Trees with significant root systems (heuristic: large radiusCm). */
function isLargeTree(item: YardItem): boolean {
  if (!("kind" in item)) return false;
  const a = getOutdoorAssetByKind(item.kind);
  if (!a) return false;
  return a.category === "tree" && a.radiusCm >= 100 && (item.scale ?? 1) >= 0.8;
}

/** Plantings — flowers, bushes, small things — for cluster density check. */
function isPlanting(kind: string): boolean {
  const a = getOutdoorAssetByKind(kind);
  return !!a && (a.category === "plant" || (a.category === "tree" && a.radiusCm < 80));
}

// ─── Prefab helpers ───────────────────────────────────────
const PREFAB_FOOTPRINT_CM: Record<string, { w: number; d: number }> = {
  social_island:    { w: 500, d: 400 },
  farm_box:         { w: 300, d: 150 },
  porte_cochere:    { w: 600, d: 400 },
  slat_wall:        { w: 400, d: 20  },
  pool:             { w: 600, d: 350 },
  pergola_classic:  { w: 400, d: 300 },
  outdoor_kitchen:  { w: 300, d: 120 },
  fountain:         { w: 200, d: 200 },
};

function prefabAABB(item: YardPrefab): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const fp = PREFAB_FOOTPRINT_CM[item.prefabKind] ?? { w: 300, d: 300 };
  const hw = fp.w / 2, hd = fp.d / 2;
  return { minX: item.x - hw, maxX: item.x + hw, minZ: item.z - hd, maxZ: item.z + hd };
}

function aabbOverlap(
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

function prefabDistToHouseM(item: YardPrefab, fp: HouseFootprintCm): number {
  return distToHouseM(item.x, item.z, fp);
}

// ─── Main evaluator ────────────────────────────────────────
export function evaluateYardPlan(items: YardItem[], house: HouseFootprintCm): OutdoorViolation[] {
  const out: OutdoorViolation[] = [];

  const singletons = items.filter(isYardSingleton);

  for (const it of singletons) {
    const dHouse = distToHouseM(it.x, it.z, house);

    // ── Fire hazard: campfire / BBQ < 3 m to house ──
    if (isFireSource(it.kind) && dHouse < 3) {
      out.push({
        itemId: it.id,
        kind: "fireHazard",
        severity: "required",
        requiredM: 3,
        actualM: Math.max(0, dHouse),
        reasonZh: "明火设施距房子过近（建议 ≥3m），存在火灾隐患",
        reasonEn: "Fire feature too close to house (keep ≥3m) — fire hazard",
      });
    }

    // ── Heavy item against house wall ──
    if (isHeavyFeature(it.kind) && !isFireSource(it.kind) && dHouse < 1.0) {
      out.push({
        itemId: it.id,
        kind: "tooCloseToHouse",
        severity: "recommended",
        requiredM: 1,
        actualM: Math.max(0, dHouse),
        reasonZh: "贴墙摆放，建议距房子 ≥1m 以便维护",
        reasonEn: "Against house wall — keep ≥1m for maintenance access",
      });
    }

    // ── Large tree too close to house ──
    if (isLargeTree(it) && dHouse < 4) {
      out.push({
        itemId: it.id,
        kind: "tooCloseToHouse",
        severity: "recommended",
        requiredM: 4,
        actualM: Math.max(0, dHouse),
        reasonZh: "大树距房子过近（建议 ≥4m），根系可能损坏地基，落叶难清理",
        reasonEn: "Large tree too close to house (keep ≥4m) — roots can damage foundation",
      });
    }

    // ── Crops too far from house ──
    if (isCrop(it.kind) && dHouse > 25) {
      out.push({
        itemId: it.id,
        kind: "tooFarFromHouse",
        severity: "recommended",
        requiredM: 25,
        actualM: dHouse,
        reasonZh: "菜畦距房子过远（建议 ≤25m），日常采收不便",
        reasonEn: "Vegetable plot far from house (keep ≤25m) — inconvenient to harvest",
      });
    }
  }

  // ── Pairwise overlap (footprint circles) — singletons only ──
  for (let i = 0; i < singletons.length; i++) {
    for (let j = i + 1; j < singletons.length; j++) {
      const a = singletons[i], b = singletons[j];
      const d = dist2M(a, b);
      const minSep = itemFootprintM(a) + itemFootprintM(b);
      if (d < minSep * 0.6) {  // 0.6 = "too overlapping" tolerance
        out.push({
          itemId: a.id,
          otherId: b.id,
          kind: "overlap",
          severity: "recommended",
          requiredM: Math.round(minSep * 100) / 100,
          actualM: Math.round(d * 100) / 100,
          reasonZh: "两个元素重叠过多，建议拉开间距",
          reasonEn: "Footprints overlap — separate the items",
        });
      }
    }
  }

  // ── Cluster density: > 6 plantings within 2 m of any planting ──
  const plantings = singletons.filter(it => isPlanting(it.kind));
  for (const p of plantings) {
    let count = 0;
    for (const q of plantings) {
      if (q.id === p.id) continue;
      if (dist2M(p, q) < 2) count++;
    }
    if (count > 6) {
      out.push({
        itemId: p.id,
        kind: "cluttered",
        severity: "recommended",
        reasonZh: `周围 2m 内堆了 ${count + 1} 株植物，过密会争夺养分`,
        reasonEn: `Crowded planting (${count + 1} within 2m) — they'll compete for nutrients`,
      });
    }
  }

  // ─── Prefab checks ────────────────────────────────────────
  const prefabs = items.filter((it): it is YardPrefab => isYardPrefab(it));

  // Pool: must be ≥1.5m from house (humidity/structural concern)
  for (const pf of prefabs) {
    if (pf.prefabKind === "pool") {
      const d = prefabDistToHouseM(pf, house);
      if (d < 1.5) {
        out.push({
          itemId: pf.id,
          kind: "tooCloseToHouse",
          severity: "required",
          requiredM: 1.5,
          actualM: Math.max(0, d),
          reasonZh: "泳池距房子过近（建议 ≥1.5m），潮湿可能损坏墙基",
          reasonEn: "Pool too close to house (keep ≥1.5m) — moisture damages foundations",
        });
      }
    }

    // Outdoor kitchen: must be ≥2m from house (fire/grease safety)
    if (pf.prefabKind === "outdoor_kitchen") {
      const d = prefabDistToHouseM(pf, house);
      if (d < 2) {
        out.push({
          itemId: pf.id,
          kind: "fireHazard",
          severity: "recommended",
          requiredM: 2,
          actualM: Math.max(0, d),
          reasonZh: "户外厨房距房子过近（建议 ≥2m），烹饪烟火有安全隐患",
          reasonEn: "Outdoor kitchen too close to house (keep ≥2m) — cooking smoke/fire risk",
        });
      }
    }
  }

  // Prefab-to-prefab AABB overlap
  for (let i = 0; i < prefabs.length; i++) {
    for (let j = i + 1; j < prefabs.length; j++) {
      const a = prefabs[i], b = prefabs[j];
      const aBox = prefabAABB(a);
      const bBox = prefabAABB(b);
      if (aabbOverlap(aBox, bBox)) {
        out.push({
          itemId: a.id,
          otherId: b.id,
          kind: "overlap",
          severity: "recommended",
          reasonZh: "两个组合构件重叠，请拉开间距",
          reasonEn: "Two prefabs overlap — separate them",
        });
      }
    }
  }

  // Prefab-singleton overlap (prefab box vs singleton circle)
  for (const pf of prefabs) {
    const box = prefabAABB(pf);
    for (const sg of singletons) {
      const r = itemFootprintM(sg) * 100; // convert to cm
      // Check if singleton circle overlaps prefab AABB (simple: check center inside expanded AABB)
      const nearX = Math.max(box.minX, Math.min(box.maxX, sg.x));
      const nearZ = Math.max(box.minZ, Math.min(box.maxZ, sg.z));
      const dist = Math.hypot(sg.x - nearX, sg.z - nearZ);
      if (dist < r * 0.7) {
        out.push({
          itemId: sg.id,
          otherId: pf.id,
          kind: "overlap",
          severity: "recommended",
          reasonZh: `景观元素与「${pf.prefabKind}」重叠，建议挪开`,
          reasonEn: `Item overlaps with "${pf.prefabKind}" prefab — move it away`,
        });
      }
    }
  }

  // De-dupe identical (itemId + kind + otherId) to avoid double-counting
  const seen = new Set<string>();
  return out.filter(v => {
    const k = `${v.itemId}|${v.kind}|${v.otherId ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Group violations by itemId for quick "is this item flagged" lookup. */
export function violationsByItem(violations: OutdoorViolation[]): Map<string, OutdoorViolation[]> {
  const m = new Map<string, OutdoorViolation[]>();
  for (const v of violations) {
    const arr = m.get(v.itemId) ?? [];
    arr.push(v);
    m.set(v.itemId, arr);
    if (v.otherId) {
      const arr2 = m.get(v.otherId) ?? [];
      arr2.push(v);
      m.set(v.otherId, arr2);
    }
  }
  return m;
}
