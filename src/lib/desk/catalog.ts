/**
 * Desk Setup Catalog
 * ------------------
 * A small, curated catalog of desk-setup items. Every item is built from
 * procedural primitives (no external 3D assets yet) + PBR materials, so the
 * "Buildcores-style" visual lift comes from lighting + materials, not model
 * quality. When we later wire in glTF assets (Sketchfab / Kitbash3D), each
 * entry here will get a `modelUrl` field and the DeskItem renderer will
 * dispatch accordingly.
 *
 * Design intent:
 *  - 8 categories, ≤5 items each → total ≤40 items → quality > quantity
 *  - Each item gets canonical dimensions (cm) so placement feels physical
 *  - `material` describes the PBR intent so the renderer can pick the right
 *    shader (wood / metal / plastic / emissive / glass)
 */

export type DeskCategory =
  | "desk"      // 桌面
  | "monitor"   // 显示器
  | "chair"     // 椅子
  | "lamp"      // 灯具
  | "keyboard"  // 键盘
  | "mouse"     // 鼠标
  | "pc"        // 主机
  | "decor";    // 摆件

export type PBRMaterial =
  | "wood-oak"
  | "wood-walnut"
  | "metal-black"
  | "metal-silver"
  | "plastic-white"
  | "plastic-black"
  | "glass"
  | "screen-dark"    // display panel (slight emissive)
  | "screen-bright"  // brighter display
  | "leather-black"
  | "fabric-gray"
  | "rgb-strip";     // emissive colored

export interface CatalogItem {
  id: string;
  category: DeskCategory;
  name: string;        // 显示名
  nameEn?: string;     // English name (used for affiliate SEO later)
  /** canonical dimensions in cm (w × d × h) */
  size: [number, number, number];
  /** Primary material (renderer dispatches on this) */
  material: PBRMaterial;
  /** Optional secondary material (e.g. chair legs, monitor stand) */
  accent?: PBRMaterial;
  /** Short vibe tag set, used for filtering + seeding gallery templates */
  tags?: string[];
  /** Future: Taobao / Amazon affiliate SKU */
  sku?: { platform: "taobao" | "amazon" | "jd"; url: string }[];
}

export const DESK_CATALOG: CatalogItem[] = [
  // ─── Desks ──────────────────────────────────────────────
  { id: "desk-oak-140",   category: "desk", name: "橡木桌 140cm",  size: [140, 60, 74], material: "wood-oak",    accent: "metal-black", tags: ["minimal", "warm"] },
  { id: "desk-walnut-160", category: "desk", name: "胡桃木桌 160cm", size: [160, 70, 74], material: "wood-walnut", accent: "metal-black", tags: ["warm", "premium"] },
  { id: "desk-white-120", category: "desk", name: "白色极简桌 120cm", size: [120, 60, 74], material: "plastic-white", accent: "metal-silver", tags: ["minimal", "mac"] },
  { id: "desk-black-160", category: "desk", name: "黑色工业桌 160cm", size: [160, 70, 74], material: "metal-black",  accent: "metal-black", tags: ["dark", "cyber"] },

  // ─── Monitors ───────────────────────────────────────────
  { id: "mon-27-4k",  category: "monitor", name: "27吋 4K 显示器",  size: [62, 5, 42], material: "screen-dark", accent: "plastic-black", tags: ["standard"] },
  { id: "mon-32-uw",  category: "monitor", name: "32吋 超宽显示器",  size: [82, 5, 38], material: "screen-dark", accent: "plastic-black", tags: ["productivity", "cyber"] },
  { id: "mon-27-imac", category: "monitor", name: "Studio Display", size: [62, 4, 42], material: "screen-bright", accent: "metal-silver", tags: ["mac", "minimal"] },
  { id: "mon-24-alt", category: "monitor", name: "副屏 24吋",        size: [54, 5, 35], material: "screen-dark", accent: "plastic-black", tags: ["dual"] },

  // ─── Chairs ─────────────────────────────────────────────
  { id: "chair-herman", category: "chair", name: "人体工学椅",     size: [65, 65, 115], material: "fabric-gray",    accent: "metal-black",  tags: ["ergo"] },
  { id: "chair-leather", category: "chair", name: "真皮办公椅",    size: [62, 62, 110], material: "leather-black",  accent: "metal-silver", tags: ["premium"] },
  { id: "chair-gaming",  category: "chair", name: "赛车电竞椅",    size: [68, 68, 130], material: "leather-black",  accent: "metal-black",  tags: ["cyber", "game"] },

  // ─── Lamps ──────────────────────────────────────────────
  { id: "lamp-desk-arm", category: "lamp", name: "长臂工作灯",   size: [15, 15, 55], material: "metal-black",  accent: "plastic-white", tags: ["minimal"] },
  { id: "lamp-glow",     category: "lamp", name: "氛围台灯",     size: [20, 20, 40], material: "plastic-white", accent: "rgb-strip",    tags: ["warm"] },
  { id: "lamp-rgb-bar",  category: "lamp", name: "显示器 RGB 灯", size: [55, 3, 3],   material: "rgb-strip",    accent: "metal-black",  tags: ["cyber", "rgb"] },

  // ─── Keyboards ──────────────────────────────────────────
  { id: "kb-mech-60",   category: "keyboard", name: "60% 机械键盘", size: [30, 10, 3], material: "plastic-black", accent: "plastic-white", tags: ["minimal", "game"] },
  { id: "kb-mech-tkl",  category: "keyboard", name: "TKL 机械键盘", size: [36, 13, 3], material: "plastic-black", accent: "rgb-strip",     tags: ["cyber", "rgb"] },
  { id: "kb-magic",     category: "keyboard", name: "Magic Keyboard", size: [28, 11, 1], material: "metal-silver", accent: "plastic-white", tags: ["mac", "minimal"] },

  // ─── Mouse ──────────────────────────────────────────────
  { id: "mouse-game",  category: "mouse", name: "电竞鼠标",    size: [7, 12, 4], material: "plastic-black", accent: "rgb-strip",    tags: ["game"] },
  { id: "mouse-magic", category: "mouse", name: "Magic Mouse", size: [6, 11, 2], material: "plastic-white", accent: "plastic-white", tags: ["mac", "minimal"] },

  // ─── PCs ────────────────────────────────────────────────
  { id: "pc-tower-black", category: "pc", name: "黑色机箱",  size: [22, 45, 48], material: "metal-black",   accent: "glass",     tags: ["game", "cyber"] },
  { id: "pc-tower-white", category: "pc", name: "白色机箱",  size: [22, 45, 48], material: "plastic-white", accent: "glass",     tags: ["clean", "minimal"] },
  { id: "pc-mac-studio",  category: "pc", name: "Mac Studio", size: [20, 20, 10], material: "metal-silver", accent: "metal-silver", tags: ["mac", "minimal"] },

  // ─── Decor ──────────────────────────────────────────────
  { id: "decor-plant",   category: "decor", name: "小盆栽",    size: [15, 15, 25], material: "plastic-white", accent: "plastic-white", tags: ["warm", "minimal"] },
  { id: "decor-speaker", category: "decor", name: "桌面音箱",  size: [12, 12, 18], material: "wood-walnut",   accent: "fabric-gray",   tags: ["warm", "premium"] },
  { id: "decor-book",    category: "decor", name: "书本堆",    size: [20, 18, 8],  material: "wood-oak",      accent: "wood-walnut",   tags: ["warm"] },
];

export const CATEGORY_META: Record<DeskCategory, { label: string; icon: string; order: number }> = {
  desk:     { label: "桌子",   icon: "▭",  order: 0 },
  monitor:  { label: "显示器", icon: "▯",  order: 1 },
  chair:    { label: "椅子",   icon: "◈",  order: 2 },
  pc:       { label: "主机",   icon: "▮",  order: 3 },
  keyboard: { label: "键盘",   icon: "⌨",  order: 4 },
  mouse:    { label: "鼠标",   icon: "○",  order: 5 },
  lamp:     { label: "灯具",   icon: "✦",  order: 6 },
  decor:    { label: "摆件",   icon: "✿",  order: 7 },
};

export function getCatalogItem(id: string): CatalogItem | undefined {
  return DESK_CATALOG.find(i => i.id === id);
}

export function getByCategory(cat: DeskCategory): CatalogItem[] {
  return DESK_CATALOG.filter(i => i.category === cat);
}
