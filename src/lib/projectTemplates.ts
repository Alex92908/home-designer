/**
 * projectTemplates.ts — Full-project one-click templates.
 *
 * Unlike FloorplanLayout (rooms only) or StyleTemplate (materials/furniture),
 * a ProjectTemplate sets EVERYTHING in one shot:
 *   • exterior settings (floors, roof, colors, yard)
 *   • floor plan layout for each storey
 *   • yard plan (zones, trees, prefabs, paths)
 *
 * Applied via store.applyProjectTemplate(id).
 */

import type { ExteriorSettings, YardPlan, RoomType } from "./types";
import type { FloorplanLayout } from "./floorplanLayouts";

/** furnitureOverrides 里的一件家具（room-local 中心坐标 cm；rotation 度） */
export interface TemplatePlacedItem {
  furnitureId: string;
  x: number;
  z: number;
  rotation?: number;
  scaleW?: number;
  scaleD?: number;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  nameEn: string;
  emoji: string;
  description: string;
  descriptionEn: string;
  /** cm² shown in the picker */
  areaSqm: number;
  /** preview palette: [wallColor, roofColor, accentColor] */
  palette: [string, string, string];
  exterior: Partial<ExteriorSettings>;
  /** One entry per floor. Index 0 = ground floor. */
  floorLayouts: FloorplanLayout[];
  /** Yard plan applied to floor 0. */
  yardPlan: YardPlan;
  /**
   * Style template ID to apply for furniture + materials.
   * Matches an id in ALL_TEMPLATES (templates.ts).
   * Applied to every floor after layout is set up.
   */
  styleTemplateId: string;
  /**
   * 片场级显式摆放（可选）：风格模板铺完基础材质/家具后，逐房间**整体替换**
   * placedItems——非住宅片场（咖啡馆/办公室…）的家具不是"住宅风格"能推出来
   * 的，必须显式声明。数组每项对应一层楼；缺省/缺房间 = 保留风格模板的摆放。
   */
  furnitureOverrides?: Array<Partial<Record<RoomType, TemplatePlacedItem[]>>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 1 — 现代泳池别墅 (Modern Pool Villa) · 2F · 230㎡
// Wide white stucco / flat roof / pool garden
// ─────────────────────────────────────────────────────────────────────────────
const MODERN_POOL_VILLA: ProjectTemplate = {
  id: "modern-pool-villa",
  name: "现代泳池别墅",
  nameEn: "Modern Pool Villa",
  emoji: "🏊",
  description: "双层 · 平屋顶 · 泳池庭院 · 木格栅立面",
  descriptionEn: "2 Floors · Flat Roof · Pool Garden · Wood-Slat Facade",
  areaSqm: 230,
  palette: ["#F5F2EC", "#2A2A2A", "#8A6040"],
  styleTemplateId: "luxury",

  exterior: {
    preset: "modern-minimal",
    roofStyle: "flat",
    wallMaterial: "render",
    wallColor: "#F5F2EC",
    roofColor: "#2A2A2A",
    accentColor: "#8A6040",
    floors: 2,
    showPerimeterFence: true,
    fenceInsetMultiplier: 1.35,
    pilotisHeightM: 0,
  },

  // ── Floor 0: Ground floor ─────────────────────────────────────────────────
  // Layout (all cm, origin = top-left of floor plan):
  //   Column A (x 0–500):  Garage | Living
  //   Column B (x 500–860): Kitchen | Dining | Bathroom
  //   South deck (y 860):  Balcony
  floorLayouts: [
    {
      id: "mvp-f1",
      name: "别墅首层",
      area: 130,
      rooms: [
        // North wing
        { room: "garage",   x: 0,   y: 0,   width: 500, depth: 340 },
        { room: "kitchen",  x: 500, y: 0,   width: 360, depth: 340 },
        // Main living zone
        { room: "living",   x: 0,   y: 340, width: 500, depth: 520 },
        { room: "dining",   x: 500, y: 340, width: 360, depth: 360 },
        // Downstairs bathroom
        { room: "bathroom", x: 500, y: 700, width: 360, depth: 200 },
        // South deck / terrace
        { room: "balcony",  x: 0,   y: 860, width: 860, depth: 160 },
      ],
    },
    // ── Floor 1: Upper floor ─────────────────────────────────────────────────
    // Full-width master suite + two bedrooms + study + upper terrace
    {
      id: "mvp-f2",
      name: "别墅二层",
      area: 100,
      rooms: [
        { room: "master",    x: 0,   y: 0,   width: 540, depth: 420 },
        { room: "bathroom",  x: 540, y: 0,   width: 260, depth: 280 },
        { room: "study",     x: 800, y: 0,   width: 260, depth: 420 },
        { room: "bedroom",   x: 0,   y: 420, width: 420, depth: 380 },
        { room: "bedroom2",  x: 420, y: 420, width: 380, depth: 380 },
        { room: "bathroom2", x: 800, y: 420, width: 260, depth: 200 },
        // Upper terrace (same footprint as kitchen below)
        { room: "balcony2",  x: 0,   y: 800, width: 860, depth: 160 },
      ],
    },
  ],

  // ── Yard plan ─────────────────────────────────────────────────────────────
  // House footprint ≈ 8.6m × 10.2m; centre at (0, 0).
  // Front of house (south face) at z ≈ -510cm
  // Back (north)  at z ≈ +510cm
  // Left wall     at x ≈ -430cm
  // Right wall    at x ≈ +430cm
  yardPlan: {
    items: [
      // ── Pool + pool deck (front-left) ───────────────────────────────────
      { id: "vt-pool",     type: "prefab", prefabKind: "pool",
        x: -780, z: -420, rot: 0, scale: 1.0 },

      // ── Pergola (poolside shading) ────────────────────────────────────
      { id: "vt-pergola",  type: "prefab", prefabKind: "pergola_classic",
        x: -780, z: -780, rot: 0, scale: 0.9 },

      // ── Outdoor kitchen / BBQ ─────────────────────────────────────────
      { id: "vt-bbq",      type: "prefab", prefabKind: "outdoor_kitchen",
        x: -780, z: -980, rot: Math.PI / 2, scale: 1.0 },

      // ── Slat wall (privacy screen around pool area) ────────────────────
      { id: "vt-slat1",    type: "prefab", prefabKind: "slat_wall",
        x: -1060, z: -550, rot: 0, scale: 1.0,
        params: { lengthM: 6, heightM: 2.0 } },

      // ── Palm trees — SIDE positions only (not blocking front facade) ────
      // Camera views from +Z, building front face at z≈-530cm.
      // Trees must be at x<-1200 or x>1000 (off to sides) to avoid blocking.
      { id: "vt-palm1",    kind: "tree.palm", x: -1380, z: -200, rot: 0, scale: 0.9 },
      { id: "vt-palm2",    kind: "tree.palm", x: -1200, z: -650, rot: 0, scale: 1.0 },
      { id: "vt-palm3",    kind: "tree.palm", x: -1100, z:  350, rot: 0, scale: 0.85 },

      // ── Olive trees (sides, architectural specimens) ───────────────────
      { id: "vt-olive1",   kind: "tree.olive", x: -1300, z:  150, rot: 0, scale: 1.0 },
      { id: "vt-olive2",   kind: "tree.olive", x: -1300, z:  700, rot: 0, scale: 0.95 },
      { id: "vt-olive3",   kind: "tree.olive", x:  1200, z: -200, rot: 0, scale: 1.0 },
      { id: "vt-olive4",   kind: "tree.olive", x:  1050, z:  200, rot: 0, scale: 0.90 },

      // ── Cypress trees (north boundary, privacy) ───────────────────────
      { id: "vt-cyp1",     kind: "tree.olive", x: -600, z:  880, rot: 0, scale: 1.0 },
      { id: "vt-cyp2",     kind: "tree.olive", x:    0, z:  900, rot: 0, scale: 1.0 },
      { id: "vt-cyp3",     kind: "tree.olive", x:  600, z:  880, rot: 0, scale: 1.0 },

      // ── Feature rocks (entry garden) ──────────────────────────────────
      { id: "vt-rock1",    kind: "rock.tall",  x:  300, z: -640, rot: 0.4, scale: 0.8 },
      { id: "vt-rock2",    kind: "rock.large", x:  380, z: -600, rot: -0.3, scale: 0.7 },

      // ── Low plants (entry border) ─────────────────────────────────────
      { id: "vt-bush1",    kind: "plant.bushLarge", x:  120, z: -700, rot: 0, scale: 0.9 },
      { id: "vt-bush2",    kind: "plant.bushSmall", x:  200, z: -740, rot: 0, scale: 0.8 },
      { id: "vt-grass1",   kind: "plant.grass",     x:  480, z: -580, rot: 0, scale: 1.0 },
      { id: "vt-grass2",   kind: "plant.grass",     x:  580, z: -560, rot: 0.5, scale: 0.9 },

      // ── Zones (paving / lawn regions) ─────────────────────────────────
      // South patio (stone paving in front of house)
      {
        id: "vt-zone-patio", type: "zone", zoneKind: "social",
        x: -50, z: -680,
        polygon: [
          [-380, -200], [380, -200], [380, 200], [-380, 200],
        ] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
      // Pool deck (stone around pool)
      {
        id: "vt-zone-deck",  type: "zone", zoneKind: "private",
        x: -780, z: -520,
        polygon: [
          [-300, -360], [300, -360], [300, 360], [-300, 360],
        ] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
      // Lawn — right side of property
      {
        id: "vt-zone-lawn1", type: "zone", zoneKind: "lawn",
        x: 900, z: 0,
        polygon: [
          [-360, -700], [360, -700], [360, 700], [-360, 700],
        ] as Array<[number, number]>,
      },
      // Lawn — rear garden
      {
        id: "vt-zone-lawn2", type: "zone", zoneKind: "lawn",
        x: 0, z: 800,
        polygon: [
          [-800, -300], [800, -300], [800, 300], [-800, 300],
        ] as Array<[number, number]>,
      },
    ],

    // ── Paths ──────────────────────────────────────────────────────────────
    paths: [
      // Entry walkway: gate (south edge, z=-1200) → front door (house face, z=-510)
      {
        id: "vt-path-entry",
        points: [
          [0, -1200],
          [0, -520],
        ] as Array<[number, number]>,
        widthCm: 120,
        material: "stone",
      },
      // Pool surround path: connects entry to pool deck
      {
        id: "vt-path-pool",
        points: [
          [-100, -680],
          [-460, -680],
          [-460, -420],
        ] as Array<[number, number]>,
        widthCm: 80,
        material: "stone",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 2 — 日式枯山水庭院 (Japanese Dry Garden Villa) · 2F · 180㎡
// Pitched Chinese/Japanese roof · neutral palette · zen garden
// ─────────────────────────────────────────────────────────────────────────────
const JAPANESE_ZEN_VILLA: ProjectTemplate = {
  id: "japanese-zen-villa",
  name: "日式禅意庭院",
  nameEn: "Japanese Zen Courtyard",
  emoji: "⛩️",
  description: "双层 · 中式飞檐 · 枯山水 · 竹林围合",
  descriptionEn: "2 Floors · Flying Eaves · Dry Garden · Bamboo Grove",
  areaSqm: 180,
  palette: ["#F0EDE8", "#181818", "#5A4030"],
  styleTemplateId: "japanese",

  exterior: {
    preset: "japanese-zen",
    roofStyle: "chinese",
    wallMaterial: "wood",
    wallColor: "#F0EDE8",
    roofColor: "#181818",
    accentColor: "#5A4030",
    floors: 2,
    showPerimeterFence: true,
    fenceInsetMultiplier: 1.2,
    pilotisHeightM: 0.4,
  },

  floorLayouts: [
    {
      id: "jzv-f1",
      name: "禅院首层",
      area: 95,
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 600, depth: 480 },
        { room: "dining",   x: 600, y: 0,   width: 280, depth: 320 },
        { room: "kitchen",  x: 600, y: 320, width: 280, depth: 280 },
        { room: "bathroom", x: 0,   y: 480, width: 220, depth: 220 },
        { room: "study",    x: 220, y: 480, width: 380, depth: 220 },
        { room: "balcony",  x: 0,   y: 700, width: 880, depth: 140 },
      ],
    },
    {
      id: "jzv-f2",
      name: "禅院二层",
      area: 85,
      rooms: [
        { room: "master",    x: 0,   y: 0,   width: 480, depth: 400 },
        { room: "bathroom",  x: 480, y: 0,   width: 240, depth: 280 },
        { room: "bedroom",   x: 0,   y: 400, width: 400, depth: 360 },
        { room: "closet",    x: 400, y: 400, width: 320, depth: 220 },
        { room: "bathroom2", x: 400, y: 620, width: 320, depth: 180 },
        { room: "balcony2",  x: 0,   y: 760, width: 720, depth: 160 },
      ],
    },
  ],

  yardPlan: {
    items: [
      // Karesansui (dry garden) — large rock feature
      { id: "jz-rock1", kind: "rock.tall",    x: -500, z: -500, rot: 0.6, scale: 1.2 },
      { id: "jz-rock2", kind: "rock.large",   x: -400, z: -420, rot: -0.2, scale: 0.9 },
      { id: "jz-rock3", kind: "rock.stoneTall", x: -580, z: -380, rot: 1.1, scale: 0.8 },
      { id: "jz-rock4", kind: "rock.flat",    x: -460, z: -320, rot: 0, scale: 1.1 },

      // Bonsai specimens (entry / corners)
      { id: "jz-bonsai1", kind: "plant.bushSmall", x:  200, z: -600, rot: 0, scale: 1.1 },
      { id: "jz-bonsai2", kind: "plant.bushSmall", x: -200, z: -620, rot: 0.3, scale: 1.0 },
      { id: "jz-bonsai3", kind: "plant.bushSmall", x:  400, z: -200, rot: 0, scale: 0.9 },

      // Maple trees (seasonal colour)
      { id: "jz-maple1", kind: "tree.olive",   x: -900, z: -200, rot: 0, scale: 1.0 },
      { id: "jz-maple2", kind: "tree.olive",   x:  900, z:  200, rot: 0, scale: 1.0 },

      // Pine trees (perimeter)
      { id: "jz-pine1",  kind: "tree.olive",    x: -900, z:  600, rot: 0, scale: 1.2 },
      { id: "jz-pine2",  kind: "tree.olive",    x:  900, z:  600, rot: 0, scale: 1.2 },
      { id: "jz-pine3",  kind: "tree.olive",    x:    0, z:  950, rot: 0, scale: 1.3 },

      // Bamboo-style cypresses (side screen)
      { id: "jz-cyp1",   kind: "tree.olive", x: -1050, z:   0, rot: 0, scale: 1.1 },
      { id: "jz-cyp2",   kind: "tree.olive", x: -1050, z: 300, rot: 0, scale: 1.1 },
      { id: "jz-cyp3",   kind: "tree.olive", x: -1050, z:-300, rot: 0, scale: 1.1 },

      // Low ground plants
      { id: "jz-grass1", kind: "plant.grass",  x: -300, z: -700, rot: 0, scale: 0.9 },
      { id: "jz-grass2", kind: "plant.grass",  x:  300, z: -700, rot: 0.5, scale: 0.8 },
      { id: "jz-lily1",  kind: "plant.lily",   x: -100, z: -720, rot: 0, scale: 1.0 },

      // Fountain (water feature)
      { id: "jz-fountain", type: "prefab" as const, prefabKind: "fountain" as const,
        x: -550, z: -480, rot: 0, scale: 0.8 },

      // Zones
      {
        id: "jz-zone-gravel", type: "zone" as const, zoneKind: "private" as const,
        x: -500, z: -450,
        polygon: [
          [-350, -250], [350, -250], [350, 250], [-350, 250],
        ] as Array<[number, number]>,
        pavingMaterialId: "gravel",
      },
      {
        id: "jz-zone-lawn",  type: "zone" as const, zoneKind: "lawn" as const,
        x: 500, z: 200,
        polygon: [
          [-400, -700], [400, -700], [400, 700], [-400, 700],
        ] as Array<[number, number]>,
      },
      {
        id: "jz-zone-paving", type: "zone" as const, zoneKind: "utility" as const,
        x: 0, z: -650,
        polygon: [
          [-320, -200], [320, -200], [320, 200], [-320, 200],
        ] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
    ],

    paths: [
      // Stone stepping path to entrance
      {
        id: "jz-path-entry",
        points: [
          [0, -1100],
          [0, -520],
        ] as Array<[number, number]>,
        widthCm: 80,
        material: "stone",
      },
      // Garden loop path
      {
        id: "jz-path-garden",
        points: [
          [-100, -500],
          [-450, -500],
          [-620, -350],
          [-620, 200],
          [-400, 400],
          [0, 450],
        ] as Array<[number, number]>,
        widthCm: 60,
        material: "stone",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 3 — 地中海庭院别墅 (Mediterranean Courtyard Villa) · 2F · 200㎡
// Hip roof · warm terracotta / white · courtyard pool + orange trees
// ─────────────────────────────────────────────────────────────────────────────
const MEDITERRANEAN_VILLA: ProjectTemplate = {
  id: "mediterranean-villa",
  name: "地中海庭院别墅",
  nameEn: "Mediterranean Courtyard Villa",
  emoji: "🏛️",
  description: "双层 · 四坡顶 · 内庭院 · 橙树花园",
  descriptionEn: "2 Floors · Hip Roof · Inner Courtyard · Orange-Tree Garden",
  areaSqm: 200,
  palette: ["#FFF8E8", "#B83820", "#9B6B3A"],
  styleTemplateId: "stone-villa",

  exterior: {
    preset: "mediterranean",
    roofStyle: "hip",
    wallMaterial: "render",
    wallColor: "#FFF8E8",
    roofColor: "#B83820",
    accentColor: "#9B6B3A",
    floors: 2,
    showPerimeterFence: true,
    fenceInsetMultiplier: 1.25,
    pilotisHeightM: 0,
  },

  floorLayouts: [
    {
      id: "med-f1",
      name: "地中海首层",
      area: 110,
      rooms: [
        { room: "living",    x: 0,   y: 0,   width: 560, depth: 500 },
        { room: "dining",    x: 560, y: 0,   width: 320, depth: 340 },
        { room: "kitchen",   x: 560, y: 340, width: 320, depth: 320 },
        { room: "bathroom",  x: 0,   y: 500, width: 240, depth: 200 },
        { room: "garage",    x: 240, y: 500, width: 440, depth: 320 },
        { room: "balcony",   x: 0,   y: 700, width: 880, depth: 140 },
      ],
    },
    {
      id: "med-f2",
      name: "地中海二层",
      area: 90,
      rooms: [
        { room: "master",    x: 0,   y: 0,   width: 520, depth: 420 },
        { room: "bathroom",  x: 520, y: 0,   width: 240, depth: 280 },
        { room: "bedroom",   x: 0,   y: 420, width: 380, depth: 360 },
        { room: "bedroom2",  x: 380, y: 420, width: 380, depth: 360 },
        { room: "bathroom2", x: 760, y: 0,   width: 240, depth: 420 },
        { room: "balcony2",  x: 0,   y: 780, width: 760, depth: 160 },
      ],
    },
  ],

  yardPlan: {
    items: [
      // Fountain centrepiece (front garden)
      { id: "med-fountain", type: "prefab" as const, prefabKind: "fountain" as const,
        x: 0, z: -680, rot: 0, scale: 1.0 },

      // Orange / olive trees (Mediterranean character)
      { id: "med-olive1", kind: "tree.olive", x: -650, z: -600, rot: 0, scale: 1.1 },
      { id: "med-olive2", kind: "tree.olive", x:  650, z: -600, rot: 0, scale: 1.1 },
      { id: "med-olive3", kind: "tree.olive", x: -650, z:  400, rot: 0, scale: 1.0 },
      { id: "med-olive4", kind: "tree.olive", x:  650, z:  400, rot: 0, scale: 1.0 },

      // Cypress columns (formal entry)
      { id: "med-cyp1", kind: "tree.olive", x: -150, z: -900, rot: 0, scale: 1.2 },
      { id: "med-cyp2", kind: "tree.olive", x:  150, z: -900, rot: 0, scale: 1.2 },
      { id: "med-cyp3", kind: "tree.olive", x: -1000, z:  -50, rot: 0, scale: 1.1 },
      { id: "med-cyp4", kind: "tree.olive", x:  1000, z:  -50, rot: 0, scale: 1.1 },

      // Flower borders
      { id: "med-fl1", kind: "plant.flowerRed",    x: -300, z: -780, rot: 0, scale: 0.9 },
      { id: "med-fl2", kind: "plant.flowerYellow",  x:  300, z: -780, rot: 0, scale: 0.9 },
      { id: "med-fl3", kind: "plant.flowerPurple",  x: -200, z: -820, rot: 0, scale: 0.8 },
      { id: "med-fl4", kind: "plant.flowerRed",     x:  200, z: -820, rot: 0, scale: 0.8 },

      // Pool (side garden)
      { id: "med-pool", type: "prefab" as const, prefabKind: "pool" as const,
        x: -780, z: -200, rot: 0, scale: 0.9 },

      // Pergola (terrace shading)
      { id: "med-pergola", type: "prefab" as const, prefabKind: "pergola_classic" as const,
        x: 800, z: -300, rot: Math.PI / 2, scale: 0.85 },

      // Zones
      {
        id: "med-zone-patio", type: "zone" as const, zoneKind: "social" as const,
        x: 0, z: -680,
        polygon: [
          [-500, -300], [500, -300], [500, 300], [-500, 300],
        ] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
      {
        id: "med-zone-lawn1", type: "zone" as const, zoneKind: "lawn" as const,
        x: -700, z: 200,
        polygon: [
          [-300, -600], [300, -600], [300, 600], [-300, 600],
        ] as Array<[number, number]>,
      },
      {
        id: "med-zone-lawn2", type: "zone" as const, zoneKind: "lawn" as const,
        x:  700, z: 200,
        polygon: [
          [-300, -600], [300, -600], [300, 600], [-300, 600],
        ] as Array<[number, number]>,
      },
    ],

    paths: [
      // Formal entry path (wide, symmetrical)
      {
        id: "med-path-entry",
        points: [
          [0, -1150],
          [0, -980],
          [0, -520],
        ] as Array<[number, number]>,
        widthCm: 160,
        material: "stone",
      },
      // Side path to pool
      {
        id: "med-path-side",
        points: [
          [-440, -500],
          [-600, -500],
          [-600, -200],
        ] as Array<[number, number]>,
        widthCm: 80,
        material: "stone",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: generate glass-villa facade floors
// ─────────────────────────────────────────────────────────────────────────────
function glassFloors(n: number, withDoor: boolean[] = []) {
  return Array.from({ length: n }, (_, fi) => ({
    segments: withDoor[fi] ? [
      { id: `c1-${fi}`, type: "column" as const, widthFraction: 0.065, color: "#F2EFE8", material: "render" as const, frameColor: "#1A1A1A" },
      { id: `d1-${fi}`, type: "door"   as const, widthFraction: 0.17,  color: "#F2EFE8", material: "render" as const, frameColor: "#1A1A1A" },
      { id: `g1-${fi}`, type: "glass"  as const, widthFraction: 0.705, color: "#CBE8F5", frameColor: "#1A1A1A", panelCount: 4 },
      { id: `c2-${fi}`, type: "column" as const, widthFraction: 0.065, color: "#F2EFE8", material: "render" as const, frameColor: "#1A1A1A" },
    ] : [
      { id: `c1-${fi}`, type: "column" as const, widthFraction: 0.065, color: "#F2EFE8", material: "render" as const, frameColor: "#1A1A1A" },
      { id: `g1-${fi}`, type: "glass"  as const, widthFraction: 0.87,  color: "#CBE8F5", frameColor: "#1A1A1A", panelCount: 5 },
      { id: `c2-${fi}`, type: "column" as const, widthFraction: 0.065, color: "#F2EFE8", material: "render" as const, frameColor: "#1A1A1A" },
    ],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 4 — 现代玻璃幕墙别墅 · 2F · 280㎡
// 参考图风格：白色结构柱 + 落地玻璃幕墙 + 黑铝合金框 + 平屋顶深挑檐 + 泳池
// 2层宽体量 — 水平感强，与参考图比例一致
// ─────────────────────────────────────────────────────────────────────────────
const GLASS_CURTAIN_VILLA: ProjectTemplate = {
  id: "glass-curtain-villa",
  name: "现代玻璃幕墙别墅",
  nameEn: "Modern Glass-Curtain Villa",
  emoji: "🏢",
  description: "双层 · 平屋顶 · 全玻璃幕墙 · 泳池+棕榈庭院",
  descriptionEn: "2 Floors · Flat Roof · Full Glass Curtain · Pool + Palm Garden",
  areaSqm: 280,
  palette: ["#F2EFE8", "#1A1A1A", "#CBE8F5"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset:       "modern-minimal",
    roofStyle:    "flat",
    roofColor:    "#1C1C1C",
    wallMaterial: "render",
    wallColor:    "#F2EFE8",
    accentColor:  "#1A1A1A",
    floors: 2,
    showPerimeterFence: false,
    fenceInsetMultiplier: 1.65,
    pilotisHeightM: 0,
    buildingType: "rich-glass-villa",  // → GlbVillaBuilding (villa_pbr.glb)
    facades: {},
  },

  // ── Floor layouts — wide open-plan to match reference proportions ─────────
  // Building footprint ≈ 12m wide × 9m deep (W from room widths summed)
  floorLayouts: [
    {
      id: "gcv-f1",
      name: "首层 (Ground)",
      area: 160,
      rooms: [
        // North wing: garage + kitchen + dining
        { room: "garage",    x: 0,    y: 0,   width: 580, depth: 360 },
        { room: "kitchen",   x: 580,  y: 0,   width: 380, depth: 240 },
        { room: "dining",    x: 580,  y: 240, width: 380, depth: 280 },
        { room: "study",     x: 960,  y: 0,   width: 280, depth: 360 },
        // Main living zone — large open-plan facing south (full width)
        { room: "living",    x: 0,    y: 360, width: 900, depth: 540 },
        // WC + utility
        { room: "bathroom",  x: 900,  y: 360, width: 340, depth: 260 },
        // South-facing terrace connecting to pool
        { room: "balcony",   x: 0,    y: 900, width: 1240, depth: 160 },
      ],
    },
    {
      id: "gcv-f2",
      name: "二层",
      area: 140,
      rooms: [
        // Master suite (south-facing glass wall, generous)
        { room: "master",    x: 0,    y: 0,   width: 620, depth: 460 },
        { room: "closet",    x: 620,  y: 0,   width: 260, depth: 300 },
        { room: "bathroom",  x: 620,  y: 300, width: 360, depth: 300 },
        // Two guest bedrooms
        { room: "bedroom",   x: 0,    y: 460, width: 480, depth: 400 },
        { room: "bedroom2",  x: 480,  y: 460, width: 480, depth: 400 },
        { room: "bathroom2", x: 960,  y: 460, width: 280, depth: 280 },
        // Upper terrace — glass balustrade with pool view
        { room: "balcony2",  x: 0,    y: 860, width: 1240, depth: 160 },
      ],
    },
  ],

  // ── Yard plan ─────────────────────────────────────────────────────────────
  // House ≈ 8.2m × 10m, centre at origin.
  // Front face (towards viewer) at z ≈ -500cm
  yardPlan: {
    items: [
      // ── Swimming pool (front-left, key feature) ───────────────────────
      { id: "gcv-pool",    type: "prefab", prefabKind: "pool",
        x: -820, z: -380, rot: 0, scale: 1.1 },

      // ── Pergola / shade sail (far end of pool deck) ──────────────────
      { id: "gcv-pergola", type: "prefab", prefabKind: "pergola_classic",
        x: -860, z: -840, rot: 0, scale: 0.95 },

      // ── Privacy slat wall (west side of pool) ─────────────────────────
      { id: "gcv-slat",    type: "prefab", prefabKind: "slat_wall",
        x: -1180, z: -560, rot: 0, scale: 1.0,
        params: { lengthM: 9, heightM: 2.4 } },

      // ── Pool lounge chairs — iconic paired chairs flanking pool long sides
      { id: "gcv-lounger1", kind: "furniture.swimmingLounger", x: -560, z: -300, rot: 0,           scale: 1.0 },
      { id: "gcv-lounger2", kind: "furniture.swimmingLounger", x: -560, z: -420, rot: 0,           scale: 1.0 },
      { id: "gcv-lounger3", kind: "furniture.swimmingLounger", x: -1100, z: -300, rot: Math.PI,    scale: 1.0 },
      { id: "gcv-lounger4", kind: "furniture.swimmingLounger", x: -1100, z: -420, rot: Math.PI,    scale: 1.0 },
      // Two at far end (south)
      { id: "gcv-lounger5", kind: "furniture.swimmingLounger", x: -720, z: -740, rot: -Math.PI/2, scale: 1.0 },
      { id: "gcv-lounger6", kind: "furniture.swimmingLounger", x: -860, z: -740, rot: -Math.PI/2, scale: 1.0 },

      // ── Outdoor side table between loungers ──────────────────────────
      { id: "gcv-sidetable1", kind: "furniture.chaiseLounger", x: -560, z: -360, rot: Math.PI/2, scale: 0.5 },

      // ── Palm trees — pool-side atmosphere, positioned so they frame not block ──
      // Left of pool (x far negative), in front Z zone (visible foreground)
      { id: "gcv-palm1",   kind: "tree.palm", x: -1320, z: -300, rot: 0,   scale: 1.2 },
      { id: "gcv-palm2",   kind: "tree.palm", x: -1240, z: -600, rot: 0.4, scale: 1.0 },
      // Behind the slat wall (not blocking pool or facade)
      { id: "gcv-palm3",   kind: "tree.palm", x: -1400, z:  200, rot: 0,   scale: 1.1 },
      // Right side — beside fence but not in direct line from camera to building
      { id: "gcv-palm4",   kind: "tree.palm", x:  1300, z: -600, rot: 0.6, scale: 0.9 },

      // ── Olive trees — flanking far sides of building (NOT in front sight line) ──
      { id: "gcv-olive1",  kind: "tree.olive", x: -1500, z:  200, rot: 0,   scale: 1.1 },
      { id: "gcv-olive2",  kind: "tree.olive", x: -1500, z:  600, rot: 0.2, scale: 1.0 },
      { id: "gcv-olive3",  kind: "tree.olive", x:  1500, z:  100, rot: 0,   scale: 1.0 },
      { id: "gcv-olive4",  kind: "tree.olive", x:  1500, z:  500, rot: 0,   scale: 0.9 },

      // ── Cypress / tall pine — far back corners (sky framing, not blocking view) ─
      { id: "gcv-cyp1",    kind: "tree.olive", x: -900, z:  900, rot: 0, scale: 1.3 },
      { id: "gcv-cyp2",    kind: "tree.olive", x:    0, z: 1000, rot: 0, scale: 1.3 },
      { id: "gcv-cyp3",    kind: "tree.olive", x:  900, z:  900, rot: 0, scale: 1.2 },
      { id: "gcv-cyp4",    kind: "tree.olive", x: -1500, z: -400, rot: 0, scale: 1.1 },

      // ── Ornamental grasses + low plants (entry garden) ────────────────
      { id: "gcv-gr1",     kind: "plant.grass",      x:  380, z: -720, rot: 0,   scale: 1.0 },
      { id: "gcv-gr2",     kind: "plant.grass",      x:  500, z: -680, rot: 0.5, scale: 0.85 },
      { id: "gcv-bush1",   kind: "plant.bushLarge",  x: -360, z: -780, rot: 0,   scale: 0.9 },
      { id: "gcv-bush2",   kind: "plant.bushSmall",  x:  360, z: -660, rot: 0,   scale: 0.8 },

      // ── Feature rocks (entry sculpture garden) ────────────────────────
      { id: "gcv-rock1",   kind: "rock.tall",   x:  640, z: -560, rot: 0.5, scale: 0.9 },
      { id: "gcv-rock2",   kind: "rock.large",  x:  720, z: -500, rot: -0.3, scale: 0.75 },

      // ── Zones ─────────────────────────────────────────────────────────
      // Large travertine-paved forecourt connecting entry path to pool deck
      {
        id: "gcv-zone-court", type: "zone" as const, zoneKind: "utility" as const,
        x: -140, z: -720,
        polygon: [[-520, -280], [380, -280], [380, 280], [-520, 280]] as Array<[number,number]>,
        pavingMaterialId: "stone_grey",
      },
      // Wide travertine pool deck — extends on all long sides of pool
      {
        id: "gcv-zone-deck",  type: "zone" as const, zoneKind: "social" as const,
        x: -830, z: -500,
        polygon: [[-420, -440], [420, -440], [420, 440], [-420, 440]] as Array<[number,number]>,
        pavingMaterialId: "stone_grey",
      },
      // Right-side lawn
      {
        id: "gcv-zone-lawn1", type: "zone" as const, zoneKind: "lawn" as const,
        x: 960, z: 0,
        polygon: [[-380, -900], [380, -900], [380, 900], [-380, 900]] as Array<[number,number]>,
      },
      // Rear garden
      {
        id: "gcv-zone-lawn2", type: "zone" as const, zoneKind: "lawn" as const,
        x: 0, z: 880,
        polygon: [[-860, -320], [860, -320], [860, 320], [-860, 320]] as Array<[number,number]>,
      },
    ],

    paths: [
      // Wide entry drive (double-car width)
      {
        id: "gcv-path-drive",
        points: [[0, -1300], [0, -1000], [0, -560]] as Array<[number,number]>,
        widthCm: 180,
        material: "stone",
      },
      // Connecting path: entrance court → pool deck
      {
        id: "gcv-path-pool",
        points: [[-140, -720], [-420, -720], [-420, -540]] as Array<[number,number]>,
        widthCm: 100,
        material: "stone",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 5 — 豪华三层玻璃幕墙别墅 · 3F · 320㎡
//
// 布局逻辑（合理化设计）：
//   1F 社交层：厨房 + 餐厅（开敞） + 客厅（大厅） + 书房 + 卫生间
//   2F 私密层：主卧套房（含衣帽间+主浴） + 次卧×3 + 走廊
//   3F 顶层：一间大套间 + 全幅观景露台（南向）
//
// 楼梯间贯穿三层，保持同一水平坐标（x=1000，宽200）。
// 建筑面宽 1200cm（12m），进深 900cm（9m）。
// 外观：落地玻璃幕墙 + 平屋顶 + 黑色铝合金框，floor-plan-driven 模式
// ─────────────────────────────────────────────────────────────────────────────
const LUXURY_3F_GLASS_VILLA: ProjectTemplate = {
  id: "luxury-3f-glass-villa",
  name: "豪华三层玻璃别墅",
  nameEn: "Luxury 3-Floor Glass Villa",
  emoji: "🏙️",
  description: "三层 · 落地玻璃幕墙 · 泳池庭院 · 开放式布局",
  descriptionEn: "3 Floors · Floor-to-Ceiling Glass · Pool Garden · Open Layout",
  areaSqm: 320,
  palette: ["#F2EFE8", "#1A1A1A", "#CBE8F5"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset:       "modern-minimal",
    roofStyle:    "flat",
    roofColor:    "#1C1C1C",
    wallMaterial: "render",
    wallColor:    "#F2EFE8",
    accentColor:  "#1A1A1A",
    floors: 3,
    showPerimeterFence: false,
    fenceInsetMultiplier: 1.65,
    pilotisHeightM: 0,
    buildingType: "floor-plan-driven",
  },

  floorLayouts: [
    // ── 1F · 社交娱乐层 ────────────────────────────────────────────────────
    // 平面逻辑：
    //   北区（y=0–320）  ：厨房 | 卫生间 | 餐厅（开敞，连客厅）
    //   中区（y=320–400）：走廊（横向贯通）
    //   南区（y=400–900）：客厅（大）  | 书房
    //   右柱（x=1000–1200）：楼梯间（贯穿 y=0–440）
    {
      id: "l3g-f1",
      name: "1F · 社交娱乐层",
      area: 120,
      rooms: [
        // North service zone
        { room: "kitchen",  x: 0,    y: 0,   width: 400, depth: 320 },
        { room: "bathroom", x: 400,  y: 0,   width: 220, depth: 320 },
        { room: "dining",   x: 620,  y: 0,   width: 380, depth: 440 },  // 3.8×4.4m — open dining
        // Right column: stairwell
        { room: "stair",    x: 1000, y: 0,   width: 200, depth: 440 },
        // Central circulation
        { room: "hallway",  x: 0,    y: 320, width: 620, depth: 80  },
        // South living zone
        { room: "living",   x: 0,    y: 400, width: 670, depth: 500 },  // 6.7×5.0m — grand living
        { room: "study",    x: 670,  y: 400, width: 330, depth: 500 },  // 3.3×5.0m — study/office
      ],
    },

    // ── 2F · 卧室私密层 ───────────────────────────────────────────────────
    // 平面逻辑：
    //   北区（y=0–420）  ：主卧 + 衣帽间 + 主浴（主卧套房）
    //   走廊（y=420–500）：横向贯通
    //   南区（y=500–920）：次卧 × 3（并排）
    //   右柱（x=1000–1200）：楼梯间（同 1F 位置）
    {
      id: "l3g-f2",
      name: "2F · 卧室私密层",
      area: 115,
      rooms: [
        // Master suite
        { room: "master",   x: 0,    y: 0,   width: 520, depth: 420 },  // 5.2×4.2m
        { room: "closet",   x: 520,  y: 0,   width: 200, depth: 420 },  // 2.0×4.2m walk-in
        { room: "bathroom", x: 720,  y: 0,   width: 280, depth: 420 },  // 2.8×4.2m ensuite
        // Stairwell (same x as 1F)
        { room: "stair",    x: 1000, y: 0,   width: 200, depth: 440 },
        // Central hallway
        { room: "hallway",  x: 0,    y: 420, width: 1000, depth: 80  },
        // Secondary bedrooms
        { room: "bedroom",  x: 0,    y: 500, width: 380, depth: 420 },  // 3.8×4.2m
        { room: "bedroom2", x: 380,  y: 500, width: 340, depth: 420 },  // 3.4×4.2m
        { room: "bedroom3", x: 720,  y: 500, width: 280, depth: 420 },  // 2.8×4.2m
      ],
    },

    // ── 3F · 顶层雅室 ─────────────────────────────────────────────────────
    // 平面逻辑：
    //   北区（y=0–500）：顶层大套间（卧室 + 书房2 + 卫生间2）
    //   南区（y=500–720）：全幅观景露台（12m 宽，面向花园泳池）
    //   右柱：楼梯间（同 1/2F 位置，顶层上楼口）
    {
      id: "l3g-f3",
      name: "3F · 顶层观景套间",
      area: 85,
      rooms: [
        // Penthouse suite
        { room: "master",    x: 0,    y: 0,   width: 560, depth: 500 },  // 5.6×5.0m penthouse bedroom
        { room: "bathroom2", x: 560,  y: 0,   width: 260, depth: 320 },  // 2.6×3.2m
        { room: "study2",    x: 820,  y: 0,   width: 180, depth: 320 },  // 1.8×3.2m penthouse study
        // Stairwell top landing (same x=1000)
        { room: "stair",     x: 1000, y: 0,   width: 200, depth: 440 },
        // Hallway (service corridor)
        { room: "hallway",   x: 560,  y: 320, width: 440, depth: 80  },
        // Panoramic rooftop terrace (full south width)
        { room: "balcony2",  x: 0,    y: 500, width: 1200, depth: 220 }, // 12.0×2.2m terrace
      ],
    },
  ],

  // ── Yard plan ─────────────────────────────────────────────────────────────
  // 建筑面宽约 12m，深约 9.2m，中心 (0,0)。
  // 南立面（面向泳池/庭院）约 z = -460cm
  // 北立面（背面）约 z = +460cm
  yardPlan: {
    items: [
      // ── Swimming pool (south-west, key feature) ──────────────────────────
      { id: "l3g-pool",     type: "prefab", prefabKind: "pool",
        x: -850, z: -380, rot: 0, scale: 1.15 },

      // ── Pergola (end of pool deck) ───────────────────────────────────────
      { id: "l3g-pergola",  type: "prefab", prefabKind: "pergola_classic",
        x: -880, z: -820, rot: 0, scale: 1.0 },

      // ── Privacy slat wall (west of pool) ─────────────────────────────────
      { id: "l3g-slat",     type: "prefab", prefabKind: "slat_wall",
        x: -1200, z: -560, rot: 0, scale: 1.0,
        params: { lengthM: 10, heightM: 2.4 } },

      // ── Pool loungers ─────────────────────────────────────────────────────
      { id: "l3g-lngr1",    kind: "furniture.swimmingLounger", x: -580, z: -280, rot: 0,           scale: 1.0 },
      { id: "l3g-lngr2",    kind: "furniture.swimmingLounger", x: -580, z: -420, rot: 0,           scale: 1.0 },
      { id: "l3g-lngr3",    kind: "furniture.swimmingLounger", x: -1120, z: -280, rot: Math.PI,    scale: 1.0 },
      { id: "l3g-lngr4",    kind: "furniture.swimmingLounger", x: -1120, z: -420, rot: Math.PI,    scale: 1.0 },

      // ── Palm trees ────────────────────────────────────────────────────────
      { id: "l3g-palm1",    kind: "tree.palm", x: -1350, z: -280, rot: 0,   scale: 1.3 },
      { id: "l3g-palm2",    kind: "tree.palm", x: -1260, z: -620, rot: 0.4, scale: 1.1 },
      { id: "l3g-palm3",    kind: "tree.palm", x: -1420, z:  240, rot: 0,   scale: 1.2 },
      { id: "l3g-palm4",    kind: "tree.palm", x:  1350, z: -580, rot: 0.6, scale: 1.0 },

      // ── Olive trees (architectural, sides) ───────────────────────────────
      { id: "l3g-olv1",     kind: "tree.olive", x: -1520, z:  200, rot: 0,   scale: 1.2 },
      { id: "l3g-olv2",     kind: "tree.olive", x: -1520, z:  620, rot: 0.2, scale: 1.1 },
      { id: "l3g-olv3",     kind: "tree.olive", x:  1520, z:  100, rot: 0,   scale: 1.1 },
      { id: "l3g-olv4",     kind: "tree.olive", x:  1520, z:  520, rot: 0,   scale: 1.0 },

      // ── Cypress (rear boundary) ───────────────────────────────────────────
      { id: "l3g-cyp1",     kind: "tree.olive", x: -900, z:  920, rot: 0, scale: 1.4 },
      { id: "l3g-cyp2",     kind: "tree.olive", x:    0, z: 1000, rot: 0, scale: 1.4 },
      { id: "l3g-cyp3",     kind: "tree.olive", x:  900, z:  920, rot: 0, scale: 1.3 },
      { id: "l3g-cyp4",     kind: "tree.olive", x: -1500, z: -380, rot: 0, scale: 1.2 },

      // ── Entry garden (ornamental rocks + low plants) ──────────────────────
      { id: "l3g-rock1",    kind: "rock.tall",        x:  660, z: -560, rot: 0.5, scale: 0.9 },
      { id: "l3g-rock2",    kind: "rock.large",       x:  740, z: -500, rot: -0.3, scale: 0.8 },
      { id: "l3g-gr1",      kind: "plant.grass",      x:  400, z: -720, rot: 0,   scale: 1.1 },
      { id: "l3g-gr2",      kind: "plant.grass",      x:  520, z: -680, rot: 0.5, scale: 0.9 },
      { id: "l3g-bush1",    kind: "plant.bushLarge",  x: -380, z: -800, rot: 0,   scale: 1.0 },
      { id: "l3g-bush2",    kind: "plant.bushSmall",  x:  380, z: -660, rot: 0,   scale: 0.9 },

      // ── Zones ─────────────────────────────────────────────────────────────
      // Entry forecourt (stone paving)
      {
        id: "l3g-z-court",  type: "zone" as const, zoneKind: "utility" as const,
        x: -100, z: -740,
        polygon: [[-540, -280], [400, -280], [400, 280], [-540, 280]] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
      // Pool deck (travertine)
      {
        id: "l3g-z-deck",   type: "zone" as const, zoneKind: "social" as const,
        x: -860, z: -500,
        polygon: [[-440, -440], [440, -440], [440, 440], [-440, 440]] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
      // East lawn
      {
        id: "l3g-z-lawn1",  type: "zone" as const, zoneKind: "lawn" as const,
        x: 980, z: 0,
        polygon: [[-380, -920], [380, -920], [380, 920], [-380, 920]] as Array<[number, number]>,
      },
      // Rear garden
      {
        id: "l3g-z-lawn2",  type: "zone" as const, zoneKind: "lawn" as const,
        x: 0, z: 900,
        polygon: [[-880, -320], [880, -320], [880, 320], [-880, 320]] as Array<[number, number]>,
      },
    ],

    paths: [
      // Main entry drive
      {
        id: "l3g-p-drive",
        points: [[0, -1350], [0, -1000], [0, -580]] as Array<[number, number]>,
        widthCm: 200,
        material: "stone",
      },
      // Entry court → pool deck connector
      {
        id: "l3g-p-pool",
        points: [[-140, -740], [-440, -740], [-440, -560]] as Array<[number, number]>,
        widthCm: 100,
        material: "stone",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 6 — 木饰面泳池别墅 (Wood-Accent Pool Villa) · 2F · 280㎡
// Source: reference photo — white stucco + walnut soffit + full-glass ground
// floor + upper balcony + front travertine pool deck + pine backdrop
// ─────────────────────────────────────────────────────────────────────────────
const WOOD_ACCENT_POOL_VILLA: ProjectTemplate = {
  id: "wood-accent-pool-villa",
  name: "木饰面泳池别墅",
  nameEn: "Wood-Veneer Pool Villa",
  emoji: "🏡",
  description: "双层 · 白墙核桃木顶 · 落地玻璃 · 前院石板泳池",
  descriptionEn: "2 Floors · White Walls & Walnut Ceiling · Glass Walls · Front-Yard Slate Pool",
  areaSqm: 280,
  palette: ["#EDE9E3", "#1C1814", "#8A5E38"],
  styleTemplateId: "walnut-villa",

  exterior: {
    preset: "modern-minimal",
    roofStyle: "flat",
    wallMaterial: "render",
    wallColor: "#EDE9E3",
    roofColor: "#1C1814",
    accentColor: "#8A5E38",
    floors: 2,
    showPerimeterFence: false,
    fenceInsetMultiplier: 1.5,
    pilotisHeightM: 0,
    buildingType: "floor-plan-driven",
  },

  // ── 1F: 社交开放层 ─────────────────────────────────────────────────────────
  // 平面逻辑（cm，左上角为原点）:
  //   南区玻璃幕墙（y 0–520）: 客厅 | 餐厅
  //   中区（y 520–600）: 走廊
  //   北区（y 0–740）右侧: 厨房 | 卫生间 | 书房
  //   楼梯间（x 1200–1400，y 0–440）
  //   南露台阳台（y 760–920，全宽）
  floorLayouts: [
    {
      id: "wapv-f1",
      name: "首层",
      area: 148,
      rooms: [
        // ── 南侧大开间（落地玻璃，面向泳池）──
        { room: "living",   x: 0,    y: 0,   width: 600, depth: 520 },
        { room: "dining",   x: 600,  y: 0,   width: 380, depth: 380 },
        // ── 北侧功能区 ──
        { room: "kitchen",  x: 600,  y: 380, width: 380, depth: 360 },
        { room: "bathroom", x: 980,  y: 0,   width: 220, depth: 300 },
        { room: "study",    x: 980,  y: 300, width: 220, depth: 340 },
        // ── 楼梯间（贯穿两层，同 x） ──
        { room: "stair",    x: 1200, y: 0,   width: 200, depth: 440 },
        // ── 走廊（横贯客厅北侧）──
        { room: "hallway",  x: 0,    y: 520, width: 980, depth: 80 },
        // ── 南露台（面向泳池）──
        { room: "balcony",  x: 0,    y: 600, width: 1200, depth: 180 },
      ],
    },

    // ── 2F: 私密休憩层 ────────────────────────────────────────────────────────
    // 平面逻辑:
    //   主卧套房（西）| 2 卧室（东）| 楼梯 | 南阳台（全宽落地玻璃）
    {
      id: "wapv-f2",
      name: "二层",
      area: 132,
      rooms: [
        { room: "master",    x: 0,    y: 0,   width: 580, depth: 460 },
        { room: "closet",    x: 580,  y: 0,   width: 220, depth: 280 },
        { room: "bathroom",  x: 580,  y: 280, width: 220, depth: 260 },
        { room: "bedroom",   x: 800,  y: 0,   width: 400, depth: 460 },
        { room: "stair",     x: 1200, y: 0,   width: 200, depth: 440 },
        // ── 上层南阳台（落地玻璃栏杆，面向泳池）──
        { room: "balcony2",  x: 0,    y: 460, width: 1200, depth: 200 },
      ],
    },
  ],

  // ── 庭院 ──────────────────────────────────────────────────────────────────
  // 坐标系：z 正 = 南（相机侧 / 建筑正面），z 负 = 北（背面）
  // 建筑足迹 ≈ 14m × 7.8m（1F 含阳台 ≈ 14×9.8m）
  //   南立面（朝向泳池 / 相机）≈ z = +500 cm
  //   北立面（背侧）          ≈ z = -390 cm
  //   西墙 W ≈ x = -700 cm
  //   东墙 E ≈ x = +700 cm
  yardPlan: {
    items: [
      // ── 泳池（前院中央，正南方，落地玻璃可直视）──────────────────────────
      { id: "wapv-pool",  type: "prefab", prefabKind: "pool",
        x: 0, z: 1100, rot: 0, scale: 1.2 },

      // ── 躺椅：泳池两侧各 3 把 ───────────────────────────────────────────
      { id: "wapv-lnge1", kind: "furniture.chaiseLounger", x: -560, z:  960,  rot: 0,           scale: 1.0 },
      { id: "wapv-lnge2", kind: "furniture.chaiseLounger", x: -560, z: 1080,  rot: 0,           scale: 1.0 },
      { id: "wapv-lnge3", kind: "furniture.chaiseLounger", x: -560, z: 1200,  rot: 0,           scale: 1.0 },
      { id: "wapv-lnge4", kind: "furniture.chaiseLounger", x:  560, z:  960,  rot: Math.PI,     scale: 1.0 },
      { id: "wapv-lnge5", kind: "furniture.chaiseLounger", x:  560, z: 1080,  rot: Math.PI,     scale: 1.0 },
      { id: "wapv-lnge6", kind: "furniture.chaiseLounger", x:  560, z: 1200,  rot: Math.PI,     scale: 1.0 },

      // ── 松树：前院左右各 2 棵（参考图背景） ─────────────────────────────
      { id: "wapv-pine1", kind: "tree.olive", x: -1300, z:  800,  rot: 0.3,  scale: 1.2 },
      { id: "wapv-pine2", kind: "tree.olive", x: -1500, z:  200,  rot: 0,    scale: 1.0 },
      { id: "wapv-pine3", kind: "tree.olive", x:  1400, z:  600,  rot: -0.2, scale: 1.1 },
      { id: "wapv-pine4", kind: "tree.olive", x:  1600, z: -100,  rot: 0.4,  scale: 1.0 },
      // ── 松树：后院（北侧隐私围合） ──────────────────────────────────────
      { id: "wapv-pine5", kind: "tree.olive", x: -1000, z: -600,  rot: 0.1,  scale: 0.9 },
      { id: "wapv-pine6", kind: "tree.olive", x:  1100, z: -700,  rot: -0.3, scale: 0.95},

      // ── 橄榄树：建筑两侧近景 ────────────────────────────────────────────
      { id: "wapv-olv1",  kind: "tree.olive", x: -900, z:  500, rot: 0,   scale: 0.9 },
      { id: "wapv-olv2",  kind: "tree.olive", x:  900, z:  400, rot: 0.2, scale: 0.85},

      // ── 观赏草：泳池边缘点缀 ────────────────────────────────────────────
      { id: "wapv-gr1",   kind: "plant.grass", x: -350, z: 1400,  rot: 0,    scale: 1.0 },
      { id: "wapv-gr2",   kind: "plant.grass", x:  300, z: 1420,  rot: 0.3,  scale: 0.9 },
      { id: "wapv-gr3",   kind: "plant.grass", x: -700, z: 1050,  rot: -0.2, scale: 1.0 },
      { id: "wapv-gr4",   kind: "plant.grass", x:  700, z:  900,  rot: 0.5,  scale: 0.85},

      // ── 小灌木：石板区边缘 ──────────────────────────────────────────────
      { id: "wapv-bush1", kind: "plant.bushSmall", x: -480, z: 1450, rot: 0,   scale: 0.8 },
      { id: "wapv-bush2", kind: "plant.bushSmall", x:  420, z: 1460, rot: 0.3, scale: 0.75},
      { id: "wapv-bush3", kind: "plant.bushLarge", x: -820, z:  700, rot: 0,   scale: 0.7 },
      { id: "wapv-bush4", kind: "plant.bushLarge", x:  840, z:  680, rot: 0.2, scale: 0.65},

      // ── 大门 + 两侧格栅围墙（南界，临街）───────────────────────────────
      { id: "wapv-gate",  kind: "feature.fenceGate",
        x: 0, z: 1760, rot: 0, scale: 3.5 },
      { id: "wapv-slat-l", type: "prefab", prefabKind: "slat_wall",
        x: -540, z: 1760, rot: 0, scale: 1.0,
        params: { lengthM: 7, heightM: 2.2 } },
      { id: "wapv-slat-r", type: "prefab", prefabKind: "slat_wall",
        x:  540, z: 1760, rot: 0, scale: 1.0,
        params: { lengthM: 7, heightM: 2.2 } },
      { id: "wapv-gate-bush-l", kind: "plant.bushLarge", x: -280, z: 1780, rot: 0,   scale: 0.9 },
      { id: "wapv-gate-bush-r", kind: "plant.bushLarge", x:  280, z: 1780, rot: 0.2, scale: 0.9 },

      // ── 区域：入户前院石板（建筑南立面至大门之间）──────────────────────
      {
        id: "wapv-zone-forecourt", type: "zone", zoneKind: "social",
        x: 0, z: 680,
        polygon: [
          [-700, -180], [700, -180], [700, 180], [-700, 180],
        ] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
      // ── 区域：泳池石板甲板 ───────────────────────────────────────────────
      {
        id: "wapv-zone-deck", type: "zone", zoneKind: "private",
        x: 0, z: 1100,
        polygon: [
          [-800, -500], [800, -500], [800, 500], [-800, 500],
        ] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
      // ── 区域：后院草坪（北侧，私密）────────────────────────────────────
      {
        id: "wapv-zone-lawn", type: "zone", zoneKind: "lawn",
        x: 0, z: -700,
        polygon: [
          [-900, -300], [900, -300], [900, 300], [-900, 300],
        ] as Array<[number, number]>,
      },
    ],

    paths: [
      // 入户通道：南侧大门 → 建筑南立面
      {
        id: "wapv-path-entry",
        points: [
          [0,    1800],
          [0,     860],
        ] as Array<[number, number]>,
        widthCm: 140,
        material: "stone",
      },
      // 连接通道：入户区 → 泳池甲板左侧
      {
        id: "wapv-path-pool",
        points: [
          [-140,  860],
          [-560,  860],
          [-560, 1100],
        ] as Array<[number, number]>,
        widthCm: 100,
        material: "stone",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 7 — 现代悬挑玻璃别墅 (Modern Cantilever Glass Villa) · 2F · 300㎡
//
// 直接对标用户参考照片：
//   • 通高黑框落地玻璃幕墙主体（rich-glass-villa 渲染器逐物件还原参考图）
//   • 深挑檐平屋顶 + 胡桃木挑檐吊顶（暖白涂料 + #8B6340 木饰面，渲染器内置）
//   • 二层悬挑 + 玻璃栏杆露台 + 白色楼层板带
//   • 左侧木饰面单层翼 + 纤细钢柱柱廊
//   • 前院石板甲板 + 矩形泳池（圆弧端）+ 成排躺椅 + 松柏背景 + 木格栅围墙
//
// 注意：渲染器是 rich-glass-villa（HouseCanvas.tsx 内逐物件还原参考图），
// 面宽/进深取首层"室内"房间包围盒（阳台等室外房间不计）。所以这里把首层
// 室内做成宽体横向布局（约 14m 宽 × 9m 深），贴合照片的全景宽幅比例。
// 外立面颜色由渲染器内置（暖白 + 胡桃木），模板的 wallColor 等仅影响 2D/室内。
// ─────────────────────────────────────────────────────────────────────────────
const MODERN_CANTILEVER_GLASS_VILLA: ProjectTemplate = {
  id: "modern-cantilever-glass-villa",
  name: "现代悬挑玻璃别墅",
  nameEn: "Modern Cantilever Glass Villa",
  emoji: "🌿",
  description: "双层 · 落地玻璃幕墙 · 胡桃木挑檐 · 悬挑玻璃栏杆 · 前院泳池",
  descriptionEn: "2 Floors · Glass Curtain · Walnut Soffit · Cantilever Balcony · Pool",
  areaSqm: 300,
  palette: ["#F0EDE6", "#1C1C1C", "#8B6340"],
  styleTemplateId: "walnut-villa",

  exterior: {
    preset:       "modern-minimal",
    roofStyle:    "flat",
    roofColor:    "#1C1C1C",
    wallMaterial: "render",
    wallColor:    "#F0EDE6",
    accentColor:  "#8B6340",
    floors: 2,
    showPerimeterFence: false,
    fenceInsetMultiplier: 1.6,
    pilotisHeightM: 0,
    buildingType: "rich-glass-villa",  // → RichGlassVillaBuilding（逐物件还原参考图）
    facades: {},
  },

  // ── 首层：社交开放层（宽体横向，室内包围盒 ≈ 14m × 9m）─────────────────────
  floorLayouts: [
    {
      id: "mcgv-f1",
      name: "首层 (Ground)",
      area: 168,
      rooms: [
        // 南侧大开间（落地玻璃，面向泳池）
        { room: "living",   x: 0,    y: 360, width: 760,  depth: 540 },
        // 北侧服务区
        { room: "kitchen",  x: 0,    y: 0,   width: 420,  depth: 360 },
        { room: "dining",   x: 420,  y: 0,   width: 360,  depth: 360 },
        { room: "study",    x: 780,  y: 0,   width: 320,  depth: 360 },
        { room: "bathroom", x: 760,  y: 360, width: 340,  depth: 280 },
        // 东翼 + 楼梯间
        { room: "garage",   x: 1100, y: 0,   width: 300,  depth: 540 },
        { room: "stair",    x: 1100, y: 540, width: 200,  depth: 360 },
        // 南向露台（室外，不计入面宽包围盒）
        { room: "balcony",  x: 0,    y: 900, width: 1400, depth: 180 },
      ],
    },
    // ── 二层：私密休憩层 ──────────────────────────────────────────────────────
    {
      id: "mcgv-f2",
      name: "二层",
      area: 132,
      rooms: [
        { room: "master",    x: 0,    y: 0,   width: 640, depth: 480 },
        { room: "closet",    x: 640,  y: 0,   width: 240, depth: 300 },
        { room: "bathroom",  x: 640,  y: 300, width: 360, depth: 300 },
        { room: "bedroom",   x: 0,    y: 480, width: 480, depth: 420 },
        { room: "bedroom2",  x: 480,  y: 480, width: 480, depth: 420 },
        { room: "bathroom2", x: 960,  y: 480, width: 280, depth: 280 },
        { room: "stair",     x: 1100, y: 540, width: 200, depth: 360 },
        // 上层悬挑玻璃栏杆露台（全宽，面向泳池）
        { room: "balcony2",  x: 0,    y: 900, width: 1400, depth: 200 },
      ],
    },
  ],

  // ── 庭院 ────────────────────────────────────────────────────────────────────
  // rich-glass-villa 玻璃正立面朝 −Z（相机侧），前院在 −Z 方向。
  // 室内包围盒约 14m × 9m → 南立面（正面）≈ z = -450cm。
  // 泳池/躺椅/松柏全部布置在 −Z 前院，正对落地玻璃。
  yardPlan: {
    items: [
      // ── 泳池（前院中央偏左，长轴平行立面，参考图主角）─────────────────
      { id: "mcgv-pool",    type: "prefab", prefabKind: "pool",
        x: -120, z: -1060, rot: 0, scale: 1.3 },

      // ── 凉棚（泳池远端遮荫）──────────────────────────────────────────────
      { id: "mcgv-pergola", type: "prefab", prefabKind: "pergola_classic",
        x: -880, z: -1180, rot: 0, scale: 0.95 },

      // ── 木格栅隐私墙（西侧 + 临街，呼应照片左侧横向木围墙）──────────────
      { id: "mcgv-slat-w",  type: "prefab", prefabKind: "slat_wall",
        x: -1320, z: -300, rot: 0, scale: 1.0,
        params: { lengthM: 14, heightM: 2.2 } },
      // 右侧隐私格栅墙（沿 Z 走向，不挡正面视线）
      { id: "mcgv-slat-e",  type: "prefab", prefabKind: "slat_wall",
        x: 1320, z: -300, rot: 0, scale: 1.0,
        params: { lengthM: 14, heightM: 2.2 } },

      // ── 成排躺椅（泳池近房一侧，面向泳池/阳光）─────────────────────────
      { id: "mcgv-lngr1",   kind: "furniture.swimmingLounger", x: -560, z: -800, rot: 0, scale: 1.0 },
      { id: "mcgv-lngr2",   kind: "furniture.swimmingLounger", x: -340, z: -800, rot: 0, scale: 1.0 },
      { id: "mcgv-lngr3",   kind: "furniture.swimmingLounger", x: -120, z: -800, rot: 0, scale: 1.0 },
      { id: "mcgv-lngr4",   kind: "furniture.swimmingLounger", x:  100, z: -800, rot: 0, scale: 1.0 },
      { id: "mcgv-lngr5",   kind: "furniture.swimmingLounger", x:  320, z: -800, rot: 0, scale: 1.0 },
      // 远端一对躺椅
      { id: "mcgv-lngr6",   kind: "furniture.swimmingLounger", x:  680, z: -1100, rot: -Math.PI / 2, scale: 1.0 },
      { id: "mcgv-lngr7",   kind: "furniture.swimmingLounger", x:  680, z: -1280, rot: -Math.PI / 2, scale: 1.0 },

      // ── 松柏背景（参考图：密植常绿，沿前院两侧 + 背面围合）──────────────
      { id: "mcgv-pine1",   kind: "tree.olive", x: -1300, z: -1100, rot: 0.2,  scale: 1.3 },
      { id: "mcgv-pine2",   kind: "tree.olive", x: -1450, z: -600,  rot: 0,    scale: 1.1 },
      { id: "mcgv-pine3",   kind: "tree.olive", x:  1300, z: -1000, rot: -0.2, scale: 1.3 },
      { id: "mcgv-pine4",   kind: "tree.olive", x:  1480, z: -500,  rot: 0.3,  scale: 1.1 },
      // 背面（+Z）私密围合
      { id: "mcgv-pine5",   kind: "tree.olive", x: -800, z:  900,  rot: 0.1,  scale: 1.2 },
      { id: "mcgv-pine6",   kind: "tree.olive", x:    0, z: 1000,  rot: 0,    scale: 1.3 },
      { id: "mcgv-pine7",   kind: "tree.olive", x:  800, z:  900,  rot: -0.1, scale: 1.2 },

      // ── 橄榄树（建筑两侧近景，柔化立面边缘）──────────────────────────────
      { id: "mcgv-olv1",    kind: "tree.olive", x: -880, z: -480, rot: 0,   scale: 0.95 },
      { id: "mcgv-olv2",    kind: "tree.olive", x:  880, z: -440, rot: 0.2, scale: 0.9 },

      // ── 观赏草 + 灌木（泳池/甲板边缘点缀）────────────────────────────────
      { id: "mcgv-gr1",     kind: "plant.grass",     x: -640, z: -1300, rot: 0,   scale: 1.0 },
      { id: "mcgv-gr2",     kind: "plant.grass",     x:  560, z: -1320, rot: 0.3, scale: 0.9 },
      { id: "mcgv-gr3",     kind: "plant.grass",     x: -700, z: -900,  rot: 0.5, scale: 0.85 },
      { id: "mcgv-bush1",   kind: "plant.bushLarge", x:  640, z: -700,  rot: 0,   scale: 0.8 },
      { id: "mcgv-bush2",   kind: "plant.bushSmall", x: -560, z: -1400, rot: 0,   scale: 0.75 },

      // ── 区域 ──────────────────────────────────────────────────────────────
      // 大面积石板甲板（前院 + 泳池四周，参考图整片浅色石材铺装）
      {
        id: "mcgv-z-deck",  type: "zone" as const, zoneKind: "social" as const,
        x: -60, z: -980,
        polygon: [[-820, -620], [800, -620], [800, 620], [-820, 620]] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
      // 东侧草坪
      {
        id: "mcgv-z-lawn1", type: "zone" as const, zoneKind: "lawn" as const,
        x: 1080, z: -300,
        polygon: [[-300, -700], [300, -700], [300, 700], [-300, 700]] as Array<[number, number]>,
      },
      // 后院草坪
      {
        id: "mcgv-z-lawn2", type: "zone" as const, zoneKind: "lawn" as const,
        x: 0, z: 760,
        polygon: [[-900, -300], [900, -300], [900, 300], [-900, 300]] as Array<[number, number]>,
      },
    ],

    paths: [
      // 侧向步道：前院甲板 → 东侧入户
      {
        id: "mcgv-p-side",
        points: [[820, -600], [1080, -600], [1080, -200]] as Array<[number, number]>,
        widthCm: 120,
        material: "stone",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 8 — 玻璃幕墙泳池别墅 (源自用户方案) · 2F · 250㎡
//
// 基于用户导出的「装修方案_2026-6-17.json」首/二层房间布局重建，并贴合参考照片：
//   • 四向落地玻璃幕墙（glassFloors：首层 柱/门/玻璃/柱，二层 柱/玻璃/柱）
//   • 砖基 + 胡桃木上段墙裙（wallZones，呼应照片暖木调）
//   • 平屋顶 + 1m 深挑檐（南向额外 0.6m）→ 覆盖式前廊观感
//   • 前院石板甲板 + 矩形泳池 + 成排躺椅 + 松柏背景 + 木格栅围墙
//
// 用户原方案为 3 层（含屋顶层），此处取首/二层两层以贴合照片的两层体量。
// buildingType = floor-plan-driven：外立面直接由房间平面生成，正面（玻璃面）朝 −Z。
// ─────────────────────────────────────────────────────────────────────────────
const GLASS_POOL_VILLA_FROM_PLAN: ProjectTemplate = {
  id: "glass-pool-villa-from-plan",
  name: "玻璃幕墙泳池别墅",
  nameEn: "Glass-Curtain Pool Villa",
  emoji: "🪟",
  description: "双层 · 四向玻璃幕墙 · 砖木墙裙 · 深挑檐 · 前院泳池（源自你的方案）",
  descriptionEn: "2 Floors · Glass Curtain · Brick+Wood Base · Deep Eaves · Pool (From Your Plan)",
  areaSqm: 250,
  palette: ["#F4F0E4", "#2A2A2A", "#A06030"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset:       "custom",
    roofStyle:    "flat",
    roofColor:    "#2A2A2A",
    wallMaterial: "render",
    wallColor:    "#F4F0E4",
    accentColor:  "#1A1A1A",
    floors: 2,
    showPerimeterFence: false,
    fenceInsetMultiplier: 1.65,
    pilotisHeightM: 0,
    buildingType: "floor-plan-driven",
    roofOverhang: 1.0,
    roofOverhangSouthExtra: 0.6,
    parapetHeight: 0,
    parapetGlassEnabled: false,
    // 砖基 + 木上段（呼应照片暖木调；玻璃幕墙以外的实墙段显示）
    wallZones: [
      { material: "brick", color: "#B05030", heightFraction: 0.35 },
      { material: "wood",  color: "#A06030", heightFraction: 0.65 },
    ],
    // 四向落地玻璃幕墙 —— 复用 glassFloors（首层带门）
    facades: {
      S: glassFloors(2, [true, false]),
      N: glassFloors(2, [true, false]),
      W: glassFloors(2, [true, false]),
      E: glassFloors(2, [true, false]),
    },
  },

  // ── 首/二层：直接采用用户方案的房间布局 ──────────────────────────────────
  floorLayouts: [
    {
      id: "gpvp-f1",
      name: "首层 (源自方案)",
      area: 140,
      rooms: [
        { room: "kitchen",  x: 0,    y: 0,   width: 400,  depth: 320 },
        { room: "bathroom", x: 400,  y: 0,   width: 240,  depth: 320 },
        { room: "dining",   x: 640,  y: 0,   width: 360,  depth: 340 },
        { room: "stair",    x: 1000, y: 0,   width: 240,  depth: 340 },
        { room: "hallway",  x: 0,    y: 320, width: 1240, depth: 240 },
        { room: "living",   x: 0,    y: 520, width: 680,  depth: 500 },
        { room: "study",    x: 680,  y: 560, width: 340,  depth: 460 },
        { room: "closet",   x: 1020, y: 560, width: 220,  depth: 460 },
      ],
    },
    {
      id: "gpvp-f2",
      name: "二层 (源自方案)",
      area: 110,
      rooms: [
        { room: "master",   x: 0,    y: 0,   width: 520,  depth: 420 },
        { room: "closet",   x: 520,  y: 0,   width: 200,  depth: 420 },
        { room: "bathroom", x: 720,  y: 0,   width: 280,  depth: 420 },
        { room: "stair",    x: 1000, y: 0,   width: 240,  depth: 420 },
        { room: "hallway",  x: 0,    y: 420, width: 1240, depth: 180 },
        { room: "bedroom",  x: 0,    y: 600, width: 380,  depth: 420 },
        { room: "bedroom2", x: 380,  y: 600, width: 340,  depth: 420 },
        { room: "bedroom3", x: 720,  y: 600, width: 280,  depth: 420 },
        { room: "study",    x: 1000, y: 600, width: 240,  depth: 420 },
      ],
    },
  ],

  // ── 庭院 ────────────────────────────────────────────────────────────────────
  // floor-plan-driven 玻璃正立面朝 −Z。室内包围盒 ≈ 12.4m × 10.2m → 南立面 ≈ z = -510cm。
  yardPlan: {
    items: [
      { id: "gpvp-pool",    type: "prefab", prefabKind: "pool",
        x: -120, z: -1080, rot: 0, scale: 1.3 },
      { id: "gpvp-pergola", type: "prefab", prefabKind: "pergola_classic",
        x: -880, z: -1200, rot: 0, scale: 0.95 },
      { id: "gpvp-slat-w",  type: "prefab", prefabKind: "slat_wall",
        x: -1320, z: -300, rot: 0, scale: 1.0, params: { lengthM: 14, heightM: 2.2 } },
      { id: "gpvp-slat-e",  type: "prefab", prefabKind: "slat_wall",
        x: 1320, z: -300, rot: 0, scale: 1.0, params: { lengthM: 14, heightM: 2.2 } },

      // 成排躺椅（泳池近房一侧）
      { id: "gpvp-lngr1",   kind: "furniture.swimmingLounger", x: -560, z: -820, rot: 0, scale: 1.0 },
      { id: "gpvp-lngr2",   kind: "furniture.swimmingLounger", x: -340, z: -820, rot: 0, scale: 1.0 },
      { id: "gpvp-lngr3",   kind: "furniture.swimmingLounger", x: -120, z: -820, rot: 0, scale: 1.0 },
      { id: "gpvp-lngr4",   kind: "furniture.swimmingLounger", x:  100, z: -820, rot: 0, scale: 1.0 },
      { id: "gpvp-lngr5",   kind: "furniture.swimmingLounger", x:  320, z: -820, rot: 0, scale: 1.0 },

      // 松柏背景
      { id: "gpvp-pine1",   kind: "tree.olive", x: -1300, z: -1120, rot: 0.2,  scale: 1.3 },
      { id: "gpvp-pine2",   kind: "tree.olive", x: -1460, z: -640,  rot: 0,    scale: 1.1 },
      { id: "gpvp-pine3",   kind: "tree.olive", x:  1300, z: -1020, rot: -0.2, scale: 1.3 },
      { id: "gpvp-pine4",   kind: "tree.olive", x:  1480, z: -540,  rot: 0.3,  scale: 1.1 },
      { id: "gpvp-pine5",   kind: "tree.olive", x: -800,  z:  960,  rot: 0.1,  scale: 1.2 },
      { id: "gpvp-pine6",   kind: "tree.olive", x:    0,  z: 1040,  rot: 0,    scale: 1.3 },
      { id: "gpvp-pine7",   kind: "tree.olive", x:  800,  z:  960,  rot: -0.1, scale: 1.2 },

      // 橄榄树 + 枫树（用户原方案树种）侧向点缀
      { id: "gpvp-olv1",    kind: "tree.olive", x: -900, z: -520, rot: 0,   scale: 0.95 },
      { id: "gpvp-mpl1",    kind: "tree.olive", x:  900, z: -480, rot: 0.2, scale: 0.95 },

      // 观赏草 + 灌木
      { id: "gpvp-gr1",     kind: "plant.grass",     x: -640, z: -1320, rot: 0,   scale: 1.0 },
      { id: "gpvp-gr2",     kind: "plant.grass",     x:  560, z: -1340, rot: 0.3, scale: 0.9 },
      { id: "gpvp-bush1",   kind: "plant.bushLarge", x:  640, z: -720,  rot: 0,   scale: 0.8 },

      // 区域
      {
        id: "gpvp-z-deck",  type: "zone" as const, zoneKind: "social" as const,
        x: -60, z: -1000,
        polygon: [[-820, -640], [800, -640], [800, 640], [-820, 640]] as Array<[number, number]>,
        pavingMaterialId: "stone_grey",
      },
      {
        id: "gpvp-z-lawn1", type: "zone" as const, zoneKind: "lawn" as const,
        x: 1080, z: -300,
        polygon: [[-300, -700], [300, -700], [300, 700], [-300, 700]] as Array<[number, number]>,
      },
      {
        id: "gpvp-z-lawn2", type: "zone" as const, zoneKind: "lawn" as const,
        x: 0, z: 800,
        polygon: [[-900, -300], [900, -300], [900, 300], [-900, 300]] as Array<[number, number]>,
      },
    ],

    paths: [
      {
        id: "gpvp-p-side",
        points: [[820, -620], [1080, -620], [1080, -200]] as Array<[number, number]>,
        widthCm: 120,
        material: "stone",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 用户当前设计（实时捕获）— 通透玻璃幕墙 · 平面图驱动 · 逐面三层立面 · 泳池庭院。
// 区别于其它玻璃模板：buildingType="floor-plan-driven" 走真实户型 + 通透幕墙引擎
// （非 GLB 别墅），房间布局即用户手工搭的两层方案。
const CLEAR_GLASS_CURTAIN_HOME: ProjectTemplate = {
  id: "clear-glass-curtain-home",
  name: "通透玻璃幕墙别墅",
  nameEn: "Clear Glass-Curtain Villa",
  emoji: "✨",
  description: "双层 · 平屋顶 · 通透玻璃幕墙（逐面可调）· 胡桃木挑檐 · 泳池庭院",
  descriptionEn: "2F · Flat Roof · See-through Glass Curtain (per-face) · Walnut Soffit · Pool Yard",
  areaSqm: 257,
  palette: ["#F2EFE8", "#EAE7E0", "#AEC4D2"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset: "glass-curtain",
    facadeSystem: "curtain-wall",
    roofStyle: "flat",
    floors: 2,
    hasRooftop: true,
    buildingType: "floor-plan-driven",
    wallColor: "#F4F3EE",
    wallBaseColor: "#F2EFE8",
    glassColor: "#AEC4D2",
    glassSpandrelColor: "#EDEAE3",
    glassOpacity: 1,
    windowFrameColor: "#15171B",
    entranceFrameColor: "#15171B",
    woodSoffit: true,
    roofOverhang: 1.2,
    roofOverhangSouthExtra: 0.9,
    parapetHeight: 0,
    roofSlabColor: "#EAE7E0",
    roofColor: "#EFEEE9",
    stoneBaseEnabled: false,
    yardPreset: "pool",
  },

  // 户型即用户实时方案（floors 0 / 1，cm）。
  floorLayouts: [
    {
      id: "cgc-f1",
      name: "首层",
      area: 130,
      rooms: [
        { room: "kitchen",  x: 0,    y: 0,   width: 400,  depth: 320 },
        { room: "bathroom", x: 400,  y: 0,   width: 240,  depth: 320 },
        { room: "dining",   x: 640,  y: 0,   width: 360,  depth: 340 },
        { room: "stair",    x: 1000, y: 0,   width: 240,  depth: 340 },
        { room: "hallway",  x: 0,    y: 320, width: 1240, depth: 240 },
        { room: "living",   x: 0,    y: 520, width: 680,  depth: 500 },
        { room: "study",    x: 680,  y: 560, width: 340,  depth: 460 },
        { room: "closet",   x: 1020, y: 560, width: 220,  depth: 460 },
      ],
    },
    {
      id: "cgc-f2",
      name: "二层",
      area: 127,
      rooms: [
        { room: "master",   x: 0,    y: 0,   width: 520,  depth: 420 },
        { room: "closet",   x: 520,  y: 0,   width: 200,  depth: 420 },
        { room: "bathroom", x: 720,  y: 0,   width: 280,  depth: 420 },
        { room: "stair",    x: 1000, y: 0,   width: 240,  depth: 420 },
        { room: "hallway",  x: 0,    y: 420, width: 1240, depth: 180 },
        { room: "bedroom",  x: 0,    y: 600, width: 380,  depth: 420 },
        { room: "bedroom2", x: 380,  y: 600, width: 340,  depth: 420 },
        { room: "bedroom3", x: 720,  y: 600, width: 280,  depth: 420 },
        { room: "study",    x: 1000, y: 600, width: 240,  depth: 420 },
      ],
    },
  ],

  // 庭院即用户实时方案：D 端泳池 + 餐区 + 躺椅 + 柏树/松树/草丛。
  yardPlan: {
    items: [
      { id: "gc-pool",    type: "prefab", prefabKind: "pool", x: 0, z: 1120, rot: 0 },
      { id: "gc-zone-dine", type: "zone", zoneKind: "social", subtype: "outdoor-room", x: 820, z: 730,
        polygon: [[-180, -160], [180, -160], [180, 160], [-180, 160]] },
      { id: "gc-dineset",  type: "singleton", kind: "furniture.diningSet",      x: 820,  z: 700, rot: 0 },
      { id: "gc-parasol",  type: "singleton", kind: "furniture.parasol",        x: 820,  z: 700 },
      { id: "gc-lounge-1", type: "singleton", kind: "furniture.chaiseLounger",  x: -360, z: 610, rot: 0 },
      { id: "gc-lounge-2", type: "singleton", kind: "furniture.chaiseLounger",  x: -240, z: 610, rot: 0 },
      { id: "gc-tree-1",   type: "singleton", kind: "tree.olive", x: -980, z: 980,  scale: 1.2 },
      { id: "gc-tree-2",   type: "singleton", kind: "tree.olive", x: 980,  z: 980,  scale: 1.2 },
      { id: "gc-tree-3",   type: "singleton", kind: "tree.olive",    x: -600, z: 1040, scale: 1.3 },
      { id: "gc-tree-4",   type: "singleton", kind: "tree.olive",    x: 600,  z: 1040, scale: 1.3 },
      { id: "gc-grass-1",  type: "singleton", kind: "plant.grass",  x: -520, z: 610,  scale: 1.2 },
      { id: "gc-grass-2",  type: "singleton", kind: "plant.grass",  x: 520,  z: 610,  scale: 1.2 },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 片场系列（云横店 studio-mvp）——非住宅拍摄场景。单层小体量、玻璃门面、
// furnitureOverrides 显式摆放（住宅风格模板推不出咖啡馆/办公室的家具）。
// 坐标：room-local 中心 cm，(0,0)=房间西北角，z 向南增。
// ─────────────────────────────────────────────────────────────────────────────

const CAFE_SET: ProjectTemplate = {
  id: "set-cafe",
  name: "咖啡馆片场",
  nameEn: "Café Set",
  emoji: "☕",
  description: "片场 · 单层 · 玻璃门面 · 吧台+四组卡座 · 拍对话/日常戏",
  descriptionEn: "Film set · 1F · Glass storefront · Bar + 4 tables · Dialogue scenes",
  areaSqm: 78,
  palette: ["#F2EFE8", "#3A3A3A", "#8A6040"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset: "glass-curtain",
    facadeSystem: "curtain-wall",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    wallColor: "#F4F3EE",
    wallBaseColor: "#F2EFE8",
    glassColor: "#AEC4D2",
    glassOpacity: 1,
    windowFrameColor: "#15171B",
    entranceFrameColor: "#15171B",
    woodSoffit: true,
    roofOverhang: 0.8,
    parapetHeight: 0,
    roofSlabColor: "#3A3A3A",
    roofColor: "#3A3A3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "cafe-f1",
      name: "咖啡馆",
      area: 78,
      rooms: [
        // 西侧吧台区（kitchen 语义=有操作台/设备的区域）
        { room: "kitchen",  x: 0,   y: 0, width: 300, depth: 600 },
        // 大堂（东侧主空间）
        { room: "living",   x: 300, y: 0, width: 660, depth: 600 },
        // 洗手间（东北角外挂）
        { room: "bathroom", x: 960, y: 0, width: 240, depth: 220 },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    // 参考真实咖啡馆动线（吧台靠墙+机器在台面+背后置物架 back bar；
    // 窗边高脚位；桌位密度高；每桌上方低垂吊灯；软座角落）。
    // 拍摄都发生在 living（大堂含吧台）；kitchen 是后场（备货，不入镜）。
    {
      living: [
        // ── 点单服务区（西墙）：专用点单柜台，台面上台面件靠吸附落台 ──
        { furnitureId: "counter-cafe",             x: 70,  z: 270, rotation: 90 }, // 柜台，长边沿 z
        { furnitureId: "appliance-coffee-machine", x: 70,  z: 210 },              // 咖啡机（台面）
        { furnitureId: "appliance-coffee-grinder", x: 70,  z: 260 },              // 磨豆机（台面）
        { furnitureId: "electronics-pos",          x: 70,  z: 320 },              // 收银机（台面）
        { furnitureId: "decor-coffee-mug",         x: 70,  z: 350 },              // 马克杯
        // back bar：柜台身后（西墙）置物架
        { furnitureId: "storage-shelving-2",       x: 25,  z: 150, rotation: 90 },
        { furnitureId: "storage-shelving",         x: 25,  z: 420, rotation: 90 },
        // 立式菜单黑板（点单区旁，朝向大堂）
        { furnitureId: "decor-menu-chalkboard",    x: 130, z: 90,  rotation: 90 },
        // ── 窗边高脚位（南侧玻璃门面）：直线吧台 + 单体吧凳 ──
        { furnitureId: "counter-bar-straight",     x: 360, z: 560, rotation: 0 },
        { furnitureId: "seat-bar-stool",           x: 280, z: 500 },
        { furnitureId: "seat-bar-stool",           x: 360, z: 500 },
        { furnitureId: "seat-bar-stool",           x: 440, z: 500 },
        // ── 中部两组 2 人桌（密度贴近真实咖啡馆）──
        { furnitureId: "dining-black-metal",       x: 300, z: 170, rotation: 0 },
        { furnitureId: "chair-industrial-black",   x: 225, z: 170, rotation: 90 },
        { furnitureId: "chair-industrial-black",   x: 375, z: 170, rotation: 270 },
        { furnitureId: "dining-black-metal",       x: 300, z: 340, rotation: 0 },
        { furnitureId: "chair-industrial-black",   x: 225, z: 340, rotation: 90 },
        { furnitureId: "chair-industrial-black",   x: 375, z: 340, rotation: 270 },
        // ── 东墙卡座（自带餐桌的软座）+ 软座角落 ──
        { furnitureId: "seat-diner-booth",         x: 560, z: 180, rotation: 270 },
        { furnitureId: "rug-persian",              x: 545, z: 400 },
        { furnitureId: "sofa-nordic-blue",         x: 605, z: 400, rotation: 270 },
        { furnitureId: "coffee-oak-round",         x: 500, z: 400 },
        // ── 氛围（挂画/绿植/低垂吊灯）──
        { furnitureId: "artwork-impression",       x: 300, z: 18 },
        { furnitureId: "plant-rubber-tree",        x: 40,  z: 555 },
        { furnitureId: "plant-rubber-tree",        x: 640, z: 60 },
        { furnitureId: "lamp-pendant-saturno",     x: 300, z: 255 },
        { furnitureId: "lamp-pendant-ikea4",       x: 360, z: 545 },
      ],
      kitchen: [
        // 后场（不入镜）：冰箱/备货架/备用咖啡机
        { furnitureId: "fridge-single-white",  x: 70,  z: 70 },
        { furnitureId: "storage-shelving-2",   x: 200, z: 60 },
        { furnitureId: "appliance-coffee",     x: 70,  z: 180 },
      ],
      // bathroom 留给风格模板默认卫浴
    },
  ],
};

const OFFICE_SET: ProjectTemplate = {
  id: "set-office",
  name: "办公室片场",
  nameEn: "Office Set",
  emoji: "💼",
  description: "片场 · 单层 · 开放工位+会议室+茶水间 · 拍职场戏",
  descriptionEn: "Film set · 1F · Open desks + meeting room + pantry · Workplace scenes",
  areaSqm: 92,
  palette: ["#F0F0EE", "#2A2A2A", "#3A5A8A"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset: "glass-curtain",
    facadeSystem: "curtain-wall",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    wallColor: "#F0F0EE",
    glassColor: "#9FB6C8",
    glassOpacity: 1,
    windowFrameColor: "#15171B",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.6,
    parapetHeight: 0.4,
    roofColor: "#2A2A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "office-f1",
      name: "办公室",
      area: 92,
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 700, depth: 600 }, // 开放办公区
        { room: "dining",   x: 700, y: 0,   width: 400, depth: 380 }, // 会议室
        { room: "kitchen",  x: 700, y: 380, width: 400, depth: 220 }, // 茶水间
        { room: "bathroom", x: 0,   y: 600, width: 240, depth: 200 },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      living: [
        // 2×2 工位阵（升降桌+办公椅+显示器，显示器靠台面吸附落桌面）
        { furnitureId: "desk-standing",       x: 200, z: 150, rotation: 0 },
        { furnitureId: "chair-simple-fabric", x: 200, z: 240, rotation: 0 },
        { furnitureId: "elec-monitor",        x: 200, z: 140 },
        { furnitureId: "desk-standing",       x: 500, z: 150, rotation: 0 },
        { furnitureId: "chair-simple-fabric", x: 500, z: 240, rotation: 0 },
        { furnitureId: "elec-monitor",        x: 500, z: 140 },
        { furnitureId: "desk-standing",       x: 200, z: 420, rotation: 180 },
        { furnitureId: "chair-simple-fabric", x: 200, z: 330, rotation: 180 },
        { furnitureId: "elec-laptop",         x: 200, z: 430 },
        { furnitureId: "desk-standing",       x: 500, z: 420, rotation: 180 },
        { furnitureId: "chair-simple-fabric", x: 500, z: 330, rotation: 180 },
        { furnitureId: "elec-monitor",        x: 500, z: 430 },
        // 周边
        { furnitureId: "bookshelf-wood-lp",   x: 60,  z: 60,  rotation: 90 },
        { furnitureId: "storage-shelving",    x: 650, z: 60 },
        { furnitureId: "elec-printer",        x: 650, z: 140 },
        { furnitureId: "decor-whiteboard",    x: 350, z: 25 },  // 立式白板
        { furnitureId: "plant-rubber-tree",   x: 60,  z: 540 },
        { furnitureId: "lamp-pendant-modern", x: 350, z: 290 },
      ],
      dining: [
        // 会议室：长会议桌 + 六椅 + 白板
        { furnitureId: "table-conference",  x: 200, z: 190, rotation: 0 },
        { furnitureId: "chair-modern-gray", x: 90,  z: 110, rotation: 135 },
        { furnitureId: "chair-modern-gray", x: 200, z: 90,  rotation: 180 },
        { furnitureId: "chair-modern-gray", x: 310, z: 110, rotation: 225 },
        { furnitureId: "chair-modern-gray", x: 90,  z: 270, rotation: 45 },
        { furnitureId: "chair-modern-gray", x: 200, z: 290, rotation: 0 },
        { furnitureId: "chair-modern-gray", x: 310, z: 270, rotation: 315 },
        { furnitureId: "decor-whiteboard",  x: 200, z: 20 },
        { furnitureId: "lamp-pendant-saturno", x: 200, z: 190 },
      ],
      kitchen: [
        // 茶水间：饮水机 + 冰箱 + 咖啡机 + 备货架
        { furnitureId: "appliance-water-dispenser", x: 60,  z: 60 },
        { furnitureId: "fridge-single-white",       x: 150, z: 70 },
        { furnitureId: "appliance-coffee",          x: 250, z: 55 },
        { furnitureId: "storage-shelving-2",        x: 340, z: 60 },
        { furnitureId: "dining_table-bar",          x: 200, z: 160 },
      ],
    },
  ],
};

const RESTAURANT_SET: ProjectTemplate = {
  id: "set-restaurant",
  name: "小餐馆片场",
  nameEn: "Bistro Set",
  emoji: "🍜",
  description: "片场 · 单层 · 四桌堂食+后厨 · 拍聚餐/市井戏",
  descriptionEn: "Film set · 1F · 4-table dining + kitchen · Dinner scenes",
  areaSqm: 86,
  palette: ["#EFE8DC", "#4A3A2A", "#B0503A"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset: "modern-minimal",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    wallMaterial: "render",
    wallColor: "#EFE8DC",
    roofColor: "#4A3A2A",
    accentColor: "#B0503A",
    windowFrameColor: "#3A2A1A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "resto-f1",
      name: "小餐馆",
      area: 86,
      rooms: [
        { room: "living",   x: 0,   y: 0, width: 700, depth: 600 }, // 堂食区
        { room: "kitchen",  x: 700, y: 0, width: 380, depth: 600 }, // 后厨
        { room: "bathroom", x: 0,   y: 600, width: 220, depth: 200 },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      living: [
        // 四桌堂食
        { furnitureId: "dining-oak-rect",      x: 190, z: 170 },
        { furnitureId: "chair-nordic-oak",     x: 190, z: 65,  rotation: 180 },
        { furnitureId: "chair-nordic-oak",     x: 190, z: 275, rotation: 0 },
        { furnitureId: "chair-nordic-oak",     x: 85,  z: 170, rotation: 90 },
        { furnitureId: "chair-nordic-oak",     x: 295, z: 170, rotation: 270 },
        { furnitureId: "dining-oak-rect",      x: 520, z: 170 },
        { furnitureId: "chair-modern-gray",    x: 520, z: 65,  rotation: 180 },
        { furnitureId: "chair-modern-gray",    x: 520, z: 275, rotation: 0 },
        { furnitureId: "chair-modern-gray",    x: 415, z: 170, rotation: 90 },
        { furnitureId: "chair-modern-gray",    x: 625, z: 170, rotation: 270 },
        { furnitureId: "dining-black-metal",   x: 190, z: 470 },
        { furnitureId: "chair-industrial-black", x: 115, z: 470, rotation: 90 },
        { furnitureId: "chair-industrial-black", x: 265, z: 470, rotation: 270 },
        { furnitureId: "dining-black-metal",   x: 520, z: 470 },
        { furnitureId: "chair-industrial-black", x: 445, z: 470, rotation: 90 },
        { furnitureId: "chair-industrial-black", x: 595, z: 470, rotation: 270 },
        // 东墙卡座（自带餐桌的软座）
        { furnitureId: "seat-diner-booth",     x: 620, z: 250, rotation: 270 },
        // 氛围
        { furnitureId: "mural-great-wave",     x: 350, z: 20 },
        { furnitureId: "decor-menu-chalkboard",x: 60,  z: 300, rotation: 90 },
        { furnitureId: "plant-rubber-tree",    x: 55,  z: 545 },
        { furnitureId: "lamp-pendant-ikea4",   x: 190, z: 300 },
        { furnitureId: "lamp-pendant-ikea4",   x: 520, z: 300 },
      ],
      kitchen: [
        // 后厨：中岛+设备（橱柜由风格模板铺）
        { furnitureId: "kitchen_cabinet-island-pan", x: 190, z: 300, rotation: 90 },
        { furnitureId: "fridge-french-door",         x: 80,  z: 80 },
        { furnitureId: "kitchen_cabinet-island-sink",x: 320, z: 100, rotation: 270 },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  MODERN_CANTILEVER_GLASS_VILLA,  // ← 参考照片专属：宽体玻璃幕墙 + 胡桃木挑檐 + 前院泳池
  CLEAR_GLASS_CURTAIN_HOME,       // ← 第二个：用户当前设计（通透玻璃幕墙 + 真实户型）
  GLASS_POOL_VILLA_FROM_PLAN,     // ← 源自用户方案的房间布局 + 四向玻璃幕墙 + 照片庭院
  LUXURY_3F_GLASS_VILLA,    // ← 三层豪宅，排第一（用户当前设计的合理化版）
  WOOD_ACCENT_POOL_VILLA,   // ← 参考图：白墙核桃木顶，前院泳池
  GLASS_CURTAIN_VILLA,      // ← 参考图风格，双层
  MODERN_POOL_VILLA,
  JAPANESE_ZEN_VILLA,
  MEDITERRANEAN_VILLA,
  // ── 片场系列（云横店）──
  CAFE_SET,
  OFFICE_SET,
  RESTAURANT_SET,
];
