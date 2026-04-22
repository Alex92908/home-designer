/**
 * Desk Scene Store
 * ----------------
 * Minimal zustand store for the desk-setup scene. Keeps placed items,
 * environment choice, and selection. Intentionally separate from the
 * home-designer (room) store so pivoting or running side-by-side is clean.
 */

import { create } from "zustand";
import type { CatalogItem } from "./catalog";
import { getCatalogItem } from "./catalog";

export type EnvPreset =
  | "studio"      // bright neutral (default)
  | "warehouse"   // moody, industrial
  | "sunset"      // warm amber
  | "dawn"        // cool blue hour
  | "city"        // cyberpunk neon
  | "apartment";  // soft indoor

export interface PlacedItem {
  /** unique instance id */
  id: string;
  /** catalog id (→ geometry, material, size) */
  catalogId: string;
  /** world position, meters (scene uses m, catalog uses cm internally) */
  position: [number, number, number];
  /** rotation around Y axis, radians */
  rotY: number;
  /** optional per-instance color tint for emissive/accent */
  accentColor?: string;
}

interface DeskStore {
  env: EnvPreset;
  items: PlacedItem[];
  selectedId: string | null;

  setEnv: (e: EnvPreset) => void;
  addItem: (catalogId: string) => string;
  removeItem: (id: string) => void;
  moveItem: (id: string, position: [number, number, number]) => void;
  rotateItem: (id: string, rotY: number) => void;
  select: (id: string | null) => void;
  clearAll: () => void;
  loadPreset: (items: PlacedItem[]) => void;
}

// ── Placement heuristic ────────────────────────────────
// When user adds an item from the catalog, put it in a sensible spot based
// on category. Floor-standing items (desk, chair, pc) sit on y=0. Monitors,
// keyboards, mice, lamps, decor sit on the desk top (≈0.74m). Items also
// spread along X so they don't stack on top of each other on add.
function initialPlacement(cat: CatalogItem, existingCount: number): {
  position: [number, number, number]; rotY: number;
} {
  const floorItems = new Set(["desk", "chair", "pc"]);
  const onFloor    = floorItems.has(cat.category);
  const y          = onFloor ? 0 : 0.74; // desk top height (m)

  // Fan out along X so new items don't overlap
  const xOffset    = (existingCount % 5 - 2) * 0.35;

  if (cat.category === "chair") {
    // Chair sits in front of desk, facing +Z (toward viewer)
    return { position: [0, 0, 0.8], rotY: 0 };
  }
  if (cat.category === "desk") {
    return { position: [0, 0, 0], rotY: 0 };
  }
  if (cat.category === "pc") {
    // Tower on the floor to the side
    return { position: [-0.9, 0, 0], rotY: 0 };
  }
  if (cat.category === "monitor") {
    // Centered on desk, slightly lifted (stand height baked into geometry)
    return { position: [xOffset, y + (cat.size[2] / 100) / 2 + 0.12, -0.15], rotY: 0 };
  }
  if (cat.category === "keyboard" || cat.category === "mouse") {
    const zOffset = cat.category === "mouse" ? 0.05 : 0;
    const xKb     = cat.category === "mouse" ? 0.25 : -0.05;
    return { position: [xKb + xOffset * 0.2, y + (cat.size[2] / 100) / 2, 0.15 + zOffset], rotY: 0 };
  }
  if (cat.category === "lamp") {
    return { position: [-0.55 + xOffset * 0.3, y + (cat.size[2] / 100) / 2, -0.25], rotY: 0 };
  }
  // decor: scatter on desk
  return { position: [0.55 + xOffset * 0.3, y + (cat.size[2] / 100) / 2, -0.1], rotY: 0 };
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useDeskStore = create<DeskStore>((set, get) => ({
  env: "studio",
  items: [],
  selectedId: null,

  setEnv: (e) => set({ env: e }),

  addItem: (catalogId) => {
    const cat = getCatalogItem(catalogId);
    if (!cat) return "";
    const existing = get().items.filter(i => {
      const c = getCatalogItem(i.catalogId);
      return c?.category === cat.category;
    }).length;
    const { position, rotY } = initialPlacement(cat, existing);
    const id = genId();
    set(s => ({ items: [...s.items, { id, catalogId, position, rotY }], selectedId: id }));
    return id;
  },

  removeItem: (id) => set(s => ({
    items: s.items.filter(i => i.id !== id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  })),

  moveItem: (id, position) => set(s => ({
    items: s.items.map(i => i.id === id ? { ...i, position } : i),
  })),

  rotateItem: (id, rotY) => set(s => ({
    items: s.items.map(i => i.id === id ? { ...i, rotY } : i),
  })),

  select: (id) => set({ selectedId: id }),

  clearAll: () => set({ items: [], selectedId: null }),

  loadPreset: (items) => set({ items, selectedId: null }),
}));

// ── Curated starter templates ───────────────────────────
// Seed users into an already-nice-looking setup on first load, then let
// them remix. Each preset is a small list of PlacedItems.
export const STARTER_PRESETS: { id: string; name: string; env: EnvPreset; items: PlacedItem[] }[] = [
  {
    id:   "tpl-minimal",
    name: "极简白 · Mac 美学",
    env:  "studio",
    items: [
      { id: "a", catalogId: "desk-white-120",    position: [0, 0, 0],       rotY: 0 },
      { id: "b", catalogId: "mon-27-imac",       position: [0, 1.06, -0.15], rotY: 0 },
      { id: "c", catalogId: "kb-magic",          position: [0, 0.755, 0.15], rotY: 0 },
      { id: "d", catalogId: "mouse-magic",       position: [0.22, 0.755, 0.17], rotY: 0 },
      { id: "e", catalogId: "chair-leather",     position: [0, 0, 0.85], rotY: 0 },
      { id: "f", catalogId: "lamp-desk-arm",     position: [-0.5, 1.01, -0.25], rotY: 0.3 },
      { id: "g", catalogId: "decor-plant",       position: [0.55, 0.865, -0.2], rotY: 0 },
      { id: "h", catalogId: "pc-mac-studio",     position: [-0.48, 0.79, -0.25], rotY: 0 },
    ],
  },
  {
    id:   "tpl-cyber",
    name: "赛博夜色 · RGB",
    env:  "city",
    items: [
      { id: "a", catalogId: "desk-black-160",   position: [0, 0, 0], rotY: 0 },
      { id: "b", catalogId: "mon-32-uw",        position: [0, 1.04, -0.2], rotY: 0 },
      { id: "c", catalogId: "kb-mech-tkl",      position: [0, 0.755, 0.1],  rotY: 0 },
      { id: "d", catalogId: "mouse-game",       position: [0.25, 0.76, 0.15], rotY: 0 },
      { id: "e", catalogId: "chair-gaming",     position: [0, 0, 0.85], rotY: 0 },
      { id: "f", catalogId: "lamp-rgb-bar",     position: [0, 1.24, -0.22], rotY: 0 },
      { id: "g", catalogId: "pc-tower-black",   position: [-0.9, 0, 0], rotY: 0 },
    ],
  },
  {
    id:   "tpl-warm",
    name: "温暖木质 · 阅读氛围",
    env:  "sunset",
    items: [
      { id: "a", catalogId: "desk-walnut-160",   position: [0, 0, 0], rotY: 0 },
      { id: "b", catalogId: "mon-27-4k",         position: [0, 1.08, -0.15], rotY: 0 },
      { id: "c", catalogId: "kb-mech-60",        position: [0, 0.755, 0.15], rotY: 0 },
      { id: "d", catalogId: "mouse-magic",       position: [0.24, 0.755, 0.17], rotY: 0 },
      { id: "e", catalogId: "chair-herman",      position: [0, 0, 0.85], rotY: 0 },
      { id: "f", catalogId: "lamp-glow",         position: [-0.5, 0.94, -0.25], rotY: 0 },
      { id: "g", catalogId: "decor-plant",       position: [0.55, 0.865, -0.15], rotY: 0 },
      { id: "h", catalogId: "decor-book",        position: [-0.4, 0.78, 0.15], rotY: 0.2 },
      { id: "i", catalogId: "decor-speaker",     position: [0.5, 0.83, 0.2], rotY: -0.3 },
    ],
  },
];
