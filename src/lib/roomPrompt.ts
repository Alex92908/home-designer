/**
 * roomPrompt.ts
 * Converts home-designer JSON room data → Stable Diffusion / ComfyUI prompts
 *
 * Pipeline (2026-04 refresh):
 *   1. Enrich each placed item with library dimensions + room-type whitelist
 *   2. De-duplicate by furnitureId, annotate oversize/compact/stretched scale
 *   3. Rank items by relevance: whitelist match > off-room > extreme scale
 *   4. Token-budget truncate positive prompt to fit CLIP 75-token window
 *   5. Window h/sill aware lighting note
 */

import type { RoomType } from "./types";
import { FURNITURE } from "./furniture";

// Fast lookup by id
const FURNITURE_BY_ID = new Map(FURNITURE.map(f => [f.id, f]));

// ─── Furniture ID → English description ─────────────────────
const FURNITURE_EN: Record<string, string> = {
  // Sofa & Lounge
  "sofa-fabric-gray":       "grey fabric three-seater sofa",
  "sofa-leather-brown":     "brown leather L-shaped sofa",
  "sofa-nordic-blue":       "blue velvet Nordic sofa",
  "sofa-japanese":          "low Japanese floor sofa, legless",
  "sofa-modular-green":     "modular green corner sofa",
  // Coffee tables
  "coffee-oak-round":       "round oak coffee table",
  "coffee-marble-rect":     "rectangular marble coffee table with metal legs",
  "coffee-glass-black":     "black metal frame glass coffee table",
  // TV units
  "tvunit-float-white":     "floating white TV unit with wall-mounted flat screen TV",
  "tvunit-walnut":          "solid walnut TV console with wall-mounted flat screen TV",
  "tvunit-black-stone":     "black sintered stone TV unit with wall-mounted flat screen TV",
  // Lamps
  "lamp-arc-gold":          "gold arc floor lamp",
  "lamp-industrial-black":  "black industrial iron floor lamp",
  // Bookshelves
  "bookshelf-open-white":   "white open five-shelf bookcase",
  "bookshelf-solid-walnut": "solid walnut bookshelf",
  // Sideboards
  "sideboard-walnut":       "walnut entryway sideboard",
  "sideboard-modern-black": "black metal modern side table",
  // Plants
  "plant-monstera":         "large monstera deliciosa plant",
  "plant-sansevieria":      "sansevieria snake plant",
  "plant-rubber-tree":      "rubber tree plant",
  "plant-balcony-pot":      "long balcony planter with greenery",
  // Rugs
  "rug-nordic-geo":         "geometric cotton-linen Nordic rug",
  "rug-modern-gray":        "solid grey short-pile area rug",
  "rug-persian":            "Persian-style patterned rug",
  // Artwork — explicit "mounted on wall" anchor so Canny edges get a wall context
  "artwork-abstract":       "abstract textured wall art print mounted on wall",
  "artwork-inkwash":        "Chinese ink wash landscape painting mounted on wall",
  // Beds
  "bed-fabric-beige":       "beige upholstered fabric bed with padded headboard",
  "bed-leather-dark":       "dark brown leather platform bed",
  "bed-wood-nordic":        "Nordic white oak bed frame",
  "bed-tatami":             "low tatami platform bed",
  "bed-single-white":       "white single bed",
  // Nightstands
  "nightstand-white":       "white modern bedside table with drawer",
  "nightstand-oak":         "solid oak bedside table",
  // Wardrobes
  "wardrobe-slide-white":   "white sliding door wardrobe",
  "wardrobe-solid-walnut":  "solid walnut hinged door wardrobe",
  "wardrobe-open-rack":     "industrial open clothes rack",
  // Dressers
  "dresser-nordic-white":   "white Nordic dressing table with mirror",
  "closet-system-white":    "custom white built-in closet storage system",
  "closet-island-white":    "white closet center island cabinet",
  // Dining
  "dining-marble-round":    "round marble dining table",
  "dining-oak-rect":        "rectangular oak dining table",
  "dining-black-metal":     "black sintered stone dining table with metal legs",
  "chair-nordic-oak":       "Nordic solid oak dining chair",
  "chair-modern-gray":      "modern grey upholstered dining chair",
  "chair-industrial-black": "black metal industrial dining chair",
  // Kitchen
  "cabinet-lower-white":    "white lower kitchen cabinet with quartz countertop",
  "cabinet-lower-gray":     "matte grey lower kitchen cabinet",
  "cabinet-upper-white":    "white upper wall cabinet",
  "fridge-french-door":     "French door stainless steel refrigerator",
  "fridge-single-white":    "white single-door refrigerator",
  "hood-side-black":        "black side-draft range hood",
  "sink-double-steel":      "double basin stainless steel kitchen sink",
  // Bathroom
  "toilet-smart":           "smart toilet with integrated bidet",
  "toilet-standard":        "standard white siphon toilet",
  "toilet-wallhung":        "wall-hung floating toilet",
  "bathtub-freestanding":   "freestanding cast iron soaking bathtub",
  "bathtub-builtin":        "built-in alcove bathtub",
  "shower-enclosed":        "frameless glass enclosed shower",
  "shower-walkin":          "open walk-in shower with glass panel",
  "vanity-single-white":    "white single-basin bathroom vanity",
  "vanity-double-marble":   "double-basin marble-top bathroom vanity",
  // Study
  "desk-nordic-oak":        "simple oak wood writing desk",
  "desk-l-shape-white":     "white L-shaped corner desk",
  "desk-standing":          "electric height-adjustable standing desk",
  "chair-ergonomic":        "ergonomic office chair with lumbar support",
  "chair-simple-fabric":    "simple fabric task chair",
  // Outdoor / misc
  "pet-dog":                "dog",
  "pet-cat":                "cat",
};

// Fallback: parse ID into readable English ("bed-single-white" → "white single bed")
function parseFurnitureId(id: string): string {
  const known = FURNITURE_EN[id];
  if (known) return known;
  // Simple heuristic: split on "-", drop trailing numbers, reverse adjectives
  const parts = id.replace(/-\d+$/, "").split("-");
  return parts.join(" ");
}

// ─── Material ID → English description ──────────────────────
const MATERIAL_EN: Record<string, { wall?: string; floor?: string; light?: string }> = {
  // Wall materials
  "wall-white":       { wall: "matte white painted walls" },
  "wall-gray":        { wall: "medium grey matte painted walls" },
  "wall-beige":       { wall: "warm beige painted walls" },
  "wall-green":       { wall: "sage green painted walls" },
  "wall-tile-metro":  { wall: "white subway tile walls" },
  "wall-tile-marble": { wall: "marble tile walls" },
  "wall-wood":        { wall: "natural wood panel walls" },
  "wall-concrete":    { wall: "raw concrete walls" },
  "wall-wallpaper-floral": { wall: "floral wallpaper walls" },
  "wall-wallpaper-geo":    { wall: "geometric pattern wallpaper" },
  // Floor materials
  "floor-oak":          { floor: "warm oak wood flooring" },
  "floor-walnut":       { floor: "dark walnut hardwood flooring" },
  "floor-light-wood":   { floor: "light wood flooring" },
  "floor-concrete":     { floor: "concrete grey floor tiles" },
  "floor-tile-white":   { floor: "large format white porcelain tiles" },
  "floor-black-tile":   { floor: "matte black porcelain floor tiles" },
  "floor-marble":       { floor: "white marble floor tiles" },
  "floor-herringbone":  { floor: "herringbone wood parquet flooring" },
  "floor-terrazzo":     { floor: "terrazzo floor tiles" },
  // Lighting — explicit mounting + visual cues so SD renders the fixture even
  // when depth map flattens ceiling-mounted hardware against the plane.
  "light-chandelier":      { light: "elegant crystal chandelier hanging from ceiling, warm glow" },
  "light-pendant-nordic":  { light: "Nordic minimal pendant light hanging from ceiling, diffused warm light" },
  "light-spot":            { light: "ceiling-mounted black track rail with three adjustable spotlights, no main pendant, atmospheric accent lighting" },
  "light-recessed":        { light: "flush recessed downlights in ceiling, clean unobstructed ceiling, warm white" },
  "light-japanese-paper":  { light: "washi paper pendant lamp hanging from ceiling, soft diffused warm light" },
  "light-strip":           { light: "LED strip cove lighting around ceiling perimeter, indirect ambient glow" },
  "light-industrial":      { light: "industrial bare-bulb Edison pendant lights hanging from ceiling, warm glow" },
};

function materialIdToDesc(id: string, category: "wall" | "floor" | "light"): string | null {
  return MATERIAL_EN[id]?.[category] ?? null;
}

// Strip any remaining non-ASCII (Chinese) characters from a string
function ensureEnglish(str: string): string {
  // Remove CJK unicode range and fullwidth punctuation, trim commas/spaces
  return str
    .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, "")
    .replace(/，/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

// ─── Hex → English color name ─────────────────────────────
function hexToColorName(hex: string): string {
  const map: [string, string][] = [
    ["#FFFFFF", "pure white"], ["#F5F5F5", "off-white"], ["#FAFAFA", "bright white"],
    ["#F5F5F0", "warm white"], ["#EDE8E0", "warm cream"], ["#F0EDE8", "creamy white"],
    ["#F2EEE6", "light beige"], ["#D4C0A0", "warm tan"],
    ["#C8A882", "warm oak"],   ["#C8B890", "light wood"],  ["#B89060", "medium oak"],
    ["#9E9E9E", "medium grey"],["#888888", "concrete grey"],["#C0C0C0", "light silver"],
    ["#DCDCDC", "light grey"], ["#E8E8E8", "pale grey"],
    ["#2A2A2A", "near-black"], ["#1A1A2E", "deep charcoal navy"],
    ["#3A3A3A", "dark charcoal"],["#4A4A4A", "dark grey"],
    ["#5B7FA6", "slate blue"], ["#6B8E60", "sage green"], ["#7CAF5A", "lawn green"],
    ["#FFD700", "warm golden"],
  ];
  const upper = hex.toUpperCase();
  let best = "neutral"; let bestDist = 999999;
  const r0 = parseInt(upper.slice(1, 3), 16);
  const g0 = parseInt(upper.slice(3, 5), 16);
  const b0 = parseInt(upper.slice(5, 7), 16);
  for (const [h, name] of map) {
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    const d = (r - r0) ** 2 + (g - g0) ** 2 + (b - b0) ** 2;
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

// ─── Style tags → English style phrase ──────────────────────
const STYLE_EN: Record<string, string> = {
  "现代":  "modern contemporary",
  "北欧":  "Scandinavian Nordic minimalist",
  "轻奢":  "modern light luxury",
  "日式":  "Japanese wabi-sabi zen",
  "工业风": "industrial loft",
  "中式":  "classic Chinese traditional",
};

// Style-specific atmosphere/mood — appended after main description.
// Kept tight (~10 tokens) to leave room for furniture list in the prompt budget.
const STYLE_MOOD: Record<string, string> = {
  "现代":  "bright airy minimal mood, clean lines",
  "北欧":  "Scandinavian hygge mood, cozy diffused light",
  "轻奢":  "light luxury mood, sophisticated elegance, premium finishes",
  "日式":  "zen wabi-sabi mood, soft natural light, serene",
  "工业风": "dark moody industrial loft, dramatic shadows, urban grit",
  "中式":  "classic Chinese elegance, warm amber light",
};

// Per-style extra negative terms to exclude conflicting aesthetics
const STYLE_NEGATIVES: Record<string, string> = {
  "现代":  "ornate, baroque, rustic, heavy wood",
  "北欧":  "ornate, baroque, industrial, dark colors, heavy drapes",
  "轻奢":  "ikea, plastic, budget furniture, clutter, cartoon",
  "日式":  "western sofa, heavy curtains, bright colors, ornate decoration",
  "工业风": "scandinavian nordic, plants, monstera, wooden legs, rattan, wicker, bohemian, bright cheerful pastel",
  "中式":  "western contemporary, industrial, scandinavian, minimalist",
};

function stylesToEnglish(tags: string[]): string {
  return tags
    .map(t => STYLE_EN[t] ?? t)
    .join(", ") || "modern";
}

// Infer dominant style from material IDs + furniture IDs when no explicit tag is set
function inferStyleFromRoom(
  materials: RoomPromptInput["materials"],
  items: RoomPromptInput["placedItems"]
): string {
  const matStr = Object.values(materials)
    .map(m => (m as { id?: string } | undefined)?.id ?? "")
    .join(" ");
  const furStr = items.map(i => i.furnitureId).join(" ");
  const combined = `${matStr} ${furStr}`.toLowerCase();

  if (/japanese|tatami|washi/.test(combined))   return "日式";
  if (/nordic|scandinavian/.test(combined))      return "北欧";
  if (/industrial|concrete.*wall|wall.*concrete/.test(combined)) return "工业风";
  if (/marble|leather.*dark|stone|gold/.test(combined))          return "轻奢";
  return "现代";
}

// ─── Room type → English room name ──────────────────────────
const ROOM_TYPE_EN: Record<string, string> = {
  living:   "living room",
  master:   "master bedroom",
  bedroom:  "bedroom",
  bedroom2: "bedroom",
  bedroom3: "bedroom",
  kitchen:  "kitchen",
  bathroom: "bathroom",
  bathroom2:"bathroom",
  dining:   "dining room",
  study:    "study / home office",
  study2:   "study",
  closet:   "walk-in closet",
  balcony:  "balcony",
  balcony2: "balcony",
  yard:     "garden yard",
  garage:   "garage",
  gym:      "home gym",
  cinema:   "home cinema",
};

// ─── Position hint ───────────────────────────────────────────
function posHint(x: number, z: number, roomW: number, roomD: number): string {
  const hx = x / roomW;
  const hz = z / roomD;
  const h = hx < 0.33 ? "left" : hx < 0.67 ? "center" : "right";
  const v = hz < 0.33 ? "back" : hz < 0.67 ? "middle" : "front";
  if (h === "center" && v === "middle") return "centered";
  if (v === "back")  return `along back wall (${h})`;
  if (v === "front") return `near front (${h})`;
  return `${h} side`;
}

// ─── Main prompt generator ────────────────────────────────────

export interface RoomPromptInput {
  roomType: RoomType;
  roomName?: string;
  width: number;   // cm
  depth: number;   // cm
  height?: number; // cm
  materials: {
    wall?:    { id?: string; color: string; description?: string; name?: string };
    floor?:   { id?: string; color: string; description?: string; name?: string };
    ceiling?: { id?: string; color: string; description?: string };
    light?:   { id?: string; description?: string; name?: string; color?: string };
    tile?:    { id?: string; color: string; description?: string };
  };
  placedItems: Array<{
    furnitureId: string;
    x: number;
    z: number;
    rotation?: number;
    scaleW?: number; // width scale multiplier (default 1)
    scaleD?: number; // depth scale multiplier (default 1)
    scaleH?: number; // height scale multiplier (default 1)
  }>;
  windows?: Array<{ wall: string; len: number; pos: number; h?: number; sill?: number }>;
}

export interface GeneratedPrompt {
  roomType: string;
  roomName: string;
  positive: string;
  negative: string;
  seed: number;
  /** Items whose library roomTypes does not include this room. Not removed — deprioritized. */
  offRoomItems?: string[];
  /** Items with extreme scale (<0.5 or >2.5 on any axis, or aspect ratio distortion). */
  warpedItems?: string[];
  /** Approx token count of positive prompt after truncation. */
  tokenEstimate?: number;
}

// ─── Scale classification ─────────────────────────────────
function classifyScale(sw: number, sd: number, sh: number): {
  prefix: string;          // adjective to prepend ("", "oversized", "compact", "elongated")
  isWarped: boolean;       // aspect ratio distorted — skip raw dimensions
  sizeNote: string;        // "(2.4m × 1.0m)" or "" — only emitted when realistic
} {
  const mx = Math.max(sw, sd, sh);
  const mn = Math.min(sw, sd, sh);
  // Aspect distortion: scaleW vs scaleD differ > 1.5×
  const aspectDist = Math.abs(Math.log(Math.max(sw, 0.01) / Math.max(sd, 0.01)));
  const heightDist = Math.abs(Math.log(Math.max(sh, 0.01) / Math.max((sw + sd) / 2, 0.01)));
  const isWarped = aspectDist > 0.5 || heightDist > 0.5 || mn < 0.5 || mx > 2.5;

  let prefix = "";
  if (isWarped) {
    if (sw > sd * 1.8)   prefix = "elongated";
    else if (sd > sw * 1.8) prefix = "deep";
    else if (mx > 1.5)   prefix = "oversized";
    else if (mn < 0.7)   prefix = "compact";
  } else {
    if (mx > 1.4)  prefix = "oversized";
    else if (mn < 0.7) prefix = "compact";
  }
  return { prefix, isWarped, sizeNote: "" };
}

// ─── CLIP token estimate (English word count × 1.3 heuristic) ──
function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.split(/[\s,]+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

// ─── Truncate prompt parts to fit CLIP 75-token window ──
// Parts at the head of the array are kept first; tail drops when budget exceeded.
function assemblePrompt(parts: Array<string | false | null | undefined>, maxTokens = 75): {
  text: string; tokens: number;
} {
  const result: string[] = [];
  let total = 0;
  for (const raw of parts) {
    if (!raw) continue;
    const p = String(raw).trim();
    if (!p) continue;
    const cost = estimateTokens(p) + 1; // +1 comma separator
    if (total + cost > maxTokens) break;
    result.push(p);
    total += cost;
  }
  return { text: result.join(", "), tokens: total };
}

export function generateRoomPrompt(input: RoomPromptInput): GeneratedPrompt {
  const {
    roomType,
    roomName,
    width,
    depth,
    height = 280,
    materials,
    placedItems,
    windows = [],
  } = input;

  const w = (width  / 100).toFixed(1);
  const d = (depth  / 100).toFixed(1);
  const h = (height / 100).toFixed(1);
  const displayName = roomName ?? ROOM_TYPE_EN[roomType] ?? roomType;

  // ── Wall ──
  let wallDesc = "white painted walls";
  if (materials.wall) {
    const matId  = (materials.wall as { id?: string }).id ?? "";
    const fromId = materialIdToDesc(matId, "wall");
    if (fromId) {
      wallDesc = fromId;
    } else {
      const color = hexToColorName(materials.wall.color);
      wallDesc = ensureEnglish(`${color} painted walls`);
    }
  }

  // ── Floor ──
  let floorDesc = "light wood flooring";
  if (materials.floor) {
    const matId  = (materials.floor as { id?: string }).id ?? "";
    const fromId = materialIdToDesc(matId, "floor");
    if (fromId) {
      floorDesc = fromId;
    } else {
      const color = hexToColorName(materials.floor.color);
      floorDesc = ensureEnglish(`${color} flooring`);
    }
  }

  // ── Lighting ──
  let lightDesc = "recessed ceiling lights, warm white ambiance";
  if (materials.light) {
    const matId  = (materials.light as { id?: string }).id ?? "";
    const fromId = materialIdToDesc(matId, "light");
    if (fromId) {
      lightDesc = fromId;
    } else {
      // Fallback: strip Chinese from whatever description exists
      lightDesc = ensureEnglish(
        materials.light.description ?? materials.light.name ?? lightDesc
      ) || lightDesc;
    }
  }

  // ── Furniture ──
  // 1) Bucket items by furnitureId; track on-room vs off-room + warped.
  //    Items whose library roomTypes doesn't include this room → still rendered
  //    but deprioritized (appended last so token truncation may drop them).
  interface FurnitureBucket {
    furnitureId: string;
    count: number;
    onRoom: boolean;       // roomTypes includes current roomType
    prefixes: Set<string>; // "oversized" / "compact" / "elongated" — union across instances
    warped: boolean;       // any instance is warped
    items: typeof placedItems;
  }
  const buckets = new Map<string, FurnitureBucket>();
  const offRoomItems: string[] = [];
  const warpedItems:  string[] = [];

  for (const item of placedItems) {
    const lib = FURNITURE_BY_ID.get(item.furnitureId);
    const onRoom = lib ? lib.roomTypes.includes(roomType) : true;
    const sw = item.scaleW ?? 1, sd = item.scaleD ?? 1, sh = item.scaleH ?? 1;
    const cls = classifyScale(sw, sd, sh);

    let b = buckets.get(item.furnitureId);
    if (!b) {
      b = {
        furnitureId: item.furnitureId,
        count: 0, onRoom,
        prefixes: new Set(),
        warped: false,
        items: [] as typeof placedItems,
      };
      buckets.set(item.furnitureId, b);
    }
    b.count += 1;
    b.items.push(item);
    if (cls.prefix) b.prefixes.add(cls.prefix);
    if (cls.isWarped) b.warped = true;

    if (!onRoom && !offRoomItems.includes(item.furnitureId)) offRoomItems.push(item.furnitureId);
    if (cls.isWarped && !warpedItems.includes(item.furnitureId)) warpedItems.push(item.furnitureId);
  }

  // 2) Render each bucket → phrase, then rank (on-room first, non-warped next).
  const rendered: Array<{ onRoom: boolean; warped: boolean; phrase: string }> = [];
  for (const b of buckets.values()) {
    const desc = parseFurnitureId(b.furnitureId);
    // Pick a single adjective (most specific wins)
    const adj =
      b.prefixes.has("elongated") ? "elongated"
      : b.prefixes.has("deep")    ? "deep"
      : b.prefixes.has("oversized") ? "oversized"
      : b.prefixes.has("compact") ? "compact"
      : "";

    // Position hint from the first instance (only when count == 1 and on-room)
    let phrase: string;
    if (b.count > 1) {
      const qty = b.count === 2 ? "two" : b.count === 3 ? "three" : b.count === 4 ? "four" : `${b.count}×`;
      phrase = `${qty} ${adj ? adj + " " : ""}${desc}`.trim();
    } else if (b.onRoom && !b.warped) {
      const first = b.items[0];
      const pos = posHint(first.x, first.z, width, depth);
      phrase = `${adj ? adj + " " : ""}${desc} (${pos})`.trim();
    } else {
      // off-room or warped singletons: skip position hint (SD can't ground it anyway)
      phrase = `${adj ? adj + " " : ""}${desc}`.trim();
    }
    rendered.push({ onRoom: b.onRoom, warped: b.warped, phrase });
  }

  // Rank: on-room & clean first, on-room & warped, off-room & clean, off-room & warped
  rendered.sort((a, b) => {
    const rankA = (a.onRoom ? 0 : 2) + (a.warped ? 1 : 0);
    const rankB = (b.onRoom ? 0 : 2) + (b.warped ? 1 : 0);
    return rankA - rankB;
  });
  const furnitureParts = rendered.map(r => r.phrase);

  // ── Windows & natural light ──
  let lightingNote = "";
  if (windows.length > 0) {
    const wallNames: Record<string, string> = {
      back: "back wall", front: "front wall", left: "left wall", right: "right wall"
    };
    // Merge windows on same wall (visual continuity)
    const byWall = new Map<string, typeof windows>();
    for (const w of windows) {
      const arr = byWall.get(w.wall) ?? [];
      arr.push(w);
      byWall.set(w.wall, arr);
    }
    if (windows.length === 1) {
      const win = windows[0];
      const winW = (win.len / 100).toFixed(1);
      const sill = win.sill ?? 90;
      const wh   = win.h    ?? 150;
      const wallName = wallNames[win.wall] ?? win.wall;
      const isFloorToCeiling = sill < 40 || (sill + wh) >= (height - 40);
      const isLarge = win.len >= 180 || isFloorToCeiling;
      lightingNote = isLarge
        ? `floor-to-ceiling ${winW}m wide window on ${wallName}, lush greenery outside, natural daylight flooding in, soft volumetric light, long shadows`
        : `${winW}m wide window on ${wallName}, natural daylight pouring in, sun rays, soft shadows`;
    } else if (byWall.size === 1) {
      // Multiple windows on the same wall → continuous ribbon
      const wallName = wallNames[[...byWall.keys()][0]] ?? "";
      const totalLen = (windows.reduce((s, w) => s + w.len, 0) / 100).toFixed(1);
      lightingNote = `continuous ${totalLen}m ribbon of windows along ${wallName}, abundant natural daylight, bright airy atmosphere, soft diffused light`;
    } else {
      // Windows on multiple walls → panoramic
      lightingNote = `floor-to-ceiling panoramic windows, lush green garden view outside, abundant natural daylight, bright airy atmosphere, soft diffused light`;
    }
  } else {
    lightingNote = "interior artificial lighting, warm ambiance";
  }

  // ── Style ──
  const allTags = new Set<string>();
  for (const mat of Object.values(materials)) {
    if (mat && "tags" in (mat as object)) {
      ((mat as { tags?: string[] }).tags ?? []).forEach(t => allTags.add(t));
    }
  }
  const dominantStyle = allTags.size > 0 ? [...allTags][0] : inferStyleFromRoom(materials, placedItems);
  const styleDesc  = STYLE_EN[dominantStyle]  ?? "modern contemporary";
  const styleMood  = STYLE_MOOD[dominantStyle] ?? "clean modern atmosphere";
  const styleNeg   = STYLE_NEGATIVES[dominantStyle] ?? "";

  // ── Assemble positive prompt ──
  // SDXL with ComfyUI CLIPTextEncode uses BREAK-chunked encoding, effectively
  // supporting ~225 tokens (3 × 75). We target 150 tokens as the sweet spot —
  // plenty for surfaces + atmosphere + a handful of furniture, without diluting
  // the CFG signal.
  //
  // Priority ordering (head kept first, tail dropped last):
  //   1. Quality signal + shot type + styled room name  → non-negotiable (~15 tok)
  //   2. Room size + surfaces + lighting                → geometry + materials (~30 tok)
  //   3. Natural light note + style mood                → atmosphere (~25 tok)
  //   4. Furniture (on-room first, off-room/warped last)→ fills middle (~60 tok)
  //   5. Camera / tech suffix                           → polish (~10 tok)
  const coreHead = [
    "RAW photo, photorealistic, ultra-detailed, 8K UHD, sharp focus",
    `professional interior photography of ${styleDesc} ${displayName}`,
    `${w}m × ${d}m room`,
    wallDesc,
    floorDesc,
    lightDesc,
    lightingNote,
    styleMood,
  ];
  const coreTail = [
    "wide-angle 24mm, Architectural Digest quality, no people",
  ];

  // Budget split: head + tail always kept (they set the scene), furniture fills
  // the remainder up to the overall 150-token chunked target.
  const TARGET_TOTAL = 150;
  const { text: headText, tokens: headTokens } = assemblePrompt(coreHead, 999);
  const { text: tailText, tokens: tailTokens } = assemblePrompt(coreTail, 999);
  const furnitureBudget = Math.max(0, TARGET_TOTAL - headTokens - tailTokens);
  const { text: furnText, tokens: furnTokens } = assemblePrompt(furnitureParts, furnitureBudget);

  const positive = [headText, furnText, tailText].filter(Boolean).join(", ");
  const tokenEstimate = headTokens + furnTokens + tailTokens;

  // ── Negative prompt ──
  const hasTvUnit    = placedItems.some(i => i.furnitureId.startsWith("tvunit-"));
  const hasFireplace = placedItems.some(i => i.furnitureId.startsWith("fireplace-"));
  const negative = [
    "people, person, human, cartoon, illustration, painting, sketch, low quality",
    "blurry, out of focus, distorted, deformed, bad anatomy, watermark",
    "text, logo, signature, overexposed, underexposed",
    "3D render, CGI, anime, drawing",
    "stretched furniture, warped proportions, disproportionate, impossibly thin, impossibly wide",
    "duplicate items, cloned furniture, overlapping objects",
    hasTvUnit && !hasFireplace ? "fireplace, fire, flame, burning, hearth" : "",
    styleNeg,
  ].filter(Boolean).join(", ");

  return {
    roomType: displayName,
    roomName: displayName,
    positive,
    negative,
    seed: Math.floor(Math.random() * 2 ** 31),
    offRoomItems,
    warpedItems,
    tokenEstimate,
  };
}

// ─── ComfyUI workflow generator ───────────────────────────────

export interface ComfyWorkflowOptions {
  model?: string;   // checkpoint name
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
}

/**
 * Generates a ComfyUI API workflow JSON for a single room prompt.
 * Compatible with SDXL / Flux / most standard checkpoints.
 */
export function generateComfyWorkflow(
  prompt: GeneratedPrompt,
  opts: ComfyWorkflowOptions = {}
): object {
  const {
    model   = "sd_xl_base_1.0.safetensors",
    width   = 1024,
    height  = 1024,
    steps   = 30,
    cfg     = 7.0,
    sampler = "euler",
  } = opts;

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model },
    },
    "2": {
      class_type: "EmptyLatentImage",
      inputs: { batch_size: 1, height, width },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt.positive,
        clip: ["1", 1],
      },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt.negative,
        clip: ["1", 1],
      },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed:        prompt.seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler:   "normal",
        denoise:     1,
        model:       ["1", 0],
        positive:    ["3", 0],
        negative:    ["4", 0],
        latent_image:["2", 0],
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `home_${prompt.roomType.replace(/\s+/g, "_")}`,
        images: ["6", 0],
      },
    },
  };
}

/**
 * Batch workflow: multiple rooms as a sequential batch
 * Returns one workflow object with all rooms chained as separate KSampler nodes.
 */
export function generateBatchWorkflow(
  prompts: GeneratedPrompt[],
  opts: ComfyWorkflowOptions = {}
): object {
  const {
    model   = "sd_xl_base_1.0.safetensors",
    width   = 1024,
    height  = 1024,
    steps   = 30,
    cfg     = 7.0,
    sampler = "euler",
  } = opts;

  const nodes: Record<string, object> = {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model },
    },
  };

  let nodeId = 2;
  for (const p of prompts) {
    const latentId  = String(nodeId++);
    const posId     = String(nodeId++);
    const negId     = String(nodeId++);
    const sampleId  = String(nodeId++);
    const decodeId  = String(nodeId++);
    const saveId    = String(nodeId++);

    nodes[latentId] = {
      class_type: "EmptyLatentImage",
      inputs: { batch_size: 1, height, width },
    };
    nodes[posId] = {
      class_type: "CLIPTextEncode",
      inputs: { text: p.positive, clip: ["1", 1] },
    };
    nodes[negId] = {
      class_type: "CLIPTextEncode",
      inputs: { text: p.negative, clip: ["1", 1] },
    };
    nodes[sampleId] = {
      class_type: "KSampler",
      inputs: {
        seed: p.seed, steps, cfg,
        sampler_name: sampler, scheduler: "normal", denoise: 1,
        model: ["1", 0],
        positive: [posId, 0],
        negative: [negId, 0],
        latent_image: [latentId, 0],
      },
    };
    nodes[decodeId] = {
      class_type: "VAEDecode",
      inputs: { samples: [sampleId, 0], vae: ["1", 2] },
    };
    nodes[saveId] = {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `home_${p.roomType.replace(/[\s/]+/g, "_")}`,
        images: [decodeId, 0],
      },
    };
  }

  return nodes;
}
