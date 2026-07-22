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
  scaleH?: number;
  /** 架高 cm：小件（杯/花/道具）离地高度。正下方有承托面（桌/柜/书架等
   *  FLAT_TOP_CARRIERS 类别）时自动吸附到其顶面；无承托面则直接按此高度悬置
   *  （柜台面件用，counter 类别不是承托面，需显式给柜台高度）。默认 0=落地。 */
  elevationY?: number;
  /** 吸顶：顶面贴天花板（吊灯/吊挂绿萝），忽略 elevationY。 */
  mountCeiling?: boolean;
  /** 店招灯箱等道具的显示文字。 */
  label?: string;
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
      area: 166,
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
      area: 166,
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
        // 2026-07 按用户实景固化：客厅拉成凸字形（兜着厨房/卫生间两缺口），
        // 走廊 = 沿街露天座位区（四面墙隐藏 = 骑楼人行道）。
        // 西北后场（kitchen 语义=厨房+库房；后场隐私 → 实墙）
        { room: "kitchen",  x: 0,   y: 0,   width: 280,  depth: 260, exteriorStyle: "concrete" },
        // 大堂（L 形，多边形 room-local cm；西北缺口被厨房填占；
        // 临街玻璃幕墙 + 南墙 160cm 法式对开大门）
        { room: "living",   x: 9,   y: 13,  width: 1179, depth: 592,
          // 2026-07 东北角原为男女厕+洗手走廊，因厕所直冲用餐区(最近的椅子仅 84cm)
          // 且占掉临街玻璃的采光角，整体移除并填平 → 该角改做窗边吧台座。
          shape: { preset: "custom", points: [[272, 0], [1178, 0], [1178, 592], [276, 591], [0, 592], [3, 256], [268, 254]] },
          exteriorStyle: "glass",
          // glass_swing=两扇各绕外侧边对开；french_double 在本渲染器是整扇单铰(会整体甩到一边)
          doors: [{ wall: "S", pos: 520, len: 160, style: "glass_swing", h: 210 }],
          // 西墙1（幕墙面，多边形 edge 4：室内-local x≈1.5、z 256–592）开一扇上悬窗。
          // edgeIndex=4 直接绑定那条边，避免按外接矩形投影落到凹口（用户实机固化）。
          windows: [{ wall: "W", pos: 88, len: 160, edgeIndex: 4 }],
          // 门楣店招：外墙装饰(RoomState.exteriorDecor)——单一事实来源，
          // 效果图/外观图共用同一渲染器；u/v 使灯箱悬在南门正上方。
          wallDecor: [{ furnitureId: "sign-cafe-wall", wall: "S", u: 0.52, v: 0.92, label: "YUNHENG COFFEE|云横咖啡" }] },
        // 沿街露天座位区（走廊语义；全墙隐藏成骑楼露台）
        { room: "hallway",  x: 0,   y: 600, width: 1200, depth: 180, wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    // 对照真实咖啡馆参考重排（2026-07）：
    //   · 点单柜台沿【北长墙】一字排开（柜台→柜台→甜品柜），back bar 贴北墙；
    //   · 台面件（咖啡机/磨豆机/收银/豆罐）落在柜台上；
    //   · 南玻璃两段【窗边高脚位】，中间留门；
    //   · 中部+东侧【密集桌位】（2 人小圆桌，每桌两椅 + 桌面卡布奇诺/花）；
    //   · 东墙【整面书架墙】；吊灯成排压在柜台/桌上方。
    // living-local：(0,0)=西北角，x→东(0-660)，z→南(0-600)。
    {
      living: [
        // ★2026-07 按用户实景二次固化：凸字形大堂（1179×592，多边形见 floorLayouts）。
        //   主区 5 张四人桌两排 + 西翼/东翼各 1-2 张四人桌 + 墙面挂画 + 吊挂绿萝。
        //   坐标 living-local：(0,0)=多边形包围盒西北角，x→东(0-1179)，z→南(0-592)。
        //   垂直约定：柜台面件 elevationY≈85；桌面件 elevationY:74；挂画 elevationY=中心高；
        //   吊灯/绿萝 mountCeiling:true。

        // ═══ 北墙服务区(2026-07 按参考图三层重构)：后吧展示墙 + 高挂菜单牌 +
        //     后工作台(咖啡设备) + 前岛(木吧台收银 + 甜品柜连成 L 线)，中留吧员通道 ═══
        { furnitureId: "counter-back-bar-bottles", x: 430, z: 25 },
        { furnitureId: "counter-back-bar-bottles", x: 640, z: 25 },
        { furnitureId: "decor-coffee-menu", x: 430, z: 8, elevationY: 200 },
        { furnitureId: "decor-coffee-menu", x: 535, z: 8, elevationY: 200 },
        { furnitureId: "decor-coffee-menu", x: 640, z: 8, elevationY: 200 },
        { furnitureId: "appliance-drink-fridge", x: 800, z: 28 },
        { furnitureId: "counter-bar-straight", x: 535, z: 85 },
        { furnitureId: "appliance-coffee-brewer", x: 475, z: 80, elevationY: 112 },
        { furnitureId: "appliance-coffee-grinder", x: 535, z: 82, elevationY: 112 },
        { furnitureId: "counter-wooden-bar", x: 565, z: 200 },
        { furnitureId: "counter-cake-display", x: 740, z: 200 },
        { furnitureId: "electronics-pos", x: 610, z: 195, rotation: 180, elevationY: 118 },
        { furnitureId: "decor-coffee-cups", x: 525, z: 197, elevationY: 118 },

        // ═══ 南玻璃：两段直线吧台 + 窗边高脚位 ═══
        { furnitureId: "counter-bar-straight", x: 420, z: 562, rotation: 180 },
        { furnitureId: "counter-bar-straight", x: 793, z: 562, rotation: 180 },
        { furnitureId: "seat-bar-stool", x: 341, z: 507 },
        { furnitureId: "seat-bar-stool", x: 421, z: 507 },
        { furnitureId: "seat-bar-stool", x: 501, z: 507 },
        { furnitureId: "seat-bar-stool", x: 721, z: 507 },
        { furnitureId: "seat-bar-stool", x: 801, z: 507 },
        { furnitureId: "seat-bar-stool", x: 881, z: 507 },

        // ═══ 东北隔断带（旧东墙线：边柜 + 留声机 + 绿植）═══
        { furnitureId: "sideboard-euro", x: 906, z: 146, rotation: 270 },
        // 留声机移出餐边柜脚印：sideboard-euro 高 190cm，留声机没有 elevationY 就
        // 落在地面、整个埋进柜体里（原 x910 与柜脚印 x878~934 完全重叠）。
        { furnitureId: "decor-gramophone", x: 840, z: 184, rotation: 90 },
        { furnitureId: "plant-monstera", x: 899, z: 42 },
        { furnitureId: "plant-monstera", x: 309, z: 46 },

        // ═══ 墙面艺术画（北墙 + 西翼西墙 + 东翼东墙）═══
        // 北墙不再挂画：这面墙整条是服务区——后吧酒瓶柜高 180、冷藏饮料柜高 190，
        // 原来 elevationY:175 的两幅画正好嵌进柜体里（画 x521 撞后吧 x330~530／
        // 画 x844 撞饮料柜 x770~830）。该墙的视觉信息由 3 块高挂菜单(elevationY:200,
        // 在柜顶之上)承担，再挂画本来也重复。挂画保留在东/西两面实墙。
        { furnitureId: "artwork-red-fuji", x: 10, z: 330, rotation: 90, elevationY: 155 },
        { furnitureId: "artwork-vangogh", x: 3, z: 502, rotation: 90 },
        { furnitureId: "artwork-degas", x: 1170, z: 300, rotation: 270, elevationY: 155 },
        { furnitureId: "artwork-impression", x: 1174, z: 532, rotation: 270, elevationY: 150 },

        // ═══ 主区四人桌 ×5（rustic 圆桌 + 四面各一椅）═══
        { furnitureId: "dining_table-cafe-rustic", x: 375, z: 300 },
        { furnitureId: "chair-nordic-oak", x: 375, z: 234 },
        { furnitureId: "chair-nordic-oak", x: 375, z: 366, rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 309, z: 300, rotation: 90 },
        { furnitureId: "chair-nordic-oak", x: 441, z: 300, rotation: 270 },
        { furnitureId: "dining_table-cafe-rustic", x: 855, z: 300 },
        { furnitureId: "chair-industrial-black", x: 855, z: 234 },
        { furnitureId: "chair-industrial-black", x: 855, z: 366, rotation: 180 },
        { furnitureId: "chair-industrial-black", x: 789, z: 300, rotation: 90 },
        { furnitureId: "chair-industrial-black", x: 921, z: 300, rotation: 270 },
        { furnitureId: "dining_table-cafe-rustic", x: 616, z: 330 },
        { furnitureId: "chair-modern-gray", x: 616, z: 264 },
        { furnitureId: "chair-modern-gray", x: 616, z: 396, rotation: 180 },
        { furnitureId: "chair-modern-gray", x: 550, z: 330, rotation: 90 },
        { furnitureId: "chair-modern-gray", x: 682, z: 330, rotation: 270 },
        { furnitureId: "dining_table-cafe-rustic", x: 431, z: 402 },
        { furnitureId: "chair-modern-gray", x: 431, z: 336 },
        { furnitureId: "chair-modern-gray", x: 431, z: 468, rotation: 180 },
        { furnitureId: "chair-modern-gray", x: 365, z: 402, rotation: 90 },
        { furnitureId: "chair-modern-gray", x: 497, z: 402, rotation: 270 },
        { furnitureId: "dining_table-cafe-rustic", x: 801, z: 402 },
        { furnitureId: "chair-nordic-oak", x: 801, z: 336 },
        { furnitureId: "chair-nordic-oak", x: 801, z: 468, rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 735, z: 402, rotation: 90 },
        { furnitureId: "chair-nordic-oak", x: 867, z: 402, rotation: 270 },

        // ═══ 主区桌面件（每桌盆花 + 咖啡，elevationY:74 吸附桌顶）═══
        { furnitureId: "decor-tulip", x: 375, z: 300, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 351, z: 290, rotation: 20, elevationY: 74 },
        { furnitureId: "decor-coffee-mug", x: 399, z: 292, rotation: 200, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 377, z: 326, rotation: 90, elevationY: 74 },
        { furnitureId: "decor-tulip", x: 855, z: 300, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 831, z: 290, rotation: 20, elevationY: 74 },
        { furnitureId: "decor-coffee-mug", x: 879, z: 292, rotation: 200, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 857, z: 326, rotation: 90, elevationY: 74 },
        { furnitureId: "decor-tulip", x: 616, z: 330, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 592, z: 320, rotation: 20, elevationY: 74 },
        { furnitureId: "decor-coffee-mug", x: 640, z: 322, rotation: 200, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 618, z: 356, rotation: 90, elevationY: 74 },
        { furnitureId: "decor-tulip", x: 431, z: 402, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 407, z: 392, rotation: 20, elevationY: 74 },
        { furnitureId: "decor-coffee-mug", x: 455, z: 394, rotation: 200, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 433, z: 428, rotation: 90, elevationY: 74 },
        { furnitureId: "decor-tulip", x: 801, z: 402, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 777, z: 392, rotation: 20, elevationY: 74 },
        { furnitureId: "decor-coffee-mug", x: 825, z: 394, rotation: 200, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 803, z: 428, rotation: 90, elevationY: 74 },

        // ═══ 西翼（厨房下方 2.7×3.4m）：四人桌 + 书架角 + 复古小件 ═══
        { furnitureId: "dining_table-cafe-rustic", x: 140, z: 450 },
        { furnitureId: "chair-nordic-oak", x: 140, z: 384 },
        { furnitureId: "chair-nordic-oak", x: 140, z: 516, rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 74, z: 450, rotation: 90 },
        { furnitureId: "chair-nordic-oak", x: 206, z: 450, rotation: 270 },
        { furnitureId: "decor-tulip", x: 140, z: 450, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 116, z: 440, rotation: 20, elevationY: 74 },
        { furnitureId: "decor-coffee-mug", x: 164, z: 442, rotation: 200, elevationY: 74 },
        { furnitureId: "lamp-pendant-ikea4", x: 140, z: 450, mountCeiling: true },
        { furnitureId: "bookshelf-with-books", x: 202, z: 282 },
        // bookshelf-wood-lp (x82,z269) 已移除——它正对厨房 S 门(世界 x≈36-116)，挡住门口通行（用户去掉）。
        // decor-victorian-clock 原摆在 wood-lp 上(x48,z273,elevationY75)，书架没了会悬空，一并移除。
        { furnitureId: "decor-radio-vintage", x: 178, z: 278, rotation: 180, elevationY: 75 },
        { furnitureId: "plant-monstera", x: 85, z: 530 },

        // ═══ 东翼（卫生间下方 2.3×3.8m）：两张四人桌 + 落地灯 ═══
        { furnitureId: "dining_table-cafe-rustic", x: 1055, z: 330 },
        { furnitureId: "chair-industrial-black", x: 1055, z: 264 },
        { furnitureId: "chair-industrial-black", x: 1055, z: 396, rotation: 180 },
        { furnitureId: "chair-industrial-black", x: 989, z: 330, rotation: 90 },
        { furnitureId: "chair-industrial-black", x: 1121, z: 330, rotation: 270 },
        { furnitureId: "decor-tulip", x: 1055, z: 330, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 1031, z: 320, rotation: 20, elevationY: 74 },
        { furnitureId: "decor-coffee-mug", x: 1079, z: 322, rotation: 200, elevationY: 74 },
        { furnitureId: "lamp-pendant-ikea4", x: 1055, z: 330, mountCeiling: true },
        { furnitureId: "dining_table-cafe-rustic", x: 1055, z: 500 },
        { furnitureId: "chair-modern-gray", x: 1055, z: 434 },
        { furnitureId: "chair-modern-gray", x: 1055, z: 566, rotation: 180 },
        { furnitureId: "chair-modern-gray", x: 989, z: 500, rotation: 90 },
        { furnitureId: "chair-modern-gray", x: 1121, z: 500, rotation: 270 },
        { furnitureId: "decor-tulip", x: 1055, z: 500, elevationY: 74 },
        { furnitureId: "decor-cappuccino", x: 1031, z: 490, rotation: 20, elevationY: 74 },
        { furnitureId: "decor-coffee-mug", x: 1079, z: 492, rotation: 200, elevationY: 74 },
        { furnitureId: "lamp-pendant-ikea4", x: 1055, z: 500, mountCeiling: true },

        // ═══ 吊挂绿萝 + 主区吊灯成排（mountCeiling 顶贴天花）═══
        { furnitureId: "plant-hanging-pothos", x: 521, z: 157, mountCeiling: true },
        { furnitureId: "plant-hanging-pothos", x: 711, z: 157, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 471, z: 67, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 691, z: 67, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 375, z: 300, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 855, z: 300, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 616, z: 330, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 431, z: 402, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 801, z: 402, mountCeiling: true },

        // ═══ 东北窗边吧台座（原男女厕/洗手走廊拆除后腾出的临街玻璃采光角）：
        //     吧台贴北面幕墙横放(rotation:0=面朝南)，3 张吧凳在南侧，客人面窗而坐。
        //     与南墙那道窗边吧台同构(那边 counter z562 rot180 + 凳 z507)，此处镜像。
        //     counter-bar-straight 实为 220×60，正好塞进 x936..1178 这段。 ═══
        { furnitureId: "counter-bar-straight", x: 1055, z: 35 },
        { furnitureId: "seat-bar-stool", x: 975,  z: 95 },
        { furnitureId: "seat-bar-stool", x: 1055, z: 95 },
        { furnitureId: "seat-bar-stool", x: 1135, z: 95 },
      ],
      hallway: [
        // ★沿街露天座位区（1200×180，四面墙由 floorLayouts.wallsHidden 隐藏=骑楼人行道）：
        //   4 组太阳伞桌椅横排 + 西端咖啡推车 + 菜单黑板 + 欢迎牌 + 黑桶 + 橡皮树。
        //   坑：outdoor-patio-set / counter-coffee-cart 是 fill 一体件——保持 rotation:0，
        //   加 Y 旋转会触发 swapXZ 压扁。
        //   2026-07 重排：原来 4 组伞桌椅(220×220)塞不进 1200×180 的走廊——
        //   既超出走廊进深，第一组还整个压住了咖啡推车和菜单黑板。
        //   改成 3 组 + scale 0.8(176×176，进深放得下)，西端留给推车/黑板，
        //   其余空当放迎宾牌和橡皮树，彼此不重叠。
        { furnitureId: "counter-coffee-cart", x: 70, z: 95 },
        { furnitureId: "decor-bin-black", x: 20, z: 155 },
        { furnitureId: "decor-menu-chalkboard", x: 175, z: 35 },
        { furnitureId: "outdoor-patio-set", x: 350, z: 105, scaleW: 0.8, scaleD: 0.8 },
        { furnitureId: "decor-welcome-sign", x: 505, z: 40 },
        { furnitureId: "outdoor-patio-set", x: 660, z: 105, scaleW: 0.8, scaleD: 0.8 },
        { furnitureId: "plant-rubber-tree", x: 815, z: 140 },
        { furnitureId: "outdoor-patio-set", x: 970, z: 105, scaleW: 0.8, scaleD: 0.8 },
        { furnitureId: "plant-rubber-tree", x: 1125, z: 140 },
      ],
      kitchen: [
        // ★厨房+库房(galley 后场,2026-07 调研重排)：北墙冷藏+洗涤区，
        //   东墙备餐台(让出中央通道)，西墙干货金属架，西南角储物箱堆叠。
        { furnitureId: "fridge-single-white", x: 42, z: 45 },
        { furnitureId: "appliance-drink-fridge", x: 108, z: 45 },
        // 双槽水槽嵌进备餐台台面(kitchen_sink 类自动锚定台面高——单独落地会悬浮,教训)
        { furnitureId: "sink-double-steel", x: 225, z: 215, rotation: 90 },
        { furnitureId: "dining_table-bar-counter", x: 225, z: 155, rotation: 90 },
        { furnitureId: "appliance-coffee", x: 225, z: 120, elevationY: 105 },
        { furnitureId: "decor-books-pile", x: 225, z: 190, elevationY: 105 },
        { furnitureId: "storage-shelving", x: 25, z: 117, rotation: 90 },
        { furnitureId: "storage-shelving-2", x: 25, z: 170, rotation: 90 },
        { furnitureId: "decor-trash-bin", x: 160, z: 242 },
      ],
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
    // 实墙 + 大窗户（去玻璃幕墙）。现代简约写真外立面。
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    wallMaterial: "render",
    wallColor: "#EDEBE6",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A3A3C",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "office-f1",
      name: "办公楼层",
      area: 166,
      // 实墙 + 大窗户（非玻璃幕墙）。回字形：大厅=整层矩形框架(1700×1120)挖中央洞，
      // 9 个私密房间(上排4+中央走廊+下排4)填洞；进门即大厅，四面留宽边等候/开放工位。
      rooms: [
        // ═══ 大厅 living：整层外框 1700×1120，中央挖洞 x350-1350 / y180-760 ═══
        { room: "living", x: 0, y: 0, width: 1700, depth: 1120,
          name: "大厅", icon: "🏛️",
          shape: { preset: "custom",
            points: [[0,0],[1700,0],[1700,1120],[0,1120]],
            holes: [[[350,180],[1350,180],[1350,760],[350,760]]] },
          doors: [{ wall: "S", pos: 775, len: 150, style: "glass_swing", h: 220 }],
          windows: [{ wall: "N", pos: 200, len: 500 }, { wall: "N", pos: 1000, len: 500 },
            { wall: "W", pos: 300, len: 520 }, { wall: "E", pos: 300, len: 520 },
            { wall: "S", pos: 150, len: 400 }, { wall: "S", pos: 1150, len: 400 }] },
        // ── 洞内·上排 y180-400（门朝南通走廊）──
        { room: "dining",  x: 350,  y: 180, width: 350, depth: 220,
          name: "会议室", icon: "📊", doors: [{ wall: "S", pos: 130, len: 100 }] },
        { room: "master",  x: 700,  y: 180, width: 250, depth: 220,
          name: "独立办公室", icon: "💼", doors: [{ wall: "S", pos: 80, len: 90 }] },
        { room: "kitchen", x: 950,  y: 180, width: 230, depth: 220,
          name: "茶水间", icon: "☕", doors: [{ wall: "S", pos: 70, len: 90 }] },
        { room: "bathroom", x: 1180, y: 180, width: 170, depth: 220,
          name: "男洗手间", icon: "🚹", doors: [{ wall: "S", pos: 45, len: 80 }] },
        // ── 中央走廊 hallway y400-500，两端(W/E)敞开通大厅 ──
        { room: "hallway", x: 350, y: 400, width: 1000, depth: 100,
          name: "走廊", icon: "🚶", wallsHidden: ["W", "E"] },
        // ── 洞内·下排 y500-760（门朝北通走廊，与上排对向）──
        { room: "custom2", x: 350, y: 500, width: 250, depth: 260,
          name: "吸烟室", icon: "🚬", doors: [{ wall: "N", pos: 85, len: 80 }] },
        { room: "equipment_room", x: 600, y: 500, width: 250, depth: 260,
          name: "机房", icon: "🖧", doors: [{ wall: "N", pos: 85, len: 80 }] },
        { room: "closet", x: 850, y: 500, width: 250, depth: 260,
          name: "库房", icon: "📦", doors: [{ wall: "N", pos: 85, len: 80 }] },
        { room: "bathroom2", x: 1100, y: 500, width: 250, depth: 260,
          name: "女洗手间", icon: "🚺", doors: [{ wall: "N", pos: 85, len: 80 }] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      // ═══ 大厅 living（回字形外框 1700×1120）：四边留宽边=开放工位+入口前台+等候 ═══
      // N条(z0-180)/W条(x0-350)/E条(x1350-1700) 放开放工位；S条(z760-1120) 前台+等候。
      living: [
        // ── N 条：4 个开放工位（贴北窗）──
        { furnitureId: "desk-standing",   x: 220,  z: 55, rotation: 180 },
        { furnitureId: "chair-ergonomic", x: 220,  z: 112, rotation: 0 },
        { furnitureId: "elec-monitor",    x: 220,  z: 43, elevationY: 66 },
        { furnitureId: "desk-standing",   x: 620,  z: 55, rotation: 180 },
        { furnitureId: "chair-ergonomic", x: 620,  z: 112, rotation: 0 },
        { furnitureId: "elec-monitor",    x: 620,  z: 43, elevationY: 66 },
        { furnitureId: "desk-standing",   x: 1080, z: 55, rotation: 180 },
        { furnitureId: "chair-ergonomic", x: 1080, z: 112, rotation: 0 },
        { furnitureId: "elec-laptop",     x: 1080, z: 43, elevationY: 66 },
        { furnitureId: "desk-standing",   x: 1480, z: 55, rotation: 180 },
        { furnitureId: "chair-ergonomic", x: 1480, z: 112, rotation: 0 },
        { furnitureId: "elec-monitor",    x: 1480, z: 43, elevationY: 66 },
        { furnitureId: "lamp-ceiling-long", x: 420,  z: 90, mountCeiling: true },
        { furnitureId: "lamp-ceiling-long", x: 1280, z: 90, mountCeiling: true },
        { furnitureId: "rug-modern-gray",   x: 850, z: 100, scaleW: 3.2, scaleD: 1.2 },
        // ── W 条：2 个开放工位 + 书架 + 绿植 ──
        { furnitureId: "desk-standing",   x: 70, z: 320, rotation: 90 },
        { furnitureId: "chair-ergonomic", x: 135, z: 320, rotation: 270 },
        { furnitureId: "elec-monitor",    x: 48, z: 320, elevationY: 66 },
        { furnitureId: "desk-standing",   x: 70, z: 560, rotation: 90 },
        { furnitureId: "chair-ergonomic", x: 135, z: 560, rotation: 270 },
        { furnitureId: "elec-monitor",    x: 48, z: 560, elevationY: 66 },
        { furnitureId: "bookshelf-open-white", x: 30, z: 700, rotation: 90 },
        { furnitureId: "plant-rubber-tree", x: 300, z: 220 },
        { furnitureId: "lamp-ceiling-long", x: 90, z: 440, mountCeiling: true },
        // ── E 条：2 个开放工位 + 绿植 + 落地灯 ──
        { furnitureId: "desk-standing",   x: 1630, z: 320, rotation: 270 },
        { furnitureId: "chair-ergonomic", x: 1565, z: 320, rotation: 90 },
        { furnitureId: "elec-monitor",    x: 1652, z: 320, elevationY: 66 },
        { furnitureId: "desk-standing",   x: 1630, z: 560, rotation: 270 },
        { furnitureId: "chair-ergonomic", x: 1565, z: 560, rotation: 90 },
        { furnitureId: "elec-monitor",    x: 1652, z: 560, elevationY: 66 },
        { furnitureId: "plant-monstera",  x: 1400, z: 220 },
        { furnitureId: "floor_lamp-modern", x: 1660, z: 700 },
        { furnitureId: "lamp-ceiling-long", x: 1610, z: 440, mountCeiling: true },
        // ── S 条：入口前台（居中近门 x775）+ 两侧等候区 ──
        { furnitureId: "counter-bar-straight", x: 775, z: 850, rotation: 180 },
        { furnitureId: "chair-ergonomic",   x: 775, z: 815, rotation: 0 },
        { furnitureId: "decor-welcome-sign",x: 720, z: 850, elevationY: 100 },
        { furnitureId: "plant-rubber-tree", x: 620, z: 800 },
        { furnitureId: "plant-rubber-tree", x: 930, z: 800 },
        // 左等候
        { furnitureId: "sofa-modern-pillows", x: 260, z: 1000, rotation: 0 },
        { furnitureId: "coffee-oak-round",  x: 260, z: 905 },
        { furnitureId: "sofa-armchair",     x: 470, z: 970, rotation: 270 },
        { furnitureId: "rug-modern-gray",   x: 320, z: 960, scaleW: 2.0, scaleD: 1.6 },
        { furnitureId: "plant-monstera",    x: 60, z: 1060 },
        // 右等候
        { furnitureId: "sofa-modern-pillows", x: 1440, z: 1000, rotation: 0 },
        { furnitureId: "coffee-oak-round",  x: 1440, z: 905 },
        { furnitureId: "sofa-armchair",     x: 1230, z: 970, rotation: 90 },
        { furnitureId: "rug-modern-gray",   x: 1380, z: 960, scaleW: 2.0, scaleD: 1.6 },
        { furnitureId: "plant-rubber-tree", x: 1640, z: 1060 },
        { furnitureId: "lamp-ceiling-modern", x: 775, z: 880, mountCeiling: true },
        { furnitureId: "lamp-ceiling-modern", x: 320, z: 960, mountCeiling: true },
        { furnitureId: "lamp-ceiling-modern", x: 1380, z: 960, mountCeiling: true },
      ],
      // ═══ 会议室 dining（350×220，门朝南 x130）═══
      dining: [
        { furnitureId: "table-conference",  x: 175, z: 105, rotation: 0 },
        { furnitureId: "chair-modern-gray", x: 110, z: 50, rotation: 180 },
        { furnitureId: "chair-modern-gray", x: 240, z: 50, rotation: 180 },
        { furnitureId: "chair-modern-gray", x: 110, z: 160, rotation: 0 },
        { furnitureId: "chair-modern-gray", x: 240, z: 160, rotation: 0 },
        { furnitureId: "decor-book-stack",  x: 155, z: 100, elevationY: 75 },
        { furnitureId: "decor-coffee-mug",  x: 210, z: 112, elevationY: 75 },
        { furnitureId: "elec-tv-flat",      x: 342, z: 105, rotation: 270, elevationY: 130 },
        { furnitureId: "plant-sansevieria", x: 315, z: 190 },
        { furnitureId: "rug-nordic-geo",    x: 175, z: 105, scaleW: 1.6, scaleD: 1.2 },
        { furnitureId: "lamp-ceiling-long", x: 175, z: 105, mountCeiling: true },
      ],
      // ═══ 独立办公室 master（250×220，门朝南 x80）═══
      master: [
        { furnitureId: "desk-standing",     x: 125, z: 55, rotation: 180 },
        { furnitureId: "chair-ergonomic",   x: 125, z: 108, rotation: 0 },
        { furnitureId: "elec-monitor",      x: 125, z: 43, elevationY: 66 },
        { furnitureId: "chair-modern-gray", x: 180, z: 175, rotation: 90 },
        { furnitureId: "plant-rubber-tree", x: 215, z: 55 },
        { furnitureId: "rug-nordic-geo",    x: 125, z: 120, scaleW: 1.1, scaleD: 1.0 },
        { furnitureId: "lamp-ceiling-modern", x: 125, z: 120, mountCeiling: true },
      ],
      // ═══ 茶水间 kitchen（230×220，门朝南 x70）═══
      kitchen: [
        { furnitureId: "counter-bar-straight", x: 115, z: 35, rotation: 0 },
        { furnitureId: "cabinet-upper-white",  x: 115, z: 12, elevationY: 150 },
        { furnitureId: "appliance-coffee",     x: 60,  z: 35, elevationY: 110 },
        { furnitureId: "decor-coffee-jar",     x: 170, z: 35, elevationY: 110 },
        { furnitureId: "fridge-single-white",  x: 200, z: 60 },
        { furnitureId: "dining_table-bar",     x: 90,  z: 150, rotation: 0 },
        { furnitureId: "seat-bar-stool",       x: 40,  z: 150, rotation: 90 },
        { furnitureId: "seat-bar-stool",       x: 140, z: 150, rotation: 270 },
        { furnitureId: "plant-monstera",       x: 200, z: 190 },
        { furnitureId: "lamp-ceiling-modern",  x: 115, z: 120, mountCeiling: true },
      ],
      // ═══ 男洗手间 bathroom（170×220，门朝南 x45）═══
      bathroom: [
        { furnitureId: "toilet-standard",     x: 50,  z: 55, rotation: 0 },
        { furnitureId: "vanity-single-white", x: 125, z: 50, rotation: 0 },
        { furnitureId: "decor-trash-bin",     x: 45,  z: 185 },
        { furnitureId: "plant-sansevieria",   x: 140, z: 185 },
        { furnitureId: "lamp-ceiling-modern", x: 85,  z: 110, mountCeiling: true },
      ],
      // ═══ 吸烟室 custom2（250×260，门朝北 x85）═══
      custom2: [
        { furnitureId: "dining_table-bar", x: 160, z: 150, rotation: 0 },
        { furnitureId: "seat-bar-stool",   x: 160, z: 210, rotation: 0 },
        { furnitureId: "decor-cigarettes", x: 160, z: 150, elevationY: 97 },
        { furnitureId: "exhaust-vent",     x: 220, z: 235, elevationY: 200 },
        { furnitureId: "plant-sansevieria",x: 210, z: 230 },
        { furnitureId: "decor-trash-bin-2",x: 50,  z: 230 },
        { furnitureId: "lamp-ceiling-modern", x: 160, z: 150, mountCeiling: true },
      ],
      // ═══ 机房 equipment_room（250×260，门朝北 x85）═══
      equipment_room: [
        { furnitureId: "storage-shelving",   x: 50,  z: 130, rotation: 90 },
        { furnitureId: "storage-shelving",   x: 50,  z: 210, rotation: 90 },
        { furnitureId: "storage-shelving-2", x: 200, z: 130, rotation: 270 },
        { furnitureId: "storage-shelving-2", x: 200, z: 210, rotation: 270 },
        { furnitureId: "elec-router",        x: 125, z: 60, elevationY: 70 },
        { furnitureId: "decor-trash-bin",    x: 210, z: 235 },
        { furnitureId: "lamp-ceiling-led",   x: 125, z: 150, mountCeiling: true },
      ],
      // ═══ 库房 closet（250×260，门朝北 x85）═══
      closet: [
        { furnitureId: "storage-shelving",   x: 50,  z: 130, rotation: 90 },
        { furnitureId: "storage-shelving",   x: 50,  z: 210, rotation: 90 },
        { furnitureId: "storage-shelving-2", x: 200, z: 130, rotation: 270 },
        { furnitureId: "storage-shelving-2", x: 200, z: 210, rotation: 270 },
        { furnitureId: "storage-box",        x: 125, z: 150 },
        { furnitureId: "storage-crate",      x: 125, z: 225 },
        { furnitureId: "lamp-ceiling-led",   x: 125, z: 150, mountCeiling: true },
      ],
      // ═══ 女洗手间 bathroom2（250×260，门朝北 x85）═══
      bathroom2: [
        { furnitureId: "toilet-standard",     x: 60,  z: 205, rotation: 180 },
        { furnitureId: "vanity-single-white", x: 180, z: 205, rotation: 180 },
        { furnitureId: "decor-trash-bin",     x: 210, z: 70 },
        { furnitureId: "plant-sansevieria",   x: 60,  z: 70 },
        { furnitureId: "lamp-ceiling-modern", x: 125, z: 150, mountCeiling: true },
      ],
      // ═══ 走廊 hallway（1000×100，两端通大厅）═══
      hallway: [
        { furnitureId: "plant-sansevieria", x: 40,  z: 50 },
        { furnitureId: "plant-sansevieria", x: 960, z: 50 },
        { furnitureId: "lamp-ceiling-led",  x: 500, z: 50, mountCeiling: true },
      ],
    },
  ],
};

const RESTAURANT_SET: ProjectTemplate = {
  id: "set-restaurant",
  name: "小餐馆片场",
  nameEn: "Bistro Set",
  emoji: "🍜",
  description: "片场 · 单层 · 玻璃门面 · 开放后厨+卡座+密集桌位 · 拍聚餐/市井戏",
  descriptionEn: "Film set · 1F · Glass storefront · Open kitchen + booths + tables",
  areaSqm: 96,
  palette: ["#EFE8DC", "#4A3A2A", "#B0503A"],
  styleTemplateId: "modern-villa",

  // 对标咖啡馆：临街玻璃门面 + 骑楼露天座；暖木/陶土色的市井小馆调性。
  exterior: {
    preset: "glass-curtain",
    facadeSystem: "curtain-wall",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    wallColor: "#F0E9DD",
    wallBaseColor: "#EFE8DC",
    glassColor: "#C4D2CB",
    glassOpacity: 1,
    windowFrameColor: "#2A2018",
    entranceFrameColor: "#2A2018",
    woodSoffit: true,
    roofOverhang: 0.8,
    parapetHeight: 0,
    roofSlabColor: "#4A3A2A",
    roofColor: "#4A3A2A",
    accentColor: "#B0503A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "resto-f1",
      name: "小餐馆",
      area: 96,
      // 咖啡馆式布局：大堂 L 形（兜西北后厨/卫生间两缺口），临街玻璃门面（南+东），
      // 走廊=沿街骑楼露天座；后厨半开放（E 墙拆开=开放式厨房+出餐口）。
      rooms: [
        // 西北后厨（半开放：拆 E 墙对着大堂；后场隐私→实墙立面）
        { room: "kitchen",  x: 0, y: 0, width: 300, depth: 300,
          name: "后厨", icon: "🍳", exteriorStyle: "concrete", wallsHidden: ["E"] },
        // 西侧卫生间（小 WC；实墙立面；E 墙开门通大堂）
        { room: "bathroom", x: 0, y: 300, width: 300, depth: 200,
          name: "洗手间", icon: "🚻", exteriorStyle: "concrete",
          doors: [{ wall: "E", pos: 100, len: 90 }] },
        // 大堂 L 形（1200×620，兜西北 300×500 缺口）；临街玻璃门面 + 南墙大门 + 门楣店招
        { room: "living",   x: 0, y: 0, width: 1200, depth: 620,
          name: "大堂", icon: "🍽️", exteriorStyle: "glass",
          shape: { preset: "custom",
            points: [[300,0],[1200,0],[1200,620],[0,620],[0,500],[300,500]] },
          doors: [{ wall: "S", pos: 600, len: 160, style: "glass_swing", h: 210 }],
          wallDecor: [{ furnitureId: "sign-cafe-wall", wall: "S", u: 0.5, v: 0.92,
            label: "市井小馆|SHIJING BISTRO" }] },
        // 沿街骑楼露天座（走廊语义；四面墙隐藏成露台）
        { room: "hallway",  x: 0, y: 620, width: 1200, depth: 180,
          name: "露天座", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      // ═══ 大堂 living（L 形 1200×620，西北 300×500 缺口=后厨/卫生间）═══
      // 坐标 living-local：(0,0)=包围盒西北角，x→东(0-1200)，z→南(0-620)。
      // 服务脊线沿缺口东缘(x300)一字排开：出餐口→收银；密集桌位居中；卡座沿东墙。
      living: [
        // ── 服务脊线（缺口东缘 x300，面朝大堂）：出餐口 + 收银 ──
        { furnitureId: "counter-bar-wood",   x: 345, z: 130, rotation: 90 },
        { furnitureId: "decor-copper-pots",  x: 345, z: 70,  rotation: 90, elevationY: 110 },
        { furnitureId: "decor-pots-pans",    x: 345, z: 190, rotation: 90, elevationY: 110 },
        { furnitureId: "counter-wooden-bar", x: 345, z: 400, rotation: 90 },
        { furnitureId: "electronics-pos",    x: 360, z: 400, rotation: 90, elevationY: 118 },
        { furnitureId: "decor-welcome-sign", x: 360, z: 330, elevationY: 118 },
        { furnitureId: "plant-rubber-tree",  x: 345, z: 560 },

        // ── 密集桌位：4-6 人长桌 ×2（西）+ 2-4 人圆桌 ×2（中）──
        { furnitureId: "dining_table-mahogany", x: 620, z: 160 },
        { furnitureId: "chair-nordic-oak", x: 560, z: 95,  rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 680, z: 95,  rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 560, z: 225, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 680, z: 225, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 522, z: 160, rotation: 90 },
        { furnitureId: "chair-nordic-oak", x: 718, z: 160, rotation: 270 },
        { furnitureId: "decor-cutlery", x: 575, z: 145, elevationY: 76 },
        { furnitureId: "decor-cutlery", x: 665, z: 175, rotation: 180, elevationY: 76 },
        { furnitureId: "decor-tulip",   x: 620, z: 160, elevationY: 76 },

        { furnitureId: "dining_table-mahogany", x: 620, z: 450 },
        { furnitureId: "chair-modern-gray", x: 560, z: 385, rotation: 180 },
        { furnitureId: "chair-modern-gray", x: 680, z: 385, rotation: 180 },
        { furnitureId: "chair-modern-gray", x: 560, z: 515, rotation: 0 },
        { furnitureId: "chair-modern-gray", x: 680, z: 515, rotation: 0 },
        { furnitureId: "chair-modern-gray", x: 522, z: 450, rotation: 90 },
        { furnitureId: "chair-modern-gray", x: 718, z: 450, rotation: 270 },
        { furnitureId: "decor-cutlery", x: 575, z: 435, elevationY: 76 },
        { furnitureId: "decor-cutlery", x: 665, z: 465, rotation: 180, elevationY: 76 },
        { furnitureId: "decor-tea-set", x: 620, z: 450, elevationY: 76 },

        { furnitureId: "dining_table-cafe-rustic", x: 880, z: 160 },
        { furnitureId: "chair-industrial-black", x: 880, z: 94,  rotation: 180 },
        { furnitureId: "chair-industrial-black", x: 880, z: 226, rotation: 0 },
        { furnitureId: "chair-industrial-black", x: 814, z: 160, rotation: 90 },
        { furnitureId: "chair-industrial-black", x: 946, z: 160, rotation: 270 },
        { furnitureId: "decor-tulip",       x: 880, z: 160, elevationY: 74 },
        { furnitureId: "decor-fruit-bowl",  x: 855, z: 172, elevationY: 74 },

        { furnitureId: "dining_table-cafe-rustic", x: 880, z: 450 },
        { furnitureId: "chair-industrial-black", x: 880, z: 384, rotation: 180 },
        { furnitureId: "chair-industrial-black", x: 880, z: 516, rotation: 0 },
        { furnitureId: "chair-industrial-black", x: 814, z: 450, rotation: 90 },
        { furnitureId: "chair-industrial-black", x: 946, z: 450, rotation: 270 },
        { furnitureId: "decor-tulip",       x: 880, z: 450, elevationY: 74 },
        { furnitureId: "decor-cutlery",     x: 855, z: 462, elevationY: 74 },

        // ── 沿东墙卡座 ×2（自带餐桌软座，开口朝西）──
        { furnitureId: "seat-diner-booth", x: 1095, z: 175, rotation: 270 },
        { furnitureId: "decor-vase-single", x: 1095, z: 175, elevationY: 74 },
        { furnitureId: "seat-diner-booth", x: 1095, z: 445, rotation: 270 },
        { furnitureId: "decor-vase-single", x: 1095, z: 445, elevationY: 74 },

        // ── 装饰墙 + 绿植 + 成排暖光吊灯 ──
        { furnitureId: "mural-inkwash",  x: 780, z: 12 },
        { furnitureId: "plant-monstera", x: 1160, z: 40 },
        { furnitureId: "plant-rubber-tree", x: 1160, z: 585 },
        { furnitureId: "plant-hanging-pothos", x: 750, z: 300, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 620, z: 160, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 620, z: 450, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 880, z: 160, mountCeiling: true },
        { furnitureId: "lamp-pendant-ikea4", x: 880, z: 450, mountCeiling: true },
        { furnitureId: "lamp-pendant-modern", x: 345, z: 400, mountCeiling: true },
      ],
      // ═══ 后厨 kitchen（300×300，开放式，E 墙拆开对大堂）═══
      kitchen: [
        { furnitureId: "kitchen_cabinet-island-pan", x: 150, z: 100, rotation: 0 },
        { furnitureId: "appliance-cooktop",   x: 150, z: 100, elevationY: 90 },
        { furnitureId: "decor-pots-pans",     x: 110, z: 95,  elevationY: 90 },
        { furnitureId: "appliance-hood-caple",x: 150, z: 40,  elevationY: 175 },
        { furnitureId: "kitchen_cabinet-island-sink", x: 255, z: 90, rotation: 0 },
        { furnitureId: "fridge-french-door",  x: 65,  z: 250 },
        { furnitureId: "storage-shelving",    x: 40,  z: 90,  rotation: 90 },
        { furnitureId: "lamp-ceiling-led",    x: 150, z: 150, mountCeiling: true },
      ],
      // ═══ 洗手间 bathroom（300×200，小 WC）═══
      bathroom: [
        { furnitureId: "toilet-standard",     x: 60,  z: 100, rotation: 90 },
        { furnitureId: "vanity-single-white", x: 210, z: 50 },
        { furnitureId: "decor-trash-bin",     x: 60,  z: 175 },
        { furnitureId: "plant-sansevieria",   x: 265, z: 175 },
        { furnitureId: "lamp-ceiling-modern", x: 150, z: 100, mountCeiling: true },
      ],
      // ═══ 露天座 hallway（1200×180 骑楼）：小圆桌 + 绿植 ═══
      hallway: [
        { furnitureId: "dining_table-cafe-marble", x: 300, z: 90 },
        { furnitureId: "chair-modern-gray", x: 240, z: 90, rotation: 90 },
        { furnitureId: "chair-modern-gray", x: 360, z: 90, rotation: 270 },
        { furnitureId: "dining_table-cafe-marble", x: 640, z: 90 },
        { furnitureId: "chair-modern-gray", x: 580, z: 90, rotation: 90 },
        { furnitureId: "chair-modern-gray", x: 700, z: 90, rotation: 270 },
        { furnitureId: "dining_table-cafe-marble", x: 980, z: 90 },
        { furnitureId: "chair-modern-gray", x: 920, z: 90, rotation: 90 },
        { furnitureId: "chair-modern-gray", x: 1040, z: 90, rotation: 270 },
        { furnitureId: "plant-rubber-tree", x: 60,  z: 90 },
        { furnitureId: "plant-rubber-tree", x: 1140, z: 90 },
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
