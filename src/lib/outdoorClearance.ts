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
 *   - Two zone polygons overlapping  →  zone layout conflict (§10.4)
 *   - Social zone lacking shade (no tree/pergola within 6 m) →  sun discomfort
 *   - Social/private zone with no privacy screening (§10.4 top complaint)
 *   - Social zone not connected by a path  →  walkway missing (§10.4)
 *
 * The function is a pure transform: takes (items, houseFootprint, paths?) and
 * returns the violation list. The UI layer decides how to surface
 * (warning chips, ring overlays on canvas, etc).
 *
 * References: docs/yard-design-references.md §10.4 "Before" regret taxonomy.
 */

import type { YardItem, YardSingleton, YardPrefab, YardZone } from "./types";
import { isYardSingleton, isYardPrefab, isYardZone } from "./types";
import { getOutdoorAssetByKind } from "./outdoorAssets";

export type OutdoorSeverity = "required" | "recommended";
export type OutdoorViolationKind =
  | "fireHazard"
  | "tooCloseToHouse"
  | "tooFarFromHouse"
  | "overlap"
  | "zoneOverlap"      // two zone polygons intersect
  | "noShade"          // social zone lacks nearby shade
  | "noPrivacy"        // social/private zone exposed — no screening
  | "noWalkway"        // social zone not connected by a path
  | "canopyOverlap"    // two trees' mature canopies overlap (planting rule)
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

// ─── Zone polygon helpers ──────────────────────────────────

/** Zone polygon is stored relative to zone.(x,z). Convert to world coords. */
function absPolygon(zone: YardZone): [number, number][] {
  return zone.polygon.map(([rx, rz]) => [zone.x + rx, zone.z + rz] as [number, number]);
}

/** Ray-casting point-in-polygon (world cm coords). */
function pointInPoly(px: number, pz: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if (((zi > pz) !== (zj > pz)) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True if any vertex of polyA is inside polyB, or vice-versa. */
function polygonsOverlap(polyA: [number, number][], polyB: [number, number][]): boolean {
  return polyA.some(([px, pz]) => pointInPoly(px, pz, polyB))
      || polyB.some(([px, pz]) => pointInPoly(px, pz, polyA));
}

/** Polygon area in cm² via shoelace formula. */
function polyAreaCm2(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(a) / 2;
}

// ─── Main evaluator ────────────────────────────────────────

/** Path point type alias (matches YardPlan.paths element). */
type YardPathRef = { id: string; points: Array<[number, number]>; widthCm: number; material: string };

export function evaluateYardPlan(
  items: YardItem[],
  house: HouseFootprintCm,
  paths?: YardPathRef[],
): OutdoorViolation[] {
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

  // ─── Tree canopy spacing ──────────────────────────────────
  // Mature canopies should not overlap (landscape-architecture rule).
  // Two trees flagged if center-distance < sum of canopy radii − a small
  // tolerance (0.5 m). Radii come from TREE_CANOPY_RADIUS_M scaled by
  // each tree's `scale` field; falls back to 3 m for unknown kinds.
  const canopyTrees = singletons.filter(s => s.kind?.startsWith("tree."));
  if (canopyTrees.length > 1) {
    // Lazy-load the canopy radius map without a circular import — the
    // planting module is small and pure.
    const { TREE_CANOPY_RADIUS_M } = require("./yardAutoPlanting") as
      typeof import("./yardAutoPlanting");
    for (let i = 0; i < canopyTrees.length; i++) {
      for (let j = i + 1; j < canopyTrees.length; j++) {
        const a = canopyTrees[i], b = canopyTrees[j];
        const ra = (TREE_CANOPY_RADIUS_M[a.kind] ?? 3) * (a.scale ?? 1);
        const rb = (TREE_CANOPY_RADIUS_M[b.kind] ?? 3) * (b.scale ?? 1);
        const distM = Math.hypot(a.x - b.x, a.z - b.z) / 100;
        const minSep = ra + rb - 0.5;
        if (distM < minSep) {
          out.push({
            itemId: a.id,
            otherId: b.id,
            kind: "canopyOverlap",
            severity: "recommended",
            reasonZh: `两棵树冠重叠 (实际 ${distM.toFixed(1)}m, 需要 ≥${minSep.toFixed(1)}m)，将互相遮挡生长`,
            reasonEn: `Tree canopies overlap (actual ${distM.toFixed(1)} m, need ≥ ${minSep.toFixed(1)} m) — they will compete for light`,
            requiredM: minSep,
            actualM: distM,
          });
        }
      }
    }
  }

  // ─── Zone-based smart checks ──────────────────────────────
  const zones = items.filter(isYardZone);

  // ── Zone-zone polygon overlap ──
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i], b = zones[j];
      const polyA = absPolygon(a);
      const polyB = absPolygon(b);
      // Only flag if overlap area is meaningful (>0.5 m²)
      if (polygonsOverlap(polyA, polyB)) {
        out.push({
          itemId: a.id,
          otherId: b.id,
          kind: "zoneOverlap",
          severity: "recommended",
          reasonZh: `「${a.zoneKind}区」与「${b.zoneKind}区」的边界重叠，建议调整多边形使分区清晰`,
          reasonEn: `"${a.zoneKind}" and "${b.zoneKind}" zone polygons overlap — adjust edges to avoid ambiguity`,
        });
      }
    }
  }

  // ── Social zone: check for shade (tree within 6 m or pergola within 8 m) ──
  const trees = singletons.filter(it => {
    const a = getOutdoorAssetByKind(it.kind);
    return !!a && a.category === "tree";
  });
  const pergolaPs = prefabs.filter(pf => pf.prefabKind === "pergola_classic");

  for (const zone of zones) {
    if (zone.zoneKind !== "social") continue;
    const polyArea = polyAreaCm2(zone.polygon); // cm²
    if (polyArea < 4 * 10000) continue; // skip tiny zones < 4 m²

    const hasTree    = trees.some(t => Math.hypot(t.x - zone.x, t.z - zone.z) < 600);
    const hasPergola = pergolaPs.some(p => Math.hypot(p.x - zone.x, p.z - zone.z) < 800);
    if (!hasTree && !hasPergola) {
      out.push({
        itemId: zone.id,
        kind: "noShade",
        severity: "recommended",
        reasonZh: "社交区缺少遮阴 — 建议 6m 内种一棵乔木，或添加花架（夏日直射让人无法久待）",
        reasonEn: "Social zone has no shade — plant a tree within 6m or add a pergola (direct sun makes it unusable in summer)",
      });
    }
  }

  // ── Social / private zone: privacy screening check ──
  // Flag if the zone is ≥4 m from house and has no fence/hedge/slat-wall within 6 m.
  const screeningItems: YardItem[] = [
    ...singletons.filter(it => it.kind.includes("fence") || it.kind.includes("hedge") || it.kind.includes("bamboo")),
    ...prefabs.filter(pf => pf.prefabKind === "slat_wall" || pf.prefabKind === "fence_segment"),
  ];
  for (const zone of zones) {
    if (zone.zoneKind !== "social" && zone.zoneKind !== "private") continue;
    const dHouse = distToHouseM(zone.x, zone.z, house);
    if (dHouse < 4) continue; // Zone is close to the house — house wall gives some screening
    const hasScreening = screeningItems.some(s => Math.hypot(s.x - zone.x, s.z - zone.z) < 600);
    if (!hasScreening) {
      out.push({
        itemId: zone.id,
        kind: "noPrivacy",
        severity: "recommended",
        reasonZh: "该区域缺乏围挡，邻居可直接看到 — 建议添加围栏、格栅或绿篱（最高频改造投诉）",
        reasonEn: "Zone is exposed to neighbours — add a fence, slat wall, or hedge (most-cited makeover regret per §10.4)",
      });
    }
  }

  // ── Social zone: walkway connectivity ──
  // Flag if a social zone > 3 m from house has no path point within 5 m.
  for (const zone of zones) {
    if (zone.zoneKind !== "social") continue;
    const dHouse = distToHouseM(zone.x, zone.z, house);
    if (dHouse < 3) continue; // Right next to house — path not needed

    const pathPoints = (paths ?? []).flatMap(p => p.points);
    const hasNearbyPath = pathPoints.some(([px, pz]) => Math.hypot(px - zone.x, pz - zone.z) < 500);
    if (!hasNearbyPath) {
      out.push({
        itemId: zone.id,
        kind: "noWalkway",
        severity: "recommended",
        reasonZh: "社交区没有步道相连 — 建议从入口铺设路径（在工具栏选「路径」画线）",
        reasonEn: "Social zone has no walkway — draw a path from the entrance (use the Path tool in the toolbar)",
      });
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

// ─── Empty-state hints (§10.4 regret taxonomy) ────────────
// Shown in the Smart Suggestions panel when the yard is sparse,
// BEFORE any violations accumulate. Based on the 11 most common
// "before-state" complaints in real makeover posts.

export interface YardHint {
  icon: string;
  reasonZh: string;
  reasonEn: string;
}

/**
 * Returns 1-4 contextual "getting started" hints when the yard has few or no
 * items/zones. Not violations — just friendly nudges based on the §10.4
 * regret taxonomy. Returns [] when the yard is non-trivially populated.
 */
export function getEmptyStateHints(items: YardItem[]): YardHint[] {
  const zones     = items.filter(isYardZone);
  const singletons = items.filter(isYardSingleton);
  const prefabsH  = items.filter(isYardPrefab);
  const total     = items.length;

  // Yard is non-trivially populated — don't crowd the panel with hints
  if (total >= 5 && zones.length >= 1) return [];

  const hints: YardHint[] = [];

  if (total === 0) {
    hints.push(
      {
        icon: "📐",
        reasonZh: "从左侧「功能区」拖入「社交区」开始规划，覆盖区域后再细化元素",
        reasonEn: "Drag a 'Social' zone from the left panel to start — define areas first, then add elements",
      },
      {
        icon: "🛤️",
        reasonZh: "入口步道是最高 ROI 的改造：从门口铺一条路径连接休闲区（工具栏路径工具）",
        reasonEn: "An entry walkway is the highest-ROI change — draw a path from the entrance (Path tool in toolbar)",
      },
      {
        icon: "🌳",
        reasonZh: "最常见的投诉：「完全没隐私』—— 一排绿篱或围栏就能解决",
        reasonEn: "Most-cited regret: 'no privacy from neighbours' — a hedge or fence screen fixes it",
      },
    );
    return hints;
  }

  if (zones.length === 0) {
    hints.push({
      icon: "📍",
      reasonZh: "还没有功能区 — 先划定「社交区」或「草坪」，智能建议才能检查遮阴/隐私问题",
      reasonEn: "No zones yet — define a 'Social' or 'Lawn' zone so smart-checks can run",
    });
  }

  // Has items but no paths — suggest entry walkway
  const hasAnyPath = false; // paths not accessible here; hint is cheap to show
  if (!hasAnyPath && total < 8) {
    hints.push({
      icon: "🛤️",
      reasonZh: "缺少步道 — 用工具栏「路径」工具从入口画到休闲区（高频改造投诉 §10.4）",
      reasonEn: "No paths drawn — use the Path tool to connect entrance to social area (§10.4 top complaint)",
    });
  }

  // Has plants but no privacy screening
  const hasScreening = [
    ...singletons.filter(it => it.kind.includes("fence") || it.kind.includes("hedge") || it.kind.includes("bamboo")),
    ...prefabsH.filter(pf => pf.prefabKind === "slat_wall" || pf.prefabKind === "fence_segment"),
  ].length > 0;
  if (!hasScreening && total < 10) {
    hints.push({
      icon: "🔒",
      reasonZh: "还没有隐私围挡 — 围栏、格栅或竹篱是最常被省略、事后最后悔的一步",
      reasonEn: "No privacy screening yet — fence or hedge is the most-skipped, most-regretted element",
    });
  }

  return hints.slice(0, 3); // at most 3 hints to avoid clutter
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
