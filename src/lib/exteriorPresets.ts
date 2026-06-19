/**
 * Exterior style presets — one-click bundles of ~30 ExteriorSettings
 * fields. Each preset is a Partial<ExteriorSettings>; applying a preset
 * merges it over the user's current settings (existing values that the
 * preset doesn't touch are preserved).
 *
 * IMPORTANT: every field listed here must be a real key on
 * ExteriorSettings. TypeScript enforces this via the `satisfies` clause.
 */
import type { ExteriorSettings, RoomType, YardItem } from "./types";

/** Per-room material bundle shipped with a preset. Values are MaterialItem
 *  IDs from MATERIALS (src/lib/data.ts). The applier resolves them on click
 *  and assigns the corresponding MaterialItem objects to that room. */
export interface ExteriorPresetRoomMaterials {
  wall?: string;
  floor?: string;
  tile?: string;
  light?: string;
  wallLower?: string;
  /** 外墙材质（MaterialItem id）。写进该房间的 materials.wallExterior，
   *  与左面板「外墙材质（全部）」同一字段 → 选风格即配套设好立面材质、且
   *  用户可在原面板继续改（一致性，复用通用机制）。缺省不动外墙材质。 */
  wallExterior?: string;
  /** 逐面外墙材质覆盖（NSWE）。落到 wall{Back|Front|Left|Right}Exterior，
   *  与「外墙材质（南/北/西/东）」同源。缺省回落到 wallExterior。 */
  wallExteriorN?: string;
  wallExteriorS?: string;
  wallExteriorW?: string;
  wallExteriorE?: string;
}

export interface ExteriorPreset {
  id: string;
  /** Chinese display name (shown on the button). */
  label: string;
  /** English display name (shown when locale is English). */
  labelEn: string;
  /** Short English / decorative one-liner shown under the label. */
  blurb: string;
  /** Small emoji icon for the chip. */
  icon: string;
  /** The bundle of settings the preset applies. */
  settings: Partial<ExteriorSettings>;
  /** Optional per-room default materials. When set, applying the preset
   *  also assigns matching wall/floor/tile materials to every enabled
   *  room on the current floor, giving a coherent "designed package"
   *  feel instead of pure exterior tuning. */
  roomMaterials?: Partial<Record<RoomType, ExteriorPresetRoomMaterials>>;
  /** Optional yard items. When set, applying the preset REPLACES the
   *  floor-0 yardPlan.items with this list — so the landscape matches
   *  the style. Leave undefined to preserve the user's current yard. */
  yardItems?: YardItem[];
  /** Optional yard paths (小径). Same semantics as yardItems: set =
   *  REPLACE floor-0 yardPlan.paths. 与 yardItems 一起构成「风格选一次、
   *  院子整包到位」的一致性主线——用户不必去院子图重新铺路。 */
  yardPaths?: Array<{ id: string; points: Array<[number, number]>; widthCm: number; material: string }>;
}

// ── 庭院坐标约定 ───────────────────────────────────────────────
// 世界坐标 cm，原点 = 房子中心，+z = 前院(南)，+x = 右(东)。
// 典型住宅半宽 ~600、半深 ~500；前门在 +z 一侧中央，围栏在 ~±1100。
// zone 的 polygon 是相对 (x,z) 质心的顶点；这里统一用居中矩形。
const zoneRect = (w: number, d: number): Array<[number, number]> => [
  [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
];

export const EXTERIOR_PRESETS: ExteriorPreset[] = [
  {
    id: "modern-minimal",
    label: "现代极简",
    labelEn: "Modern Minimal",
    blurb: "Floor-to-ceiling glazing · flat parapet · monochrome",
    icon: "▱",
    settings: {
      // Facade: clean monochrome
      wallBaseColor: "#F0EDE6",
      wallGrooveColor: "#F0EDE6",  // grooves match base → invisible seams
      // Push spacings huge so the InstancedMesh count → 0 → no seam lines.
      wallPanelHSpacing: 99,
      wallPanelVSpacing: 99,
      wallPanelTwoTone: false,
      stoneBaseEnabled: false,
      // Windows: minimal but still legible. sill/lintel off, but jamb on
      // (the recessed reveal IS the minimalist read), 5 cm frame so the
      // window doesn't disappear into white wall under sky reflection.
      windowGlassColor: "#1A2030",
      windowGlassTopColor: "#4A5C72",  // sky-reflection band on upper half
      windowMullionPos: 0.50,           // classic centre mullion
      windowMullionThicknessCm: 2.5,
      windowFrameColor: "#1A1A1E",
      // Decartoon: barely-there grout, naturalised lawn, hazy sky.
      wallPanelGrooveOpacity: 0.25,
      lawnTint: "#7E8E6A",
      skyHaze: 0.20,
      windowRevealShadow: 0.65,
      treeColorJitter: 0.40,
      buildingBaseShadow: 1.0,  // max — also masks any bloom hot-spots at base
      eaveShadow: 0.45,
      wallVignette: 0.30,
      solarPanelsEnabled: false,
      hideInteriorWalls: true,  // kill metro-tile leakage through facade
      bloomIntensity: 0.20,     // kill daytime halo at base of windows
      // Disable grass blades entirely — even at 0.7 density the thin
      // tapered triangles still read as falling rain at low camera angles.
      // The procedural ground texture alone gives the "modern minimal"
      // mown-lawn look the preset is going for.
      grassDensity: 0,
      exposure: 0.82,           // tame ACES roll-off + cleaner sky
      windowSillEnabled: false,
      windowLintelEnabled: false,
      windowJambEnabled: true,
      windowJambDepthCm: 12,
      windowFlowerBoxFreq: 0,
      windowFrameStripVCm: 5,
      windowFrameStripHCm: 5,
      windowCenterMullionCm: 0,
      // Was 30 / 230 → effectively floor-to-ceiling. Walking into the
      // room put the camera face-to-face with a giant pane of glass
      // dominating the whole view. 70 cm sill + 180 cm height tops out
      // at 250 cm — still tall modernist, but with a clean wall band
      // above and a comfortable waist-line at the bottom.
      defaultWindowSill: 70,
      defaultWindowHeight: 180,
      // Doors: glass front
      frontEntranceStyle: "french_double",
      doorFrameColor: "#1A1A1E",
      doorHandleColor: "#9A9A9E",
      // Interior: cool minimalist
      roomCeilingColor: "#F8F6F0",
      ceilingLightColor: "#FFFFFF",
      ceilingLightIntensity: 4.2,
      skirtingHeight: 4,
      skirtingThicknessCm: 0.5,
      skirtingColor: "#E8E4DC",
      // Roof: dramatic cantilever, no parapet
      roofOverhang: 1.10,
      roofOverhangSouthExtra: 0.80,
      parapetHeight: 0,
      parapetGlassEnabled: false,
      roofSlabColor: "#3A3E48",
    },
    // ── Designed package: each room gets a curated material pair that
    // matches the monochrome facade. Oak floors in living spaces give
    // the scene its warm note; whites tie back to the cream wall.
    // wallExterior 配套设好「外墙材质」面板：上层房型（卧室/书房）暖木饰面、
    // 地面层（客厅/厨房/餐厅等）白墙 —— 在典型「楼下公共、楼上卧室」的住宅里
    // 形成参考图那种「白下木上」的现代别墅立面。选风格即立面到位，用户仍可
    // 在左面板「外墙材质」逐房间/逐面继续改（复用通用机制）。
    roomMaterials: {
      living:    { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",       wallExterior: "wall-white" },
      master:    { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant",  wallExterior: "wall-wood-panel" },
      bedroom:   { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",       wallExterior: "wall-wood-panel" },
      bedroom2:  { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",       wallExterior: "wall-wood-panel" },
      bedroom3:  { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",       wallExterior: "wall-wood-panel" },
      study:     { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant",  wallExterior: "wall-wood-panel" },
      study2:    { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant",  wallExterior: "wall-wood-panel" },
      dining:    { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant",  wallExterior: "wall-white" },
      hallway:   { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",       wallExterior: "wall-white" },
      closet:    { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",       wallExterior: "wall-white" },
      kitchen:   { floor: "floor-white-tile", wall: "wall-tile-white", light: "light-linear-pendant", wallExterior: "wall-white" },
      bathroom:  { floor: "floor-white-tile", wall: "wall-tile-metro", light: "light-smart-panel",     wallExterior: "wall-white" },
      bathroom2: { floor: "floor-white-tile", wall: "wall-tile-metro", light: "light-smart-panel",     wallExterior: "wall-wood-panel" },
      balcony:   { floor: "floor-concrete",   wall: "wall-white", wallExterior: "wall-white" },
      balcony2:  { floor: "floor-concrete",   wall: "wall-white", wallExterior: "wall-wood-panel" },
    },
    // 现代泳池度假庭院包（对标参考图：泳池 + travertine 甲板 + 躺椅 + 火塘 +
    // 观赏草 + 暖木栅栏背景 + 松柏锚点）。「木 + 白 + 石 + 玻璃」暖调从建筑流到院子。
    // 坐标：+z=前院(社交/落地玻璃侧)，泳池居中前置，东用餐露台 / 西火塘对置。
    yardItems: [
      // ── 主景：泳池（prefab 自带 travertine 露台 + 无边瀑布 + spa + 4 躺椅 + 池畔小屋）
      { id: "mm-pool", type: "prefab", prefabKind: "pool", x: 0, z: 760, rot: 0 },
      // ── 东侧用餐露台：travertine 社交区 + 整套餐桌椅 + 遮阳伞
      { id: "mm-zone-dine", type: "zone", zoneKind: "social", subtype: "outdoor-room", x: 820, z: 700, polygon: zoneRect(360, 320) },
      { id: "mm-dineset", type: "singleton", kind: "furniture.diningSet", x: 820, z: 700, rot: 0 },
      { id: "mm-parasol", type: "singleton", kind: "furniture.parasol",   x: 820, z: 700 },
      // ── 西侧火塘社交岛（下沉卡座 + 篝火），紧邻建筑形成傍晚社交角
      { id: "mm-fire", type: "prefab", prefabKind: "social_island", x: -820, z: 720, rot: 0,
        params: { sizeM: { w: 5, d: 4 }, fireFeature: "pit", sunkenSeat: true, kitchenFacing: "north" } },
      // ── 暖木栅栏围合：南界背景线（3 段）+ 东西短返，参考图的木栅栏背景
      { id: "mm-fence-s1", type: "prefab", prefabKind: "fence_segment", x: -720, z: 1080, rot: 0,
        params: { lengthM: 7.2, heightM: 1.8 } },
      { id: "mm-fence-s2", type: "prefab", prefabKind: "fence_segment", x:    0, z: 1080, rot: 0,
        params: { lengthM: 7.2, heightM: 1.8 } },
      { id: "mm-fence-s3", type: "prefab", prefabKind: "fence_segment", x:  720, z: 1080, rot: 0,
        params: { lengthM: 7.2, heightM: 1.8 } },
      { id: "mm-fence-w",  type: "prefab", prefabKind: "fence_segment", x: -1080, z: 560, rot: Math.PI / 2,
        params: { lengthM: 6.0, heightM: 1.8 } },
      { id: "mm-fence-e",  type: "prefab", prefabKind: "fence_segment", x:  1080, z: 560, rot: Math.PI / 2,
        params: { lengthM: 6.0, heightM: 1.8 } },
      // ── 松柏背景（参考图远景松林）+ 橄榄树锚点
      { id: "mm-tree-1", type: "singleton", kind: "tree.cypress", x: -980, z: 980, scale: 1.2 },
      { id: "mm-tree-2", type: "singleton", kind: "tree.cypress", x:  980, z: 980, scale: 1.2 },
      { id: "mm-tree-3", type: "singleton", kind: "tree.olive",   x: -560, z: 1000, scale: 1.2 },
      { id: "mm-tree-4", type: "singleton", kind: "tree.olive",   x:  560, z: 1000, scale: 1.2 },
      // ── 观赏草花境：沿甲板边角丛植（参考图铺装缝里的草簇）
      { id: "mm-grass-1", type: "singleton", kind: "plant.grass", x: -520, z: 560, scale: 1.2 },
      { id: "mm-grass-2", type: "singleton", kind: "plant.grass", x: -440, z: 600, scale: 1.0 },
      { id: "mm-grass-3", type: "singleton", kind: "plant.grass", x:  520, z: 560, scale: 1.2 },
      { id: "mm-grass-4", type: "singleton", kind: "plant.grass", x:  440, z: 600, scale: 1.0 },
      { id: "mm-grass-5", type: "singleton", kind: "plant.grass", x:    0, z: 1030, scale: 1.1 },
    ],
    // 侧路通向入户（泳池居中占前院，入户走西侧 travertine 步道）
    yardPaths: [
      { id: "mm-path-entry", points: [[-560, 1080], [-560, 520]], widthCm: 120, material: "stone" },
    ],
  },
  {
    id: "french-classical",
    label: "法式古典",
    labelEn: "French Classic",
    blurb: "Brass · stone trim · flower boxes · warm cream",
    icon: "⚜",
    settings: {
      wallBaseColor: "#F5EBD8",
      wallGrooveColor: "#C8B888",
      wallPanelHSpacing: 0.80,
      wallPanelVSpacing: 0.95,
      wallPanelTwoTone: true,
      stoneBaseEnabled: true,
      stoneBaseHeight: 0.80,
      windowGlassColor: "#3E5066",
      windowFrameColor: "#FAF6EE",
      windowSillEnabled: true,
      windowLintelEnabled: true,
      windowJambEnabled: true,
      windowJambDepthCm: 14,
      windowFlowerBoxFreq: 100,
      windowFrameStripVCm: 6,
      windowFrameStripHCm: 12,
      windowCenterMullionCm: 5,
      windowSillColor: "#D8C8A0",
      windowLintelColor: "#E0D0A8",
      windowFlowerBoxColor: "#1E1A14",
      flowerBloomColor: "#E83040",
      flowerFoliageColor: "#3E7428",
      defaultWindowSill: 100,
      defaultWindowHeight: 160,
      frontEntranceStyle: "french_double",
      doorFrameColor: "#FAF6EE",
      doorHandleColor: "#C0A040",
      roomCeilingColor: "#F8EFD8",
      ceilingLightColor: "#FFD888",
      ceilingLightIntensity: 3.0,
      skirtingHeight: 16,
      skirtingThicknessCm: 2.5,
      skirtingColor: "#F0E4C8",
      roofOverhang: 0.55,
      roofOverhangSouthExtra: 0.10,
      parapetHeight: 0.45,
      parapetGlassEnabled: false,
      roofSlabColor: "#E8D8B0",
      parapetColor: "#E8D8B0",
    },
    // 法式古典庭院包：轴线对称。砖径两侧柏树列植 + 花境，左前喷泉为焦点，
    // 右前社交区摆餐桌椅；后院留草坪。
    yardItems: [
      { id: "fc-zone-social", type: "zone", zoneKind: "social", subtype: "outdoor-room", x: 420, z: 700, polygon: zoneRect(340, 260) },
      { id: "fc-zone-lawn",   type: "zone", zoneKind: "lawn",   x: 0, z: -780, polygon: zoneRect(700, 360) },
      // 柏树列植（沿入户轴线对称）
      { id: "fc-cy-1", type: "singleton", kind: "tree.cypress", x: -160, z: 1000, scale: 1.1 },
      { id: "fc-cy-2", type: "singleton", kind: "tree.cypress", x:  160, z: 1000, scale: 1.1 },
      { id: "fc-cy-3", type: "singleton", kind: "tree.cypress", x: -160, z:  720, scale: 1.1 },
      { id: "fc-cy-4", type: "singleton", kind: "tree.cypress", x:  160, z:  720, scale: 1.1 },
      // 花境（红/紫/黄三色，靠路两侧）
      { id: "fc-fl-1", type: "singleton", kind: "plant.flowerRed",    x: -260, z: 880 },
      { id: "fc-fl-2", type: "singleton", kind: "plant.flowerPurple", x:  260, z: 880 },
      { id: "fc-fl-3", type: "singleton", kind: "plant.flowerYellow", x: -260, z: 620 },
      { id: "fc-fl-4", type: "singleton", kind: "plant.flowerRed",    x:  260, z: 620 },
      // 焦点喷泉（左前）+ 社交区餐桌
      { id: "fc-fountain", type: "prefab", prefabKind: "fountain", x: -450, z: 760 },
      { id: "fc-dining",   type: "singleton", kind: "furniture.diningSet", x: 420, z: 700 },
      { id: "fc-oak",      type: "singleton", kind: "tree.oak", x: 850, z: -550, scale: 1.2 },
      // 灌木层：修剪绿篱沿入户两侧（法式 parterre 的骨架）+ 喷泉环植花
      { id: "fc-hedge-1", type: "singleton", kind: "plant.bushLarge", x: -340, z: 1000, scale: 0.85 },
      { id: "fc-hedge-2", type: "singleton", kind: "plant.bushLarge", x:  340, z: 1000, scale: 0.85 },
      { id: "fc-hedge-3", type: "singleton", kind: "plant.bushLarge", x: -340, z:  540, scale: 0.85 },
      { id: "fc-hedge-4", type: "singleton", kind: "plant.bushLarge", x:  340, z:  540, scale: 0.85 },
      { id: "fc-fl-5", type: "singleton", kind: "plant.flowerYellow", x: -600, z: 860 },
      { id: "fc-fl-6", type: "singleton", kind: "plant.flowerPurple", x: -300, z: 760 },
    ],
    yardPaths: [
      { id: "fc-path-entry", points: [[0, 1100], [0, 500]], widthCm: 130, material: "brick" },
      { id: "fc-path-social", points: [[120, 700], [420, 700]], widthCm: 80, material: "brick" },
    ],
  },
  {
    id: "industrial-loft",
    label: "工业风",
    labelEn: "Industrial",
    blurb: "Exposed concrete · black metal · no ornaments",
    icon: "▪",
    settings: {
      wallBaseColor: "#9B9088",
      wallGrooveColor: "#5E564E",
      wallPanelHSpacing: 1.50,
      wallPanelVSpacing: 1.20,
      wallPanelTwoTone: false,
      stoneBaseEnabled: false,
      windowGlassColor: "#2A2E36",
      windowFrameColor: "#1A1A1E",
      windowSillEnabled: true,
      windowLintelEnabled: false,
      windowJambEnabled: true,
      windowJambDepthCm: 12,
      windowFlowerBoxFreq: 0,
      windowFrameStripVCm: 3,
      windowFrameStripHCm: 3,
      windowCenterMullionCm: 3,
      windowSillColor: "#3A3E48",
      // 80 + 200 = 280 was too close to the 300 cm ceiling — only 20 cm
      // wall band at top. 90 + 170 = 260 leaves a clean 40 cm band.
      defaultWindowSill: 90,
      defaultWindowHeight: 170,
      frontEntranceStyle: "wood_panel",
      doorFrameColor: "#2A2A2E",
      doorHandleColor: "#1E1E22",
      roomCeilingColor: "#3A3E48",
      ceilingLightColor: "#FFE4A0",
      ceilingLightIntensity: 3.2,
      ceilingLightRadiusCm: 12,
      skirtingHeight: 6,
      skirtingThicknessCm: 1.0,
      skirtingColor: "#2A2E36",
      roofOverhang: 0.30,
      roofOverhangSouthExtra: 0.00,
      parapetHeight: 0.60,
      parapetGlassEnabled: false,
      roofSlabColor: "#5E564E",
      parapetColor: "#7A7068",
    },
    // 工业风庭院包：砾石 + 观赏草 + 原石，硬朗低维护。前右社交角壁炉 +
    // 户外沙发；侧边隐蔽服务区（工具/设备）。
    yardItems: [
      { id: "il-zone-social",  type: "zone", zoneKind: "social",  subtype: "outdoor-room",  x: 400, z: 700, polygon: zoneRect(340, 260) },
      { id: "il-zone-service", type: "zone", zoneKind: "utility", subtype: "service-yard",  x: -780, z: -200, polygon: zoneRect(220, 420) },
      { id: "il-pine-1", type: "singleton", kind: "tree.pine", x: -880, z: 560, scale: 1.2 },
      { id: "il-pine-2", type: "singleton", kind: "tree.pine", x:  920, z: -420, scale: 1.0 },
      { id: "il-grass-1", type: "singleton", kind: "plant.grass", x: -340, z: 760, scale: 1.4 },
      { id: "il-grass-2", type: "singleton", kind: "plant.grass", x: -460, z: 640, scale: 1.2 },
      { id: "il-grass-3", type: "singleton", kind: "plant.grass", x:  200, z: 900, scale: 1.3 },
      { id: "il-rock-1", type: "singleton", kind: "rock.flat",  x: -250, z: 880, scale: 1.3 },
      { id: "il-rock-2", type: "singleton", kind: "rock.large", x: -600, z: 800, scale: 1.1 },
      { id: "il-fire",  type: "singleton", kind: "furniture.fireplace",  x: 400, z: 780 },
      { id: "il-sofa",  type: "singleton", kind: "furniture.outdoorSofa", x: 400, z: 620, rot: Math.PI },
      { id: "il-planter", type: "singleton", kind: "furniture.planter", x: 180, z: 540 },
      // 草本层：观赏草丛沿砾石径两侧成带（工业风的"软"全靠草）
      { id: "il-grass-4", type: "singleton", kind: "plant.grass", x: -140, z: 980, scale: 1.3 },
      { id: "il-grass-5", type: "singleton", kind: "plant.grass", x:  150, z: 880, scale: 1.2 },
      { id: "il-grass-6", type: "singleton", kind: "plant.grass", x: -540, z: 380, scale: 1.4 },
      { id: "il-rock-3",  type: "singleton", kind: "rock.small", x: 240, z: 1000, scale: 1.2 },
    ],
    yardPaths: [
      { id: "il-path-entry", points: [[0, 1100], [0, 500]], widthCm: 120, material: "gravel" },
      { id: "il-path-side",  points: [[-120, 760], [-680, 760], [-780, 100]], widthCm: 80, material: "gravel" },
    ],
  },
  {
    id: "mediterranean",
    label: "地中海",
    labelEn: "Mediterranean",
    blurb: "Terracotta · azure · jasmine · sunlit",
    icon: "🌿",
    settings: {
      wallBaseColor: "#F8F2E8",
      wallGrooveColor: "#D0BC9C",
      wallPanelHSpacing: 1.00,
      wallPanelVSpacing: 1.40,
      wallPanelTwoTone: true,
      stoneBaseEnabled: true,
      stoneBaseHeight: 0.40,
      windowGlassColor: "#3A5878",
      windowFrameColor: "#2A6088",
      windowSillEnabled: true,
      windowLintelEnabled: false,
      windowJambEnabled: true,
      windowJambDepthCm: 10,
      windowFlowerBoxFreq: 85,
      windowFrameStripVCm: 4,
      windowFrameStripHCm: 6,
      windowCenterMullionCm: 4,
      windowSillColor: "#E8D8B0",
      windowFlowerBoxColor: "#A0623E",
      flowerBloomColor: "#E85090",
      flowerFoliageColor: "#5A8A30",
      defaultWindowSill: 95,
      defaultWindowHeight: 155,
      frontEntranceStyle: "wood_panel",
      doorFrameColor: "#FAEEDA",
      doorHandleColor: "#C8A060",
      roomCeilingColor: "#FFF8EC",
      ceilingLightColor: "#FFE0A0",
      ceilingLightIntensity: 3.5,
      skirtingHeight: 10,
      skirtingThicknessCm: 1.5,
      skirtingColor: "#E8D8B0",
      roofOverhang: 0.70,
      roofOverhangSouthExtra: 0.25,
      parapetHeight: 0.25,
      parapetGlassEnabled: false,
      roofSlabColor: "#C26840",
      parapetColor: "#C26840",
    },
    // 地中海庭院包：度假感。左前泳池 + 躺椅，右前阳伞餐区（社交），
    // 棕榈对置 + 橄榄 + 耐旱多肉，陶盆点缀入户。
    yardItems: [
      { id: "md-zone-social", type: "zone", zoneKind: "social", subtype: "outdoor-room", x: 430, z: 700, polygon: zoneRect(360, 280) },
      { id: "md-zone-lawn",   type: "zone", zoneKind: "lawn",   x: 0, z: -780, polygon: zoneRect(700, 360) },
      { id: "md-pool", type: "prefab", prefabKind: "pool", x: -450, z: 780 },
      { id: "md-palm-1", type: "singleton", kind: "tree.palm", x: -900, z: 600, scale: 1.2 },
      { id: "md-palm-2", type: "singleton", kind: "tree.palm", x:  920, z: 620, scale: 1.2 },
      { id: "md-olive",  type: "singleton", kind: "tree.olive", x: -480, z: -700, scale: 1.3 },
      { id: "md-cactus-1", type: "singleton", kind: "plant.cactus", x: 740, z: 880 },
      { id: "md-cactus-2", type: "singleton", kind: "plant.cactus", x: 840, z: 760 },
      { id: "md-planter-1", type: "singleton", kind: "furniture.planter", x: -150, z: 540 },
      { id: "md-planter-2", type: "singleton", kind: "furniture.planter", x:  150, z: 540 },
      { id: "md-parasol", type: "singleton", kind: "furniture.parasol",   x: 430, z: 700 },
      { id: "md-dining",  type: "singleton", kind: "furniture.diningSet", x: 430, z: 700 },
      { id: "md-lounger", type: "singleton", kind: "furniture.swimmingLounger", x: -450, z: 1010, rot: Math.PI },
      // 花境层：暖色花带沿社交区与小径（地中海的阳光配色）
      { id: "md-fl-1", type: "singleton", kind: "plant.flowerRed",    x: 240, z: 560 },
      { id: "md-fl-2", type: "singleton", kind: "plant.flowerPurple", x: 640, z: 600 },
      { id: "md-fl-3", type: "singleton", kind: "plant.flowerYellow", x: 620, z: 840 },
      { id: "md-bush-1", type: "singleton", kind: "plant.bushSmall", x: -150, z: 470 },
      { id: "md-bush-2", type: "singleton", kind: "plant.bushSmall", x:  150, z: 470 },
    ],
    yardPaths: [
      { id: "md-path-entry", points: [[0, 1100], [0, 500]], widthCm: 120, material: "stone" },
      { id: "md-path-pool",  points: [[-110, 780], [-260, 780]], widthCm: 80, material: "stone" },
    ],
  },
  {
    id: "japanese-zen",
    label: "日式禅意",
    labelEn: "Japanese Zen",
    blurb: "Charred wood · paper-screen white · low parapet",
    icon: "禅",
    settings: {
      wallBaseColor: "#F4F0E4",
      wallGrooveColor: "#B8AC98",
      wallPanelHSpacing: 0.95,
      wallPanelVSpacing: 0.90,
      wallPanelTwoTone: false,
      stoneBaseEnabled: true,
      stoneBaseHeight: 0.35,
      windowGlassColor: "#34404E",
      windowFrameColor: "#2A1E16",
      windowSillEnabled: true,
      windowLintelEnabled: false,
      windowJambEnabled: true,
      windowJambDepthCm: 8,
      windowFlowerBoxFreq: 0,
      windowFrameStripVCm: 6,
      windowFrameStripHCm: 6,
      windowCenterMullionCm: 4,
      windowSillColor: "#3E2A1E",
      defaultWindowSill: 70,
      defaultWindowHeight: 170,
      frontEntranceStyle: "sliding_barn",
      doorFrameColor: "#3E2A1E",
      doorHandleColor: "#1E1E22",
      roomCeilingColor: "#FAF4E8",
      ceilingLightColor: "#FFE0A0",
      ceilingLightIntensity: 2.4,
      skirtingHeight: 8,
      skirtingThicknessCm: 1.0,
      skirtingColor: "#3E2A1E",
      roofOverhang: 1.00,
      roofOverhangSouthExtra: 0.60,
      parapetHeight: 0,
      parapetGlassEnabled: false,
      roofSlabColor: "#2A1E14",
    },
    // 日式禅意庭院包：枯山水。横向砾石「砂川」+ 木桥，三石组（主石+副石+
    // 平石），红枫/黑松/盆景，右前私密茶角（背靠围合）。无草坪，重留白。
    yardItems: [
      { id: "jz-zone-tea", type: "zone", zoneKind: "private", subtype: "back-against", x: 450, z: 700, polygon: zoneRect(280, 220) },
      // 三石组（左前，枯山水主景）
      { id: "jz-rock-main", type: "singleton", kind: "rock.stoneTall", x: -420, z: 800, scale: 1.4 },
      { id: "jz-rock-sub",  type: "singleton", kind: "rock.large",     x: -540, z: 740, scale: 1.0 },
      { id: "jz-rock-flat", type: "singleton", kind: "rock.flat",      x: -330, z: 720, scale: 1.1 },
      // 乔木：红枫 + 黑松；入户对置盆景
      { id: "jz-maple-1", type: "singleton", kind: "tree.maple", x: -560, z: 600, scale: 1.1 },
      { id: "jz-maple-2", type: "singleton", kind: "tree.maple", x:  880, z: -380, scale: 0.9 },
      { id: "jz-pine",    type: "singleton", kind: "tree.pine",  x:  900, z: 620, scale: 1.1 },
      { id: "jz-bonsai-1", type: "singleton", kind: "tree.bonsai", x: -150, z: 530 },
      { id: "jz-bonsai-2", type: "singleton", kind: "tree.bonsai", x:  150, z: 530 },
      // 低层灌木（苔感）
      { id: "jz-bush-1", type: "singleton", kind: "plant.bushSmall", x: -360, z: 880 },
      { id: "jz-bush-2", type: "singleton", kind: "plant.bushSmall", x: -600, z: 840 },
      { id: "jz-bush-3", type: "singleton", kind: "plant.bushSmall", x:  340, z: 860 },
      // 砂川上的木桥 + 茶角矮桌
      { id: "jz-bridge", type: "singleton", kind: "feature.bridgeWood", x: -400, z: 950, rot: Math.PI / 2 },
      { id: "jz-tea-table", type: "singleton", kind: "furniture.coffeeTable", x: 450, z: 700 },
      // 苔层补密：低灌沿砂川南岸 + 茶角背后一组小石（参考枯山水照片的留白配重）
      { id: "jz-bush-4", type: "singleton", kind: "plant.bushSmall", x: -800, z: 980 },
      { id: "jz-bush-5", type: "singleton", kind: "plant.bushSmall", x: -200, z: 1000 },
      { id: "jz-rock-s1", type: "singleton", kind: "rock.small", x: 560, z: 820, scale: 1.1 },
      { id: "jz-rock-s2", type: "singleton", kind: "rock.small", x: 620, z: 760, scale: 0.9 },
    ],
    yardPaths: [
      // 入户主径（碎石）
      { id: "jz-path-entry", points: [[0, 1100], [0, 500]], widthCm: 100, material: "gravel" },
      // 枯山水「砂川」横贯左前院
      { id: "jz-path-river", points: [[-1050, 900], [-400, 950], [-150, 880]], widthCm: 170, material: "gravel" },
      // 汀步到茶角
      { id: "jz-path-tea", points: [[90, 660], [430, 700]], widthCm: 70, material: "stone" },
    ],
  },
  {
    // ── 玻璃幕墙（隐框：白色混凝土楼板带 + 黑铝幕墙）──────────────────────────
    // The reference modern-glass villa. Drives the unified facadeSystem engine:
    // every exterior non-circulation bay becomes a black-aluminium mullion grid
    // + vision glass AT the wall plane; white expressed slab bands at each floor
    // line; the stair/hallway core stays solid white stucco; walnut soffit under
    // a deep flat-roof cantilever. Stays 100% floor-plan-driven (no hardcoded
    // model). Travertine pool deck with a D-end pool reused from the resort yard.
    id: "glass-curtain",
    label: "玻璃幕墙",
    labelEn: "Glass Curtain Wall",
    blurb: "Hidden-frame curtain wall · white slab bands · walnut soffit",
    icon: "▦",
    settings: {
      // The authoritative facade engine selector.
      facadeSystem: "curtain-wall",
      transparentExterior: false,   // curtain wall is the authoritative envelope
      // White masses + white expressed slab bands behind the black curtain wall.
      wallBaseColor: "#F2EFE8",
      glassShellColor: "#33414E",   // dark glass shell tint (transparent, see-through)
      glassSpandrelColor: "#EDEAE3",// white slab-band spandrels in the curtain
      glassColor: "#73899B",        // cool transparent vision glass (reads see-through)
      glassOpacity: 1.0,            // transparent ground-floor glazing
      entranceFrameColor: "#15171B",// black-aluminium entrance framing
      windowFrameColor: "#15171B",
      woodSoffit: true,             // walnut soffit under the cantilever
      // Deep flat-roof cantilever, no parapet (reference look).
      roofOverhang: 1.20,
      roofOverhangSouthExtra: 0.90,
      parapetHeight: 0,
      parapetGlassEnabled: false,
      roofSlabColor: "#EAE7E0",     // white flat-roof slab
      // Clean monochrome masses — kill panel seams / stone base / two-tone.
      stoneBaseEnabled: false,
      wallPanelTwoTone: false,
      wallPanelHSpacing: 99,
      wallPanelVSpacing: 99,
      wallGrooveColor: "#F2EFE8",
      grassDensity: 0,
      solarPanelsEnabled: false,
      hideInteriorWalls: true,
      exposure: 0.84,
    },
    // Interior package: warm oak floors + white walls (reads through the glass);
    // white exterior so any exposed mass stays white behind the curtain wall.
    roomMaterials: {
      living:    { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",      wallExterior: "wall-white" },
      master:    { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant", wallExterior: "wall-white" },
      bedroom:   { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",      wallExterior: "wall-white" },
      bedroom2:  { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",      wallExterior: "wall-white" },
      bedroom3:  { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",      wallExterior: "wall-white" },
      study:     { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant", wallExterior: "wall-white" },
      dining:    { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant", wallExterior: "wall-white" },
      hallway:   { floor: "floor-oak",        wall: "wall-white", light: "light-recessed",      wallExterior: "wall-white" },
      kitchen:   { floor: "floor-white-tile", wall: "wall-tile-white", light: "light-linear-pendant", wallExterior: "wall-white" },
      bathroom:  { floor: "floor-white-tile", wall: "wall-tile-metro", light: "light-smart-panel",     wallExterior: "wall-white" },
      bathroom2: { floor: "floor-white-tile", wall: "wall-tile-metro", light: "light-smart-panel",     wallExterior: "wall-white" },
    },
    // Travertine pool-deck resort yard (D-end pool prefab + stone social decks).
    yardItems: [
      { id: "gc-pool", type: "prefab", prefabKind: "pool", x: 0, z: 760, rot: 0 },
      { id: "gc-zone-dine", type: "zone", zoneKind: "social", subtype: "outdoor-room", x: 820, z: 700, polygon: zoneRect(360, 320) },
      { id: "gc-dineset", type: "singleton", kind: "furniture.diningSet", x: 820, z: 700, rot: 0 },
      { id: "gc-parasol", type: "singleton", kind: "furniture.parasol",   x: 820, z: 700 },
      { id: "gc-lounge-1", type: "singleton", kind: "furniture.chaiseLounger", x: -360, z: 560, rot: 0 },
      { id: "gc-lounge-2", type: "singleton", kind: "furniture.chaiseLounger", x: -240, z: 560, rot: 0 },
      // Pine backdrop + cypress anchors (reference far-tree line)
      { id: "gc-tree-1", type: "singleton", kind: "tree.cypress", x: -980, z: 980, scale: 1.2 },
      { id: "gc-tree-2", type: "singleton", kind: "tree.cypress", x:  980, z: 980, scale: 1.2 },
      { id: "gc-tree-3", type: "singleton", kind: "tree.pine",    x: -600, z: 1040, scale: 1.3 },
      { id: "gc-tree-4", type: "singleton", kind: "tree.pine",    x:  600, z: 1040, scale: 1.3 },
      { id: "gc-grass-1", type: "singleton", kind: "plant.grass", x: -520, z: 560, scale: 1.2 },
      { id: "gc-grass-2", type: "singleton", kind: "plant.grass", x:  520, z: 560, scale: 1.2 },
    ],
    yardPaths: [
      { id: "gc-path-entry", points: [[-560, 1080], [-560, 520]], widthCm: 120, material: "stone" },
    ],
  },
];
