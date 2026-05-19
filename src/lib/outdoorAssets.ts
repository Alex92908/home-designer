/**
 * Outdoor asset library — bridges the Kenney Nature Kit GLB models to our
 * yardPlan data model.
 *
 * Each asset has:
 *   - kind        — stable id stored on YardItem.kind
 *   - label/icon  — for the picker UI
 *   - category    — which library tab it appears under
 *   - glb         — Kenney GLB filename (under /public/models/kenney_nature/)
 *   - scale       — uniform scale to apply when instancing in the 3D scene
 *                   (Kenney models are ~0.4m per unit so we boost ~3-6×)
 *   - radiusCm    — visual radius on the 2D plan (drives the SVG circle size
 *                   and reads as the asset's footprint)
 *   - color       — fallback colour used in the 2D plan circle
 */

export type OutdoorCategory = "tree" | "plant" | "rock" | "feature" | "furniture";

export const OUTDOOR_CATEGORIES: Array<{ id: OutdoorCategory; label: string; icon: string }> = [
  { id: "tree",      label: "树木", icon: "🌳" },
  { id: "plant",     label: "花卉", icon: "🌸" },
  { id: "rock",      label: "山石", icon: "🪨" },
  { id: "feature",   label: "设施", icon: "🏛" },
  { id: "furniture", label: "家具", icon: "🛋" },
];

export interface OutdoorAsset {
  kind: string;
  label: string;
  icon: string;
  category: OutdoorCategory;
  glb: string;          // Kenney filename without path / extension (legacy fallback)
  scale: number;        // 3D scale multiplier
  radiusCm: number;     // visual footprint on the 2D plan
  color: string;        // 2D plan circle fill
  /** Optional override: full path to a richer GLB / GLTF (e.g.
   *  Sketchfab CC-BY model under /public/models/outdoor_tree/<slug>/<slug>.gltf).
   *  When set, the 3D renderer uses this instead of the Kenney fallback,
   *  AND skips the technical-drawing flat-shading / outline override
   *  (real PBR materials shine through). The asset is downloaded by
   *  scripts/download-sketchfab.mjs — if the file is missing the
   *  renderer falls back to the Kenney GLB. */
  customGltfPath?: string;
  /** Target real-world HEIGHT in metres for the customGltfPath model.
   *  At render time we read the model's bounding box and auto-compute
   *  a scale factor that lands at this height — bulletproof against
   *  Sketchfab's wildly varying native units (some models are 1 unit
   *  = 1cm, others 1 unit = 1m, others arbitrary).
   *  Typical heights: hero olive 5-6m, palm 7m, cypress 4m, bonsai 0.6m,
   *  hedge 1.2m, boxwood 0.6m. */
  customTargetHeightM?: number;
  /** Legacy: raw scale multiplier. Used only if customTargetHeightM
   *  isn't set. Prefer customTargetHeightM for new entries. */
  customScale?: number;
  /** When true, also re-position the model so its base sits exactly
   *  at y=0 (the ground plane) rather than relying on the model's
   *  authored pivot. Default true — most landscape assets want this. */
  customGroundAlign?: boolean;
  /** Author credit shown in About page when customGltfPath is used. */
  customAuthor?: string;

  // ── Purchase metadata (for the "Get Quote" feature) ──────────────────────
  /** Retail price in CNY (¥). Shown in the quote sheet. */
  estimatedPriceCNY?: number;
  /** Brand name (e.g. "Kettal", "B&B Italia Outdoor"). */
  brand?: string;
  /** Purchase / product page URL for the "Buy" button in the quote sheet. */
  purchaseUrl?: string;
}

export const OUTDOOR_ASSET_LIBRARY: OutdoorAsset[] = [
  // ── Trees ──
  // customGltfPath points at a Sketchfab CC-BY model (downloaded via
  // scripts/download-sketchfab.mjs). At runtime, if the file exists the
  // renderer uses the real PBR model; if not, falls back to the Kenney
  // GLB at `glb`. So the schema works in both states.
  { kind: "tree.oak",      label: "橡树",   icon: "🌳", category: "tree",    glb: "tree_oak",          scale: 4.5, radiusCm: 130, color: "#5C8A3F" },
  { kind: "tree.pine",     label: "松树",   icon: "🌲", category: "tree",    glb: "tree_pineDefaultA", scale: 5.0, radiusCm: 110, color: "#3F6B45" },
  // PBR Sketchfab models are auto-normalised at render time. We just
  // declare the desired real-world HEIGHT in metres (customTargetHeightM)
  // and the renderer reads each model's bounding box and computes the
  // scale. Bulletproof against the model's native units (cm, m, inches).
  { kind: "tree.cypress",  label: "柏树",   icon: "🌲", category: "tree",    glb: "tree_pineTallA",    scale: 6.0, radiusCm: 80,  color: "#345A2E",
    customGltfPath: "/models/outdoor_tree/cypress_tree_lowpoly/cypress_tree_lowpoly.gltf",
    customTargetHeightM: 4.5, customAuthor: "Alan Zimmerman" },
  // Palm: switched to `palm_tree_lowpoly` (Connor_Appleton) — opaque
  // foliage planes, no alpha cutout issues.
  { kind: "tree.palm",     label: "棕榈",   icon: "🌴", category: "tree",    glb: "tree_palmTall",     scale: 5.5, radiusCm: 120, color: "#7BA058",
    customGltfPath: "/models/outdoor_tree/palm_tree_lowpoly/palm_tree_lowpoly.gltf",
    customTargetHeightM: 6.5, customAuthor: "Connor_Appleton" },
  { kind: "tree.olive",    label: "橄榄",   icon: "🫒", category: "tree",    glb: "tree_default",      scale: 4.0, radiusCm: 120, color: "#9FA078",
    customGltfPath: "/models/outdoor_tree/old_olive_tree/old_olive_tree.gltf",
    customTargetHeightM: 5.0, customAuthor: "massive-graphisme" },
  { kind: "tree.maple",    label: "枫树",   icon: "🍁", category: "tree",    glb: "tree_oak",          scale: 4.5, radiusCm: 130, color: "#C97A3F",
    customGltfPath: "/models/outdoor_tree/japanese_maple/japanese_maple.gltf",
    customTargetHeightM: 4.5, customAuthor: "OliverMatheGames" },
  { kind: "tree.bonsai",   label: "盆栽",   icon: "🪴", category: "tree",    glb: "tree_blocks",       scale: 2.8, radiusCm: 60,  color: "#5C8A3F",
    customGltfPath: "/models/outdoor_tree/bonsai_lowpoly/bonsai_lowpoly.gltf",
    customTargetHeightM: 0.6, customAuthor: "Alice Ursu" },

  // ── Plants ──
  // shrub_01 .bin 截断 → 走程序化 fallback（同 crystalline_iceplant）
  { kind: "plant.bushLarge",   label: "大灌木", icon: "🌿", category: "plant", glb: "plant_bushLarge",     scale: 2.4, radiusCm: 60, color: "#5E8A3A" },
  { kind: "plant.bushSmall",   label: "小灌木", icon: "🌱", category: "plant", glb: "plant_bushSmall",     scale: 1.8, radiusCm: 45, color: "#6B9C45",
    customGltfPath: "/models/outdoor_shrub/shrub_02/shrub_02_1k.gltf",
    customTargetHeightM: 0.6, customAuthor: "Poly Haven CC0" },
  { kind: "plant.flowerRed",   label: "红掌",   icon: "🌹", category: "plant", glb: "flower_redA",    scale: 1.5, radiusCm: 30, color: "#E04848",
    customGltfPath: "/models/outdoor_plant/anthurium_botany_01/anthurium_botany_01_1k.gltf",
    customTargetHeightM: 0.65, customAuthor: "Poly Haven CC0" },
  { kind: "plant.flowerYellow",label: "蒲公英", icon: "🌻", category: "plant", glb: "flower_yellowA", scale: 1.5, radiusCm: 30, color: "#E8B838",
    customGltfPath: "/models/outdoor_plant/dandelion_01/dandelion_01_1k.gltf",
    customTargetHeightM: 0.28, customAuthor: "Poly Haven CC0" },
  { kind: "plant.flowerPurple",label: "白屈菜", icon: "💜", category: "plant", glb: "flower_purpleA", scale: 1.5, radiusCm: 30, color: "#9F5BC8",
    customGltfPath: "/models/outdoor_plant/celandine_01/celandine_01_1k.gltf",
    customTargetHeightM: 0.25, customAuthor: "Poly Haven CC0" },
  { kind: "plant.grass",       label: "冰草",   icon: "🌾", category: "plant", glb: "grass_large",    scale: 1.6, radiusCm: 35, color: "#7CA45A",
    customGltfPath: "/models/outdoor_plant/crystalline_iceplant/crystalline_iceplant_1k.gltf",
    customTargetHeightM: 0.15, customAuthor: "Poly Haven CC0" },
  { kind: "plant.cactus",      label: "仙人掌", icon: "🌵", category: "plant", glb: "cactus_tall",    scale: 2.5, radiusCm: 35, color: "#5A8B5A",
    customGltfPath: "/models/outdoor_plant/cheiridopsis_succulent/cheiridopsis_succulent_1k.gltf",
    customTargetHeightM: 0.22, customAuthor: "Poly Haven CC0" },
  { kind: "plant.lily",        label: "海芋",   icon: "🪷", category: "plant", glb: "lily_large",          scale: 1.8, radiusCm: 40, color: "#E8A8C8",
    customGltfPath: "/models/outdoor_plant/calathea_orbifolia_01/calathea_orbifolia_01_1k.gltf",
    customTargetHeightM: 0.5, customAuthor: "Poly Haven CC0" },
  { kind: "plant.mushroom",    label: "蘑菇",   icon: "🍄", category: "plant", glb: "mushroom_redGroup",   scale: 1.5, radiusCm: 30, color: "#D04848" },

  // ── Rocks ──
  { kind: "rock.large",      label: "大岩石", icon: "🪨", category: "rock", glb: "rock_largeA",     scale: 2.5, radiusCm: 70, color: "#888888",
    customGltfPath: "/models/outdoor_rock/boulder_01/boulder_01_1k.gltf",
    customTargetHeightM: 0.8, customAuthor: "Poly Haven CC0" },
  { kind: "rock.small",      label: "小岩石", icon: "🪨", category: "rock", glb: "rock_smallA",     scale: 1.8, radiusCm: 40, color: "#9C9C9C",
    customGltfPath: "/models/outdoor_rock/coast_rocks_01/coast_rocks_01_1k.gltf",
    customTargetHeightM: 0.4, customAuthor: "Poly Haven CC0" },
  { kind: "rock.tall",       label: "立石",   icon: "🗿", category: "rock", glb: "rock_tallA",      scale: 2.2, radiusCm: 50, color: "#7C7C7C" },
  { kind: "rock.flat",       label: "平石",   icon: "⬜", category: "rock", glb: "rock_smallFlatA", scale: 2.0, radiusCm: 60, color: "#A8A8A8" },
  { kind: "rock.stoneTall",  label: "高石",   icon: "🗻", category: "rock", glb: "stone_tallA",     scale: 2.2, radiusCm: 45, color: "#9C8C7C" },

  // ── Features ──
  { kind: "feature.fence",       label: "栅栏",   icon: "🚧", category: "feature", glb: "fence_planks",         scale: 2.0, radiusCm: 80,  color: "#8A6A40" },
  { kind: "feature.fenceGate",   label: "栅栏门", icon: "🚪", category: "feature", glb: "fence_gate",           scale: 2.0, radiusCm: 60,  color: "#A88A60" },
  { kind: "feature.bridgeWood",  label: "木桥",   icon: "🌉", category: "feature", glb: "bridge_wood",          scale: 2.5, radiusCm: 100, color: "#7A5A30" },
  { kind: "feature.campfire",    label: "篝火",   icon: "🔥", category: "feature", glb: "campfire_logs",        scale: 1.6, radiusCm: 50,  color: "#D87830" },
  { kind: "feature.tent",        label: "帐篷",   icon: "⛺", category: "feature", glb: "tent_smallOpen",       scale: 2.0, radiusCm: 80,  color: "#C8A858" },
  { kind: "feature.pathStone",   label: "石板路", icon: "🪨", category: "feature", glb: "path_stoneCircle",     scale: 2.0, radiusCm: 60,  color: "#A0A0A0" },
  { kind: "feature.signPost",    label: "指示牌", icon: "🪧", category: "feature", glb: "sign",                 scale: 1.8, radiusCm: 30,  color: "#A88A60" },
  { kind: "feature.canoe",       label: "独木舟", icon: "🛶", category: "feature", glb: "canoe",                scale: 1.8, radiusCm: 80,  color: "#8A5A30" },
  { kind: "feature.cropCarrot",  label: "胡萝卜", icon: "🥕", category: "feature", glb: "crop_carrot",          scale: 2.0, radiusCm: 30,  color: "#E8852A" },
  { kind: "feature.cropPumpkin", label: "南瓜",   icon: "🎃", category: "feature", glb: "crop_pumpkin",         scale: 2.0, radiusCm: 35,  color: "#E07A20" },
  { kind: "feature.cropMelon",   label: "西瓜",   icon: "🍉", category: "feature", glb: "crop_melon",           scale: 2.0, radiusCm: 35,  color: "#5BA84A" },
  { kind: "feature.cropCorn",    label: "玉米",   icon: "🌽", category: "feature", glb: "crops_cornStageD",     scale: 2.5, radiusCm: 30,  color: "#E8C840" },
  { kind: "feature.cropBamboo",  label: "竹子",   icon: "🎋", category: "feature", glb: "crops_bambooStageB",   scale: 3.0, radiusCm: 35,  color: "#7CA45A" },
  { kind: "feature.cropDirt",    label: "菜畦",   icon: "🟫", category: "feature", glb: "crops_dirtRow",        scale: 2.5, radiusCm: 80,  color: "#7A5A40" },

  // ── Outdoor Furniture — photorealistic Sketchfab PBR models ──
  // When customGltfPath model is present (after running download-sketchfab.mjs)
  // the renderer uses the real PBR GLTF. Before download, a high-quality
  // procedural mesh (ProceduralFurnitureMesh in HouseCanvas) acts as fallback.
  { kind: "furniture.chaiseLounger", label: "躺椅",     icon: "🛋", category: "furniture",
    glb: "", scale: 1, radiusCm: 110, color: "#D4C4A0",
    customGltfPath: "/models/outdoor_furniture/sun_lounger/sun_lounger.gltf",
    customTargetHeightM: 0.85, customGroundAlign: true, customAuthor: "Sketchfab CC-BY",
    brand: "Kettal", estimatedPriceCNY: 12800,
    purchaseUrl: "https://www.kettal.com/en/products/outdoor-lounge/chaise-lounges" },
  { kind: "furniture.outdoorSofa",   label: "户外沙发", icon: "🛋", category: "furniture",
    glb: "", scale: 1, radiusCm: 160, color: "#C8C0A8",
    customGltfPath: "/models/outdoor_furniture/outdoor_sofa/outdoor_sofa.gltf",
    customTargetHeightM: 0.90, customGroundAlign: true, customAuthor: "Sketchfab CC-BY",
    brand: "Dedon", estimatedPriceCNY: 28000,
    purchaseUrl: "https://www.dedon.de/en/outdoor-sofas" },
  { kind: "furniture.parasol",       label: "遮阳伞",   icon: "⛱", category: "furniture",
    glb: "", scale: 1, radiusCm: 200, color: "#F5EDD8",
    customGltfPath: "/models/outdoor_furniture/garden_parasol/garden_parasol.gltf",
    customTargetHeightM: 2.60, customGroundAlign: true, customAuthor: "Sketchfab CC-BY",
    brand: "Jardinico", estimatedPriceCNY: 9800,
    purchaseUrl: "https://www.jardinico.com/products/parasols" },
  { kind: "furniture.coffeeTable",   label: "户外茶几", icon: "🪵", category: "furniture",
    glb: "", scale: 1, radiusCm: 65,  color: "#A8A0A0",
    customGltfPath: "/models/outdoor_furniture/garden_coffee_table/garden_coffee_table.gltf",
    customTargetHeightM: 0.45, customGroundAlign: true, customAuthor: "Sketchfab CC-BY",
    brand: "Tribu", estimatedPriceCNY: 6800,
    purchaseUrl: "https://www.tribuliving.com/collections/outdoor-tables" },
  { kind: "furniture.diningSet",     label: "户外餐桌", icon: "🍽", category: "furniture",
    glb: "", scale: 1, radiusCm: 180, color: "#C8B8A0",
    customGltfPath: "/models/outdoor_furniture/outdoor_dining_set/outdoor_dining_set.gltf",
    customTargetHeightM: 0.75, customGroundAlign: true, customAuthor: "Sketchfab CC-BY",
    brand: "Gloster", estimatedPriceCNY: 38000,
    purchaseUrl: "https://www.gloster.com/dining-sets" },
  { kind: "furniture.fireplace",     label: "户外壁炉", icon: "🔥", category: "furniture",
    glb: "", scale: 1, radiusCm: 90,  color: "#787068",
    customGltfPath: "/models/outdoor_furniture/outdoor_fireplace/outdoor_fireplace.gltf",
    customTargetHeightM: 1.10, customGroundAlign: true, customAuthor: "Sketchfab CC-BY",
    brand: "EcoSmart Fire", estimatedPriceCNY: 22000,
    purchaseUrl: "https://www.ecosmartfire.com/outdoor-fireplaces" },
  { kind: "furniture.planter",       label: "花盆",     icon: "🌺", category: "furniture",
    glb: "", scale: 1, radiusCm: 55,  color: "#C8A882",
    customGltfPath: "/models/outdoor_furniture/large_planter/large_planter.gltf",
    customTargetHeightM: 0.65, customGroundAlign: true, customAuthor: "Sketchfab CC-BY",
    brand: "Vondom", estimatedPriceCNY: 3200,
    purchaseUrl: "https://www.vondom.com/products/planters" },
  { kind: "furniture.swimmingLounger",label: "泳池躺椅",icon: "🏖", category: "furniture",
    glb: "", scale: 1, radiusCm: 110, color: "#E8E0C8",
    customGltfPath: "/models/outdoor_furniture/sun_lounger/sun_lounger.gltf",
    customTargetHeightM: 0.75, customGroundAlign: true, customAuthor: "Sketchfab CC-BY",
    brand: "Unopiù", estimatedPriceCNY: 8800,
    purchaseUrl: "https://www.unopiu.com/en/pool-loungers" },
];

// ─── Prefab purchase catalog ──────────────────────────────────────────────────
/** Purchase metadata for compound prefabs (pool, pergola, etc.).
 *  Keyed by PrefabKind. */
export const PREFAB_PURCHASE: Record<string, {
  label: string;
  brand: string;
  estimatedPriceCNY: number;
  purchaseUrl: string;
}> = {
  pool:            { label: "无边际泳池",   brand: "Compass Pools",   estimatedPriceCNY: 280000, purchaseUrl: "https://www.compasspools.com" },
  social_island:   { label: "社交岛 + 火坑", brand: "Extremis",        estimatedPriceCNY: 68000,  purchaseUrl: "https://www.extremis.com" },
  pergola_classic: { label: "钢木廊架",      brand: "Unopiù",          estimatedPriceCNY: 45000,  purchaseUrl: "https://www.unopiu.com/en/pergolas" },
  outdoor_kitchen: { label: "户外厨房",      brand: "Higold",          estimatedPriceCNY: 58000,  purchaseUrl: "https://www.higold.com/outdoor-kitchen" },
  fountain:        { label: "石材喷泉",      brand: "Serena & Lily",   estimatedPriceCNY: 12000,  purchaseUrl: "https://www.serenaandlily.com/fountains" },
  farm_box:        { label: "高床菜箱",      brand: "Vego Garden",     estimatedPriceCNY: 3800,   purchaseUrl: "https://www.vegogarden.com" },
  porte_cochere:   { label: "混凝土车棚",    brand: "自建",             estimatedPriceCNY: 95000,  purchaseUrl: "" },
  slat_wall:       { label: "竖板隐私屏",    brand: "Toja Grid",       estimatedPriceCNY: 8800,   purchaseUrl: "https://www.tojagrid.com" },
  fence_segment:   { label: "现代木栅栏",    brand: "Trex",            estimatedPriceCNY: 4200,   purchaseUrl: "https://www.trex.com/fencing" },
  parking_area:    { label: "砾石停车位",    brand: "自建",             estimatedPriceCNY: 18000,  purchaseUrl: "" },
};

export function getOutdoorAssetByKind(kind: string): OutdoorAsset | undefined {
  return OUTDOOR_ASSET_LIBRARY.find(a => a.kind === kind);
}

/** Curated yard presets — one click drops a fully-staged scene into the
 *  user's empty yardPlan so the very first 3D view is impressive instead
 *  of an empty lawn. Coords are world cm centred on house origin.
 *
 *  v2 schema (2026-04): items can be singletons, prefabs, or zones —
 *  the discriminated YardItem union. Each entry omits the id (filled in
 *  at apply time by the caller). The cleanest preset has at most ~12
 *  items: 2-3 zones + 2-4 prefabs + 1-2 hero trees + a sprinkle of
 *  legacy singletons for boundary / garnish. */
import type { YardItem, YardSingleton, YardPrefab, YardZone } from "./types";
import { rectZone } from "./outdoorZones";

// Distributive Omit — preserves the discriminated union so all variant-specific
// fields (zoneKind, prefabKind, kind…) remain visible to TypeScript.
export type YardPresetItem =
  | Omit<YardSingleton, "id">
  | Omit<YardPrefab,    "id">
  | Omit<YardZone,      "id">;

export interface YardPreset {
  id: string;
  label: string;
  icon: string;
  desc: string;
  items: YardPresetItem[];
}

export const YARD_PRESETS: YardPreset[] = [
  // ───── 1. Modern Villa — the marquee preset, shows everything new ─────
  // Replaces the cluttered "地中海别墅". Three zones in clean linear flow:
  // utility (entry, north) → social (between house and pool, south) →
  // private (east). 8 items total, vs the old 23.
  {
    id: "modernVilla",
    label: "现代别墅",
    icon: "🏛",
    desc: "三环叙事流：入户·社交·私享 — Prefab 主导",
    items: [
      // Utility ring (driveway zone behind the house, n side)
      { type: "zone", zoneKind: "utility",
        x: 0, z: -900,
        polygon: rectZone(1000, 600), rot: 0 },
      { type: "prefab", prefabKind: "porte_cochere",
        x: 0, z: -900, rot: 0,
        params: { carCount: 2, pillarStyle: "round", facingDir: "south" } },
      // Social ring (front patio + island)
      { type: "zone", zoneKind: "social",
        x: 0, z: 600,
        polygon: rectZone(900, 600), rot: 0 },
      { type: "prefab", prefabKind: "social_island",
        x: -300, z: 600, rot: 0,
        params: { sizeM: { w: 5, d: 4 }, fireFeature: "pit", kitchenFacing: "north", sunkenSeat: true } },
      // Pool — the centerpiece of any modern villa, dropped as a draggable Prefab
      { type: "prefab", prefabKind: "pool", x: 400, z: 700, rot: 0 },
      // Private ring (right side wood deck) + outdoor kitchen
      { type: "zone", zoneKind: "private",
        x: 1100, z: 0,
        polygon: rectZone(500, 700), rot: 0 },
      { type: "prefab", prefabKind: "outdoor_kitchen", x: 1100, z: 0, rot: 0 },
      // Boundary screen on the west side — long slat wall
      { type: "prefab", prefabKind: "slat_wall",
        x: -1100, z: 0, rot: Math.PI / 2,
        params: { lengthM: 8, heightM: 1.8, slatCm: 5, gapCm: 2, backWall: true } },
      // Hero trees — 1 olive (sculptural), 1 maple (autumn focal)
      { type: "singleton", kind: "tree.olive", x: -800, z: -200, scale: 1.4 },
      { type: "singleton", kind: "tree.maple", x:  800, z: -500, scale: 1.4 },
    ],
  },

  // ───── 2. Mediterranean — keep formal cypress axis, add social_island ─
  {
    id: "mediterranean",
    label: "地中海别墅",
    icon: "🌊",
    desc: "柏树轴线 + 社交岛 — 轴线对称",
    items: [
      // Social ring (front yard, between cypress wings)
      { type: "zone", zoneKind: "social",
        x: 0, z: 500,
        polygon: rectZone(800, 500), rot: 0 },
      { type: "prefab", prefabKind: "social_island",
        x: 0, z: 500, rot: 0,
        params: { sizeM: { w: 6, d: 4 }, fireFeature: "table", kitchenFacing: "north", sunkenSeat: false } },
      // Lawn ring on the back side (formal lawn)
      { type: "zone", zoneKind: "lawn",
        x: 0, z: -700,
        polygon: rectZone(1400, 500), rot: 0 },
      // Cypress sentinels (formal axis along the front) — kept as singletons
      { type: "singleton", kind: "tree.cypress", x: -700, z: -1000 },
      { type: "singleton", kind: "tree.cypress", x: -350, z: -1000 },
      { type: "singleton", kind: "tree.cypress", x:  350, z: -1000 },
      { type: "singleton", kind: "tree.cypress", x:  700, z: -1000 },
      // Hero olive (left side, off-axis)
      { type: "singleton", kind: "tree.olive", x: -1000, z: 0, scale: 1.5 },
      { type: "singleton", kind: "tree.olive", x:  1000, z: 0, scale: 1.5 },
    ],
  },

  // ───── 3. Japanese Zen — private wood deck + maple + bamboo wall ──────
  {
    id: "japanese",
    label: "日式禅意",
    icon: "🎋",
    desc: "私享木台 + 孤植枫 + 竹格栅",
    items: [
      // Private ring (centered wood deck for tea ceremony)
      { type: "zone", zoneKind: "private",
        x: 0, z: 200,
        polygon: rectZone(700, 600), rot: 0 },
      // East-side bamboo grove behind a slat wall (虚实结合)
      { type: "prefab", prefabKind: "slat_wall",
        x: 900, z: 0, rot: Math.PI / 2,
        params: { lengthM: 9, heightM: 2.0, slatCm: 4, gapCm: 3, backWall: false } },
      // Hero maple (focal point of the deck)
      { type: "singleton", kind: "tree.maple", x: -300, z: 200, scale: 1.6 },
      // Bamboo grove behind the slat wall (legacy singletons, gives texture)
      { type: "singleton", kind: "feature.cropBamboo", x:  950, z: -200 },
      { type: "singleton", kind: "feature.cropBamboo", x: 1000, z:    0 },
      { type: "singleton", kind: "feature.cropBamboo", x:  950, z:  200 },
      // Rock garden (枯山水) on the west — cluster, dry stones
      { type: "singleton", kind: "rock.large",     x: -900, z:    0 },
      { type: "singleton", kind: "rock.tall",      x: -1000, z:  150 },
      { type: "singleton", kind: "rock.flat",      x: -800, z:  150 },
      { type: "singleton", kind: "rock.stoneTall", x: -850, z: -100 },
    ],
  },

  // ───── 4. Farm Estate — agro zone with raised beds + entry ────────────
  {
    id: "farmEstate",
    label: "田园农庄",
    icon: "🌾",
    desc: "抬高床菜园 + 入户挑檐 + 边界橡树",
    items: [
      // Utility entry (driveway side, north)
      { type: "zone", zoneKind: "utility",
        x: 0, z: -900,
        polygon: rectZone(900, 500), rot: 0 },
      { type: "prefab", prefabKind: "porte_cochere",
        x: 0, z: -900, rot: 0,
        params: { carCount: 1, pillarStyle: "square", facingDir: "south" } },
      // Agro ring (the farm) on the right
      { type: "zone", zoneKind: "agro",
        x: 800, z: 500,
        polygon: rectZone(700, 500), rot: 0 },
      { type: "prefab", prefabKind: "farm_box",
        x: 800, z: 500, rot: 0,
        params: { bedCount: 4, bedShape: "rect", cropMix: "mixed", pathBetween: true } },
      // Social ring on the left (smaller — farm is the hero here)
      { type: "zone", zoneKind: "social",
        x: -700, z: 400,
        polygon: rectZone(500, 400), rot: 0 },
      { type: "prefab", prefabKind: "social_island",
        x: -700, z: 400, rot: 0,
        params: { sizeM: { w: 5, d: 3.5 }, fireFeature: "pit", kitchenFacing: "south", sunkenSeat: true } },
      // Boundary oaks (4 corners) — legacy singletons, gives the estate
      // its characteristic tree mass
      { type: "singleton", kind: "tree.oak", x: -1200, z: -700, scale: 1.3 },
      { type: "singleton", kind: "tree.oak", x:  1200, z: -700, scale: 1.3 },
      { type: "singleton", kind: "tree.oak", x: -1200, z:  900, scale: 1.3 },
      { type: "singleton", kind: "tree.oak", x:  1200, z:  900, scale: 1.3 },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // 5 BILLIONAIRE-INSPIRED PRESETS (added 2026-04 — visual reference:
  // user-supplied Antonovich, Trump Mar-a-Lago, Li Ka-shing Deep Water
  // Bay, classical Japanese karesansui, Tuscan villa references).
  //
  // Common DNA across these: AXIAL SYMMETRY, lots of REPEATED elements
  // (allée of 6-8 identical cypress / palms), MULTIPLE zones to layer
  // narratives, and a strong CENTRAL focal point. The previous 4
  // presets were "house with garden"; these are "estate".
  // ──────────────────────────────────────────────────────────────────

  // ───── 5. Mar-a-Lago 风 — Mediterranean Revival 庄园 ─────
  // Spanish Colonial roots, formal palm allée flanking entry, large
  // central paved courtyard with ornate fountain feel, terracotta zones.
  {
    id: "marALago",
    label: "Mar-a-Lago 风",
    icon: "🌴",
    desc: "棕榈轴线 + 形式化露台 + 喷池 — Trump estate 风",
    items: [
      // Grand entry zone (driveway with cobble feel via concrete)
      { type: "zone", zoneKind: "utility",
        x: 0, z: -1200,
        polygon: rectZone(1400, 500), rot: 0 },
      { type: "prefab", prefabKind: "porte_cochere",
        x: 0, z: -1100, rot: 0,
        params: { carCount: 3, pillarStyle: "round", facingDir: "south" } },
      // Central social ring — large terracotta-feel paving (travertine)
      { type: "zone", zoneKind: "social",
        x: 0, z: 200,
        polygon: rectZone(1000, 800), rot: 0 },
      { type: "prefab", prefabKind: "social_island",
        x: 0, z: 200, rot: 0,
        params: { sizeM: { w: 8, d: 5 }, fireFeature: "table", kitchenFacing: "north", sunkenSeat: false } },
      // Lawn ring at the back (formal lawn for evening events)
      { type: "zone", zoneKind: "lawn",
        x: 0, z: 1100,
        polygon: rectZone(1600, 500), rot: 0 },
      // Pool — Mar-a-Lago wouldn't be Mar-a-Lago without one
      { type: "prefab", prefabKind: "pool", x: -400, z: 250, rot: 0 },
      // Outdoor kitchen flanking the pool
      { type: "prefab", prefabKind: "outdoor_kitchen", x: 500, z: 200, rot: 0 },
      // Central fountain on the formal axis
      { type: "prefab", prefabKind: "fountain", x: 0, z: -300, rot: 0 },
      // ── Palm allée — 8 palms in 2 rows of 4, formal grid ──
      { type: "singleton", kind: "tree.palm", x: -700, z: -700, scale: 1.5 },
      { type: "singleton", kind: "tree.palm", x: -300, z: -700, scale: 1.5 },
      { type: "singleton", kind: "tree.palm", x:  300, z: -700, scale: 1.5 },
      { type: "singleton", kind: "tree.palm", x:  700, z: -700, scale: 1.5 },
      { type: "singleton", kind: "tree.palm", x: -700, z:  700, scale: 1.5 },
      { type: "singleton", kind: "tree.palm", x: -300, z:  700, scale: 1.5 },
      { type: "singleton", kind: "tree.palm", x:  300, z:  700, scale: 1.5 },
      { type: "singleton", kind: "tree.palm", x:  700, z:  700, scale: 1.5 },
      // Boundary cypress — 4 corners, formal vertical accent
      { type: "singleton", kind: "tree.cypress", x: -1300, z: -1300 },
      { type: "singleton", kind: "tree.cypress", x:  1300, z: -1300 },
      { type: "singleton", kind: "tree.cypress", x: -1300, z:  1300 },
      { type: "singleton", kind: "tree.cypress", x:  1300, z:  1300 },
      // Boxwood parterre — low formal hedges flanking allée
      { type: "singleton", kind: "tree.bonsai", x: -500, z: 0 },
      { type: "singleton", kind: "tree.bonsai", x:  500, z: 0 },
      { type: "singleton", kind: "tree.bonsai", x: -500, z: 400 },
      { type: "singleton", kind: "tree.bonsai", x:  500, z: 400 },
    ],
  },

  // ───── 6. Versailles Mini — 凡尔赛缩影 ─────
  // Strict bilateral symmetry. Central axis with reflecting-pool feel
  // (we use a long social zone). Boxwood parterre on each side. Cypress
  // and olive sentinels frame the axis. The most formal of the bunch.
  {
    id: "versailles",
    label: "凡尔赛缩影",
    icon: "⚜",
    desc: "极致轴对称 · 大型几何花坛 · 喷池轴线",
    items: [
      // CENTRAL AXIS — long thin social zone (reflecting pool stand-in)
      { type: "zone", zoneKind: "social",
        x: 0, z: 0,
        polygon: rectZone(400, 1800), rot: 0 },
      // Central axis fountain (the ceremonial focal point)
      { type: "prefab", prefabKind: "fountain", x: 0, z: -700, rot: 0 },
      { type: "prefab", prefabKind: "social_island",
        x: 0, z: 700, rot: 0,
        params: { sizeM: { w: 4, d: 5 }, fireFeature: "table", kitchenFacing: "north", sunkenSeat: false } },
      // ── Two side parterre zones (formal hedge gardens) ──
      { type: "zone", zoneKind: "agro",
        x: -700, z: 0,
        polygon: rectZone(700, 1800), rot: 0 },
      { type: "zone", zoneKind: "agro",
        x:  700, z: 0,
        polygon: rectZone(700, 1800), rot: 0 },
      // Slat walls as boundary on left/right (the "garden walls")
      { type: "prefab", prefabKind: "slat_wall",
        x: -1150, z: 0, rot: Math.PI / 2,
        params: { lengthM: 18, heightM: 1.6, slatCm: 4, gapCm: 2, backWall: true } },
      { type: "prefab", prefabKind: "slat_wall",
        x:  1150, z: 0, rot: Math.PI / 2,
        params: { lengthM: 18, heightM: 1.6, slatCm: 4, gapCm: 2, backWall: true } },
      // ── Cypress sentinels — perfect mirror, 8 trees ──
      { type: "singleton", kind: "tree.cypress", x: -350, z: -800 },
      { type: "singleton", kind: "tree.cypress", x:  350, z: -800 },
      { type: "singleton", kind: "tree.cypress", x: -350, z: -400 },
      { type: "singleton", kind: "tree.cypress", x:  350, z: -400 },
      { type: "singleton", kind: "tree.cypress", x: -350, z:  400 },
      { type: "singleton", kind: "tree.cypress", x:  350, z:  400 },
      { type: "singleton", kind: "tree.cypress", x: -350, z:  800 },
      { type: "singleton", kind: "tree.cypress", x:  350, z:  800 },
      // Boxwood parterre — many low bushes in geometric grid
      { type: "singleton", kind: "plant.bushSmall", x: -800, z: -600 },
      { type: "singleton", kind: "plant.bushSmall", x:  800, z: -600 },
      { type: "singleton", kind: "plant.bushSmall", x: -800, z: -200 },
      { type: "singleton", kind: "plant.bushSmall", x:  800, z: -200 },
      { type: "singleton", kind: "plant.bushSmall", x: -800, z:  200 },
      { type: "singleton", kind: "plant.bushSmall", x:  800, z:  200 },
      { type: "singleton", kind: "plant.bushSmall", x: -800, z:  600 },
      { type: "singleton", kind: "plant.bushSmall", x:  800, z:  600 },
      // Hero olives at the far end (anchors the long axis)
      { type: "singleton", kind: "tree.olive", x: -150, z: -1200, scale: 1.5 },
      { type: "singleton", kind: "tree.olive", x:  150, z: -1200, scale: 1.5 },
    ],
  },

  // ───── 7. Li Ka-shing 现代山顶 — Modern hilltop estate ─────
  // Minimal modern, panoramic-view orientation (one side opens out),
  // infinity-pool feel via a long social zone + dark-paved private deck.
  // Mature mass plantings rather than allées.
  {
    id: "modernHilltop",
    label: "现代山顶庄园",
    icon: "🏔",
    desc: "极简现代 · 全景轴 · 成熟植被 — 香港山顶范",
    items: [
      // Wide infinity-pool-style social zone facing south (out the view)
      { type: "zone", zoneKind: "social",
        x: 0, z: 800,
        polygon: rectZone(1800, 600), rot: 0 },
      { type: "prefab", prefabKind: "social_island",
        x: -500, z: 800, rot: 0,
        params: { sizeM: { w: 7, d: 5 }, fireFeature: "pit", kitchenFacing: "north", sunkenSeat: true } },
      { type: "prefab", prefabKind: "social_island",
        x:  500, z: 800, rot: 0,
        params: { sizeM: { w: 6, d: 4 }, fireFeature: "table", kitchenFacing: "north", sunkenSeat: true } },
      // Private wood deck zone (the meditation/morning-coffee spot)
      { type: "zone", zoneKind: "private",
        x: 1000, z: 0,
        polygon: rectZone(500, 700), rot: 0 },
      // Utility (driveway approach from the back)
      { type: "zone", zoneKind: "utility",
        x: 0, z: -1100,
        polygon: rectZone(1200, 500), rot: 0 },
      { type: "prefab", prefabKind: "porte_cochere",
        x: 0, z: -1000, rot: 0,
        params: { carCount: 3, pillarStyle: "none", facingDir: "south" } },
      // Long boundary slat walls (privacy from neighbours)
      { type: "prefab", prefabKind: "slat_wall",
        x: -1300, z: 200, rot: Math.PI / 2,
        params: { lengthM: 16, heightM: 2.2, slatCm: 6, gapCm: 2, backWall: true } },
      // Hero olives — sculptural, mature, off-axis (no formal allée)
      { type: "singleton", kind: "tree.olive", x: -900, z: -300, scale: 1.7 },
      { type: "singleton", kind: "tree.olive", x:  900, z: -400, scale: 1.6 },
      { type: "singleton", kind: "tree.maple", x: -200, z: -500, scale: 1.5 },
      // Mass planting: 5 cypress in a loose curve
      { type: "singleton", kind: "tree.cypress", x:  600, z:  300 },
      { type: "singleton", kind: "tree.cypress", x:  900, z:  500 },
      { type: "singleton", kind: "tree.cypress", x: 1100, z:  300 },
      { type: "singleton", kind: "tree.cypress", x: -1100, z: -700 },
      { type: "singleton", kind: "tree.cypress", x: -800, z: -800 },
      // Big boxwood masses for ground accent
      { type: "singleton", kind: "plant.bushLarge", x: -400, z: 400 },
      { type: "singleton", kind: "plant.bushLarge", x:  400, z: 400 },
      { type: "singleton", kind: "plant.bushLarge", x:    0, z: 400 },
    ],
  },

  // ───── 8. 托斯卡纳石村 — Tuscan stone village ─────
  // Stone-walled terraces, terracotta paving, olive grove, plunge pool
  // feel. Less formal than Versailles, more rustic-luxury.
  {
    id: "tuscan",
    label: "托斯卡纳石村",
    icon: "🍷",
    desc: "橄榄园 + 石墙露台 + 浸泡池 — 意式乡村奢华",
    items: [
      // Main social terrace (travertine-feel paving)
      { type: "zone", zoneKind: "social",
        x: 0, z: 600,
        polygon: rectZone(1200, 600), rot: 0 },
      { type: "prefab", prefabKind: "social_island",
        x: -200, z: 600, rot: 0,
        params: { sizeM: { w: 6, d: 4 }, fireFeature: "pit", kitchenFacing: "north", sunkenSeat: true } },
      // Side gravel courtyard (the "outdoor dining" spot)
      { type: "zone", zoneKind: "agro",
        x: -800, z: -200,
        polygon: rectZone(500, 700), rot: 0 },
      // Stone walls on 2 sides (rustic boundary feel)
      { type: "prefab", prefabKind: "slat_wall",
        x: -1200, z: -200, rot: Math.PI / 2,
        params: { lengthM: 8, heightM: 1.5, slatCm: 12, gapCm: 1, backWall: true } },
      { type: "prefab", prefabKind: "slat_wall",
        x:  1200, z: -200, rot: Math.PI / 2,
        params: { lengthM: 8, heightM: 1.5, slatCm: 12, gapCm: 1, backWall: true } },
      // ── Olive grove — Tuscany's signature, 7 trees ──
      { type: "singleton", kind: "tree.olive", x: -900, z: -700, scale: 1.4 },
      { type: "singleton", kind: "tree.olive", x: -500, z: -800, scale: 1.4 },
      { type: "singleton", kind: "tree.olive", x:    0, z: -700, scale: 1.5 },
      { type: "singleton", kind: "tree.olive", x:  500, z: -800, scale: 1.4 },
      { type: "singleton", kind: "tree.olive", x:  900, z: -700, scale: 1.4 },
      { type: "singleton", kind: "tree.olive", x: -700, z: -1100, scale: 1.3 },
      { type: "singleton", kind: "tree.olive", x:  700, z: -1100, scale: 1.3 },
      // Cypress markers (the iconic Tuscan vertical accent at the far end)
      { type: "singleton", kind: "tree.cypress", x: -200, z:  1200 },
      { type: "singleton", kind: "tree.cypress", x:  200, z:  1200 },
      // Bushes around the terrace edge
      { type: "singleton", kind: "plant.bushLarge", x: -700, z: 300 },
      { type: "singleton", kind: "plant.bushLarge", x:  700, z: 300 },
    ],
  },

  // ───── 9. 日式枯山水 — Karesansui zen garden ─────
  // Formal Japanese dry-landscape garden. White gravel raked around
  // sculptural rock arrangements (the "islands"), single hero pine,
  // moss carpet (lawn zone), bamboo screen wall.
  {
    id: "karesansui",
    label: "枯山水庭院",
    icon: "🪨",
    desc: "白砂 + 石组 + 苔藓 + 松 — 日式禅意",
    items: [
      // Gravel zone (the raked white sand) — agro fallback is gravelly
      { type: "zone", zoneKind: "agro",
        x: 0, z: 200,
        polygon: rectZone(1400, 1000), rot: 0 },
      // Moss carpet zone (lawn) at the back
      { type: "zone", zoneKind: "lawn",
        x: 0, z: -800,
        polygon: rectZone(1400, 500), rot: 0 },
      // Private wood-deck strip on the right (engawa-style)
      { type: "zone", zoneKind: "private",
        x: 900, z: 0,
        polygon: rectZone(400, 1400), rot: 0 },
      // Bamboo screen wall on the left boundary
      { type: "prefab", prefabKind: "slat_wall",
        x: -1200, z: 0, rot: Math.PI / 2,
        params: { lengthM: 14, heightM: 1.8, slatCm: 3, gapCm: 4, backWall: false } },
      // ── Hero pine + sculptural arrangement ──
      { type: "singleton", kind: "tree.cypress", x: -400, z: -200, scale: 1.4 },
      // Iconic stone arrangement — 3 stones of varying heights (San-zon)
      { type: "singleton", kind: "rock.stoneTall", x: 200, z: 0, scale: 1.4 },
      { type: "singleton", kind: "rock.large",     x: 100, z: 100, scale: 1.2 },
      { type: "singleton", kind: "rock.flat",      x: 350, z: 100, scale: 1.0 },
      // Second stone group — smaller "island"
      { type: "singleton", kind: "rock.tall",      x: -200, z: 600 },
      { type: "singleton", kind: "rock.small",     x: -100, z: 700 },
      { type: "singleton", kind: "rock.flat",      x: -300, z: 700 },
      // Bamboo cluster behind the screen wall
      { type: "singleton", kind: "feature.cropBamboo", x: -1000, z: -300 },
      { type: "singleton", kind: "feature.cropBamboo", x: -1000, z: -100 },
      { type: "singleton", kind: "feature.cropBamboo", x: -1000, z:  100 },
      { type: "singleton", kind: "feature.cropBamboo", x: -1000, z:  300 },
      // Maple at the back for autumn focal
      { type: "singleton", kind: "tree.maple", x: 600, z: -700, scale: 1.3 },
      { type: "singleton", kind: "tree.bonsai", x: 800, z: 200 },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // SMALL-YARD PRESETS (D1, 2026-05)
  // Designed for lots 50-150 ㎡ — coords cluster within ±600 cm of
  // origin so nothing spills off small plots.
  // ──────────────────────────────────────────────────────────────────

  // ───── 10. 小社交露台 — compact social patio (~8×8 m footprint) ─────
  // Primary use-case: urban townhouse / terrace, direct-entry patio.
  // One social zone, pergola for shade, low planting strip on two edges,
  // a single multi-stem tree for privacy from neighbours.
  {
    id: "smallPatio",
    label: "小露台",
    icon: "☀️",
    desc: "城市联排 8×8m 紧凑社交露台 — 遮阳棚 + 种植边界",
    items: [
      // Single social zone — 7×7m, tight to house
      { type: "zone", zoneKind: "social",
        x: 0, z: 400,
        polygon: rectZone(700, 700), rot: 0 },
      // Pergola for shade over most of patio
      { type: "prefab", prefabKind: "pergola_classic",
        x: 0, z: 350, rot: 0,
        params: { widthM: 5, depthM: 4, style: "modern", roofMaterial: "polycarbonate" } },
      // Compact seating island
      { type: "prefab", prefabKind: "social_island",
        x: 0, z: 450, rot: 0,
        params: { sizeM: { w: 4, d: 3 }, fireFeature: "firepit", kitchenFacing: "north", sunkenSeat: false } },
      // Planting strip along back edge for privacy
      { type: "zone", zoneKind: "agro",
        x: 0, z: -400,
        polygon: rectZone(800, 200), rot: 0 },
      // Multi-stem tree in corner for neighbour screening
      { type: "singleton", kind: "tree.birch", x: -400, z: 600, scale: 1.0 },
      // Low ornamental shrubs left edge
      { type: "singleton", kind: "shrub.lavender", x: -450, z: 200 },
      { type: "singleton", kind: "shrub.lavender", x: -450, z: 400 },
    ],
  },

  // ───── 11. 侧院通道 — side-yard strip (~3m wide, 12m long) ─────
  // Solves the narrow side passage: utility gate at one end, green
  // corridor to social space at the other. Inspired by §10.8 patterns.
  {
    id: "sideYardStrip",
    label: "侧院走廊",
    icon: "🌿",
    desc: "3m×12m 侧院 — 步道 + 垂直绿化 + 工具储物",
    items: [
      // Utility zone at entry (gate / bin storage end)
      { type: "zone", zoneKind: "utility",
        x: -700, z: 0,
        polygon: rectZone(300, 400), rot: 0 },
      // Green planting zone along entire strip
      { type: "zone", zoneKind: "lawn",
        x: 0, z: 0,
        polygon: rectZone(1200, 200), rot: 0 },
      // Vertical green wall / trellis along fence side
      { type: "prefab", prefabKind: "slat_wall",
        x: 0, z: -200, rot: 0,
        params: { lengthM: 10, heightM: 2.2, slatCm: 4, gapCm: 6, backWall: false } },
      // Storage at far end — represented as farm_box (nearest available prefab)
      { type: "prefab", prefabKind: "farm_box",
        x: 700, z: 0, rot: Math.PI / 2,
        params: {} },
      // Espalier / clipped trees along fence to filter light
      { type: "singleton", kind: "tree.birch", x: -350, z: -150, scale: 0.8 },
      { type: "singleton", kind: "tree.birch", x:   0,  z: -150, scale: 0.8 },
      { type: "singleton", kind: "tree.birch", x:  350, z: -150, scale: 0.8 },
    ],
  },

  // ───── 12. 食材花园 (Potager) — edible kitchen garden ─────
  // Compact kitchen garden for a 6×8m rear plot. Raised veggie beds,
  // herb wheel, compost, small fruit tree. Inspired by §10.6.
  {
    id: "potager",
    label: "食材花园",
    icon: "🥬",
    desc: "6×8m 蔬菜香草园 — 高床 + 堆肥 + 果树",
    items: [
      // Main productive zone — entire plot (agro = edible landscape)
      { type: "zone", zoneKind: "agro",
        x: 0, z: 200,
        polygon: rectZone(600, 800), rot: 0 },
      // Seating / harvesting nook at edge
      { type: "zone", zoneKind: "social",
        x: 0, z: -500,
        polygon: rectZone(400, 200), rot: 0 },
      // Raised beds — farm_box is the nearest available prefab kind
      { type: "prefab", prefabKind: "farm_box",
        x: -150, z: 100, rot: 0,
        params: {} },
      { type: "prefab", prefabKind: "farm_box",
        x:  150, z: 100, rot: 0,
        params: {} },
      { type: "prefab", prefabKind: "farm_box",
        x: -150, z: 300, rot: 0,
        params: {} },
      { type: "prefab", prefabKind: "farm_box",
        x:  150, z: 300, rot: 0,
        params: {} },
      // Herb wheel / spiral near kitchen door
      { type: "singleton", kind: "feature.herbSpiral", x: 0, z: -300, scale: 1.0 },
      // Compost bay tucked in corner
      { type: "singleton", kind: "feature.compostBay", x: 350, z: 600, scale: 1.0 },
      // Single fruit tree (apple / quince) for shade + harvest
      { type: "singleton", kind: "tree.apple", x: -350, z: 600, scale: 1.1 },
      // Low fence / wicker edging to keep paths clear
      { type: "prefab", prefabKind: "slat_wall",
        x: 0, z: 620, rot: 0,
        params: { lengthM: 6, heightM: 0.5, slatCm: 6, gapCm: 2, backWall: false } },
    ],
  },
];

