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
import setCafeOverrides from "@/data/templates/set-cafe.json";
import setRestaurantOverrides from "@/data/templates/set-restaurant.json";
// 办公室：数据驱动，房间几何 + 家具都从 office-snapshot.json 生成（见 officeTemplate.ts）。
import { OFFICE_ROOMS, OFFICE_FURNITURE_OVERRIDES } from "./officeTemplate";

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
  /** 沿局部 X/Z 轴镜像（scale = -1）。做左右/前后对称的成对家具，
   *  隔间门用它换铰链侧+开向（男女厕镜像对开门）。 */
  mirrorX?: boolean;
  mirrorZ?: boolean;
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
    groundType: "tile", // 样板默认青砖广场地面（写入模板数据）
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
    groundType: "tile", // 样板默认青砖广场地面（写入模板数据）
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
    groundType: "tile", // 样板默认青砖广场地面（写入模板数据）
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
    groundType: "tile",  // 样板默认青砖广场地面（写入模板数据，不靠全局默认）
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
    groundType: "tile",  // 样板默认青砖广场地面（写入模板数据，不靠全局默认）
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
    groundType: "tile",  // 样板默认青砖广场地面（写入模板数据，不靠全局默认）
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
    groundType: "tile",  // 样板默认青砖广场地面（写入模板数据，不靠全局默认）
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
    groundType: "tile",  // 样板默认青砖广场地面（写入模板数据，不靠全局默认）
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
    groundType: "tile",  // 样板默认青砖广场地面（写入模板数据，不靠全局默认）
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
    groundType: "tile",  // 样板默认青砖广场地面（写入模板数据，不靠全局默认）
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
        // 2026-07 用户在后场北墙加了一扇推拉窗（导出方案固化）——临街采光，透见红色饮料柜。
        { room: "kitchen",  x: 0,   y: 0,   width: 280,  depth: 260, exteriorStyle: "concrete",
          windows: [{ wall: "N", pos: 70, len: 112 }] },
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
          wallDecor: [{ furnitureId: "sign-cafe-wall", wall: "S", u: 0.52, v: 0.84, label: "YUNHENG COFFEE|云横咖啡" }] },
        // 沿街露天座位区（走廊语义；全墙隐藏成骑楼露台）
        { room: "hallway",  x: 0,   y: 600, width: 1200, depth: 180, wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // ⚠️ 2026-07 由用户当前设计**快照**生成（含桌椅/壁画位置调整），覆盖原手写布局。
  //   店招(sign-cafe-wall)仍走 living 房间定义里的 wallDecor（S 墙），不在这里。
  furnitureOverrides: setCafeOverrides as unknown as ProjectTemplate["furnitureOverrides"],
};

const OFFICE_SET: ProjectTemplate = {
  id: "set-office",
  name: "办公室片场",
  nameEn: "Office Set",
  emoji: "💼",
  description: "片场 · 单层 · 开放工位+会议室+茶水间 · 拍职场戏",
  descriptionEn: "Film set · 1F · Open desks + meeting room + pantry · Workplace scenes",
  areaSqm: 240,
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
    groundType: "tile",  // 样板默认青砖广场地面（写入模板数据，不靠全局默认）
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
      area: 240,
      // 房间几何数据驱动：从 office-snapshot.json 生成（见 officeTemplate.ts）。
      // 用户改布局后替换该快照即可，无需手改这里。房名/图标/顺序在 ROOM_META。
      rooms: OFFICE_ROOMS,
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: OFFICE_FURNITURE_OVERRIDES,
};

const RESTAURANT_SET: ProjectTemplate = {
  id: "set-restaurant",
  name: "餐厅片场",
  nameEn: "Restaurant Set",
  emoji: "🍽️",
  description: "片场 · 单层 · 大堂散座+卡座+吧台 · 包间×2+VIP包间 · 商用后厨 · 男女洗手间 · 骑楼露天",
  descriptionEn: "Film set · 1F · Dining hall + booths + bar · 2 private + VIP rooms · pro kitchen · M/F WC",
  areaSqm: 320,
  palette: ["#EFE8DC", "#4A3A2A", "#B0503A"],
  styleTemplateId: "modern-villa",

  // 大餐馆：临街玻璃门面 + 骑楼露天座；后场一排(商用后厨/包间×2/男女洗手间)，大堂满座。
  exterior: {
    preset: "glass-curtain",
    facadeSystem: "curtain-wall",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",  // 样板默认青砖广场地面（写入模板数据，不靠全局默认）
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
      area: 320,
      // 大餐馆(floor 3000×1220)分区：西北角=后厨；中段=客用私密区(包间一/二 + VIP)；
      // VIP(到 x2020)与东北洗手间区(x2380 起)之间留 360cm 绿植隔断缓冲(间隔，通到北墙)；
      // 洗手间过道 S 面整面敞开(从大堂直接走进，不封死)，男女厕贴最北边墙(靠边)。
      rooms: [
        // ── 西北角 后厨（开口 S 出餐）──
        { room: "kitchen",  x: 0, y: 0, width: 780, depth: 440,
          name: "后厨", nameEn: "Kitchen", icon: "🍳", exteriorStyle: "concrete", wallsHidden: ["S"] },
        // ── 中段 客用私密区（包间一/二 + VIP）──
        { room: "dining",   x: 780, y: 0, width: 340, depth: 440,
          name: "包间一", nameEn: "Private Room 1", icon: "🍱", exteriorStyle: "concrete",
          doors: [{ wall: "S", pos: 170, len: 100 }] },
        { room: "master",   x: 1120, y: 0, width: 340, depth: 440,
          name: "包间二", nameEn: "Private Room 2", icon: "🍷", exteriorStyle: "concrete",
          doors: [{ wall: "S", pos: 170, len: 100 }] },
        { room: "study",    x: 1460, y: 0, width: 560, depth: 440,
          name: "VIP 包间", nameEn: "VIP Room", icon: "👑", exteriorStyle: "concrete",
          doors: [{ wall: "S", pos: 280, len: 110 }] },
        // ── 东北角 洗手间区（与 VIP 间隔 x2020-2380 绿植缓冲）──
        // 过道：矩形横条(y260-440)，S 面整面敞开通大堂→可直接走进；男女厕门开在各自外侧，
        // 盥洗台居中放过道；男女厕在其北侧贴边墙
        { room: "bedroom",  x: 2380, y: 260, width: 620, depth: 180,
          name: "洗手间过道", nameEn: "Restroom Hall", icon: "🚻", exteriorStyle: "concrete", wallsHidden: ["S"] },
        { room: "bathroom", x: 2380, y: 0, width: 310, depth: 260,
          name: "男洗手间", nameEn: "Men's Room", icon: "🚹", exteriorStyle: "concrete",
          doors: [{ wall: "S", pos: 65, len: 100 }] },
        { room: "bathroom2", x: 2690, y: 0, width: 310, depth: 260,
          name: "女洗手间", nameEn: "Women's Room", icon: "🚺", exteriorStyle: "concrete",
          doors: [{ wall: "S", pos: 245, len: 100 }] },
        // ── 大堂 多边形（floor 3000；兜西北后场块 x0-2020 + 东北洗手间块 x2380-3000，
        //     中间隔断缓冲 x2020-2380 通到北墙）；玻璃门面 + 南门 + 店招 ──
        { room: "living",   x: 0, y: 0, width: 3000, depth: 1020,
          name: "大堂", nameEn: "Dining Hall", icon: "🍽️", exteriorStyle: "glass",
          shape: { preset: "custom",
            points: [[0,440],[2020,440],[2020,0],[2380,0],[2380,440],[3000,440],[3000,1020],[0,1020]] },
          doors: [{ wall: "S", pos: 1400, len: 200, style: "glass_swing", h: 210 }],
          wallDecor: [{ furnitureId: "sign-cafe-wall", wall: "S", u: 0.5, v: 0.93,
            label: "宴福楼|YANFU RESTAURANT" }] },
        // ── 沿街骑楼露天座 ──
        { room: "hallway",  x: 0, y: 1020, width: 3000, depth: 200,
          name: "露天座", nameEn: "Terrace Seating", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: setRestaurantOverrides as unknown as ProjectTemplate["furnitureOverrides"],
};

// ── 现代都市公寓片场（导演台 MVP 新增；简版）────────────────────────────
// 80㎡ 两居：大客厅（拍家庭/日常对话戏的主场）+ 餐厅 + 厨房 + 主卧 +
// 次卧 + 卫生间。房间几何为手写矩形拼贴；客厅/餐厅家具显式摆放（复用
// 北欧风格现有家具 id），其余房间走 modern-villa 风格模板默认铺设——
// 不是全新 3D 建模，是一套"用现成家具搭出来的公寓客厅片场"。
const APARTMENT_SET: ProjectTemplate = {
  id: "set-apartment",
  name: "公寓客厅片场",
  nameEn: "Apartment Set",
  emoji: "🛋️",
  description: "片场 · 单层 · 两居 80㎡ · 大客厅+餐厅 · 拍家庭/日常对话戏",
  descriptionEn: "Film set · 1F · 2-bed 80㎡ · Big living room + dining · Family / daily dialogue",
  areaSqm: 80,
  palette: ["#F2EFE9", "#3A3A3C", "#C8A882"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#F2EFE9",
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
      id: "apt-f1",
      name: "都市公寓",
      area: 80,
      // 1000×800cm 矩形拼贴（无缺口）：
      // 上排：客厅 620×480 | 厨房 380×300 + 餐厅 380×180
      // 下排：主卧 500×320 | 卫生间 220×320 | 次卧 280×320
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 620, depth: 480,
          name: "客厅", nameEn: "Living Room", icon: "🛋️",
          windows: [{ wall: "S", pos: 200, len: 240 }] },
        { room: "kitchen",  x: 620, y: 0,   width: 380, depth: 300,
          name: "厨房", nameEn: "Kitchen", icon: "🍳" },
        { room: "dining",   x: 620, y: 300, width: 380, depth: 180,
          name: "餐厅", nameEn: "Dining Room", icon: "🍽️" },
        { room: "master",   x: 0,   y: 480, width: 500, depth: 320,
          name: "主卧", nameEn: "Master Bedroom", icon: "🛏️" },
        { room: "bathroom", x: 500, y: 480, width: 220, depth: 320,
          name: "卫生间", nameEn: "Bathroom", icon: "🚿" },
        { room: "bedroom",  x: 720, y: 480, width: 280, depth: 320,
          name: "次卧", nameEn: "Bedroom", icon: "🛏️" },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 客厅/餐厅显式摆放（room-local cm；复用北欧风格现有家具）；
  // 厨房/主卧/卫生间/次卧缺省 = 保留 modern-villa 风格模板的摆放。
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "tvunit-float-white", x: 310, z: 19, rotation: 0 },
        { furnitureId: "sofa-nordic-blue",   x: 310, z: 300, rotation: 180 },
        { furnitureId: "coffee-oak-round",   x: 310, z: 185, rotation: 0 },
        { furnitureId: "rug-nordic-geo",     x: 310, z: 215, rotation: 0 },
        { furnitureId: "lamp-arc-gold",      x: 60,  z: 280, rotation: 0 },
        { furnitureId: "plant-monstera",     x: 580, z: 440, rotation: 0 },
      ],
      dining: [
        { furnitureId: "dining-oak-rect", x: 190, z: 90, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 120, z: 40, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 260, z: 40, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 120, z: 140, rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 260, z: 140, rotation: 180 },
        { furnitureId: "plant-rubber-tree", x: 350, z: 150, rotation: 0 },
      ],
    },
  ],
};

// ── 农村自建房堂屋片场（导演台新增；简版）────────────────────────────
// 当代农村 ground floor：堂屋（仪式+社交中心，大圆桌+神龛）+ 厨房 +
// 卧房 + 院子（摩托/鸡/石板路）。房间几何为手写矩形拼贴；堂屋/厨房/
// 卧房/院子家具显式摆放（复用现有家具 id），神龛为边柜+供品拼搭——
// 不是全新 3D 建模，是一套"用现成家具搭出来的农村堂屋片场"。
const RURAL_HALL_SET: ProjectTemplate = {
  id: "set-rural-hall",
  name: "农村堂屋片场",
  nameEn: "Rural Hall Set",
  emoji: "🏮",
  description: "片场 · 单层 · 堂屋+厨房+卧房+院子 · 108㎡ · 拍农村家庭/乡土戏",
  descriptionEn: "Film set · 1F · Main hall + kitchen + bedroom + courtyard · 108㎡ · Rural family scenes",
  areaSqm: 108,
  palette: ["#EFE8DC", "#4A3A2A", "#B0503A"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#EFE8DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#4A3A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "rural-f1",
      name: "农村自建房",
      area: 108,
      // 1200×900cm 矩形拼贴（无缺口）：
      // 上排：堂屋 700×560 | 厨房 500×280 + 卧房 500×280
      // 下排：院子 1200×340（全墙隐藏 = 露天院子）
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 700, depth: 560,
          name: "堂屋", nameEn: "Main Hall", icon: "🏮",
          doors: [{ wall: "S", pos: 270, len: 160, style: "wood_panel", h: 210 }],
          windows: [
            { wall: "E", pos: 180, len: 200, style: "wooden", h: 150, sill: 90 },
            { wall: "W", pos: 180, len: 200, style: "wooden", h: 150, sill: 90 },
          ],
          wallDecor: [
            { furnitureId: "couplet-spring",     wall: "S", u: 0.35, v: 0.52, scaleH: 1.1 },
            { furnitureId: "couplet-prosperity", wall: "S", u: 0.65, v: 0.52, scaleH: 1.1 },
            { furnitureId: "nameplate-family",   wall: "S", u: 0.5,  v: 0.9 },
          ] },
        { room: "kitchen",  x: 700, y: 0,   width: 500, depth: 280,
          name: "厨房", nameEn: "Kitchen", icon: "🍳", exteriorStyle: "concrete" },
        { room: "bedroom",  x: 700, y: 280, width: 500, depth: 280,
          name: "卧房", nameEn: "Bedroom", icon: "🛏️" },
        // 院子：走廊语义；全墙隐藏成露天院子（咖啡馆沿街座位区同款做法）。
        { room: "hallway",  x: 0,   y: 560, width: 1200, depth: 340,
          name: "院子", nameEn: "Courtyard", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 堂屋：神龛（边柜+花瓶/果盘供品拼搭）+ 大圆桌 + 沙发电视；厨房/卧房/
  // 院子显式摆放；其余房间无。全部房间都在 overrides 里，风格模板的默认
  // 家具不会漏进来。
  furnitureOverrides: [
    {
      living: [
        // 神龛（拼搭）：北墙正中边柜 + 瓶花 + 果盘供品
        { furnitureId: "sideboard-walnut",  x: 350, z: 25,  rotation: 0 },
        { furnitureId: "decor-vase-single", x: 330, z: 25,  rotation: 0, elevationY: 85 },
        { furnitureId: "decor-fruit-bowl",  x: 370, z: 25,  rotation: 0, elevationY: 85 },
        // 大圆桌 + 餐具
        { furnitureId: "dining_table-round-set", x: 350, z: 260, rotation: 0 },
        { furnitureId: "decor-dinnerware",  x: 320, z: 260, rotation: 0, elevationY: 75 },
        { furnitureId: "decor-fruit-bowl",  x: 380, z: 260, rotation: 0, elevationY: 75 },
        // 沙发 + 电视（朝北，背对院子门）
        { furnitureId: "tvunit-walnut",     x: 350, z: 390, rotation: 0 },
        { furnitureId: "elec-tv-flat",      x: 350, z: 390, rotation: 0, elevationY: 55 },
        { furnitureId: "sofa-fabric-gray",  x: 350, z: 490, rotation: 180 },
        { furnitureId: "plant-monstera",    x: 650, z: 60,  rotation: 0 },
        { furnitureId: "storage-shoe-rack", x: 80,  z: 520, rotation: 0 },
      ],
      kitchen: [
        { furnitureId: "kitchen_cabinet-full",   x: 250, z: 35, rotation: 0 },
        { furnitureId: "appliance-cooktop",      x: 180, z: 35, rotation: 0, elevationY: 85 },
        { furnitureId: "appliance-rice-cooker-2", x: 320, z: 35, rotation: 0, elevationY: 85 },
        { furnitureId: "fridge-single-white",    x: 460, z: 40, rotation: 0 },
      ],
      bedroom: [
        { furnitureId: "bed-wood-nordic",        x: 250, z: 140, rotation: 0 },
        { furnitureId: "nightstand-oak",         x: 110, z: 30,  rotation: 0 },
        { furnitureId: "wardrobe-solid-walnut",  x: 460, z: 60,  rotation: 90 },
        { furnitureId: "plant-sansevieria",      x: 40,  z: 240, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "vehicle.vino",           x: 300, z: 170, rotation: 90 },
        { furnitureId: "chicken",                x: 700, z: 100, rotation: 0 },
        { furnitureId: "chicken",                x: 800, z: 220, rotation: 0 },
        { furnitureId: "plant-tropic-flowers",   x: 1100, z: 80, rotation: 0 },
        { furnitureId: "stone-path",             x: 600, z: 170, rotation: 90 },
      ],
    },
  ],
};

// ── 明代厅堂片场（导演台新增；简版）────────────────────────────────────
// 明式厅堂：正厅（交椅+案居中、圈椅茶几左右对称、中轴线）+ 内室（架子床）
// + 前廊。家具为现有 id 拼搭：案=胡桃长柜、交椅/圈椅=单人扶手椅、架子床=
// 原木床（无床顶架）；不用太师椅（清式）、不用青花/玻璃/电灯。
const MING_HALL_SET: ProjectTemplate = {
  id: "set-ming-hall",
  name: "明代厅堂片场",
  nameEn: "Ming Hall Set",
  emoji: "🏛️",
  description: "片场 · 单层 · 正厅+内室+前廊 · 112㎡ · 明式厅堂 · 拍古装/宅斗戏",
  descriptionEn: "Film set · 1F · Main hall + inner chamber + porch · 112㎡ · Ming hall · Period / family drama",
  areaSqm: 112,
  palette: ["#EDE6D6", "#3A2E22", "#8B3A20"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#EDE6D6",
    windowFrameColor: "#2A2018",
    entranceFrameColor: "#2A2018",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A2E22",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "ming-f1",
      name: "明代厅堂",
      area: 112,
      // 1400×800cm 矩形拼贴（无缺口）：
      // 上排：正厅 900×560 | 内室 500×560
      // 下排：前廊 1400×240（全墙隐藏 = 露天前廊）
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 900, depth: 560,
          name: "正厅", nameEn: "Main Hall", icon: "🏛️",
          doors: [{ wall: "S", pos: 370, len: 160, style: "wood_panel", h: 210 }],
          windows: [
            { wall: "E", pos: 180, len: 200, style: "wooden", h: 150, sill: 90 },
            { wall: "W", pos: 180, len: 200, style: "wooden", h: 150, sill: 90 },
          ],
          wallDecor: [
            { furnitureId: "wall-lamp-lantern", wall: "S", u: 0.3, v: 0.7 },
            { furnitureId: "wall-lamp-lantern", wall: "S", u: 0.7, v: 0.7 },
          ] },
        { room: "master",   x: 900, y: 0,   width: 500, depth: 560,
          name: "内室", nameEn: "Inner Chamber", icon: "🛏️",
          doors: [{ wall: "W", pos: 230, len: 100, style: "wood_panel", h: 200 }] },
        { room: "hallway",  x: 0,   y: 560, width: 1400, depth: 240,
          name: "前廊", nameEn: "Front Porch", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 正厅严格中轴对称（轴线 x=450）：案+主座居北，两对圈椅+两茶几左右对称，
  // 灯笼/狮子/花瓶成对；只用烛台吊灯，不用电灯。
  furnitureOverrides: [
    {
      living: [
        // 案 + 瓶花（北墙正中）
        { furnitureId: "tvunit-walnut",     x: 450, z: 28,  rotation: 0 },
        { furnitureId: "decor-vase-single", x: 380, z: 28,  rotation: 0, elevationY: 55 },
        { furnitureId: "decor-vase-single", x: 520, z: 28,  rotation: 0, elevationY: 55 },
        // 主座交椅（朝南）+ 左右圈椅
        { furnitureId: "sofa-armchair",     x: 450, z: 105, rotation: 0 },
        { furnitureId: "sofa-armchair",     x: 300, z: 105, rotation: 0 },
        { furnitureId: "sofa-armchair",     x: 600, z: 105, rotation: 0 },
        // 茶几 + 茶具（两对圈椅之间）
        { furnitureId: "coffee-oak-round",  x: 300, z: 200, rotation: 0 },
        { furnitureId: "coffee-oak-round",  x: 600, z: 200, rotation: 0 },
        { furnitureId: "decor-tea-set",     x: 300, z: 200, rotation: 0, elevationY: 30 },
        { furnitureId: "decor-tea-set",     x: 600, z: 200, rotation: 0, elevationY: 30 },
        // 第二对圈椅（向心而坐）
        { furnitureId: "sofa-armchair",     x: 300, z: 290, rotation: 90 },
        { furnitureId: "sofa-armchair",     x: 600, z: 290, rotation: 270 },
        // 挂画（北墙）+ 落地花瓶 + 狮子（南门两侧）
        { furnitureId: "artwork-inkwash",   x: 150, z: 6,   rotation: 0 },
        { furnitureId: "artwork-inkwash",   x: 750, z: 6,   rotation: 0 },
        { furnitureId: "decor-vase-royal",  x: 60,  z: 60,  rotation: 0 },
        { furnitureId: "decor-vase-royal",  x: 840, z: 60,  rotation: 0 },
        { furnitureId: "decor-statue-lion", x: 80,  z: 510, rotation: 0 },
        { furnitureId: "decor-statue-lion", x: 820, z: 510, rotation: 0 },
        // 烛台吊灯（吸顶，非电灯具）
        { furnitureId: "lamp-chandelier-antique", x: 450, z: 300, rotation: 0, mountCeiling: true },
      ],
      master: [
        { furnitureId: "bed-wood-nordic",       x: 250, z: 220, rotation: 0 },
        { furnitureId: "nightstand-oak",        x: 100, z: 40,  rotation: 0 },
        { furnitureId: "nightstand-oak",        x: 400, z: 40,  rotation: 0 },
        { furnitureId: "wardrobe-solid-walnut", x: 460, z: 120, rotation: 270 },
        { furnitureId: "plant-sansevieria",     x: 40,  z: 520, rotation: 0 },
        { furnitureId: "artwork-inkwash",       x: 250, z: 6,   rotation: 0 },
      ],
      hallway: [
        { furnitureId: "plant-monstera", x: 200,  z: 120, rotation: 0 },
        { furnitureId: "plant-monstera", x: 1200, z: 120, rotation: 0 },
        { furnitureId: "stone-path",     x: 700,  z: 120, rotation: 90 },
      ],
    },
  ],
};

// ── 清宫三希堂片场（导演台新增；简版）──────────────────────────────────
// 乾隆书房三希堂：书斋（火炕+小紫檀书案+太师椅+自鸣钟）+ 外间 + 藏书间
// + 耳房。真实三希堂仅约 8㎡，为可拍性书斋放大到 420×360（约 15㎡）并加
// 外间走位空间——尺度是折中，不是原样复刻。炕=榻榻米矮床横放缩放，书案=
// 学习桌缩放至 70×31×38，自鸣钟=维多利亚座钟；不用电灯。
const QING_SANXITANG_SET: ProjectTemplate = {
  id: "set-qing-sanxitang",
  name: "清宫三希堂片场",
  nameEn: "Qing Sanxitang Set",
  emoji: "📜",
  description: "片场 · 单层 · 三希堂书斋+外间+藏书间+耳房 · 54㎡ · 小而精的宫廷书房 · 拍清宫/帝王戏",
  descriptionEn: "Film set · 1F · Sanxitang study + antechamber + book room · 54㎡ · Intimate palace study · Qing court drama",
  areaSqm: 54,
  palette: ["#E8DCC8", "#5A2E22", "#C8A882"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8DCC8",
    windowFrameColor: "#5A2E22",
    entranceFrameColor: "#2A2018",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#5A2E22",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "qing-f1",
      name: "清宫三希堂",
      area: 54,
      // 900×600cm 矩形拼贴（无缺口）：
      // 上排：三希堂 420×360 | 外间 480×360
      // 下排：藏书间 420×240 | 耳房 480×240
      rooms: [
        { room: "study",   x: 0,   y: 0,   width: 420, depth: 360,
          name: "三希堂", nameEn: "Sanxitang Study", icon: "📜",
          doors: [{ wall: "S", pos: 170, len: 80, style: "wood_panel", h: 200 }],
          windows: [{ wall: "E", pos: 100, len: 120, style: "wooden", h: 120, sill: 100 }],
          wallDecor: [
            { furnitureId: "wall-lamp-lantern", wall: "S", u: 0.3, v: 0.7 },
            { furnitureId: "wall-lamp-lantern", wall: "S", u: 0.7, v: 0.7 },
          ] },
        { room: "hallway", x: 420, y: 0,   width: 480, depth: 360,
          name: "外间", nameEn: "Antechamber", icon: "🚪",
          doors: [{ wall: "W", pos: 140, len: 80, style: "wood_panel", h: 200 }] },
        { room: "study2",  x: 0,   y: 360, width: 420, depth: 240,
          name: "藏书间", nameEn: "Book Room", icon: "📚" },
        { room: "bedroom", x: 420, y: 360, width: 480, depth: 240,
          name: "耳房", nameEn: "Side Room", icon: "🛏️" },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      study: [
        // 火炕（北墙）：榻榻米矮床横放，scaleW 0.81 → 210×114（长×宽与史实炕同）
        { furnitureId: "bed-tatami",           x: 210, z: 57,  rotation: 90, scaleW: 0.81 },
        // 小紫檀书案（炕前）：学习桌缩至 70×31×38；座钟+茶具在案上
        { furnitureId: "desk-study",           x: 210, z: 200, rotation: 0, scaleW: 0.58, scaleD: 0.52, scaleH: 0.5 },
        { furnitureId: "decor-victorian-clock", x: 195, z: 200, rotation: 0, elevationY: 38 },
        { furnitureId: "decor-tea-set",         x: 230, z: 200, rotation: 0, elevationY: 38 },
        // 太师椅（朝北向案）
        { furnitureId: "sofa-armchair",         x: 210, z: 290, rotation: 180 },
        // 炕上旧书册 + 边柜青花 + 书架 + 挂画
        { furnitureId: "decor-books-vintage",   x: 130, z: 60,  rotation: 0, elevationY: 23 },
        { furnitureId: "sideboard-walnut",      x: 380, z: 50,  rotation: 270 },
        { furnitureId: "decor-vase-kangxi",     x: 380, z: 50,  rotation: 0, elevationY: 85 },
        { furnitureId: "bookshelf-solid-walnut", x: 390, z: 200, rotation: 270 },
        { furnitureId: "artwork-inkwash",       x: 60,  z: 8,   rotation: 0 },
        { furnitureId: "lamp-chandelier-antique", x: 210, z: 180, rotation: 0, mountCeiling: true },
      ],
      hallway: [
        { furnitureId: "sofa-armchair",         x: 120, z: 120, rotation: 90 },
        { furnitureId: "sofa-armchair",         x: 120, z: 240, rotation: 90 },
        { furnitureId: "coffee-oak-round",      x: 240, z: 180, rotation: 0 },
        { furnitureId: "decor-tea-set",         x: 240, z: 180, rotation: 0, elevationY: 30 },
        { furnitureId: "bookshelf-with-books",  x: 440, z: 60,  rotation: 270 },
        { furnitureId: "plant-monstera",        x: 420, z: 300, rotation: 0 },
        { furnitureId: "lamp-chandelier-antique", x: 240, z: 180, rotation: 0, mountCeiling: true },
      ],
      study2: [
        { furnitureId: "bookshelf-with-books",  x: 100, z: 60,  rotation: 0 },
        { furnitureId: "bookshelf-with-books",  x: 300, z: 60,  rotation: 0 },
        { furnitureId: "desk-study",            x: 210, z: 170, rotation: 0 },
        { furnitureId: "decor-books-pile",      x: 210, z: 170, rotation: 0, elevationY: 75 },
        { furnitureId: "plant-sansevieria",     x: 380, z: 200, rotation: 0 },
      ],
      bedroom: [
        { furnitureId: "wardrobe-solid-walnut", x: 80,  z: 60,  rotation: 0 },
        { furnitureId: "sideboard-walnut",      x: 240, z: 50,  rotation: 0 },
        { furnitureId: "decor-vase-single",     x: 240, z: 50,  rotation: 0, elevationY: 85 },
        { furnitureId: "bed-single-white",      x: 350, z: 130, rotation: 0 },
        { furnitureId: "plant-rubber-tree",     x: 440, z: 30,  rotation: 0 },
      ],
    },
  ],
};

// ── 唐宫宴会厅片场（导演台新增；简版）──────────────────────────────────
// 唐代宴饮：宴会厅（长案拼桌+白瓷+金器+低坐茶席）+ 偏厅 + 前廊。高低并
// 存（高桌宴饮 + 低坐茶席），长案=三张学习桌拼合；不用明式圈椅/太师椅、
// 不用青花、不用玻璃窗。
const TANG_PALACE_SET: ProjectTemplate = {
  id: "set-tang-palace",
  name: "唐宫宴会厅片场",
  nameEn: "Tang Palace Set",
  emoji: "🏮",
  description: "片场 · 单层 · 宴会厅+偏厅+前廊 · 126㎡ · 拍唐宫/宴饮/宫廷戏",
  descriptionEn: "Film set · 1F · Banquet hall + side hall + porch · 126㎡ · Tang palace banquet",
  areaSqm: 126,
  palette: ["#E8DCC8", "#3A2A1A", "#C8A882"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8DCC8",
    windowFrameColor: "#3A2A1A",
    entranceFrameColor: "#2A2018",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A2A1A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "tang-f1",
      name: "唐宫宴会厅",
      area: 126,
      // 1400×900cm 矩形拼贴（无缺口）：
      // 上排：宴会厅 900×600 | 偏厅 500×600
      // 下排：前廊 1400×300（全墙隐藏 = 露天前廊）
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 900, depth: 600,
          name: "宴会厅", nameEn: "Banquet Hall", icon: "🏮",
          doors: [{ wall: "S", pos: 350, len: 200, style: "wood_panel", h: 210 }],
          windows: [
            { wall: "E", pos: 180, len: 240, style: "wooden", h: 150, sill: 90 },
            { wall: "W", pos: 180, len: 240, style: "wooden", h: 150, sill: 90 },
          ],
          wallDecor: [
            { furnitureId: "wall-lamp-lantern", wall: "S", u: 0.3, v: 0.7 },
            { furnitureId: "wall-lamp-lantern", wall: "S", u: 0.7, v: 0.7 },
          ] },
        { room: "dining",   x: 900, y: 0,   width: 500, depth: 600,
          name: "偏厅", nameEn: "Side Hall", icon: "🍽️",
          doors: [{ wall: "W", pos: 250, len: 100, style: "wood_panel", h: 200 }] },
        { room: "hallway",  x: 0,   y: 600, width: 1400, depth: 300,
          name: "前廊", nameEn: "Front Porch", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      living: [
        // 长案（三张学习桌拼合）+ 白瓷餐盘 + 金勺
        { furnitureId: "desk-study",            x: 330, z: 200, rotation: 0 },
        { furnitureId: "desk-study",            x: 450, z: 200, rotation: 0 },
        { furnitureId: "desk-study",            x: 570, z: 200, rotation: 0 },
        { furnitureId: "decor-dinnerware-glossy", x: 450, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "decor-spoons-golden",   x: 330, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "decor-spoons-golden",   x: 570, z: 200, rotation: 0, elevationY: 75 },
        // 宴饮座椅（长案两侧）
        { furnitureId: "chair-nordic-oak",      x: 390, z: 140, rotation: 0 },
        { furnitureId: "chair-nordic-oak",      x: 510, z: 140, rotation: 0 },
        { furnitureId: "chair-nordic-oak",      x: 390, z: 260, rotation: 180 },
        { furnitureId: "chair-nordic-oak",      x: 510, z: 260, rotation: 180 },
        // 低坐茶席（高低并存）：矮几 + 两面低坐 + 煎茶具
        { furnitureId: "coffee-oak-round",      x: 450, z: 450, rotation: 0 },
        { furnitureId: "sofa-japanese",         x: 450, z: 370, rotation: 0 },
        { furnitureId: "sofa-japanese",         x: 450, z: 530, rotation: 180 },
        { furnitureId: "decor-tea-set",         x: 450, z: 450, rotation: 0, elevationY: 30 },
        // 挂画 + 落地花瓶 + 烛台吊灯 ×2
        { furnitureId: "artwork-inkwash",       x: 100, z: 6,   rotation: 0 },
        { furnitureId: "artwork-inkwash",       x: 800, z: 6,   rotation: 0 },
        { furnitureId: "decor-vase-royal",      x: 60,  z: 60,  rotation: 0 },
        { furnitureId: "decor-vase-royal",      x: 840, z: 60,  rotation: 0 },
        { furnitureId: "lamp-chandelier-antique", x: 300, z: 300, rotation: 0, mountCeiling: true },
        { furnitureId: "lamp-chandelier-antique", x: 600, z: 300, rotation: 0, mountCeiling: true },
      ],
      dining: [
        { furnitureId: "dining-marble-round",   x: 250, z: 200, rotation: 0 },
        { furnitureId: "decor-fruit-bowl",      x: 250, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "chair-nordic-oak",      x: 250, z: 110, rotation: 0 },
        { furnitureId: "chair-nordic-oak",      x: 250, z: 290, rotation: 180 },
        { furnitureId: "chair-nordic-oak",      x: 160, z: 200, rotation: 90 },
        { furnitureId: "chair-nordic-oak",      x: 340, z: 200, rotation: 270 },
        { furnitureId: "sideboard-walnut",      x: 450, z: 40,  rotation: 270 },
        { furnitureId: "decor-copper-pots",     x: 450, z: 40,  rotation: 0, elevationY: 85 },
        { furnitureId: "plant-rubber-tree",     x: 40,  z: 550, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "plant-monstera", x: 200,  z: 150, rotation: 0 },
        { furnitureId: "plant-monstera", x: 1200, z: 150, rotation: 0 },
        { furnitureId: "stone-path",     x: 700,  z: 150, rotation: 90 },
      ],
    },
  ],
};

// ── 宋代书斋片场（导演台新增；简版）────────────────────────────────────
// 宋式文人书斋：书斋（书案+点茶+三轴挂画+插花）+ 内室 + 庭院。只挂三轴画
// （研究：每室三四轴）；点茶具在案上；不用唐金银、不用明硬木、不用青花。
const SONG_STUDY_SET: ProjectTemplate = {
  id: "set-song-study",
  name: "宋代书斋片场",
  nameEn: "Song Study Set",
  emoji: "📖",
  description: "片场 · 单层 · 书斋+内室+庭院 · 70㎡ · 文人四艺 · 拍宋式文人/书生戏",
  descriptionEn: "Film set · 1F · Study + inner chamber + garden · 70㎡ · Literati study · Song scholar drama",
  areaSqm: 70,
  palette: ["#EDEBE6", "#6B6257", "#8A9A7A"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#EDEBE6",
    windowFrameColor: "#6B6257",
    entranceFrameColor: "#2A2A2A",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#6B6257",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "song-f1",
      name: "宋代书斋",
      area: 70,
      // 1000×700cm 矩形拼贴（无缺口）：
      // 上排：书斋 600×420 | 内室 400×420
      // 下排：庭院 1000×280（全墙隐藏 = 露天庭院）
      rooms: [
        { room: "study",   x: 0,   y: 0,   width: 600, depth: 420,
          name: "书斋", nameEn: "Study", icon: "📖",
          doors: [{ wall: "S", pos: 250, len: 100, style: "wood_panel", h: 200 }],
          windows: [
            { wall: "E", pos: 130, len: 160, style: "wooden", h: 140, sill: 90 },
            { wall: "W", pos: 130, len: 160, style: "wooden", h: 140, sill: 90 },
          ],
          wallDecor: [{ furnitureId: "mural-inkwash", wall: "S", u: 0.5, v: 0.55 }] },
        { room: "master",  x: 600, y: 0,   width: 400, depth: 420,
          name: "内室", nameEn: "Inner Chamber", icon: "🛏️",
          doors: [{ wall: "W", pos: 160, len: 90, style: "wood_panel", h: 200 }] },
        { room: "hallway", x: 0,   y: 420, width: 1000, depth: 280,
          name: "庭院", nameEn: "Garden", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      study: [
        // 书案 + 点茶 + 旧书册
        { furnitureId: "desk-study",            x: 300, z: 100, rotation: 0 },
        { furnitureId: "chair-nordic-oak",      x: 300, z: 190, rotation: 180 },
        { furnitureId: "decor-tea-set",         x: 270, z: 100, rotation: 0, elevationY: 75 },
        { furnitureId: "decor-books-vintage",   x: 330, z: 100, rotation: 0, elevationY: 75 },
        // 书架（东西墙）+ 三轴挂画（北墙，仅三轴）
        { furnitureId: "bookshelf-solid-walnut", x: 40,  z: 60,  rotation: 90 },
        { furnitureId: "bookshelf-solid-walnut", x: 560, z: 60,  rotation: 270 },
        { furnitureId: "artwork-inkwash",       x: 150, z: 6,   rotation: 0 },
        { furnitureId: "artwork-inkwash",       x: 300, z: 6,   rotation: 0 },
        { furnitureId: "artwork-inkwash",       x: 450, z: 6,   rotation: 0 },
        // 插花（圆几花架 + 花瓶）+ 烛台吊灯
        { furnitureId: "sideboard-round-stand", x: 520, z: 350, rotation: 0 },
        { furnitureId: "decor-vase-single",     x: 520, z: 350, rotation: 0, elevationY: 75 },
        { furnitureId: "plant-sansevieria",     x: 60,  z: 380, rotation: 0 },
        { furnitureId: "lamp-chandelier-antique", x: 300, z: 210, rotation: 0, mountCeiling: true },
      ],
      master: [
        { furnitureId: "bed-wood-nordic",       x: 200, z: 180, rotation: 0 },
        { furnitureId: "nightstand-oak",        x: 80,  z: 40,  rotation: 0 },
        { furnitureId: "nightstand-oak",        x: 320, z: 40,  rotation: 0 },
        { furnitureId: "wardrobe-solid-walnut", x: 360, z: 120, rotation: 270 },
        { furnitureId: "plant-sansevieria",     x: 40,  z: 380, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "plant-monstera",        x: 150, z: 140, rotation: 0 },
        { furnitureId: "plant-tropic-flowers",  x: 850, z: 140, rotation: 0 },
        { furnitureId: "stone-path",            x: 500, z: 140, rotation: 90 },
      ],
    },
  ],
};

// ── 民国石库门片场（导演台新增；简版）──────────────────────────────────
// 1930 年代上海石库门：客堂间（八仙桌+西式沙发+留声机+收音机+梳妆台）+
// 天井 + 亭子间（作家小间：书桌+钢笔+古董相机+单人床）+ 灶间 + 卧房 +
// 后天井。海派=中式硬木+西式舒适；不用冰箱/电视（1950 年代后才有）、
// 不用空调、不用现代办公椅。
const SHIKUMEN_SET: ProjectTemplate = {
  id: "set-shikumen",
  name: "民国石库门片场",
  nameEn: "Shikumen Set",
  emoji: "🏠",
  description: "片场 · 单层 · 客堂间+亭子间+灶间+卧房+前后天井 · 80㎡ · 拍民国上海/海派戏",
  descriptionEn: "Film set · 1F · Main room + mezzanine + kitchen + bedroom + lightwells · 80㎡ · Republican Shanghai",
  areaSqm: 80,
  palette: ["#9A938A", "#2A2A2A", "#8B3A20"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#9A938A",
    windowFrameColor: "#2A2A2A",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A3A3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "shikumen-f1",
      name: "民国石库门",
      area: 80,
      // 1000×800cm 矩形拼贴（无缺口）：
      // 上排：客堂间 600×440 | 亭子间 400×280 + 灶间 400×160
      // 中排：天井 600×160 | 卧房 400×360（卧房跨中下两排）
      // 下排：后天井 600×200 | 卧房 400×360
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 600, depth: 440,
          name: "客堂间", nameEn: "Main Room", icon: "🏠",
          doors: [{ wall: "S", pos: 240, len: 120, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 200, len: 200, style: "wooden", h: 140, sill: 90 }] },
        { room: "study2",  x: 600, y: 0,   width: 400, depth: 280,
          name: "亭子间", nameEn: "Mezzanine Room", icon: "✒️",
          doors: [{ wall: "S", pos: 150, len: 80, style: "wood_panel", h: 190 }] },
        { room: "kitchen", x: 600, y: 280, width: 400, depth: 160,
          name: "灶间", nameEn: "Kitchen", icon: "🍳", exteriorStyle: "concrete" },
        { room: "hallway", x: 0,   y: 440, width: 600, depth: 160,
          name: "天井", nameEn: "Lightwell", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
        { room: "master",  x: 600, y: 440, width: 400, depth: 360,
          name: "卧房", nameEn: "Bedroom", icon: "🛏️",
          doors: [{ wall: "W", pos: 60, len: 90, style: "wood_panel", h: 200 }] },
        { room: "custom1", x: 0,   y: 600, width: 600, depth: 200,
          name: "后天井", nameEn: "Rear Lightwell", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 客堂间：八仙桌（150cm 圆桌代）+ 西式皮沙发 + 留声机（大理石几上）+
  // 收音机（酒柜上，横放）+ 梳妆台与座钟；亭子间：书桌+钢笔+古董相机+
  // 单人床+做旧台灯。灶间无冰箱（时代锁）。
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "dining-oak-rect",       x: 300, z: 150, rotation: 0 },
        { furnitureId: "chair-nordic-oak",      x: 300, z: 50,  rotation: 0 },
        { furnitureId: "chair-nordic-oak",      x: 300, z: 250, rotation: 180 },
        { furnitureId: "chair-nordic-oak",      x: 200, z: 150, rotation: 90 },
        { furnitureId: "chair-nordic-oak",      x: 400, z: 150, rotation: 270 },
        { furnitureId: "sofa-leather-brown",    x: 300, z: 360, rotation: 180 },
        // 留声机（大理石茶几当留声机柜）
        { furnitureId: "coffee-marble-rect",    x: 80,  z: 80,  rotation: 0 },
        { furnitureId: "decor-gramophone",      x: 80,  z: 80,  rotation: 0, elevationY: 45 },
        // 收音机（酒柜上，横放才放得下）
        { furnitureId: "sideboard-wine",        x: 560, z: 80,  rotation: 270 },
        { furnitureId: "decor-radio-vintage",   x: 560, z: 80,  rotation: 90, elevationY: 103 },
        // 玻璃镜梳妆台 + 座钟
        { furnitureId: "dresser-nordic-white",  x: 520, z: 400, rotation: 180 },
        { furnitureId: "decor-victorian-clock", x: 520, z: 400, rotation: 0, elevationY: 54 },
        // 中西挂画各一（海派）
        { furnitureId: "artwork-impression",    x: 150, z: 6,   rotation: 0 },
        { furnitureId: "artwork-inkwash",       x: 450, z: 6,   rotation: 0 },
      ],
      hallway: [
        { furnitureId: "plant-tropic-flowers",  x: 100, z: 80,  rotation: 0 },
        { furnitureId: "stone-path",            x: 300, z: 80,  rotation: 90 },
      ],
      study2: [
        { furnitureId: "desk-study",            x: 200, z: 100, rotation: 0 },
        { furnitureId: "chair-nordic-oak",      x: 200, z: 180, rotation: 180 },
        { furnitureId: "decor-pen",             x: 170, z: 100, rotation: 0, elevationY: 75 },
        { furnitureId: "decor-camera-exakta",   x: 205, z: 100, rotation: 0, elevationY: 75 },
        { furnitureId: "decor-book-single",     x: 235, z: 100, rotation: 0, elevationY: 75 },
        { furnitureId: "bed-single-white",      x: 320, z: 190, rotation: 0 },
        { furnitureId: "nightstand-oak",        x: 220, z: 255, rotation: 0 },
        { furnitureId: "lamp-table-rust",       x: 220, z: 255, rotation: 0, elevationY: 60 },
      ],
      kitchen: [
        { furnitureId: "cabinet-lower-gray",    x: 200, z: 35,  rotation: 0 },
        { furnitureId: "appliance-cooktop",     x: 150, z: 35,  rotation: 0, elevationY: 85 },
        { furnitureId: "appliance-rice-cooker-2", x: 250, z: 35, rotation: 0, elevationY: 85 },
      ],
      master: [
        { furnitureId: "bed-fabric-beige",      x: 200, z: 180, rotation: 0 },
        { furnitureId: "nightstand-oak",        x: 80,  z: 40,  rotation: 0 },
        { furnitureId: "nightstand-oak",        x: 320, z: 40,  rotation: 0 },
        { furnitureId: "wardrobe-solid-walnut", x: 360, z: 120, rotation: 270 },
        { furnitureId: "plant-sansevieria",     x: 40,  z: 320, rotation: 0 },
      ],
      custom1: [
        { furnitureId: "plant-tropic-flowers",  x: 100, z: 100, rotation: 0 },
        { furnitureId: "stone-path",            x: 300, z: 100, rotation: 90 },
      ],
    },
  ],
};

// ── 近郊别墅片场（导演台新增；简版）────────────────────────────────────
// 200–600㎡ 近郊大宅：挑高客厅（4–6m，以标准层高呈现，引擎无挑高参数）+
// 茶室（博古架）+ 中+西双厨房 + 二层主卧/书房 + 影音/健身/酒窖。
// 妥协说明：引擎没有地下层，影音/健身/酒窖放在二层呈现（不是真的地下室）；
// 家具全部按别墅尺度（大沙发/大圆桌/300cm 橱柜），不用公寓小家具。
const VILLA_SUBURBAN_SET: ProjectTemplate = {
  id: "set-villa-suburban",
  name: "近郊别墅片场",
  nameEn: "Suburban Villa Set",
  emoji: "🏡",
  description: "片场 · 两层 · 挑高客厅+茶室+双厨房+影音健身酒窖 · 480㎡ · 拍别墅/豪门戏",
  descriptionEn: "Film set · 2F · Double-height living + tea room + dual kitchens + cinema/gym/cellar · 480㎡ · Villa / family saga",
  areaSqm: 480,
  palette: ["#F5F2EC", "#2A2A2A", "#8A6040"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 2,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#F5F2EC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#2A2A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "villa-f1",
      name: "近郊别墅首层",
      area: 240,
      // 2000×1200cm 矩形拼贴（无缺口）：
      // 上排：客厅 900×700 | 餐厅 550×700 | 中厨 550×700
      // 下排：茶室 800×500 | 西厨 600×500 | 玄关 600×500
      rooms: [
        { room: "living",   x: 0,    y: 0,   width: 900, depth: 700,
          name: "客厅", nameEn: "Living Room", icon: "🛋️",
          doors: [{ wall: "S", pos: 370, len: 160, style: "wood_panel", h: 210 }],
          windows: [{ wall: "E", pos: 200, len: 240, style: "wooden", h: 150, sill: 90 }] },
        { room: "dining",   x: 900,  y: 0,   width: 550, depth: 700,
          name: "餐厅", nameEn: "Dining Room", icon: "🍽️",
          doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
        { room: "kitchen",  x: 1450, y: 0,   width: 550, depth: 700,
          name: "中厨", nameEn: "Chinese Kitchen", icon: "🍳", exteriorStyle: "concrete" },
        { room: "study",    x: 0,    y: 700, width: 800, depth: 500,
          name: "茶室", nameEn: "Tea Room", icon: "🍵",
          doors: [{ wall: "S", pos: 350, len: 100, style: "wood_panel", h: 200 }] },
        { room: "custom2", x: 800,  y: 700, width: 600, depth: 500,
          name: "西厨", nameEn: "Western Kitchen", icon: "🍳", exteriorStyle: "concrete" },
        { room: "hallway",  x: 1400, y: 700, width: 600, depth: 500,
          name: "玄关", nameEn: "Entry", icon: "🚪" },
      ],
    },
    {
      id: "villa-f2",
      name: "近郊别墅二层",
      area: 240,
      // 2000×1200cm 矩形拼贴（无缺口）：
      // 上排：主卧 900×700 | 次卧 550×700 | 书房 550×700
      // 下排：影音室 700×500 | 健身房 650×500 | 酒窖 650×500
      rooms: [
        { room: "master",   x: 0,    y: 0,   width: 900, depth: 700,
          name: "主卧", nameEn: "Master Bedroom", icon: "🛏️",
          doors: [{ wall: "S", pos: 370, len: 120, style: "wood_panel", h: 210 }] },
        { room: "bedroom",  x: 900,  y: 0,   width: 550, depth: 700,
          name: "次卧", nameEn: "Bedroom", icon: "🛏️",
          doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
        { room: "study2",   x: 1450, y: 0,   width: 550, depth: 700,
          name: "书房", nameEn: "Study", icon: "📖",
          doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
        { room: "cinema",   x: 0,    y: 700, width: 700, depth: 500,
          name: "影音室", nameEn: "Cinema Room", icon: "🎬",
          doors: [{ wall: "S", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
        { room: "gym",      x: 700,  y: 700, width: 650, depth: 500,
          name: "健身房", nameEn: "Gym", icon: "🏋️",
          doors: [{ wall: "S", pos: 280, len: 100, style: "wood_panel", h: 200 }] },
        { room: "custom1",  x: 1350, y: 700, width: 650, depth: 500,
          name: "酒窖", nameEn: "Wine Cellar", icon: "🍷",
          doors: [{ wall: "S", pos: 280, len: 100, style: "wood_panel", h: 200 }] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      living: [
        { furnitureId: "tvunit-float-white",  x: 450, z: 25,  rotation: 0 },
        { furnitureId: "elec-tv-flat",        x: 450, z: 25,  rotation: 0, elevationY: 55 },
        { furnitureId: "sofa-modular-green",  x: 450, z: 470, rotation: 180 },
        { furnitureId: "coffee-marble-rect",  x: 450, z: 300, rotation: 0 },
        { furnitureId: "rug-nordic-geo",      x: 450, z: 330, rotation: 0 },
        { furnitureId: "lamp-arc-gold",       x: 80,  z: 620, rotation: 0 },
        { furnitureId: "plant-monstera",      x: 850, z: 650, rotation: 0 },
      ],
      dining: [
        { furnitureId: "dining-marble-round", x: 275, z: 300, rotation: 0 },
        { furnitureId: "decor-fruit-bowl",    x: 275, z: 300, rotation: 0, elevationY: 75 },
        { furnitureId: "chair-nordic-oak",    x: 275, z: 190, rotation: 0 },
        { furnitureId: "chair-nordic-oak",    x: 275, z: 410, rotation: 180 },
        { furnitureId: "chair-nordic-oak",    x: 165, z: 300, rotation: 90 },
        { furnitureId: "chair-nordic-oak",    x: 385, z: 300, rotation: 270 },
      ],
      kitchen: [
        { furnitureId: "kitchen_cabinet-full",    x: 275, z: 35, rotation: 0 },
        { furnitureId: "appliance-cooktop",       x: 200, z: 35, rotation: 0, elevationY: 85 },
        { furnitureId: "appliance-rice-cooker-2", x: 350, z: 35, rotation: 0, elevationY: 85 },
        { furnitureId: "fridge-single-white",     x: 500, z: 40, rotation: 0 },
      ],
      study: [
        // 茶室：博古架（北墙）+ 茶桌 + 木凳
        { furnitureId: "proc-bogujia",        x: 400, z: 25,  rotation: 0 },
        { furnitureId: "coffee-oak-round",    x: 400, z: 300, rotation: 0 },
        { furnitureId: "decor-tea-set",       x: 400, z: 300, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-wood-stool",     x: 280, z: 300, rotation: 0 },
        { furnitureId: "proc-wood-stool",     x: 520, z: 300, rotation: 0 },
        { furnitureId: "proc-wood-stool",     x: 400, z: 200, rotation: 180 },
        { furnitureId: "plant-sansevieria",   x: 60,  z: 450, rotation: 0 },
      ],
      custom2: [
        { furnitureId: "cabinet-lower-gray",        x: 300, z: 35, rotation: 0 },
        { furnitureId: "appliance-cooktop",         x: 220, z: 35, rotation: 0, elevationY: 85 },
        { furnitureId: "appliance-oven-electrolux", x: 420, z: 35, rotation: 0, elevationY: 85 },
        { furnitureId: "fridge-single-white",       x: 560, z: 40, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "storage-shoe-rack",  x: 300, z: 30,  rotation: 0 },
        { furnitureId: "plant-rubber-tree",  x: 550, z: 450, rotation: 0 },
      ],
    },
    {
      master: [
        { furnitureId: "bed-fabric-beige",       x: 450, z: 350, rotation: 0 },
        { furnitureId: "nightstand-oak",         x: 150, z: 40,  rotation: 0 },
        { furnitureId: "nightstand-oak",         x: 750, z: 40,  rotation: 0 },
        { furnitureId: "wardrobe-solid-walnut",  x: 860, z: 150, rotation: 270 },
        { furnitureId: "plant-sansevieria",      x: 60,  z: 650, rotation: 0 },
      ],
      bedroom: [
        { furnitureId: "bed-single-white",       x: 275, z: 350, rotation: 0 },
        { furnitureId: "nightstand-oak",         x: 100, z: 40,  rotation: 0 },
        { furnitureId: "wardrobe-solid-walnut",  x: 510, z: 150, rotation: 270 },
      ],
      study2: [
        { furnitureId: "desk-study",            x: 275, z: 150, rotation: 0 },
        { furnitureId: "chair-nordic-oak",      x: 275, z: 230, rotation: 180 },
        { furnitureId: "bookshelf-solid-walnut", x: 60, z: 60,  rotation: 90 },
        { furnitureId: "decor-books-vintage",   x: 275, z: 150, rotation: 0, elevationY: 75 },
      ],
      cinema: [
        { furnitureId: "tvunit-walnut",    x: 350, z: 30,  rotation: 0 },
        { furnitureId: "elec-tv-flat",     x: 350, z: 30,  rotation: 0, elevationY: 55 },
        { furnitureId: "sofa-nordic-blue", x: 350, z: 350, rotation: 180 },
        { furnitureId: "elec-speaker",     x: 100, z: 60,  rotation: 0 },
        { furnitureId: "elec-speaker",     x: 600, z: 60,  rotation: 0 },
      ],
      gym: [
        { furnitureId: "decor-treadmill",  x: 325, z: 200, rotation: 0 },
        { furnitureId: "rug-modern-gray",  x: 325, z: 400, rotation: 0 },
      ],
      custom1: [
        { furnitureId: "sideboard-wine",   x: 325, z: 40,  rotation: 0 },
        { furnitureId: "sideboard-wine",   x: 325, z: 460, rotation: 180 },
        { furnitureId: "coffee-oak-round", x: 325, z: 250, rotation: 0 },
        { furnitureId: "proc-wood-stool",  x: 225, z: 250, rotation: 0 },
        { furnitureId: "proc-wood-stool",  x: 425, z: 250, rotation: 0 },
      ],
    },
  ],
};

// ── 学校教室片场（导演台新增；简版）────────────────────────────────────
// 传统黑板教室：课桌椅成排面向黑板、前后黑板、讲台、后角扫帚。尺寸说明：
// 教室尺寸来自一篇学生作文，不是国家标准——本模板所有尺寸均为近似值。
const SCHOOL_SET: ProjectTemplate = {
  id: "set-school",
  name: "学校教室片场",
  nameEn: "School Classroom Set",
  emoji: "🏫",
  description: "片场 · 单层 · 教室+教师办公室+走廊 · 180㎡ · 传统黑板教室 · 拍校园/青春戏",
  descriptionEn: "Film set · 1F · Classroom + teachers' office + corridor · 180㎡ · Traditional blackboard classroom",
  areaSqm: 180,
  palette: ["#F2F0EA", "#3A5A3A", "#C8A860"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#F2F0EA",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A5A3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "school-f1",
      name: "学校教室",
      area: 180,
      // 1800×1000cm 矩形拼贴（无缺口；尺寸为近似值，非国家标准）：
      // 上排：教室 1200×700 | 教师办公室 600×700
      // 下排：走廊 1800×300（全墙隐藏 = 露天走廊）
      rooms: [
        { room: "study",   x: 0,    y: 0,   width: 1200, depth: 700,
          name: "教室", nameEn: "Classroom", icon: "🏫",
          doors: [{ wall: "S", pos: 550, len: 100, style: "wood_panel", h: 200 }],
          windows: [
            { wall: "E", pos: 200, len: 240, style: "wooden", h: 150, sill: 90 },
            { wall: "W", pos: 200, len: 240, style: "wooden", h: 150, sill: 90 },
          ] },
        { room: "study2",  x: 1200, y: 0,   width: 600, depth: 700,
          name: "教师办公室", nameEn: "Teachers' Office", icon: "📖",
          doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
        { room: "hallway", x: 0,    y: 700, width: 1800, depth: 300,
          name: "走廊", nameEn: "Corridor", icon: "🚪", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 课桌椅 3×3 成排面向北墙前黑板（rotation 180 朝北）；讲台桌在前；
  // 后黑板在南墙（rotation 180）；扫帚在后角。标语/课程表无对应 3D 件，未做。
  furnitureOverrides: [
    {
      study: [
        { furnitureId: "proc-blackboard",   x: 600, z: 8,   rotation: 0, elevationY: 90 },
        { furnitureId: "desk-study",        x: 600, z: 120, rotation: 0 },
        { furnitureId: "decor-books-pile",  x: 600, z: 120, rotation: 0, elevationY: 75 },
        { furnitureId: "chair-nordic-oak",  x: 600, z: 200, rotation: 0 },
        { furnitureId: "proc-school-desk",  x: 250, z: 300, rotation: 180 },
        { furnitureId: "proc-school-desk",  x: 600, z: 300, rotation: 180 },
        { furnitureId: "proc-school-desk",  x: 950, z: 300, rotation: 180 },
        { furnitureId: "proc-school-desk",  x: 250, z: 430, rotation: 180 },
        { furnitureId: "proc-school-desk",  x: 600, z: 430, rotation: 180 },
        { furnitureId: "proc-school-desk",  x: 950, z: 430, rotation: 180 },
        { furnitureId: "proc-school-desk",  x: 250, z: 560, rotation: 180 },
        { furnitureId: "proc-school-desk",  x: 600, z: 560, rotation: 180 },
        { furnitureId: "proc-school-desk",  x: 950, z: 560, rotation: 180 },
        { furnitureId: "proc-blackboard",   x: 600, z: 692, rotation: 180, elevationY: 90 },
        { furnitureId: "proc-school-broom", x: 1150, z: 650, rotation: 0 },
        { furnitureId: "proc-school-broom", x: 1100, z: 650, rotation: 0 },
      ],
      study2: [
        { furnitureId: "desk-study",           x: 300, z: 150, rotation: 0 },
        { furnitureId: "chair-nordic-oak",     x: 300, z: 230, rotation: 180 },
        { furnitureId: "bookshelf-with-books", x: 560, z: 60,  rotation: 270 },
        { furnitureId: "plant-sansevieria",    x: 40,  z: 650, rotation: 0 },
      ],
      hallway: [],
    },
  ],
};

// ── 医院病房片场（导演台新增；简版）────────────────────────────────────
// 现代中国病房：2–3 张床一间是常态（不是美式单人豪华间）；床头设备带 +
// 呼叫按钮；陪护文化：床边折叠陪护椅、床头柜上脸盆/保温壶。
const HOSPITAL_SET: ProjectTemplate = {
  id: "set-hospital",
  name: "医院病房片场",
  nameEn: "Hospital Ward Set",
  emoji: "🏥",
  description: "片场 · 单层 · 三床病房+护士站+卫生间+走廊 · 130㎡ · 拍医院/陪护戏",
  descriptionEn: "Film set · 1F · 3-bed ward + nurses' station + bathroom + corridor · 130㎡ · Hospital / bedside vigil",
  areaSqm: 130,
  palette: ["#F2F5F2", "#5A7A8A", "#C8D8E0"],
  styleTemplateId: "modern-villa",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#F2F5F2",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#5A7A8A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "hospital-f1",
      name: "医院病房",
      area: 130,
      // 1300×1000cm 矩形拼贴（无缺口）：
      // 上排：病房 800×650 | 护士站 500×650
      // 下排：卫生间 400×350 | 走廊 900×350
      rooms: [
        { room: "master",   x: 0,   y: 0,   width: 800, depth: 650,
          name: "病房", nameEn: "Ward", icon: "🏥",
          doors: [{ wall: "S", pos: 350, len: 120, style: "wood_panel", h: 210 }],
          windows: [{ wall: "E", pos: 200, len: 200, style: "wooden", h: 140, sill: 100 }] },
        { room: "study2",   x: 800, y: 0,   width: 500, depth: 650,
          name: "护士站", nameEn: "Nurses' Station", icon: "💉",
          doors: [{ wall: "W", pos: 280, len: 100, style: "wood_panel", h: 200 }] },
        { room: "bathroom", x: 0,   y: 650, width: 400, depth: 350,
          name: "卫生间", nameEn: "Bathroom", icon: "🚿", exteriorStyle: "concrete" },
        { room: "hallway",  x: 400, y: 650, width: 900, depth: 350,
          name: "走廊", nameEn: "Corridor", icon: "🚪" },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      master: [
        // 三张病床沿北墙 + 床头设备带（北墙，离地 120cm）+ 输液架
        { furnitureId: "proc-med-strip",    x: 140, z: 6,   rotation: 0, elevationY: 120 },
        { furnitureId: "proc-med-strip",    x: 400, z: 6,   rotation: 0, elevationY: 120 },
        { furnitureId: "proc-med-strip",    x: 660, z: 6,   rotation: 0, elevationY: 120 },
        { furnitureId: "proc-hospital-bed", x: 140, z: 80,  rotation: 0 },
        { furnitureId: "proc-hospital-bed", x: 400, z: 80,  rotation: 0 },
        { furnitureId: "proc-hospital-bed", x: 660, z: 80,  rotation: 0 },
        { furnitureId: "proc-iv-stand",     x: 60,  z: 60,  rotation: 0 },
        { furnitureId: "proc-iv-stand",     x: 320, z: 60,  rotation: 0 },
        { furnitureId: "proc-iv-stand",     x: 580, z: 60,  rotation: 0 },
        // 床间柜 + 柜上脸盆/保温壶（陪护物品）
        { furnitureId: "nightstand-oak",    x: 270, z: 60,  rotation: 0 },
        { furnitureId: "nightstand-oak",    x: 530, z: 60,  rotation: 0 },
        { furnitureId: "proc-thermos",      x: 270, z: 60,  rotation: 0, elevationY: 60 },
        { furnitureId: "proc-basin",        x: 530, z: 60,  rotation: 0, elevationY: 60 },
        // 陪护折叠椅（床尾，夜间展开）
        { furnitureId: "proc-camp-chair",   x: 140, z: 300, rotation: 0 },
        { furnitureId: "proc-camp-chair",   x: 400, z: 300, rotation: 0 },
        { furnitureId: "proc-camp-chair",   x: 660, z: 300, rotation: 0 },
      ],
      study2: [
        { furnitureId: "desk-study",           x: 250, z: 150, rotation: 0 },
        { furnitureId: "chair-nordic-oak",     x: 250, z: 230, rotation: 180 },
        { furnitureId: "bookshelf-with-books", x: 460, z: 60,  rotation: 270 },
        { furnitureId: "plant-sansevieria",    x: 40,  z: 600, rotation: 0 },
      ],
      bathroom: [
        { furnitureId: "toilet-standard",       x: 120, z: 120, rotation: 0 },
        { furnitureId: "vanity-single-white",   x: 300, z: 60,  rotation: 0 },
        { furnitureId: "shower-enclosed",      x: 320, z: 280, rotation: 0 },
      ],
      hallway: [],
    },
  ],
};

// ── 秦汉片场（导演台新增；简版）────────────────────────────────────────
// 据汉代反推（秦代室内直接证据几乎为零）：无椅凳高桌，席 + 低榻（足
// 17–19cm）+ 几 + 案（12–14cm）；黑+朱红漆器、青铜、博山炉；分餐制，
// 席位=等级。阿房宫未建成、未被烧毁，只剩夯土台基——本场景不建阿房宫。
const QINHAN_SET: ProjectTemplate = {
  id: "set-qinhan",
  name: "秦汉片场",
  nameEn: "Qin/Han Set",
  emoji: "🏺",
  description: "片场 · 单层 · 正厅+内室+前廊 · 150㎡ · 据汉代反推 · 席地分餐 · 拍秦汉戏",
  descriptionEn: "Film set · 1F · Main hall + inner chamber + porch · 150㎡ · Inferred from Han · Floor seating, separate dining",
  areaSqm: 150,
  palette: ["#8A4A30", "#2A1A12", "#8B2010"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#8A4A30",
    windowFrameColor: "#2A2018",
    entranceFrameColor: "#2A2018",
    roofOverhang: 1.0,
    parapetHeight: 0,
    roofColor: "#2A1A12",
    roofSlabColor: "#2A1A12",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "qinhan-f1",
      name: "秦汉厅堂",
      area: 150,
      // 1500×1000cm 矩形拼贴（无缺口）：
      // 上排：正厅 900×650 | 内室 600×650
      // 下排：前廊 1500×350（全墙隐藏 = 露天前廊）
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 900, depth: 650,
          name: "正厅", nameEn: "Main Hall", icon: "🏺",
          doors: [{ wall: "S", pos: 370, len: 160, style: "wood_panel", h: 210 }],
          windows: [
            { wall: "E", pos: 200, len: 200, style: "wooden", h: 150, sill: 90 },
            { wall: "W", pos: 200, len: 200, style: "wooden", h: 150, sill: 90 },
          ],
          // REDESIGN-C: 北墙水墨为权宜（汉代应为彩绘人物壁画，屏风/席暂无模型）
          wallDecor: [{ furnitureId: "mural-inkwash", wall: "N", u: 0.5, v: 0.55 }] },
        { room: "master",   x: 900, y: 0,   width: 600, depth: 650,
          name: "内室", nameEn: "Inner Chamber", icon: "🛏️",
          doors: [{ wall: "W", pos: 280, len: 100, style: "wood_panel", h: 200 }] },
        { room: "hallway",  x: 0,   y: 650, width: 1500, depth: 350,
          name: "前廊", nameEn: "Front Porch", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 分餐：一人一案一榻。主人北座居中，宾客南排四席（席位=等级）；漆碗在案上
  // （案高 13cm，elevationY 13）；博山炉在矮几上。无椅/凳/高桌，无青花/玻璃。
  // REDESIGN-C：北欧地毯已撤（现代）；主人席加凭几 + 博山炉成视觉锚，两侧与
  // 后角矮几 + 铜器框住尊位；每案两只漆碗成套；前廊竹丛代现代盆栽。
  furnitureOverrides: [
    {
      living: [
        // 主人席（北）：榻 + 案 + 漆碗；背后凭几 + 博山炉
        { furnitureId: "proc-han-ta",        x: 450, z: 110, rotation: 0 },
        { furnitureId: "proc-han-an",        x: 450, z: 210, rotation: 0 },
        { furnitureId: "proc-lacquer-bowl",  x: 450, z: 210, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-han-ji",        x: 450, z: 35,  rotation: 0 },
        { furnitureId: "proc-boshanlu",      x: 450, z: 35,  rotation: 0, elevationY: 25 },
        // 宾客四席（南排，面向北）
        { furnitureId: "proc-han-an",        x: 150, z: 400, rotation: 0 },
        { furnitureId: "proc-han-an",        x: 350, z: 400, rotation: 0 },
        { furnitureId: "proc-han-an",        x: 550, z: 400, rotation: 0 },
        { furnitureId: "proc-han-an",        x: 750, z: 400, rotation: 0 },
        { furnitureId: "proc-han-ta",        x: 150, z: 500, rotation: 0 },
        { furnitureId: "proc-han-ta",        x: 350, z: 500, rotation: 0 },
        { furnitureId: "proc-han-ta",        x: 550, z: 500, rotation: 0 },
        { furnitureId: "proc-han-ta",        x: 750, z: 500, rotation: 0 },
        { furnitureId: "proc-lacquer-bowl",  x: 150, z: 400, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-lacquer-bowl",  x: 350, z: 400, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-lacquer-bowl",  x: 550, z: 400, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-lacquer-bowl",  x: 750, z: 400, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-lacquer-bowl",  x: 185, z: 400, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-lacquer-bowl",  x: 385, z: 400, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-lacquer-bowl",  x: 585, z: 400, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-lacquer-bowl",  x: 785, z: 400, rotation: 0, elevationY: 13 },
        // 博山炉（矮几上，厅中）+ 青铜器（矮几上，东西两侧框住主人席）
        { furnitureId: "proc-han-ji",        x: 450, z: 300, rotation: 0 },
        { furnitureId: "proc-boshanlu",      x: 450, z: 300, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-han-ji",        x: 850, z: 120, rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 850, z: 120, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-han-ji",        x: 50,  z: 120, rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 50,  z: 120, rotation: 0, elevationY: 25 },
        // 后角前景物（进门视线可越过的矮几 + 铜器）
        { furnitureId: "proc-han-ji",        x: 55,  z: 40,  rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 55,  z: 40,  rotation: 0, elevationY: 25 },
        { furnitureId: "proc-han-ji",        x: 845, z: 40,  rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 845, z: 40,  rotation: 0, elevationY: 25 },
      ],
      master: [
        { furnitureId: "proc-han-ta",        x: 300, z: 220, rotation: 0 },
        { furnitureId: "proc-han-ji",        x: 300, z: 380, rotation: 0 },
        { furnitureId: "proc-lacquer-bowl",  x: 285, z: 380, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-boshanlu",      x: 318, z: 380, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-han-an",        x: 300, z: 100, rotation: 0 },
        { furnitureId: "proc-lacquer-bowl",  x: 300, z: 100, rotation: 0, elevationY: 13 },
        // REDESIGN-C-BRIEF: 卧房补到 10 件——西墙木箱 + 箱上漆碗、东侧矮几 + 博山炉
        { furnitureId: "proc-wood-chest",    x: 100, z: 500, rotation: 0 },
        { furnitureId: "proc-lacquer-bowl",  x: 100, z: 500, rotation: 0, elevationY: 60 },
        { furnitureId: "proc-han-ji",        x: 500, z: 500, rotation: 0 },
        { furnitureId: "proc-boshanlu",      x: 500, z: 500, rotation: 0, elevationY: 25 },
      ],
      hallway: [
        { furnitureId: "stone-path",         x: 750, z: 175, rotation: 90 },
        { furnitureId: "proc-bamboo-clump",  x: 150, z: 175, rotation: 0 },
        { furnitureId: "proc-bamboo-clump",  x: 1350, z: 175, rotation: 0 },
        // REDESIGN-C-BRIEF: 前廊添两块庭石（石板路外侧，不挡路）
        { furnitureId: "proc-rock",          x: 400, z: 175, rotation: 0 },
        { furnitureId: "proc-rock",          x: 1100, z: 175, rotation: 0 },
      ],
    },
  ],
};

// ── 魏晋南北朝片场（导演台新增；简版）──────────────────────────────────
// 过渡期：床比秦汉高（近半腿高）、胡床进文人书斋、方圆凳出现，但不摆满
// 明式高家具；越窑青瓷、铜佛像、清谈文化；正式场合仍席地而坐。平民室内
// 几乎没有可靠图像——本场景为士大夫书斋的有根据复原。
const WEIJIN_SET: ProjectTemplate = {
  id: "set-weijin",
  name: "魏晋南北朝片场",
  nameEn: "Wei-Jin Set",
  emoji: "🧘",
  description: "片场 · 单层 · 书斋+清谈室+庭院 · 110㎡ · 胡床/青瓷/清谈 · 拍魏晋风度戏",
  descriptionEn: "Film set · 1F · Study + discussion room + garden · 110㎡ · Folding stools / celadon / pure talk",
  areaSqm: 110,
  palette: ["#EDE6D6", "#4A5A4A", "#3A6A5A"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#EDE6D6",
    windowFrameColor: "#2A2018",
    entranceFrameColor: "#2A2018",
    roofOverhang: 1.0,
    parapetHeight: 0,
    roofColor: "#4A5A4A",
    roofSlabColor: "#4A5A4A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "weijin-f1",
      name: "魏晋书斋",
      area: 110,
      // 1100×1000cm 矩形拼贴（无缺口）：
      // 上排：书斋 650×700 | 清谈室 450×700
      // 下排：庭院 1100×300（全墙隐藏 = 露天庭院）
      rooms: [
        { room: "study",   x: 0,   y: 0,   width: 650, depth: 700,
          name: "书斋", nameEn: "Study", icon: "📖",
          doors: [{ wall: "S", pos: 280, len: 100, style: "wood_panel", h: 200 }],
          windows: [
            { wall: "E", pos: 200, len: 200, style: "wooden", h: 140, sill: 90 },
            { wall: "W", pos: 200, len: 200, style: "wooden", h: 140, sill: 90 },
          ],
          // REDESIGN-C: 北墙水墨为权宜（此期水墨初兴，彩绘壁画更准，暂无模型）
          wallDecor: [{ furnitureId: "mural-inkwash", wall: "N", u: 0.5, v: 0.55 }] },
        { room: "living",  x: 650, y: 0,   width: 450, depth: 700,
          name: "清谈室", nameEn: "Discussion Room", icon: "🧘",
          doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
        { room: "hallway", x: 0,   y: 700, width: 1100, depth: 300,
          name: "庭院", nameEn: "Garden", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      study: [
        // 高榻（scaleH 1.3 → 约 49cm，近半腿高）+ 胡床 + 矮几 + 青瓷
        // REDESIGN-C：北欧地毯已撤；龛前供案成祭坛组；西半间临窗读席补齐
        { furnitureId: "proc-han-ta",        x: 325, z: 130, rotation: 0, scaleH: 1.3 },
        { furnitureId: "proc-han-ji",        x: 325, z: 260, rotation: 0 },
        { furnitureId: "proc-celadon-vase",  x: 325, z: 260, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-huchuang",      x: 325, z: 380, rotation: 180 },
        // 佛龛（东墙）+ 龛前供案：铜佛 + 供碗，成祭坛组
        { furnitureId: "proc-shrine-niche",  x: 610, z: 120, rotation: 270 },
        { furnitureId: "proc-han-an",        x: 530, z: 120, rotation: 0 },
        { furnitureId: "proc-buddha-statue", x: 515, z: 120, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-lacquer-bowl",  x: 555, z: 120, rotation: 0, elevationY: 13 },
        // 低案旧书
        { furnitureId: "proc-han-an",        x: 200, z: 520, rotation: 0 },
        { furnitureId: "decor-books-vintage", x: 200, z: 520, rotation: 0, elevationY: 13 },
        // 西半间临窗读席：低案 + 书 + 青瓷 + 胡床
        { furnitureId: "proc-han-an",        x: 120, z: 300, rotation: 0 },
        { furnitureId: "decor-books-vintage", x: 100, z: 300, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-celadon-vase",  x: 145, z: 300, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-huchuang",      x: 120, z: 430, rotation: 0 },
        // REDESIGN-C-BRIEF: 书斋补到 19 件——西北角木箱 + 旧书、南侧矮几 + 漆碗 + 博山炉
        { furnitureId: "proc-wood-chest",    x: 60,  z: 60,  rotation: 0 },
        { furnitureId: "decor-books-vintage", x: 60, z: 60,  rotation: 0, elevationY: 60 },
        { furnitureId: "proc-han-ji",        x: 500, z: 520, rotation: 0 },
        { furnitureId: "proc-lacquer-bowl",  x: 490, z: 520, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-boshanlu",      x: 515, z: 520, rotation: 0, elevationY: 25 },
      ],
      living: [
        // 清谈：矮几居中，四方凳环坐，漆碗在几上
        { furnitureId: "proc-han-ji",        x: 225, z: 350, rotation: 0 },
        { furnitureId: "proc-lacquer-bowl",  x: 210, z: 350, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-lacquer-bowl",  x: 242, z: 350, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-wood-stool",    x: 100, z: 250, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 350, z: 250, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 100, z: 450, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 350, z: 450, rotation: 0 },
        { furnitureId: "proc-celadon-vase",  x: 225, z: 80,  rotation: 0 },
        { furnitureId: "proc-celadon-vase",  x: 100, z: 60,  rotation: 0 },
        { furnitureId: "proc-celadon-vase",  x: 350, z: 60,  rotation: 0 },
        // 东墙背层：矮几 + 旧书
        { furnitureId: "proc-han-ji",        x: 410, z: 350, rotation: 0 },
        { furnitureId: "decor-books-vintage", x: 410, z: 350, rotation: 0, elevationY: 25 },
      ],
      hallway: [
        { furnitureId: "stone-path",         x: 550, z: 150, rotation: 90 },
        { furnitureId: "proc-bamboo-clump",  x: 150, z: 150, rotation: 0 },
        { furnitureId: "proc-bamboo-clump",  x: 950, z: 150, rotation: 0 },
        { furnitureId: "proc-rock",          x: 750, z: 150, rotation: 0 },
        // REDESIGN-C-BRIEF: 庭院草丛补四丛（路两侧窄条，岩石放不下）
        { furnitureId: "proc-grass-tuft",    x: 250, z: 60,  rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 850, z: 240, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 400, z: 240, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 700, z: 60,  rotation: 0 },
      ],
    },
  ],
};

// ── 元代片场（导演台新增；简版）─────────────────────────────────────────
// 两极：蒙古包（斡耳朵/金帐：圆形毡帐、中央立柱、家具 8 件套不含床、佛龛
// 与十字架共存）vs 汉式宫殿（更大、更彩、多色琉璃瓦、家具大/厚/重、漆器
// 为主）。青花瓷是高端器物，只进宫殿。元代实物证据最少——本场景标注为复原。
const YUAN_SET: ProjectTemplate = {
  id: "set-yuan",
  name: "元代片场",
  nameEn: "Yuan Set",
  emoji: "⛺",
  description: "片场 · 单层 · 蒙古包+汉式宫殿 · 140㎡ · 复原 · 毡帐与宫殿两极 · 拍元代戏",
  descriptionEn: "Film set · 1F · Yurt + Han palace · 140㎡ · Reconstruction · Felt tent vs palace",
  areaSqm: 140,
  palette: ["#E8E0CC", "#5A3A22", "#2A4A8A"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#E8E0CC",
    windowFrameColor: "#2A2018",
    entranceFrameColor: "#2A2018",
    roofOverhang: 1.0,
    parapetHeight: 0,
    roofColor: "#5A3A22",
    roofSlabColor: "#5A3A22",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "yuan-f1",
      name: "元代毡帐与宫殿",
      area: 140,
      // 2000×700cm 矩形拼贴（无缺口）：
      // 蒙古包（露天草原）1100×700 | 汉式宫殿 900×700
      rooms: [
        { room: "hallway", x: 0,    y: 0,   width: 1100, depth: 700,
          name: "蒙古包", nameEn: "Yurt Camp", icon: "⛺", wallsHidden: ["N", "S", "E", "W"] },
        { room: "master",  x: 1100, y: 0,   width: 900, depth: 700,
          name: "汉式宫殿", nameEn: "Han Palace Hall", icon: "🏯",
          doors: [{ wall: "W", pos: 300, len: 140, style: "wood_panel", h: 210 }],
          windows: [{ wall: "E", pos: 250, len: 240, style: "wooden", h: 150, sill: 90 }],
          // REDESIGN-C: 北墙水墨（赵孟頫一路）为本组最站得住的权宜
          wallDecor: [{ furnitureId: "artwork-inkwash", wall: "N", u: 0.5, v: 0.55 }] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 蒙古包是场景本身（露天草原上的毡帐）：帐内不放床；帐外帐口两侧木箱、
  // 佛龛与十字架分列东西、矮几围坐。宫殿：加宽边柜（大/厚/重）+ 青花一对。
  furnitureOverrides: [
    {
      hallway: [
        // REDESIGN-C：干草地铺面（毡帐营地不再是瓷砖地）+ 蒙古包
        { furnitureId: "proc-ground-dry",    x: 550, z: 350, rotation: 0, scaleW: 1.1, scaleD: 0.7 },
        { furnitureId: "proc-yurt",          x: 550, z: 350, rotation: 0 },
        // 帐口两侧：木箱 + 佛龛/十字架（不再孤立于空地）+ 门槛波斯毯
        { furnitureId: "proc-wood-chest",    x: 330, z: 640, rotation: 0 },
        { furnitureId: "proc-wood-chest",    x: 770, z: 640, rotation: 0 },
        { furnitureId: "proc-wood-chest",    x: 320, z: 585, rotation: 0 },
        { furnitureId: "proc-wood-chest",    x: 780, z: 585, rotation: 0 },
        { furnitureId: "proc-shrine-niche",  x: 420, z: 595, rotation: 0 },
        { furnitureId: "proc-cross",         x: 680, z: 595, rotation: 0 },
        { furnitureId: "rug-persian",        x: 420, z: 640, rotation: 0 },
        { furnitureId: "rug-persian",        x: 680, z: 640, rotation: 0 },
        // 帐口围坐：矮几 + 方凳 + 铜锅
        { furnitureId: "proc-han-ji",        x: 550, z: 640, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 450, z: 640, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 650, z: 640, rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 550, z: 640, rotation: 0, elevationY: 25 },
        // REDESIGN-C-BRIEF: 帐口矮几上添两只漆碗 + 一盏油灯（围坐夜话的生活痕迹）
        { furnitureId: "proc-lacquer-bowl",  x: 530, z: 640, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-lacquer-bowl",  x: 570, z: 640, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-oil-lamp",      x: 550, z: 640, rotation: 0, elevationY: 25 },
        // 营地南缘旗帜（垂直点）+ 帐周草丛（帐门口留空）
        { furnitureId: "proc-banner",        x: 150, z: 660, rotation: 0 },
        { furnitureId: "proc-banner",        x: 950, z: 660, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 180, z: 150, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 920, z: 150, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 120, z: 480, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 980, z: 480, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 350, z: 120, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 750, z: 120, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 200, z: 620, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 900, z: 620, rotation: 0 },
      ],
      master: [
        { furnitureId: "sideboard-walnut",   x: 450, z: 40,  rotation: 0, scaleW: 1.5 },
        { furnitureId: "proc-bluewhite-vase", x: 410, z: 40,  rotation: 0, elevationY: 85 },
        { furnitureId: "proc-bluewhite-vase", x: 490, z: 40,  rotation: 0, elevationY: 85 },
        // 东墙镜像边柜 + 青花一对
        { furnitureId: "sideboard-walnut",   x: 865, z: 350, rotation: 90, scaleW: 1.5 },
        { furnitureId: "proc-bluewhite-vase", x: 865, z: 300, rotation: 0, elevationY: 85 },
        { furnitureId: "proc-bluewhite-vase", x: 865, z: 400, rotation: 0, elevationY: 85 },
        // 西墙木箱两件
        { furnitureId: "proc-wood-chest",    x: 60,  z: 200, rotation: 0 },
        { furnitureId: "proc-wood-chest",    x: 60,  z: 500, rotation: 0 },
        { furnitureId: "rug-persian",        x: 450, z: 350, rotation: 0 },
        { furnitureId: "desk-study",         x: 450, z: 300, rotation: 0, scaleW: 1.3 },
        { furnitureId: "decor-books-vintage", x: 450, z: 300, rotation: 0, elevationY: 75 },
        { furnitureId: "decor-copper-pots",  x: 380, z: 300, rotation: 0, elevationY: 75 },
        { furnitureId: "proc-oil-lamp",      x: 505, z: 300, rotation: 0, elevationY: 75 },
        { furnitureId: "proc-wood-stool",    x: 350, z: 400, rotation: 180 },
        { furnitureId: "proc-wood-stool",    x: 550, z: 400, rotation: 180 },
        // 厅中油灯（矮几上）
        { furnitureId: "proc-han-ji",        x: 450, z: 470, rotation: 0 },
        { furnitureId: "proc-oil-lamp",      x: 450, z: 470, rotation: 0, elevationY: 25 },
        // 南端尊位：榻 + 波斯毯 + 两侧矮几铜器
        { furnitureId: "rug-persian",        x: 450, z: 580, rotation: 0, scaleW: 1.5 },
        { furnitureId: "proc-han-ta",        x: 450, z: 580, rotation: 0, scaleW: 1.2 },
        { furnitureId: "proc-han-ji",        x: 300, z: 580, rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 300, z: 580, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-han-ji",        x: 600, z: 580, rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 600, z: 580, rotation: 0, elevationY: 25 },
      ],
    },
  ],
};

// ── 半坡片场（仰韶，导演台新增；简版）───────────────────────────────────
// 约公元前 4800–4300 年：半地穴房屋（地面下约 1m 深坑、木柱、草泥墙、茅草
// 顶、南向门）、中央 160㎡ 大房子；无任何家具——只有火塘（唯一光源）、土台、
// 陶罐；种粟（不是水稻）；无人面鱼纹饭碗（那是儿童瓮棺葬的礼器）；无砖瓦、
// 无金属、无瓷器。与河姆渡互斥（半坡半地穴+粟，河姆渡干栏+稻）。
const BANPO_SET: ProjectTemplate = {
  id: "set-banpo",
  name: "半坡片场",
  nameEn: "Banpo Set",
  emoji: "🏺",
  description: "片场 · 单层 · 160㎡大房子+半地穴屋 · 200㎡ · 无家具 · 只火塘土台陶罐 · 拍史前戏",
  descriptionEn: "Film set · 1F · 160㎡ communal house + semi-subterranean house · 200㎡ · No furniture — fire pit, earth platforms, pottery only",
  areaSqm: 200,
  palette: ["#9A7A55", "#6A4A28", "#B06030"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#9A7A55",
    windowFrameColor: "#2A2018",
    entranceFrameColor: "#2A2018",
    roofOverhang: 0.8,
    parapetHeight: 0,
    roofColor: "#6A4A28",
    roofSlabColor: "#6A4A28",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "banpo-f1",
      name: "半坡聚落",
      area: 200,
      // 2000×1000cm 矩形拼贴（无缺口）：
      // 大房子 1600×1000（=160㎡）| 半地穴屋宅基地 400×1000（露天）
      rooms: [
        { room: "living",   x: 0,    y: 0,   width: 1600, depth: 1000,
          name: "大房子", nameEn: "Communal House", icon: "🏺",
          doors: [{ wall: "S", pos: 720, len: 160, style: "wood_panel", h: 200 }] },
        { room: "hallway",  x: 1600, y: 0,   width: 400, depth: 1000,
          name: "半地穴屋", nameEn: "Semi-subterranean House", icon: "🏠", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 大房子：火塘居中、土台两侧、陶罐成排、粟束在门口（收获的粟存放在室内）。
  // 半地穴屋：屋体本身 + 屋外火塘 + 陶罐。没有桌/椅/床/柜——一个都没有。
  furnitureOverrides: [
    {
      living: [
        // REDESIGN-C：火塘居中（全屋唯一光源）；土台两侧 + 北墙一张睡台；
        // 陶罐成簇不再排成行；毛毯为权宜（现代模型）只平铺土台作兽皮/寝具；
        // 无 wallDecor——史前墙上无画，正确。
        { furnitureId: "proc-banpo-firepit",   x: 800,  z: 500, rotation: 0 },
        { furnitureId: "proc-earth-platform",  x: 300,  z: 300, rotation: 0 },
        { furnitureId: "proc-earth-platform",  x: 1300, z: 300, rotation: 0 },
        { furnitureId: "proc-earth-platform",  x: 800,  z: 80,  rotation: 0 },
        // 陶罐成簇：东西墙边各二、火塘边一、门口一
        { furnitureId: "proc-banpo-pot",       x: 1500, z: 260, rotation: 0 },
        { furnitureId: "proc-banpo-pot",       x: 1500, z: 350, rotation: 0 },
        { furnitureId: "proc-banpo-pot",       x: 100,  z: 260, rotation: 0 },
        { furnitureId: "proc-banpo-pot",       x: 100,  z: 350, rotation: 0 },
        { furnitureId: "proc-banpo-pot",       x: 920,  z: 550, rotation: 0 },
        { furnitureId: "proc-banpo-pot",       x: 900,  z: 930, rotation: 0 },
        // 粟束：门口二、西墙二（收获的粟存放在室内）
        { furnitureId: "proc-millet-sheaf",    x: 600,  z: 950, rotation: 0 },
        { furnitureId: "proc-millet-sheaf",    x: 1000, z: 950, rotation: 0 },
        { furnitureId: "proc-millet-sheaf",    x: 80,   z: 600, rotation: 0 },
        { furnitureId: "proc-millet-sheaf",    x: 80,   z: 700, rotation: 0 },
        // 毛毯（权宜）平铺土台作兽皮/寝具
        { furnitureId: "decor-blanket",        x: 300,  z: 300, rotation: 0, elevationY: 30 },
        { furnitureId: "decor-blanket",        x: 1300, z: 300, rotation: 0, elevationY: 30 },
        // 火塘石圈：散置岩石围火塘
        { furnitureId: "proc-rock",            x: 660,  z: 500, rotation: 0 },
        { furnitureId: "proc-rock",            x: 800,  z: 360, rotation: 0 },
        { furnitureId: "proc-rock",            x: 800,  z: 640, rotation: 0 },
        { furnitureId: "proc-rock",            x: 940,  z: 420, rotation: 0 },
        // 墙边草丛（茅草边角料/铺地）+ 干草地铺面
        { furnitureId: "proc-grass-tuft",      x: 200,  z: 900, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 1400, z: 900, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 200,  z: 150, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 1400, z: 150, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 1100, z: 900, rotation: 0 },
        { furnitureId: "proc-ground-dry",      x: 800,  z: 500, rotation: 0, scaleW: 1.6, scaleD: 1.0 },
      ],
      hallway: [
        { furnitureId: "proc-banpo-house",     x: 200,  z: 450, rotation: 0 },
        { furnitureId: "proc-banpo-firepit",   x: 200,  z: 850, rotation: 0 },
        { furnitureId: "proc-banpo-pot",       x: 200,  z: 150, rotation: 0 },
        { furnitureId: "proc-banpo-pot",       x: 200,  z: 80,  rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 80,   z: 150, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 320,  z: 150, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 80,   z: 750, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 320,  z: 750, rotation: 0 },
        { furnitureId: "proc-bush",            x: 60,   z: 900, rotation: 0 },
        { furnitureId: "proc-bush",            x: 340,  z: 900, rotation: 0 },
        { furnitureId: "proc-millet-sheaf",    x: 150,  z: 700, rotation: 0 },
        { furnitureId: "proc-millet-sheaf",    x: 250,  z: 700, rotation: 0 },
        { furnitureId: "proc-ground-dry",      x: 200,  z: 500, rotation: 0, scaleW: 0.4, scaleD: 1.0 },
      ],
    },
  ],
};

// ── 河姆渡片场（导演台新增；简版）───────────────────────────────────────
// 约 7000–5000 年前：干栏式长屋（23m 长屋带走廊、榫卯、地板离地 1m+，
// 楼上住人楼下养畜、160㎡）；黑陶（夹炭黑陶）、骨耜、双鸟朝阳、漆木碗；
// 种水稻（不是粟）。与半坡互斥（河姆渡干栏+稻，半坡半地穴+粟）。
const HEMUDU_SET: ProjectTemplate = {
  id: "set-hemudu",
  name: "河姆渡片场",
  nameEn: "Hemudu Set",
  emoji: "🌾",
  description: "片场 · 单层 · 23m干栏长屋+晒场 · 230㎡ · 种稻 · 楼上住人楼下养畜 · 拍史前戏",
  descriptionEn: "Film set · 1F · 23m stilt longhouse + drying yard · 230㎡ · Rice, not millet · Stilt house",
  areaSqm: 230,
  palette: ["#8A6A42", "#3A2A1A", "#1E1A16"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#8A6A42",
    windowFrameColor: "#2A2018",
    entranceFrameColor: "#2A2018",
    roofOverhang: 0.8,
    parapetHeight: 0,
    roofColor: "#3A2A1A",
    roofSlabColor: "#3A2A1A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "hemudu-f1",
      name: "河姆渡聚落",
      area: 230,
      // 2300×1000cm 矩形拼贴（无缺口）：
      // 干栏长屋 2300×700（=161㎡，露天宅基地）| 晒场 2300×300
      // 晒场只隐三面墙（南墙留着，门落在实墙上，不飘浮）。
      rooms: [
        { room: "hallway",  x: 0,    y: 0,   width: 2300, depth: 700,
          name: "干栏长屋", nameEn: "Stilt Longhouse", icon: "🌾", wallsHidden: ["N", "S", "E", "W"] },
        { room: "custom1",  x: 0,    y: 700, width: 2300, depth: 300,
          name: "晒场", nameEn: "Drying Yard", icon: "🌾", wallsHidden: ["N", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 长屋：屋体本身（23m）+ 楼下黑陶 + 楼上漆碗（架空地板高约 114cm，
  // elevationY 114 直接悬置在地板面上）。晒场：稻束 + 黑陶。
  furnitureOverrides: [
    {
      hallway: [
        // REDESIGN-C：干草地铺面；楼下（畜栏/储藏层）补黑陶 + 草垛 + 草丛；
        // 楼上走廊漆碗成排 + 两端黑陶；无 wallDecor——史前墙上无画，正确。
        { furnitureId: "proc-ground-dry",      x: 1150, z: 350, rotation: 0, scaleW: 2.3, scaleD: 0.7 },
        { furnitureId: "proc-hemudu-stilt",    x: 1150, z: 350, rotation: 0 },
        // 楼下（畜栏/储藏层）：黑陶 + 草垛 + 草丛
        { furnitureId: "proc-hemudu-pot",      x: 300,  z: 350, rotation: 0 },
        { furnitureId: "proc-hemudu-pot",      x: 2000, z: 350, rotation: 0 },
        { furnitureId: "proc-hemudu-pot",      x: 700,  z: 350, rotation: 0 },
        { furnitureId: "proc-hemudu-pot",      x: 1600, z: 350, rotation: 0 },
        { furnitureId: "proc-haystack",        x: 2080, z: 540, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 200,  z: 120, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 600,  z: 580, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 1000, z: 120, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 1400, z: 580, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 1800, z: 120, rotation: 0 },
        { furnitureId: "proc-grass-tuft",      x: 2200, z: 580, rotation: 0 },
        // 楼上走廊（架空地板高约 114cm）：漆碗一排 + 两端黑陶
        { furnitureId: "proc-lacquer-bowl",    x: 500,  z: 300, rotation: 0, elevationY: 114 },
        { furnitureId: "proc-lacquer-bowl",    x: 900,  z: 300, rotation: 0, elevationY: 114 },
        { furnitureId: "proc-lacquer-bowl",    x: 1400, z: 300, rotation: 0, elevationY: 114 },
        { furnitureId: "proc-lacquer-bowl",    x: 1900, z: 300, rotation: 0, elevationY: 114 },
        { furnitureId: "proc-hemudu-pot",      x: 350,  z: 300, rotation: 0, elevationY: 114 },
        { furnitureId: "proc-hemudu-pot",      x: 1950, z: 300, rotation: 0, elevationY: 114 },
      ],
      custom1: [
        // 稻束两对（西端/东端，z 错开）；稻田块在晒场南缘
        { furnitureId: "proc-rice-sheaf",      x: 300,  z: 110, rotation: 0 },
        { furnitureId: "proc-rice-sheaf",      x: 430,  z: 150, rotation: 0 },
        { furnitureId: "proc-rice-sheaf",      x: 1870, z: 110, rotation: 0 },
        { furnitureId: "proc-rice-sheaf",      x: 2000, z: 150, rotation: 0 },
        { furnitureId: "proc-rice-paddy",      x: 600,  z: 235, rotation: 0, scaleW: 0.8, scaleD: 0.3 },
        { furnitureId: "proc-rice-paddy",      x: 1700, z: 235, rotation: 0, scaleW: 0.8, scaleD: 0.3 },
        { furnitureId: "proc-hemudu-pot",      x: 650,  z: 150, rotation: 0 },
        { furnitureId: "proc-hemudu-pot",      x: 1650, z: 150, rotation: 0 },
        { furnitureId: "proc-hemudu-pot",      x: 1000, z: 120, rotation: 0 },
        { furnitureId: "proc-hemudu-pot",      x: 1300, z: 120, rotation: 0 },
        // 晒场南缘水面（池塘示意，6cm 薄板不与地面重合）+ 干草地铺面
        { furnitureId: "proc-water-plane",     x: 1150, z: 225, rotation: 0, scaleW: 0.5, scaleD: 0.15 },
        { furnitureId: "proc-ground-dry",      x: 1150, z: 150, rotation: 0, scaleW: 2.3, scaleD: 0.3 },
        // 庭院绿化：竹丛两端 + 灌木
        { furnitureId: "proc-bamboo-clump",    x: 100,  z: 150, rotation: 0 },
        { furnitureId: "proc-bamboo-clump",    x: 2200, z: 150, rotation: 0 },
        { furnitureId: "proc-bush",            x: 1150, z: 60,  rotation: 0 },
        { furnitureId: "proc-bush",            x: 150,  z: 260, rotation: 0 },
        { furnitureId: "proc-bush",            x: 2150, z: 260, rotation: 0 },
      ],
    },
  ],
};

// ── 民国农村片场（导演台新增；简版）────────────────────────────────────
// 北方“一明二暗”：明间堂屋 + 两暗间卧房 + 院子；土炕是床与家庭中心；
// 家具极简（橱/小桌/凳/箱）。照明只能是豆油灯 → 煤油灯（1920s+）；
// 民国农村无电灯、无留声机、无电话、无电风扇。窑洞变体未建，本场景为
// 一明二暗砖木房。
const RURAL_REPUBLICAN_SET: ProjectTemplate = {
  id: "set-rural-republican",
  name: "民国农村片场",
  nameEn: "Republican Rural Set",
  emoji: "🏮",
  description: "片场 · 单层 · 一明二暗+院子 · 120㎡ · 火炕/油灯 · 无电灯 · 拍民国乡土戏",
  descriptionEn: "Film set · 1F · One bright room + two dark rooms + yard · 120㎡ · Kang bed, oil lamps, no electricity",
  areaSqm: 120,
  palette: ["#EFE8DC", "#4A3A2A", "#8B6A3A"],
  styleTemplateId: "chinese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#EFE8DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#4A3A2A",
    roofSlabColor: "#4A3A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "rural-rep-f1",
      name: "民国农村一明二暗",
      area: 120,
      // 1200×1000cm 矩形拼贴（无缺口）：
      // 上排：明间 400×650 | 暗间西 400×650 | 暗间东 400×650
      // 下排：院子 1200×350（全墙隐藏 = 露天院子）
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 400, depth: 650,
          name: "明间", nameEn: "Main Room", icon: "🏮",
          doors: [{ wall: "S", pos: 150, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "E", pos: 200, len: 160, style: "wooden", h: 140, sill: 90 }],
          // REDESIGN-C: 门楣两侧春联（农家唯一墙饰，贴于门外——wallDecor
          // 正是外墙面机制）；不挂水墨（农家不挂文人画）
          wallDecor: [
            { furnitureId: "couplet-spring", wall: "S", u: 0.3, v: 0.5 },
            { furnitureId: "couplet-prosperity", wall: "S", u: 0.7, v: 0.5 },
          ] },
        { room: "bedroom",  x: 400, y: 0,   width: 400, depth: 650,
          name: "暗间西", nameEn: "West Side Room", icon: "🛏️",
          doors: [{ wall: "W", pos: 280, len: 90, style: "wood_panel", h: 200 }] },
        { room: "bedroom2", x: 800, y: 0,   width: 400, depth: 650,
          name: "暗间东", nameEn: "East Side Room", icon: "🛏️",
          doors: [{ wall: "W", pos: 280, len: 90, style: "wood_panel", h: 200 }] },
        { room: "hallway",  x: 0,   y: 650, width: 1200, depth: 350,
          name: "院子", nameEn: "Courtyard", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 每间暗间一张大炕 + 炕桌 + 油灯（西间豆油灯、东间煤油灯，过渡期的两种灯）；
  // 明间只放木箱/小桌/凳。无电灯、无留声机、无电话、无电风扇、无冰箱。
  furnitureOverrides: [
    {
      living: [
        // REDESIGN-C：北墙供案（矮几 + 豆油灯 + 铜器）；木箱改放西墙 + 一只存粮箱；
        // 中央几上添果盘供果；两暗间不再复制粘贴
        { furnitureId: "proc-han-ji",        x: 200, z: 55,  rotation: 0 },
        { furnitureId: "proc-oil-lamp",      x: 188, z: 55,  rotation: 0, elevationY: 25 },
        { furnitureId: "decor-copper-pots",  x: 212, z: 55,  rotation: 0, elevationY: 25 },
        { furnitureId: "proc-wood-chest",    x: 60,  z: 80,  rotation: 0 },
        { furnitureId: "proc-wood-chest",    x: 60,  z: 550, rotation: 0 },
        { furnitureId: "proc-han-ji",        x: 200, z: 300, rotation: 0 },
        { furnitureId: "proc-kerosene-lamp", x: 185, z: 300, rotation: 0, elevationY: 25 },
        { furnitureId: "decor-fruit-bowl",   x: 220, z: 300, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-wood-stool",    x: 120, z: 380, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 280, z: 380, rotation: 0 },
        // REDESIGN-C-BRIEF: 明间补到 20 件——箱上脸盆、第二张供案矮几 + 铜器 +
        // 油灯、藤盒两只、粟束两捆（室内存粮）、围坐木凳两只
        { furnitureId: "proc-basin",         x: 60,  z: 80,  rotation: 0, elevationY: 60 },
        { furnitureId: "proc-han-ji",        x: 200, z: 150, rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 190, z: 150, rotation: 0, elevationY: 25 },
        { furnitureId: "proc-oil-lamp",      x: 215, z: 150, rotation: 0, elevationY: 25 },
        { furnitureId: "decor-wicker-box",   x: 340, z: 80,  rotation: 0 },
        { furnitureId: "decor-wicker-box",   x: 340, z: 550, rotation: 0 },
        { furnitureId: "proc-millet-sheaf",  x: 340, z: 600, rotation: 0 },
        { furnitureId: "proc-millet-sheaf",  x: 60,  z: 300, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 120, z: 450, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 280, z: 450, rotation: 0 },
      ],
      bedroom: [
        // 西暗间（父母房）：炕上添被褥 + 抱枕，箱边藤盒；仍用豆油灯
        { furnitureId: "proc-kang",          x: 200, z: 100, rotation: 0 },
        { furnitureId: "proc-han-ji",        x: 200, z: 100, rotation: 0, elevationY: 70 },
        { furnitureId: "proc-oil-lamp",      x: 200, z: 100, rotation: 0, elevationY: 95 },
        { furnitureId: "decor-blanket",      x: 110, z: 100, rotation: 0, elevationY: 70 },
        { furnitureId: "decor-pillows",      x: 300, z: 100, rotation: 0, elevationY: 70 },
        { furnitureId: "proc-wood-chest",    x: 200, z: 400, rotation: 0 },
        { furnitureId: "decor-wicker-box",   x: 280, z: 400, rotation: 0 },
        // REDESIGN-C-BRIEF: 父母房补到 10 件——箱上脸盆 + 第二只藤盒
        { furnitureId: "proc-basin",         x: 200, z: 400, rotation: 0, elevationY: 60 },
        { furnitureId: "decor-wicker-box",   x: 120, z: 400, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 200, z: 520, rotation: 0 },
      ],
      bedroom2: [
        // 东暗间（小夫妻房）：炕脚折叠被褥，箱上脸盆，墙边行李箱；用煤油灯
        { furnitureId: "proc-kang",          x: 200, z: 100, rotation: 0 },
        { furnitureId: "proc-han-ji",        x: 200, z: 100, rotation: 0, elevationY: 70 },
        // REDESIGN-C-BRIEF: 小夫妻房补到 10 件——炕几上添漆碗（煤油灯东移让位）+ 藤盒
        { furnitureId: "proc-lacquer-bowl",  x: 185, z: 100, rotation: 0, elevationY: 70 },
        { furnitureId: "proc-kerosene-lamp", x: 215, z: 100, rotation: 0, elevationY: 95 },
        { furnitureId: "decor-blanket",      x: 200, z: 150, rotation: 0, elevationY: 70, scaleW: 0.8, scaleD: 0.7 },
        { furnitureId: "proc-wood-chest",    x: 200, z: 400, rotation: 0 },
        { furnitureId: "proc-basin",         x: 200, z: 400, rotation: 0, elevationY: 60 },
        { furnitureId: "decor-suitcase",     x: 330, z: 400, rotation: 0 },
        { furnitureId: "decor-wicker-box",   x: 120, z: 400, rotation: 0 },
        { furnitureId: "proc-wood-stool",    x: 200, z: 520, rotation: 0 },
      ],
      hallway: [
        // 院子成第二间屋：南缘木围栏、东角草垛、门边洗衣篮、西角鸡舍
        { furnitureId: "stone-path",         x: 600, z: 175, rotation: 90 },
        { furnitureId: "fence",              x: 100, z: 330, rotation: 90 },
        { furnitureId: "fence",              x: 300, z: 330, rotation: 90 },
        { furnitureId: "fence",              x: 500, z: 330, rotation: 90 },
        { furnitureId: "fence",              x: 700, z: 330, rotation: 90 },
        { furnitureId: "fence",              x: 900, z: 330, rotation: 90 },
        { furnitureId: "fence",              x: 1100, z: 330, rotation: 90 },
        { furnitureId: "proc-haystack",      x: 1100, z: 80,  rotation: 0 },
        { furnitureId: "decor-laundry-basket", x: 320, z: 50, rotation: 0 },
        { furnitureId: "chicken-coop",       x: 100, z: 80,  rotation: 0 },
      ],
    },
  ],
};

// ── 凡尔赛宫片场（导演台新增；简版）────────────────────────────────────
// 镜厅：73m 长廊、17 扇窗对 17 面镜墙、水晶吊灯、太阳纹；历史上没有厕所/
// 浴室。镜厅按约 1/3 缩短为 20m（为拍摄尺度折中），镜墙 5 面 + 南墙 3 窗
// 示意“窗镜成对”，不是 17 对全复刻。
const VERSAILLES_SET: ProjectTemplate = {
  id: "set-versailles",
  name: "凡尔赛宫片场",
  nameEn: "Versailles Set",
  emoji: "👑",
  description: "片场 · 单层 · 镜厅+沙龙+花园 · 280㎡ · 镜墙/水晶灯 · 无厕所浴室 · 拍宫廷戏",
  descriptionEn: "Film set · 1F · Hall of Mirrors + salon + garden · 280㎡ · Mirror walls, crystal chandeliers, no bathrooms",
  areaSqm: 280,
  palette: ["#E8DCC8", "#C8A24A", "#8B1A1A"],
  styleTemplateId: "luxury",

  exterior: {
    preset: "french-classical",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#E8DCC8",
    windowFrameColor: "#C8A24A",
    entranceFrameColor: "#2A2018",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A2A1A",
    roofSlabColor: "#4A5870",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "versailles-f1",
      name: "凡尔赛宫",
      area: 280,
      // 2800×1000cm 矩形拼贴（无缺口）：
      // 上排：镜厅 2000×700 | 沙龙 800×700
      // 下排：花园 2800×300（全墙隐藏 = 露天花园）
      rooms: [
        { room: "living",   x: 0,    y: 0,   width: 2000, depth: 700,
          name: "镜厅", nameEn: "Hall of Mirrors", icon: "👑",
          doors: [{ wall: "S", pos: 920, len: 160, style: "wood_panel", h: 210 }],
          windows: [
            { wall: "S", pos: 300, len: 240, style: "wooden", h: 160, sill: 90 },
            { wall: "S", pos: 880, len: 240, style: "wooden", h: 160, sill: 90 },
            { wall: "S", pos: 1460, len: 240, style: "wooden", h: 160, sill: 90 },
          ],
          // REDESIGN-C: 北墙维米尔为权宜（法式宫廷肖像暂无模型）；u 0.4 落在
          // 2、3 号镜墙之间（u 0.5 正对 3 号镜墙，故不用）
          wallDecor: [{ furnitureId: "artwork-vermeer", wall: "N", u: 0.4, v: 0.6 }] },
        { room: "master",   x: 2000, y: 0,   width: 800, depth: 700,
          name: "沙龙", nameEn: "Salon", icon: "🪞",
          doors: [{ wall: "W", pos: 300, len: 120, style: "wood_panel", h: 210 }] },
        { room: "hallway",  x: 0,    y: 700, width: 2800, depth: 300,
          name: "花园", nameEn: "Garden", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  furnitureOverrides: [
    {
      living: [
        // 镜墙 ×5 沿北墙（与南墙 3 窗成对示意）+ 水晶吊灯 ×4 + 鎏金椅沿南墙
        { furnitureId: "proc-mirror-wall",        x: 200,  z: 12,  rotation: 0 },
        { furnitureId: "proc-mirror-wall",        x: 600,  z: 12,  rotation: 0 },
        { furnitureId: "proc-mirror-wall",        x: 1000, z: 12,  rotation: 0 },
        { furnitureId: "proc-mirror-wall",        x: 1400, z: 12,  rotation: 0 },
        { furnitureId: "proc-mirror-wall",        x: 1800, z: 12,  rotation: 0 },
        { furnitureId: "proc-chandelier-crystal", x: 300,  z: 350, rotation: 0, mountCeiling: true },
        { furnitureId: "proc-chandelier-crystal", x: 800,  z: 350, rotation: 0, mountCeiling: true },
        { furnitureId: "proc-chandelier-crystal", x: 1300, z: 350, rotation: 0, mountCeiling: true },
        { furnitureId: "proc-chandelier-crystal", x: 1800, z: 350, rotation: 0, mountCeiling: true },
        // REDESIGN-C：镜间鎏金壁灯 ×5（北墙）+ 南窗深红帘 ×3；
        // 鎏金椅离墙上毯，成两组会谈（西组花瓶 + 餐具、东组花瓶）
        { furnitureId: "lamp-wall-sconce",        x: 400,  z: 30,  rotation: 0, elevationY: 170 },
        { furnitureId: "lamp-wall-sconce",        x: 800,  z: 30,  rotation: 0, elevationY: 170 },
        { furnitureId: "lamp-wall-sconce",        x: 1200, z: 30,  rotation: 0, elevationY: 170 },
        { furnitureId: "lamp-wall-sconce",        x: 1600, z: 30,  rotation: 0, elevationY: 170 },
        { furnitureId: "lamp-wall-sconce",        x: 1950, z: 30,  rotation: 0, elevationY: 170 },
        { furnitureId: "curtain-victorian",       x: 420,  z: 680, rotation: 0 },
        { furnitureId: "curtain-victorian",       x: 1000, z: 680, rotation: 0 },
        { furnitureId: "curtain-victorian",       x: 1580, z: 680, rotation: 0 },
        { furnitureId: "rug-persian",             x: 1000, z: 350, rotation: 0, scaleW: 4, scaleD: 1.2 },
        { furnitureId: "rug-persian",             x: 200,  z: 350, rotation: 0, scaleW: 1.2, scaleD: 0.8 },
        { furnitureId: "coffee-marble-rect",      x: 600,  z: 350, rotation: 0 },
        { furnitureId: "coffee-marble-rect",      x: 1400, z: 350, rotation: 0 },
        { furnitureId: "decor-vase-single",       x: 565,  z: 350, rotation: 0, elevationY: 38 },
        { furnitureId: "decor-dinner-set-elegant", x: 625, z: 350, rotation: 0, elevationY: 38 },
        { furnitureId: "decor-vase-single",       x: 1400, z: 350, rotation: 0, elevationY: 38 },
        { furnitureId: "proc-gilt-chair",         x: 495,  z: 350, rotation: 90 },
        { furnitureId: "proc-gilt-chair",         x: 600,  z: 255, rotation: 0 },
        { furnitureId: "proc-gilt-chair",         x: 600,  z: 445, rotation: 180 },
        { furnitureId: "proc-gilt-chair",         x: 1505, z: 350, rotation: 270 },
        { furnitureId: "proc-gilt-chair",         x: 1400, z: 255, rotation: 0 },
        { furnitureId: "proc-gilt-chair",         x: 1400, z: 445, rotation: 180 },
      ],
      master: [
        // REDESIGN-C：沙龙两组会谈（西组花瓶、东组茶具）+ 四角落地花瓶 + 壁灯
        { furnitureId: "coffee-marble-rect",      x: 220,  z: 350, rotation: 0 },
        { furnitureId: "coffee-marble-rect",      x: 580,  z: 350, rotation: 0 },
        { furnitureId: "decor-vase-single",       x: 220,  z: 350, rotation: 0, elevationY: 38 },
        { furnitureId: "decor-tea-set",           x: 580,  z: 350, rotation: 0, elevationY: 38 },
        // REDESIGN-C-BRIEF: 东组会谈桌也摆一套茶具（小物件满 6 件）
        { furnitureId: "decor-tea-set",           x: 1400, z: 350, rotation: 0, elevationY: 38 },
        { furnitureId: "proc-gilt-chair",         x: 120,  z: 350, rotation: 90 },
        { furnitureId: "proc-gilt-chair",         x: 220,  z: 230, rotation: 0 },
        { furnitureId: "proc-gilt-chair",         x: 220,  z: 470, rotation: 180 },
        { furnitureId: "proc-gilt-chair",         x: 680,  z: 350, rotation: 270 },
        { furnitureId: "proc-gilt-chair",         x: 580,  z: 230, rotation: 0 },
        { furnitureId: "proc-gilt-chair",         x: 580,  z: 470, rotation: 180 },
        { furnitureId: "decor-vase-royal",        x: 100,  z: 40,  rotation: 0 },
        { furnitureId: "decor-vase-royal",        x: 700,  z: 40,  rotation: 0 },
        { furnitureId: "decor-vase-royal",        x: 100,  z: 660, rotation: 0 },
        { furnitureId: "decor-vase-royal",        x: 700,  z: 660, rotation: 0 },
        { furnitureId: "lamp-wall-sconce",        x: 250,  z: 30,  rotation: 0, elevationY: 170 },
        { furnitureId: "lamp-wall-sconce",        x: 550,  z: 30,  rotation: 0, elevationY: 170 },
        { furnitureId: "proc-chandelier-crystal", x: 400,  z: 350, rotation: 0, mountCeiling: true },
      ],
      hallway: [
        // REDESIGN-C：法式几何花园——中央喷泉 + 两侧青花大缸 + 两端盆栽
        { furnitureId: "fountain",            x: 1400, z: 150, rotation: 0 },
        { furnitureId: "decor-garden-urn",    x: 1100, z: 150, rotation: 0 },
        { furnitureId: "decor-garden-urn",    x: 1700, z: 150, rotation: 0 },
        { furnitureId: "plant-potted-pack",   x: 200,  z: 150, rotation: 0 },
        { furnitureId: "plant-potted-pack",   x: 2600, z: 150, rotation: 0 },
        // REDESIGN-C-BRIEF: 法式花园中轴补齐——盆栽两盆 + 青花大缸两只
        { furnitureId: "plant-potted-pack",   x: 700,  z: 150, rotation: 0 },
        { furnitureId: "plant-potted-pack",   x: 2100, z: 150, rotation: 0 },
        { furnitureId: "decor-garden-urn",    x: 900,  z: 150, rotation: 0 },
        { furnitureId: "decor-garden-urn",    x: 1900, z: 150, rotation: 0 },
        { furnitureId: "stone-path",          x: 1400, z: 150, rotation: 90 },
      ],
    },
  ],
};

// ── 日本和室片场（导演台新增；简版）────────────────────────────────────
// 榻榻米以“帖”计量（和室约 12 帖、茶室 4.5 帖，为拍摄放大）；床の間在角落
// （只挂轴、摆插花，不放物、不坐人）；障子/拉门；不穿鞋上榻榻米；房间白天
// 是起居室、晚上铺被褥变卧室（被褥以折叠态放在茶室角落示意）。
const WASHITSU_SET: ProjectTemplate = {
  id: "set-washitsu",
  name: "日本和室片场",
  nameEn: "Washitsu Set",
  emoji: "🎋",
  description: "片场 · 单层 · 和室+茶室+缘侧 · 60㎡ · 榻榻米/床の間/障子 · 拍日式日常戏",
  descriptionEn: "Film set · 1F · Tatami room + tea room + engawa · 60㎡ · Tatami, tokonoma, shoji",
  areaSqm: 60,
  palette: ["#EDE6D6", "#8A6A42", "#3A5A3A"],
  styleTemplateId: "japanese",

  exterior: {
    preset: "japanese-zen",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#EDE6D6",
    windowFrameColor: "#8A6A42",
    entranceFrameColor: "#2A2018",
    roofOverhang: 1.0,
    parapetHeight: 0,
    roofColor: "#8A6A42",
    roofSlabColor: "#2A2A26",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "washitsu-f1",
      name: "日本和室",
      area: 60,
      // 900×660cm 矩形拼贴（无缺口）：
      // 上排：和室 540×360（≈12 帖）| 茶室 360×360（4.5 帖）
      // 下排：缘侧 900×300（全墙隐藏 = 露天缘侧）
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 540, depth: 360,
          name: "和室", nameEn: "Tatami Room", icon: "🎋",
          doors: [{ wall: "S", pos: 220, len: 100, style: "wood_panel", h: 200 }],
          // REDESIGN-C: 床の間挂轴为权宜（浮世绘框画非挂轴）；u 0.85 对齐
          // 东角床の間（x 470/540），设计注 u 0.5 会落在房间中部，不用
          wallDecor: [{ furnitureId: "artwork-hokusai", wall: "N", u: 0.85, v: 0.6 }] },
        { room: "study",    x: 540, y: 0,   width: 360, depth: 360,
          name: "茶室", nameEn: "Tea Room", icon: "🍵",
          doors: [{ wall: "W", pos: 140, len: 90, style: "wood_panel", h: 200 }] },
        { room: "hallway",  x: 0,   y: 360, width: 900, depth: 300,
          name: "缘侧", nameEn: "Engawa", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 和室：12 帖榻榻米铺满 + 床の間（北墙东角）+ 矮桌 + 坐垫；障子 ×2
  // 立在和室/茶室隔墙上。茶室：8 帖榻榻米 + 茶桌 + 坐垫 + 折叠被褥。
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "proc-tatami",         x: 90,  z: 45,  rotation: 0 },
        { furnitureId: "proc-tatami",         x: 270, z: 45,  rotation: 0 },
        { furnitureId: "proc-tatami",         x: 450, z: 45,  rotation: 0 },
        { furnitureId: "proc-tatami",         x: 90,  z: 135, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 270, z: 135, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 450, z: 135, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 90,  z: 225, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 270, z: 225, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 450, z: 225, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 90,  z: 315, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 270, z: 315, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 450, z: 315, rotation: 0 },
        { furnitureId: "proc-tokonoma",       x: 470, z: 23,  rotation: 0 },
        // REDESIGN-C：橡木茶几换低矮素桌（韩式小桌权宜，日式座卓暂无模型）；
        // 茶具旁添两只茶碗；西墙添低柜 + 书堆；床の間模型自带挂轴 + 插花，
        // 故不再另加花瓶（只挂轴摆花、不放物）
        { furnitureId: "proc-ondol-table",    x: 270, z: 180, rotation: 0 },
        { furnitureId: "decor-tea-set",       x: 270, z: 180, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-lacquer-bowl",   x: 240, z: 180, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-lacquer-bowl",   x: 300, z: 180, rotation: 0, elevationY: 30 },
        // REDESIGN-C-BRIEF: 榻榻米上随手放一只用过的茶碗（生活痕迹）
        { furnitureId: "proc-lacquer-bowl",   x: 230, z: 240, rotation: 0 },
        { furnitureId: "proc-floor-cushion",  x: 190, z: 110, rotation: 0 },
        { furnitureId: "proc-floor-cushion",  x: 350, z: 110, rotation: 0 },
        { furnitureId: "proc-floor-cushion",  x: 190, z: 250, rotation: 0 },
        { furnitureId: "proc-floor-cushion",  x: 350, z: 250, rotation: 0 },
        { furnitureId: "proc-wood-chest",     x: 55,  z: 180, rotation: 90 },
        { furnitureId: "decor-book-stack",    x: 55,  z: 180, rotation: 0, elevationY: 60 },
        // REDESIGN-C-BRIEF: 低柜上添青瓷花瓶（日式青瓷 Seiji，无违和）
        { furnitureId: "proc-celadon-vase",  x: 55,  z: 150, rotation: 0, elevationY: 60 },
        { furnitureId: "proc-shoji",          x: 540, z: 90,  rotation: 90 },
        { furnitureId: "proc-shoji",          x: 540, z: 270, rotation: 90 },
      ],
      study: [
        { furnitureId: "proc-tatami",         x: 90,  z: 45,  rotation: 0 },
        { furnitureId: "proc-tatami",         x: 270, z: 45,  rotation: 0 },
        { furnitureId: "proc-tatami",         x: 90,  z: 135, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 270, z: 135, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 90,  z: 225, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 270, z: 225, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 90,  z: 315, rotation: 0 },
        { furnitureId: "proc-tatami",         x: 270, z: 315, rotation: 0 },
        { furnitureId: "coffee-oak-round",    x: 180, z: 180, rotation: 0, scaleW: 0.8, scaleD: 0.8 },
        { furnitureId: "decor-tea-set",       x: 180, z: 180, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-lacquer-bowl",   x: 160, z: 180, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-lacquer-bowl",   x: 200, z: 180, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-floor-cushion",  x: 100, z: 110, rotation: 0 },
        { furnitureId: "proc-floor-cushion",  x: 260, z: 110, rotation: 0 },
        { furnitureId: "proc-futon",          x: 290, z: 305, rotation: 0, scaleW: 0.7, scaleD: 0.7 },
        { furnitureId: "proc-wood-chest",     x: 60,  z: 60,  rotation: 0 },
        // REDESIGN-C-BRIEF: 茶室角柜上添一只漆碗（茶具收纳）
        { furnitureId: "proc-lacquer-bowl",   x: 60,  z: 60,  rotation: 0, elevationY: 60 },
        { furnitureId: "proc-shoji",          x: 180, z: 350, rotation: 0 },
      ],
      hallway: [
        // REDESIGN-C：缘侧坪庭——石灯笼 + 岩石 + 灌木 + 东端竹丛
        { furnitureId: "stone-path",          x: 450, z: 150, rotation: 90 },
        { furnitureId: "proc-bush",           x: 90,  z: 220, rotation: 0 },
        { furnitureId: "proc-rock",           x: 200, z: 80,  rotation: 0 },
        { furnitureId: "proc-stone-lantern",  x: 660, z: 150, rotation: 0 },
        { furnitureId: "proc-rock",           x: 770, z: 220, rotation: 0 },
        { furnitureId: "proc-bamboo-clump",   x: 850, z: 80,  rotation: 0 },
        // REDESIGN-C-BRIEF: 缘侧坪庭补到 10 件——草丛三丛 + 第二盏石灯笼
        { furnitureId: "proc-grass-tuft",     x: 300, z: 220, rotation: 0 },
        { furnitureId: "proc-grass-tuft",     x: 550, z: 80,  rotation: 0 },
        { furnitureId: "proc-grass-tuft",     x: 450, z: 250, rotation: 0 },
        { furnitureId: "proc-stone-lantern",  x: 350, z: 80,  rotation: 0 },
      ],
    },
  ],
};

// ── 韩国韩屋片场（导演台新增；简版）────────────────────────────────────
// 温突（ondol）暖房与木地板大厅（daecheong）并存；纸格门；进门脱鞋；
// 院子保持空旷（不是中式假山石园林）。厨房灶口是全屋供暖的起点。
const HANOK_SET: ProjectTemplate = {
  id: "set-hanok",
  name: "韩国韩屋片场",
  nameEn: "Hanok Set",
  emoji: "🏯",
  description: "片场 · 单层 · 温突房+大厅+厨房+院子 · 110㎡ · 温突/木地板大厅 · 院子空旷 · 拍韩式日常戏",
  descriptionEn: "Film set · 1F · Ondol room + wooden hall + kitchen + empty courtyard · 110㎡ · Ondol heated floor",
  areaSqm: 110,
  palette: ["#EDE6D6", "#5A4A3A", "#C89858"],
  styleTemplateId: "japanese",

  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#EDE6D6",
    windowFrameColor: "#5A4A3A",
    entranceFrameColor: "#2A2018",
    roofOverhang: 1.0,
    parapetHeight: 0,
    roofColor: "#5A4A3A",
    roofSlabColor: "#3A4048",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },

  floorLayouts: [
    {
      id: "hanok-f1",
      name: "韩国韩屋",
      area: 110,
      // 1100×1000cm 矩形拼贴（无缺口）：
      // 上排：温突房 600×650 | 大厅 500×650
      // 下排：厨房 500×350 | 院子 600×350（全墙隐藏 = 空旷院子）
      rooms: [
        { room: "living",   x: 0,   y: 0,   width: 600, depth: 650,
          name: "温突房", nameEn: "Ondol Room", icon: "🔥",
          doors: [{ wall: "S", pos: 250, len: 100, style: "wood_panel", h: 200 }] },
        { room: "master",   x: 600, y: 0,   width: 500, depth: 650,
          name: "大厅", nameEn: "Wooden Hall", icon: "🏯",
          doors: [{ wall: "W", pos: 280, len: 100, style: "wood_panel", h: 200 }],
          // REDESIGN-C: 大厅北墙水墨山水为全屋唯一墙饰（温突房墙面即纸门，不挂画）
          wallDecor: [{ furnitureId: "artwork-inkwash", wall: "N", u: 0.5, v: 0.6 }] },
        { room: "kitchen",  x: 600, y: 650, width: 500, depth: 350,
          name: "厨房", nameEn: "Kitchen", icon: "🍳", exteriorStyle: "concrete" },
        { room: "hallway",  x: 0,   y: 650, width: 600, depth: 350,
          name: "院子", nameEn: "Courtyard", icon: "🌿", wallsHidden: ["N", "S", "E", "W"] },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },

  // 温突房：整间温突地板 + 矮桌 + 坐垫 + 木箱 + 纸门；大厅：木地板（风格
  // 模板地面）+ 矮桌 + 坐垫 + 木箱；厨房：灶口 + 铜锅 + 木箱 + 脸盆。
  // REDESIGN-C：院子仍空旷（不做假山石园林），只添一条石板路 + 灶门外两丛
  // 干草作柴火权宜；大厅不再复制温突房——空 + 一幅水墨 + 冷光，与暖房区分。
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "proc-ondol-floor",    x: 300, z: 325, rotation: 0 },
        { furnitureId: "proc-ondol-table",    x: 300, z: 300, rotation: 0 },
        // REDESIGN-C-BRIEF: 矮桌上摆满——茶具一套 + 饭碗三只（围坐用餐的生活痕迹）
        { furnitureId: "decor-tea-set",      x: 300, z: 285, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-lacquer-bowl",  x: 270, z: 315, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-lacquer-bowl",  x: 330, z: 315, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-lacquer-bowl",  x: 300, z: 320, rotation: 0, elevationY: 30 },
        { furnitureId: "proc-floor-cushion",  x: 200, z: 200, rotation: 0 },
        { furnitureId: "proc-floor-cushion",  x: 400, z: 200, rotation: 0 },
        { furnitureId: "proc-floor-cushion",  x: 200, z: 400, rotation: 0 },
        { furnitureId: "proc-floor-cushion",  x: 400, z: 400, rotation: 0 },
        // 北墙：木箱东移 + 箱上单枝花瓶；折叠被褥 + 两抱枕在旁
        { furnitureId: "proc-wood-chest",    x: 450, z: 80,  rotation: 0 },
        { furnitureId: "decor-vase-single",  x: 450, z: 80,  rotation: 0, elevationY: 60 },
        // REDESIGN-C-BRIEF: 木箱上添书摞（与花瓶并置）
        { furnitureId: "decor-book-stack",   x: 420, z: 80,  rotation: 0, elevationY: 60 },
        { furnitureId: "proc-futon",         x: 130, z: 80,  rotation: 0, scaleW: 0.7, scaleD: 0.7 },
        { furnitureId: "decor-pillows",      x: 270, z: 75,  rotation: 0 },
        { furnitureId: "decor-pillows",      x: 330, z: 75,  rotation: 0 },
        { furnitureId: "proc-shoji",         x: 150, z: 640, rotation: 0 },
        { furnitureId: "proc-shoji",         x: 450, z: 640, rotation: 0 },
        // REDESIGN-C-BRIEF: 南侧再添两只坐垫（六人围坐）
        { furnitureId: "proc-floor-cushion",  x: 200, z: 500, rotation: 0 },
        { furnitureId: "proc-floor-cushion",  x: 400, z: 500, rotation: 0 },
      ],
      master: [
        // 大厅去复制化：撤矮桌 + 四坐垫，只留两垫分坐 + 箱上书堆 + 北墙水墨
        { furnitureId: "proc-wood-chest",    x: 250, z: 80,  rotation: 0 },
        { furnitureId: "decor-book-stack",   x: 250, z: 80,  rotation: 0, elevationY: 60 },
        // REDESIGN-C-BRIEF: 大厅东墙再添一只木箱 + 箱上单枝花瓶
        { furnitureId: "proc-wood-chest",    x: 400, z: 80,  rotation: 0 },
        { furnitureId: "decor-vase-single",  x: 400, z: 80,  rotation: 0, elevationY: 60 },
        { furnitureId: "proc-floor-cushion", x: 150, z: 300, rotation: 0 },
        { furnitureId: "proc-floor-cushion", x: 350, z: 300, rotation: 0 },
        { furnitureId: "proc-shoji",         x: 100, z: 640, rotation: 0 },
        { furnitureId: "proc-shoji",         x: 400, z: 640, rotation: 0 },
        // REDESIGN-C-BRIEF: 大厅南侧添两只坐垫（待客）
        { furnitureId: "proc-floor-cushion", x: 150, z: 450, rotation: 0 },
        { furnitureId: "proc-floor-cushion", x: 350, z: 450, rotation: 0 },
      ],
      kitchen: [
        { furnitureId: "proc-hanok-stove",   x: 250, z: 100, rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 250, z: 100, rotation: 0, elevationY: 80 },
        { furnitureId: "proc-wood-chest",    x: 250, z: 280, rotation: 0 },
        { furnitureId: "decor-copper-pots",  x: 228, z: 280, rotation: 0, elevationY: 60 },
        { furnitureId: "decor-spice-rack",   x: 275, z: 280, rotation: 0, elevationY: 60 },
        { furnitureId: "proc-wood-chest",    x: 80,  z: 120, rotation: 0 },
        // REDESIGN-C-BRIEF: 粮箱上添一只铜锅（灶间收纳）
        { furnitureId: "decor-copper-pots",  x: 80,  z: 120, rotation: 0, elevationY: 60 },
        { furnitureId: "proc-basin",         x: 100, z: 300, rotation: 0 },
        { furnitureId: "proc-basin",         x: 150, z: 300, rotation: 0 },
        { furnitureId: "decor-pots-pans",    x: 380, z: 100, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "stone-path",         x: 300, z: 175, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 560, z: 120, rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 560, z: 230, rotation: 0 },
        // REDESIGN-C-BRIEF: 院子西侧再添两丛草（仍不做假山园林）
        { furnitureId: "proc-grass-tuft",    x: 80,  z: 80,  rotation: 0 },
        { furnitureId: "proc-grass-tuft",    x: 80,  z: 280, rotation: 0 },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// ── 高频日常场景：学校（7）──
const SCHOOL_PLAYGROUND_SET: ProjectTemplate = {
  id: "set-school-playground",
  name: "学校操场",
  nameEn: "School Playground",
  emoji: "🏀",
  description: "学校操场：篮球场+足球场+跑道边线，课间、运动会、告白与打架的经典外景",
  descriptionEn: "School playground: basketball court, football pitch and track lines — the classic outdoor setting for recess, sports day and showdowns",
  areaSqm: 540,
  palette: ["#E8E4DC", "#B0503A", "#2A5A8A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#B0503A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-school-playground-f1",
      name: "学校操场",
      area: 540,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3000, depth: 1800,
          name: "操场", nameEn: "Playground", icon: "🏀",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-basketball-hoop", x: 750, z: 450, rotation: 0 },
      { furnitureId: "proc-basketball-hoop", x: 2250, z: 450, rotation: 180 },
      { furnitureId: "proc-goal-post", x: 300, z: 1350, rotation: 90 },
      { furnitureId: "proc-goal-post", x: 2700, z: 1350, rotation: 270 },
      { furnitureId: "proc-outdoor-bench", x: 1500, z: 150, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 1500, z: 1650, rotation: 180 },
      { furnitureId: "tree-oak", x: 150, z: 150, rotation: 0 },
      { furnitureId: "tree-oak", x: 2850, z: 150, rotation: 0 },
      { furnitureId: "tree-oak", x: 150, z: 1650, rotation: 0 },
      { furnitureId: "tree-oak", x: 2850, z: 1650, rotation: 0 },
      { furnitureId: "lawn-patch", x: 1500, z: 900, rotation: 0 },
      { furnitureId: "stone-path", x: 1500, z: 900, rotation: 90 },
    ],
    },
  ],
};

const SCHOOL_LIBRARY_SET: ProjectTemplate = {
  id: "set-school-library",
  name: "学校图书馆",
  nameEn: "School Library",
  emoji: "📚",
  description: "学校图书馆：阅览室+书库，考试周、自习、偶遇与表白的安静角落",
  descriptionEn: "School library: reading room and stacks — the quiet corner for exam week, self-study and chance encounters",
  areaSqm: 150,
  palette: ["#E8E0D0", "#8A6A42", "#2A4A6A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E0D0",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#8A6A42",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-school-library-f1",
      name: "学校图书馆",
      area: 150,
      rooms: [
        { room: "study", x: 0, y: 0, width: 900, depth: 700,
          name: "阅览室", nameEn: "Reading Room", icon: "📖",
          doors: [{ wall: "S", pos: 450, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 450, len: 240, style: "wooden", h: 150, sill: 90 }, { wall: "E", pos: 350, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "study2", x: 900, y: 0, width: 600, depth: 700,
          name: "书库", nameEn: "Stacks", icon: "📚",
          doors: [{ wall: "W", pos: 350, len: 100, style: "wood_panel", h: 200 }], },
        { room: "hallway", x: 0, y: 700, width: 1500, depth: 300,
          name: "走廊", nameEn: "Corridor", icon: "🚶",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    study: [
      { furnitureId: "proc-library-shelf", x: 150, z: 25, rotation: 0 },
      { furnitureId: "proc-library-shelf", x: 450, z: 25, rotation: 0 },
      { furnitureId: "proc-library-shelf", x: 750, z: 25, rotation: 0 },
      { furnitureId: "dining-oak-rect", x: 250, z: 350, rotation: 0 },
      { furnitureId: "dining-oak-rect", x: 650, z: 350, rotation: 0 },
      { furnitureId: "chair-nordic-oak", x: 180, z: 350, rotation: 90 },
      { furnitureId: "chair-nordic-oak", x: 320, z: 350, rotation: 270 },
      { furnitureId: "chair-nordic-oak", x: 580, z: 350, rotation: 90 },
      { furnitureId: "chair-nordic-oak", x: 720, z: 350, rotation: 270 },
      { furnitureId: "desk-study", x: 450, z: 600, rotation: 180 },
      { furnitureId: "chair-nordic-oak", x: 450, z: 670, rotation: 0 },
    ],
    study2: [
      { furnitureId: "proc-library-shelf", x: 150, z: 150, rotation: 0 },
      { furnitureId: "proc-library-shelf", x: 150, z: 350, rotation: 0 },
      { furnitureId: "proc-library-shelf", x: 150, z: 550, rotation: 0 },
      { furnitureId: "proc-library-shelf", x: 450, z: 150, rotation: 0 },
      { furnitureId: "proc-library-shelf", x: 450, z: 350, rotation: 0 },
      { furnitureId: "proc-library-shelf", x: 450, z: 550, rotation: 0 },
    ],
    hallway: [],
    },
  ],
};

const SCHOOL_CAFETERIA_SET: ProjectTemplate = {
  id: "set-school-cafeteria",
  name: "学校饭堂",
  nameEn: "School Cafeteria",
  emoji: "🍽️",
  description: "学校饭堂：打饭窗口+长桌，午饭、抢饭、食堂偶遇的烟火气场景",
  descriptionEn: "School cafeteria: serving counters and long tables — lunch rush, food queues and canteen encounters",
  areaSqm: 144,
  palette: ["#E8E4DC", "#C8C0B0", "#A08050"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#C8C0B0",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-school-cafeteria-f1",
      name: "学校饭堂",
      area: 144,
      rooms: [
        { room: "dining", x: 0, y: 0, width: 1200, depth: 800,
          name: "饭堂", nameEn: "Dining Hall", icon: "🍽️",
          doors: [{ wall: "E", pos: 400, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 600, len: 240, style: "wooden", h: 150, sill: 90 }, { wall: "S", pos: 600, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "kitchen", x: 1200, y: 0, width: 600, depth: 800,
          name: "打饭区", nameEn: "Serving Area", icon: "🍲",
          doors: [{ wall: "W", pos: 400, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "E", pos: 400, len: 240, style: "wooden", h: 150, sill: 90 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    dining: [
      { furnitureId: "proc-cafeteria-table", x: 300, z: 250, rotation: 0 },
      { furnitureId: "proc-cafeteria-table", x: 300, z: 500, rotation: 0 },
      { furnitureId: "proc-cafeteria-table", x: 900, z: 250, rotation: 0 },
      { furnitureId: "proc-cafeteria-table", x: 900, z: 500, rotation: 0 },
      { furnitureId: "proc-whiteboard", x: 600, z: 8, rotation: 0, elevationY: 90 },
      { furnitureId: "plant-sansevieria", x: 60, z: 740, rotation: 0 },
    ],
    kitchen: [
      { furnitureId: "proc-serving-counter", x: 60, z: 250, rotation: 90 },
      { furnitureId: "proc-serving-counter", x: 60, z: 550, rotation: 90 },
      { furnitureId: "proc-serving-counter", x: 300, z: 45, rotation: 0 },
      { furnitureId: "fridge-single-white", x: 550, z: 60, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 550, z: 750, rotation: 0 },
    ],
    },
  ],
};

const SCHOOL_BATHROOM_SET: ProjectTemplate = {
  id: "set-school-bathroom",
  name: "学校浴室",
  nameEn: "School Bathroom",
  emoji: "🚿",
  description: "学校浴室：淋浴区+盥洗厕位区，澡堂、更衣、青春日常的私密场景",
  descriptionEn: "School bathroom: shower area and washroom stalls — the bathhouse, locker and everyday youth setting",
  areaSqm: 96,
  palette: ["#DCE8E8", "#B8C8C8", "#2A6A6A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#DCE8E8",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#B8C8C8",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-school-bathroom-f1",
      name: "学校浴室",
      area: 96,
      rooms: [
        { room: "bathroom", x: 0, y: 0, width: 600, depth: 500,
          name: "淋浴区", nameEn: "Shower Area", icon: "🚿",
          doors: [{ wall: "S", pos: 300, len: 100, style: "wood_panel", h: 200 }], },
        { room: "bathroom2", x: 600, y: 0, width: 600, depth: 500,
          name: "盥洗/厕位区", nameEn: "Washroom & Stalls", icon: "🚻",
          doors: [{ wall: "S", pos: 300, len: 100, style: "wood_panel", h: 200 }, { wall: "W", pos: 250, len: 100, style: "wood_panel", h: 200 }], },
        { room: "hallway", x: 0, y: 500, width: 1200, depth: 300,
          name: "更衣/入口", nameEn: "Changing & Entrance", icon: "🚶",
          doors: [{ wall: "N", pos: 300, len: 100, style: "wood_panel", h: 200 }, { wall: "N", pos: 900, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    bathroom: [
      { furnitureId: "shower-enclosed", x: 120, z: 120, rotation: 0 },
      { furnitureId: "shower-enclosed", x: 300, z: 120, rotation: 0 },
      { furnitureId: "shower-enclosed", x: 480, z: 120, rotation: 0 },
      { furnitureId: "shower-enclosed", x: 120, z: 320, rotation: 0 },
      { furnitureId: "shower-enclosed", x: 300, z: 320, rotation: 0 },
      { furnitureId: "shower-enclosed", x: 480, z: 320, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 300, z: 450, rotation: 0 },
    ],
    bathroom2: [
      { furnitureId: "toilet-standard", x: 100, z: 80, rotation: 0 },
      { furnitureId: "toilet-standard", x: 250, z: 80, rotation: 0 },
      { furnitureId: "toilet-standard", x: 400, z: 80, rotation: 0 },
      { furnitureId: "urinal-wall", x: 100, z: 420, rotation: 180 },
      { furnitureId: "urinal-wall", x: 250, z: 420, rotation: 180 },
      { furnitureId: "urinal-wall", x: 400, z: 420, rotation: 180 },
      { furnitureId: "vanity-single-white", x: 520, z: 120, rotation: 270 },
      { furnitureId: "vanity-single-white", x: 520, z: 300, rotation: 270 },
    ],
    hallway: [
      { furnitureId: "proc-outdoor-bench", x: 300, z: 150, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 60, z: 150, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 1140, z: 150, rotation: 0 },
    ],
    },
  ],
};

const SCHOOL_WATERROOM_SET: ProjectTemplate = {
  id: "set-school-waterroom",
  name: "学校水房",
  nameEn: "School Water Room",
  emoji: "🚰",
  description: "学校水房：开水房——三面水龙头排+排队空地，打水、等水、夜谈的校园日常",
  descriptionEn: "School water room: the communal hot-water room — rows of hot-water taps and a queue area, the daily ritual of fetching boiling water",
  areaSqm: 72,
  palette: ["#DCE8E8", "#B8C8C8", "#C03028"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#DCE8E8",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#B8C8C8",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-school-waterroom-f1",
      name: "学校水房",
      area: 72,
      rooms: [
        { room: "equipment_room", x: 0, y: 0, width: 800, depth: 600,
          name: "水房", nameEn: "Water Room", icon: "🚰",
          doors: [{ wall: "S", pos: 400, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 400, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "hallway", x: 0, y: 600, width: 800, depth: 300,
          name: "排队区", nameEn: "Queue Area", icon: "🚶",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    equipment_room: [
      { furnitureId: "proc-water-tap-row", x: 200, z: 35, rotation: 0 },
      { furnitureId: "proc-water-tap-row", x: 600, z: 35, rotation: 0 },
      { furnitureId: "proc-water-tap-row", x: 35, z: 300, rotation: 90 },
      { furnitureId: "proc-thermos", x: 200, z: 35, rotation: 0, elevationY: 105 },
      { furnitureId: "proc-thermos", x: 600, z: 35, rotation: 0, elevationY: 105 },
      { furnitureId: "plant-sansevieria", x: 750, z: 550, rotation: 0 },
    ],
    hallway: [
      { furnitureId: "proc-outdoor-bench", x: 400, z: 150, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 60, z: 150, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 740, z: 150, rotation: 0 },
    ],
    },
  ],
};

const SCHOOL_PARKING_SET: ProjectTemplate = {
  id: "set-school-parking",
  name: "学校停车场",
  nameEn: "School Parking Lot",
  emoji: "🅿️",
  description: "学校停车场：两排车位+车挡，上下学、接送、车内对话的露天场景",
  descriptionEn: "School parking lot: two rows of bays with wheel stops — drop-offs, pick-ups and in-car conversations",
  areaSqm: 540,
  palette: ["#E8E4DC", "#8A8A8A", "#F5D020"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#8A8A8A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-school-parking-f1",
      name: "学校停车场",
      area: 540,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3000, depth: 1800,
          name: "停车场", nameEn: "Parking Lot", icon: "🅿️",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "vehicle.bmw_m3_e46", x: 400, z: 450, rotation: 0 },
      { furnitureId: "vehicle.porsche_911", x: 800, z: 450, rotation: 0 },
      { furnitureId: "vehicle.bmw_m5_g90", x: 1200, z: 450, rotation: 0 },
      { furnitureId: "vehicle.vino", x: 1500, z: 450, rotation: 0 },
      { furnitureId: "vehicle.bmw_m3_e46", x: 400, z: 1350, rotation: 180 },
      { furnitureId: "vehicle.porsche_911", x: 800, z: 1350, rotation: 180 },
      { furnitureId: "vehicle.cyberpunk_car", x: 1200, z: 1350, rotation: 180 },
      { furnitureId: "proc-parking-stop", x: 400, z: 700, rotation: 0 },
      { furnitureId: "proc-parking-stop", x: 800, z: 700, rotation: 0 },
      { furnitureId: "proc-parking-stop", x: 1200, z: 700, rotation: 0 },
      { furnitureId: "proc-parking-stop", x: 400, z: 1100, rotation: 0 },
      { furnitureId: "proc-parking-stop", x: 800, z: 1100, rotation: 0 },
      { furnitureId: "proc-parking-stop", x: 1200, z: 1100, rotation: 0 },
      { furnitureId: "tree-oak", x: 200, z: 150, rotation: 0 },
      { furnitureId: "tree-oak", x: 2800, z: 150, rotation: 0 },
      { furnitureId: "tree-oak", x: 200, z: 1650, rotation: 0 },
      { furnitureId: "tree-oak", x: 2800, z: 1650, rotation: 0 },
      { furnitureId: "lawn-patch", x: 2000, z: 900, rotation: 0 },
      { furnitureId: "lawn-patch", x: 2500, z: 900, rotation: 0 },
      { furnitureId: "stone-path", x: 1500, z: 900, rotation: 90 },
    ],
    },
  ],
};

const SCHOOL_TRACK_SET: ProjectTemplate = {
  id: "set-school-track",
  name: "学校田径场",
  nameEn: "School Track Field",
  emoji: "🏃",
  description: "学校田径场：红色跑道+足球门+草坪，运动会、晨跑、终点线冲刺的场景",
  descriptionEn: "School track field: red running track, football goal and lawn — sports day, morning runs and finish-line sprints",
  areaSqm: 720,
  palette: ["#E8E4DC", "#B0503A", "#3A6A3A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#B0503A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-school-track-f1",
      name: "学校田径场",
      area: 720,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3600, depth: 2000,
          name: "田径场", nameEn: "Track Field", icon: "🏃",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-track-lane", x: 900, z: 300, rotation: 0 },
      { furnitureId: "proc-track-lane", x: 2700, z: 300, rotation: 0 },
      { furnitureId: "proc-goal-post", x: 1800, z: 1500, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 1800, z: 600, rotation: 0 },
      { furnitureId: "lawn-patch", x: 900, z: 1000, rotation: 0 },
      { furnitureId: "lawn-patch", x: 1800, z: 1000, rotation: 0 },
      { furnitureId: "lawn-patch", x: 2700, z: 1000, rotation: 0 },
      { furnitureId: "tree-oak", x: 150, z: 150, rotation: 0 },
      { furnitureId: "tree-oak", x: 3450, z: 150, rotation: 0 },
      { furnitureId: "tree-oak", x: 150, z: 1850, rotation: 0 },
      { furnitureId: "tree-oak", x: 3450, z: 1850, rotation: 0 },
    ],
    },
  ],
};

// ── 高频日常场景：家庭（3）──
const HOME_BEDROOM_SET: ProjectTemplate = {
  id: "set-home-bedroom",
  name: "卧室",
  nameEn: "Bedroom",
  emoji: "🛏️",
  description: "卧室：双人床+衣帽间，起床、夜话、争吵与和好的家庭核心场景",
  descriptionEn: "Bedroom: double bed and walk-in closet — mornings, late-night talks, arguments and reconciliations",
  areaSqm: 28,
  palette: ["#E8E0D4", "#A08060", "#7A6A8A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E0D4",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#A08060",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-home-bedroom-f1",
      name: "卧室",
      area: 28,
      rooms: [
        { room: "master", x: 0, y: 0, width: 500, depth: 400,
          name: "卧室", nameEn: "Bedroom", icon: "🛏️",
          doors: [{ wall: "E", pos: 200, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 250, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "closet", x: 500, y: 0, width: 200, depth: 400,
          name: "衣帽间", nameEn: "Walk-in Closet", icon: "👗",
          doors: [{ wall: "W", pos: 200, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    master: [
      { furnitureId: "bed-fabric-beige", x: 250, z: 130, rotation: 0 },
      { furnitureId: "nightstand-oak", x: 120, z: 40, rotation: 0 },
      { furnitureId: "nightstand-oak", x: 380, z: 40, rotation: 0 },
      { furnitureId: "proc-thermos", x: 120, z: 40, rotation: 0, elevationY: 60 },
      { furnitureId: "lamp-arc-gold", x: 120, z: 320, rotation: 0 },
      { furnitureId: "dresser-nordic-white", x: 450, z: 60, rotation: 270 },
      { furnitureId: "desk-study", x: 430, z: 300, rotation: 180 },
      { furnitureId: "chair-nordic-oak", x: 430, z: 370, rotation: 0 },
      { furnitureId: "rug-nordic-geo", x: 250, z: 300, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 40, z: 360, rotation: 0 },
    ],
    closet: [
      { furnitureId: "wardrobe-solid-walnut", x: 100, z: 60, rotation: 0 },
      { furnitureId: "wardrobe-open-rack", x: 100, z: 180, rotation: 0 },
      { furnitureId: "closet-island-white", x: 100, z: 300, rotation: 0 },
    ],
    },
  ],
};

const HOME_KITCHEN_SET: ProjectTemplate = {
  id: "set-home-kitchen",
  name: "厨房",
  nameEn: "Kitchen",
  emoji: "🍳",
  description: "厨房：中式厨房+早餐区，做饭、偷吃、深夜谈心的高频家庭场景",
  descriptionEn: "Kitchen: Chinese kitchen and breakfast nook — cooking, sneaking snacks and late-night heart-to-hearts",
  areaSqm: 28,
  palette: ["#E8E4DC", "#C8C0B0", "#C05028"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#C8C0B0",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-home-kitchen-f1",
      name: "厨房",
      area: 28,
      rooms: [
        { room: "kitchen", x: 0, y: 0, width: 500, depth: 350,
          name: "厨房", nameEn: "Kitchen", icon: "🍳",
          doors: [{ wall: "E", pos: 175, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 250, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "dining", x: 500, y: 0, width: 300, depth: 350,
          name: "早餐区", nameEn: "Breakfast Nook", icon: "☕",
          doors: [{ wall: "W", pos: 175, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "E", pos: 175, len: 240, style: "wooden", h: 150, sill: 90 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    kitchen: [
      { furnitureId: "cabinet-lower-white", x: 180, z: 35, rotation: 0 },
      { furnitureId: "sink-double-steel", x: 120, z: 35, rotation: 0, elevationY: 85 },
      { furnitureId: "proc-cooktop", x: 250, z: 35, rotation: 0, elevationY: 85 },
      { furnitureId: "hood-side-black", x: 250, z: 35, rotation: 0, elevationY: 150 },
      { furnitureId: "cabinet-lower-white", x: 180, z: 315, rotation: 180 },
      { furnitureId: "proc-thermos", x: 120, z: 315, rotation: 0, elevationY: 85 },
      { furnitureId: "proc-basin", x: 250, z: 315, rotation: 0, elevationY: 85 },
      { furnitureId: "fridge-french-door", x: 430, z: 50, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 470, z: 300, rotation: 0 },
    ],
    dining: [
      { furnitureId: "dining-marble-round", x: 150, z: 150, rotation: 0 },
      { furnitureId: "chair-nordic-oak", x: 150, z: 70, rotation: 180 },
      { furnitureId: "chair-nordic-oak", x: 150, z: 230, rotation: 0 },
      { furnitureId: "chair-nordic-oak", x: 70, z: 150, rotation: 90 },
      { furnitureId: "chair-nordic-oak", x: 230, z: 150, rotation: 270 },
      { furnitureId: "plant-sansevieria", x: 270, z: 300, rotation: 0 },
    ],
    },
  ],
};

const HOME_BATHROOM_SET: ProjectTemplate = {
  id: "set-home-bathroom",
  name: "卫生间",
  nameEn: "Bathroom",
  emoji: "🚿",
  description: "卫生间：淋浴区+盥洗区，洗漱、镜前独白、浴室谈话的私密场景",
  descriptionEn: "Bathroom: shower area and vanity — washing up, mirror monologues and private bathroom talks",
  areaSqm: 18,
  palette: ["#DCE8E8", "#B8C8C8", "#2A6A6A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#DCE8E8",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#B8C8C8",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-home-bathroom-f1",
      name: "卫生间",
      area: 18,
      rooms: [
        { room: "bathroom", x: 0, y: 0, width: 300, depth: 300,
          name: "淋浴区", nameEn: "Shower Area", icon: "🚿",
          doors: [{ wall: "E", pos: 150, len: 100, style: "wood_panel", h: 200 }], },
        { room: "bathroom2", x: 300, y: 0, width: 300, depth: 300,
          name: "盥洗区", nameEn: "Vanity Area", icon: "🪞",
          doors: [{ wall: "W", pos: 150, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    bathroom: [
      { furnitureId: "shower-walkin", x: 150, z: 80, rotation: 0 },
      { furnitureId: "bathtub-freestanding", x: 150, z: 220, rotation: 0 },
    ],
    bathroom2: [
      { furnitureId: "toilet-standard", x: 100, z: 80, rotation: 0 },
      { furnitureId: "vanity-single-white", x: 220, z: 60, rotation: 0 },
      { furnitureId: "proc-basin", x: 220, z: 60, rotation: 0, elevationY: 80 },
      { furnitureId: "proc-mirror-wall", x: 150, z: 12, rotation: 0 },
    ],
    },
  ],
};

// ── 高频日常场景：公司（5）──
const OFFICE_CEO_SET: ProjectTemplate = {
  id: "set-office-ceo",
  name: "总裁办公室",
  nameEn: "CEO Office",
  emoji: "💼",
  description: "总裁办公室：大班台+会客区，霸总、谈判、深夜加班的都市剧核心场景",
  descriptionEn: "CEO office: executive desk and lounge — the heart of modern CEO dramas: negotiations, power plays and late nights",
  areaSqm: 66,
  palette: ["#E8E0D0", "#6A4A2A", "#C8A24A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E0D0",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#6A4A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-office-ceo-f1",
      name: "总裁办公室",
      area: 66,
      rooms: [
        { room: "study", x: 0, y: 0, width: 700, depth: 600,
          name: "总裁办公室", nameEn: "CEO Office", icon: "💼",
          doors: [{ wall: "E", pos: 300, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 350, len: 240, style: "wooden", h: 150, sill: 90 }, { wall: "S", pos: 350, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "study2", x: 700, y: 0, width: 400, depth: 600,
          name: "会客区", nameEn: "Lounge", icon: "🛋️",
          doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "E", pos: 300, len: 240, style: "wooden", h: 150, sill: 90 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    study: [
      { furnitureId: "proc-ceo-desk", x: 350, z: 200, rotation: 0 },
      { furnitureId: "chair-ergonomic", x: 350, z: 320, rotation: 180 },
      { furnitureId: "decor-books-pile", x: 300, z: 200, rotation: 0, elevationY: 78 },
      { furnitureId: "bookshelf-with-books", x: 60, z: 150, rotation: 90 },
      { furnitureId: "bookshelf-with-books", x: 60, z: 350, rotation: 90 },
      { furnitureId: "plant-monstera", x: 650, z: 60, rotation: 0 },
      { furnitureId: "lamp-arc-gold", x: 650, z: 500, rotation: 0 },
      { furnitureId: "rug-nordic-geo", x: 350, z: 450, rotation: 0 },
    ],
    study2: [
      { furnitureId: "sofa-leather-brown", x: 200, z: 120, rotation: 0 },
      { furnitureId: "coffee-marble-rect", x: 200, z: 280, rotation: 0 },
      { furnitureId: "chair-modern-gray", x: 80, z: 400, rotation: 0 },
      { furnitureId: "chair-modern-gray", x: 320, z: 400, rotation: 0 },
      { furnitureId: "bookshelf-solid-walnut", x: 350, z: 120, rotation: 270 },
      { furnitureId: "plant-sansevieria", x: 350, z: 550, rotation: 0 },
    ],
    },
  ],
};

const OFFICE_MEETING_SET: ProjectTemplate = {
  id: "set-office-meeting",
  name: "会议室",
  nameEn: "Meeting Room",
  emoji: "🗂️",
  description: "会议室：长桌+白板+资料区，开会、提案、摊牌与对峙的职场场景",
  descriptionEn: "Meeting room: long table, whiteboard and archive corner — pitches, showdowns and boardroom confrontations",
  areaSqm: 72,
  palette: ["#E8E4DC", "#8A8A8A", "#2A4A6A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#8A8A8A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-office-meeting-f1",
      name: "会议室",
      area: 72,
      rooms: [
        { room: "study", x: 0, y: 0, width: 800, depth: 600,
          name: "会议室", nameEn: "Meeting Room", icon: "🗂️",
          doors: [{ wall: "E", pos: 300, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 400, len: 240, style: "wooden", h: 150, sill: 90 }, { wall: "S", pos: 400, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "study2", x: 800, y: 0, width: 400, depth: 600,
          name: "资料区", nameEn: "Archive Corner", icon: "📁",
          doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    study: [
      { furnitureId: "proc-meeting-table", x: 400, z: 300, rotation: 0 },
      { furnitureId: "chair-ergonomic", x: 300, z: 200, rotation: 180 },
      { furnitureId: "chair-ergonomic", x: 500, z: 200, rotation: 180 },
      { furnitureId: "chair-ergonomic", x: 300, z: 400, rotation: 0 },
      { furnitureId: "chair-ergonomic", x: 500, z: 400, rotation: 0 },
      { furnitureId: "chair-ergonomic", x: 180, z: 300, rotation: 90 },
      { furnitureId: "chair-ergonomic", x: 620, z: 300, rotation: 270 },
      { furnitureId: "proc-whiteboard", x: 400, z: 8, rotation: 0, elevationY: 90 },
      { furnitureId: "plant-monstera", x: 60, z: 60, rotation: 0 },
      { furnitureId: "plant-monstera", x: 740, z: 60, rotation: 0 },
    ],
    study2: [
      { furnitureId: "bookshelf-with-books", x: 100, z: 100, rotation: 0 },
      { furnitureId: "bookshelf-with-books", x: 100, z: 250, rotation: 0 },
      { furnitureId: "desk-study", x: 250, z: 150, rotation: 270 },
      { furnitureId: "decor-books-pile", x: 250, z: 150, rotation: 0, elevationY: 75 },
      { furnitureId: "chair-nordic-oak", x: 250, z: 320, rotation: 0 },
    ],
    },
  ],
};

const OFFICE_LOBBY_SET: ProjectTemplate = {
  id: "set-office-lobby",
  name: "公司大堂",
  nameEn: "Office Lobby",
  emoji: "🛎️",
  description: "公司大堂：前台+等候区，入职、面试、等人与偶遇的职场门面场景",
  descriptionEn: "Office lobby: reception desk and waiting area — first days, interviews, waiting and chance meetings",
  areaSqm: 100,
  palette: ["#E8E4DC", "#B8B8B8", "#8A7A5A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#B8B8B8",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-office-lobby-f1",
      name: "公司大堂",
      area: 100,
      rooms: [
        { room: "living", x: 0, y: 0, width: 1000, depth: 700,
          name: "大堂", nameEn: "Lobby", icon: "🛎️",
          doors: [{ wall: "S", pos: 500, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 500, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "hallway", x: 0, y: 700, width: 1000, depth: 300,
          name: "入口走廊", nameEn: "Entrance Corridor", icon: "🚶",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    living: [
      { furnitureId: "proc-reception-desk", x: 500, z: 120, rotation: 0 },
      { furnitureId: "sofa-modular-green", x: 500, z: 450, rotation: 0 },
      { furnitureId: "coffee-oak-round", x: 500, z: 600, rotation: 0 },
      { furnitureId: "plant-monstera", x: 80, z: 100, rotation: 0 },
      { furnitureId: "plant-monstera", x: 920, z: 100, rotation: 0 },
      { furnitureId: "lamp-arc-gold", x: 80, z: 600, rotation: 0 },
    ],
    hallway: [
      { furnitureId: "proc-outdoor-bench", x: 500, z: 150, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 80, z: 150, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 920, z: 150, rotation: 0 },
    ],
    },
  ],
};

const OFFICE_PANTRY_SET: ProjectTemplate = {
  id: "set-office-pantry",
  name: "茶水间",
  nameEn: "Office Pantry",
  emoji: "🍵",
  description: "茶水间：茶水柜台+休息区，摸鱼、八卦、深夜加班热水的职场角落",
  descriptionEn: "Office pantry: tea counter and break corner — coffee breaks, gossip and late-night overtime",
  areaSqm: 36,
  palette: ["#E8E4DC", "#C8C0B0", "#3A6A5A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#C8C0B0",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-office-pantry-f1",
      name: "茶水间",
      area: 36,
      rooms: [
        { room: "kitchen", x: 0, y: 0, width: 500, depth: 400,
          name: "茶水间", nameEn: "Pantry", icon: "🍵",
          doors: [{ wall: "E", pos: 200, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 250, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "dining", x: 500, y: 0, width: 400, depth: 400,
          name: "休息区", nameEn: "Break Area", icon: "☕",
          doors: [{ wall: "W", pos: 200, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "E", pos: 200, len: 240, style: "wooden", h: 150, sill: 90 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    kitchen: [
      { furnitureId: "proc-pantry-counter", x: 250, z: 40, rotation: 0 },
      { furnitureId: "proc-thermos", x: 150, z: 40, rotation: 0, elevationY: 125 },
      { furnitureId: "cabinet-lower-white", x: 250, z: 350, rotation: 180 },
      { furnitureId: "proc-basin", x: 250, z: 350, rotation: 0, elevationY: 85 },
      { furnitureId: "fridge-single-white", x: 450, z: 60, rotation: 0 },
    ],
    dining: [
      { furnitureId: "dining-black-metal", x: 200, z: 200, rotation: 0 },
      { furnitureId: "chair-industrial-black", x: 120, z: 200, rotation: 90 },
      { furnitureId: "chair-industrial-black", x: 280, z: 200, rotation: 270 },
      { furnitureId: "sofa-nordic-blue", x: 200, z: 320, rotation: 180 },
      { furnitureId: "plant-sansevieria", x: 350, z: 60, rotation: 0 },
    ],
    },
  ],
};

const OFFICE_ELEVATOR_SET: ProjectTemplate = {
  id: "set-office-elevator",
  name: "电梯",
  nameEn: "Elevator",
  emoji: "🛗",
  description: "电梯：轿厢+前室，偶遇、独处、对峙与表白的高频密闭场景",
  descriptionEn: "Elevator: car and lobby — chance meetings, trapped-together moments and confessions in a confined space",
  areaSqm: 19,
  palette: ["#D8D8D8", "#8A8A8A", "#C8A24A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#D8D8D8",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#8A8A8A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-office-elevator-f1",
      name: "电梯",
      area: 19,
      rooms: [
        { room: "hallway", x: 0, y: 0, width: 400, depth: 300,
          name: "电梯前室", nameEn: "Elevator Lobby", icon: "🚶",
          doors: [{ wall: "E", pos: 150, len: 100, style: "wood_panel", h: 200 }, { wall: "S", pos: 200, len: 100, style: "wood_panel", h: 200 }], },
        { room: "stair", x: 400, y: 0, width: 240, depth: 300,
          name: "电梯井", nameEn: "Elevator Shaft", icon: "🛗",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    hallway: [
      { furnitureId: "proc-outdoor-bench", x: 200, z: 250, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 50, z: 50, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 350, z: 50, rotation: 0 },
    ],
    stair: [
      { furnitureId: "proc-elevator-car", x: 120, z: 150, rotation: 0 },
    ],
    },
  ],
};

// ── 高频日常场景：联想补充（9）──
const DORMITORY_SET: ProjectTemplate = {
  id: "set-dormitory",
  name: "学生宿舍",
  nameEn: "Student Dormitory",
  emoji: "🛏️",
  description: "学生宿舍：三张上下铺+书桌+阳台，校园剧最高频的寝室场景",
  descriptionEn: "Student dormitory: three bunk beds, desks and a balcony — the most frequent campus-drama setting",
  areaSqm: 70,
  palette: ["#E8E0D0", "#A08060", "#2A4A6A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E0D0",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#A08060",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-dormitory-f1",
      name: "学生宿舍",
      area: 70,
      rooms: [
        { room: "bedroom", x: 0, y: 0, width: 700, depth: 500,
          name: "宿舍", nameEn: "Dorm Room", icon: "🛏️",
          doors: [{ wall: "E", pos: 250, len: 100, style: "wood_panel", h: 200 }, { wall: "S", pos: 350, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 350, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "bathroom2", x: 700, y: 0, width: 300, depth: 500,
          name: "盥洗间", nameEn: "Washroom", icon: "🚿",
          doors: [{ wall: "W", pos: 250, len: 100, style: "wood_panel", h: 200 }], },
        { room: "balcony", x: 0, y: 500, width: 1000, depth: 200,
          name: "阳台", nameEn: "Balcony", icon: "🌿",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    bedroom: [
      { furnitureId: "proc-bunk-bed", x: 150, z: 120, rotation: 0 },
      { furnitureId: "proc-bunk-bed", x: 400, z: 120, rotation: 0 },
      { furnitureId: "proc-bunk-bed", x: 600, z: 120, rotation: 0 },
      { furnitureId: "desk-study", x: 150, z: 400, rotation: 180 },
      { furnitureId: "desk-study", x: 400, z: 400, rotation: 180 },
      { furnitureId: "desk-study", x: 600, z: 400, rotation: 180 },
      { furnitureId: "chair-nordic-oak", x: 150, z: 470, rotation: 0 },
      { furnitureId: "chair-nordic-oak", x: 400, z: 470, rotation: 0 },
      { furnitureId: "chair-nordic-oak", x: 600, z: 470, rotation: 0 },
      { furnitureId: "proc-thermos", x: 150, z: 400, rotation: 0, elevationY: 75 },
      { furnitureId: "decor-books-pile", x: 400, z: 400, rotation: 0, elevationY: 75 },
      { furnitureId: "proc-basin", x: 600, z: 400, rotation: 0, elevationY: 75 },
    ],
    bathroom2: [
      { furnitureId: "toilet-standard", x: 80, z: 100, rotation: 0 },
      { furnitureId: "vanity-single-white", x: 220, z: 80, rotation: 0 },
      { furnitureId: "shower-enclosed", x: 150, z: 350, rotation: 0 },
    ],
    balcony: [
      { furnitureId: "proc-outdoor-bench", x: 500, z: 100, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 100, z: 100, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 900, z: 100, rotation: 0 },
    ],
    },
  ],
};

const HOTEL_ROOM_SET: ProjectTemplate = {
  id: "set-hotel-room",
  name: "酒店房间",
  nameEn: "Hotel Room",
  emoji: "🏨",
  description: "酒店房间：大床房+卫浴+走廊，出差、约会、秘密会面的高频场景",
  descriptionEn: "Hotel room: double-bed room, bath and corridor — business trips, dates and secret meetings",
  areaSqm: 54,
  palette: ["#E8E0D4", "#8A6A42", "#7A6A3A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E0D4",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#8A6A42",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-hotel-room-f1",
      name: "酒店房间",
      area: 54,
      rooms: [
        { room: "master", x: 0, y: 0, width: 600, depth: 450,
          name: "客房", nameEn: "Guest Room", icon: "🛏️",
          doors: [{ wall: "S", pos: 300, len: 100, style: "wood_panel", h: 200 }, { wall: "E", pos: 225, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 300, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "bathroom", x: 600, y: 0, width: 300, depth: 450,
          name: "卫浴", nameEn: "Bathroom", icon: "🚿",
          doors: [{ wall: "W", pos: 225, len: 100, style: "wood_panel", h: 200 }], },
        { room: "hallway", x: 0, y: 450, width: 900, depth: 150,
          name: "走廊", nameEn: "Corridor", icon: "🚶",
          doors: [{ wall: "N", pos: 300, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    master: [
      { furnitureId: "bed-fabric-beige", x: 300, z: 140, rotation: 0 },
      { furnitureId: "nightstand-oak", x: 180, z: 50, rotation: 0 },
      { furnitureId: "nightstand-oak", x: 420, z: 50, rotation: 0 },
      { furnitureId: "proc-thermos", x: 180, z: 50, rotation: 0, elevationY: 60 },
      { furnitureId: "desk-study", x: 500, z: 350, rotation: 180 },
      { furnitureId: "chair-nordic-oak", x: 500, z: 420, rotation: 0 },
      { furnitureId: "tvunit-walnut", x: 300, z: 420, rotation: 180 },
      { furnitureId: "lamp-arc-gold", x: 80, z: 350, rotation: 0 },
      { furnitureId: "rug-nordic-geo", x: 300, z: 300, rotation: 0 },
    ],
    bathroom: [
      { furnitureId: "bathtub-freestanding", x: 150, z: 120, rotation: 0 },
      { furnitureId: "toilet-standard", x: 100, z: 300, rotation: 0 },
      { furnitureId: "vanity-single-white", x: 220, z: 300, rotation: 0 },
      { furnitureId: "proc-basin", x: 220, z: 300, rotation: 0, elevationY: 80 },
    ],
    hallway: [
      { furnitureId: "rug-modern-gray", x: 450, z: 75, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 80, z: 75, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 820, z: 75, rotation: 0 },
    ],
    },
  ],
};

const POLICE_SET: ProjectTemplate = {
  id: "set-police",
  name: "警局",
  nameEn: "Police Station",
  emoji: "👮",
  description: "警局：办公区+审讯室，破案、审讯、案情分析的刑侦场景",
  descriptionEn: "Police station: open office and interrogation room — investigations, interrogations and case analysis",
  areaSqm: 78,
  palette: ["#DCE4E8", "#8A8A8A", "#2A4A6A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#DCE4E8",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#8A8A8A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-police-f1",
      name: "警局",
      area: 78,
      rooms: [
        { room: "study", x: 0, y: 0, width: 900, depth: 600,
          name: "办公区", nameEn: "Office Area", icon: "👮",
          doors: [{ wall: "E", pos: 300, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 450, len: 240, style: "wooden", h: 150, sill: 90 }, { wall: "S", pos: 450, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "study2", x: 900, y: 0, width: 400, depth: 600,
          name: "审讯室", nameEn: "Interrogation Room", icon: "💡",
          doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    study: [
      { furnitureId: "desk-study", x: 200, z: 150, rotation: 0 },
      { furnitureId: "desk-study", x: 500, z: 150, rotation: 0 },
      { furnitureId: "desk-study", x: 200, z: 400, rotation: 0 },
      { furnitureId: "desk-study", x: 500, z: 400, rotation: 0 },
      { furnitureId: "chair-ergonomic", x: 200, z: 230, rotation: 180 },
      { furnitureId: "chair-ergonomic", x: 500, z: 230, rotation: 180 },
      { furnitureId: "chair-ergonomic", x: 200, z: 480, rotation: 180 },
      { furnitureId: "chair-ergonomic", x: 500, z: 480, rotation: 180 },
      { furnitureId: "decor-books-pile", x: 200, z: 150, rotation: 0, elevationY: 75 },
      { furnitureId: "proc-evidence-board", x: 450, z: 8, rotation: 0, elevationY: 90 },
      { furnitureId: "bookshelf-with-books", x: 850, z: 100, rotation: 270 },
      { furnitureId: "plant-monstera", x: 850, z: 500, rotation: 0 },
    ],
    study2: [
      { furnitureId: "desk-study", x: 200, z: 150, rotation: 0 },
      { furnitureId: "chair-nordic-oak", x: 200, z: 230, rotation: 180 },
      { furnitureId: "chair-nordic-oak", x: 200, z: 70, rotation: 0 },
      { furnitureId: "lamp-industrial-black", x: 350, z: 450, rotation: 0 },
      { furnitureId: "proc-wood-stool", x: 100, z: 450, rotation: 0 },
    ],
    },
  ],
};

const COURTROOM_SET: ProjectTemplate = {
  id: "set-courtroom",
  name: "法庭",
  nameEn: "Courtroom",
  emoji: "⚖️",
  description: "法庭：法官席+证人席+原被告席+旁听席，庭审、宣判与辩论的律政场景",
  descriptionEn: "Courtroom: judge's bench, witness stand, counsel tables and gallery — trials, verdicts and arguments",
  areaSqm: 90,
  palette: ["#E8E0D0", "#8A6A42", "#5A3A22"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E0D0",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#8A6A42",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-courtroom-f1",
      name: "法庭",
      area: 90,
      rooms: [
        { room: "living", x: 0, y: 0, width: 1000, depth: 700,
          name: "审判庭", nameEn: "Courtroom", icon: "⚖️",
          doors: [{ wall: "S", pos: 500, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 500, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "hallway", x: 0, y: 700, width: 1000, depth: 200,
          name: "入口", nameEn: "Entrance", icon: "🚶",
          doors: [{ wall: "N", pos: 500, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    living: [
      { furnitureId: "proc-judge-bench", x: 500, z: 100, rotation: 0 },
      { furnitureId: "proc-witness-stand", x: 850, z: 200, rotation: 270 },
      { furnitureId: "desk-study", x: 250, z: 350, rotation: 0 },
      { furnitureId: "desk-study", x: 750, z: 350, rotation: 0 },
      { furnitureId: "chair-ergonomic", x: 250, z: 430, rotation: 180 },
      { furnitureId: "chair-ergonomic", x: 750, z: 430, rotation: 180 },
      { furnitureId: "proc-gilt-chair", x: 200, z: 600, rotation: 0 },
      { furnitureId: "proc-gilt-chair", x: 400, z: 600, rotation: 0 },
      { furnitureId: "proc-gilt-chair", x: 600, z: 600, rotation: 0 },
      { furnitureId: "proc-gilt-chair", x: 800, z: 600, rotation: 0 },
    ],
    hallway: [
      { furnitureId: "proc-outdoor-bench", x: 500, z: 100, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 80, z: 100, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 920, z: 100, rotation: 0 },
    ],
    },
  ],
};

const BAR_SET: ProjectTemplate = {
  id: "set-bar",
  name: "酒吧",
  nameEn: "Bar",
  emoji: "🍸",
  description: "酒吧：吧台+卡座区，买醉、搭讪、深夜谈心的都市夜生活场景",
  descriptionEn: "Bar: counter and booths — drinking, pick-ups and late-night confessions",
  areaSqm: 90,
  palette: ["#2A2018", "#3A2A1A", "#C8A24A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#2A2018",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A2A1A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-bar-f1",
      name: "酒吧",
      area: 90,
      rooms: [
        { room: "living", x: 0, y: 0, width: 1000, depth: 600,
          name: "酒吧大厅", nameEn: "Bar Hall", icon: "🍸",
          doors: [{ wall: "E", pos: 300, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 500, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "dining", x: 1000, y: 0, width: 500, depth: 600,
          name: "卡座区", nameEn: "Booth Area", icon: "🛋️",
          doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    living: [
      { furnitureId: "proc-bar-counter", x: 500, z: 100, rotation: 0 },
      { furnitureId: "chair-industrial-black", x: 400, z: 200, rotation: 180 },
      { furnitureId: "chair-industrial-black", x: 500, z: 200, rotation: 180 },
      { furnitureId: "chair-industrial-black", x: 600, z: 200, rotation: 180 },
      { furnitureId: "sofa-leather-brown", x: 500, z: 450, rotation: 180 },
      { furnitureId: "coffee-marble-rect", x: 500, z: 320, rotation: 0 },
      { furnitureId: "plant-monstera", x: 80, z: 80, rotation: 0 },
      { furnitureId: "plant-monstera", x: 920, z: 80, rotation: 0 },
    ],
    dining: [
      { furnitureId: "sofa-nordic-blue", x: 150, z: 120, rotation: 0 },
      { furnitureId: "dining-black-metal", x: 150, z: 280, rotation: 0 },
      { furnitureId: "sofa-nordic-blue", x: 350, z: 120, rotation: 0 },
      { furnitureId: "dining-black-metal", x: 350, z: 280, rotation: 0 },
      { furnitureId: "lamp-arc-gold", x: 450, z: 500, rotation: 0 },
      { furnitureId: "proc-wood-stool", x: 150, z: 450, rotation: 0 },
      { furnitureId: "proc-wood-stool", x: 350, z: 450, rotation: 0 },
    ],
    },
  ],
};

const GYM_SET: ProjectTemplate = {
  id: "set-gym",
  name: "健身房",
  nameEn: "Gym",
  emoji: "🏋️",
  description: "健身房：跑步机+卧推+哑铃架+更衣淋浴，锻炼、撩人、励志的都市场景",
  descriptionEn: "Gym: treadmills, bench press, dumbbell racks and showers — workouts, flirting and transformation arcs",
  areaSqm: 98,
  palette: ["#E8E4DC", "#3A3A3A", "#C03028"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A3A3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-gym-f1",
      name: "健身房",
      area: 98,
      rooms: [
        { room: "gym", x: 0, y: 0, width: 1000, depth: 700,
          name: "器械区", nameEn: "Equipment Area", icon: "🏋️",
          doors: [{ wall: "E", pos: 350, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 500, len: 240, style: "wooden", h: 150, sill: 90 }, { wall: "S", pos: 500, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "bathroom2", x: 1000, y: 0, width: 400, depth: 700,
          name: "更衣/淋浴区", nameEn: "Changing & Shower Area", icon: "🚿",
          doors: [{ wall: "W", pos: 350, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    gym: [
      { furnitureId: "proc-gym-treadmill", x: 200, z: 150, rotation: 0 },
      { furnitureId: "proc-gym-treadmill", x: 400, z: 150, rotation: 0 },
      { furnitureId: "proc-gym-treadmill", x: 600, z: 150, rotation: 0 },
      { furnitureId: "proc-gym-bench", x: 250, z: 450, rotation: 0 },
      { furnitureId: "proc-gym-bench", x: 550, z: 450, rotation: 0 },
      { furnitureId: "proc-dumbbell-rack", x: 200, z: 650, rotation: 180 },
      { furnitureId: "proc-dumbbell-rack", x: 800, z: 650, rotation: 180 },
      { furnitureId: "proc-mirror-wall", x: 500, z: 12, rotation: 0 },
    ],
    bathroom2: [
      { furnitureId: "shower-enclosed", x: 200, z: 150, rotation: 0 },
      { furnitureId: "shower-enclosed", x: 200, z: 350, rotation: 0 },
      { furnitureId: "toilet-standard", x: 100, z: 550, rotation: 0 },
      { furnitureId: "vanity-single-white", x: 300, z: 550, rotation: 0 },
      { furnitureId: "wardrobe-open-rack", x: 320, z: 150, rotation: 270 },
    ],
    },
  ],
};

const SUPERMARKET_SET: ProjectTemplate = {
  id: "set-supermarket",
  name: "超市",
  nameEn: "Supermarket",
  emoji: "🛒",
  description: "超市：货架区+收银区，购物、偶遇、跟踪与绑架的日常场景",
  descriptionEn: "Supermarket: aisles and checkouts — shopping, encounters, tailing and kidnappings",
  areaSqm: 154,
  palette: ["#E8E4DC", "#C8C8C8", "#C03028"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#E8E4DC",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#C8C8C8",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-supermarket-f1",
      name: "超市",
      area: 154,
      rooms: [
        { room: "living", x: 0, y: 0, width: 1400, depth: 800,
          name: "货架区", nameEn: "Aisles", icon: "🛒",
          doors: [{ wall: "S", pos: 700, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 700, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "hallway", x: 0, y: 800, width: 1400, depth: 300,
          name: "收银区", nameEn: "Checkout Area", icon: "🧾",
          doors: [{ wall: "N", pos: 700, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    living: [
      { furnitureId: "proc-supermarket-shelf", x: 300, z: 200, rotation: 0 },
      { furnitureId: "proc-supermarket-shelf", x: 700, z: 200, rotation: 0 },
      { furnitureId: "proc-supermarket-shelf", x: 1100, z: 200, rotation: 0 },
      { furnitureId: "proc-supermarket-shelf", x: 300, z: 500, rotation: 0 },
      { furnitureId: "proc-supermarket-shelf", x: 700, z: 500, rotation: 0 },
      { furnitureId: "proc-supermarket-shelf", x: 1100, z: 500, rotation: 0 },
      { furnitureId: "proc-shopping-cart", x: 150, z: 650, rotation: 0 },
      { furnitureId: "proc-shopping-cart", x: 1250, z: 650, rotation: 0 },
    ],
    hallway: [
      { furnitureId: "proc-checkout-counter", x: 300, z: 150, rotation: 0 },
      { furnitureId: "proc-checkout-counter", x: 700, z: 150, rotation: 0 },
      { furnitureId: "proc-checkout-counter", x: 1100, z: 150, rotation: 0 },
      { furnitureId: "proc-shopping-cart", x: 150, z: 150, rotation: 0 },
    ],
    },
  ],
};

const KTV_SET: ProjectTemplate = {
  id: "set-ktv",
  name: "KTV",
  nameEn: "KTV Room",
  emoji: "🎤",
  description: "KTV：包间+大屏，唱歌、聚会、谈判与醉酒真言的夜生活场景",
  descriptionEn: "KTV room: private booth with a big screen — singing, parties, negotiations and drunken truths",
  areaSqm: 42,
  palette: ["#3A2A3A", "#2A2A2A", "#C03060"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#3A2A3A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#2A2A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-ktv-f1",
      name: "KTV",
      area: 42,
      rooms: [
        { room: "living", x: 0, y: 0, width: 600, depth: 500,
          name: "包间", nameEn: "Private Room", icon: "🎤",
          doors: [{ wall: "S", pos: 300, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 300, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "hallway", x: 0, y: 500, width: 600, depth: 200,
          name: "入口", nameEn: "Entrance", icon: "🚶",
          doors: [{ wall: "N", pos: 300, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    living: [
      { furnitureId: "proc-ktv-screen", x: 300, z: 8, rotation: 0, elevationY: 90 },
      { furnitureId: "sofa-modular-green", x: 300, z: 350, rotation: 180 },
      { furnitureId: "coffee-marble-rect", x: 300, z: 200, rotation: 0 },
      { furnitureId: "proc-thermos", x: 300, z: 200, rotation: 0, elevationY: 45 },
      { furnitureId: "plant-sansevieria", x: 550, z: 450, rotation: 0 },
      { furnitureId: "lamp-arc-gold", x: 50, z: 450, rotation: 0 },
    ],
    hallway: [
      { furnitureId: "proc-wood-stool", x: 150, z: 100, rotation: 0 },
      { furnitureId: "plant-sansevieria", x: 500, z: 100, rotation: 0 },
    ],
    },
  ],
};

const WEDDING_SET: ProjectTemplate = {
  id: "set-wedding",
  name: "婚礼宴会厅",
  nameEn: "Wedding Banquet Hall",
  emoji: "💐",
  description: "婚礼宴会厅：舞台+拱门+宴会桌，婚礼、抢婚、求婚与豪门宴会的仪式场景",
  descriptionEn: "Wedding banquet hall: stage, arch and banquet tables — weddings, gatecrashes, proposals and grand receptions",
  areaSqm: 168,
  palette: ["#F5F0E8", "#C8A24A", "#E8A0B0"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#F5F0E8",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#C8A24A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-wedding-f1",
      name: "婚礼宴会厅",
      area: 168,
      rooms: [
        { room: "living", x: 0, y: 0, width: 1400, depth: 900,
          name: "宴会厅", nameEn: "Banquet Hall", icon: "💐",
          doors: [{ wall: "S", pos: 700, len: 100, style: "wood_panel", h: 200 }],
          windows: [{ wall: "N", pos: 700, len: 240, style: "wooden", h: 150, sill: 90 }], },
        { room: "hallway", x: 0, y: 900, width: 1400, depth: 300,
          name: "入口/签到区", nameEn: "Entrance & Check-in", icon: "🚶",
          doors: [{ wall: "N", pos: 700, len: 100, style: "wood_panel", h: 200 }], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    living: [
      { furnitureId: "proc-wedding-stage", x: 700, z: 250, rotation: 0 },
      { furnitureId: "proc-wedding-arch", x: 700, z: 550, rotation: 0 },
      { furnitureId: "dining-oak-rect", x: 250, z: 700, rotation: 0 },
      { furnitureId: "dining-oak-rect", x: 700, z: 700, rotation: 0 },
      { furnitureId: "dining-oak-rect", x: 1150, z: 700, rotation: 0 },
      { furnitureId: "chair-nordic-oak", x: 175, z: 700, rotation: 90 },
      { furnitureId: "chair-nordic-oak", x: 325, z: 700, rotation: 270 },
      { furnitureId: "chair-nordic-oak", x: 625, z: 700, rotation: 90 },
      { furnitureId: "chair-nordic-oak", x: 775, z: 700, rotation: 270 },
      { furnitureId: "chair-nordic-oak", x: 1075, z: 700, rotation: 90 },
      { furnitureId: "chair-nordic-oak", x: 1225, z: 700, rotation: 270 },
      { furnitureId: "proc-chandelier-crystal", x: 350, z: 450, rotation: 0, mountCeiling: true },
      { furnitureId: "proc-chandelier-crystal", x: 700, z: 450, rotation: 0, mountCeiling: true },
      { furnitureId: "proc-chandelier-crystal", x: 1050, z: 450, rotation: 0, mountCeiling: true },
      { furnitureId: "proc-gilt-chair", x: 400, z: 250, rotation: 90 },
      { furnitureId: "proc-gilt-chair", x: 1000, z: 250, rotation: 270 },
    ],
    hallway: [
      { furnitureId: "sideboard-walnut", x: 300, z: 150, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 700, z: 150, rotation: 0 },
      { furnitureId: "plant-monstera", x: 1200, z: 150, rotation: 0 },
    ],
    },
  ],
};

// ── 繁荣/衰败成对场景（第 5 批；11 对 = 22 个片场）───────────────────────
// 每对共用一个 floorLayouts 工厂函数（同一地点的前后两态， footprint 与
// 房间拼贴完全一致，只有 furnitureOverrides / palette / 描述不同）；
// 衰败态只用本批新增的衰败通用件 + 少量残留旧件，不引入对时代锁的破
// 坏（毁坏的唐长安不出现清代雕花与电灯，毁坏的圆明园不出现现代家具）。
function pairExterior(wallColor: string, roofColor: string): Partial<ExteriorSettings> {
  return {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor,
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor,
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  };
}

// ── 1. 盛唐长安 / 安史后长安 ─────────────────────────────────────────────
// 朱雀大街（露天）+ 东市 + 西市，1800×1200 = 216㎡。盛唐：牌楼、摊位、
// 灯笼杆、石板路；安史后：牌楼倒塌消失，断墙、瓦砾、焦梁、枯树、荒草。
function tangChanganLayout(): FloorplanLayout {
  return {
    id: "tang-changan-f1",
    name: "唐长安",
    area: 216,
    rooms: [
      { room: "yard", x: 0, y: 0, width: 1800, depth: 700,
        name: "朱雀大街", nameEn: "Zhuque Avenue", icon: "🛣️",
        wallsHidden: ["N", "S", "E", "W"] },
      { room: "living", x: 0, y: 700, width: 900, depth: 500,
        name: "东市", nameEn: "East Market", icon: "🏪",
        doors: [{ wall: "N", pos: 450, len: 150, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 900, y: 700, width: 900, depth: 500,
        name: "西市", nameEn: "West Market", icon: "🏪",
        doors: [{ wall: "N", pos: 450, len: 150, style: "wood_panel", h: 210 }] },
    ],
  };
}

const TANG_CHANGAN_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-tang-changan-prosperous",
  name: "盛唐长安片场",
  nameEn: "Prosperous Tang Chang'an Set",
  emoji: "🏮",
  description: "片场 · 单层 · 朱雀大街+东市+西市 · 216㎡ · 盛唐长安 · 拍长安繁华/市集/灯会戏",
  descriptionEn: "Film set · 1F · Zhuque Avenue + East/West Markets · 216㎡ · Tang Chang'an in its prime",
  areaSqm: 216,
  palette: ["#E8DCC8", "#3A2A1A", "#C03028"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#E8DCC8", "#3A2A1A"),
  floorLayouts: [tangChanganLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-pailou", x: 900, z: 350, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 450, z: 350, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 1350, z: 350, rotation: 0 },
        { furnitureId: "proc-lantern-pole", x: 250, z: 120, rotation: 0 },
        { furnitureId: "proc-lantern-pole", x: 1550, z: 120, rotation: 0 },
        { furnitureId: "proc-lantern-pole", x: 250, z: 580, rotation: 0 },
        { furnitureId: "proc-lantern-pole", x: 1550, z: 580, rotation: 0 },
        { furnitureId: "stone-path", x: 150, z: 350, rotation: 90 },
        { furnitureId: "stone-path", x: 1650, z: 350, rotation: 90 },
        { furnitureId: "storage-crate", x: 650, z: 150, rotation: 0 },
        { furnitureId: "storage-crate", x: 1150, z: 150, rotation: 0 },
      ],
      living: [
        { furnitureId: "proc-market-stall", x: 250, z: 250, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 650, z: 250, rotation: 0 },
        { furnitureId: "storage-crate", x: 450, z: 120, rotation: 0 },
        { furnitureId: "storage-crate", x: 450, z: 400, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 150, z: 420, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 750, z: 420, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 60, z: 60, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 840, z: 60, rotation: 0 },
        { furnitureId: "proc-wood-chest", x: 450, z: 60, rotation: 0 },
        { furnitureId: "proc-oil-lamp", x: 450, z: 60, rotation: 0, elevationY: 60 },
      ],
      dining: [
        { furnitureId: "proc-market-stall", x: 250, z: 250, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 650, z: 250, rotation: 0 },
        { furnitureId: "storage-crate", x: 450, z: 120, rotation: 0 },
        { furnitureId: "storage-crate", x: 450, z: 400, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 150, z: 420, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 750, z: 420, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 60, z: 60, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 840, z: 60, rotation: 0 },
        { furnitureId: "proc-wood-chest", x: 450, z: 60, rotation: 0 },
        { furnitureId: "proc-oil-lamp", x: 450, z: 60, rotation: 0, elevationY: 60 },
      ],
    },
  ],
};

const TANG_CHANGAN_RUINED_SET: ProjectTemplate = {
  id: "set-tang-changan-ruined",
  name: "安史后长安片场",
  nameEn: "Ruined Tang Chang'an Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 朱雀大街+东市+西市 · 216㎡ · 安史之乱后长安 · 拍战后萧条/废墟/流亡戏",
  descriptionEn: "Film set · 1F · Zhuque Avenue + East/West Markets · 216㎡ · Chang'an after the An Lushan rebellion",
  areaSqm: 216,
  palette: ["#8A8378", "#4A4038", "#6A5A42"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#8A8378", "#4A4038"),
  floorLayouts: [tangChanganLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-broken-wall", x: 300, z: 150, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 1500, z: 550, rotation: 90 },
        { furnitureId: "proc-rubble-pile", x: 450, z: 350, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 900, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1350, z: 450, rotation: 0 },
        { furnitureId: "proc-dead-tree", x: 900, z: 600, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 600, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1650, z: 120, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1150, z: 120, rotation: 0 },
        { furnitureId: "proc-burnt-beam", x: 650, z: 350, rotation: 0 },
      ],
      living: [
        { furnitureId: "proc-broken-table", x: 450, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 200, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 700, z: 250, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 450, z: 420, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 100, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 800, z: 420, rotation: 0 },
        { furnitureId: "proc-wood-chest", x: 450, z: 60, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-broken-table", x: 450, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 200, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 700, z: 250, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 200, z: 420, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 800, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 650, z: 420, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 150, z: 150, rotation: 90 },
      ],
    },
  ],
};

// ── 2. 北宋汴京 / 靖康后汴京 ───────────────────────────────────────────────
// 御街（露天）+ 樊楼酒肆 + 茶肆书场，1800×1200 = 216㎡。北宋：牌楼、摊
// 位、灯笼、酒肆茶案；靖康后：断墙、瓦砾、焦梁、枯树、荒草。
function songBianjingLayout(): FloorplanLayout {
  return {
    id: "song-bianjing-f1",
    name: "宋汴京",
    area: 216,
    rooms: [
      { room: "yard", x: 0, y: 0, width: 1800, depth: 700,
        name: "御街", nameEn: "Imperial Avenue", icon: "🛣️",
        wallsHidden: ["N", "S", "E", "W"] },
      { room: "living", x: 0, y: 700, width: 900, depth: 500,
        name: "樊楼酒肆", nameEn: "Fanlou Tavern", icon: "🍶",
        doors: [{ wall: "N", pos: 450, len: 150, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 900, y: 700, width: 900, depth: 500,
        name: "茶肆书场", nameEn: "Teahouse & Storytelling", icon: "🍵",
        doors: [{ wall: "N", pos: 450, len: 150, style: "wood_panel", h: 210 }] },
    ],
  };
}

const SONG_BIANJING_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-song-bianjing-prosperous",
  name: "北宋汴京片场",
  nameEn: "Prosperous Song Bianjing Set",
  emoji: "🎆",
  description: "片场 · 单层 · 御街+樊楼酒肆+茶肆书场 · 216㎡ · 北宋汴京 · 拍清明上河/市井/酒楼戏",
  descriptionEn: "Film set · 1F · Imperial Avenue + Fanlou Tavern + Teahouse · 216㎡ · Northern Song Bianjing in its prime",
  areaSqm: 216,
  palette: ["#EDEBE6", "#6B6257", "#A03028"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#EDEBE6", "#6B6257"),
  floorLayouts: [songBianjingLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-pailou", x: 900, z: 350, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 450, z: 350, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 1350, z: 350, rotation: 0 },
        { furnitureId: "proc-lantern-pole", x: 250, z: 120, rotation: 0 },
        { furnitureId: "proc-lantern-pole", x: 1550, z: 120, rotation: 0 },
        { furnitureId: "proc-lantern-pole", x: 250, z: 580, rotation: 0 },
        { furnitureId: "proc-lantern-pole", x: 1550, z: 580, rotation: 0 },
        { furnitureId: "stone-path", x: 150, z: 350, rotation: 90 },
        { furnitureId: "stone-path", x: 1650, z: 350, rotation: 90 },
        { furnitureId: "storage-crate", x: 650, z: 150, rotation: 0 },
        { furnitureId: "storage-crate", x: 1150, z: 150, rotation: 0 },
      ],
      living: [
        { furnitureId: "desk-study", x: 300, z: 200, rotation: 0 },
        { furnitureId: "desk-study", x: 600, z: 200, rotation: 0 },
        { furnitureId: "desk-study", x: 450, z: 380, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 300, z: 130, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 300, z: 270, rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 600, z: 130, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 600, z: 270, rotation: 180 },
        { furnitureId: "proc-wood-stool", x: 380, z: 320, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 520, z: 320, rotation: 0 },
        { furnitureId: "decor-tea-set", x: 300, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "proc-celadon-vase", x: 600, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "proc-boshanlu", x: 450, z: 380, rotation: 0, elevationY: 75 },
        { furnitureId: "proc-bogujia", x: 450, z: 60, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 60, z: 60, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 840, z: 60, rotation: 0 },
      ],
      dining: [
        { furnitureId: "desk-study", x: 250, z: 200, rotation: 0 },
        { furnitureId: "desk-study", x: 650, z: 200, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 250, z: 130, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 250, z: 270, rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 650, z: 130, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 650, z: 270, rotation: 180 },
        { furnitureId: "proc-wood-stool", x: 450, z: 400, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 450, z: 320, rotation: 0 },
        { furnitureId: "decor-tea-set", x: 250, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "proc-lacquer-bowl", x: 650, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "proc-bogujia", x: 450, z: 60, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 60, z: 60, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 840, z: 60, rotation: 0 },
      ],
    },
  ],
};

const SONG_BIANJING_RUINED_SET: ProjectTemplate = {
  id: "set-song-bianjing-ruined",
  name: "靖康后汴京片场",
  nameEn: "Ruined Song Bianjing Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 御街+樊楼酒肆+茶肆书场 · 216㎡ · 靖康之变后汴京 · 拍国破/萧条/流亡戏",
  descriptionEn: "Film set · 1F · Imperial Avenue + Fanlou Tavern + Teahouse · 216㎡ · Bianjing after the Jingkang Incident",
  areaSqm: 216,
  palette: ["#8A8378", "#4A4038", "#5A5A4A"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#8A8378", "#4A4038"),
  floorLayouts: [songBianjingLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-broken-wall", x: 300, z: 550, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 1500, z: 150, rotation: 90 },
        { furnitureId: "proc-rubble-pile", x: 450, z: 350, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 900, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1350, z: 450, rotation: 0 },
        { furnitureId: "proc-dead-tree", x: 900, z: 600, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 120, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1650, z: 600, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1150, z: 580, rotation: 0 },
        { furnitureId: "proc-burnt-beam", x: 1150, z: 350, rotation: 0 },
      ],
      living: [
        { furnitureId: "proc-broken-table", x: 450, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 200, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 700, z: 250, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 200, z: 420, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 100, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 800, z: 420, rotation: 0 },
        { furnitureId: "proc-burnt-beam", x: 450, z: 80, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-broken-table", x: 450, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 200, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 700, z: 250, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 450, z: 420, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 800, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 650, z: 420, rotation: 0 },
        { furnitureId: "proc-wood-chest", x: 450, z: 60, rotation: 0 },
      ],
    },
  ],
};

// ── 3. 圆明园盛时 / 火烧圆明园后 ──────────────────────────────────────────
// 正大光明殿 + 长春园书房 + 后湖园林，1600×1000 = 160㎡。盛时：鎏金椅、
// 博古架、青花、太湖石、喷泉；火烧后：焦梁、断椅、瓦砾、枯树、倒塌石柱
// （西洋楼大水法残柱之意），喷泉干涸撤去。
function qingGardenLayout(): FloorplanLayout {
  return {
    id: "qing-garden-f1",
    name: "圆明园",
    area: 160,
    rooms: [
      { room: "living", x: 0, y: 0, width: 1000, depth: 600,
        name: "正大光明殿", nameEn: "Hall of Rectitude", icon: "🏯",
        doors: [{ wall: "S", pos: 500, len: 150, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 1000, y: 0, width: 600, depth: 600,
        name: "长春园书房", nameEn: "Changchun Garden Study", icon: "📖",
        doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
      { room: "yard", x: 0, y: 600, width: 1600, depth: 400,
        name: "后湖园林", nameEn: "Back Lake Garden", icon: "🌿",
        wallsHidden: ["N", "S", "E", "W"] },
    ],
  };
}

const QING_GARDEN_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-qing-garden-prosperous",
  name: "圆明园盛时片场",
  nameEn: "Prosperous Yuanmingyuan Set",
  emoji: "🌸",
  description: "片场 · 单层 · 正大光明殿+长春园书房+后湖园林 · 160㎡ · 圆明园盛时 · 拍清宫/园林/盛世戏",
  descriptionEn: "Film set · 1F · Hall of Rectitude + Garden Study + Back Lake · 160㎡ · Yuanmingyuan in its prime",
  areaSqm: 160,
  palette: ["#E8E4D8", "#3A4A2A", "#C8A24A"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#E8E4D8", "#3A4A2A"),
  floorLayouts: [qingGardenLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "proc-gilt-chair", x: 300, z: 200, rotation: 0 },
        { furnitureId: "proc-gilt-chair", x: 700, z: 200, rotation: 0 },
        { furnitureId: "proc-gilt-chair", x: 300, z: 400, rotation: 180 },
        { furnitureId: "proc-gilt-chair", x: 700, z: 400, rotation: 180 },
        { furnitureId: "proc-bogujia", x: 500, z: 60, rotation: 0 },
        { furnitureId: "proc-bluewhite-vase", x: 150, z: 60, rotation: 0 },
        { furnitureId: "proc-bluewhite-vase", x: 850, z: 60, rotation: 0 },
        { furnitureId: "rug-persian", x: 500, z: 300, rotation: 0 },
        { furnitureId: "proc-chandelier-crystal", x: 500, z: 300, rotation: 0, mountCeiling: true },
      ],
      dining: [
        { furnitureId: "desk-study", x: 300, z: 250, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 300, z: 170, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 300, z: 330, rotation: 180 },
        { furnitureId: "proc-celadon-vase", x: 300, z: 250, rotation: 0, elevationY: 75 },
        { furnitureId: "proc-bogujia", x: 300, z: 60, rotation: 0 },
        { furnitureId: "sideboard-walnut", x: 550, z: 300, rotation: 270 },
        { furnitureId: "proc-bluewhite-vase", x: 550, z: 300, rotation: 0, elevationY: 85 },
        { furnitureId: "plant-monstera", x: 60, z: 540, rotation: 0 },
      ],
      yard: [
        { furnitureId: "fountain", x: 800, z: 200, rotation: 0 },
        { furnitureId: "proc-rockery", x: 300, z: 200, rotation: 0 },
        { furnitureId: "proc-rockery", x: 1300, z: 200, rotation: 0 },
        { furnitureId: "plant-monstera", x: 150, z: 200, rotation: 0 },
        { furnitureId: "plant-monstera", x: 1450, z: 200, rotation: 0 },
        { furnitureId: "stone-path", x: 550, z: 200, rotation: 90 },
        { furnitureId: "stone-path", x: 1050, z: 200, rotation: 90 },
      ],
    },
  ],
};

const QING_GARDEN_RUINED_SET: ProjectTemplate = {
  id: "set-qing-garden-ruined",
  name: "火烧圆明园后片场",
  nameEn: "Ruined Yuanmingyuan Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 正大光明殿+长春园书房+后湖园林 · 160㎡ · 火烧圆明园后废墟 · 拍劫后/废墟/凭吊戏",
  descriptionEn: "Film set · 1F · Hall of Rectitude + Garden Study + Back Lake · 160㎡ · Yuanmingyuan ruins after the burning",
  areaSqm: 160,
  palette: ["#7A7668", "#3A3630", "#5A5A4A"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#7A7668", "#3A3630"),
  floorLayouts: [qingGardenLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "proc-burnt-beam", x: 500, z: 300, rotation: 0 },
        { furnitureId: "proc-burnt-beam", x: 500, z: 450, rotation: 90 },
        { furnitureId: "proc-broken-chair", x: 250, z: 200, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 750, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 250, z: 450, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 750, z: 450, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 100, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-broken-wall", x: 500, z: 80, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-broken-table", x: 300, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 150, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 450, z: 250, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 300, z: 450, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 550, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 500, z: 500, rotation: 0 },
      ],
      yard: [
        { furnitureId: "proc-rockery", x: 300, z: 200, rotation: 0 },
        { furnitureId: "proc-dead-tree", x: 800, z: 200, rotation: 0 },
        { furnitureId: "proc-fallen-column", x: 1200, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1450, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 600, z: 300, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1000, z: 300, rotation: 0 },
      ],
    },
  ],
};

// ── 4. 大明宫盛时 / 大明宫废墟 ─────────────────────────────────────────────
// 含元殿 + 宣政殿偏殿 + 丹凤门前廊，1400×900 = 126㎡。盛时：长案宴饮、
// 鎏金椅、青花、石狮、灯笼杆；废墟：断椅、瓦砾、焦梁、倒塌石柱、枯树。
function mingPalaceLayout(): FloorplanLayout {
  return {
    id: "ming-palace-f1",
    name: "大明宫",
    area: 126,
    rooms: [
      { room: "living", x: 0, y: 0, width: 900, depth: 600,
        name: "含元殿", nameEn: "Hanyuan Hall", icon: "🏯",
        doors: [{ wall: "S", pos: 450, len: 150, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 900, y: 0, width: 500, depth: 600,
        name: "宣政殿偏殿", nameEn: "Xuanzheng Side Hall", icon: "🍽️",
        doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
      { room: "hallway", x: 0, y: 600, width: 1400, depth: 300,
        name: "丹凤门前廊", nameEn: "Danfeng Gate Porch", icon: "🌿",
        wallsHidden: ["N", "S", "E", "W"] },
    ],
  };
}

const MING_PALACE_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-ming-palace-prosperous",
  name: "大明宫盛时片场",
  nameEn: "Prosperous Daming Palace Set",
  emoji: "👑",
  description: "片场 · 单层 · 含元殿+宣政殿偏殿+丹凤门前廊 · 126㎡ · 大明宫盛时 · 拍宫廷/朝会/宴饮戏",
  descriptionEn: "Film set · 1F · Hanyuan Hall + Xuanzheng Side Hall + Porch · 126㎡ · Daming Palace in its prime",
  areaSqm: 126,
  palette: ["#E8DCC8", "#8A2010", "#C8A24A"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#E8DCC8", "#8A2010"),
  floorLayouts: [mingPalaceLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "desk-study", x: 330, z: 200, rotation: 0 },
        { furnitureId: "desk-study", x: 450, z: 200, rotation: 0 },
        { furnitureId: "desk-study", x: 570, z: 200, rotation: 0 },
        { furnitureId: "decor-dinnerware-glossy", x: 450, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "decor-spoons-golden", x: 330, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "decor-spoons-golden", x: 570, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "chair-nordic-oak", x: 390, z: 140, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 510, z: 140, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 390, z: 260, rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 510, z: 260, rotation: 180 },
        { furnitureId: "proc-gilt-chair", x: 150, z: 450, rotation: 0 },
        { furnitureId: "proc-gilt-chair", x: 750, z: 450, rotation: 0 },
        { furnitureId: "proc-bogujia", x: 450, z: 60, rotation: 0 },
        { furnitureId: "proc-bluewhite-vase", x: 100, z: 60, rotation: 0 },
        { furnitureId: "proc-bluewhite-vase", x: 800, z: 60, rotation: 0 },
        { furnitureId: "rug-persian", x: 450, z: 350, rotation: 0 },
        { furnitureId: "lamp-chandelier-antique", x: 300, z: 300, rotation: 0, mountCeiling: true },
        { furnitureId: "lamp-chandelier-antique", x: 600, z: 300, rotation: 0, mountCeiling: true },
      ],
      dining: [
        { furnitureId: "dining-marble-round", x: 250, z: 200, rotation: 0 },
        { furnitureId: "decor-fruit-bowl", x: 250, z: 200, rotation: 0, elevationY: 75 },
        { furnitureId: "chair-nordic-oak", x: 250, z: 110, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 250, z: 290, rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 160, z: 200, rotation: 90 },
        { furnitureId: "chair-nordic-oak", x: 340, z: 200, rotation: 270 },
        { furnitureId: "sideboard-walnut", x: 450, z: 40, rotation: 270 },
        { furnitureId: "decor-copper-pots", x: 450, z: 40, rotation: 0, elevationY: 85 },
        { furnitureId: "plant-rubber-tree", x: 40, z: 550, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "proc-lantern-pole", x: 200, z: 150, rotation: 0 },
        { furnitureId: "proc-lantern-pole", x: 1200, z: 150, rotation: 0 },
        { furnitureId: "plant-monstera", x: 500, z: 150, rotation: 0 },
        { furnitureId: "plant-monstera", x: 900, z: 150, rotation: 0 },
        { furnitureId: "stone-path", x: 700, z: 150, rotation: 90 },
        { furnitureId: "decor-statue-lion", x: 100, z: 150, rotation: 0 },
        { furnitureId: "decor-statue-lion", x: 1300, z: 150, rotation: 0 },
      ],
    },
  ],
};

const MING_PALACE_RUINED_SET: ProjectTemplate = {
  id: "set-ming-palace-ruined",
  name: "大明宫废墟片场",
  nameEn: "Ruined Daming Palace Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 含元殿+宣政殿偏殿+丹凤门前廊 · 126㎡ · 大明宫废墟 · 拍王朝倾覆/废墟/凭吊戏",
  descriptionEn: "Film set · 1F · Hanyuan Hall + Xuanzheng Side Hall + Porch · 126㎡ · Daming Palace ruins",
  areaSqm: 126,
  palette: ["#8A8378", "#4A3A30", "#6A5A42"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#8A8378", "#4A3A30"),
  floorLayouts: [mingPalaceLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "proc-broken-table", x: 450, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 200, z: 200, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 700, z: 200, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 200, z: 400, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 700, z: 400, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 450, z: 450, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 100, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-burnt-beam", x: 450, z: 100, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 700, z: 550, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-broken-table", x: 250, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 150, z: 400, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 250, z: 450, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 450, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 400, z: 100, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "proc-fallen-column", x: 450, z: 150, rotation: 0 },
        { furnitureId: "proc-dead-tree", x: 1000, z: 150, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 150, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1250, z: 150, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 700, z: 150, rotation: 0 },
      ],
    },
  ],
};

// ── 5. 罗马鼎盛 / 罗马陷落后 ───────────────────────────────────────────────
// 罗马广场（露天）+ 元老院议事厅 + 市集廊柱，1600×1000 = 160㎡。鼎盛：
// 罗马柱、喷泉、摊位、长椅；陷落后：倒塌石柱、瓦砾、断墙、枯树、荒草。
function romeLayout(): FloorplanLayout {
  return {
    id: "rome-f1",
    name: "罗马",
    area: 160,
    rooms: [
      { room: "yard", x: 0, y: 0, width: 1600, depth: 600,
        name: "罗马广场", nameEn: "Roman Forum", icon: "🏛️",
        wallsHidden: ["N", "S", "E", "W"] },
      { room: "living", x: 0, y: 600, width: 800, depth: 400,
        name: "元老院议事厅", nameEn: "Senate Hall", icon: "🏛️",
        doors: [{ wall: "N", pos: 400, len: 150, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 800, y: 600, width: 800, depth: 400,
        name: "市集廊柱", nameEn: "Market Colonnade", icon: "🏪",
        doors: [{ wall: "N", pos: 400, len: 150, style: "wood_panel", h: 210 }] },
    ],
  };
}

const ROME_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-rome-prosperous",
  name: "罗马鼎盛片场",
  nameEn: "Prosperous Rome Set",
  emoji: "🏛️",
  description: "片场 · 单层 · 罗马广场+元老院议事厅+市集廊柱 · 160㎡ · 罗马鼎盛 · 拍罗马/元老院/市集戏",
  descriptionEn: "Film set · 1F · Roman Forum + Senate Hall + Market Colonnade · 160㎡ · Rome in its prime",
  areaSqm: 160,
  palette: ["#E8E0D0", "#8A7A5A", "#C8A24A"],
  styleTemplateId: "modern-villa",
  exterior: pairExterior("#E8E0D0", "#8A7A5A"),
  floorLayouts: [romeLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-roman-column", x: 200, z: 120, rotation: 0 },
        { furnitureId: "proc-roman-column", x: 600, z: 120, rotation: 0 },
        { furnitureId: "proc-roman-column", x: 1000, z: 120, rotation: 0 },
        { furnitureId: "proc-roman-column", x: 1400, z: 120, rotation: 0 },
        { furnitureId: "fountain", x: 800, z: 350, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 350, z: 400, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 1250, z: 400, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 800, z: 120, rotation: 0 },
        { furnitureId: "storage-crate", x: 500, z: 500, rotation: 0 },
        { furnitureId: "storage-crate", x: 1100, z: 500, rotation: 0 },
      ],
      living: [
        { furnitureId: "proc-roman-column", x: 150, z: 100, rotation: 0 },
        { furnitureId: "proc-roman-column", x: 650, z: 100, rotation: 0 },
        { furnitureId: "proc-meeting-table", x: 400, z: 220, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 400, z: 80, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 400, z: 360, rotation: 180 },
      ],
      dining: [
        { furnitureId: "proc-market-stall", x: 250, z: 200, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 550, z: 200, rotation: 0 },
        { furnitureId: "storage-crate", x: 400, z: 80, rotation: 0 },
        { furnitureId: "storage-crate", x: 400, z: 330, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 120, z: 350, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 680, z: 350, rotation: 0 },
      ],
    },
  ],
};

const ROME_RUINED_SET: ProjectTemplate = {
  id: "set-rome-ruined",
  name: "罗马陷落后片场",
  nameEn: "Ruined Rome Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 罗马广场+元老院议事厅+市集廊柱 · 160㎡ · 罗马陷落后 · 拍帝国倾覆/废墟/蛮族戏",
  descriptionEn: "Film set · 1F · Roman Forum + Senate Hall + Market Colonnade · 160㎡ · Rome after the fall",
  areaSqm: 160,
  palette: ["#8A8378", "#5A5348", "#6A6A5A"],
  styleTemplateId: "modern-villa",
  exterior: pairExterior("#8A8378", "#5A5348"),
  floorLayouts: [romeLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-fallen-column", x: 350, z: 200, rotation: 0 },
        { furnitureId: "proc-fallen-column", x: 1250, z: 200, rotation: 0 },
        { furnitureId: "proc-fallen-column", x: 800, z: 450, rotation: 90 },
        { furnitureId: "proc-rubble-pile", x: 800, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 200, z: 450, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1400, z: 450, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 600, z: 80, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 1000, z: 520, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 300, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1450, z: 300, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 800, z: 550, rotation: 0 },
        { furnitureId: "proc-dead-tree", x: 1400, z: 120, rotation: 0 },
      ],
      living: [
        { furnitureId: "proc-broken-table", x: 400, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 150, z: 300, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 60, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-fallen-column", x: 400, z: 80, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-fallen-column", x: 400, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 150, z: 300, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 650, z: 320, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 740, z: 8, rotation: 0, elevationY: 150 },
      ],
    },
  ],
};

// ── 6. 庞贝繁华 / 庞贝废墟 ─────────────────────────────────────────────────
// 庞贝民居中庭 + 面包房商铺 + 石板街道，1400×900 = 126㎡。繁华：中庭喷
// 泉（impluvium）、罗马柱、摊位；火山爆发后：灰色瓦砾、倒塌石柱、断墙。
function pompeiiLayout(): FloorplanLayout {
  return {
    id: "pompeii-f1",
    name: "庞贝",
    area: 126,
    rooms: [
      { room: "living", x: 0, y: 0, width: 800, depth: 500,
        name: "庞贝民居中庭", nameEn: "Pompeian Atrium", icon: "🏺",
        doors: [{ wall: "S", pos: 400, len: 120, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 800, y: 0, width: 600, depth: 500,
        name: "面包房商铺", nameEn: "Bakery Shop", icon: "🍞",
        doors: [{ wall: "W", pos: 250, len: 100, style: "wood_panel", h: 200 }] },
      { room: "yard", x: 0, y: 500, width: 1400, depth: 400,
        name: "石板街道", nameEn: "Stone-paved Street", icon: "🛣️",
        wallsHidden: ["N", "S", "E", "W"] },
    ],
  };
}

const POMPEII_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-pompeii-prosperous",
  name: "庞贝繁华片场",
  nameEn: "Prosperous Pompeii Set",
  emoji: "🏺",
  description: "片场 · 单层 · 庞贝民居中庭+面包房商铺+石板街道 · 126㎡ · 庞贝繁华 · 拍罗马市井/家庭戏",
  descriptionEn: "Film set · 1F · Pompeian Atrium + Bakery Shop + Stone Street · 126㎡ · Pompeii in its prime",
  areaSqm: 126,
  palette: ["#E8DCC8", "#A06030", "#C03028"],
  styleTemplateId: "modern-villa",
  exterior: pairExterior("#E8DCC8", "#A06030"),
  floorLayouts: [pompeiiLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "fountain", x: 400, z: 250, rotation: 0 },
        { furnitureId: "proc-roman-column", x: 120, z: 120, rotation: 0 },
        { furnitureId: "proc-roman-column", x: 680, z: 120, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 200, z: 420, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 600, z: 420, rotation: 0 },
        { furnitureId: "storage-crate", x: 120, z: 300, rotation: 0 },
        { furnitureId: "storage-crate", x: 680, z: 300, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-market-stall", x: 300, z: 250, rotation: 0 },
        { furnitureId: "storage-crate", x: 100, z: 100, rotation: 0 },
        { furnitureId: "storage-crate", x: 500, z: 100, rotation: 0 },
        { furnitureId: "storage-crate", x: 100, z: 420, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 150, z: 400, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 450, z: 400, rotation: 0 },
      ],
      yard: [
        { furnitureId: "stone-path", x: 350, z: 200, rotation: 90 },
        { furnitureId: "stone-path", x: 700, z: 200, rotation: 90 },
        { furnitureId: "stone-path", x: 1050, z: 200, rotation: 90 },
        { furnitureId: "proc-roman-column", x: 150, z: 200, rotation: 0 },
        { furnitureId: "proc-roman-column", x: 1250, z: 200, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 700, z: 80, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 700, z: 330, rotation: 180 },
      ],
    },
  ],
};

const POMPEII_RUINED_SET: ProjectTemplate = {
  id: "set-pompeii-ruined",
  name: "庞贝废墟片场",
  nameEn: "Ruined Pompeii Set",
  emoji: "🌋",
  description: "片场 · 单层 · 庞贝民居中庭+面包房商铺+石板街道 · 126㎡ · 火山爆发后庞贝 · 拍灾难/废墟/考古戏",
  descriptionEn: "Film set · 1F · Pompeian Atrium + Bakery Shop + Stone Street · 126㎡ · Pompeii after the eruption",
  areaSqm: 126,
  palette: ["#7A7668", "#3A3630", "#8A8A8A"],
  styleTemplateId: "modern-villa",
  exterior: pairExterior("#7A7668", "#3A3630"),
  floorLayouts: [pompeiiLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "proc-rubble-pile", x: 400, z: 250, rotation: 0 },
        { furnitureId: "proc-fallen-column", x: 400, z: 120, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 150, z: 420, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 650, z: 420, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 650, z: 300, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-broken-table", x: 300, z: 250, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 150, z: 420, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 550, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 450, z: 100, rotation: 0 },
      ],
      yard: [
        { furnitureId: "proc-rubble-pile", x: 350, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1050, z: 200, rotation: 0 },
        { furnitureId: "proc-dead-tree", x: 700, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1250, z: 200, rotation: 0 },
        { furnitureId: "proc-fallen-column", x: 700, z: 330, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 1200, z: 80, rotation: 0 },
      ],
    },
  ],
};

// ── 7. 楼兰繁华 / 楼兰废墟 ─────────────────────────────────────────────────
// 丝路集市（露天）+ 客栈驼队院 + 胡商铺面，1600×1000 = 160㎡。繁华：摊
// 位、石井、粮草、胡商铺面；废墟：瓦砾、断墙、枯树、荒草，石井干涸留存。
function loulanLayout(): FloorplanLayout {
  return {
    id: "loulan-f1",
    name: "楼兰",
    area: 160,
    rooms: [
      { room: "yard", x: 0, y: 0, width: 1600, depth: 600,
        name: "丝路集市", nameEn: "Silk Road Bazaar", icon: "🐫",
        wallsHidden: ["N", "S", "E", "W"] },
      { room: "living", x: 0, y: 600, width: 800, depth: 400,
        name: "客栈驼队院", nameEn: "Caravanserai Courtyard", icon: "🏠",
        doors: [{ wall: "N", pos: 400, len: 150, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 800, y: 600, width: 800, depth: 400,
        name: "胡商铺面", nameEn: "Merchant Shopfront", icon: "🏪",
        doors: [{ wall: "N", pos: 400, len: 150, style: "wood_panel", h: 210 }] },
    ],
  };
}

const LOULAN_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-loulan-prosperous",
  name: "楼兰繁华片场",
  nameEn: "Prosperous Loulan Set",
  emoji: "🐫",
  description: "片场 · 单层 · 丝路集市+客栈驼队院+胡商铺面 · 160㎡ · 楼兰繁华 · 拍丝路/胡商/驼队戏",
  descriptionEn: "Film set · 1F · Silk Road Bazaar + Caravanserai + Merchant Shopfront · 160㎡ · Loulan in its prime",
  areaSqm: 160,
  palette: ["#E8D8B8", "#8A6A42", "#2A6A8A"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#E8D8B8", "#8A6A42"),
  floorLayouts: [loulanLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-market-stall", x: 300, z: 300, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 800, z: 300, rotation: 0 },
        { furnitureId: "proc-market-stall", x: 1300, z: 300, rotation: 0 },
        { furnitureId: "proc-stone-well", x: 800, z: 120, rotation: 0 },
        { furnitureId: "storage-crate", x: 150, z: 500, rotation: 0 },
        { furnitureId: "storage-crate", x: 1450, z: 500, rotation: 0 },
        { furnitureId: "storage-crate", x: 550, z: 500, rotation: 0 },
        { furnitureId: "proc-millet-sheaf", x: 500, z: 120, rotation: 0 },
        { furnitureId: "proc-millet-sheaf", x: 1100, z: 120, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 800, z: 500, rotation: 0 },
      ],
      living: [
        { furnitureId: "proc-han-an", x: 400, z: 200, rotation: 0 },
        { furnitureId: "proc-floor-cushion", x: 300, z: 200, rotation: 0 },
        { furnitureId: "proc-floor-cushion", x: 500, z: 200, rotation: 0 },
        { furnitureId: "proc-lacquer-bowl", x: 400, z: 200, rotation: 0, elevationY: 13 },
        { furnitureId: "proc-futon", x: 400, z: 320, rotation: 0 },
        { furnitureId: "proc-wood-chest", x: 150, z: 80, rotation: 0 },
        { furnitureId: "proc-wood-chest", x: 650, z: 80, rotation: 0 },
        { furnitureId: "proc-oil-lamp", x: 150, z: 80, rotation: 0, elevationY: 60 },
      ],
      dining: [
        { furnitureId: "proc-market-stall", x: 400, z: 200, rotation: 0 },
        { furnitureId: "storage-crate", x: 150, z: 100, rotation: 0 },
        { furnitureId: "storage-crate", x: 650, z: 100, rotation: 0 },
        { furnitureId: "storage-crate", x: 150, z: 320, rotation: 0 },
        { furnitureId: "storage-crate", x: 650, z: 320, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 400, z: 80, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 400, z: 330, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 200, z: 330, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 600, z: 330, rotation: 0 },
      ],
    },
  ],
};

const LOULAN_RUINED_SET: ProjectTemplate = {
  id: "set-loulan-ruined",
  name: "楼兰废墟片场",
  nameEn: "Ruined Loulan Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 丝路集市+客栈驼队院+胡商铺面 · 160㎡ · 楼兰沙漠废墟 · 拍丝路湮没/沙漠/考古戏",
  descriptionEn: "Film set · 1F · Silk Road Bazaar + Caravanserai + Merchant Shopfront · 160㎡ · Loulan desert ruins",
  areaSqm: 160,
  palette: ["#C8B898", "#6A5A42", "#8A8378"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#C8B898", "#6A5A42"),
  floorLayouts: [loulanLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-rubble-pile", x: 300, z: 300, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 800, z: 300, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1300, z: 300, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 500, z: 120, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 1100, z: 480, rotation: 0 },
        { furnitureId: "proc-dead-tree", x: 800, z: 500, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 120, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1450, z: 120, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 500, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1450, z: 500, rotation: 0 },
        { furnitureId: "proc-stone-well", x: 800, z: 120, rotation: 0 },
      ],
      living: [
        { furnitureId: "proc-broken-table", x: 400, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 150, z: 300, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 60, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 650, z: 320, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-broken-table", x: 400, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 650, z: 300, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 740, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 150, z: 320, rotation: 0 },
      ],
    },
  ],
};

// ── 8. 繁华商场 / 废弃商场 ─────────────────────────────────────────────────
// 中庭 + 品牌店 + 扶梯走廊，1800×1000 = 180㎡。繁华：货架、收银台、购物
// 车、绿植；废弃：倒塌货架、瓦砾、荒草、蛛网、遗弃的购物车。
function mallLayout(): FloorplanLayout {
  return {
    id: "mall-f1",
    name: "商场",
    area: 180,
    rooms: [
      { room: "living", x: 0, y: 0, width: 1000, depth: 600,
        name: "中庭", nameEn: "Atrium", icon: "🛍️",
        doors: [{ wall: "S", pos: 500, len: 150, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 1000, y: 0, width: 800, depth: 600,
        name: "品牌店", nameEn: "Brand Store", icon: "🏬",
        doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
      { room: "hallway", x: 0, y: 600, width: 1800, depth: 400,
        name: "扶梯走廊", nameEn: "Escalator Corridor", icon: "🚶",
        wallsHidden: ["N", "S", "E", "W"] },
    ],
  };
}

const MALL_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-mall-prosperous",
  name: "繁华商场片场",
  nameEn: "Prosperous Mall Set",
  emoji: "🛍️",
  description: "片场 · 单层 · 中庭+品牌店+扶梯走廊 · 180㎡ · 繁华商场 · 拍逛街/约会/都市戏",
  descriptionEn: "Film set · 1F · Atrium + Brand Store + Corridor · 180㎡ · Busy shopping mall",
  areaSqm: 180,
  palette: ["#F5F2EC", "#2A2A2A", "#2A6AC8"],
  styleTemplateId: "modern-villa",
  exterior: pairExterior("#F5F2EC", "#2A2A2A"),
  floorLayouts: [mallLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "proc-supermarket-shelf", x: 200, z: 150, rotation: 0 },
        { furnitureId: "proc-supermarket-shelf", x: 500, z: 150, rotation: 0 },
        { furnitureId: "proc-supermarket-shelf", x: 800, z: 150, rotation: 0 },
        { furnitureId: "proc-checkout-counter", x: 500, z: 450, rotation: 0 },
        { furnitureId: "proc-shopping-cart", x: 200, z: 450, rotation: 0 },
        { furnitureId: "proc-shopping-cart", x: 800, z: 450, rotation: 0 },
        { furnitureId: "plant-monstera", x: 60, z: 550, rotation: 0 },
        { furnitureId: "plant-monstera", x: 940, z: 550, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 500, z: 300, rotation: 0 },
        { furnitureId: "proc-chandelier-crystal", x: 250, z: 300, rotation: 0, mountCeiling: true },
      ],
      dining: [
        { furnitureId: "proc-supermarket-shelf", x: 250, z: 150, rotation: 0 },
        { furnitureId: "proc-supermarket-shelf", x: 550, z: 150, rotation: 0 },
        { furnitureId: "proc-reception-desk", x: 400, z: 450, rotation: 0 },
        { furnitureId: "proc-shopping-cart", x: 150, z: 450, rotation: 0 },
        { furnitureId: "plant-monstera", x: 60, z: 60, rotation: 0 },
        { furnitureId: "plant-monstera", x: 740, z: 60, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 400, z: 300, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "proc-outdoor-bench", x: 300, z: 200, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 900, z: 200, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 1500, z: 200, rotation: 0 },
        { furnitureId: "plant-monstera", x: 600, z: 200, rotation: 0 },
        { furnitureId: "plant-monstera", x: 1200, z: 200, rotation: 0 },
        { furnitureId: "proc-shopping-cart", x: 150, z: 200, rotation: 0 },
        { furnitureId: "proc-shopping-cart", x: 1650, z: 200, rotation: 0 },
      ],
    },
  ],
};

const MALL_RUINED_SET: ProjectTemplate = {
  id: "set-mall-ruined",
  name: "废弃商场片场",
  nameEn: "Abandoned Mall Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 中庭+品牌店+扶梯走廊 · 180㎡ · 废弃商场 · 拍末世/探险/悬疑戏",
  descriptionEn: "Film set · 1F · Atrium + Brand Store + Corridor · 180㎡ · Abandoned shopping mall",
  areaSqm: 180,
  palette: ["#8A8A88", "#3A3A3A", "#5A5A5A"],
  styleTemplateId: "modern-villa",
  exterior: pairExterior("#8A8A88", "#3A3A3A"),
  floorLayouts: [mallLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "proc-toppled-shelf", x: 250, z: 150, rotation: 0 },
        { furnitureId: "proc-toppled-shelf", x: 750, z: 150, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 500, z: 350, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 450, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 850, z: 450, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 60, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-shopping-cart", x: 500, z: 500, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 800, z: 350, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-toppled-shelf", x: 400, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 150, z: 450, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 740, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 650, z: 450, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "proc-rubble-pile", x: 450, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1350, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 150, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 900, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1650, z: 200, rotation: 0 },
        { furnitureId: "proc-dead-tree", x: 750, z: 200, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 1200, z: 200, rotation: 90 },
      ],
    },
  ],
};

// ── 9. 豪宅 / 破败老宅 ─────────────────────────────────────────────────────
// 客厅 + 餐厅 + 门廊，1500×900 = 135㎡。同一栋房子前后两态：豪宅是布艺
// 沙发、水晶灯、波斯毯、大理石圆桌；破败后是断椅、瓦砾、蛛网、荒草、枯树。
function mansionLayout(): FloorplanLayout {
  return {
    id: "mansion-f1",
    name: "豪宅",
    area: 135,
    rooms: [
      { room: "living", x: 0, y: 0, width: 900, depth: 600,
        name: "客厅", nameEn: "Living Room", icon: "🛋️",
        doors: [{ wall: "S", pos: 450, len: 120, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 900, y: 0, width: 600, depth: 600,
        name: "餐厅", nameEn: "Dining Room", icon: "🍽️",
        doors: [{ wall: "W", pos: 300, len: 100, style: "wood_panel", h: 200 }] },
      { room: "hallway", x: 0, y: 600, width: 1500, depth: 300,
        name: "门廊", nameEn: "Porch", icon: "🚪",
        wallsHidden: ["N", "S", "E", "W"] },
    ],
  };
}

const MANSION_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-mansion-prosperous",
  name: "豪宅片场",
  nameEn: "Prosperous Mansion Set",
  emoji: "🏰",
  description: "片场 · 单层 · 客厅+餐厅+门廊 · 135㎡ · 豪宅 · 拍豪门/婚恋/家族戏",
  descriptionEn: "Film set · 1F · Living Room + Dining Room + Porch · 135㎡ · Luxury mansion",
  areaSqm: 135,
  palette: ["#F5F0E8", "#2A2A2A", "#C8A24A"],
  styleTemplateId: "luxury",
  exterior: pairExterior("#F5F0E8", "#2A2A2A"),
  floorLayouts: [mansionLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "sofa-modern-pillows", x: 450, z: 350, rotation: 0 },
        { furnitureId: "sofa-armchair", x: 200, z: 350, rotation: 90 },
        { furnitureId: "sofa-armchair", x: 700, z: 350, rotation: 270 },
        { furnitureId: "rug-persian", x: 450, z: 350, rotation: 0 },
        { furnitureId: "proc-chandelier-crystal", x: 450, z: 200, rotation: 0, mountCeiling: true },
        { furnitureId: "sideboard-walnut", x: 450, z: 60, rotation: 0 },
        { furnitureId: "proc-bluewhite-vase", x: 450, z: 60, rotation: 0, elevationY: 85 },
        { furnitureId: "proc-gilt-chair", x: 150, z: 150, rotation: 0 },
        { furnitureId: "proc-gilt-chair", x: 750, z: 150, rotation: 0 },
      ],
      dining: [
        { furnitureId: "dining-marble-round", x: 300, z: 250, rotation: 0 },
        { furnitureId: "decor-fruit-bowl", x: 300, z: 250, rotation: 0, elevationY: 75 },
        { furnitureId: "chair-nordic-oak", x: 300, z: 160, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 300, z: 340, rotation: 180 },
        { furnitureId: "chair-nordic-oak", x: 210, z: 250, rotation: 90 },
        { furnitureId: "chair-nordic-oak", x: 390, z: 250, rotation: 270 },
        { furnitureId: "sideboard-walnut", x: 550, z: 60, rotation: 270 },
        { furnitureId: "decor-copper-pots", x: 550, z: 60, rotation: 0, elevationY: 85 },
        { furnitureId: "plant-monstera", x: 60, z: 540, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "plant-monstera", x: 200, z: 150, rotation: 0 },
        { furnitureId: "plant-monstera", x: 1300, z: 150, rotation: 0 },
        { furnitureId: "stone-path", x: 750, z: 150, rotation: 90 },
        { furnitureId: "decor-vase-royal", x: 500, z: 150, rotation: 0 },
        { furnitureId: "decor-vase-royal", x: 1000, z: 150, rotation: 0 },
      ],
    },
  ],
};

const MANSION_RUINED_SET: ProjectTemplate = {
  id: "set-mansion-ruined",
  name: "破败老宅片场",
  nameEn: "Derelict Old Mansion Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 客厅+餐厅+门廊 · 135㎡ · 破败老宅 · 拍落魄/鬼宅/悬疑/寻亲戏",
  descriptionEn: "Film set · 1F · Living Room + Dining Room + Porch · 135㎡ · Derelict old mansion (same house, after the fall)",
  areaSqm: 135,
  palette: ["#8A8378", "#3A3630", "#5A5A42"],
  styleTemplateId: "luxury",
  exterior: pairExterior("#8A8378", "#3A3630"),
  floorLayouts: [mansionLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      living: [
        { furnitureId: "proc-broken-chair", x: 250, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 650, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-table", x: 450, z: 350, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 450, z: 500, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 60, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-cobweb", x: 840, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 150, z: 500, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-broken-table", x: 300, z: 300, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 150, z: 450, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 550, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 450, z: 500, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "proc-dead-tree", x: 750, z: 150, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 200, z: 150, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1300, z: 150, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1100, z: 150, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 400, z: 150, rotation: 0 },
      ],
    },
  ],
};

// ── 10. 繁华学校 / 废弃学校 ────────────────────────────────────────────────
// 教室 + 图书角 + 走廊，1500×800 = 120㎡。繁华：六张课桌、黑板、书架、
// 阅览桌；废弃：断裂课桌（断裂桌案同尺寸代用）、倒塌书架、瓦砾、蛛网。
function schoolPairLayout(): FloorplanLayout {
  return {
    id: "school-pair-f1",
    name: "学校",
    area: 120,
    rooms: [
      { room: "study", x: 0, y: 0, width: 900, depth: 500,
        name: "教室", nameEn: "Classroom", icon: "🏫",
        doors: [{ wall: "S", pos: 450, len: 100, style: "wood_panel", h: 200 }] },
      { room: "study2", x: 900, y: 0, width: 600, depth: 500,
        name: "图书角", nameEn: "Reading Corner", icon: "📚",
        doors: [{ wall: "W", pos: 250, len: 100, style: "wood_panel", h: 200 }] },
      { room: "hallway", x: 0, y: 500, width: 1500, depth: 300,
        name: "走廊", nameEn: "Corridor", icon: "🚶",
        wallsHidden: ["N", "S", "E", "W"] },
    ],
  };
}

const SCHOOL_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-school-prosperous",
  name: "繁华学校片场",
  nameEn: "Prosperous School Set",
  emoji: "🎒",
  description: "片场 · 单层 · 教室+图书角+走廊 · 120㎡ · 繁华学校 · 拍校园/青春/师生戏",
  descriptionEn: "Film set · 1F · Classroom + Reading Corner + Corridor · 120㎡ · Bustling school",
  areaSqm: 120,
  palette: ["#E8E4DC", "#B0503A", "#2A5A8A"],
  styleTemplateId: "modern-villa",
  exterior: pairExterior("#E8E4DC", "#B0503A"),
  floorLayouts: [schoolPairLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      study: [
        { furnitureId: "proc-blackboard", x: 450, z: 8, rotation: 0, elevationY: 90 },
        { furnitureId: "proc-school-desk", x: 250, z: 180, rotation: 0 },
        { furnitureId: "proc-school-desk", x: 450, z: 180, rotation: 0 },
        { furnitureId: "proc-school-desk", x: 650, z: 180, rotation: 0 },
        { furnitureId: "proc-school-desk", x: 250, z: 320, rotation: 0 },
        { furnitureId: "proc-school-desk", x: 450, z: 320, rotation: 0 },
        { furnitureId: "proc-school-desk", x: 650, z: 320, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 250, z: 250, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 450, z: 250, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 650, z: 250, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 250, z: 390, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 450, z: 390, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 650, z: 390, rotation: 0 },
        { furnitureId: "plant-monstera", x: 60, z: 60, rotation: 0 },
        { furnitureId: "plant-monstera", x: 840, z: 60, rotation: 0 },
      ],
      study2: [
        { furnitureId: "proc-library-shelf", x: 150, z: 25, rotation: 0 },
        { furnitureId: "proc-library-shelf", x: 450, z: 25, rotation: 0 },
        { furnitureId: "dining-oak-rect", x: 300, z: 300, rotation: 0 },
        { furnitureId: "chair-nordic-oak", x: 225, z: 300, rotation: 90 },
        { furnitureId: "chair-nordic-oak", x: 375, z: 300, rotation: 270 },
        { furnitureId: "plant-rubber-tree", x: 550, z: 450, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "proc-outdoor-bench", x: 300, z: 150, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 1200, z: 150, rotation: 0 },
        { furnitureId: "plant-monstera", x: 600, z: 150, rotation: 0 },
        { furnitureId: "plant-monstera", x: 900, z: 150, rotation: 0 },
      ],
    },
  ],
};

const SCHOOL_ABANDONED_SET: ProjectTemplate = {
  id: "set-school-abandoned",
  name: "废弃学校片场",
  nameEn: "Abandoned School Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 教室+图书角+走廊 · 120㎡ · 废弃学校 · 拍悬疑/恐怖/寻访旧址戏",
  descriptionEn: "Film set · 1F · Classroom + Reading Corner + Corridor · 120㎡ · Abandoned school",
  areaSqm: 120,
  palette: ["#8A8378", "#4A4038", "#5A6A3A"],
  styleTemplateId: "modern-villa",
  exterior: pairExterior("#8A8378", "#4A4038"),
  floorLayouts: [schoolPairLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      study: [
        { furnitureId: "proc-broken-table", x: 250, z: 200, rotation: 0 },
        { furnitureId: "proc-broken-table", x: 450, z: 200, rotation: 0 },
        { furnitureId: "proc-broken-table", x: 650, z: 200, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 250, z: 400, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 650, z: 400, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 100, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 450, z: 400, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 450, z: 300, rotation: 0 },
      ],
      study2: [
        { furnitureId: "proc-toppled-shelf", x: 300, z: 150, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 300, z: 400, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 550, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 100, z: 400, rotation: 0 },
      ],
      hallway: [
        { furnitureId: "proc-weed-clump", x: 200, z: 150, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1300, z: 150, rotation: 0 },
        { furnitureId: "proc-dead-tree", x: 750, z: 150, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1100, z: 150, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 450, z: 150, rotation: 0 },
      ],
    },
  ],
};

// ── 11. 繁华村庄 / 空心村 ──────────────────────────────────────────────────
// 村口晒场（露天）+ 堂屋 + 灶房，1800×1200 = 216㎡。繁华：石井、粮草、
// 火炕、木箱、油灯；空心村：人去屋空，只剩火炕、断桌、瓦砾、蛛网、荒草。
function villageLayout(): FloorplanLayout {
  return {
    id: "village-f1",
    name: "村庄",
    area: 216,
    rooms: [
      { room: "yard", x: 0, y: 0, width: 1800, depth: 700,
        name: "村口晒场", nameEn: "Village Threshing Ground", icon: "🌾",
        wallsHidden: ["N", "S", "E", "W"] },
      { room: "living", x: 0, y: 700, width: 900, depth: 500,
        name: "堂屋", nameEn: "Main Hall", icon: "🏠",
        doors: [{ wall: "N", pos: 450, len: 150, style: "wood_panel", h: 210 }] },
      { room: "dining", x: 900, y: 700, width: 900, depth: 500,
        name: "灶房", nameEn: "Kitchen", icon: "🍳",
        doors: [{ wall: "N", pos: 450, len: 150, style: "wood_panel", h: 210 }] },
    ],
  };
}

const VILLAGE_PROSPEROUS_SET: ProjectTemplate = {
  id: "set-village-prosperous",
  name: "繁华村庄片场",
  nameEn: "Prosperous Village Set",
  emoji: "🌾",
  description: "片场 · 单层 · 村口晒场+堂屋+灶房 · 216㎡ · 繁华村庄 · 拍乡村/乡愁/丰收戏",
  descriptionEn: "Film set · 1F · Threshing Ground + Main Hall + Kitchen · 216㎡ · Bustling village",
  areaSqm: 216,
  palette: ["#E8DCC8", "#6B4A2A", "#8A9A5A"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#E8DCC8", "#6B4A2A"),
  floorLayouts: [villageLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-stone-well", x: 900, z: 350, rotation: 0 },
        { furnitureId: "proc-millet-sheaf", x: 300, z: 200, rotation: 0 },
        { furnitureId: "proc-millet-sheaf", x: 1500, z: 200, rotation: 0 },
        { furnitureId: "proc-millet-sheaf", x: 300, z: 500, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 600, z: 550, rotation: 0 },
        { furnitureId: "proc-outdoor-bench", x: 1200, z: 550, rotation: 0 },
        { furnitureId: "storage-crate", x: 500, z: 200, rotation: 0 },
        { furnitureId: "storage-crate", x: 1300, z: 200, rotation: 0 },
        { furnitureId: "stone-path", x: 900, z: 550, rotation: 90 },
        { furnitureId: "stone-path", x: 450, z: 350, rotation: 90 },
        { furnitureId: "stone-path", x: 1350, z: 350, rotation: 90 },
      ],
      living: [
        { furnitureId: "proc-kang", x: 450, z: 150, rotation: 0 },
        { furnitureId: "proc-wood-chest", x: 150, z: 400, rotation: 0 },
        { furnitureId: "proc-wood-chest", x: 750, z: 400, rotation: 0 },
        { furnitureId: "proc-oil-lamp", x: 150, z: 400, rotation: 0, elevationY: 60 },
        { furnitureId: "dining-oak-rect", x: 450, z: 380, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 375, z: 380, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 525, z: 380, rotation: 0 },
        { furnitureId: "proc-lacquer-bowl", x: 450, z: 380, rotation: 0, elevationY: 75 },
      ],
      dining: [
        { furnitureId: "proc-wood-chest", x: 450, z: 100, rotation: 0 },
        { furnitureId: "proc-kerosene-lamp", x: 450, z: 100, rotation: 0, elevationY: 60 },
        { furnitureId: "storage-crate", x: 150, z: 150, rotation: 0 },
        { furnitureId: "storage-crate", x: 750, z: 150, rotation: 0 },
        { furnitureId: "proc-rice-sheaf", x: 150, z: 400, rotation: 0 },
        { furnitureId: "proc-rice-sheaf", x: 750, z: 400, rotation: 0 },
        { furnitureId: "proc-wood-stool", x: 450, z: 300, rotation: 0 },
      ],
    },
  ],
};

const VILLAGE_HOLLOW_SET: ProjectTemplate = {
  id: "set-village-hollow",
  name: "空心村片场",
  nameEn: "Hollowed-out Village Set",
  emoji: "🏚️",
  description: "片场 · 单层 · 村口晒场+堂屋+灶房 · 216㎡ · 空心村 · 拍留守/归乡/乡村凋敝戏",
  descriptionEn: "Film set · 1F · Threshing Ground + Main Hall + Kitchen · 216㎡ · Hollowed-out village",
  areaSqm: 216,
  palette: ["#8A8378", "#4A4038", "#6A6A3A"],
  styleTemplateId: "chinese",
  exterior: pairExterior("#8A8378", "#4A4038"),
  floorLayouts: [villageLayout()],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
      yard: [
        { furnitureId: "proc-dead-tree", x: 900, z: 350, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 300, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1500, z: 200, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 300, z: 500, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 1500, z: 500, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 500, z: 350, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 1300, z: 350, rotation: 0 },
        { furnitureId: "proc-broken-wall", x: 900, z: 120, rotation: 0 },
        { furnitureId: "proc-stone-well", x: 900, z: 600, rotation: 0 },
      ],
      living: [
        { furnitureId: "proc-broken-table", x: 450, z: 350, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 200, z: 250, rotation: 0 },
        { furnitureId: "proc-broken-chair", x: 700, z: 250, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 200, z: 420, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 100, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-kang", x: 450, z: 150, rotation: 0 },
        { furnitureId: "proc-weed-clump", x: 750, z: 420, rotation: 0 },
      ],
      dining: [
        { furnitureId: "proc-broken-table", x: 450, z: 250, rotation: 0 },
        { furnitureId: "proc-rubble-pile", x: 650, z: 400, rotation: 0 },
        { furnitureId: "proc-cobweb", x: 800, z: 8, rotation: 0, elevationY: 150 },
        { furnitureId: "proc-weed-clump", x: 150, z: 400, rotation: 0 },
      ],
    },
  ],
};

// ── 室外片场（第六批：户外场景 26 个）──
// 单间全隐藏墙开放式场地；地面/水体/植被为缩放铺面与程序化件；
// 集市摊位/枯树/灯笼杆/石井复用成对场景批的 proc 件。
const FOREST_SET: ProjectTemplate = {
  id: "set-forest",
  name: "森林",
  nameEn: "Forest",
  emoji: "🌲",
  description: "森林：密林+林间空地，武侠夜行、迷路、林间打斗与告白的经典外景",
  descriptionEn: "Dense forest with a clearing — the classic outdoor setting for wuxia night scenes, getting lost, forest fights and confessions",
  areaSqm: 1200,
  palette: ["#2D5A1F", "#6A4A2A", "#3A6A3A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#2D5A1F",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#6A4A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-forest-f1",
      name: "森林",
      area: 1200,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4000, depth: 3000,
          name: "森林", nameEn: "Forest", icon: "🌲",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 2000, z: 1500, rotation: 0, scaleW: 3.8, scaleD: 2.8 },
      { furnitureId: "proc-tree-oak", x: 498, z: 999, rotation: 145, scaleW: 0.9, scaleD: 1.03, scaleH: 1.25 },
      { furnitureId: "proc-tree-oak", x: 831, z: 1825, rotation: 348, scaleW: 1.25, scaleD: 1.06, scaleH: 1.26 },
      { furnitureId: "proc-tree-oak", x: 899, z: 1026, rotation: 347, scaleW: 0.86, scaleD: 1.05, scaleH: 0.92 },
      { furnitureId: "proc-tree-oak", x: 836, z: 1539, rotation: 182, scaleW: 1.26, scaleD: 1.11, scaleH: 1.28 },
      { furnitureId: "proc-tree-oak", x: 262, z: 1759, rotation: 275, scaleW: 1.01, scaleD: 1.29, scaleH: 0.92 },
      { furnitureId: "proc-tree-oak", x: 587, z: 1361, rotation: 188, scaleW: 1.19, scaleD: 1.09, scaleH: 0.9 },
      { furnitureId: "proc-tree-oak", x: 531, z: 1821, rotation: 229, scaleW: 0.87, scaleD: 1.01, scaleH: 0.94 },
      { furnitureId: "proc-tree-oak", x: 1080, z: 1304, rotation: 23, scaleW: 0.98, scaleD: 1.12, scaleH: 0.99 },
      { furnitureId: "proc-tree-oak", x: 2161, z: 1086, rotation: 173, scaleW: 0.9, scaleD: 1.08, scaleH: 1.25 },
      { furnitureId: "proc-tree-oak", x: 1774, z: 805, rotation: 254, scaleW: 0.89, scaleD: 0.9, scaleH: 0.93 },
      { furnitureId: "proc-tree-oak", x: 1784, z: 1060, rotation: 332, scaleW: 0.88, scaleD: 0.91, scaleH: 1.17 },
      { furnitureId: "proc-tree-oak", x: 2081, z: 845, rotation: 106, scaleW: 1.04, scaleD: 1.0, scaleH: 0.85 },
      { furnitureId: "proc-tree-oak", x: 2289, z: 864, rotation: 20, scaleW: 1.18, scaleD: 1.21, scaleH: 0.96 },
      { furnitureId: "proc-tree-oak", x: 2346, z: 1057, rotation: 253, scaleW: 0.98, scaleD: 0.98, scaleH: 1.0 },
      { furnitureId: "proc-tree-oak", x: 1968, z: 1190, rotation: 119, scaleW: 1.24, scaleD: 0.94, scaleH: 1.14 },
      { furnitureId: "proc-pine", x: 1637, z: 1043, rotation: 272, scaleW: 0.89, scaleD: 1.08, scaleH: 1.08 },
      { furnitureId: "proc-pine", x: 2331, z: 944, rotation: 123, scaleW: 1.28, scaleD: 1.23, scaleH: 0.85 },
      { furnitureId: "proc-pine", x: 2040, z: 942, rotation: 198, scaleW: 0.86, scaleD: 1.03, scaleH: 0.74 },
      { furnitureId: "proc-pine", x: 1826, z: 1203, rotation: 24, scaleW: 0.98, scaleD: 1.04, scaleH: 1.07 },
      { furnitureId: "proc-pine", x: 1812, z: 943, rotation: 34, scaleW: 1.02, scaleD: 1.01, scaleH: 1.23 },
      { furnitureId: "proc-pine", x: 2040, z: 1190, rotation: 22, scaleW: 0.99, scaleD: 1.11, scaleH: 1.21 },
      { furnitureId: "proc-tree-oak", x: 3016, z: 1515, rotation: 307, scaleW: 1.18, scaleD: 1.03, scaleH: 0.97 },
      { furnitureId: "proc-tree-oak", x: 3490, z: 977, rotation: 288, scaleW: 1.16, scaleD: 1.26, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 3276, z: 1610, rotation: 118, scaleW: 1.11, scaleD: 0.85, scaleH: 0.86 },
      { furnitureId: "proc-tree-oak", x: 3298, z: 2072, rotation: 39, scaleW: 0.89, scaleD: 1.02, scaleH: 0.95 },
      { furnitureId: "proc-tree-oak", x: 3644, z: 1351, rotation: 133, scaleW: 0.91, scaleD: 1.04, scaleH: 1.14 },
      { furnitureId: "proc-tree-oak", x: 2000, z: 950, rotation: 37, scaleW: 1.6, scaleD: 1.6, scaleH: 1.5 },
      { furnitureId: "proc-bush", x: 1247, z: 1248, rotation: 265, scaleW: 0.96, scaleD: 0.95, scaleH: 1.05 },
      { furnitureId: "proc-bush", x: 1014, z: 1012, rotation: 145, scaleW: 0.87, scaleD: 0.85, scaleH: 0.98 },
      { furnitureId: "proc-bush", x: 1024, z: 1198, rotation: 274, scaleW: 0.97, scaleD: 1.25, scaleH: 0.96 },
      { furnitureId: "proc-bush", x: 963, z: 1881, rotation: 73, scaleW: 0.81, scaleD: 1.04, scaleH: 0.81 },
      { furnitureId: "proc-bush", x: 1296, z: 1750, rotation: 208, scaleW: 1.19, scaleD: 0.9, scaleH: 0.97 },
      { furnitureId: "proc-bush", x: 3000, z: 1670, rotation: 12, scaleW: 0.82, scaleD: 1.06, scaleH: 1.08 },
      { furnitureId: "proc-bush", x: 2743, z: 1934, rotation: 121, scaleW: 1.03, scaleD: 0.91, scaleH: 0.92 },
      { furnitureId: "proc-bush", x: 2927, z: 1926, rotation: 119, scaleW: 0.9, scaleD: 1.13, scaleH: 1.0 },
      { furnitureId: "proc-bush", x: 3014, z: 1561, rotation: 268, scaleW: 1.2, scaleD: 1.24, scaleH: 0.83 },
      { furnitureId: "proc-bush", x: 2875, z: 1903, rotation: 325, scaleW: 0.87, scaleD: 1.12, scaleH: 1.11 },
      { furnitureId: "proc-bush", x: 2065, z: 1202, rotation: 228, scaleW: 0.82, scaleD: 1.04, scaleH: 1.01 },
      { furnitureId: "proc-bush", x: 1626, z: 1250, rotation: 24, scaleW: 0.91, scaleD: 1.03, scaleH: 1.03 },
      { furnitureId: "proc-bush", x: 1687, z: 1338, rotation: 166, scaleW: 0.86, scaleD: 1.29, scaleH: 0.82 },
      { furnitureId: "proc-bush", x: 2030, z: 1172, rotation: 249, scaleW: 1.15, scaleD: 0.86, scaleH: 1.16 },
      { furnitureId: "proc-rock", x: 1041, z: 1499, rotation: 296, scaleW: 1.01, scaleD: 1.26, scaleH: 1.07 },
      { furnitureId: "proc-rock", x: 605, z: 1307, rotation: 143, scaleW: 0.85, scaleD: 0.85, scaleH: 1.13 },
      { furnitureId: "proc-rock", x: 1162, z: 1539, rotation: 276, scaleW: 0.86, scaleD: 1.03, scaleH: 0.82 },
      { furnitureId: "proc-rock", x: 2971, z: 1333, rotation: 318, scaleW: 0.8, scaleD: 0.93, scaleH: 0.98 },
      { furnitureId: "proc-rock", x: 3319, z: 1090, rotation: 148, scaleW: 1.23, scaleD: 1.19, scaleH: 0.97 },
      { furnitureId: "proc-rock-big", x: 1100, z: 2200, rotation: 310, scaleW: 1.23, scaleD: 1.48 },
      { furnitureId: "proc-rock-big", x: 2900, z: 800, rotation: 20, scaleW: 1.35, scaleD: 1.24 },
      { furnitureId: "proc-rock-big", x: 3400, z: 2100, rotation: 271, scaleW: 1.21, scaleD: 1.39 },
      { furnitureId: "proc-grass-tuft", x: 2750, z: 1500, rotation: 121, scaleH: 1.22 },
      { furnitureId: "proc-grass-tuft", x: 2607, z: 1864, rotation: 79, scaleH: 0.97 },
      { furnitureId: "proc-grass-tuft", x: 2232, z: 2090, rotation: 276, scaleH: 1.23 },
      { furnitureId: "proc-grass-tuft", x: 1768, z: 2090, rotation: 292, scaleH: 1.03 },
      { furnitureId: "proc-grass-tuft", x: 1393, z: 1864, rotation: 269, scaleH: 1.27 },
      { furnitureId: "proc-grass-tuft", x: 1250, z: 1500, rotation: 210, scaleH: 1.16 },
      { furnitureId: "proc-grass-tuft", x: 1393, z: 1136, rotation: 84, scaleH: 0.72 },
      { furnitureId: "proc-grass-tuft", x: 1768, z: 910, rotation: 252, scaleH: 1.03 },
      { furnitureId: "proc-grass-tuft", x: 2232, z: 910, rotation: 48, scaleH: 1.2 },
      { furnitureId: "proc-grass-tuft", x: 2607, z: 1136, rotation: 139, scaleH: 1.28 },
      { furnitureId: "proc-grass-tuft", x: 1434, z: 1898, rotation: 66, scaleW: 0.82, scaleD: 0.87, scaleH: 1.04 },
      { furnitureId: "proc-grass-tuft", x: 2384, z: 1089, rotation: 277, scaleW: 1.08, scaleD: 1.3, scaleH: 1.04 },
      { furnitureId: "proc-grass-tuft", x: 1922, z: 2637, rotation: 246, scaleW: 1.21, scaleD: 0.95, scaleH: 1.27 },
      { furnitureId: "proc-grass-tuft", x: 2707, z: 1382, rotation: 113, scaleW: 1.27, scaleD: 0.88, scaleH: 1.01 },
      { furnitureId: "proc-grass-tuft", x: 1031, z: 2284, rotation: 291, scaleW: 0.82, scaleD: 1.08, scaleH: 0.89 },
      { furnitureId: "proc-grass-tuft", x: 823, z: 2664, rotation: 141, scaleW: 1.1, scaleD: 0.97, scaleH: 1.11 },
      { furnitureId: "proc-grass-tuft", x: 3542, z: 692, rotation: 246, scaleW: 1.22, scaleD: 1.23, scaleH: 0.82 },
      { furnitureId: "proc-grass-tuft", x: 1190, z: 852, rotation: 117, scaleW: 0.99, scaleD: 0.86, scaleH: 0.86 },
      { furnitureId: "proc-grass-tuft", x: 2885, z: 1618, rotation: 117, scaleW: 1.07, scaleD: 0.85, scaleH: 1.16 },
      { furnitureId: "proc-grass-tuft", x: 331, z: 2113, rotation: 146, scaleW: 1.13, scaleD: 1.25, scaleH: 0.86 },
      { furnitureId: "proc-dead-tree", x: 2700, z: 2050, rotation: 140 },
      { furnitureId: "proc-dead-tree", x: 2550, z: 2180, rotation: 260 },
      { furnitureId: "proc-weed-clump", x: 716, z: 1963, rotation: 247, scaleW: 0.81, scaleD: 0.89, scaleH: 1.29 },
      { furnitureId: "proc-weed-clump", x: 603, z: 2323, rotation: 290, scaleW: 1.16, scaleD: 1.28, scaleH: 0.88 },
      { furnitureId: "proc-weed-clump", x: 450, z: 2179, rotation: 278, scaleW: 1.11, scaleD: 1.22, scaleH: 0.93 },
      { furnitureId: "proc-weed-clump", x: 696, z: 2201, rotation: 349, scaleW: 1.03, scaleD: 1.05, scaleH: 1.21 },
      { furnitureId: "stone-path", x: 1938, z: 2815, rotation: 211 },
      { furnitureId: "stone-path", x: 1812, z: 2605, rotation: 211 },
      { furnitureId: "stone-path", x: 1838, z: 2412, rotation: 135 },
      { furnitureId: "stone-path", x: 2012, z: 2238, rotation: 135 },
      { furnitureId: "stone-path", x: 2025, z: 2062, rotation: 221 },
      { furnitureId: "stone-path", x: 1875, z: 1888, rotation: 221 },
      { furnitureId: "stone-path", x: 1900, z: 1710, rotation: 132 },
      { furnitureId: "proc-mountain", x: 905, z: 380, rotation: 0, scaleW: 1.2, scaleD: 0.5 },
      { furnitureId: "proc-mountain", x: 3095, z: 380, rotation: 0, scaleW: 1.2, scaleD: 0.5 },

    ],
    },
  ],
};

const BAMBOO_SET: ProjectTemplate = {
  id: "set-bamboo",
  name: "竹林",
  nameEn: "Bamboo Forest",
  emoji: "🎋",
  description: "竹林：成片竹丛+石灯笼小径，武侠高手过招、隐士清修的出场外景",
  descriptionEn: "Bamboo grove with stone lanterns and a path — the classic entrance for wuxia masters and reclusive sages",
  areaSqm: 864,
  palette: ["#3A8A3A", "#6A6A4A", "#2A5A2A"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#3A8A3A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#6A6A4A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-bamboo-f1",
      name: "竹林",
      area: 864,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3600, depth: 2400,
          name: "竹林", nameEn: "Bamboo Forest", icon: "🎋",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 1800, z: 1200, rotation: 0, scaleW: 3.4, scaleD: 2.2 },
      { furnitureId: "proc-bamboo-clump", x: 1575, z: 300, rotation: 171, scaleW: 0.92, scaleD: 0.99, scaleH: 1.04 },
      { furnitureId: "proc-bamboo-clump", x: 2202, z: 300, rotation: 105, scaleW: 1.03, scaleD: 0.97, scaleH: 1.32 },
      { furnitureId: "proc-bamboo-clump", x: 1444, z: 525, rotation: 86, scaleW: 1.16, scaleD: 1.05, scaleH: 1.0 },
      { furnitureId: "proc-bamboo-clump", x: 2211, z: 525, rotation: 197, scaleW: 1.06, scaleD: 1.04, scaleH: 1.04 },
      { furnitureId: "proc-bamboo-clump", x: 1601, z: 750, rotation: 128, scaleW: 1.14, scaleD: 1.18, scaleH: 0.94 },
      { furnitureId: "proc-bamboo-clump", x: 2192, z: 750, rotation: 127, scaleW: 1.19, scaleD: 0.95, scaleH: 1.47 },
      { furnitureId: "proc-bamboo-clump", x: 1499, z: 975, rotation: 46, scaleW: 0.91, scaleD: 1.19, scaleH: 1.06 },
      { furnitureId: "proc-bamboo-clump", x: 2029, z: 975, rotation: 110, scaleW: 1.17, scaleD: 1.0, scaleH: 0.98 },
      { furnitureId: "proc-bamboo-clump", x: 1490, z: 1200, rotation: 185, scaleW: 1.16, scaleD: 1.19, scaleH: 1.49 },
      { furnitureId: "proc-bamboo-clump", x: 2079, z: 1200, rotation: 167, scaleW: 1.07, scaleD: 0.92, scaleH: 0.91 },
      { furnitureId: "proc-bamboo-clump", x: 1512, z: 1425, rotation: 38, scaleW: 1.11, scaleD: 1.09, scaleH: 1.28 },
      { furnitureId: "proc-bamboo-clump", x: 2154, z: 1425, rotation: 239, scaleW: 1.06, scaleD: 1.05, scaleH: 1.33 },
      { furnitureId: "proc-bamboo-clump", x: 1577, z: 1650, rotation: 255, scaleW: 1.1, scaleD: 1.16, scaleH: 1.05 },
      { furnitureId: "proc-bamboo-clump", x: 2087, z: 1650, rotation: 238, scaleW: 1.13, scaleD: 1.19, scaleH: 0.9 },
      { furnitureId: "proc-bamboo-clump", x: 1460, z: 1875, rotation: 269, scaleW: 1.1, scaleD: 1.04, scaleH: 1.21 },
      { furnitureId: "proc-bamboo-clump", x: 2187, z: 1875, rotation: 56, scaleW: 1.06, scaleD: 1.03, scaleH: 0.88 },
      { furnitureId: "proc-bamboo-clump", x: 1558, z: 2100, rotation: 248, scaleW: 0.94, scaleD: 1.16, scaleH: 1.47 },
      { furnitureId: "proc-bamboo-clump", x: 2199, z: 2100, rotation: 204, scaleW: 1.06, scaleD: 1.12, scaleH: 1.35 },
      { furnitureId: "proc-bamboo-clump", x: 1650, z: 280, rotation: 40, scaleH: 1.6 },
      { furnitureId: "proc-bamboo-clump", x: 1950, z: 280, rotation: 200, scaleH: 1.2 },
      { furnitureId: "stone-path", x: 1800, z: 2175, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 1925, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 1675, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 1425, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 1175, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 925, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 675, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 425, rotation: 180 },
      { furnitureId: "proc-stone-lantern", x: 1500, z: 500, rotation: 34 },
      { furnitureId: "proc-stone-lantern", x: 2100, z: 800, rotation: 29 },
      { furnitureId: "proc-stone-lantern", x: 1500, z: 1100, rotation: 221 },
      { furnitureId: "proc-stone-lantern", x: 2100, z: 1400, rotation: 155 },
      { furnitureId: "proc-stone-lantern", x: 1500, z: 1700, rotation: 141 },
      { furnitureId: "proc-stone-lantern", x: 2100, z: 2000, rotation: 334 },
      { furnitureId: "proc-bush", x: 1624, z: 1494, rotation: 312, scaleW: 0.89, scaleD: 1.02, scaleH: 0.9 },
      { furnitureId: "proc-bush", x: 1423, z: 1289, rotation: 267, scaleW: 0.86, scaleD: 1.29, scaleH: 0.84 },
      { furnitureId: "proc-bush", x: 1464, z: 1236, rotation: 146, scaleW: 0.86, scaleD: 0.96, scaleH: 1.07 },
      { furnitureId: "proc-bush", x: 1708, z: 824, rotation: 344, scaleW: 0.99, scaleD: 1.09, scaleH: 1.29 },
      { furnitureId: "proc-bush", x: 2064, z: 1163, rotation: 111, scaleW: 1.3, scaleD: 1.3, scaleH: 1.16 },
      { furnitureId: "proc-bush", x: 2240, z: 889, rotation: 345, scaleW: 1.27, scaleD: 1.23, scaleH: 1.28 },
      { furnitureId: "proc-bush", x: 2218, z: 938, rotation: 203, scaleW: 1.27, scaleD: 1.13, scaleH: 1.09 },
      { furnitureId: "proc-bush", x: 2299, z: 883, rotation: 304, scaleW: 1.18, scaleD: 0.86, scaleH: 0.9 },
      { furnitureId: "proc-rock", x: 1583, z: 591, rotation: 332, scaleW: 0.97, scaleD: 1.2, scaleH: 1.23 },
      { furnitureId: "proc-rock", x: 1452, z: 510, rotation: 266, scaleW: 0.93, scaleD: 1.19, scaleH: 1.2 },
      { furnitureId: "proc-rock", x: 2014, z: 1942, rotation: 150, scaleW: 1.24, scaleD: 1.23, scaleH: 1.08 },
      { furnitureId: "proc-rock", x: 2266, z: 1897, rotation: 116, scaleW: 1.2, scaleD: 1.15, scaleH: 1.25 },
      { furnitureId: "proc-rock-big", x: 900, z: 2100, rotation: 30, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-rock-big", x: 2750, z: 350, rotation: 210, scaleW: 1.3, scaleD: 1.1 },
      { furnitureId: "proc-grass-tuft", x: 1325, z: 603, rotation: 230, scaleW: 0.97, scaleD: 1.22, scaleH: 1.04 },
      { furnitureId: "proc-grass-tuft", x: 1413, z: 883, rotation: 318, scaleW: 0.88, scaleD: 1.06, scaleH: 1.01 },
      { furnitureId: "proc-grass-tuft", x: 1420, z: 1183, rotation: 91, scaleW: 0.93, scaleD: 0.83, scaleH: 0.7 },
      { furnitureId: "proc-grass-tuft", x: 1375, z: 1569, rotation: 323, scaleW: 0.94, scaleD: 0.96, scaleH: 1.17 },
      { furnitureId: "proc-grass-tuft", x: 1365, z: 1865, rotation: 124, scaleW: 1.26, scaleD: 0.85, scaleH: 1.18 },
      { furnitureId: "proc-grass-tuft", x: 2262, z: 571, rotation: 196, scaleW: 1.03, scaleD: 1.27, scaleH: 1.11 },
      { furnitureId: "proc-grass-tuft", x: 2221, z: 894, rotation: 212, scaleW: 1.26, scaleD: 1.19, scaleH: 1.18 },
      { furnitureId: "proc-grass-tuft", x: 2251, z: 1183, rotation: 225, scaleW: 1.27, scaleD: 1.22, scaleH: 0.89 },
      { furnitureId: "proc-grass-tuft", x: 2169, z: 1541, rotation: 13, scaleW: 1.24, scaleD: 1.24, scaleH: 1.17 },
      { furnitureId: "proc-grass-tuft", x: 2243, z: 1880, rotation: 317, scaleW: 1.23, scaleD: 1.13, scaleH: 1.16 },
      { furnitureId: "proc-weed-clump", x: 635, z: 1998, rotation: 168, scaleW: 0.81, scaleD: 0.82, scaleH: 1.28 },
      { furnitureId: "proc-weed-clump", x: 709, z: 2093, rotation: 314, scaleW: 1.08, scaleD: 1.11, scaleH: 1.09 },
      { furnitureId: "proc-weed-clump", x: 2757, z: 466, rotation: 288, scaleW: 0.89, scaleD: 1.19, scaleH: 0.83 },
      { furnitureId: "proc-weed-clump", x: 2921, z: 739, rotation: 62, scaleW: 1.23, scaleD: 1.01, scaleH: 0.9 },
      { furnitureId: "proc-bamboo-clump", x: 273, z: 400, rotation: 75, scaleH: 1.27 },
      { furnitureId: "proc-bamboo-clump", x: 3268, z: 400, rotation: 160, scaleH: 1.24 },
      { furnitureId: "proc-bamboo-clump", x: 248, z: 800, rotation: 295, scaleH: 0.91 },
      { furnitureId: "proc-bamboo-clump", x: 3279, z: 800, rotation: 338, scaleH: 1.33 },
      { furnitureId: "proc-bamboo-clump", x: 254, z: 1200, rotation: 68, scaleH: 1.25 },
      { furnitureId: "proc-bamboo-clump", x: 3267, z: 1200, rotation: 146, scaleH: 1.17 },
      { furnitureId: "proc-bamboo-clump", x: 236, z: 1600, rotation: 354, scaleH: 1.03 },
      { furnitureId: "proc-bamboo-clump", x: 3303, z: 1600, rotation: 40, scaleH: 1.15 },
      { furnitureId: "proc-bamboo-clump", x: 279, z: 2000, rotation: 266, scaleH: 1.2 },
      { furnitureId: "proc-bamboo-clump", x: 3316, z: 2000, rotation: 301, scaleH: 1.35 },
      { furnitureId: "proc-rock", x: 371, z: 864, rotation: 13, scaleW: 1.19, scaleD: 0.89, scaleH: 0.92 },
      { furnitureId: "proc-rock", x: 271, z: 1596, rotation: 319, scaleW: 1.12, scaleD: 1.11, scaleH: 1.07 },
      { furnitureId: "proc-rock", x: 3367, z: 956, rotation: 98, scaleW: 1.11, scaleD: 0.84, scaleH: 1.0 },
      { furnitureId: "proc-rock", x: 3335, z: 1607, rotation: 126, scaleW: 0.89, scaleD: 1.22, scaleH: 0.82 },

    ],
    },
  ],
};

const GRASSLAND_SET: ProjectTemplate = {
  id: "set-grassland",
  name: "草原",
  nameEn: "Grassland",
  emoji: "🌾",
  description: "草原：辽阔干草场+蒙古包，策马、篝火、草原情歌的开阔外景",
  descriptionEn: "Open steppe with a yurt and tents — horse riding, campfires and grassland songs",
  areaSqm: 1440,
  palette: ["#8AA84A", "#D8B060", "#3A6A2A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#8AA84A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#D8B060",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-grassland-f1",
      name: "草原",
      area: 1440,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4800, depth: 3000,
          name: "草原", nameEn: "Grassland", icon: "🌾",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-dry", x: 2400, z: 1500, rotation: 0, scaleW: 4.6, scaleD: 2.8 },
      { furnitureId: "proc-yurt", x: 2500, z: 700, rotation: 180, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-tent", x: 1950, z: 1550, rotation: 0, scaleH: 1.08 },
      { furnitureId: "proc-tent", x: 2400, z: 1750, rotation: 0, scaleH: 1.01 },
      { furnitureId: "proc-tent", x: 3050, z: 1550, rotation: 0, scaleH: 1.01 },
      { furnitureId: "proc-banpo-firepit", x: 2450, z: 1350, rotation: 0 },
      { furnitureId: "proc-banner", x: 2350, z: 450, rotation: 250 },
      { furnitureId: "proc-banner", x: 1500, z: 2450, rotation: 263 },
      { furnitureId: "proc-banner", x: 3300, z: 2450, rotation: 108 },
      { furnitureId: "proc-banner", x: 3900, z: 2450, rotation: 24 },
      { furnitureId: "fence", x: 3700, z: 2100, rotation: 90 },
      { furnitureId: "fence", x: 3900, z: 2100, rotation: 90 },
      { furnitureId: "fence", x: 4100, z: 2100, rotation: 90 },
      { furnitureId: "fence", x: 4300, z: 2100, rotation: 90 },
      { furnitureId: "fence", x: 4400, z: 2200, rotation: 0 },
      { furnitureId: "fence", x: 4400, z: 2400, rotation: 0 },
      { furnitureId: "fence", x: 3700, z: 2700, rotation: 90 },
      { furnitureId: "fence", x: 3900, z: 2700, rotation: 90 },
      { furnitureId: "proc-haystack", x: 3700, z: 2200, rotation: 290, scaleH: 0.96 },
      { furnitureId: "proc-haystack", x: 4300, z: 2200, rotation: 219, scaleH: 0.96 },
      { furnitureId: "proc-haystack", x: 4000, z: 2680, rotation: 200, scaleH: 1.1 },
      { furnitureId: "proc-grass-tuft", x: 1391, z: 1559, rotation: 205, scaleW: 1.02, scaleD: 1.03, scaleH: 1.05 },
      { furnitureId: "proc-grass-tuft", x: 1167, z: 1297, rotation: 134, scaleW: 1.1, scaleD: 1.03, scaleH: 1.2 },
      { furnitureId: "proc-grass-tuft", x: 855, z: 1019, rotation: 148, scaleW: 0.94, scaleD: 1.01, scaleH: 1.21 },
      { furnitureId: "proc-grass-tuft", x: 1190, z: 1570, rotation: 107, scaleW: 0.8, scaleD: 1.03, scaleH: 1.26 },
      { furnitureId: "proc-grass-tuft", x: 1024, z: 1726, rotation: 205, scaleW: 1.22, scaleD: 1.04, scaleH: 0.91 },
      { furnitureId: "proc-grass-tuft", x: 1017, z: 1449, rotation: 290, scaleW: 1.07, scaleD: 0.86, scaleH: 1.17 },
      { furnitureId: "proc-grass-tuft", x: 1452, z: 1370, rotation: 309, scaleW: 1.27, scaleD: 1.11, scaleH: 0.8 },
      { furnitureId: "proc-grass-tuft", x: 718, z: 1387, rotation: 155, scaleW: 0.83, scaleD: 1.06, scaleH: 1.18 },
      { furnitureId: "proc-grass-tuft", x: 511, z: 1445, rotation: 310, scaleW: 1.3, scaleD: 1.23, scaleH: 1.14 },
      { furnitureId: "proc-grass-tuft", x: 1087, z: 1072, rotation: 156, scaleW: 1.19, scaleD: 1.19, scaleH: 1.16 },
      { furnitureId: "proc-grass-tuft", x: 783, z: 1214, rotation: 10, scaleW: 1.03, scaleD: 0.91, scaleH: 0.82 },
      { furnitureId: "proc-grass-tuft", x: 1290, z: 1273, rotation: 130, scaleW: 1.08, scaleD: 1.11, scaleH: 1.23 },
      { furnitureId: "proc-grass-tuft", x: 1696, z: 2503, rotation: 221, scaleW: 0.87, scaleD: 1.22, scaleH: 1.11 },
      { furnitureId: "proc-grass-tuft", x: 1598, z: 2634, rotation: 232, scaleW: 1.17, scaleD: 0.94, scaleH: 0.85 },
      { furnitureId: "proc-grass-tuft", x: 778, z: 2378, rotation: 120, scaleW: 0.84, scaleD: 1.25, scaleH: 1.12 },
      { furnitureId: "proc-grass-tuft", x: 1319, z: 2715, rotation: 1, scaleW: 1.14, scaleD: 1.08, scaleH: 0.94 },
      { furnitureId: "proc-grass-tuft", x: 969, z: 2687, rotation: 172, scaleW: 1.28, scaleD: 1.01, scaleH: 0.93 },
      { furnitureId: "proc-grass-tuft", x: 1410, z: 2563, rotation: 150, scaleW: 1.01, scaleD: 1.1, scaleH: 0.81 },
      { furnitureId: "proc-grass-tuft", x: 949, z: 2325, rotation: 280, scaleW: 0.96, scaleD: 1.28, scaleH: 0.98 },
      { furnitureId: "proc-grass-tuft", x: 1102, z: 2462, rotation: 128, scaleW: 0.93, scaleD: 1.04, scaleH: 0.93 },
      { furnitureId: "proc-grass-tuft", x: 1226, z: 2337, rotation: 234, scaleW: 1.2, scaleD: 0.87, scaleH: 0.91 },
      { furnitureId: "proc-grass-tuft", x: 1188, z: 2595, rotation: 276, scaleW: 1.26, scaleD: 0.93, scaleH: 1.21 },
      { furnitureId: "proc-grass-tuft", x: 1544, z: 2514, rotation: 323, scaleW: 1.21, scaleD: 1.2, scaleH: 1.29 },
      { furnitureId: "proc-grass-tuft", x: 1434, z: 2344, rotation: 36, scaleW: 0.98, scaleD: 1.22, scaleH: 1.3 },
      { furnitureId: "proc-grass-tuft", x: 3235, z: 2445, rotation: 4, scaleW: 1.13, scaleD: 0.93, scaleH: 1.15 },
      { furnitureId: "proc-grass-tuft", x: 3076, z: 2659, rotation: 138, scaleW: 0.85, scaleD: 1.22, scaleH: 1.03 },
      { furnitureId: "proc-grass-tuft", x: 3513, z: 2595, rotation: 307, scaleW: 1.0, scaleD: 0.8, scaleH: 1.15 },
      { furnitureId: "proc-grass-tuft", x: 3329, z: 2564, rotation: 313, scaleW: 0.95, scaleD: 1.16, scaleH: 1.18 },
      { furnitureId: "proc-grass-tuft", x: 3635, z: 2549, rotation: 157, scaleW: 1.29, scaleD: 1.12, scaleH: 1.05 },
      { furnitureId: "proc-grass-tuft", x: 3083, z: 2513, rotation: 96, scaleW: 0.84, scaleD: 0.96, scaleH: 0.95 },
      { furnitureId: "proc-grass-tuft", x: 3424, z: 2749, rotation: 13, scaleW: 1.29, scaleD: 1.2, scaleH: 1.17 },
      { furnitureId: "proc-grass-tuft", x: 3433, z: 2458, rotation: 74, scaleW: 1.13, scaleD: 0.95, scaleH: 0.95 },
      { furnitureId: "proc-grass-tuft", x: 3276, z: 2732, rotation: 193, scaleW: 0.97, scaleD: 1.29, scaleH: 0.9 },
      { furnitureId: "proc-grass-tuft", x: 2932, z: 2646, rotation: 129, scaleW: 0.89, scaleD: 1.02, scaleH: 0.91 },
      { furnitureId: "proc-grass-tuft", x: 3541, z: 2717, rotation: 4, scaleW: 1.26, scaleD: 1.12, scaleH: 1.08 },
      { furnitureId: "proc-grass-tuft", x: 3139, z: 2782, rotation: 306, scaleW: 1.08, scaleD: 1.29, scaleH: 1.28 },
      { furnitureId: "proc-bush", x: 733, z: 1437, rotation: 72, scaleW: 0.97, scaleD: 1.01, scaleH: 1.18 },
      { furnitureId: "proc-bush", x: 784, z: 1311, rotation: 161, scaleW: 1.16, scaleD: 1.13, scaleH: 0.91 },
      { furnitureId: "proc-bush", x: 1245, z: 1286, rotation: 249, scaleW: 0.9, scaleD: 1.09, scaleH: 1.25 },
      { furnitureId: "proc-bush", x: 669, z: 1135, rotation: 101, scaleW: 1.07, scaleD: 0.92, scaleH: 1.26 },
      { furnitureId: "proc-bush", x: 3746, z: 1350, rotation: 291, scaleW: 0.99, scaleD: 1.17, scaleH: 1.06 },
      { furnitureId: "proc-bush", x: 3703, z: 1470, rotation: 280, scaleW: 0.87, scaleD: 0.97, scaleH: 0.88 },
      { furnitureId: "proc-bush", x: 3591, z: 1301, rotation: 307, scaleW: 1.06, scaleD: 0.93, scaleH: 0.96 },
      { furnitureId: "proc-bush", x: 3323, z: 1257, rotation: 164, scaleW: 1.27, scaleD: 0.82, scaleH: 1.12 },
      { furnitureId: "proc-rock", x: 745, z: 2163, rotation: 92, scaleW: 1.29, scaleD: 1.17, scaleH: 0.91 },
      { furnitureId: "proc-rock", x: 702, z: 2053, rotation: 201, scaleW: 1.12, scaleD: 1.14, scaleH: 1.08 },
      { furnitureId: "proc-rock", x: 880, z: 2102, rotation: 122, scaleW: 0.93, scaleD: 0.99, scaleH: 0.9 },
      { furnitureId: "proc-rock", x: 3653, z: 2238, rotation: 240, scaleW: 1.17, scaleD: 1.15, scaleH: 0.93 },
      { furnitureId: "proc-rock", x: 3603, z: 1784, rotation: 203, scaleW: 1.19, scaleD: 1.21, scaleH: 0.91 },
      { furnitureId: "proc-rock", x: 3883, z: 1724, rotation: 284, scaleW: 0.99, scaleD: 0.92, scaleH: 0.86 },
      { furnitureId: "stone-path", x: 2400, z: 496, rotation: 0 },
      { furnitureId: "stone-path", x: 2400, z: 888, rotation: 0 },
      { furnitureId: "stone-path", x: 2400, z: 1279, rotation: 0 },
      { furnitureId: "stone-path", x: 2400, z: 1671, rotation: 0 },
      { furnitureId: "stone-path", x: 2400, z: 2062, rotation: 0 },
      { furnitureId: "stone-path", x: 2400, z: 2454, rotation: 0 },
      { furnitureId: "proc-mountain", x: 1130, z: 455, rotation: 0, scaleW: 1.5, scaleD: 0.6, scaleH: 1.3 },
      { furnitureId: "proc-mountain", x: 3745, z: 530, rotation: 0, scaleW: 1.4, scaleD: 0.7, scaleH: 0.8 },

    ],
    },
  ],
};

const DESERT_SET: ProjectTemplate = {
  id: "set-desert",
  name: "沙漠",
  nameEn: "Desert",
  emoji: "🏜️",
  description: "沙漠：沙丘+巨石+枯树，大漠孤烟、驼队、荒漠追逐的外景",
  descriptionEn: "Desert of dunes, boulders and dead trees — lone smoke, camel caravans and desert chases",
  areaSqm: 1440,
  palette: ["#D8C090", "#B08050", "#8A6A3A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#D8C090",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#B08050",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-desert-f1",
      name: "沙漠",
      area: 1440,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4800, depth: 3000,
          name: "沙漠", nameEn: "Desert", icon: "🏜️",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-sand", x: 2400, z: 1500, rotation: 0, scaleW: 4.6, scaleD: 2.8 },
      { furnitureId: "proc-dune", x: 1035, z: 1756, rotation: 253, scaleW: 1.65, scaleD: 1.73, scaleH: 0.96 },
      { furnitureId: "proc-dune", x: 1174, z: 1987, rotation: 2, scaleW: 1.17, scaleD: 1.14, scaleH: 1.0 },
      { furnitureId: "proc-dune", x: 1105, z: 2109, rotation: 18, scaleW: 1.26, scaleD: 1.22, scaleH: 1.15 },
      { furnitureId: "proc-dune", x: 1219, z: 2176, rotation: 326, scaleW: 1.38, scaleD: 0.82, scaleH: 0.93 },
      { furnitureId: "proc-dune", x: 1140, z: 2568, rotation: 260, scaleW: 1.25, scaleD: 1.1, scaleH: 1.37 },
      { furnitureId: "proc-dune", x: 3522, z: 1648, rotation: 120, scaleW: 1.65, scaleD: 1.65, scaleH: 1.11 },
      { furnitureId: "proc-dune", x: 3828, z: 1801, rotation: 174, scaleW: 0.81, scaleD: 1.34, scaleH: 0.89 },
      { furnitureId: "proc-dune", x: 3879, z: 2130, rotation: 88, scaleW: 1.64, scaleD: 0.81, scaleH: 1.26 },
      { furnitureId: "proc-dune", x: 3615, z: 2594, rotation: 8, scaleW: 1.5, scaleD: 1.14, scaleH: 1.1 },
      { furnitureId: "proc-stone-well", x: 2400, z: 1500, rotation: 0 },
      { furnitureId: "proc-palm", x: 2080, z: 1600, rotation: 122, scaleH: 1.18 },
      { furnitureId: "proc-palm", x: 2720, z: 1580, rotation: 216, scaleH: 1.03 },
      { furnitureId: "proc-palm", x: 2400, z: 1750, rotation: 331, scaleH: 1.04 },
      { furnitureId: "proc-water-plane", x: 2400, z: 1650, rotation: 0, scaleW: 0.6, scaleD: 0.6 },
      { furnitureId: "proc-rock", x: 2450, z: 1777, rotation: 60, scaleW: 1.2, scaleD: 0.88, scaleH: 1.14 },
      { furnitureId: "proc-rock", x: 2438, z: 1581, rotation: 50, scaleW: 0.96, scaleD: 0.87, scaleH: 0.92 },
      { furnitureId: "proc-rock", x: 2624, z: 1625, rotation: 325, scaleW: 1.05, scaleD: 0.87, scaleH: 0.89 },
      { furnitureId: "proc-rock", x: 2584, z: 1549, rotation: 320, scaleW: 1.27, scaleD: 0.97, scaleH: 0.88 },
      { furnitureId: "proc-dead-tree", x: 2300, z: 2300, rotation: 72 },
      { furnitureId: "proc-dead-tree", x: 2500, z: 2650, rotation: 200 },
      { furnitureId: "proc-dead-tree", x: 1750, z: 2400, rotation: 302 },
      { furnitureId: "proc-dead-tree", x: 3050, z: 2100, rotation: 326 },
      { furnitureId: "proc-dead-tree", x: 2400, z: 2890, rotation: 218 },
      { furnitureId: "proc-rock-big", x: 1634, z: 1551, rotation: 203, scaleW: 1.13, scaleD: 1.24, scaleH: 0.99 },
      { furnitureId: "proc-rock-big", x: 1566, z: 2061, rotation: 282, scaleW: 1.17, scaleD: 0.93, scaleH: 0.86 },
      { furnitureId: "proc-rock-big", x: 1644, z: 2454, rotation: 72, scaleW: 1.1, scaleD: 0.88, scaleH: 0.87 },
      { furnitureId: "proc-rock-big", x: 3071, z: 1485, rotation: 73, scaleW: 1.12, scaleD: 1.04, scaleH: 0.95 },
      { furnitureId: "proc-rock-big", x: 2988, z: 1936, rotation: 169, scaleW: 0.9, scaleD: 1.1, scaleH: 0.88 },
      { furnitureId: "proc-rock-big", x: 3182, z: 2370, rotation: 230, scaleW: 1.08, scaleD: 1.03, scaleH: 1.03 },
      { furnitureId: "proc-banner", x: 2160, z: 1480, rotation: 20 },
      { furnitureId: "proc-banner", x: 2640, z: 1480, rotation: 340 },
      { furnitureId: "proc-banpo-firepit", x: 2400, z: 2050, rotation: 0 },
      { furnitureId: "proc-ground-dry", x: 2400, z: 2100, rotation: 0, scaleW: 0.6, scaleD: 1.6, elevationY: 2 },
      { furnitureId: "proc-mountain", x: 2400, z: 605, rotation: 0, scaleW: 2.0, scaleD: 0.8, scaleH: 1.2 },
      { furnitureId: "proc-dune", x: 530, z: 1753, rotation: 295, scaleW: 1.33, scaleD: 1.31, scaleH: 1.19 },
      { furnitureId: "proc-dune", x: 455, z: 2248, rotation: 130, scaleW: 1.12, scaleD: 1.02, scaleH: 0.87 },
      { furnitureId: "proc-dune", x: 576, z: 2548, rotation: 317, scaleW: 0.92, scaleD: 1.18, scaleH: 0.93 },
      { furnitureId: "proc-dune", x: 4332, z: 1625, rotation: 189, scaleW: 1.36, scaleD: 1.27, scaleH: 0.66 },
      { furnitureId: "proc-dune", x: 4228, z: 2100, rotation: 202, scaleW: 1.15, scaleD: 1.29, scaleH: 1.12 },
      { furnitureId: "proc-dune", x: 4288, z: 2546, rotation: 118, scaleW: 0.86, scaleD: 1.29, scaleH: 1.07 },
      { furnitureId: "proc-dead-tree", x: 500, z: 500, rotation: 148 },
      { furnitureId: "proc-dead-tree", x: 4300, z: 500, rotation: 73 },
      { furnitureId: "proc-dead-tree", x: 900, z: 900, rotation: 259 },
      { furnitureId: "proc-dead-tree", x: 3900, z: 900, rotation: 287 },
      { furnitureId: "proc-rock", x: 406, z: 778, rotation: 101, scaleW: 1.19, scaleD: 1.19, scaleH: 0.93 },
      { furnitureId: "proc-rock", x: 764, z: 687, rotation: 56, scaleW: 0.81, scaleD: 1.07, scaleH: 1.28 },
      { furnitureId: "proc-rock", x: 665, z: 613, rotation: 3, scaleW: 0.97, scaleD: 0.83, scaleH: 1.27 },
      { furnitureId: "proc-rock", x: 4390, z: 573, rotation: 46, scaleW: 1.01, scaleD: 1.03, scaleH: 0.86 },
      { furnitureId: "proc-rock", x: 4174, z: 515, rotation: 313, scaleW: 1.21, scaleD: 0.98, scaleH: 0.82 },
      { furnitureId: "proc-rock", x: 4166, z: 662, rotation: 193, scaleW: 0.94, scaleD: 0.89, scaleH: 0.99 },
      { furnitureId: "proc-rock", x: 4540, z: 2371, rotation: 348, scaleW: 1.15, scaleD: 1.07, scaleH: 0.82 },
      { furnitureId: "proc-rock", x: 4452, z: 2273, rotation: 169, scaleW: 0.96, scaleD: 1.19, scaleH: 0.92 },
      { furnitureId: "proc-dead-tree", x: 1800, z: 700, rotation: 318 },
      { furnitureId: "proc-rock", x: 1696, z: 704, rotation: 236, scaleW: 0.88, scaleD: 1.21, scaleH: 0.87 },
      { furnitureId: "proc-rock", x: 1745, z: 727, rotation: 86, scaleW: 0.97, scaleD: 0.83, scaleH: 1.2 },

    ],
    },
  ],
};

const MOUNTAIN_SET: ProjectTemplate = {
  id: "set-mountain",
  name: "山",
  nameEn: "Mountain",
  emoji: "⛰️",
  description: "高山：远山+松林+登山小径，登高望远、山中修炼、山顶对决的外景",
  descriptionEn: "High mountains with pines and a climbing path — vistas, mountain training and summit showdowns",
  areaSqm: 1728,
  palette: ["#6A7A8A", "#3A5A3A", "#8A9AA8"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#6A7A8A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A5A3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-mountain-f1",
      name: "山",
      area: 1728,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4800, depth: 3600,
          name: "山", nameEn: "Mountain", icon: "⛰️",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 2400, z: 1800, rotation: 0, scaleW: 4.6, scaleD: 3.4 },
      { furnitureId: "proc-mountain", x: 1130, z: 455, rotation: 0, scaleW: 1.5, scaleD: 0.6, scaleH: 1.0 },
      { furnitureId: "proc-mountain", x: 2100, z: 418, rotation: 0, scaleW: 1.2, scaleD: 0.55, scaleH: 0.8 },
      { furnitureId: "proc-mountain", x: 3300, z: 455, rotation: 0, scaleW: 1.5, scaleD: 0.6, scaleH: 1.2 },
      { furnitureId: "proc-mountain", x: 4000, z: 380, rotation: 0, scaleW: 1.0, scaleD: 0.5, scaleH: 0.9 },
      { furnitureId: "proc-mountain-snow", x: 1500, z: 550, rotation: 0, scaleW: 1.8, scaleD: 0.65, scaleH: 1.1 },
      { furnitureId: "proc-mountain-snow", x: 3295, z: 600, rotation: 0, scaleW: 2.0, scaleD: 0.7, scaleH: 1.3 },
      { furnitureId: "proc-pine", x: 875, z: 2182, rotation: 149, scaleW: 1.05, scaleD: 0.86, scaleH: 0.96 },
      { furnitureId: "proc-pine", x: 1528, z: 2495, rotation: 321, scaleW: 1.13, scaleD: 0.84, scaleH: 0.78 },
      { furnitureId: "proc-pine", x: 1289, z: 2280, rotation: 167, scaleW: 1.27, scaleD: 0.92, scaleH: 1.02 },
      { furnitureId: "proc-pine", x: 1046, z: 2608, rotation: 282, scaleW: 0.8, scaleD: 1.05, scaleH: 0.77 },
      { furnitureId: "proc-pine", x: 848, z: 2590, rotation: 159, scaleW: 0.89, scaleD: 1.16, scaleH: 1.35 },
      { furnitureId: "proc-pine", x: 1117, z: 2210, rotation: 194, scaleW: 0.92, scaleD: 0.96, scaleH: 0.77 },
      { furnitureId: "proc-pine", x: 1572, z: 2293, rotation: 250, scaleW: 0.95, scaleD: 1.04, scaleH: 1.37 },
      { furnitureId: "proc-pine", x: 936, z: 2402, rotation: 355, scaleW: 0.86, scaleD: 1.12, scaleH: 0.72 },
      { furnitureId: "proc-pine", x: 1327, z: 2581, rotation: 20, scaleW: 1.19, scaleD: 1.12, scaleH: 1.48 },
      { furnitureId: "proc-pine", x: 615, z: 2408, rotation: 156, scaleW: 1.18, scaleD: 1.19, scaleH: 1.01 },
      { furnitureId: "proc-pine", x: 3911, z: 2507, rotation: 99, scaleW: 0.84, scaleD: 1.0, scaleH: 1.16 },
      { furnitureId: "proc-pine", x: 3777, z: 2660, rotation: 75, scaleW: 0.98, scaleD: 0.95, scaleH: 0.78 },
      { furnitureId: "proc-pine", x: 3501, z: 2087, rotation: 268, scaleW: 1.3, scaleD: 1.07, scaleH: 1.32 },
      { furnitureId: "proc-pine", x: 3701, z: 2454, rotation: 252, scaleW: 1.0, scaleD: 1.2, scaleH: 1.03 },
      { furnitureId: "proc-pine", x: 3265, z: 2552, rotation: 26, scaleW: 1.23, scaleD: 1.03, scaleH: 1.29 },
      { furnitureId: "proc-pine", x: 4098, z: 2523, rotation: 81, scaleW: 1.03, scaleD: 1.22, scaleH: 1.2 },
      { furnitureId: "proc-pine", x: 4036, z: 2295, rotation: 253, scaleW: 1.04, scaleD: 1.1, scaleH: 1.41 },
      { furnitureId: "proc-pine", x: 3468, z: 2445, rotation: 312, scaleW: 1.13, scaleD: 0.95, scaleH: 0.88 },
      { furnitureId: "proc-rock-big", x: 709, z: 2045, rotation: 34, scaleW: 1.2, scaleD: 0.97, scaleH: 0.99 },
      { furnitureId: "proc-rock-big", x: 957, z: 2104, rotation: 184, scaleW: 1.25, scaleD: 0.97, scaleH: 1.1 },
      { furnitureId: "proc-rock-big", x: 1141, z: 2164, rotation: 346, scaleW: 1.0, scaleD: 1.28, scaleH: 1.08 },
      { furnitureId: "proc-rock-big", x: 1650, z: 2059, rotation: 243, scaleW: 1.0, scaleD: 0.97, scaleH: 0.96 },
      { furnitureId: "proc-rock-big", x: 2088, z: 1820, rotation: 334, scaleW: 1.25, scaleD: 1.13, scaleH: 1.24 },
      { furnitureId: "proc-rock-big", x: 2170, z: 1873, rotation: 168, scaleW: 0.97, scaleD: 0.97, scaleH: 0.88 },
      { furnitureId: "proc-rock-big", x: 2519, z: 2169, rotation: 180, scaleW: 1.02, scaleD: 1.21, scaleH: 0.9 },
      { furnitureId: "proc-rock-big", x: 2997, z: 1905, rotation: 138, scaleW: 1.15, scaleD: 1.28, scaleH: 0.93 },
      { furnitureId: "proc-rock-big", x: 3336, z: 1855, rotation: 260, scaleW: 1.04, scaleD: 1.05, scaleH: 1.03 },
      { furnitureId: "proc-rock-big", x: 3567, z: 1879, rotation: 140, scaleW: 1.06, scaleD: 1.1, scaleH: 1.11 },
      { furnitureId: "proc-rock-big", x: 3668, z: 2067, rotation: 147, scaleW: 1.14, scaleD: 1.29, scaleH: 1.28 },
      { furnitureId: "proc-rock-big", x: 4243, z: 1864, rotation: 56, scaleW: 1.15, scaleD: 1.16, scaleH: 1.1 },
      { furnitureId: "proc-grass-tuft", x: 1404, z: 2839, rotation: 162, scaleW: 0.85, scaleD: 1.03, scaleH: 1.07 },
      { furnitureId: "proc-grass-tuft", x: 1138, z: 2973, rotation: 327, scaleW: 1.0, scaleD: 1.06, scaleH: 1.05 },
      { furnitureId: "proc-grass-tuft", x: 976, z: 2576, rotation: 347, scaleW: 1.12, scaleD: 0.83, scaleH: 1.29 },
      { furnitureId: "proc-grass-tuft", x: 1556, z: 2977, rotation: 179, scaleW: 1.17, scaleD: 1.13, scaleH: 1.21 },
      { furnitureId: "proc-grass-tuft", x: 1221, z: 2863, rotation: 33, scaleW: 1.1, scaleD: 1.13, scaleH: 0.91 },
      { furnitureId: "proc-grass-tuft", x: 1191, z: 2894, rotation: 357, scaleW: 1.14, scaleD: 0.95, scaleH: 1.11 },
      { furnitureId: "proc-grass-tuft", x: 1009, z: 2893, rotation: 146, scaleW: 1.11, scaleD: 1.14, scaleH: 0.9 },
      { furnitureId: "proc-grass-tuft", x: 3976, z: 2746, rotation: 297, scaleW: 1.2, scaleD: 0.91, scaleH: 0.82 },
      { furnitureId: "proc-grass-tuft", x: 3930, z: 3001, rotation: 312, scaleW: 1.04, scaleD: 1.14, scaleH: 0.81 },
      { furnitureId: "proc-grass-tuft", x: 3582, z: 2917, rotation: 234, scaleW: 1.13, scaleD: 1.07, scaleH: 1.29 },
      { furnitureId: "proc-grass-tuft", x: 3771, z: 2832, rotation: 46, scaleW: 1.23, scaleD: 1.17, scaleH: 1.23 },
      { furnitureId: "proc-grass-tuft", x: 3621, z: 2517, rotation: 195, scaleW: 1.07, scaleD: 1.11, scaleH: 0.86 },
      { furnitureId: "proc-grass-tuft", x: 3757, z: 3011, rotation: 197, scaleW: 1.18, scaleD: 1.17, scaleH: 1.04 },
      { furnitureId: "proc-grass-tuft", x: 3294, z: 2638, rotation: 91, scaleW: 0.86, scaleD: 0.88, scaleH: 1.24 },
      { furnitureId: "stone-path", x: 800, z: 3275, rotation: 141 },
      { furnitureId: "stone-path", x: 1000, z: 3025, rotation: 141 },
      { furnitureId: "stone-path", x: 1000, z: 2800, rotation: 225 },
      { furnitureId: "stone-path", x: 800, z: 2600, rotation: 225 },
      { furnitureId: "stone-path", x: 800, z: 2433, rotation: 124 },
      { furnitureId: "stone-path", x: 1000, z: 2300, rotation: 124 },
      { furnitureId: "stone-path", x: 1200, z: 2167, rotation: 124 },
      { furnitureId: "stone-path", x: 1425, z: 2150, rotation: 68 },
      { furnitureId: "stone-path", x: 1675, z: 2250, rotation: 68 },
      { furnitureId: "stone-path", x: 1950, z: 2225, rotation: 117 },
      { furnitureId: "stone-path", x: 2250, z: 2075, rotation: 117 },
      { furnitureId: "stone-path", x: 2550, z: 2038, rotation: 76 },
      { furnitureId: "stone-path", x: 2850, z: 2112, rotation: 76 },
      { furnitureId: "stone-path", x: 3150, z: 2088, rotation: 113 },
      { furnitureId: "stone-path", x: 3450, z: 1962, rotation: 113 },
      { furnitureId: "proc-rock", x: 895, z: 2995, rotation: 290, scaleW: 1.25, scaleD: 1.05, scaleH: 0.82 },
      { furnitureId: "proc-rock", x: 1034, z: 2818, rotation: 175, scaleW: 1.21, scaleD: 0.82, scaleH: 1.13 },
      { furnitureId: "proc-rock", x: 2485, z: 1951, rotation: 239, scaleW: 1.22, scaleD: 0.86, scaleH: 1.15 },
      { furnitureId: "proc-rock", x: 2531, z: 2029, rotation: 29, scaleW: 1.15, scaleD: 0.93, scaleH: 0.84 },
      { furnitureId: "proc-bush", x: 979, z: 2947, rotation: 298, scaleW: 1.01, scaleD: 1.3, scaleH: 0.81 },
      { furnitureId: "proc-bush", x: 1089, z: 2801, rotation: 44, scaleW: 1.05, scaleD: 1.29, scaleH: 0.93 },
      { furnitureId: "proc-bush", x: 2758, z: 2246, rotation: 171, scaleW: 0.99, scaleD: 1.07, scaleH: 0.82 },
      { furnitureId: "proc-bush", x: 2963, z: 2146, rotation: 353, scaleW: 1.14, scaleD: 1.12, scaleH: 0.8 },
      { furnitureId: "proc-pergola", x: 3700, z: 1750, rotation: 15, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-stone-lantern", x: 3450, z: 1700, rotation: 0 },
      { furnitureId: "proc-stone-lantern", x: 3950, z: 1700, rotation: 0 },
      { furnitureId: "proc-banner", x: 3700, z: 1550, rotation: 0 },

    ],
    },
  ],
};

const CLIFF_SET: ProjectTemplate = {
  id: "set-cliff",
  name: "悬崖",
  nameEn: "Cliff Edge",
  emoji: "🧗",
  description: "悬崖：崖顶石地+巨石+松树，跳崖、崖边对峙、生死一线的外景",
  descriptionEn: "Cliff top with boulders and pines — cliff jumps, standoffs at the edge and life-or-death moments",
  areaSqm: 864,
  palette: ["#7A7A72", "#3A5A3A", "#5A6A7A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#7A7A72",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A5A3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-cliff-f1",
      name: "悬崖",
      area: 864,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3600, depth: 2400,
          name: "悬崖", nameEn: "Cliff Edge", icon: "🧗",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-stone", x: 1800, z: 1200, rotation: 0, scaleW: 3.4, scaleD: 2.2 },
      { furnitureId: "proc-rock-big", x: 700, z: 1500, rotation: 40, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-rock-big", x: 2900, z: 1500, rotation: 200, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "stone-path", x: 733, z: 1500, rotation: 90 },
      { furnitureId: "stone-path", x: 1000, z: 1500, rotation: 90 },
      { furnitureId: "stone-path", x: 1267, z: 1500, rotation: 90 },
      { furnitureId: "stone-path", x: 1533, z: 1500, rotation: 90 },
      { furnitureId: "stone-path", x: 1800, z: 1500, rotation: 90 },
      { furnitureId: "stone-path", x: 2067, z: 1500, rotation: 90 },
      { furnitureId: "stone-path", x: 2333, z: 1500, rotation: 90 },
      { furnitureId: "stone-path", x: 2600, z: 1500, rotation: 90 },
      { furnitureId: "stone-path", x: 2867, z: 1500, rotation: 90 },
      { furnitureId: "proc-pine", x: 1800, z: 1420, rotation: 0, scaleW: 1.3, scaleD: 1.3, scaleH: 1.4 },
      { furnitureId: "proc-banner", x: 1200, z: 1560, rotation: 305 },
      { furnitureId: "proc-banner", x: 1800, z: 1560, rotation: 346 },
      { furnitureId: "proc-banner", x: 2400, z: 1560, rotation: 245 },
      { furnitureId: "proc-pine", x: 901, z: 974, rotation: 96, scaleW: 0.96, scaleD: 0.91, scaleH: 0.97 },
      { furnitureId: "proc-pine", x: 745, z: 1103, rotation: 223, scaleW: 1.0, scaleD: 1.02, scaleH: 1.08 },
      { furnitureId: "proc-pine", x: 1133, z: 1097, rotation: 174, scaleW: 0.98, scaleD: 0.99, scaleH: 1.14 },
      { furnitureId: "proc-pine", x: 738, z: 1325, rotation: 67, scaleW: 0.85, scaleD: 1.06, scaleH: 0.91 },
      { furnitureId: "proc-pine", x: 442, z: 990, rotation: 147, scaleW: 0.88, scaleD: 1.1, scaleH: 0.91 },
      { furnitureId: "proc-pine", x: 971, z: 1200, rotation: 130, scaleW: 1.08, scaleD: 1.13, scaleH: 0.93 },
      { furnitureId: "proc-pine", x: 631, z: 879, rotation: 331, scaleW: 0.95, scaleD: 1.16, scaleH: 1.02 },
      { furnitureId: "proc-pine", x: 3100, z: 700, rotation: 100, scaleH: 1.1 },
      { furnitureId: "proc-rock-big", x: 1708, z: 1025, rotation: 255, scaleW: 1.11, scaleD: 1.17, scaleH: 0.86 },
      { furnitureId: "proc-rock-big", x: 1406, z: 1228, rotation: 160, scaleW: 1.0, scaleD: 1.06, scaleH: 0.91 },
      { furnitureId: "proc-rock-big", x: 2873, z: 1173, rotation: 246, scaleW: 0.93, scaleD: 1.25, scaleH: 1.11 },
      { furnitureId: "proc-rock-big", x: 2455, z: 1201, rotation: 90, scaleW: 1.15, scaleD: 1.25, scaleH: 1.16 },
      { furnitureId: "proc-bush", x: 1236, z: 1099, rotation: 278, scaleW: 0.98, scaleD: 1.14, scaleH: 1.24 },
      { furnitureId: "proc-bush", x: 977, z: 1265, rotation: 191, scaleW: 0.84, scaleD: 0.9, scaleH: 0.83 },
      { furnitureId: "proc-bush", x: 1058, z: 1053, rotation: 236, scaleW: 1.21, scaleD: 1.07, scaleH: 0.98 },
      { furnitureId: "proc-bush", x: 2658, z: 1016, rotation: 199, scaleW: 0.85, scaleD: 1.24, scaleH: 0.81 },
      { furnitureId: "proc-bush", x: 2658, z: 1178, rotation: 104, scaleW: 1.2, scaleD: 1.03, scaleH: 1.28 },
      { furnitureId: "proc-bush", x: 2690, z: 1117, rotation: 257, scaleW: 0.8, scaleD: 0.94, scaleH: 0.89 },
      { furnitureId: "proc-grass-tuft", x: 1642, z: 1292, rotation: 329, scaleW: 1.19, scaleD: 0.84, scaleH: 1.28 },
      { furnitureId: "proc-grass-tuft", x: 1412, z: 1062, rotation: 83, scaleW: 1.12, scaleD: 1.29, scaleH: 1.22 },
      { furnitureId: "proc-grass-tuft", x: 935, z: 1181, rotation: 59, scaleW: 1.04, scaleD: 1.23, scaleH: 1.06 },
      { furnitureId: "proc-grass-tuft", x: 1320, z: 1136, rotation: 353, scaleW: 0.97, scaleD: 1.2, scaleH: 1.16 },
      { furnitureId: "proc-grass-tuft", x: 815, z: 1081, rotation: 256, scaleW: 1.28, scaleD: 1.12, scaleH: 0.96 },
      { furnitureId: "proc-grass-tuft", x: 2868, z: 1031, rotation: 175, scaleW: 1.25, scaleD: 1.05, scaleH: 0.84 },
      { furnitureId: "proc-grass-tuft", x: 2955, z: 1173, rotation: 218, scaleW: 1.15, scaleD: 0.99, scaleH: 1.13 },
      { furnitureId: "proc-grass-tuft", x: 2787, z: 1129, rotation: 279, scaleW: 1.07, scaleD: 1.13, scaleH: 1.29 },
      { furnitureId: "proc-grass-tuft", x: 2430, z: 1130, rotation: 44, scaleW: 0.81, scaleD: 1.19, scaleH: 0.82 },
      { furnitureId: "proc-grass-tuft", x: 3276, z: 1229, rotation: 225, scaleW: 1.27, scaleD: 1.24, scaleH: 1.12 },
      { furnitureId: "proc-mountain", x: 1800, z: 455, rotation: 0, scaleW: 1.2, scaleD: 0.6, scaleH: 1.0 },
      { furnitureId: "proc-pine", x: 250, z: 2200, rotation: 317, scaleH: 1.13 },
      { furnitureId: "proc-pine", x: 3350, z: 2200, rotation: 3, scaleH: 1.06 },
      { furnitureId: "proc-rock-big", x: 400, z: 2050, rotation: 229, scaleW: 1.1, scaleD: 1.1 },
      { furnitureId: "proc-rock-big", x: 3200, z: 2050, rotation: 198, scaleW: 1.1, scaleD: 1.1 },
      { furnitureId: "proc-pine", x: 350, z: 1197, rotation: 177, scaleW: 0.87, scaleD: 1.25, scaleH: 0.93 },
      { furnitureId: "proc-pine", x: 303, z: 1006, rotation: 221, scaleW: 0.93, scaleD: 1.0, scaleH: 1.05 },
      { furnitureId: "proc-pine", x: 500, z: 975, rotation: 5, scaleW: 1.17, scaleD: 1.29, scaleH: 1.05 },
      { furnitureId: "proc-pine", x: 3088, z: 1147, rotation: 131, scaleW: 1.1, scaleD: 1.24, scaleH: 0.97 },
      { furnitureId: "proc-pine", x: 3322, z: 1031, rotation: 50, scaleW: 1.17, scaleD: 0.97, scaleH: 0.96 },
      { furnitureId: "proc-pine", x: 3114, z: 1327, rotation: 209, scaleW: 1.19, scaleD: 0.86, scaleH: 1.05 },
      { furnitureId: "proc-rock", x: 482, z: 1022, rotation: 174, scaleW: 1.2, scaleD: 1.14, scaleH: 0.84 },
      { furnitureId: "proc-rock", x: 286, z: 1028, rotation: 52, scaleW: 1.21, scaleD: 0.84, scaleH: 0.92 },
      { furnitureId: "proc-rock", x: 3285, z: 799, rotation: 210, scaleW: 0.84, scaleD: 0.98, scaleH: 1.1 },
      { furnitureId: "proc-rock", x: 3314, z: 1011, rotation: 87, scaleW: 0.8, scaleD: 0.8, scaleH: 1.17 },
      { furnitureId: "proc-pine", x: 250, z: 500, rotation: 77, scaleH: 1.2 },
      { furnitureId: "proc-pine", x: 3350, z: 500, rotation: 18, scaleH: 1.1 },
      { furnitureId: "proc-pine", x: 1300, z: 600, rotation: 247, scaleH: 1.1 },
      { furnitureId: "proc-rock", x: 1121, z: 756, rotation: 217, scaleW: 1.11, scaleD: 0.94, scaleH: 0.91 },
      { furnitureId: "proc-rock", x: 1230, z: 662, rotation: 346, scaleW: 1.25, scaleD: 1.01, scaleH: 0.92 },
      { furnitureId: "proc-rock", x: 1926, z: 2106, rotation: 49, scaleW: 1.1, scaleD: 1.24, scaleH: 0.97 },
      { furnitureId: "proc-rock", x: 1766, z: 1984, rotation: 156, scaleW: 1.2, scaleD: 1.03, scaleH: 0.91 },
      { furnitureId: "proc-rock", x: 1513, z: 2082, rotation: 324, scaleW: 1.09, scaleD: 1.02, scaleH: 0.9 },
      { furnitureId: "proc-grass-tuft", x: 2225, z: 2208, rotation: 71, scaleW: 1.13, scaleD: 1.09, scaleH: 1.1 },
      { furnitureId: "proc-grass-tuft", x: 2100, z: 2249, rotation: 157, scaleW: 1.04, scaleD: 0.81, scaleH: 1.15 },
      { furnitureId: "proc-grass-tuft", x: 2028, z: 2080, rotation: 338, scaleW: 0.81, scaleD: 1.15, scaleH: 1.24 },

    ],
    },
  ],
};

const WATERFALL_SET: ProjectTemplate = {
  id: "set-waterfall",
  name: "瀑布",
  nameEn: "Waterfall",
  emoji: "💧",
  description: "瀑布：岩壁落水+水潭，仙侠修炼、瀑布后山洞、水边相遇的外景",
  descriptionEn: "Waterfall with a plunge pool — xianxia training, caves behind the falls and meetings by the water",
  areaSqm: 864,
  palette: ["#3A90C0", "#5A6A5A", "#7AB060"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#3A90C0",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#5A6A5A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-waterfall-f1",
      name: "瀑布",
      area: 864,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3600, depth: 2400,
          name: "瀑布", nameEn: "Waterfall", icon: "💧",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 1800, z: 1200, rotation: 0, scaleW: 3.4, scaleD: 2.2 },
      { furnitureId: "proc-waterfall", x: 1800, z: 200, rotation: 0, scaleW: 1.3, scaleD: 1.3 },
      { furnitureId: "proc-waterfall", x: 1050, z: 200, rotation: 0, scaleW: 0.8, scaleD: 0.8 },
      { furnitureId: "proc-waterfall", x: 2550, z: 200, rotation: 0, scaleW: 0.8, scaleD: 0.8 },
      { furnitureId: "proc-rock-big", x: 1400, z: 450, rotation: 100, scaleW: 1.26, scaleD: 1.21 },
      { furnitureId: "proc-rock-big", x: 2200, z: 450, rotation: 166, scaleW: 1.42, scaleD: 1.33 },
      { furnitureId: "proc-rock-big", x: 1800, z: 550, rotation: 45, scaleW: 1.25, scaleD: 1.49 },
      { furnitureId: "proc-water-plane", x: 1800, z: 700, rotation: 0, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-water-plane", x: 1800, z: 1600, rotation: 0, scaleW: 0.5, scaleD: 0.5 },
      { furnitureId: "proc-water-plane", x: 1800, z: 2100, rotation: 0, scaleW: 0.5, scaleD: 0.45 },
      { furnitureId: "proc-tree-oak", x: 990, z: 1689, rotation: 153, scaleW: 1.04, scaleD: 1.2, scaleH: 1.29 },
      { furnitureId: "proc-tree-oak", x: 581, z: 1762, rotation: 11, scaleW: 1.02, scaleD: 0.98, scaleH: 0.83 },
      { furnitureId: "proc-tree-oak", x: 801, z: 1959, rotation: 234, scaleW: 1.09, scaleD: 1.3, scaleH: 1.02 },
      { furnitureId: "proc-tree-oak", x: 657, z: 1500, rotation: 45, scaleW: 0.97, scaleD: 1.03, scaleH: 0.96 },
      { furnitureId: "proc-tree-oak", x: 1006, z: 1454, rotation: 307, scaleW: 1.08, scaleD: 0.9, scaleH: 1.06 },
      { furnitureId: "proc-tree-oak", x: 1025, z: 1962, rotation: 17, scaleW: 0.82, scaleD: 0.9, scaleH: 1.09 },
      { furnitureId: "proc-tree-oak", x: 2779, z: 1451, rotation: 55, scaleW: 1.11, scaleD: 1.21, scaleH: 0.94 },
      { furnitureId: "proc-tree-oak", x: 2801, z: 1949, rotation: 284, scaleW: 0.91, scaleD: 1.27, scaleH: 0.91 },
      { furnitureId: "proc-tree-oak", x: 2786, z: 1720, rotation: 2, scaleW: 1.09, scaleD: 1.16, scaleH: 1.07 },
      { furnitureId: "proc-tree-oak", x: 3009, z: 1707, rotation: 234, scaleW: 1.15, scaleD: 0.83, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 2529, z: 1740, rotation: 146, scaleW: 1.22, scaleD: 1.16, scaleH: 1.28 },
      { furnitureId: "proc-bush", x: 1200, z: 1821, rotation: 58, scaleW: 1.22, scaleD: 0.84, scaleH: 0.92 },
      { furnitureId: "proc-bush", x: 1102, z: 1401, rotation: 267, scaleW: 1.23, scaleD: 1.13, scaleH: 1.13 },
      { furnitureId: "proc-bush", x: 1197, z: 1842, rotation: 177, scaleW: 0.92, scaleD: 1.12, scaleH: 1.1 },
      { furnitureId: "proc-bush", x: 811, z: 1654, rotation: 222, scaleW: 0.83, scaleD: 1.04, scaleH: 1.02 },
      { furnitureId: "proc-bush", x: 1136, z: 1520, rotation: 282, scaleW: 1.09, scaleD: 1.23, scaleH: 1.1 },
      { furnitureId: "proc-bush", x: 2504, z: 1538, rotation: 47, scaleW: 0.97, scaleD: 1.04, scaleH: 1.06 },
      { furnitureId: "proc-bush", x: 2666, z: 1612, rotation: 164, scaleW: 0.9, scaleD: 0.89, scaleH: 0.85 },
      { furnitureId: "proc-bush", x: 2572, z: 2013, rotation: 246, scaleW: 1.18, scaleD: 0.85, scaleH: 0.96 },
      { furnitureId: "proc-bush", x: 2606, z: 1832, rotation: 343, scaleW: 0.86, scaleD: 1.25, scaleH: 0.95 },
      { furnitureId: "proc-bush", x: 2528, z: 1547, rotation: 313, scaleW: 0.98, scaleD: 1.05, scaleH: 0.99 },
      { furnitureId: "proc-rock", x: 1011, z: 1145, rotation: 185, scaleW: 1.14, scaleD: 1.01, scaleH: 1.24 },
      { furnitureId: "proc-rock", x: 1027, z: 1747, rotation: 299, scaleW: 0.94, scaleD: 1.01, scaleH: 1.17 },
      { furnitureId: "proc-rock", x: 979, z: 1736, rotation: 328, scaleW: 1.1, scaleD: 1.3, scaleH: 0.91 },
      { furnitureId: "proc-rock", x: 1049, z: 1576, rotation: 344, scaleW: 1.08, scaleD: 1.3, scaleH: 1.16 },
      { furnitureId: "proc-rock", x: 2467, z: 1481, rotation: 278, scaleW: 1.29, scaleD: 0.98, scaleH: 1.16 },
      { furnitureId: "proc-rock", x: 2547, z: 1455, rotation: 138, scaleW: 0.81, scaleD: 1.23, scaleH: 0.93 },
      { furnitureId: "proc-rock", x: 2751, z: 1554, rotation: 77, scaleW: 0.88, scaleD: 1.0, scaleH: 0.8 },
      { furnitureId: "proc-rock", x: 2565, z: 1779, rotation: 13, scaleW: 1.08, scaleD: 0.95, scaleH: 0.92 },
      { furnitureId: "proc-grass-tuft", x: 1133, z: 1921, rotation: 40, scaleW: 1.06, scaleD: 1.05, scaleH: 0.92 },
      { furnitureId: "proc-grass-tuft", x: 903, z: 1858, rotation: 268, scaleW: 0.9, scaleD: 0.86, scaleH: 1.15 },
      { furnitureId: "proc-grass-tuft", x: 1119, z: 1643, rotation: 328, scaleW: 1.1, scaleD: 0.98, scaleH: 1.05 },
      { furnitureId: "proc-grass-tuft", x: 845, z: 1769, rotation: 148, scaleW: 0.91, scaleD: 0.85, scaleH: 0.94 },
      { furnitureId: "proc-grass-tuft", x: 1053, z: 1844, rotation: 15, scaleW: 1.17, scaleD: 1.2, scaleH: 1.09 },
      { furnitureId: "proc-grass-tuft", x: 971, z: 1709, rotation: 194, scaleW: 0.91, scaleD: 1.3, scaleH: 1.3 },
      { furnitureId: "proc-grass-tuft", x: 2746, z: 1837, rotation: 193, scaleW: 1.0, scaleD: 1.12, scaleH: 0.94 },
      { furnitureId: "proc-grass-tuft", x: 2780, z: 2029, rotation: 269, scaleW: 1.21, scaleD: 0.95, scaleH: 1.21 },
      { furnitureId: "proc-grass-tuft", x: 2511, z: 1651, rotation: 138, scaleW: 1.16, scaleD: 0.87, scaleH: 1.24 },
      { furnitureId: "proc-grass-tuft", x: 2459, z: 1669, rotation: 322, scaleW: 1.25, scaleD: 1.27, scaleH: 1.13 },
      { furnitureId: "proc-grass-tuft", x: 2728, z: 2080, rotation: 47, scaleW: 1.03, scaleD: 1.19, scaleH: 1.02 },
      { furnitureId: "proc-grass-tuft", x: 2577, z: 1980, rotation: 192, scaleW: 1.28, scaleD: 0.81, scaleH: 0.89 },
      { furnitureId: "stone-path", x: 1150, z: 2150, rotation: 180 },
      { furnitureId: "stone-path", x: 1150, z: 1850, rotation: 180 },
      { furnitureId: "stone-path", x: 1225, z: 1550, rotation: 153 },
      { furnitureId: "stone-path", x: 1250, z: 1312, rotation: 210 },
      { furnitureId: "stone-path", x: 1150, z: 1138, rotation: 210 },
      { furnitureId: "proc-stone-lantern", x: 1100, z: 950, rotation: 0 },
      { furnitureId: "proc-stone-lantern", x: 2500, z: 950, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 320, z: 1372, rotation: 81, scaleW: 1.12, scaleD: 0.84, scaleH: 0.9 },
      { furnitureId: "proc-tree-oak", x: 256, z: 955, rotation: 261, scaleW: 0.92, scaleD: 0.87, scaleH: 1.02 },
      { furnitureId: "proc-tree-oak", x: 262, z: 1697, rotation: 119, scaleW: 1.21, scaleD: 0.94, scaleH: 0.93 },
      { furnitureId: "proc-tree-oak", x: 202, z: 724, rotation: 203, scaleW: 1.28, scaleD: 0.99, scaleH: 1.17 },
      { furnitureId: "proc-tree-oak", x: 3193, z: 1624, rotation: 344, scaleW: 0.87, scaleD: 1.29, scaleH: 0.96 },
      { furnitureId: "proc-tree-oak", x: 3432, z: 1243, rotation: 33, scaleW: 0.88, scaleD: 0.81, scaleH: 1.02 },
      { furnitureId: "proc-tree-oak", x: 3319, z: 814, rotation: 113, scaleW: 0.96, scaleD: 0.98, scaleH: 1.04 },
      { furnitureId: "proc-tree-oak", x: 3319, z: 548, rotation: 22, scaleW: 0.92, scaleD: 1.1, scaleH: 1.0 },
      { furnitureId: "proc-bush", x: 288, z: 276, rotation: 285, scaleW: 0.87, scaleD: 0.97, scaleH: 0.82 },
      { furnitureId: "proc-bush", x: 161, z: 496, rotation: 203, scaleW: 1.02, scaleD: 1.22, scaleH: 0.85 },
      { furnitureId: "proc-bush", x: 306, z: 430, rotation: 210, scaleW: 0.87, scaleD: 0.92, scaleH: 0.82 },
      { furnitureId: "proc-bush", x: 3241, z: 585, rotation: 221, scaleW: 1.01, scaleD: 1.26, scaleH: 0.97 },
      { furnitureId: "proc-bush", x: 3339, z: 682, rotation: 306, scaleW: 0.95, scaleD: 1.01, scaleH: 1.11 },
      { furnitureId: "proc-bush", x: 3322, z: 711, rotation: 3, scaleW: 1.2, scaleD: 0.86, scaleH: 0.84 },
      { furnitureId: "proc-rock", x: 335, z: 1834, rotation: 239, scaleW: 1.17, scaleD: 1.1, scaleH: 0.91 },
      { furnitureId: "proc-rock", x: 408, z: 1820, rotation: 167, scaleW: 0.81, scaleD: 0.96, scaleH: 1.16 },
      { furnitureId: "proc-rock", x: 3243, z: 1888, rotation: 316, scaleW: 1.05, scaleD: 0.97, scaleH: 1.15 },
      { furnitureId: "proc-rock", x: 3281, z: 2078, rotation: 179, scaleW: 1.07, scaleD: 0.95, scaleH: 0.96 },

    ],
    },
  ],
};

const LAKE_SET: ProjectTemplate = {
  id: "set-lake",
  name: "湖",
  nameEn: "Lake",
  emoji: "🏞️",
  description: "湖：湖岸+湖面+木船，湖边漫步、泛舟、湖畔告白的外景",
  descriptionEn: "Lake shore with a wooden boat — lakeside walks, boating and confessions by the water",
  areaSqm: 1232,
  palette: ["#3A90C0", "#5A9E3A", "#6A8A5A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#3A90C0",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#5A9E3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-lake-f1",
      name: "湖",
      area: 1232,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4400, depth: 2800,
          name: "湖", nameEn: "Lake", icon: "🏞️",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 2200, z: 1400, rotation: 0, scaleW: 4.2, scaleD: 2.6 },
      { furnitureId: "proc-water-plane", x: 2200, z: 900, rotation: 0, scaleW: 2.2, scaleD: 1.6 },
      { furnitureId: "proc-rock", x: 600, z: 1690, rotation: 187, scaleW: 0.96, scaleD: 0.71 },
      { furnitureId: "proc-rock", x: 1000, z: 1638, rotation: 96, scaleW: 0.77, scaleD: 1.08 },
      { furnitureId: "proc-rock", x: 1450, z: 1791, rotation: 122, scaleW: 0.73, scaleD: 0.97 },
      { furnitureId: "proc-rock", x: 1900, z: 1642, rotation: 27, scaleW: 1.02, scaleD: 0.99 },
      { furnitureId: "proc-rock", x: 2400, z: 1640, rotation: 124, scaleW: 1.15, scaleD: 1.03 },
      { furnitureId: "proc-rock", x: 2900, z: 1724, rotation: 261, scaleW: 0.92, scaleD: 1.0 },
      { furnitureId: "proc-rock", x: 3350, z: 1703, rotation: 96, scaleW: 0.74, scaleD: 1.04 },
      { furnitureId: "proc-rock", x: 3800, z: 1707, rotation: 332, scaleW: 1.07, scaleD: 1.05 },
      { furnitureId: "proc-grass-tuft", x: 1442, z: 1860, rotation: 246, scaleW: 0.91, scaleD: 0.93, scaleH: 0.98 },
      { furnitureId: "proc-grass-tuft", x: 2480, z: 1899, rotation: 347, scaleW: 0.84, scaleD: 1.0, scaleH: 1.17 },
      { furnitureId: "proc-grass-tuft", x: 1975, z: 1766, rotation: 206, scaleW: 1.16, scaleD: 1.14, scaleH: 1.12 },
      { furnitureId: "proc-grass-tuft", x: 1351, z: 1861, rotation: 235, scaleW: 0.85, scaleD: 1.08, scaleH: 1.11 },
      { furnitureId: "proc-grass-tuft", x: 1145, z: 1916, rotation: 263, scaleW: 1.2, scaleD: 1.07, scaleH: 1.09 },
      { furnitureId: "proc-grass-tuft", x: 1782, z: 1825, rotation: 195, scaleW: 1.21, scaleD: 1.01, scaleH: 0.86 },
      { furnitureId: "proc-grass-tuft", x: 3558, z: 1847, rotation: 125, scaleW: 0.93, scaleD: 1.26, scaleH: 1.28 },
      { furnitureId: "proc-grass-tuft", x: 2456, z: 1857, rotation: 294, scaleW: 0.82, scaleD: 0.86, scaleH: 1.1 },
      { furnitureId: "proc-grass-tuft", x: 3212, z: 1864, rotation: 97, scaleW: 0.85, scaleD: 0.84, scaleH: 1.29 },
      { furnitureId: "proc-grass-tuft", x: 1854, z: 1760, rotation: 259, scaleW: 1.15, scaleD: 0.88, scaleH: 1.26 },
      { furnitureId: "proc-wooden-boat", x: 2200, z: 800, rotation: 140 },
      { furnitureId: "proc-wooden-boat", x: 2500, z: 1600, rotation: 75 },
      { furnitureId: "stone-path", x: 2500, z: 2481, rotation: 180 },
      { furnitureId: "stone-path", x: 2500, z: 2244, rotation: 180 },
      { furnitureId: "stone-path", x: 2500, z: 2006, rotation: 180 },
      { furnitureId: "stone-path", x: 2500, z: 1769, rotation: 180 },
      { furnitureId: "proc-rock-big", x: 1500, z: 850, rotation: 60, scaleW: 1.5, scaleD: 1.5 },
      { furnitureId: "proc-tree-oak", x: 940, z: 2544, rotation: 138, scaleW: 1.12, scaleD: 1.21, scaleH: 1.27 },
      { furnitureId: "proc-tree-oak", x: 986, z: 2044, rotation: 91, scaleW: 1.28, scaleD: 0.87, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 1340, z: 2308, rotation: 136, scaleW: 0.99, scaleD: 0.87, scaleH: 0.88 },
      { furnitureId: "proc-tree-oak", x: 664, z: 2390, rotation: 124, scaleW: 1.0, scaleD: 1.02, scaleH: 1.12 },
      { furnitureId: "proc-tree-oak", x: 677, z: 2116, rotation: 193, scaleW: 1.22, scaleD: 1.01, scaleH: 0.93 },
      { furnitureId: "proc-tree-oak", x: 1235, z: 2552, rotation: 222, scaleW: 0.9, scaleD: 1.21, scaleH: 0.85 },
      { furnitureId: "proc-tree-oak", x: 1057, z: 2308, rotation: 171, scaleW: 1.09, scaleD: 1.02, scaleH: 0.81 },
      { furnitureId: "proc-tree-oak", x: 3643, z: 2293, rotation: 132, scaleW: 0.93, scaleD: 1.11, scaleH: 1.07 },
      { furnitureId: "proc-tree-oak", x: 3253, z: 2349, rotation: 177, scaleW: 1.2, scaleD: 1.04, scaleH: 0.9 },
      { furnitureId: "proc-tree-oak", x: 3041, z: 2139, rotation: 139, scaleW: 1.27, scaleD: 1.13, scaleH: 1.07 },
      { furnitureId: "proc-tree-oak", x: 3334, z: 2047, rotation: 275, scaleW: 1.25, scaleD: 1.28, scaleH: 1.14 },
      { furnitureId: "proc-tree-oak", x: 2948, z: 2383, rotation: 26, scaleW: 0.88, scaleD: 1.05, scaleH: 0.84 },
      { furnitureId: "proc-outdoor-bench", x: 1100, z: 2050, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 1700, z: 2050, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 2300, z: 2050, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 2900, z: 2050, rotation: 180 },
      { furnitureId: "proc-stone-lantern", x: 900, z: 2000, rotation: 37 },
      { furnitureId: "proc-stone-lantern", x: 2200, z: 2050, rotation: 303 },
      { furnitureId: "proc-stone-lantern", x: 3500, z: 2000, rotation: 318 },
      { furnitureId: "proc-bush", x: 1141, z: 2228, rotation: 225, scaleW: 1.18, scaleD: 0.85, scaleH: 0.94 },
      { furnitureId: "proc-bush", x: 1325, z: 2091, rotation: 298, scaleW: 1.01, scaleD: 1.24, scaleH: 1.27 },
      { furnitureId: "proc-bush", x: 1497, z: 2164, rotation: 84, scaleW: 0.9, scaleD: 0.93, scaleH: 0.86 },
      { furnitureId: "proc-bush", x: 3465, z: 2121, rotation: 330, scaleW: 1.17, scaleD: 1.15, scaleH: 0.82 },
      { furnitureId: "proc-bush", x: 3427, z: 2232, rotation: 249, scaleW: 1.25, scaleD: 1.03, scaleH: 1.18 },
      { furnitureId: "proc-bush", x: 3198, z: 2082, rotation: 313, scaleW: 1.15, scaleD: 0.96, scaleH: 0.97 },
      { furnitureId: "proc-pergola", x: 3950, z: 2350, rotation: 20, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-tree-oak", x: 300, z: 300, rotation: 277, scaleH: 0.96 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 300, rotation: 301, scaleH: 1.0 },
      { furnitureId: "proc-tree-oak", x: 300, z: 1100, rotation: 8, scaleH: 1.2 },
      { furnitureId: "proc-tree-oak", x: 300, z: 1700, rotation: 253, scaleH: 1.04 },
      { furnitureId: "proc-rock", x: 446, z: 426, rotation: 109, scaleW: 0.84, scaleD: 0.95, scaleH: 1.2 },
      { furnitureId: "proc-rock", x: 235, z: 226, rotation: 102, scaleW: 0.92, scaleD: 1.11, scaleH: 0.94 },
      { furnitureId: "proc-rock", x: 381, z: 429, rotation: 45, scaleW: 0.92, scaleD: 0.9, scaleH: 0.96 },
      { furnitureId: "proc-rock", x: 4150, z: 223, rotation: 124, scaleW: 1.12, scaleD: 1.09, scaleH: 1.11 },
      { furnitureId: "proc-rock", x: 3947, z: 415, rotation: 149, scaleW: 0.96, scaleD: 0.92, scaleH: 1.02 },
      { furnitureId: "proc-rock", x: 4074, z: 209, rotation: 269, scaleW: 0.87, scaleD: 1.17, scaleH: 0.92 },
      { furnitureId: "proc-bush", x: 329, z: 1533, rotation: 95, scaleW: 1.22, scaleD: 0.9, scaleH: 0.97 },
      { furnitureId: "proc-bush", x: 232, z: 1422, rotation: 170, scaleW: 0.92, scaleD: 1.1, scaleH: 0.89 },
      { furnitureId: "proc-bush", x: 360, z: 1052, rotation: 251, scaleW: 1.19, scaleD: 1.12, scaleH: 0.85 },

    ],
    },
  ],
};

const BEACH_SET: ProjectTemplate = {
  id: "set-beach",
  name: "海滩",
  nameEn: "Beach",
  emoji: "🏖️",
  description: "海滩：沙滩+海面+棕榈树，海边度假、沙滩漫步、日落告白的外景",
  descriptionEn: "Sandy beach with sea and palms — seaside holidays, beach walks and sunset confessions",
  areaSqm: 1232,
  palette: ["#D8C090", "#2A7AB0", "#F5E8C8"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#D8C090",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#2A7AB0",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-beach-f1",
      name: "海滩",
      area: 1232,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4400, depth: 2800,
          name: "海滩", nameEn: "Beach", icon: "🏖️",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-sand", x: 2200, z: 1400, rotation: 0, scaleW: 4.2, scaleD: 2.6 },
      { furnitureId: "proc-sea-plane", x: 2200, z: 700, rotation: 0, scaleW: 2.4, scaleD: 1.2 },
      { furnitureId: "proc-rock", x: 500, z: 1341, rotation: 259, scaleW: 0.67, scaleD: 0.79 },
      { furnitureId: "proc-rock", x: 900, z: 1379, rotation: 299, scaleW: 0.71, scaleD: 0.61 },
      { furnitureId: "proc-rock", x: 1300, z: 1275, rotation: 340, scaleW: 0.78, scaleD: 0.57 },
      { furnitureId: "proc-rock", x: 1750, z: 1303, rotation: 223, scaleW: 0.69, scaleD: 0.51 },
      { furnitureId: "proc-rock", x: 2200, z: 1280, rotation: 16, scaleW: 0.51, scaleD: 0.7 },
      { furnitureId: "proc-rock", x: 2650, z: 1311, rotation: 194, scaleW: 0.72, scaleD: 0.68 },
      { furnitureId: "proc-rock", x: 3100, z: 1349, rotation: 233, scaleW: 0.66, scaleD: 0.59 },
      { furnitureId: "proc-rock", x: 3550, z: 1374, rotation: 65, scaleW: 0.7, scaleD: 0.66 },
      { furnitureId: "proc-rock", x: 3950, z: 1407, rotation: 328, scaleW: 0.5, scaleD: 0.53 },
      { furnitureId: "proc-palm", x: 1074, z: 2204, rotation: 345, scaleH: 0.99 },
      { furnitureId: "proc-palm", x: 1112, z: 2229, rotation: 306, scaleH: 0.82 },
      { furnitureId: "proc-palm", x: 1176, z: 2013, rotation: 175, scaleH: 1.11 },
      { furnitureId: "proc-palm", x: 2313, z: 2406, rotation: 0, scaleH: 1.27 },
      { furnitureId: "proc-palm", x: 2136, z: 2378, rotation: 71, scaleH: 0.94 },
      { furnitureId: "proc-palm", x: 2317, z: 2158, rotation: 188, scaleH: 1.19 },
      { furnitureId: "proc-palm", x: 3604, z: 2215, rotation: 42, scaleH: 1.08 },
      { furnitureId: "proc-palm", x: 3299, z: 2201, rotation: 71, scaleH: 0.89 },
      { furnitureId: "proc-palm", x: 3217, z: 2102, rotation: 345, scaleH: 0.85 },
      { furnitureId: "proc-wooden-boat", x: 1500, z: 1450, rotation: 30 },
      { furnitureId: "proc-dune", x: 900, z: 2216, rotation: 55, scaleW: 1.5, scaleD: 1.22 },
      { furnitureId: "proc-dune", x: 2200, z: 2240, rotation: 145, scaleW: 1.27, scaleD: 1.37 },
      { furnitureId: "proc-dune", x: 3500, z: 2366, rotation: 135, scaleW: 1.0, scaleD: 1.02 },
      { furnitureId: "proc-outdoor-bench", x: 1200, z: 1900, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 2200, z: 1900, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 3200, z: 1900, rotation: 180 },
      { furnitureId: "proc-banpo-firepit", x: 2600, z: 1800, rotation: 0 },
      { furnitureId: "proc-bush", x: 807, z: 2487, rotation: 315, scaleW: 1.15, scaleD: 1.09, scaleH: 1.27 },
      { furnitureId: "proc-bush", x: 1183, z: 2478, rotation: 57, scaleW: 1.16, scaleD: 1.08, scaleH: 0.82 },
      { furnitureId: "proc-bush", x: 3558, z: 2424, rotation: 221, scaleW: 1.04, scaleD: 1.09, scaleH: 1.24 },
      { furnitureId: "proc-bush", x: 3178, z: 2526, rotation: 306, scaleW: 0.91, scaleD: 1.24, scaleH: 0.86 },
      { furnitureId: "proc-wooden-boat", x: 3300, z: 250, rotation: 200 },
      { furnitureId: "proc-wooden-boat", x: 2200, z: 350, rotation: 140 },
      { furnitureId: "proc-rock", x: 1391, z: 616, rotation: 40, scaleW: 0.89, scaleD: 0.87, scaleH: 1.04 },
      { furnitureId: "proc-rock", x: 1268, z: 606, rotation: 214, scaleW: 1.29, scaleD: 1.19, scaleH: 1.23 },
      { furnitureId: "proc-rock", x: 1396, z: 364, rotation: 40, scaleW: 1.04, scaleD: 0.95, scaleH: 1.25 },
      { furnitureId: "proc-palm", x: 300, z: 1900, rotation: 228, scaleH: 0.97 },
      { furnitureId: "proc-palm", x: 300, z: 2400, rotation: 185, scaleH: 1.14 },
      { furnitureId: "proc-palm", x: 4100, z: 1900, rotation: 31, scaleH: 1.1 },
      { furnitureId: "proc-palm", x: 4100, z: 2400, rotation: 351, scaleH: 1.1 },
      { furnitureId: "proc-rock", x: 300, z: 400, rotation: 228, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-rock", x: 4100, z: 400, rotation: 305, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-bush", x: 195, z: 2162, rotation: 71, scaleW: 1.26, scaleD: 1.24, scaleH: 1.19 },
      { furnitureId: "proc-bush", x: 222, z: 2127, rotation: 250, scaleW: 1.27, scaleD: 1.07, scaleH: 0.95 },
      { furnitureId: "proc-bush", x: 4062, z: 2200, rotation: 285, scaleW: 1.16, scaleD: 1.06, scaleH: 0.88 },
      { furnitureId: "proc-bush", x: 4036, z: 2365, rotation: 267, scaleW: 1.22, scaleD: 1.28, scaleH: 0.99 },

    ],
    },
  ],
};

const SNOW_SET: ProjectTemplate = {
  id: "set-snow",
  name: "雪山",
  nameEn: "Snow Mountain",
  emoji: "❄️",
  description: "雪山：雪地+雪松+雪顶远山，雪中漫步、雪地追逐、雪夜相拥的外景",
  descriptionEn: "Snowfield with snow pines and snowy peaks — walks in the snow, snow chases and snowy nights",
  areaSqm: 1728,
  palette: ["#F0F4F8", "#7A8A9A", "#2A4A6A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#F0F4F8",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#7A8A9A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-snow-f1",
      name: "雪山",
      area: 1728,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4800, depth: 3600,
          name: "雪山", nameEn: "Snow Mountain", icon: "❄️",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-snow", x: 2400, z: 1800, rotation: 0, scaleW: 4.6, scaleD: 3.4 },
      { furnitureId: "proc-pine-snow", x: 879, z: 2690, rotation: 278, scaleW: 0.82, scaleD: 1.14, scaleH: 1.18 },
      { furnitureId: "proc-pine-snow", x: 1006, z: 2493, rotation: 267, scaleW: 1.09, scaleD: 0.87, scaleH: 1.39 },
      { furnitureId: "proc-pine-snow", x: 1453, z: 2411, rotation: 337, scaleW: 0.9, scaleD: 1.01, scaleH: 1.07 },
      { furnitureId: "proc-pine-snow", x: 1162, z: 2267, rotation: 311, scaleW: 1.29, scaleD: 0.88, scaleH: 1.23 },
      { furnitureId: "proc-pine-snow", x: 3774, z: 2566, rotation: 188, scaleW: 1.27, scaleD: 0.9, scaleH: 1.21 },
      { furnitureId: "proc-pine-snow", x: 3567, z: 2206, rotation: 196, scaleW: 0.87, scaleD: 1.06, scaleH: 0.92 },
      { furnitureId: "proc-pine", x: 700, z: 2000, rotation: 335, scaleH: 1.02 },
      { furnitureId: "proc-pine", x: 1800, z: 2800, rotation: 321, scaleH: 1.0 },
      { furnitureId: "proc-pine", x: 3100, z: 2000, rotation: 347, scaleH: 1.18 },
      { furnitureId: "proc-pine", x: 4200, z: 2800, rotation: 121, scaleH: 1.23 },
      { furnitureId: "proc-banpo-firepit", x: 2400, z: 1800, rotation: 0 },
      { furnitureId: "proc-tent", x: 2900, z: 1900, rotation: 200, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-banner", x: 2100, z: 1600, rotation: 10 },
      { furnitureId: "proc-banner", x: 2700, z: 1600, rotation: 350 },
      { furnitureId: "proc-rock", x: 1706, z: 1638, rotation: 186, scaleW: 0.93, scaleD: 0.81, scaleH: 0.86 },
      { furnitureId: "proc-rock", x: 1502, z: 2050, rotation: 292, scaleW: 0.93, scaleD: 1.28, scaleH: 0.73 },
      { furnitureId: "proc-rock", x: 1611, z: 1649, rotation: 144, scaleW: 1.24, scaleD: 1.01, scaleH: 0.99 },
      { furnitureId: "proc-rock", x: 1414, z: 1634, rotation: 266, scaleW: 1.1, scaleD: 1.26, scaleH: 0.89 },
      { furnitureId: "proc-rock", x: 3215, z: 2035, rotation: 243, scaleW: 1.1, scaleD: 1.26, scaleH: 0.76 },
      { furnitureId: "proc-rock", x: 3276, z: 1503, rotation: 339, scaleW: 1.09, scaleD: 1.22, scaleH: 0.96 },
      { furnitureId: "proc-rock", x: 3014, z: 1698, rotation: 140, scaleW: 0.99, scaleD: 1.02, scaleH: 0.88 },
      { furnitureId: "proc-rock", x: 3326, z: 1912, rotation: 250, scaleW: 1.2, scaleD: 1.12, scaleH: 0.96 },
      { furnitureId: "stone-path", x: 1950, z: 2600, rotation: 90 },
      { furnitureId: "stone-path", x: 2250, z: 2600, rotation: 90 },
      { furnitureId: "stone-path", x: 2425, z: 2475, rotation: 169 },
      { furnitureId: "stone-path", x: 2475, z: 2225, rotation: 169 },
      { furnitureId: "stone-path", x: 2600, z: 2025, rotation: 127 },
      { furnitureId: "proc-mountain-snow", x: 1355, z: 500, rotation: 0, scaleW: 1.8, scaleD: 0.6, scaleH: 1.1 },
      { furnitureId: "proc-mountain-snow", x: 2400, z: 550, rotation: 0, scaleW: 2.2, scaleD: 0.7, scaleH: 1.3 },
      { furnitureId: "proc-mountain-snow", x: 3200, z: 500, rotation: 0, scaleW: 2.0, scaleD: 0.6, scaleH: 1.2 },
      { furnitureId: "proc-mountain", x: 3895, z: 400, rotation: 0, scaleW: 1.2, scaleD: 0.5, scaleH: 0.9 },
      { furnitureId: "proc-bush-snow", x: 1368, z: 2187, rotation: 88, scaleW: 1.13, scaleD: 0.82, scaleH: 1.07 },
      { furnitureId: "proc-bush-snow", x: 1048, z: 2309, rotation: 136, scaleW: 0.96, scaleD: 1.24, scaleH: 1.06 },
      { furnitureId: "proc-bush-snow", x: 1349, z: 2533, rotation: 214, scaleW: 0.85, scaleD: 0.97, scaleH: 0.89 },
      { furnitureId: "proc-bush-snow", x: 769, z: 2467, rotation: 52, scaleW: 0.85, scaleD: 1.27, scaleH: 1.2 },
      { furnitureId: "proc-bush-snow", x: 3602, z: 2503, rotation: 242, scaleW: 1.25, scaleD: 0.84, scaleH: 1.24 },
      { furnitureId: "proc-bush-snow", x: 3779, z: 2335, rotation: 217, scaleW: 0.82, scaleD: 1.06, scaleH: 1.17 },
      { furnitureId: "proc-bush-snow", x: 3702, z: 2378, rotation: 180, scaleW: 1.12, scaleD: 0.94, scaleH: 1.15 },
      { furnitureId: "proc-bush-snow", x: 3716, z: 2636, rotation: 88, scaleW: 0.88, scaleD: 1.19, scaleH: 0.89 },
      { furnitureId: "proc-pine-snow", x: 600, z: 3350, rotation: 287, scaleH: 1.01 },
      { furnitureId: "proc-pine-snow", x: 1500, z: 3350, rotation: 7, scaleH: 1.29 },
      { furnitureId: "proc-pine-snow", x: 2400, z: 3350, rotation: 127, scaleH: 1.16 },
      { furnitureId: "proc-pine-snow", x: 3300, z: 3350, rotation: 352, scaleH: 1.12 },
      { furnitureId: "proc-pine-snow", x: 4200, z: 3350, rotation: 305, scaleH: 1.18 },
      { furnitureId: "proc-bush-snow", x: 1042, z: 3184, rotation: 121, scaleW: 0.9, scaleD: 0.92, scaleH: 1.12 },
      { furnitureId: "proc-bush-snow", x: 1369, z: 3314, rotation: 277, scaleW: 1.23, scaleD: 1.0, scaleH: 0.92 },
      { furnitureId: "proc-bush-snow", x: 1054, z: 3302, rotation: 92, scaleW: 1.14, scaleD: 1.11, scaleH: 1.11 },
      { furnitureId: "proc-bush-snow", x: 3517, z: 3283, rotation: 126, scaleW: 0.87, scaleD: 1.19, scaleH: 1.03 },
      { furnitureId: "proc-bush-snow", x: 3790, z: 3328, rotation: 274, scaleW: 1.14, scaleD: 1.23, scaleH: 1.21 },
      { furnitureId: "proc-bush-snow", x: 3649, z: 3230, rotation: 45, scaleW: 0.89, scaleD: 0.9, scaleH: 1.22 },
      { furnitureId: "proc-pine-snow", x: 300, z: 400, rotation: 348, scaleH: 1.2 },
      { furnitureId: "proc-rock", x: 414, z: 381, rotation: 285, scaleW: 1.3, scaleD: 1.1, scaleH: 0.86 },
      { furnitureId: "proc-rock", x: 322, z: 621, rotation: 339, scaleW: 1.09, scaleD: 1.09, scaleH: 0.69 },

    ],
    },
  ],
};

const FLOWER_FIELD_SET: ProjectTemplate = {
  id: "set-flower-field",
  name: "花海",
  nameEn: "Flower Field",
  emoji: "🌸",
  description: "花海：薰衣草+野花+油菜花，花田漫步、求婚、偶像剧式回眸的外景",
  descriptionEn: "Flower fields of lavender, wildflowers and rapeseed — walks among blooms, proposals and drama-style turnarounds",
  areaSqm: 1040,
  palette: ["#C88AC8", "#5A9E3A", "#E8A44A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#C88AC8",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#5A9E3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-flower-field-f1",
      name: "花海",
      area: 1040,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4000, depth: 2600,
          name: "花海", nameEn: "Flower Field", icon: "🌸",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 2000, z: 1300, rotation: 0, scaleW: 3.8, scaleD: 2.4 },
      { furnitureId: "proc-flower-lavender", x: 405, z: 686, rotation: 181, scaleW: 0.98, scaleD: 0.93, scaleH: 0.83 },
      { furnitureId: "proc-flower-lavender", x: 365, z: 930, rotation: 122, scaleW: 0.94, scaleD: 1.11, scaleH: 1.11 },
      { furnitureId: "proc-flower-lavender", x: 482, z: 1253, rotation: 170, scaleW: 1.18, scaleD: 1.05, scaleH: 0.9 },
      { furnitureId: "proc-flower-lavender", x: 383, z: 1538, rotation: 246, scaleW: 1.07, scaleD: 1.18, scaleH: 0.86 },
      { furnitureId: "proc-flower-lavender", x: 475, z: 1760, rotation: 195, scaleW: 0.98, scaleD: 0.92, scaleH: 0.86 },
      { furnitureId: "proc-flower-lavender", x: 606, z: 727, rotation: 333, scaleW: 1.11, scaleD: 0.91, scaleH: 0.94 },
      { furnitureId: "proc-flower-lavender", x: 644, z: 975, rotation: 193, scaleW: 1.16, scaleD: 1.18, scaleH: 0.96 },
      { furnitureId: "proc-flower-lavender", x: 580, z: 1182, rotation: 247, scaleW: 1.07, scaleD: 1.0, scaleH: 1.01 },
      { furnitureId: "proc-flower-lavender", x: 593, z: 1570, rotation: 258, scaleW: 0.94, scaleD: 1.12, scaleH: 1.0 },
      { furnitureId: "proc-flower-lavender", x: 719, z: 1830, rotation: 19, scaleW: 1.04, scaleD: 1.0, scaleH: 1.0 },
      { furnitureId: "proc-flower-lavender", x: 835, z: 566, rotation: 127, scaleW: 0.95, scaleD: 1.18, scaleH: 0.85 },
      { furnitureId: "proc-flower-lavender", x: 760, z: 892, rotation: 259, scaleW: 1.12, scaleD: 1.0, scaleH: 0.88 },
      { furnitureId: "proc-flower-lavender", x: 925, z: 1219, rotation: 317, scaleW: 1.09, scaleD: 1.17, scaleH: 0.93 },
      { furnitureId: "proc-flower-lavender", x: 811, z: 1514, rotation: 226, scaleW: 1.16, scaleD: 1.0, scaleH: 1.03 },
      { furnitureId: "proc-flower-lavender", x: 847, z: 1857, rotation: 290, scaleW: 1.06, scaleD: 1.03, scaleH: 0.96 },
      { furnitureId: "proc-flower-lavender", x: 1112, z: 590, rotation: 344, scaleW: 1.16, scaleD: 1.1, scaleH: 1.16 },
      { furnitureId: "proc-flower-lavender", x: 1001, z: 929, rotation: 307, scaleW: 1.03, scaleD: 0.99, scaleH: 0.89 },
      { furnitureId: "proc-flower-lavender", x: 1106, z: 1322, rotation: 60, scaleW: 0.94, scaleD: 1.1, scaleH: 0.93 },
      { furnitureId: "proc-flower-lavender", x: 1130, z: 1613, rotation: 275, scaleW: 0.92, scaleD: 1.02, scaleH: 0.95 },
      { furnitureId: "proc-flower-lavender", x: 1102, z: 1811, rotation: 175, scaleW: 0.93, scaleD: 1.05, scaleH: 0.94 },
      { furnitureId: "proc-flower-mixed", x: 1723, z: 718, rotation: 241, scaleW: 1.17, scaleD: 0.92, scaleH: 0.99 },
      { furnitureId: "proc-flower-mixed", x: 1632, z: 999, rotation: 235, scaleW: 1.1, scaleD: 1.19, scaleH: 1.12 },
      { furnitureId: "proc-flower-mixed", x: 1712, z: 1209, rotation: 303, scaleW: 1.1, scaleD: 1.01, scaleH: 1.11 },
      { furnitureId: "proc-flower-mixed", x: 1682, z: 1495, rotation: 305, scaleW: 1.2, scaleD: 0.91, scaleH: 0.87 },
      { furnitureId: "proc-flower-mixed", x: 1614, z: 1892, rotation: 56, scaleW: 0.98, scaleD: 1.0, scaleH: 0.84 },
      { furnitureId: "proc-flower-mixed", x: 1922, z: 571, rotation: 341, scaleW: 1.08, scaleD: 1.15, scaleH: 1.03 },
      { furnitureId: "proc-flower-mixed", x: 1949, z: 879, rotation: 141, scaleW: 1.01, scaleD: 1.17, scaleH: 0.99 },
      { furnitureId: "proc-flower-mixed", x: 1978, z: 1272, rotation: 276, scaleW: 0.95, scaleD: 0.96, scaleH: 0.89 },
      { furnitureId: "proc-flower-mixed", x: 1841, z: 1607, rotation: 246, scaleW: 1.12, scaleD: 1.02, scaleH: 0.93 },
      { furnitureId: "proc-flower-mixed", x: 1813, z: 1879, rotation: 96, scaleW: 1.08, scaleD: 0.93, scaleH: 0.96 },
      { furnitureId: "proc-flower-mixed", x: 2100, z: 656, rotation: 217, scaleW: 0.99, scaleD: 1.15, scaleH: 1.01 },
      { furnitureId: "proc-flower-mixed", x: 2129, z: 906, rotation: 230, scaleW: 1.03, scaleD: 0.91, scaleH: 1.17 },
      { furnitureId: "proc-flower-mixed", x: 2132, z: 1265, rotation: 136, scaleW: 1.06, scaleD: 1.13, scaleH: 0.84 },
      { furnitureId: "proc-flower-mixed", x: 2175, z: 1517, rotation: 61, scaleW: 1.1, scaleD: 1.04, scaleH: 0.83 },
      { furnitureId: "proc-flower-mixed", x: 2042, z: 1806, rotation: 159, scaleW: 0.98, scaleD: 1.04, scaleH: 1.13 },
      { furnitureId: "proc-flower-mixed", x: 2265, z: 606, rotation: 119, scaleW: 1.18, scaleD: 1.01, scaleH: 0.97 },
      { furnitureId: "proc-flower-mixed", x: 2337, z: 875, rotation: 27, scaleW: 0.99, scaleD: 1.05, scaleH: 0.94 },
      { furnitureId: "proc-flower-mixed", x: 2331, z: 1329, rotation: 5, scaleW: 1.01, scaleD: 1.19, scaleH: 1.05 },
      { furnitureId: "proc-flower-mixed", x: 2307, z: 1572, rotation: 61, scaleW: 1.0, scaleD: 1.09, scaleH: 0.86 },
      { furnitureId: "proc-flower-mixed", x: 2346, z: 1869, rotation: 279, scaleW: 1.12, scaleD: 1.18, scaleH: 1.08 },
      { furnitureId: "proc-flower-rapeseed", x: 3013, z: 672, rotation: 342, scaleW: 1.09, scaleD: 1.13, scaleH: 1.15 },
      { furnitureId: "proc-flower-rapeseed", x: 3016, z: 901, rotation: 179, scaleW: 0.92, scaleD: 1.09, scaleH: 1.14 },
      { furnitureId: "proc-flower-rapeseed", x: 2936, z: 1234, rotation: 105, scaleW: 1.02, scaleD: 1.04, scaleH: 1.05 },
      { furnitureId: "proc-flower-rapeseed", x: 3040, z: 1508, rotation: 291, scaleW: 1.19, scaleD: 1.02, scaleH: 0.86 },
      { furnitureId: "proc-flower-rapeseed", x: 2905, z: 1833, rotation: 277, scaleW: 1.07, scaleD: 1.01, scaleH: 1.02 },
      { furnitureId: "proc-flower-rapeseed", x: 3131, z: 587, rotation: 357, scaleW: 0.99, scaleD: 0.9, scaleH: 0.89 },
      { furnitureId: "proc-flower-rapeseed", x: 3204, z: 918, rotation: 164, scaleW: 1.1, scaleD: 1.0, scaleH: 1.01 },
      { furnitureId: "proc-flower-rapeseed", x: 3116, z: 1165, rotation: 262, scaleW: 1.15, scaleD: 1.08, scaleH: 1.18 },
      { furnitureId: "proc-flower-rapeseed", x: 3153, z: 1569, rotation: 92, scaleW: 1.19, scaleD: 1.19, scaleH: 0.92 },
      { furnitureId: "proc-flower-rapeseed", x: 3166, z: 1924, rotation: 301, scaleW: 0.94, scaleD: 1.14, scaleH: 0.94 },
      { furnitureId: "proc-flower-rapeseed", x: 3318, z: 670, rotation: 357, scaleW: 1.02, scaleD: 1.19, scaleH: 1.14 },
      { furnitureId: "proc-flower-rapeseed", x: 3403, z: 932, rotation: 115, scaleW: 1.07, scaleD: 1.05, scaleH: 0.92 },
      { furnitureId: "proc-flower-rapeseed", x: 3407, z: 1283, rotation: 30, scaleW: 0.9, scaleD: 0.91, scaleH: 0.91 },
      { furnitureId: "proc-flower-rapeseed", x: 3321, z: 1532, rotation: 93, scaleW: 0.96, scaleD: 1.14, scaleH: 1.06 },
      { furnitureId: "proc-flower-rapeseed", x: 3379, z: 1926, rotation: 199, scaleW: 1.11, scaleD: 1.03, scaleH: 1.07 },
      { furnitureId: "proc-flower-rapeseed", x: 3534, z: 658, rotation: 292, scaleW: 1.1, scaleD: 1.08, scaleH: 1.03 },
      { furnitureId: "proc-flower-rapeseed", x: 3617, z: 947, rotation: 219, scaleW: 1.19, scaleD: 1.13, scaleH: 0.85 },
      { furnitureId: "proc-flower-rapeseed", x: 3607, z: 1330, rotation: 203, scaleW: 1.07, scaleD: 1.14, scaleH: 0.99 },
      { furnitureId: "proc-flower-rapeseed", x: 3477, z: 1523, rotation: 58, scaleW: 1.17, scaleD: 1.0, scaleH: 1.09 },
      { furnitureId: "proc-flower-rapeseed", x: 3535, z: 1771, rotation: 96, scaleW: 1.06, scaleD: 1.13, scaleH: 0.8 },
      { furnitureId: "stone-path", x: 2625, z: 2321, rotation: 180 },
      { furnitureId: "stone-path", x: 2625, z: 2062, rotation: 180 },
      { furnitureId: "stone-path", x: 2625, z: 1804, rotation: 180 },
      { furnitureId: "stone-path", x: 2625, z: 1546, rotation: 180 },
      { furnitureId: "stone-path", x: 2625, z: 1288, rotation: 180 },
      { furnitureId: "stone-path", x: 2625, z: 1029, rotation: 180 },
      { furnitureId: "stone-path", x: 2521, z: 850, rotation: 244 },
      { furnitureId: "stone-path", x: 2312, z: 750, rotation: 244 },
      { furnitureId: "stone-path", x: 2104, z: 650, rotation: 244 },
      { furnitureId: "stone-path", x: 2000, z: 550, rotation: 180 },
      { furnitureId: "proc-tree-oak", x: 2000, z: 350, rotation: 25, scaleW: 1.4, scaleD: 1.4, scaleH: 1.3 },
      { furnitureId: "proc-wedding-arch", x: 2000, z: 700, rotation: 0 },
      { furnitureId: "fence", x: 1200, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 1400, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 1600, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 1800, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 2000, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 2200, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 2400, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 2600, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 150, z: 1000, rotation: 0 },
      { furnitureId: "fence", x: 3850, z: 1000, rotation: 0 },
      { furnitureId: "fence", x: 150, z: 1400, rotation: 0 },
      { furnitureId: "fence", x: 3850, z: 1400, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 300, z: 400, rotation: 147, scaleH: 1.23 },
      { furnitureId: "proc-tree-oak", x: 3700, z: 400, rotation: 259, scaleH: 1.3 },
      { furnitureId: "proc-tree-oak", x: 3700, z: 2100, rotation: 150, scaleH: 1.07 },
      { furnitureId: "proc-bush", x: 291, z: 2396, rotation: 188, scaleW: 0.99, scaleD: 1.09, scaleH: 0.94 },
      { furnitureId: "proc-bush", x: 681, z: 2407, rotation: 357, scaleW: 1.19, scaleD: 0.9, scaleH: 1.16 },
      { furnitureId: "proc-bush", x: 647, z: 2437, rotation: 118, scaleW: 1.18, scaleD: 1.05, scaleH: 0.9 },
      { furnitureId: "proc-bush", x: 3431, z: 2453, rotation: 193, scaleW: 1.27, scaleD: 0.86, scaleH: 0.81 },
      { furnitureId: "proc-bush", x: 3613, z: 2383, rotation: 287, scaleW: 1.24, scaleD: 1.03, scaleH: 1.0 },
      { furnitureId: "proc-bush", x: 3674, z: 2423, rotation: 67, scaleW: 0.81, scaleD: 1.17, scaleH: 1.21 },

    ],
    },
  ],
};

const PEACH_SET: ProjectTemplate = {
  id: "set-peach",
  name: "桃花林",
  nameEn: "Peach Blossom Grove",
  emoji: "🌸",
  description: "桃花林：成片桃树+小桥流水，仙侠桃花源、十里桃花、林间偶遇的外景",
  descriptionEn: "Peach blossom grove with a small bridge over water — the xianxia peach-blossom spring and chance encounters",
  areaSqm: 864,
  palette: ["#F4A7B9", "#6A4A2A", "#3A6A3A"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#F4A7B9",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#6A4A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-peach-f1",
      name: "桃花林",
      area: 864,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3600, depth: 2400,
          name: "桃花林", nameEn: "Peach Blossom Grove", icon: "🌸",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 1800, z: 1200, rotation: 0, scaleW: 3.4, scaleD: 2.2 },
      { furnitureId: "proc-tree-peach", x: 1115, z: 923, rotation: 349, scaleW: 1.2, scaleD: 1.12, scaleH: 1.13 },
      { furnitureId: "proc-tree-peach", x: 714, z: 518, rotation: 205, scaleW: 1.12, scaleD: 1.1, scaleH: 1.04 },
      { furnitureId: "proc-tree-peach", x: 795, z: 1123, rotation: 340, scaleW: 1.07, scaleD: 1.21, scaleH: 1.19 },
      { furnitureId: "proc-tree-peach", x: 905, z: 738, rotation: 227, scaleW: 1.27, scaleD: 1.23, scaleH: 0.8 },
      { furnitureId: "proc-tree-peach", x: 403, z: 954, rotation: 96, scaleW: 1.09, scaleD: 0.97, scaleH: 1.3 },
      { furnitureId: "proc-tree-peach", x: 537, z: 1184, rotation: 174, scaleW: 0.92, scaleD: 0.84, scaleH: 0.87 },
      { furnitureId: "proc-tree-peach", x: 1047, z: 1164, rotation: 202, scaleW: 1.11, scaleD: 0.93, scaleH: 0.85 },
      { furnitureId: "proc-tree-peach", x: 2046, z: 324, rotation: 102, scaleW: 0.86, scaleD: 0.94, scaleH: 1.05 },
      { furnitureId: "proc-tree-peach", x: 2201, z: 481, rotation: 302, scaleW: 1.22, scaleD: 0.93, scaleH: 1.19 },
      { furnitureId: "proc-tree-peach", x: 1637, z: 490, rotation: 230, scaleW: 0.87, scaleD: 1.1, scaleH: 1.08 },
      { furnitureId: "proc-tree-peach", x: 1826, z: 361, rotation: 270, scaleW: 1.05, scaleD: 1.0, scaleH: 0.94 },
      { furnitureId: "proc-tree-peach", x: 1426, z: 580, rotation: 168, scaleW: 1.23, scaleD: 1.02, scaleH: 0.89 },
      { furnitureId: "proc-tree-peach", x: 1458, z: 318, rotation: 237, scaleW: 1.22, scaleD: 1.01, scaleH: 0.9 },
      { furnitureId: "proc-tree-peach", x: 3233, z: 575, rotation: 198, scaleW: 1.16, scaleD: 0.9, scaleH: 1.14 },
      { furnitureId: "proc-tree-peach", x: 3416, z: 769, rotation: 173, scaleW: 1.26, scaleD: 0.83, scaleH: 1.26 },
      { furnitureId: "proc-tree-peach", x: 3424, z: 509, rotation: 131, scaleW: 1.01, scaleD: 1.03, scaleH: 1.05 },
      { furnitureId: "proc-tree-peach", x: 3274, z: 347, rotation: 111, scaleW: 1.08, scaleD: 0.92, scaleH: 1.02 },
      { furnitureId: "proc-tree-peach", x: 1800, z: 800, rotation: 55, scaleW: 1.6, scaleD: 1.6, scaleH: 1.5 },
      { furnitureId: "proc-water-plane", x: 2900, z: 1205, rotation: 0, scaleW: 0.5, scaleD: 2.4 },
      { furnitureId: "proc-arch-bridge", x: 2900, z: 1400, rotation: 0, scaleW: 1.0, scaleD: 1.0 },
      { furnitureId: "proc-rock", x: 2450, z: 1520, rotation: 148 },
      { furnitureId: "proc-rock", x: 3350, z: 1520, rotation: 37 },
      { furnitureId: "proc-rock", x: 2372, z: 1813, rotation: 140, scaleW: 1.28, scaleD: 1.05, scaleH: 1.14 },
      { furnitureId: "proc-rock", x: 2519, z: 1681, rotation: 164, scaleW: 1.09, scaleD: 1.13, scaleH: 1.02 },
      { furnitureId: "proc-rock", x: 2555, z: 1767, rotation: 90, scaleW: 0.85, scaleD: 1.08, scaleH: 1.21 },
      { furnitureId: "proc-rock", x: 3256, z: 1231, rotation: 257, scaleW: 0.87, scaleD: 0.95, scaleH: 0.84 },
      { furnitureId: "proc-rock", x: 3293, z: 1214, rotation: 86, scaleW: 1.0, scaleD: 1.23, scaleH: 0.99 },
      { furnitureId: "proc-rock", x: 3288, z: 1064, rotation: 74, scaleW: 1.24, scaleD: 0.95, scaleH: 0.87 },
      { furnitureId: "stone-path", x: 1150, z: 2125, rotation: 180 },
      { furnitureId: "stone-path", x: 1150, z: 1875, rotation: 180 },
      { furnitureId: "stone-path", x: 1150, z: 1625, rotation: 180 },
      { furnitureId: "stone-path", x: 1312, z: 1488, rotation: 94 },
      { furnitureId: "stone-path", x: 1638, z: 1462, rotation: 94 },
      { furnitureId: "stone-path", x: 1950, z: 1438, rotation: 95 },
      { furnitureId: "stone-path", x: 2250, z: 1412, rotation: 95 },
      { furnitureId: "stone-path", x: 1800, z: 1288, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 1062, rotation: 180 },
      { furnitureId: "proc-stone-lantern", x: 2450, z: 1280, rotation: 191 },
      { furnitureId: "proc-stone-lantern", x: 3350, z: 1280, rotation: 163 },
      { furnitureId: "proc-stone-lantern", x: 1500, z: 800, rotation: 144 },
      { furnitureId: "proc-stone-lantern", x: 2100, z: 800, rotation: 137 },
      { furnitureId: "proc-pailou", x: 1150, z: 2280, rotation: 0 },
      { furnitureId: "proc-grass-tuft", x: 909, z: 1614, rotation: 31, scaleW: 1.16, scaleD: 0.85, scaleH: 1.06 },
      { furnitureId: "proc-grass-tuft", x: 731, z: 1510, rotation: 237, scaleW: 0.9, scaleD: 1.15, scaleH: 1.09 },
      { furnitureId: "proc-grass-tuft", x: 1136, z: 1328, rotation: 118, scaleW: 0.92, scaleD: 1.17, scaleH: 1.17 },
      { furnitureId: "proc-grass-tuft", x: 636, z: 1632, rotation: 217, scaleW: 1.1, scaleD: 0.97, scaleH: 0.88 },
      { furnitureId: "proc-grass-tuft", x: 1133, z: 1414, rotation: 271, scaleW: 0.95, scaleD: 1.15, scaleH: 1.19 },
      { furnitureId: "proc-grass-tuft", x: 3321, z: 2065, rotation: 165, scaleW: 0.86, scaleD: 1.2, scaleH: 1.13 },
      { furnitureId: "proc-grass-tuft", x: 3349, z: 1979, rotation: 157, scaleW: 1.28, scaleD: 1.18, scaleH: 0.89 },
      { furnitureId: "proc-grass-tuft", x: 3448, z: 2042, rotation: 141, scaleW: 1.28, scaleD: 1.01, scaleH: 1.25 },
      { furnitureId: "proc-grass-tuft", x: 3314, z: 1994, rotation: 246, scaleW: 0.89, scaleD: 0.92, scaleH: 1.14 },
      { furnitureId: "proc-grass-tuft", x: 3450, z: 1962, rotation: 199, scaleW: 1.12, scaleD: 1.25, scaleH: 0.97 },
      { furnitureId: "proc-bush", x: 922, z: 1159, rotation: 26, scaleW: 0.96, scaleD: 0.91, scaleH: 1.24 },
      { furnitureId: "proc-bush", x: 659, z: 1374, rotation: 16, scaleW: 1.01, scaleD: 1.12, scaleH: 0.87 },
      { furnitureId: "proc-bush", x: 3227, z: 1450, rotation: 289, scaleW: 1.06, scaleD: 1.21, scaleH: 1.12 },
      { furnitureId: "proc-bush", x: 3163, z: 1530, rotation: 134, scaleW: 1.24, scaleD: 1.25, scaleH: 0.93 },
      { furnitureId: "proc-tree-peach", x: 326, z: 1359, rotation: 173, scaleW: 0.98, scaleD: 0.89, scaleH: 1.08 },
      { furnitureId: "proc-tree-peach", x: 362, z: 1803, rotation: 290, scaleW: 0.84, scaleD: 0.88, scaleH: 1.05 },
      { furnitureId: "proc-tree-peach", x: 192, z: 855, rotation: 12, scaleW: 1.12, scaleD: 0.98, scaleH: 1.07 },
      { furnitureId: "proc-tree-peach", x: 245, z: 557, rotation: 88, scaleW: 0.97, scaleD: 0.81, scaleH: 1.21 },
      { furnitureId: "proc-bush", x: 279, z: 619, rotation: 165, scaleW: 0.99, scaleD: 1.0, scaleH: 0.87 },
      { furnitureId: "proc-bush", x: 236, z: 406, rotation: 61, scaleW: 0.89, scaleD: 1.08, scaleH: 1.0 },
      { furnitureId: "proc-bush", x: 254, z: 459, rotation: 87, scaleW: 1.2, scaleD: 1.25, scaleH: 0.88 },
      { furnitureId: "proc-bush", x: 337, z: 1713, rotation: 22, scaleW: 0.93, scaleD: 1.02, scaleH: 1.08 },
      { furnitureId: "proc-bush", x: 307, z: 1933, rotation: 107, scaleW: 1.1, scaleD: 1.23, scaleH: 1.27 },
      { furnitureId: "proc-bush", x: 405, z: 1852, rotation: 57, scaleW: 1.07, scaleD: 1.12, scaleH: 1.13 },
      { furnitureId: "proc-grass-tuft", x: 324, z: 1122, rotation: 130, scaleW: 1.0, scaleD: 1.23, scaleH: 0.82 },
      { furnitureId: "proc-grass-tuft", x: 404, z: 1355, rotation: 30, scaleW: 1.26, scaleD: 0.95, scaleH: 1.05 },
      { furnitureId: "proc-grass-tuft", x: 252, z: 1251, rotation: 92, scaleW: 1.15, scaleD: 0.86, scaleH: 1.0 },

    ],
    },
  ],
};

const GARDEN_SET: ProjectTemplate = {
  id: "set-garden",
  name: "庭院花园",
  nameEn: "Courtyard Garden",
  emoji: "🏯",
  description: "庭院花园：池塘拱桥+花架亭+竹丛，私家园林、赏花品茶、园中密谈的外景",
  descriptionEn: "Private courtyard garden with a pond, arched bridge and pergola — flower viewing, tea and secret talks",
  areaSqm: 864,
  palette: ["#3A6A3A", "#8A6A42", "#5A9E3A"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#3A6A3A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#8A6A42",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-garden-f1",
      name: "庭院花园",
      area: 864,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3600, depth: 2400,
          name: "庭院花园", nameEn: "Courtyard Garden", icon: "🏯",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 1800, z: 1200, rotation: 0, scaleW: 3.4, scaleD: 2.2 },
      { furnitureId: "proc-water-plane", x: 1800, z: 600, rotation: 0, scaleW: 1.6, scaleD: 1.0 },
      { furnitureId: "proc-arch-bridge", x: 1800, z: 600, rotation: 90, scaleW: 1.0, scaleD: 1.0 },
      { furnitureId: "proc-rockery", x: 1050, z: 1050, rotation: 125, scaleH: 1.24 },
      { furnitureId: "proc-rockery", x: 2550, z: 1050, rotation: 308, scaleH: 1.14 },
      { furnitureId: "proc-rock", x: 1284, z: 1141, rotation: 217, scaleW: 1.26, scaleD: 1.03, scaleH: 1.14 },
      { furnitureId: "proc-rock", x: 1132, z: 1205, rotation: 289, scaleW: 1.04, scaleD: 0.82, scaleH: 1.08 },
      { furnitureId: "proc-rock", x: 2507, z: 1268, rotation: 116, scaleW: 1.01, scaleD: 1.09, scaleH: 1.08 },
      { furnitureId: "proc-rock", x: 2367, z: 1252, rotation: 104, scaleW: 1.21, scaleD: 1.0, scaleH: 0.97 },
      { furnitureId: "proc-pergola", x: 1800, z: 1250, rotation: 10, scaleW: 1.3, scaleD: 1.3 },
      { furnitureId: "stone-path", x: 1650, z: 2250, rotation: 252 },
      { furnitureId: "stone-path", x: 1350, z: 2150, rotation: 252 },
      { furnitureId: "stone-path", x: 1150, z: 2000, rotation: 207 },
      { furnitureId: "stone-path", x: 1050, z: 1800, rotation: 207 },
      { furnitureId: "stone-path", x: 1100, z: 1650, rotation: 117 },
      { furnitureId: "stone-path", x: 1300, z: 1550, rotation: 117 },
      { furnitureId: "stone-path", x: 1500, z: 1475, rotation: 104 },
      { furnitureId: "stone-path", x: 1700, z: 1425, rotation: 104 },
      { furnitureId: "stone-path", x: 1800, z: 1275, rotation: 180 },
      { furnitureId: "proc-stone-lantern", x: 1400, z: 1900, rotation: 277 },
      { furnitureId: "proc-stone-lantern", x: 2150, z: 1500, rotation: 54 },
      { furnitureId: "proc-stone-lantern", x: 1500, z: 1250, rotation: 134 },
      { furnitureId: "proc-stone-lantern", x: 2100, z: 1250, rotation: 359 },
      { furnitureId: "proc-stone-lantern", x: 1300, z: 1150, rotation: 99 },
      { furnitureId: "proc-bamboo-clump", x: 3090, z: 689, rotation: 262, scaleW: 0.94, scaleD: 1.02, scaleH: 1.03 },
      { furnitureId: "proc-bamboo-clump", x: 2998, z: 1843, rotation: 46, scaleW: 1.14, scaleD: 1.24, scaleH: 1.3 },
      { furnitureId: "proc-bamboo-clump", x: 2887, z: 1398, rotation: 8, scaleW: 0.84, scaleD: 1.05, scaleH: 1.26 },
      { furnitureId: "proc-bamboo-clump", x: 2847, z: 740, rotation: 252, scaleW: 1.18, scaleD: 1.18, scaleH: 0.83 },
      { furnitureId: "proc-bamboo-clump", x: 3206, z: 917, rotation: 201, scaleW: 1.3, scaleD: 1.08, scaleH: 1.18 },
      { furnitureId: "proc-bamboo-clump", x: 2855, z: 993, rotation: 358, scaleW: 0.88, scaleD: 0.81, scaleH: 0.8 },
      { furnitureId: "proc-bamboo-clump", x: 3142, z: 1388, rotation: 9, scaleW: 1.27, scaleD: 1.16, scaleH: 0.86 },
      { furnitureId: "proc-bamboo-clump", x: 3190, z: 1127, rotation: 113, scaleW: 1.02, scaleD: 1.25, scaleH: 1.23 },
      { furnitureId: "proc-bamboo-clump", x: 2941, z: 1573, rotation: 190, scaleW: 1.03, scaleD: 1.23, scaleH: 0.97 },
      { furnitureId: "proc-tree-oak", x: 819, z: 1458, rotation: 238, scaleW: 0.95, scaleD: 1.03, scaleH: 1.04 },
      { furnitureId: "proc-tree-oak", x: 748, z: 1053, rotation: 350, scaleW: 0.85, scaleD: 0.87, scaleH: 1.04 },
      { furnitureId: "proc-tree-oak", x: 512, z: 1175, rotation: 333, scaleW: 1.14, scaleD: 0.98, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 507, z: 1564, rotation: 296, scaleW: 0.83, scaleD: 0.84, scaleH: 0.81 },
      { furnitureId: "proc-tree-oak", x: 857, z: 724, rotation: 80, scaleW: 1.26, scaleD: 1.25, scaleH: 1.23 },
      { furnitureId: "proc-tree-oak", x: 1901, z: 2119, rotation: 125, scaleW: 0.9, scaleD: 1.24, scaleH: 0.98 },
      { furnitureId: "proc-tree-oak", x: 1524, z: 1972, rotation: 83, scaleW: 1.05, scaleD: 1.28, scaleH: 0.91 },
      { furnitureId: "proc-tree-oak", x: 1236, z: 2201, rotation: 62, scaleW: 1.09, scaleD: 1.08, scaleH: 0.86 },
      { furnitureId: "proc-flower-mixed", x: 1350, z: 1378, rotation: 184, scaleW: 0.87, scaleD: 1.11, scaleH: 0.88 },
      { furnitureId: "proc-flower-mixed", x: 1140, z: 1530, rotation: 68, scaleW: 1.11, scaleD: 1.11, scaleH: 1.14 },
      { furnitureId: "proc-flower-mixed", x: 1379, z: 1364, rotation: 306, scaleW: 1.26, scaleD: 1.07, scaleH: 0.83 },
      { furnitureId: "proc-flower-mixed", x: 2372, z: 1489, rotation: 326, scaleW: 1.04, scaleD: 0.89, scaleH: 1.13 },
      { furnitureId: "proc-flower-mixed", x: 2130, z: 1587, rotation: 133, scaleW: 1.05, scaleD: 1.16, scaleH: 0.97 },
      { furnitureId: "proc-flower-mixed", x: 2482, z: 1453, rotation: 32, scaleW: 0.88, scaleD: 1.03, scaleH: 1.08 },
      { furnitureId: "proc-flower-mixed", x: 1228, z: 1298, rotation: 161, scaleW: 0.89, scaleD: 1.11, scaleH: 1.09 },
      { furnitureId: "proc-flower-mixed", x: 1174, z: 1116, rotation: 355, scaleW: 1.15, scaleD: 1.14, scaleH: 0.97 },
      { furnitureId: "proc-flower-mixed", x: 1383, z: 1311, rotation: 189, scaleW: 0.93, scaleD: 1.1, scaleH: 0.82 },
      { furnitureId: "proc-flower-mixed", x: 993, z: 1172, rotation: 191, scaleW: 1.11, scaleD: 1.18, scaleH: 0.88 },
      { furnitureId: "proc-flower-mixed", x: 1091, z: 1125, rotation: 148, scaleW: 0.94, scaleD: 1.04, scaleH: 1.02 },
      { furnitureId: "proc-flower-mixed", x: 1244, z: 1226, rotation: 251, scaleW: 1.13, scaleD: 1.05, scaleH: 0.83 },
      { furnitureId: "proc-bush", x: 1027, z: 1897, rotation: 333, scaleW: 0.89, scaleD: 0.83, scaleH: 1.16 },
      { furnitureId: "proc-bush", x: 903, z: 1824, rotation: 32, scaleW: 1.14, scaleD: 1.28, scaleH: 1.14 },
      { furnitureId: "proc-bush", x: 792, z: 1897, rotation: 268, scaleW: 1.21, scaleD: 1.18, scaleH: 1.17 },
      { furnitureId: "proc-bush", x: 2781, z: 1990, rotation: 44, scaleW: 0.97, scaleD: 1.17, scaleH: 0.94 },
      { furnitureId: "proc-bush", x: 2768, z: 2100, rotation: 317, scaleW: 1.26, scaleD: 1.24, scaleH: 1.02 },
      { furnitureId: "proc-bush", x: 2590, z: 1936, rotation: 148, scaleW: 1.07, scaleD: 0.95, scaleH: 1.03 },
      { furnitureId: "fence", x: 120, z: 500, rotation: 0 },
      { furnitureId: "fence", x: 3480, z: 500, rotation: 0 },
      { furnitureId: "fence", x: 120, z: 900, rotation: 0 },
      { furnitureId: "fence", x: 3480, z: 900, rotation: 0 },
      { furnitureId: "fence", x: 120, z: 1300, rotation: 0 },
      { furnitureId: "fence", x: 3480, z: 1300, rotation: 0 },
      { furnitureId: "fence", x: 120, z: 1700, rotation: 0 },
      { furnitureId: "fence", x: 3480, z: 1700, rotation: 0 },
      { furnitureId: "fence", x: 120, z: 2100, rotation: 0 },
      { furnitureId: "fence", x: 3480, z: 2100, rotation: 0 },
      { furnitureId: "proc-pailou", x: 1800, z: 2300, rotation: 0 },
      { furnitureId: "proc-rockery", x: 950, z: 700, rotation: 56, scaleH: 1.1 },
      { furnitureId: "proc-flower-mixed", x: 976, z: 797, rotation: 344, scaleW: 1.02, scaleD: 1.13, scaleH: 1.15 },
      { furnitureId: "proc-flower-mixed", x: 977, z: 936, rotation: 237, scaleW: 1.11, scaleD: 0.81, scaleH: 1.13 },
      { furnitureId: "proc-flower-mixed", x: 1026, z: 822, rotation: 18, scaleW: 1.29, scaleD: 1.04, scaleH: 1.08 },
      { furnitureId: "proc-tree-oak", x: 950, z: 350, rotation: 326, scaleH: 1.1 },

    ],
    },
  ],
};

const TEA_SET: ProjectTemplate = {
  id: "set-tea",
  name: "茶园",
  nameEn: "Tea Plantation",
  emoji: "🍵",
  description: "茶园：成行茶树+远山，采茶、茶山相遇、田园生活的山野外景",
  descriptionEn: "Tea plantation rows with distant mountains — tea picking, meetings on the hillside and rural life",
  areaSqm: 1232,
  palette: ["#3A6A2A", "#6A4A2A", "#7AB060"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#3A6A2A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#6A4A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-tea-f1",
      name: "茶园",
      area: 1232,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4400, depth: 2800,
          name: "茶园", nameEn: "Tea Plantation", icon: "🍵",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 2200, z: 1400, rotation: 0, scaleW: 4.2, scaleD: 2.6 },
      { furnitureId: "proc-tea-row", x: 700, z: 975, rotation: 0, scaleH: 1.09 },
      { furnitureId: "proc-tea-row", x: 1800, z: 975, rotation: 8, scaleH: 1.0 },
      { furnitureId: "proc-tea-row", x: 2900, z: 975, rotation: 0, scaleH: 1.02 },
      { furnitureId: "proc-tea-row", x: 700, z: 1045, rotation: 0, scaleH: 0.99 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1045, rotation: 8, scaleH: 1.07 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1045, rotation: 0, scaleH: 1.13 },
      { furnitureId: "proc-tea-row", x: 700, z: 1115, rotation: 0, scaleH: 1.16 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1115, rotation: 8, scaleH: 1.0 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1115, rotation: 0, scaleH: 0.9 },
      { furnitureId: "proc-tea-row", x: 700, z: 1185, rotation: 0, scaleH: 0.96 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1185, rotation: 8, scaleH: 1.01 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1185, rotation: 0, scaleH: 1.16 },
      { furnitureId: "proc-tea-row", x: 700, z: 1255, rotation: 0, scaleH: 0.96 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1255, rotation: 8, scaleH: 1.03 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1255, rotation: 0, scaleH: 1.12 },
      { furnitureId: "proc-tea-row", x: 700, z: 1325, rotation: 0, scaleH: 1.18 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1325, rotation: 8, scaleH: 1.07 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1325, rotation: 0, scaleH: 0.99 },
      { furnitureId: "proc-rock", x: 990, z: 838, rotation: 168, scaleW: 1.1, scaleD: 0.85, scaleH: 0.98 },
      { furnitureId: "proc-rock", x: 1059, z: 938, rotation: 344, scaleW: 0.98, scaleD: 1.14, scaleH: 0.9 },
      { furnitureId: "proc-grass-tuft", x: 2398, z: 880, rotation: 350, scaleW: 1.11, scaleD: 0.95, scaleH: 1.2 },
      { furnitureId: "proc-grass-tuft", x: 2472, z: 939, rotation: 273, scaleW: 1.01, scaleD: 1.24, scaleH: 0.9 },
      { furnitureId: "proc-grass-tuft", x: 2680, z: 870, rotation: 131, scaleW: 0.83, scaleD: 1.1, scaleH: 1.2 },
      { furnitureId: "proc-grass-tuft", x: 1824, z: 865, rotation: 342, scaleW: 0.86, scaleD: 1.16, scaleH: 0.95 },
      { furnitureId: "proc-tea-row", x: 700, z: 1625, rotation: 0, scaleH: 1.19, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1625, rotation: 352, scaleH: 0.98, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1625, rotation: 0, scaleH: 0.94, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 700, z: 1695, rotation: 0, scaleH: 1.1, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1695, rotation: 352, scaleH: 1.17, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1695, rotation: 0, scaleH: 1.18, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 700, z: 1765, rotation: 0, scaleH: 1.1, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1765, rotation: 352, scaleH: 1.06, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1765, rotation: 0, scaleH: 0.93, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 700, z: 1835, rotation: 0, scaleH: 1.02, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1835, rotation: 352, scaleH: 0.94, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1835, rotation: 0, scaleH: 1.02, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 700, z: 1905, rotation: 0, scaleH: 1.14, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1905, rotation: 352, scaleH: 0.92, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1905, rotation: 0, scaleH: 1.12, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 700, z: 1975, rotation: 0, scaleH: 1.12, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 1800, z: 1975, rotation: 352, scaleH: 1.17, elevationY: 15 },
      { furnitureId: "proc-tea-row", x: 2900, z: 1975, rotation: 0, scaleH: 0.97, elevationY: 15 },
      { furnitureId: "proc-rock", x: 2002, z: 1523, rotation: 227, scaleW: 0.96, scaleD: 1.22, scaleH: 1.28 },
      { furnitureId: "proc-rock", x: 2290, z: 1537, rotation: 289, scaleW: 0.8, scaleD: 1.26, scaleH: 0.88 },
      { furnitureId: "proc-grass-tuft", x: 2108, z: 1590, rotation: 147, scaleW: 1.13, scaleD: 1.13, scaleH: 1.24 },
      { furnitureId: "proc-grass-tuft", x: 2760, z: 1547, rotation: 246, scaleW: 0.81, scaleD: 1.23, scaleH: 1.29 },
      { furnitureId: "proc-grass-tuft", x: 2322, z: 1522, rotation: 188, scaleW: 1.0, scaleD: 0.81, scaleH: 1.27 },
      { furnitureId: "proc-grass-tuft", x: 1950, z: 1576, rotation: 244, scaleW: 1.19, scaleD: 0.95, scaleH: 1.29 },
      { furnitureId: "proc-tea-row", x: 700, z: 2275, rotation: 0, scaleH: 1.07, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 1800, z: 2275, rotation: 8, scaleH: 1.06, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 2900, z: 2275, rotation: 0, scaleH: 1.17, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 700, z: 2345, rotation: 0, scaleH: 1.19, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 1800, z: 2345, rotation: 8, scaleH: 0.98, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 2900, z: 2345, rotation: 0, scaleH: 1.05, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 700, z: 2415, rotation: 0, scaleH: 1.15, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 1800, z: 2415, rotation: 8, scaleH: 1.15, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 2900, z: 2415, rotation: 0, scaleH: 1.03, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 700, z: 2485, rotation: 0, scaleH: 1.1, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 1800, z: 2485, rotation: 8, scaleH: 1.17, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 2900, z: 2485, rotation: 0, scaleH: 1.14, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 700, z: 2555, rotation: 0, scaleH: 1.14, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 1800, z: 2555, rotation: 8, scaleH: 1.02, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 2900, z: 2555, rotation: 0, scaleH: 0.9, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 700, z: 2625, rotation: 0, scaleH: 1.03, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 1800, z: 2625, rotation: 8, scaleH: 1.18, elevationY: 30 },
      { furnitureId: "proc-tea-row", x: 2900, z: 2625, rotation: 0, scaleH: 0.97, elevationY: 30 },
      { furnitureId: "proc-rock", x: 3419, z: 2160, rotation: 88, scaleW: 1.02, scaleD: 1.01, scaleH: 0.96 },
      { furnitureId: "proc-rock", x: 3523, z: 2164, rotation: 186, scaleW: 0.81, scaleD: 0.97, scaleH: 1.21 },
      { furnitureId: "proc-grass-tuft", x: 2322, z: 2204, rotation: 199, scaleW: 1.09, scaleD: 0.91, scaleH: 1.06 },
      { furnitureId: "proc-grass-tuft", x: 2037, z: 2219, rotation: 47, scaleW: 1.18, scaleD: 0.86, scaleH: 1.25 },
      { furnitureId: "proc-grass-tuft", x: 2350, z: 2233, rotation: 359, scaleW: 1.21, scaleD: 1.18, scaleH: 1.22 },
      { furnitureId: "proc-grass-tuft", x: 1667, z: 2181, rotation: 139, scaleW: 1.29, scaleD: 0.87, scaleH: 1.24 },
      { furnitureId: "proc-pergola", x: 2200, z: 2580, rotation: 0, scaleW: 1.3, scaleD: 1.3 },
      { furnitureId: "proc-stone-lantern", x: 1950, z: 2580, rotation: 0 },
      { furnitureId: "proc-stone-lantern", x: 2450, z: 2580, rotation: 0 },
      { furnitureId: "proc-wood-chest", x: 2050, z: 1650, rotation: 15 },
      { furnitureId: "proc-wood-chest", x: 2350, z: 2150, rotation: 340 },
      { furnitureId: "proc-tree-oak", x: 400, z: 1200, rotation: 158, scaleH: 1.04 },
      { furnitureId: "proc-tree-oak", x: 400, z: 2600, rotation: 89, scaleH: 1.18 },
      { furnitureId: "proc-tree-oak", x: 4000, z: 1200, rotation: 318, scaleH: 1.02 },
      { furnitureId: "proc-tree-oak", x: 4000, z: 2600, rotation: 276, scaleH: 1.11 },
      { furnitureId: "proc-tree-oak", x: 2200, z: 1100, rotation: 267, scaleH: 1.15 },
      { furnitureId: "proc-tree-oak", x: 1200, z: 2654, rotation: 223, scaleH: 1.07 },
      { furnitureId: "proc-tree-oak", x: 3600, z: 2600, rotation: 249, scaleH: 1.19 },
      { furnitureId: "proc-tree-oak", x: 2200, z: 2650, rotation: 72, scaleH: 1.02 },
      { furnitureId: "proc-bush", x: 587, z: 1443, rotation: 250, scaleW: 0.95, scaleD: 1.08, scaleH: 0.83 },
      { furnitureId: "proc-bush", x: 556, z: 1439, rotation: 212, scaleW: 0.98, scaleD: 1.15, scaleH: 1.14 },
      { furnitureId: "proc-bush", x: 484, z: 1457, rotation: 97, scaleW: 0.84, scaleD: 1.18, scaleH: 1.22 },
      { furnitureId: "proc-bush", x: 3787, z: 1560, rotation: 110, scaleW: 1.28, scaleD: 0.99, scaleH: 1.2 },
      { furnitureId: "proc-bush", x: 3933, z: 1495, rotation: 31, scaleW: 1.11, scaleD: 1.1, scaleH: 0.98 },
      { furnitureId: "proc-bush", x: 3736, z: 1429, rotation: 191, scaleW: 1.15, scaleD: 0.92, scaleH: 0.99 },
      { furnitureId: "proc-mountain", x: 2200, z: 455, rotation: 0, scaleW: 2.0, scaleD: 0.6, scaleH: 1.0 },
      { furnitureId: "stone-path", x: 2200, z: 2588, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 2362, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 2138, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1912, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1688, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1462, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1238, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1012, rotation: 180 },
      { furnitureId: "proc-tree-oak", x: 300, z: 600, rotation: 240, scaleH: 1.1 },
      { furnitureId: "proc-tree-oak", x: 300, z: 1400, rotation: 307, scaleH: 1.2 },
      { furnitureId: "proc-tree-oak", x: 300, z: 2200, rotation: 82, scaleH: 1.18 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 600, rotation: 26, scaleH: 1.15 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 1400, rotation: 118, scaleH: 1.1 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 2200, rotation: 33, scaleH: 1.25 },
      { furnitureId: "proc-bush", x: 4190, z: 765, rotation: 60, scaleW: 1.15, scaleD: 1.12, scaleH: 1.17 },
      { furnitureId: "proc-bush", x: 4053, z: 921, rotation: 135, scaleW: 0.87, scaleD: 1.16, scaleH: 1.1 },
      { furnitureId: "proc-bush", x: 4180, z: 729, rotation: 174, scaleW: 0.88, scaleD: 1.04, scaleH: 1.14 },
      { furnitureId: "proc-rock", x: 226, z: 2575, rotation: 246, scaleW: 0.96, scaleD: 1.06, scaleH: 1.19 },
      { furnitureId: "proc-rock", x: 351, z: 2686, rotation: 350, scaleW: 1.19, scaleD: 1.26, scaleH: 0.85 },

    ],
    },
  ],
};

const RICE_FIELD_SET: ProjectTemplate = {
  id: "set-rice-field",
  name: "稻田",
  nameEn: "Rice Paddy Field",
  emoji: "🌾",
  description: "稻田：水田+稻束+远山，插秧、丰收、乡土剧的田野外景",
  descriptionEn: "Flooded rice paddies with sheaves and mountains — transplanting, harvest and rural drama",
  areaSqm: 1232,
  palette: ["#7AB060", "#3A90C0", "#D8B060"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#7AB060",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A90C0",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-rice-field-f1",
      name: "稻田",
      area: 1232,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4400, depth: 2800,
          name: "稻田", nameEn: "Rice Paddy Field", icon: "🌾",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 2200, z: 1400, rotation: 0, scaleW: 4.2, scaleD: 2.6 },
      { furnitureId: "proc-rice-paddy", x: 800, z: 1300, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 1750, z: 1300, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 2700, z: 1300, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 3650, z: 1300, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 800, z: 1700, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 1750, z: 1700, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 2700, z: 1700, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 3650, z: 1700, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 800, z: 2100, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 1750, z: 2100, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 2700, z: 2100, rotation: 0 },
      { furnitureId: "proc-rice-paddy", x: 3650, z: 2100, rotation: 0 },
      { furnitureId: "proc-grass-tuft", x: 480, z: 1120, rotation: 352 },
      { furnitureId: "proc-grass-tuft", x: 1120, z: 1480, rotation: 139 },
      { furnitureId: "proc-grass-tuft", x: 1430, z: 1120, rotation: 11 },
      { furnitureId: "proc-grass-tuft", x: 2070, z: 1480, rotation: 229 },
      { furnitureId: "proc-grass-tuft", x: 2380, z: 1120, rotation: 291 },
      { furnitureId: "proc-grass-tuft", x: 3020, z: 1480, rotation: 75 },
      { furnitureId: "proc-grass-tuft", x: 3330, z: 1120, rotation: 330 },
      { furnitureId: "proc-grass-tuft", x: 3970, z: 1480, rotation: 263 },
      { furnitureId: "proc-grass-tuft", x: 480, z: 1520, rotation: 195 },
      { furnitureId: "proc-grass-tuft", x: 1120, z: 1880, rotation: 44 },
      { furnitureId: "proc-grass-tuft", x: 1430, z: 1520, rotation: 126 },
      { furnitureId: "proc-grass-tuft", x: 2070, z: 1880, rotation: 233 },
      { furnitureId: "proc-grass-tuft", x: 2380, z: 1520, rotation: 255 },
      { furnitureId: "proc-grass-tuft", x: 3020, z: 1880, rotation: 121 },
      { furnitureId: "proc-grass-tuft", x: 3330, z: 1520, rotation: 187 },
      { furnitureId: "proc-grass-tuft", x: 3970, z: 1880, rotation: 246 },
      { furnitureId: "proc-grass-tuft", x: 480, z: 1920, rotation: 262 },
      { furnitureId: "proc-grass-tuft", x: 1120, z: 2280, rotation: 314 },
      { furnitureId: "proc-grass-tuft", x: 1430, z: 1920, rotation: 96 },
      { furnitureId: "proc-grass-tuft", x: 2070, z: 2280, rotation: 108 },
      { furnitureId: "proc-grass-tuft", x: 2380, z: 1920, rotation: 283 },
      { furnitureId: "proc-grass-tuft", x: 3020, z: 2280, rotation: 272 },
      { furnitureId: "proc-grass-tuft", x: 3330, z: 1920, rotation: 338 },
      { furnitureId: "proc-grass-tuft", x: 3970, z: 2280, rotation: 174 },
      { furnitureId: "proc-rock", x: 987, z: 1025, rotation: 95, scaleW: 0.86, scaleD: 1.25, scaleH: 0.95 },
      { furnitureId: "proc-rock", x: 778, z: 1058, rotation: 14, scaleW: 1.13, scaleD: 0.94, scaleH: 0.81 },
      { furnitureId: "proc-rock", x: 3358, z: 2335, rotation: 61, scaleW: 0.97, scaleD: 0.9, scaleH: 0.82 },
      { furnitureId: "proc-rock", x: 3567, z: 2358, rotation: 325, scaleW: 0.85, scaleD: 1.28, scaleH: 1.17 },
      { furnitureId: "proc-rice-sheaf", x: 1200, z: 1300, rotation: 121 },
      { furnitureId: "proc-rice-sheaf", x: 2150, z: 1300, rotation: 284 },
      { furnitureId: "proc-rice-sheaf", x: 3100, z: 1300, rotation: 82 },
      { furnitureId: "proc-rice-sheaf", x: 1200, z: 2100, rotation: 145 },
      { furnitureId: "proc-millet-sheaf", x: 1900, z: 2580, rotation: 30 },
      { furnitureId: "proc-millet-sheaf", x: 2500, z: 2580, rotation: 300 },
      { furnitureId: "proc-water-plane", x: 300, z: 1700, rotation: 0, scaleW: 0.4, scaleD: 1.2 },
      { furnitureId: "proc-water-plane", x: 4150, z: 1700, rotation: 0, scaleW: 0.4, scaleD: 1.2 },
      { furnitureId: "fence", x: 1600, z: 2450, rotation: 90 },
      { furnitureId: "fence", x: 1600, z: 2700, rotation: 90 },
      { furnitureId: "fence", x: 2000, z: 2450, rotation: 90 },
      { furnitureId: "fence", x: 2000, z: 2700, rotation: 90 },
      { furnitureId: "fence", x: 2400, z: 2450, rotation: 90 },
      { furnitureId: "fence", x: 2400, z: 2700, rotation: 90 },
      { furnitureId: "proc-haystack", x: 1500, z: 2580, rotation: 20 },
      { furnitureId: "proc-haystack", x: 2900, z: 2580, rotation: 330 },
      { furnitureId: "proc-tree-oak", x: 400, z: 1000, rotation: 148, scaleH: 1.14 },
      { furnitureId: "proc-tree-oak", x: 2200, z: 950, rotation: 117, scaleH: 1.26 },
      { furnitureId: "proc-tree-oak", x: 4000, z: 1000, rotation: 128, scaleH: 1.07 },
      { furnitureId: "proc-tree-oak", x: 400, z: 2550, rotation: 238, scaleH: 1.04 },
      { furnitureId: "proc-tree-oak", x: 4000, z: 2550, rotation: 155, scaleH: 1.3 },
      { furnitureId: "proc-tree-oak", x: 3200, z: 2650, rotation: 27, scaleH: 1.26 },
      { furnitureId: "proc-bush", x: 674, z: 1049, rotation: 278, scaleW: 1.16, scaleD: 0.99, scaleH: 1.28 },
      { furnitureId: "proc-bush", x: 839, z: 916, rotation: 243, scaleW: 1.03, scaleD: 1.02, scaleH: 0.93 },
      { furnitureId: "proc-bush", x: 3649, z: 1009, rotation: 94, scaleW: 1.08, scaleD: 1.14, scaleH: 1.25 },
      { furnitureId: "proc-bush", x: 3737, z: 1046, rotation: 167, scaleW: 0.83, scaleD: 1.14, scaleH: 0.89 },
      { furnitureId: "proc-mountain", x: 2200, z: 530, rotation: 0, scaleW: 2.0, scaleD: 0.7, scaleH: 1.0 },
      { furnitureId: "stone-path", x: 2200, z: 2492, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 2275, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 2058, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1842, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1625, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1408, rotation: 180 },
      { furnitureId: "proc-tree-oak", x: 650, z: 600, rotation: 327, scaleH: 1.19 },
      { furnitureId: "proc-tree-oak", x: 650, z: 1400, rotation: 218, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 650, z: 2200, rotation: 92, scaleH: 1.19 },
      { furnitureId: "proc-tree-oak", x: 3750, z: 600, rotation: 220, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 3750, z: 1400, rotation: 314, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 3750, z: 2200, rotation: 33, scaleH: 1.1 },
      { furnitureId: "proc-rock", x: 300, z: 800, rotation: 151 },
      { furnitureId: "proc-rock", x: 300, z: 1800, rotation: 287 },
      { furnitureId: "proc-rock", x: 4100, z: 800, rotation: 11 },
      { furnitureId: "proc-rock", x: 4100, z: 1800, rotation: 295 },
      { furnitureId: "proc-bush", x: 592, z: 913, rotation: 197, scaleW: 1.02, scaleD: 1.14, scaleH: 1.13 },
      { furnitureId: "proc-bush", x: 702, z: 1081, rotation: 162, scaleW: 1.07, scaleD: 1.19, scaleH: 1.09 },
      { furnitureId: "proc-bush", x: 593, z: 881, rotation: 332, scaleW: 1.0, scaleD: 1.07, scaleH: 1.2 },
      { furnitureId: "proc-bush", x: 3750, z: 1007, rotation: 89, scaleW: 0.84, scaleD: 0.84, scaleH: 1.05 },
      { furnitureId: "proc-bush", x: 3758, z: 930, rotation: 268, scaleW: 1.28, scaleD: 1.02, scaleH: 1.27 },
      { furnitureId: "proc-bush", x: 3770, z: 761, rotation: 9, scaleW: 1.14, scaleD: 0.82, scaleH: 0.94 },
      { furnitureId: "proc-tree-oak", x: 1600, z: 650, rotation: 216, scaleH: 1.1 },
      { furnitureId: "proc-bush", x: 1680, z: 806, rotation: 261, scaleW: 0.96, scaleD: 1.1, scaleH: 0.92 },
      { furnitureId: "proc-bush", x: 1569, z: 794, rotation: 251, scaleW: 0.99, scaleD: 1.15, scaleH: 1.1 },

    ],
    },
  ],
};

const HORSE_RANCH_SET: ProjectTemplate = {
  id: "set-horse-ranch",
  name: "马场",
  nameEn: "Horse Ranch",
  emoji: "🐎",
  description: "马场：马厩+围栏+沙地骑乘圈，骑马、驯马、马背告白的外景",
  descriptionEn: "Horse ranch with stables, fences and a sand riding ring — riding, training and confessions on horseback",
  areaSqm: 1320,
  palette: ["#8A6A42", "#5A9E3A", "#A03028"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#8A6A42",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#5A9E3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-horse-ranch-f1",
      name: "马场",
      area: 1320,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4400, depth: 3000,
          name: "马场", nameEn: "Horse Ranch", icon: "🐎",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-dry", x: 2200, z: 1500, rotation: 0, scaleW: 4.2, scaleD: 2.8 },
      { furnitureId: "proc-ground-sand", x: 2200, z: 1500, rotation: 0, scaleW: 1.6, scaleD: 1.6, elevationY: 2 },
      { furnitureId: "fence", x: 3080, z: 1500, rotation: 0 },
      { furnitureId: "fence", x: 3050, z: 1728, rotation: 345 },
      { furnitureId: "fence", x: 2962, z: 1940, rotation: 330 },
      { furnitureId: "fence", x: 2822, z: 2122, rotation: 315 },
      { furnitureId: "fence", x: 2640, z: 2262, rotation: 300 },
      { furnitureId: "fence", x: 2428, z: 2350, rotation: 285 },
      { furnitureId: "fence", x: 2200, z: 2380, rotation: 270 },
      { furnitureId: "fence", x: 1972, z: 2350, rotation: 255 },
      { furnitureId: "fence", x: 1760, z: 2262, rotation: 240 },
      { furnitureId: "fence", x: 1578, z: 2122, rotation: 225 },
      { furnitureId: "fence", x: 1438, z: 1940, rotation: 210 },
      { furnitureId: "fence", x: 1350, z: 1728, rotation: 195 },
      { furnitureId: "fence", x: 1320, z: 1500, rotation: 180 },
      { furnitureId: "fence", x: 1350, z: 1272, rotation: 165 },
      { furnitureId: "fence", x: 1438, z: 1060, rotation: 150 },
      { furnitureId: "fence", x: 1578, z: 878, rotation: 135 },
      { furnitureId: "fence", x: 1760, z: 738, rotation: 120 },
      { furnitureId: "fence", x: 1972, z: 650, rotation: 105 },
      { furnitureId: "fence", x: 2200, z: 620, rotation: 90 },
      { furnitureId: "fence", x: 2428, z: 650, rotation: 75 },
      { furnitureId: "fence", x: 2640, z: 738, rotation: 60 },
      { furnitureId: "fence", x: 2822, z: 878, rotation: 45 },
      { furnitureId: "fence", x: 2962, z: 1060, rotation: 30 },
      { furnitureId: "fence", x: 3050, z: 1272, rotation: 15 },
      { furnitureId: "proc-stable", x: 1400, z: 400, rotation: 0 },
      { furnitureId: "proc-stable", x: 3000, z: 400, rotation: 0 },
      { furnitureId: "proc-haystack", x: 900, z: 400, rotation: 353, scaleH: 1.05 },
      { furnitureId: "proc-haystack", x: 1900, z: 400, rotation: 243, scaleH: 1.15 },
      { furnitureId: "proc-haystack", x: 2600, z: 400, rotation: 143, scaleH: 1.09 },
      { furnitureId: "proc-haystack", x: 3500, z: 400, rotation: 26, scaleH: 1.02 },
      { furnitureId: "proc-haystack", x: 1100, z: 750, rotation: 289, scaleH: 1.15 },
      { furnitureId: "proc-haystack", x: 3300, z: 750, rotation: 108, scaleH: 0.92 },
      { furnitureId: "proc-wood-chest", x: 1400, z: 650, rotation: 0 },
      { furnitureId: "proc-wood-chest", x: 3000, z: 650, rotation: 0 },
      { furnitureId: "proc-water-plane", x: 1100, z: 1500, rotation: 0, scaleW: 0.5, scaleD: 0.5 },
      { furnitureId: "proc-tree-oak", x: 600, z: 1200, rotation: 137, scaleH: 1.27 },
      { furnitureId: "proc-tree-oak", x: 600, z: 1900, rotation: 68, scaleH: 1.23 },
      { furnitureId: "proc-tree-oak", x: 3800, z: 1200, rotation: 62, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 3800, z: 1900, rotation: 68, scaleH: 1.27 },
      { furnitureId: "proc-tree-oak", x: 2200, z: 2700, rotation: 125, scaleH: 1.28 },
      { furnitureId: "proc-tree-oak", x: 800, z: 2700, rotation: 57, scaleH: 1.29 },
      { furnitureId: "proc-banner", x: 1500, z: 800, rotation: 57 },
      { furnitureId: "proc-banner", x: 2900, z: 800, rotation: 13 },
      { furnitureId: "proc-banner", x: 1500, z: 2200, rotation: 200 },
      { furnitureId: "proc-banner", x: 2900, z: 2200, rotation: 13 },
      { furnitureId: "proc-grass-tuft", x: 512, z: 1297, rotation: 25, scaleW: 1.15, scaleD: 0.81, scaleH: 0.88 },
      { furnitureId: "proc-grass-tuft", x: 849, z: 1709, rotation: 245, scaleW: 1.22, scaleD: 1.28, scaleH: 0.85 },
      { furnitureId: "proc-grass-tuft", x: 735, z: 1068, rotation: 181, scaleW: 1.14, scaleD: 0.88, scaleH: 1.03 },
      { furnitureId: "proc-grass-tuft", x: 648, z: 1941, rotation: 233, scaleW: 0.94, scaleD: 0.82, scaleH: 1.25 },
      { furnitureId: "proc-grass-tuft", x: 553, z: 1283, rotation: 7, scaleW: 0.87, scaleD: 0.81, scaleH: 0.83 },
      { furnitureId: "proc-grass-tuft", x: 3575, z: 1356, rotation: 7, scaleW: 1.19, scaleD: 1.09, scaleH: 0.85 },
      { furnitureId: "proc-grass-tuft", x: 3548, z: 1388, rotation: 107, scaleW: 1.08, scaleD: 0.95, scaleH: 1.08 },
      { furnitureId: "proc-grass-tuft", x: 3533, z: 1756, rotation: 22, scaleW: 0.89, scaleD: 0.99, scaleH: 0.95 },
      { furnitureId: "proc-grass-tuft", x: 3526, z: 1665, rotation: 350, scaleW: 0.95, scaleD: 0.87, scaleH: 0.82 },
      { furnitureId: "proc-grass-tuft", x: 3590, z: 1877, rotation: 108, scaleW: 1.0, scaleD: 0.81, scaleH: 1.19 },
      { furnitureId: "proc-tree-oak", x: 300, z: 1000, rotation: 248, scaleH: 1.09 },
      { furnitureId: "proc-tree-oak", x: 300, z: 1800, rotation: 349, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 300, z: 2500, rotation: 33, scaleH: 1.21 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 1000, rotation: 292, scaleH: 1.09 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 1800, rotation: 186, scaleH: 1.28 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 2500, rotation: 228, scaleH: 1.3 },
      { furnitureId: "proc-grass-tuft", x: 4101, z: 2497, rotation: 223, scaleW: 0.85, scaleD: 1.13, scaleH: 1.24 },
      { furnitureId: "proc-grass-tuft", x: 4075, z: 2519, rotation: 142, scaleW: 1.17, scaleD: 0.96, scaleH: 0.86 },
      { furnitureId: "proc-grass-tuft", x: 4011, z: 2534, rotation: 319, scaleW: 1.2, scaleD: 1.26, scaleH: 0.81 },
      { furnitureId: "proc-bush", x: 255, z: 1196, rotation: 266, scaleW: 1.01, scaleD: 1.01, scaleH: 0.95 },
      { furnitureId: "proc-bush", x: 239, z: 1494, rotation: 269, scaleW: 0.83, scaleD: 0.94, scaleH: 1.11 },

    ],
    },
  ],
};

const FARM_SET: ProjectTemplate = {
  id: "set-farm",
  name: "农场",
  nameEn: "Farm",
  emoji: "🚜",
  description: "农场：红谷仓+作物行+水井，农家生活、丰收、田园治愈的外景",
  descriptionEn: "Farm with a red barn, crop rows and a well — farm life, harvest and pastoral healing",
  areaSqm: 1320,
  palette: ["#A03028", "#5A8A3A", "#D8B060"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#A03028",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#5A8A3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-farm-f1",
      name: "农场",
      area: 1320,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4400, depth: 3000,
          name: "农场", nameEn: "Farm", icon: "🚜",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 2200, z: 1500, rotation: 0, scaleW: 4.2, scaleD: 2.8 },
      { furnitureId: "proc-barn", x: 2200, z: 600, rotation: 0, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-stone-well", x: 2900, z: 600, rotation: 0 },
      { furnitureId: "proc-crop-row", x: 3400, z: 1000, rotation: 0, scaleH: 1.15 },
      { furnitureId: "proc-crop-row", x: 3400, z: 1130, rotation: 0, scaleH: 1.13 },
      { furnitureId: "proc-crop-row", x: 3400, z: 1260, rotation: 0, scaleH: 1.17 },
      { furnitureId: "proc-crop-row", x: 3400, z: 1390, rotation: 0, scaleH: 1.0 },
      { furnitureId: "proc-crop-row", x: 3400, z: 1520, rotation: 0, scaleH: 1.08 },
      { furnitureId: "proc-crop-row", x: 3400, z: 1650, rotation: 0, scaleH: 1.07 },
      { furnitureId: "proc-crop-row", x: 3400, z: 1780, rotation: 0, scaleH: 0.96 },
      { furnitureId: "proc-crop-row", x: 3400, z: 2100, rotation: 0, scaleH: 1.04 },
      { furnitureId: "proc-crop-row", x: 3400, z: 2230, rotation: 0, scaleH: 0.99 },
      { furnitureId: "proc-crop-row", x: 3400, z: 2360, rotation: 0, scaleH: 1.14 },
      { furnitureId: "proc-crop-row", x: 3400, z: 2490, rotation: 0, scaleH: 0.92 },
      { furnitureId: "proc-crop-row", x: 3400, z: 2620, rotation: 0, scaleH: 1.04 },
      { furnitureId: "proc-crop-row", x: 3400, z: 2750, rotation: 0, scaleH: 1.12 },
      { furnitureId: "proc-crop-row", x: 3400, z: 2880, rotation: 0, scaleH: 0.9 },
      { furnitureId: "proc-ground-dry", x: 800, z: 2500, rotation: 0, scaleW: 1.0, scaleD: 0.9, elevationY: 2 },
      { furnitureId: "proc-haystack", x: 500, z: 2400, rotation: 317 },
      { furnitureId: "proc-haystack", x: 1100, z: 2400, rotation: 112 },
      { furnitureId: "proc-haystack", x: 800, z: 2700, rotation: 83 },
      { furnitureId: "proc-haystack", x: 450, z: 2650, rotation: 116 },
      { furnitureId: "proc-haystack", x: 1150, z: 2650, rotation: 249 },
      { furnitureId: "proc-millet-sheaf", x: 600, z: 2500, rotation: 41 },
      { furnitureId: "proc-millet-sheaf", x: 800, z: 2400, rotation: 292 },
      { furnitureId: "proc-millet-sheaf", x: 1000, z: 2500, rotation: 265 },
      { furnitureId: "proc-millet-sheaf", x: 850, z: 2620, rotation: 191 },
      { furnitureId: "fence", x: 600, z: 1400, rotation: 90 },
      { furnitureId: "fence", x: 800, z: 1400, rotation: 90 },
      { furnitureId: "fence", x: 1000, z: 1400, rotation: 90 },
      { furnitureId: "fence", x: 1200, z: 1400, rotation: 90 },
      { furnitureId: "fence", x: 500, z: 1500, rotation: 0 },
      { furnitureId: "fence", x: 1300, z: 1500, rotation: 0 },
      { furnitureId: "fence", x: 500, z: 1700, rotation: 0 },
      { furnitureId: "fence", x: 1300, z: 1700, rotation: 0 },
      { furnitureId: "fence", x: 500, z: 1900, rotation: 0 },
      { furnitureId: "fence", x: 1300, z: 1900, rotation: 0 },
      { furnitureId: "proc-timber-facade", x: 900, z: 800, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 1500, z: 700, rotation: 305, scaleH: 1.05 },
      { furnitureId: "proc-tree-oak", x: 2900, z: 1000, rotation: 85, scaleH: 1.2 },
      { furnitureId: "proc-tree-oak", x: 500, z: 900, rotation: 241, scaleH: 1.3 },
      { furnitureId: "proc-tree-oak", x: 1400, z: 900, rotation: 293, scaleH: 1.05 },
      { furnitureId: "proc-tree-oak", x: 3300, z: 700, rotation: 158, scaleH: 1.21 },
      { furnitureId: "proc-tree-oak", x: 600, z: 2400, rotation: 305, scaleH: 1.02 },
      { furnitureId: "stone-path", x: 2200, z: 2700, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 2300, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1950, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1650, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1362, rotation: 180 },
      { furnitureId: "stone-path", x: 2200, z: 1088, rotation: 180 },
      { furnitureId: "proc-tree-oak", x: 350, z: 300, rotation: 291, scaleH: 1.26 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 300, rotation: 219, scaleH: 1.2 },
      { furnitureId: "proc-tree-oak", x: 350, z: 1400, rotation: 220, scaleH: 1.21 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 1400, rotation: 318, scaleH: 1.05 },
      { furnitureId: "proc-tree-oak", x: 350, z: 2600, rotation: 10, scaleH: 1.23 },
      { furnitureId: "proc-tree-oak", x: 4100, z: 2600, rotation: 15, scaleH: 1.25 },
      { furnitureId: "proc-bush", x: 339, z: 1047, rotation: 278, scaleW: 1.19, scaleD: 1.01, scaleH: 1.16 },
      { furnitureId: "proc-bush", x: 373, z: 1151, rotation: 209, scaleW: 1.29, scaleD: 1.09, scaleH: 1.01 },
      { furnitureId: "proc-bush", x: 213, z: 981, rotation: 284, scaleW: 0.87, scaleD: 1.26, scaleH: 0.92 },
      { furnitureId: "proc-bush", x: 3978, z: 1943, rotation: 236, scaleW: 1.1, scaleD: 0.87, scaleH: 1.06 },
      { furnitureId: "proc-bush", x: 4045, z: 1999, rotation: 44, scaleW: 0.88, scaleD: 0.97, scaleH: 1.24 },
      { furnitureId: "proc-bush", x: 4118, z: 1971, rotation: 96, scaleW: 1.14, scaleD: 0.82, scaleH: 1.14 },

    ],
    },
  ],
};

const STREET_SET: ProjectTemplate = {
  id: "set-street",
  name: "街道",
  nameEn: "Street",
  emoji: "🏬",
  description: "街道：临街店面+路灯+长椅，逛街、偶遇、街头告白的都市外景",
  descriptionEn: "City street with shopfronts, lamps and benches — shopping, chance encounters and street confessions",
  areaSqm: 960,
  palette: ["#C8C8C8", "#3A3A3A", "#B0503A"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#C8C8C8",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A3A3A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-street-f1",
      name: "街道",
      area: 960,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4000, depth: 2400,
          name: "街道", nameEn: "Street", icon: "🏬",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-stone", x: 2000, z: 1200, rotation: 0, scaleW: 3.8, scaleD: 2.2 },
      { furnitureId: "proc-shop-facade", x: 350, z: 400, rotation: 90, scaleW: 1.0 },
      { furnitureId: "proc-shop-facade", x: 350, z: 950, rotation: 90, scaleW: 1.2 },
      { furnitureId: "proc-shop-facade", x: 350, z: 1500, rotation: 90, scaleW: 1.0 },
      { furnitureId: "proc-shop-facade", x: 350, z: 2050, rotation: 90, scaleW: 1.0 },
      { furnitureId: "stone-path", x: 750, z: 314, rotation: 0 },
      { furnitureId: "stone-path", x: 750, z: 542, rotation: 0 },
      { furnitureId: "stone-path", x: 750, z: 769, rotation: 0 },
      { furnitureId: "stone-path", x: 750, z: 997, rotation: 0 },
      { furnitureId: "stone-path", x: 750, z: 1225, rotation: 0 },
      { furnitureId: "stone-path", x: 750, z: 1453, rotation: 0 },
      { furnitureId: "stone-path", x: 750, z: 1681, rotation: 0 },
      { furnitureId: "stone-path", x: 750, z: 1908, rotation: 0 },
      { furnitureId: "stone-path", x: 750, z: 2136, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1150, z: 350, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1150, z: 750, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1150, z: 1150, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1150, z: 1550, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1150, z: 1950, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1150, z: 2250, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 1300, z: 500, rotation: 49, scaleH: 1.08 },
      { furnitureId: "proc-tree-oak", x: 1300, z: 1000, rotation: 129, scaleH: 1.08 },
      { furnitureId: "proc-tree-oak", x: 1300, z: 1500, rotation: 164, scaleH: 0.99 },
      { furnitureId: "proc-tree-oak", x: 1300, z: 2000, rotation: 61, scaleH: 0.97 },
      { furnitureId: "proc-tree-oak", x: 1300, z: 2293, rotation: 359, scaleH: 1.04 },
      { furnitureId: "proc-outdoor-bench", x: 2400, z: 350, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 2400, z: 650, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 2900, z: 350, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 2900, z: 650, rotation: 180 },
      { furnitureId: "proc-tree-oak", x: 2650, z: 500, rotation: 0, scaleW: 1.3, scaleD: 1.3, scaleH: 1.2 },
      { furnitureId: "proc-banner", x: 2300, z: 500, rotation: 15 },
      { furnitureId: "proc-banner", x: 3000, z: 500, rotation: 345 },
      { furnitureId: "proc-banner", x: 700, z: 400, rotation: 0 },
      { furnitureId: "proc-banner", x: 700, z: 2050, rotation: 0 },
      { furnitureId: "proc-banner", x: 220, z: 600, rotation: 0 },
      { furnitureId: "proc-banner", x: 220, z: 1200, rotation: 0 },
      { furnitureId: "proc-banner", x: 220, z: 1800, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 3750, z: 500, rotation: 137, scaleH: 0.98 },
      { furnitureId: "proc-street-lamp", x: 3600, z: 650, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 3750, z: 1000, rotation: 80, scaleH: 1.09 },
      { furnitureId: "proc-street-lamp", x: 3600, z: 1150, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 3750, z: 1500, rotation: 314, scaleH: 0.96 },
      { furnitureId: "proc-street-lamp", x: 3600, z: 1650, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 3750, z: 2000, rotation: 70, scaleH: 0.94 },
      { furnitureId: "proc-street-lamp", x: 3600, z: 2150, rotation: 0 },
      { furnitureId: "stone-path", x: 1433, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 1700, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 1967, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 2233, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 2500, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 2767, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 3033, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 3300, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 3567, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 1433, z: 2100, rotation: 90 },
      { furnitureId: "stone-path", x: 1700, z: 2100, rotation: 90 },
      { furnitureId: "stone-path", x: 1967, z: 2100, rotation: 90 },
      { furnitureId: "stone-path", x: 2233, z: 2100, rotation: 90 },
      { furnitureId: "stone-path", x: 2500, z: 2100, rotation: 90 },
      { furnitureId: "stone-path", x: 2767, z: 2100, rotation: 90 },
      { furnitureId: "stone-path", x: 3033, z: 2100, rotation: 90 },
      { furnitureId: "stone-path", x: 3300, z: 2100, rotation: 90 },
      { furnitureId: "stone-path", x: 3567, z: 2100, rotation: 90 },

    ],
    },
  ],
};

const PARK_SET: ProjectTemplate = {
  id: "set-park",
  name: "公园",
  nameEn: "Park",
  emoji: "🌳",
  description: "公园：草坪+水面+花架亭，晨练、野餐、公园约会的外景",
  descriptionEn: "City park with lawn, pond and pergola — morning exercise, picnics and park dates",
  areaSqm: 1120,
  palette: ["#3A6A2A", "#5A90C0", "#8A6A42"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#3A6A2A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#5A90C0",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-park-f1",
      name: "公园",
      area: 1120,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4000, depth: 2800,
          name: "公园", nameEn: "Park", icon: "🌳",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 2000, z: 1400, rotation: 0, scaleW: 3.8, scaleD: 2.6 },
      { furnitureId: "proc-water-plane", x: 2000, z: 605, rotation: 0, scaleW: 1.8, scaleD: 1.2 },
      { furnitureId: "proc-pergola", x: 2000, z: 1350, rotation: 0, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-tree-oak", x: 900, z: 600, rotation: 292, scaleH: 1.08 },
      { furnitureId: "proc-tree-oak", x: 900, z: 1100, rotation: 165, scaleH: 1.06 },
      { furnitureId: "proc-tree-oak", x: 900, z: 1600, rotation: 103, scaleH: 0.95 },
      { furnitureId: "proc-tree-oak", x: 900, z: 2100, rotation: 306, scaleH: 1.19 },
      { furnitureId: "proc-tree-oak", x: 900, z: 2500, rotation: 184, scaleH: 0.9 },
      { furnitureId: "proc-tree-oak", x: 1500, z: 1400, rotation: 345, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 1500, z: 1800, rotation: 113, scaleH: 1.0 },
      { furnitureId: "proc-tree-oak", x: 1500, z: 2200, rotation: 170, scaleH: 1.09 },
      { furnitureId: "proc-tree-oak", x: 1500, z: 2500, rotation: 11, scaleH: 0.94 },
      { furnitureId: "proc-tree-oak", x: 850, z: 300, rotation: 20, scaleW: 1.5, scaleD: 1.5, scaleH: 1.4 },
      { furnitureId: "proc-flower-mixed", x: 2950, z: 780, rotation: 17, scaleH: 1.17 },
      { furnitureId: "proc-flower-mixed", x: 3200, z: 780, rotation: 234, scaleH: 0.83 },
      { furnitureId: "proc-flower-mixed", x: 3450, z: 780, rotation: 55, scaleH: 0.84 },
      { furnitureId: "proc-flower-mixed", x: 2950, z: 1020, rotation: 203, scaleH: 0.9 },
      { furnitureId: "proc-flower-mixed", x: 3200, z: 1020, rotation: 267, scaleH: 1.12 },
      { furnitureId: "proc-flower-mixed", x: 3450, z: 1020, rotation: 277, scaleH: 0.9 },
      { furnitureId: "proc-flower-mixed", x: 2950, z: 1680, rotation: 129, scaleH: 0.92 },
      { furnitureId: "proc-flower-mixed", x: 3200, z: 1680, rotation: 256, scaleH: 1.08 },
      { furnitureId: "proc-flower-mixed", x: 3450, z: 1680, rotation: 46, scaleH: 1.01 },
      { furnitureId: "proc-flower-mixed", x: 2950, z: 1920, rotation: 321, scaleH: 0.93 },
      { furnitureId: "proc-flower-mixed", x: 3200, z: 1920, rotation: 13, scaleH: 1.12 },
      { furnitureId: "proc-flower-mixed", x: 3450, z: 1920, rotation: 204, scaleH: 0.87 },
      { furnitureId: "stone-path", x: 1850, z: 2650, rotation: 252 },
      { furnitureId: "stone-path", x: 1550, z: 2550, rotation: 252 },
      { furnitureId: "stone-path", x: 1350, z: 2375, rotation: 202 },
      { furnitureId: "stone-path", x: 1250, z: 2125, rotation: 202 },
      { furnitureId: "stone-path", x: 1275, z: 1900, rotation: 143 },
      { furnitureId: "stone-path", x: 1425, z: 1700, rotation: 143 },
      { furnitureId: "stone-path", x: 1650, z: 1475, rotation: 130 },
      { furnitureId: "stone-path", x: 1950, z: 1338, rotation: 95 },
      { furnitureId: "stone-path", x: 2250, z: 1312, rotation: 95 },
      { furnitureId: "stone-path", x: 2500, z: 1350, rotation: 63 },
      { furnitureId: "stone-path", x: 2700, z: 1450, rotation: 63 },
      { furnitureId: "proc-street-lamp", x: 1000, z: 2400, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1450, z: 2100, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1000, z: 1700, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1450, z: 1500, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1000, z: 1100, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1600, z: 1400, rotation: 0 },
      { furnitureId: "proc-stone-lantern", x: 1750, z: 1300, rotation: 209 },
      { furnitureId: "proc-stone-lantern", x: 2250, z: 1300, rotation: 281 },
      { furnitureId: "proc-stone-lantern", x: 1200, z: 1300, rotation: 351 },
      { furnitureId: "proc-stone-lantern", x: 2800, z: 1300, rotation: 67 },
      { furnitureId: "proc-outdoor-bench", x: 1500, z: 1350, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 2500, z: 1350, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 1050, z: 1800, rotation: 90 },
      { furnitureId: "proc-outdoor-bench", x: 1350, z: 2200, rotation: 270 },
      { furnitureId: "proc-outdoor-bench", x: 2700, z: 900, rotation: 90 },
      { furnitureId: "proc-outdoor-bench", x: 2700, z: 1800, rotation: 90 },
      { furnitureId: "proc-bush", x: 3099, z: 1629, rotation: 150, scaleW: 0.96, scaleD: 1.15, scaleH: 0.89 },
      { furnitureId: "proc-bush", x: 3116, z: 1642, rotation: 162, scaleW: 1.15, scaleD: 0.89, scaleH: 1.18 },
      { furnitureId: "proc-bush", x: 2798, z: 1611, rotation: 317, scaleW: 0.82, scaleD: 0.82, scaleH: 0.98 },
      { furnitureId: "proc-bush", x: 2988, z: 1249, rotation: 345, scaleW: 1.09, scaleD: 1.12, scaleH: 1.25 },
      { furnitureId: "proc-bush", x: 1796, z: 1420, rotation: 77, scaleW: 0.86, scaleD: 0.8, scaleH: 1.01 },
      { furnitureId: "proc-bush", x: 1621, z: 1461, rotation: 190, scaleW: 1.19, scaleD: 1.24, scaleH: 0.94 },
      { furnitureId: "proc-bush", x: 1399, z: 1405, rotation: 131, scaleW: 1.27, scaleD: 1.11, scaleH: 1.04 },
      { furnitureId: "proc-bush", x: 1836, z: 1414, rotation: 258, scaleW: 1.07, scaleD: 1.03, scaleH: 0.95 },
      { furnitureId: "proc-wooden-boat", x: 1500, z: 600, rotation: 120 },
      { furnitureId: "proc-tree-oak", x: 300, z: 700, rotation: 296, scaleH: 1.2 },
      { furnitureId: "proc-tree-oak", x: 300, z: 1500, rotation: 47, scaleH: 1.16 },
      { furnitureId: "proc-tree-oak", x: 300, z: 2300, rotation: 151, scaleH: 1.27 },
      { furnitureId: "proc-tree-oak", x: 3700, z: 700, rotation: 273, scaleH: 0.93 },
      { furnitureId: "proc-tree-oak", x: 3700, z: 1500, rotation: 20, scaleH: 1.26 },
      { furnitureId: "proc-tree-oak", x: 3700, z: 2300, rotation: 139, scaleH: 1.02 },
      { furnitureId: "proc-bush", x: 286, z: 1345, rotation: 343, scaleW: 1.25, scaleD: 1.22, scaleH: 1.04 },
      { furnitureId: "proc-bush", x: 159, z: 1200, rotation: 253, scaleW: 1.24, scaleD: 0.84, scaleH: 1.23 },
      { furnitureId: "proc-bush", x: 3655, z: 1373, rotation: 9, scaleW: 1.08, scaleD: 0.92, scaleH: 0.8 },
      { furnitureId: "proc-bush", x: 3618, z: 878, rotation: 28, scaleW: 1.19, scaleD: 1.25, scaleH: 0.86 },

    ],
    },
  ],
};

const BRIDGE_SET: ProjectTemplate = {
  id: "set-bridge",
  name: "桥",
  nameEn: "Bridge",
  emoji: "🌉",
  description: "桥：拱桥跨水+两岸垂柳意境，桥上相遇、鹊桥、分别与重逢的外景",
  descriptionEn: "Arched bridge over water — meetings on the bridge, magpie bridge and farewells and reunions",
  areaSqm: 864,
  palette: ["#A08050", "#3A90C0", "#3A6A3A"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#A08050",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#3A90C0",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-bridge-f1",
      name: "桥",
      area: 864,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3600, depth: 2400,
          name: "桥", nameEn: "Bridge", icon: "🌉",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-grass", x: 1800, z: 1200, rotation: 0, scaleW: 3.4, scaleD: 2.2 },
      { furnitureId: "proc-water-plane", x: 1800, z: 1205, rotation: 0, scaleW: 1.0, scaleD: 2.4 },
      { furnitureId: "proc-arch-bridge", x: 1800, z: 1200, rotation: 0, scaleW: 1.3, scaleD: 1.3 },
      { furnitureId: "proc-rock-big", x: 1250, z: 1200, rotation: 14, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-rock-big", x: 2350, z: 1200, rotation: 194, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-tree-oak", x: 1069, z: 1344, rotation: 357, scaleW: 0.92, scaleD: 1.19, scaleH: 1.23 },
      { furnitureId: "proc-tree-oak", x: 829, z: 1753, rotation: 70, scaleW: 1.24, scaleD: 1.19, scaleH: 1.29 },
      { furnitureId: "proc-tree-oak", x: 628, z: 1244, rotation: 158, scaleW: 0.84, scaleD: 1.04, scaleH: 1.19 },
      { furnitureId: "proc-tree-oak", x: 482, z: 1018, rotation: 71, scaleW: 0.89, scaleD: 1.27, scaleH: 1.02 },
      { furnitureId: "proc-stone-lantern", x: 1250, z: 1000, rotation: 0 },
      { furnitureId: "proc-stone-lantern", x: 1250, z: 1400, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 2566, z: 1550, rotation: 121, scaleW: 1.2, scaleD: 1.27, scaleH: 1.14 },
      { furnitureId: "proc-tree-oak", x: 2846, z: 1233, rotation: 276, scaleW: 1.05, scaleD: 1.23, scaleH: 1.15 },
      { furnitureId: "proc-tree-oak", x: 2943, z: 1737, rotation: 12, scaleW: 0.9, scaleD: 1.17, scaleH: 1.24 },
      { furnitureId: "proc-tree-oak", x: 2747, z: 679, rotation: 238, scaleW: 1.14, scaleD: 1.03, scaleH: 1.24 },
      { furnitureId: "proc-bamboo-clump", x: 3256, z: 1071, rotation: 159, scaleW: 0.9, scaleD: 0.85, scaleH: 0.99 },
      { furnitureId: "proc-bamboo-clump", x: 3019, z: 803, rotation: 297, scaleW: 1.08, scaleD: 1.06, scaleH: 1.0 },
      { furnitureId: "proc-bamboo-clump", x: 3287, z: 1035, rotation: 316, scaleW: 1.25, scaleD: 1.28, scaleH: 0.84 },
      { furnitureId: "proc-bamboo-clump", x: 3028, z: 1608, rotation: 56, scaleW: 1.09, scaleD: 0.85, scaleH: 1.23 },
      { furnitureId: "proc-lantern-pole", x: 2350, z: 1000, rotation: 42 },
      { furnitureId: "proc-lantern-pole", x: 2350, z: 1400, rotation: 180 },
      { furnitureId: "proc-lantern-pole", x: 1250, z: 900, rotation: 348 },
      { furnitureId: "proc-lantern-pole", x: 1250, z: 1500, rotation: 210 },
      { furnitureId: "proc-rock", x: 1430, z: 1697, rotation: 78, scaleW: 0.87, scaleD: 0.85, scaleH: 0.93 },
      { furnitureId: "proc-rock", x: 1370, z: 954, rotation: 271, scaleW: 0.91, scaleD: 0.86, scaleH: 1.01 },
      { furnitureId: "proc-rock", x: 1157, z: 1084, rotation: 158, scaleW: 1.09, scaleD: 1.22, scaleH: 1.05 },
      { furnitureId: "proc-rock", x: 1135, z: 890, rotation: 156, scaleW: 1.1, scaleD: 1.01, scaleH: 1.09 },
      { furnitureId: "proc-rock", x: 2337, z: 1561, rotation: 236, scaleW: 0.87, scaleD: 1.15, scaleH: 1.29 },
      { furnitureId: "proc-rock", x: 2133, z: 1141, rotation: 271, scaleW: 1.1, scaleD: 0.94, scaleH: 0.89 },
      { furnitureId: "proc-rock", x: 2311, z: 937, rotation: 205, scaleW: 1.1, scaleD: 1.13, scaleH: 0.84 },
      { furnitureId: "proc-rock", x: 2478, z: 1191, rotation: 57, scaleW: 0.91, scaleD: 0.84, scaleH: 0.91 },
      { furnitureId: "proc-bush", x: 1080, z: 904, rotation: 46, scaleW: 1.12, scaleD: 1.19, scaleH: 1.21 },
      { furnitureId: "proc-bush", x: 871, z: 835, rotation: 10, scaleW: 1.0, scaleD: 1.07, scaleH: 0.99 },
      { furnitureId: "proc-bush", x: 1178, z: 1295, rotation: 319, scaleW: 0.87, scaleD: 1.21, scaleH: 1.0 },
      { furnitureId: "proc-bush", x: 2620, z: 1544, rotation: 203, scaleW: 0.92, scaleD: 0.82, scaleH: 0.82 },
      { furnitureId: "proc-bush", x: 2406, z: 1550, rotation: 335, scaleW: 1.07, scaleD: 1.08, scaleH: 1.01 },
      { furnitureId: "proc-bush", x: 2559, z: 1771, rotation: 143, scaleW: 0.83, scaleD: 0.86, scaleH: 0.82 },
      { furnitureId: "proc-grass-tuft", x: 1468, z: 1529, rotation: 86, scaleW: 1.16, scaleD: 1.0, scaleH: 0.86 },
      { furnitureId: "proc-grass-tuft", x: 1409, z: 661, rotation: 155, scaleW: 1.03, scaleD: 0.84, scaleH: 1.09 },
      { furnitureId: "proc-grass-tuft", x: 1498, z: 1504, rotation: 336, scaleW: 1.06, scaleD: 0.87, scaleH: 1.19 },
      { furnitureId: "proc-grass-tuft", x: 1379, z: 1841, rotation: 316, scaleW: 0.91, scaleD: 1.15, scaleH: 1.01 },
      { furnitureId: "proc-grass-tuft", x: 2156, z: 1140, rotation: 61, scaleW: 0.9, scaleD: 1.09, scaleH: 1.23 },
      { furnitureId: "proc-grass-tuft", x: 2081, z: 1327, rotation: 53, scaleW: 0.92, scaleD: 0.89, scaleH: 1.01 },
      { furnitureId: "proc-grass-tuft", x: 2163, z: 1470, rotation: 98, scaleW: 0.82, scaleD: 1.25, scaleH: 1.23 },
      { furnitureId: "proc-grass-tuft", x: 2216, z: 1223, rotation: 34, scaleW: 1.12, scaleD: 1.05, scaleH: 1.0 },
      { furnitureId: "stone-path", x: 900, z: 2108, rotation: 180 },
      { furnitureId: "stone-path", x: 900, z: 1825, rotation: 180 },
      { furnitureId: "stone-path", x: 900, z: 1542, rotation: 180 },
      { furnitureId: "stone-path", x: 1050, z: 1300, rotation: 124 },
      { furnitureId: "stone-path", x: 2550, z: 1200, rotation: 90 },
      { furnitureId: "stone-path", x: 2700, z: 1083, rotation: 180 },
      { furnitureId: "stone-path", x: 2700, z: 850, rotation: 180 },
      { furnitureId: "stone-path", x: 2700, z: 617, rotation: 180 },
      { furnitureId: "proc-wooden-boat", x: 1800, z: 350, rotation: 160 },
      { furnitureId: "proc-tree-oak", x: 300, z: 400, rotation: 163, scaleH: 1.12 },
      { furnitureId: "proc-tree-oak", x: 300, z: 1200, rotation: 51, scaleH: 1.14 },
      { furnitureId: "proc-tree-oak", x: 300, z: 2000, rotation: 233, scaleH: 0.97 },
      { furnitureId: "proc-tree-oak", x: 3300, z: 400, rotation: 56, scaleH: 0.96 },
      { furnitureId: "proc-bush", x: 433, z: 800, rotation: 177, scaleW: 1.09, scaleD: 1.1, scaleH: 1.15 },
      { furnitureId: "proc-bush", x: 350, z: 655, rotation: 290, scaleW: 1.0, scaleD: 1.28, scaleH: 1.13 },
      { furnitureId: "proc-bush", x: 422, z: 714, rotation: 265, scaleW: 0.85, scaleD: 0.91, scaleH: 1.18 },
      { furnitureId: "proc-rock", x: 3438, z: 596, rotation: 78, scaleW: 1.08, scaleD: 1.14, scaleH: 0.85 },
      { furnitureId: "proc-rock", x: 3236, z: 724, rotation: 72, scaleW: 1.18, scaleD: 0.95, scaleH: 0.81 },

    ],
    },
  ],
};

const STATION_SET: ProjectTemplate = {
  id: "set-station",
  name: "火车站",
  nameEn: "Train Station",
  emoji: "🚉",
  description: "火车站：双站台+铁轨+站房，接站、送别、站台追车的都市外景",
  descriptionEn: "Train station with two platforms, tracks and a hall — pickups, farewells and running after the train",
  areaSqm: 1232,
  palette: ["#8A8A8A", "#2A5A8A", "#C8C8C8"],
  styleTemplateId: "modern-villa",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#8A8A8A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#2A5A8A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-station-f1",
      name: "火车站",
      area: 1232,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4400, depth: 2800,
          name: "火车站", nameEn: "Train Station", icon: "🚉",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-stone", x: 2200, z: 1400, rotation: 0, scaleW: 4.2, scaleD: 2.6 },
      { furnitureId: "proc-rail-track", x: 2200, z: 1300, rotation: 0, scaleW: 3.4, scaleD: 1.0 },
      { furnitureId: "proc-rail-track", x: 2200, z: 1900, rotation: 0, scaleW: 3.4, scaleD: 1.0 },
      { furnitureId: "proc-platform", x: 2200, z: 900, rotation: 0, scaleW: 3.4, scaleD: 1.0 },
      { furnitureId: "proc-platform", x: 2200, z: 2300, rotation: 0, scaleW: 3.4, scaleD: 1.0 },
      { furnitureId: "proc-shop-facade", x: 1200, z: 560, rotation: 0, scaleW: 1.0 },
      { furnitureId: "proc-shop-facade", x: 2200, z: 560, rotation: 0, scaleW: 1.3 },
      { furnitureId: "proc-shop-facade", x: 3200, z: 560, rotation: 0, scaleW: 1.0 },
      { furnitureId: "proc-street-lamp", x: 600, z: 700, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1200, z: 700, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1800, z: 700, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 2400, z: 700, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 3000, z: 700, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 3600, z: 700, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 4000, z: 700, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 500, z: 700, rotation: 0 },
      { furnitureId: "fence", x: 500, z: 900, rotation: 0 },
      { furnitureId: "fence", x: 500, z: 2300, rotation: 0 },
      { furnitureId: "fence", x: 3900, z: 900, rotation: 0 },
      { furnitureId: "fence", x: 3900, z: 2300, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 1200, z: 1050, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 1800, z: 1050, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 2400, z: 1050, rotation: 0 },
      { furnitureId: "proc-outdoor-bench", x: 1200, z: 2150, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 1800, z: 2150, rotation: 180 },
      { furnitureId: "proc-outdoor-bench", x: 2400, z: 2150, rotation: 180 },
      { furnitureId: "proc-banner", x: 900, z: 1050, rotation: 0 },
      { furnitureId: "proc-banner", x: 3500, z: 1050, rotation: 0 },
      { furnitureId: "stone-path", x: 700, z: 2183, rotation: 180 },
      { furnitureId: "stone-path", x: 700, z: 1950, rotation: 180 },
      { furnitureId: "stone-path", x: 700, z: 1717, rotation: 180 },
      { furnitureId: "stone-path", x: 700, z: 1483, rotation: 180 },
      { furnitureId: "stone-path", x: 700, z: 1250, rotation: 180 },
      { furnitureId: "stone-path", x: 700, z: 1017, rotation: 180 },
      { furnitureId: "proc-street-lamp", x: 600, z: 180, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1400, z: 180, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 2200, z: 180, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 3000, z: 180, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 3800, z: 180, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 600, z: 2620, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 1400, z: 2620, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 2200, z: 2620, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 3000, z: 2620, rotation: 0 },
      { furnitureId: "proc-street-lamp", x: 3800, z: 2620, rotation: 0 },
      { furnitureId: "proc-banner", x: 900, z: 180, rotation: 0 },
      { furnitureId: "proc-banner", x: 900, z: 2620, rotation: 0 },
      { furnitureId: "proc-banner", x: 3500, z: 180, rotation: 0 },
      { furnitureId: "proc-banner", x: 3500, z: 2620, rotation: 0 },

    ],
    },
  ],
};

const ANCIENT_STREET_SET: ProjectTemplate = {
  id: "set-ancient-street",
  name: "古镇街道",
  nameEn: "Ancient Town Street",
  emoji: "🏮",
  description: "古镇街道：木构店面+灯笼+水井，古装逛街、夜市、江湖偶遇的外景",
  descriptionEn: "Ancient town street with timber shopfronts, lanterns and a well — period shopping, night markets and jianghu encounters",
  areaSqm: 960,
  palette: ["#6A4A2A", "#C03028", "#8A7A5A"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#6A4A2A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#C03028",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-ancient-street-f1",
      name: "古镇街道",
      area: 960,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4000, depth: 2400,
          name: "古镇街道", nameEn: "Ancient Town Street", icon: "🏮",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-stone", x: 2000, z: 1200, rotation: 0, scaleW: 3.8, scaleD: 2.2 },
      { furnitureId: "proc-timber-facade", x: 700, z: 500, rotation: 90 },
      { furnitureId: "proc-timber-facade", x: 3300, z: 500, rotation: 270 },
      { furnitureId: "proc-timber-facade", x: 700, z: 1100, rotation: 90 },
      { furnitureId: "proc-timber-facade", x: 3300, z: 1100, rotation: 270 },
      { furnitureId: "proc-timber-facade", x: 700, z: 1700, rotation: 90 },
      { furnitureId: "proc-timber-facade", x: 3300, z: 1700, rotation: 270 },
      { furnitureId: "proc-pailou", x: 2000, z: 2250, rotation: 0 },
      { furnitureId: "proc-city-gate", x: 2000, z: 250, rotation: 0, scaleW: 0.8, scaleD: 0.8 },
      { furnitureId: "proc-stone-well", x: 2000, z: 1000, rotation: 0 },
      { furnitureId: "proc-market-stall", x: 1500, z: 800, rotation: 251 },
      { furnitureId: "proc-market-stall", x: 1500, z: 1400, rotation: 205 },
      { furnitureId: "proc-market-stall", x: 2500, z: 800, rotation: 115 },
      { furnitureId: "proc-market-stall", x: 2500, z: 1400, rotation: 15 },
      { furnitureId: "proc-lantern-pole", x: 1150, z: 300, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 2850, z: 600, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 1150, z: 900, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 2850, z: 1200, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 1150, z: 1500, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 2850, z: 1800, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 1150, z: 2100, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 2850, z: 450, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 1150, z: 1050, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 2850, z: 1650, rotation: 0 },
      { furnitureId: "stone-path", x: 2000, z: 2152, rotation: 180 },
      { furnitureId: "stone-path", x: 2000, z: 1958, rotation: 180 },
      { furnitureId: "stone-path", x: 2000, z: 1762, rotation: 180 },
      { furnitureId: "stone-path", x: 2000, z: 1568, rotation: 180 },
      { furnitureId: "stone-path", x: 2000, z: 1372, rotation: 180 },
      { furnitureId: "stone-path", x: 2000, z: 1178, rotation: 180 },
      { furnitureId: "stone-path", x: 2000, z: 982, rotation: 180 },
      { furnitureId: "stone-path", x: 2000, z: 788, rotation: 180 },
      { furnitureId: "stone-path", x: 2000, z: 592, rotation: 180 },
      { furnitureId: "stone-path", x: 2000, z: 398, rotation: 180 },
      { furnitureId: "proc-tree-oak", x: 1000, z: 300, rotation: 217, scaleH: 0.9 },
      { furnitureId: "proc-tree-oak", x: 3000, z: 300, rotation: 288, scaleH: 1.04 },
      { furnitureId: "proc-tree-oak", x: 1000, z: 2100, rotation: 213, scaleH: 0.97 },
      { furnitureId: "proc-tree-oak", x: 3000, z: 2100, rotation: 88, scaleH: 1.05 },
      { furnitureId: "proc-wood-chest", x: 1400, z: 900, rotation: 20 },
      { furnitureId: "proc-wood-chest", x: 2600, z: 1500, rotation: 340 },
      { furnitureId: "proc-lantern-pole", x: 250, z: 400, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 3750, z: 400, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 250, z: 1000, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 3750, z: 1000, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 250, z: 1600, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 3750, z: 1600, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 250, z: 2000, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 3750, z: 2000, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 300, z: 600, rotation: 279, scaleH: 0.94 },
      { furnitureId: "proc-tree-oak", x: 300, z: 1800, rotation: 228, scaleH: 1.07 },
      { furnitureId: "proc-tree-oak", x: 3700, z: 600, rotation: 175, scaleH: 1.05 },
      { furnitureId: "proc-tree-oak", x: 3700, z: 1800, rotation: 78, scaleH: 1.04 },

    ],
    },
  ],
};

const MARKET_SET: ProjectTemplate = {
  id: "set-market",
  name: "集市",
  nameEn: "Market",
  emoji: "🧺",
  description: "集市：六摊+灯笼+木构店面，赶集、讨价还价、市井烟火的外景",
  descriptionEn: "Bustling market with six stalls, lanterns and timber shops — market day, haggling and street life",
  areaSqm: 864,
  palette: ["#B0503A", "#6A4A2A", "#D8B060"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#B0503A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#6A4A2A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-market-f1",
      name: "集市",
      area: 864,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 3600, depth: 2400,
          name: "集市", nameEn: "Market", icon: "🧺",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-stone", x: 1800, z: 1200, rotation: 0, scaleW: 3.4, scaleD: 2.2 },
      { furnitureId: "proc-market-stall", x: 1450, z: 600, rotation: 90 },
      { furnitureId: "proc-market-stall", x: 2150, z: 600, rotation: 270 },
      { furnitureId: "proc-market-stall", x: 1450, z: 1200, rotation: 90 },
      { furnitureId: "proc-market-stall", x: 2150, z: 1200, rotation: 270 },
      { furnitureId: "proc-market-stall", x: 1450, z: 1800, rotation: 90 },
      { furnitureId: "proc-market-stall", x: 2150, z: 1800, rotation: 270 },
      { furnitureId: "proc-pailou", x: 1800, z: 2250, rotation: 0 },
      { furnitureId: "proc-timber-facade", x: 1300, z: 250, rotation: 0 },
      { furnitureId: "proc-timber-facade", x: 2300, z: 250, rotation: 0 },
      { furnitureId: "proc-wood-chest", x: 1650, z: 600, rotation: 257 },
      { furnitureId: "proc-wood-chest", x: 1650, z: 1200, rotation: 283 },
      { furnitureId: "proc-wood-chest", x: 1650, z: 1800, rotation: 89 },
      { furnitureId: "proc-wood-chest", x: 1950, z: 600, rotation: 25 },
      { furnitureId: "proc-wood-chest", x: 1950, z: 1200, rotation: 94 },
      { furnitureId: "proc-wood-chest", x: 1950, z: 1800, rotation: 216 },
      { furnitureId: "proc-stone-well", x: 1950, z: 1500, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 1550, z: 350, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 2050, z: 650, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 1550, z: 950, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 2050, z: 1250, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 1550, z: 1550, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 2050, z: 1850, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 1550, z: 2150, rotation: 0 },
      { furnitureId: "proc-lantern-pole", x: 2050, z: 2300, rotation: 0 },
      { furnitureId: "stone-path", x: 1800, z: 2128, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 1884, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 1641, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 1397, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 1153, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 909, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 666, rotation: 180 },
      { furnitureId: "stone-path", x: 1800, z: 422, rotation: 180 },
      { furnitureId: "proc-pergola", x: 1450, z: 1200, rotation: 0, scaleW: 1.5, scaleD: 4.0 },
      { furnitureId: "proc-pergola", x: 2150, z: 1200, rotation: 0, scaleW: 1.5, scaleD: 4.0 },
      { furnitureId: "proc-tree-oak", x: 400, z: 2100, rotation: 235, scaleH: 1.11 },
      { furnitureId: "proc-tree-oak", x: 3200, z: 2100, rotation: 149, scaleH: 1.2 },
      { furnitureId: "proc-tree-oak", x: 400, z: 400, rotation: 67, scaleH: 1.05 },
      { furnitureId: "proc-tree-oak", x: 300, z: 400, rotation: 35, scaleH: 1.21 },
      { furnitureId: "proc-tree-oak", x: 300, z: 1200, rotation: 247, scaleH: 1.24 },
      { furnitureId: "proc-tree-oak", x: 300, z: 2000, rotation: 181, scaleH: 1.03 },
      { furnitureId: "proc-tree-oak", x: 3300, z: 400, rotation: 235, scaleH: 1.12 },
      { furnitureId: "proc-tree-oak", x: 3300, z: 1200, rotation: 208, scaleH: 1.0 },
      { furnitureId: "proc-tree-oak", x: 3300, z: 2000, rotation: 228, scaleH: 1.12 },
      { furnitureId: "proc-bush", x: 342, z: 701, rotation: 200, scaleW: 1.04, scaleD: 0.82, scaleH: 1.08 },
      { furnitureId: "proc-bush", x: 275, z: 907, rotation: 322, scaleW: 1.13, scaleD: 1.18, scaleH: 0.81 },
      { furnitureId: "proc-bush", x: 3285, z: 1409, rotation: 123, scaleW: 1.0, scaleD: 1.16, scaleH: 1.25 },
      { furnitureId: "proc-bush", x: 3355, z: 1436, rotation: 273, scaleW: 1.08, scaleD: 0.84, scaleH: 1.22 },
      { furnitureId: "proc-wood-chest", x: 300, z: 1500, rotation: 20 },
      { furnitureId: "proc-wood-chest", x: 3300, z: 900, rotation: 340 },

    ],
    },
  ],
};

const BATTLEFIELD_SET: ProjectTemplate = {
  id: "set-battlefield",
  name: "战场",
  nameEn: "Battlefield",
  emoji: "⚔️",
  description: "战场：帐篷+旗帜+插地长枪，出征、鏖战、战后余生的古战外景",
  descriptionEn: "Battlefield with tents, banners and planted spears — departures, battle and survival after war",
  areaSqm: 1440,
  palette: ["#8A7A5A", "#B03030", "#5A6A3A"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#8A7A5A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#B03030",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-battlefield-f1",
      name: "战场",
      area: 1440,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4800, depth: 3000,
          name: "战场", nameEn: "Battlefield", icon: "⚔️",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-dry", x: 2400, z: 1500, rotation: 0, scaleW: 4.6, scaleD: 2.8 },
      { furnitureId: "proc-tent", x: 1500, z: 1300, rotation: 180 },
      { furnitureId: "proc-tent", x: 3300, z: 1300, rotation: 180 },
      { furnitureId: "proc-banner", x: 1200, z: 1150, rotation: 251 },
      { furnitureId: "proc-banner", x: 2400, z: 1150, rotation: 337 },
      { furnitureId: "proc-banner", x: 3600, z: 1150, rotation: 255 },
      { furnitureId: "proc-tent", x: 1500, z: 2650, rotation: 0 },
      { furnitureId: "proc-tent", x: 3300, z: 2650, rotation: 0 },
      { furnitureId: "proc-banner", x: 1200, z: 2800, rotation: 141 },
      { furnitureId: "proc-banner", x: 2400, z: 2800, rotation: 1 },
      { furnitureId: "proc-banner", x: 3600, z: 2800, rotation: 87 },
      { furnitureId: "proc-spear", x: 900, z: 1600, rotation: 40 },
      { furnitureId: "proc-spear", x: 3900, z: 1600, rotation: 94 },
      { furnitureId: "proc-spear", x: 900, z: 1770, rotation: 324 },
      { furnitureId: "proc-spear", x: 3900, z: 1770, rotation: 197 },
      { furnitureId: "proc-spear", x: 900, z: 1940, rotation: 277 },
      { furnitureId: "proc-spear", x: 3900, z: 1940, rotation: 166 },
      { furnitureId: "proc-spear", x: 900, z: 2110, rotation: 356 },
      { furnitureId: "proc-spear", x: 3900, z: 2110, rotation: 1 },
      { furnitureId: "proc-spear", x: 900, z: 2280, rotation: 304 },
      { furnitureId: "proc-spear", x: 3900, z: 2280, rotation: 257 },
      { furnitureId: "proc-spear", x: 900, z: 2450, rotation: 123 },
      { furnitureId: "proc-spear", x: 3900, z: 2450, rotation: 25 },
      { furnitureId: "proc-spear", x: 900, z: 2620, rotation: 254 },
      { furnitureId: "proc-spear", x: 3900, z: 2620, rotation: 197 },
      { furnitureId: "proc-spear", x: 900, z: 2790, rotation: 75 },
      { furnitureId: "proc-spear", x: 3900, z: 2790, rotation: 14 },
      { furnitureId: "proc-banner", x: 2200, z: 1950, rotation: 0 },
      { furnitureId: "proc-banner", x: 2600, z: 1950, rotation: 0 },
      { furnitureId: "proc-fallen-column", x: 2400, z: 2300, rotation: 75 },
      { furnitureId: "proc-rubble-pile", x: 2100, z: 2350, rotation: 20 },
      { furnitureId: "proc-rubble-pile", x: 2700, z: 2350, rotation: 315 },
      { furnitureId: "proc-banpo-firepit", x: 2400, z: 2600, rotation: 0 },
      { furnitureId: "proc-dead-tree", x: 1200, z: 2100, rotation: 92 },
      { furnitureId: "proc-dead-tree", x: 3600, z: 2100, rotation: 104 },
      { furnitureId: "proc-dead-tree", x: 1200, z: 1750, rotation: 17 },
      { furnitureId: "proc-dead-tree", x: 3600, z: 1750, rotation: 29 },
      { furnitureId: "proc-dead-tree", x: 2400, z: 1500, rotation: 301 },
      { furnitureId: "proc-rock", x: 1413, z: 1971, rotation: 254, scaleW: 1.27, scaleD: 0.86, scaleH: 0.9 },
      { furnitureId: "proc-rock", x: 1196, z: 1846, rotation: 357, scaleW: 1.03, scaleD: 1.22, scaleH: 0.81 },
      { furnitureId: "proc-rock", x: 1370, z: 1821, rotation: 330, scaleW: 1.17, scaleD: 0.86, scaleH: 1.01 },
      { furnitureId: "proc-rock", x: 1305, z: 1817, rotation: 158, scaleW: 1.06, scaleD: 1.29, scaleH: 1.09 },
      { furnitureId: "proc-rock", x: 3180, z: 1992, rotation: 239, scaleW: 0.95, scaleD: 1.08, scaleH: 1.17 },
      { furnitureId: "proc-rock", x: 3451, z: 1865, rotation: 130, scaleW: 1.25, scaleD: 1.0, scaleH: 0.83 },
      { furnitureId: "proc-rock", x: 3246, z: 2154, rotation: 156, scaleW: 1.16, scaleD: 1.19, scaleH: 0.9 },
      { furnitureId: "proc-rock", x: 3032, z: 1955, rotation: 285, scaleW: 1.22, scaleD: 0.81, scaleH: 0.93 },
      { furnitureId: "proc-grass-tuft", x: 1135, z: 2026, rotation: 156, scaleW: 0.93, scaleD: 1.06, scaleH: 0.88 },
      { furnitureId: "proc-grass-tuft", x: 938, z: 1714, rotation: 325, scaleW: 0.87, scaleD: 1.13, scaleH: 1.27 },
      { furnitureId: "proc-grass-tuft", x: 1324, z: 1928, rotation: 168, scaleW: 0.88, scaleD: 0.91, scaleH: 0.84 },
      { furnitureId: "proc-grass-tuft", x: 1300, z: 1844, rotation: 185, scaleW: 1.09, scaleD: 0.93, scaleH: 1.27 },
      { furnitureId: "proc-grass-tuft", x: 1021, z: 2151, rotation: 56, scaleW: 1.11, scaleD: 1.01, scaleH: 1.11 },
      { furnitureId: "proc-grass-tuft", x: 950, z: 1969, rotation: 39, scaleW: 0.8, scaleD: 1.1, scaleH: 0.81 },
      { furnitureId: "proc-grass-tuft", x: 1436, z: 1887, rotation: 114, scaleW: 1.29, scaleD: 0.84, scaleH: 0.99 },
      { furnitureId: "proc-grass-tuft", x: 3882, z: 2114, rotation: 116, scaleW: 0.8, scaleD: 0.86, scaleH: 1.1 },
      { furnitureId: "proc-grass-tuft", x: 3782, z: 2224, rotation: 12, scaleW: 1.06, scaleD: 1.27, scaleH: 0.97 },
      { furnitureId: "proc-grass-tuft", x: 3830, z: 2320, rotation: 29, scaleW: 1.1, scaleD: 1.09, scaleH: 1.22 },
      { furnitureId: "proc-grass-tuft", x: 3701, z: 1745, rotation: 331, scaleW: 0.88, scaleD: 1.03, scaleH: 1.26 },
      { furnitureId: "proc-grass-tuft", x: 3687, z: 1908, rotation: 47, scaleW: 1.08, scaleD: 0.95, scaleH: 1.09 },
      { furnitureId: "proc-grass-tuft", x: 3499, z: 1888, rotation: 221, scaleW: 1.13, scaleD: 1.17, scaleH: 1.3 },
      { furnitureId: "proc-grass-tuft", x: 3986, z: 1984, rotation: 92, scaleW: 0.9, scaleD: 1.13, scaleH: 1.06 },
      { furnitureId: "proc-mountain", x: 2400, z: 530, rotation: 0, scaleW: 2.0, scaleD: 0.7, scaleH: 1.0 },
      { furnitureId: "proc-dead-tree", x: 300, z: 500, rotation: 46 },
      { furnitureId: "proc-dead-tree", x: 4500, z: 500, rotation: 162 },
      { furnitureId: "proc-dead-tree", x: 300, z: 900, rotation: 23 },
      { furnitureId: "proc-dead-tree", x: 4500, z: 900, rotation: 201 },
      { furnitureId: "proc-banner", x: 250, z: 1400, rotation: 282 },
      { furnitureId: "proc-banner", x: 250, z: 2200, rotation: 83 },
      { furnitureId: "proc-banner", x: 4550, z: 1400, rotation: 104 },
      { furnitureId: "proc-banner", x: 4550, z: 2200, rotation: 325 },
      { furnitureId: "proc-rock", x: 157, z: 625, rotation: 143, scaleW: 1.2, scaleD: 0.84, scaleH: 0.99 },
      { furnitureId: "proc-rock", x: 181, z: 816, rotation: 27, scaleW: 1.21, scaleD: 0.96, scaleH: 1.25 },
      { furnitureId: "proc-rock", x: 206, z: 718, rotation: 328, scaleW: 0.99, scaleD: 0.89, scaleH: 1.04 },
      { furnitureId: "proc-rock", x: 4627, z: 755, rotation: 301, scaleW: 0.83, scaleD: 1.1, scaleH: 0.97 },
      { furnitureId: "proc-rock", x: 4477, z: 842, rotation: 28, scaleW: 0.87, scaleD: 0.83, scaleH: 1.16 },
      { furnitureId: "proc-rock", x: 4300, z: 667, rotation: 72, scaleW: 1.03, scaleD: 1.15, scaleH: 0.8 },
      { furnitureId: "proc-grass-tuft", x: 212, z: 1674, rotation: 269, scaleW: 0.8, scaleD: 1.29, scaleH: 1.25 },
      { furnitureId: "proc-grass-tuft", x: 237, z: 1850, rotation: 209, scaleW: 1.14, scaleD: 1.27, scaleH: 1.07 },
      { furnitureId: "proc-grass-tuft", x: 439, z: 1919, rotation: 343, scaleW: 0.87, scaleD: 0.97, scaleH: 1.14 },
      { furnitureId: "proc-grass-tuft", x: 4437, z: 1739, rotation: 228, scaleW: 1.3, scaleD: 0.95, scaleH: 1.14 },
      { furnitureId: "proc-grass-tuft", x: 4439, z: 1655, rotation: 167, scaleW: 0.97, scaleD: 0.96, scaleH: 1.21 },
      { furnitureId: "proc-grass-tuft", x: 4397, z: 1513, rotation: 218, scaleW: 1.18, scaleD: 0.96, scaleH: 1.16 },
      { furnitureId: "proc-dead-tree", x: 1800, z: 700, rotation: 250 },
      { furnitureId: "proc-rock", x: 1952, z: 721, rotation: 280, scaleW: 1.29, scaleD: 1.19, scaleH: 1.21 },
      { furnitureId: "proc-rock", x: 1621, z: 752, rotation: 164, scaleW: 1.15, scaleD: 1.2, scaleH: 0.95 },

    ],
    },
  ],
};

const MILITARY_CAMP_SET: ProjectTemplate = {
  id: "set-military-camp",
  name: "军营",
  nameEn: "Military Camp",
  emoji: "⛺",
  description: "军营：帐篷+围栏+篝火，点兵、夜巡、军中夜话的外景",
  descriptionEn: "Military camp with tents, fences and a campfire — roll calls, night patrols and talks in camp",
  areaSqm: 1232,
  palette: ["#8A7A5A", "#B03030", "#3A5A3A"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "grass",
    wallColor: "#8A7A5A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#B03030",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-military-camp-f1",
      name: "军营",
      area: 1232,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4400, depth: 2800,
          name: "军营", nameEn: "Military Camp", icon: "⛺",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-dry", x: 2200, z: 1400, rotation: 0, scaleW: 4.2, scaleD: 2.6 },
      { furnitureId: "proc-tent", x: 2200, z: 650, rotation: 180, scaleW: 1.5, scaleD: 1.5, scaleH: 1.2 },
      { furnitureId: "proc-banner", x: 2200, z: 450, rotation: 0, scaleH: 1.3 },
      { furnitureId: "proc-tent", x: 900, z: 900, rotation: 90 },
      { furnitureId: "proc-tent", x: 3500, z: 900, rotation: 270 },
      { furnitureId: "proc-tent", x: 900, z: 1400, rotation: 90 },
      { furnitureId: "proc-tent", x: 3500, z: 1400, rotation: 270 },
      { furnitureId: "proc-tent", x: 900, z: 1900, rotation: 90 },
      { furnitureId: "proc-tent", x: 3500, z: 1900, rotation: 270 },
      { furnitureId: "fence", x: 800, z: 300, rotation: 90 },
      { furnitureId: "fence", x: 1400, z: 300, rotation: 90 },
      { furnitureId: "fence", x: 2000, z: 300, rotation: 90 },
      { furnitureId: "fence", x: 2600, z: 300, rotation: 90 },
      { furnitureId: "fence", x: 3200, z: 300, rotation: 90 },
      { furnitureId: "fence", x: 800, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 1200, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 1600, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 2700, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 3100, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 3500, z: 2500, rotation: 90 },
      { furnitureId: "fence", x: 500, z: 800, rotation: 0 },
      { furnitureId: "fence", x: 3900, z: 800, rotation: 0 },
      { furnitureId: "fence", x: 500, z: 1400, rotation: 0 },
      { furnitureId: "fence", x: 3900, z: 1400, rotation: 0 },
      { furnitureId: "fence", x: 500, z: 2000, rotation: 0 },
      { furnitureId: "fence", x: 3900, z: 2000, rotation: 0 },
      { furnitureId: "proc-banner", x: 2000, z: 2500, rotation: 0 },
      { furnitureId: "proc-banner", x: 2400, z: 2500, rotation: 0 },
      { furnitureId: "proc-spear", x: 1950, z: 2400, rotation: 0 },
      { furnitureId: "proc-spear", x: 2450, z: 2400, rotation: 0 },
      { furnitureId: "proc-banpo-firepit", x: 2200, z: 1400, rotation: 0 },
      { furnitureId: "proc-banner", x: 1300, z: 900, rotation: 225 },
      { furnitureId: "proc-banner", x: 3100, z: 900, rotation: 78 },
      { furnitureId: "proc-banner", x: 1300, z: 1900, rotation: 69 },
      { furnitureId: "proc-banner", x: 3100, z: 1900, rotation: 149 },
      { furnitureId: "stone-path", x: 1150, z: 500, rotation: 90 },
      { furnitureId: "stone-path", x: 1850, z: 500, rotation: 90 },
      { furnitureId: "stone-path", x: 2550, z: 500, rotation: 90 },
      { furnitureId: "stone-path", x: 3250, z: 500, rotation: 90 },
      { furnitureId: "stone-path", x: 3600, z: 800, rotation: 0 },
      { furnitureId: "stone-path", x: 3600, z: 1400, rotation: 0 },
      { furnitureId: "stone-path", x: 3600, z: 2000, rotation: 0 },
      { furnitureId: "stone-path", x: 3250, z: 2300, rotation: 270 },
      { furnitureId: "stone-path", x: 2550, z: 2300, rotation: 270 },
      { furnitureId: "stone-path", x: 1850, z: 2300, rotation: 270 },
      { furnitureId: "stone-path", x: 1150, z: 2300, rotation: 270 },
      { furnitureId: "stone-path", x: 800, z: 2000, rotation: 180 },
      { furnitureId: "stone-path", x: 800, z: 1400, rotation: 180 },
      { furnitureId: "stone-path", x: 800, z: 800, rotation: 180 },
      { furnitureId: "proc-spear", x: 1300, z: 1400, rotation: 199 },
      { furnitureId: "proc-spear", x: 3100, z: 1400, rotation: 354 },
      { furnitureId: "proc-spear", x: 2200, z: 900, rotation: 251 },
      { furnitureId: "proc-spear", x: 2200, z: 1900, rotation: 157 },
      { furnitureId: "proc-spear", x: 1600, z: 1400, rotation: 204 },
      { furnitureId: "proc-spear", x: 2800, z: 1400, rotation: 176 },
      { furnitureId: "proc-rock", x: 1381, z: 2330, rotation: 244, scaleW: 1.29, scaleD: 0.9, scaleH: 0.9 },
      { furnitureId: "proc-rock", x: 1109, z: 2358, rotation: 10, scaleW: 1.04, scaleD: 1.02, scaleH: 0.86 },
      { furnitureId: "proc-rock", x: 1431, z: 2325, rotation: 308, scaleW: 0.99, scaleD: 0.9, scaleH: 0.89 },
      { furnitureId: "proc-rock", x: 3289, z: 2019, rotation: 78, scaleW: 1.24, scaleD: 1.11, scaleH: 1.29 },
      { furnitureId: "proc-rock", x: 3033, z: 2140, rotation: 44, scaleW: 0.86, scaleD: 0.98, scaleH: 1.03 },
      { furnitureId: "proc-grass-tuft", x: 744, z: 2598, rotation: 159, scaleW: 0.93, scaleD: 0.87, scaleH: 0.92 },
      { furnitureId: "proc-grass-tuft", x: 265, z: 2606, rotation: 307, scaleW: 0.98, scaleD: 1.03, scaleH: 1.19 },
      { furnitureId: "proc-grass-tuft", x: 382, z: 2643, rotation: 9, scaleW: 0.82, scaleD: 1.04, scaleH: 0.8 },
      { furnitureId: "proc-grass-tuft", x: 854, z: 2645, rotation: 315, scaleW: 1.07, scaleD: 1.03, scaleH: 1.29 },
      { furnitureId: "proc-grass-tuft", x: 813, z: 2658, rotation: 326, scaleW: 1.16, scaleD: 0.85, scaleH: 1.26 },
      { furnitureId: "proc-grass-tuft", x: 3271, z: 2548, rotation: 58, scaleW: 0.9, scaleD: 0.95, scaleH: 0.91 },
      { furnitureId: "proc-grass-tuft", x: 3607, z: 2631, rotation: 324, scaleW: 1.12, scaleD: 0.87, scaleH: 1.13 },
      { furnitureId: "proc-grass-tuft", x: 3577, z: 2570, rotation: 121, scaleW: 1.22, scaleD: 1.25, scaleH: 1.04 },
      { furnitureId: "proc-grass-tuft", x: 3751, z: 2512, rotation: 38, scaleW: 0.9, scaleD: 0.89, scaleH: 1.27 },
      { furnitureId: "proc-grass-tuft", x: 3933, z: 2554, rotation: 113, scaleW: 1.22, scaleD: 1.02, scaleH: 1.26 },
      { furnitureId: "proc-banner", x: 1000, z: 150, rotation: 0 },
      { furnitureId: "proc-banner", x: 2200, z: 150, rotation: 0 },
      { furnitureId: "proc-banner", x: 3400, z: 150, rotation: 0 },
      { furnitureId: "proc-tent", x: 1600, z: 180, rotation: 0 },
      { furnitureId: "proc-tent", x: 2800, z: 180, rotation: 0 },
      { furnitureId: "proc-tree-oak", x: 4200, z: 600, rotation: 150, scaleH: 0.92 },
      { furnitureId: "proc-tree-oak", x: 4200, z: 1200, rotation: 271, scaleH: 1.06 },
      { furnitureId: "proc-tree-oak", x: 4200, z: 1800, rotation: 136, scaleH: 0.97 },
      { furnitureId: "proc-tree-oak", x: 4200, z: 2200, rotation: 146, scaleH: 0.98 },
      { furnitureId: "proc-rock", x: 4118, z: 664, rotation: 228, scaleW: 1.22, scaleD: 1.09, scaleH: 1.19 },
      { furnitureId: "proc-rock", x: 4201, z: 844, rotation: 232, scaleW: 1.24, scaleD: 0.97, scaleH: 0.83 },
      { furnitureId: "proc-grass-tuft", x: 4164, z: 1328, rotation: 162, scaleW: 0.92, scaleD: 0.86, scaleH: 1.22 },
      { furnitureId: "proc-grass-tuft", x: 4280, z: 1788, rotation: 282, scaleW: 1.11, scaleD: 1.09, scaleH: 0.91 },
      { furnitureId: "proc-grass-tuft", x: 4252, z: 1352, rotation: 161, scaleW: 1.06, scaleD: 0.93, scaleH: 1.2 },

    ],
    },
  ],
};

const CITY_WALL_SET: ProjectTemplate = {
  id: "set-city-wall",
  name: "城墙",
  nameEn: "City Wall",
  emoji: "🏯",
  description: "城墙：城墙段+城门+旗帜，守城、攻城、城头望远的外景",
  descriptionEn: "City wall with a gate and banners — defending the city, sieges and watching from the wall",
  areaSqm: 1152,
  palette: ["#8A7A6A", "#6A5A4A", "#B03030"],
  styleTemplateId: "chinese",
  exterior: {
    preset: "modern-minimal",
    facadeSystem: "punched-window",
    roofStyle: "flat",
    floors: 1,
    hasRooftop: false,
    buildingType: "floor-plan-driven",
    groundType: "tile",
    wallColor: "#8A7A6A",
    windowFrameColor: "#2A2C30",
    entranceFrameColor: "#15171B",
    roofOverhang: 0.5,
    parapetHeight: 0.4,
    roofColor: "#6A5A4A",
    stoneBaseEnabled: false,
    showPerimeterFence: false,
    yardPreset: "minimal",
  },
  floorLayouts: [
    {
      id: "set-city-wall-f1",
      name: "城墙",
      area: 1152,
      rooms: [
        { room: "yard", x: 0, y: 0, width: 4800, depth: 2400,
          name: "城墙", nameEn: "City Wall", icon: "🏯",
          wallsHidden: ["N", "S", "E", "W"], },
      ],
    },
  ],
  yardPlan: { items: [], paths: [] },
  furnitureOverrides: [
    {
    yard: [
      { furnitureId: "proc-ground-stone", x: 2400, z: 1200, rotation: 0, scaleW: 4.6, scaleD: 2.2 },
      { furnitureId: "proc-city-wall", x: 605, z: 900, rotation: 0 },
      { furnitureId: "proc-city-wall", x: 1800, z: 900, rotation: 0 },
      { furnitureId: "proc-city-wall", x: 4297, z: 900, rotation: 0, scaleW: 0.83, scaleD: 1.0 },
      { furnitureId: "proc-rubble-pile", x: 2550, z: 920, rotation: 20 },
      { furnitureId: "proc-rubble-pile", x: 2700, z: 980, rotation: 200 },
      { furnitureId: "proc-broken-wall", x: 2620, z: 900, rotation: 0 },
      { furnitureId: "proc-city-gate", x: 3300, z: 900, rotation: 0, scaleW: 1.2, scaleD: 1.2 },
      { furnitureId: "proc-banner", x: 600, z: 900, rotation: 274, elevationY: 600 },
      { furnitureId: "proc-banner", x: 1200, z: 900, rotation: 90, elevationY: 600 },
      { furnitureId: "proc-banner", x: 1800, z: 900, rotation: 3, elevationY: 600 },
      { furnitureId: "proc-banner", x: 3900, z: 900, rotation: 95, elevationY: 600 },
      { furnitureId: "proc-banner", x: 4500, z: 900, rotation: 42, elevationY: 600 },
      { furnitureId: "proc-banner", x: 3300, z: 900, rotation: 0, elevationY: 500 },
      { furnitureId: "proc-spear", x: 900, z: 900, rotation: 291, elevationY: 600 },
      { furnitureId: "proc-spear", x: 1500, z: 900, rotation: 168, elevationY: 600 },
      { furnitureId: "proc-spear", x: 2100, z: 900, rotation: 140, elevationY: 600 },
      { furnitureId: "proc-spear", x: 3900, z: 900, rotation: 138, elevationY: 600 },
      { furnitureId: "proc-spear", x: 4200, z: 900, rotation: 357, elevationY: 600 },
      { furnitureId: "proc-spear", x: 4600, z: 900, rotation: 339, elevationY: 600 },
      { furnitureId: "proc-rock", x: 1557, z: 1502, rotation: 85, scaleW: 1.26, scaleD: 0.84, scaleH: 1.22 },
      { furnitureId: "proc-rock", x: 1280, z: 1601, rotation: 0, scaleW: 1.16, scaleD: 0.95, scaleH: 1.0 },
      { furnitureId: "proc-rock", x: 1290, z: 1463, rotation: 59, scaleW: 0.86, scaleD: 0.9, scaleH: 0.84 },
      { furnitureId: "proc-rock", x: 3287, z: 1387, rotation: 254, scaleW: 0.84, scaleD: 1.19, scaleH: 0.88 },
      { furnitureId: "proc-rock", x: 3380, z: 1748, rotation: 39, scaleW: 1.08, scaleD: 1.13, scaleH: 0.84 },
      { furnitureId: "proc-rock", x: 3191, z: 1482, rotation: 137, scaleW: 0.89, scaleD: 1.1, scaleH: 1.03 },
      { furnitureId: "proc-dead-tree", x: 1200, z: 1900, rotation: 100 },
      { furnitureId: "proc-dead-tree", x: 3600, z: 1900, rotation: 280 },
      { furnitureId: "proc-tent", x: 800, z: 400, rotation: 180 },
      { furnitureId: "proc-tent", x: 4200, z: 400, rotation: 180 },
      { furnitureId: "proc-tent", x: 1400, z: 400, rotation: 180 },
      { furnitureId: "proc-banpo-firepit", x: 4500, z: 900, rotation: 0, elevationY: 600 },
      { furnitureId: "proc-grass-tuft", x: 1206, z: 2050, rotation: 60, scaleW: 1.14, scaleD: 1.28, scaleH: 1.25 },
      { furnitureId: "proc-grass-tuft", x: 1291, z: 1790, rotation: 238, scaleW: 1.3, scaleD: 0.95, scaleH: 1.28 },
      { furnitureId: "proc-grass-tuft", x: 1170, z: 2012, rotation: 121, scaleW: 1.28, scaleD: 0.95, scaleH: 1.22 },
      { furnitureId: "proc-grass-tuft", x: 1304, z: 2285, rotation: 69, scaleW: 1.2, scaleD: 1.02, scaleH: 0.93 },
      { furnitureId: "proc-grass-tuft", x: 3247, z: 1896, rotation: 204, scaleW: 1.11, scaleD: 1.19, scaleH: 1.17 },
      { furnitureId: "proc-grass-tuft", x: 3114, z: 2042, rotation: 243, scaleW: 1.24, scaleD: 0.84, scaleH: 0.87 },
      { furnitureId: "proc-grass-tuft", x: 3529, z: 2129, rotation: 156, scaleW: 1.28, scaleD: 1.0, scaleH: 0.98 },
      { furnitureId: "proc-grass-tuft", x: 3646, z: 2248, rotation: 10, scaleW: 1.11, scaleD: 1.05, scaleH: 1.05 },
      { furnitureId: "stone-path", x: 3300, z: 2057, rotation: 180 },
      { furnitureId: "stone-path", x: 3300, z: 1771, rotation: 180 },
      { furnitureId: "stone-path", x: 3300, z: 1486, rotation: 180 },
      { furnitureId: "stone-path", x: 3300, z: 1200, rotation: 180 },
      { furnitureId: "stone-path", x: 3300, z: 914, rotation: 180 },
      { furnitureId: "stone-path", x: 3300, z: 629, rotation: 180 },
      { furnitureId: "stone-path", x: 3300, z: 343, rotation: 180 },

    ],
    },
  ],
};
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
  APARTMENT_SET,
  RURAL_HALL_SET,
  MING_HALL_SET,
  QING_SANXITANG_SET,
  TANG_PALACE_SET,
  SONG_STUDY_SET,
  SHIKUMEN_SET,
  VILLA_SUBURBAN_SET,
  SCHOOL_SET,
  HOSPITAL_SET,
  QINHAN_SET,
  WEIJIN_SET,
  YUAN_SET,
  BANPO_SET,
  HEMUDU_SET,
  RURAL_REPUBLICAN_SET,
  VERSAILLES_SET,
  WASHITSU_SET,
  HANOK_SET,
  // ── 高频日常场景（学校/家庭/公司/联想补充）──
  SCHOOL_PLAYGROUND_SET,
  SCHOOL_LIBRARY_SET,
  SCHOOL_CAFETERIA_SET,
  SCHOOL_BATHROOM_SET,
  SCHOOL_WATERROOM_SET,
  SCHOOL_PARKING_SET,
  SCHOOL_TRACK_SET,
  HOME_BEDROOM_SET,
  HOME_KITCHEN_SET,
  HOME_BATHROOM_SET,
  OFFICE_CEO_SET,
  OFFICE_MEETING_SET,
  OFFICE_LOBBY_SET,
  OFFICE_PANTRY_SET,
  OFFICE_ELEVATOR_SET,
  DORMITORY_SET,
  HOTEL_ROOM_SET,
  POLICE_SET,
  COURTROOM_SET,
  BAR_SET,
  GYM_SET,
  SUPERMARKET_SET,
  KTV_SET,
  WEDDING_SET,
  // ── 繁荣/衰败成对场景（第 5 批；11 对 = 22 个片场）──
  TANG_CHANGAN_PROSPEROUS_SET,
  TANG_CHANGAN_RUINED_SET,
  SONG_BIANJING_PROSPEROUS_SET,
  SONG_BIANJING_RUINED_SET,
  QING_GARDEN_PROSPEROUS_SET,
  QING_GARDEN_RUINED_SET,
  MING_PALACE_PROSPEROUS_SET,
  MING_PALACE_RUINED_SET,
  ROME_PROSPEROUS_SET,
  ROME_RUINED_SET,
  POMPEII_PROSPEROUS_SET,
  POMPEII_RUINED_SET,
  LOULAN_PROSPEROUS_SET,
  LOULAN_RUINED_SET,
  MALL_PROSPEROUS_SET,
  MALL_RUINED_SET,
  MANSION_PROSPEROUS_SET,
  MANSION_RUINED_SET,
  SCHOOL_PROSPEROUS_SET,
  SCHOOL_ABANDONED_SET,
  VILLAGE_PROSPEROUS_SET,
  VILLAGE_HOLLOW_SET,
  // ── 室外片场（26）──
  FOREST_SET,
  BAMBOO_SET,
  GRASSLAND_SET,
  DESERT_SET,
  MOUNTAIN_SET,
  CLIFF_SET,
  WATERFALL_SET,
  LAKE_SET,
  BEACH_SET,
  SNOW_SET,
  FLOWER_FIELD_SET,
  PEACH_SET,
  GARDEN_SET,
  TEA_SET,
  RICE_FIELD_SET,
  HORSE_RANCH_SET,
  FARM_SET,
  STREET_SET,
  PARK_SET,
  BRIDGE_SET,
  STATION_SET,
  ANCIENT_STREET_SET,
  MARKET_SET,
  BATTLEFIELD_SET,
  MILITARY_CAMP_SET,
  CITY_WALL_SET,
];
