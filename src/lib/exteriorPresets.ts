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
}

export interface ExteriorPreset {
  id: string;
  /** Chinese display name (shown on the button). */
  label: string;
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
}

export const EXTERIOR_PRESETS: ExteriorPreset[] = [
  {
    id: "modern-minimal",
    label: "现代极简",
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
      // Clean silhouette — Modern Minimal hides all rooftop clutter that
      // breaks the cantilevered-slab read.
      rooftopDeckEnabled: false,
      rooftopHvacCount: 0,
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
      roofVentCount: 0,
    },
    // ── Designed package: each room gets a curated material pair that
    // matches the monochrome facade. Oak floors in living spaces give
    // the scene its warm note; whites tie back to the cream wall.
    roomMaterials: {
      living:    { floor: "floor-oak",        wall: "wall-white", light: "light-recessed" },
      master:    { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant" },
      bedroom:   { floor: "floor-oak",        wall: "wall-white", light: "light-recessed" },
      bedroom2:  { floor: "floor-oak",        wall: "wall-white", light: "light-recessed" },
      bedroom3:  { floor: "floor-oak",        wall: "wall-white", light: "light-recessed" },
      study:     { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant" },
      study2:    { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant" },
      dining:    { floor: "floor-oak",        wall: "wall-white", light: "light-linear-pendant" },
      hallway:   { floor: "floor-oak",        wall: "wall-white", light: "light-recessed" },
      closet:    { floor: "floor-oak",        wall: "wall-white", light: "light-recessed" },
      kitchen:   { floor: "floor-white-tile", wall: "wall-tile-white", light: "light-linear-pendant" },
      bathroom:  { floor: "floor-white-tile", wall: "wall-tile-metro", light: "light-smart-panel" },
      bathroom2: { floor: "floor-white-tile", wall: "wall-tile-metro", light: "light-smart-panel" },
      balcony:   { floor: "floor-concrete",   wall: "wall-white" },
      balcony2:  { floor: "floor-concrete",   wall: "wall-white" },
    },
    // Minimal landscape: one anchoring olive on each side of the house,
    // a single feature stone, and a low maple by the entry. Sparse on
    // purpose — it's "modern minimal", not "garden party".
    yardItems: [
      { id: "mm-tree-1", type: "singleton", kind: "tree.olive",   x: -900, z:  600, scale: 1.3 },
      { id: "mm-tree-2", type: "singleton", kind: "tree.olive",   x:  900, z:  600, scale: 1.3 },
      { id: "mm-tree-3", type: "singleton", kind: "tree.maple",   x:  450, z: -650, scale: 1.0 },
      { id: "mm-rock-1", type: "singleton", kind: "rock.large", x: -500, z: -650, scale: 1.2 },
    ],
  },
  {
    id: "french-classical",
    label: "法式古典",
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
      roofVentCount: 3,
    },
  },
  {
    id: "industrial-loft",
    label: "工业风",
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
      roofVentColor: "#2A2C30",
      roofVentCount: 5,
    },
  },
  {
    id: "mediterranean",
    label: "地中海",
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
      roofVentCount: 1,
    },
  },
  {
    id: "japanese-zen",
    label: "日式禅意",
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
      roofVentCount: 0,
    },
  },
];
