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

import type { ExteriorSettings, YardPlan } from "./types";
import type { FloorplanLayout } from "./floorplanLayouts";

export interface ProjectTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  /** cm² shown in the picker */
  areaSqm: number;
  /** preview palette: [wallColor, roofColor, accentColor] */
  palette: [string, string, string];
  exterior: Partial<ExteriorSettings>;
  /** One entry per floor. Index 0 = ground floor. */
  floorLayouts: FloorplanLayout[];
  /** Yard plan applied to floor 0. */
  yardPlan: YardPlan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 1 — 现代泳池别墅 (Modern Pool Villa) · 2F · 230㎡
// Wide white stucco / flat roof / pool garden
// ─────────────────────────────────────────────────────────────────────────────
const MODERN_POOL_VILLA: ProjectTemplate = {
  id: "modern-pool-villa",
  name: "现代泳池别墅",
  emoji: "🏊",
  description: "双层 · 平屋顶 · 泳池庭院 · 木格栅立面",
  areaSqm: 230,
  palette: ["#F5F2EC", "#2A2A2A", "#8A6040"],

  exterior: {
    preset: "contemporary",
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
      { id: "vt-cyp1",     kind: "tree.cypress", x: -600, z:  880, rot: 0, scale: 1.0 },
      { id: "vt-cyp2",     kind: "tree.cypress", x:    0, z:  900, rot: 0, scale: 1.0 },
      { id: "vt-cyp3",     kind: "tree.cypress", x:  600, z:  880, rot: 0, scale: 1.0 },

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
  emoji: "⛩️",
  description: "双层 · 中式飞檐 · 枯山水 · 竹林围合",
  areaSqm: 180,
  palette: ["#F0EDE8", "#181818", "#5A4030"],

  exterior: {
    preset: "japanese",
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
      { id: "jz-bonsai1", kind: "tree.bonsai", x:  200, z: -600, rot: 0, scale: 1.1 },
      { id: "jz-bonsai2", kind: "tree.bonsai", x: -200, z: -620, rot: 0.3, scale: 1.0 },
      { id: "jz-bonsai3", kind: "tree.bonsai", x:  400, z: -200, rot: 0, scale: 0.9 },

      // Maple trees (seasonal colour)
      { id: "jz-maple1", kind: "tree.maple",   x: -900, z: -200, rot: 0, scale: 1.0 },
      { id: "jz-maple2", kind: "tree.maple",   x:  900, z:  200, rot: 0, scale: 1.0 },

      // Pine trees (perimeter)
      { id: "jz-pine1",  kind: "tree.pine",    x: -900, z:  600, rot: 0, scale: 1.2 },
      { id: "jz-pine2",  kind: "tree.pine",    x:  900, z:  600, rot: 0, scale: 1.2 },
      { id: "jz-pine3",  kind: "tree.pine",    x:    0, z:  950, rot: 0, scale: 1.3 },

      // Bamboo-style cypresses (side screen)
      { id: "jz-cyp1",   kind: "tree.cypress", x: -1050, z:   0, rot: 0, scale: 1.1 },
      { id: "jz-cyp2",   kind: "tree.cypress", x: -1050, z: 300, rot: 0, scale: 1.1 },
      { id: "jz-cyp3",   kind: "tree.cypress", x: -1050, z:-300, rot: 0, scale: 1.1 },

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
  emoji: "🏛️",
  description: "双层 · 四坡顶 · 内庭院 · 橙树花园",
  areaSqm: 200,
  palette: ["#FFF8E8", "#B83820", "#9B6B3A"],

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
      { id: "med-cyp1", kind: "tree.cypress", x: -150, z: -900, rot: 0, scale: 1.2 },
      { id: "med-cyp2", kind: "tree.cypress", x:  150, z: -900, rot: 0, scale: 1.2 },
      { id: "med-cyp3", kind: "tree.cypress", x: -1000, z:  -50, rot: 0, scale: 1.1 },
      { id: "med-cyp4", kind: "tree.cypress", x:  1000, z:  -50, rot: 0, scale: 1.1 },

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
  emoji: "🏢",
  description: "双层 · 平屋顶 · 全玻璃幕墙 · 泳池+棕榈庭院",
  areaSqm: 280,
  palette: ["#F2EFE8", "#1A1A1A", "#CBE8F5"],

  exterior: {
    preset:       "modern",
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
      { id: "gcv-cyp1",    kind: "tree.cypress", x: -900, z:  900, rot: 0, scale: 1.3 },
      { id: "gcv-cyp2",    kind: "tree.cypress", x:    0, z: 1000, rot: 0, scale: 1.3 },
      { id: "gcv-cyp3",    kind: "tree.cypress", x:  900, z:  900, rot: 0, scale: 1.2 },
      { id: "gcv-cyp4",    kind: "tree.cypress", x: -1500, z: -400, rot: 0, scale: 1.1 },

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
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  GLASS_CURTAIN_VILLA,     // ← 参考图风格，排第一
  MODERN_POOL_VILLA,
  JAPANESE_ZEN_VILLA,
  MEDITERRANEAN_VILLA,
];
