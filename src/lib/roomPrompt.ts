/**
 * roomPrompt.ts
 * Converts home-designer JSON room data → Stable Diffusion / ComfyUI prompts
 */

import type { RoomType } from "./types";

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
  // Artwork
  "artwork-abstract":       "abstract textured wall art print",
  "artwork-inkwash":        "Chinese ink wash landscape painting",
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
  // Lighting
  "light-chandelier":      { light: "elegant crystal chandelier, warm glow" },
  "light-pendant-nordic":  { light: "Nordic minimal pendant light, diffused warm light" },
  "light-spot":            { light: "ceiling track spotlights, no main pendant, atmospheric lighting" },
  "light-recessed":        { light: "recessed downlights, clean ceiling, warm white" },
  "light-japanese-paper":  { light: "washi paper pendant lamp, soft diffused warm light" },
  "light-strip":           { light: "LED strip cove lighting, indirect ambient glow" },
  "light-industrial":      { light: "industrial bare-bulb pendant lights, warm Edison glow" },
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

// Style-specific atmosphere/mood — appended after main description
const STYLE_MOOD: Record<string, string> = {
  "现代":  "bright airy minimal atmosphere, clean lines, neutral tones",
  "北欧":  "Scandinavian hygge atmosphere, cozy warm diffused light, functional minimalism",
  "轻奢":  "modern light luxury atmosphere, sophisticated elegance, premium refined finishes",
  "日式":  "zen minimalist wabi-sabi atmosphere, soft natural raking light, peaceful serene mood",
  "工业风": "dark moody industrial loft atmosphere, high contrast, dramatic shadows, urban grit",
  "中式":  "classic Chinese elegance, harmonious balance, warm amber light, refined traditional",
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
  const v = hz < 0.33 ? "far" : hz < 0.67 ? "middle" : "near";
  if (h === "center" && v === "middle") return "centered";
  if (v === "far")  return `along far wall (${h})`;
  if (v === "near") return `near viewer (${h})`;
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
  }>;
  windows?: Array<{ wall: string; len: number; pos: number }>;
}

export interface GeneratedPrompt {
  roomType: string;
  roomName: string;
  positive: string;
  negative: string;
  seed: number;
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
  // De-duplicate by furnitureId, keep first occurrence per type
  const seenIds = new Map<string, number>();
  const furnitureParts: string[] = [];
  for (const item of placedItems) {
    const count = (seenIds.get(item.furnitureId) ?? 0) + 1;
    seenIds.set(item.furnitureId, count);
    const desc = parseFurnitureId(item.furnitureId);
    const pos  = posHint(item.x, item.z, width, depth);
    if (count === 1) {
      furnitureParts.push(`${desc} (${pos})`);
    }
  }
  // If more than one of same type, mention the count
  for (const [id, cnt] of seenIds.entries()) {
    if (cnt > 1) {
      const idx = furnitureParts.findIndex(s => s.startsWith(parseFurnitureId(id)));
      if (idx >= 0) furnitureParts[idx] = `${cnt}× ${parseFurnitureId(id)}`;
    }
  }

  // ── Windows & natural light ──
  let lightingNote = "";
  if (windows.length > 0) {
    const wallNames: Record<string, string> = {
      back: "back wall", front: "front wall", left: "left wall", right: "right wall"
    };
    if (windows.length === 1) {
      const win = windows[0];
      const winW = (win.len / 100).toFixed(1);
      const wallName = wallNames[win.wall] ?? win.wall;
      const isLarge = win.len >= 150; // ≥1.5m → treat as floor-to-ceiling
      lightingNote = isLarge
        ? `floor-to-ceiling ${winW}m wide window on ${wallName}, lush greenery outside, natural daylight flooding in, soft volumetric light, long shadows`
        : `${winW}m wide window on ${wallName}, natural daylight pouring in, sun rays, soft shadows`;
    } else {
      // Multiple windows — panoramic feel
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
  const positive = [
    // Quality prefix
    "RAW photo, photorealistic, ultra-detailed, 8K UHD, DSLR, sharp focus",
    // Shot
    `professional interior design photography of a ${styleDesc} ${displayName}`,
    // Space
    `${w}m × ${d}m × ${h}m room`,
    // Surfaces
    wallDesc,
    floorDesc,
    // Lighting
    lightDesc,
    lightingNote,
    // Furniture
    ...(furnitureParts.length > 0 ? furnitureParts : []),
    // Style atmosphere — the key quality driver
    styleMood,
    // Photography quality
    "wide-angle lens 24mm, Architectural Digest editorial quality, no people",
  ]
    .filter(Boolean)
    .join(", ");

  // ── Negative prompt ──
  const hasTvUnit = placedItems.some(i => i.furnitureId.startsWith("tvunit-"));
  const negative = [
    "people, person, human, cartoon, illustration, painting, sketch, low quality",
    "blurry, out of focus, distorted, deformed, bad anatomy, watermark",
    "text, logo, signature, overexposed, underexposed",
    "3D render, CGI, anime, drawing",
    hasTvUnit ? "fireplace, fire, flame, burning, hearth" : "",
    styleNeg,
  ].filter(Boolean).join(", ");

  return {
    roomType: displayName,
    roomName: displayName,
    positive,
    negative,
    seed: Math.floor(Math.random() * 2 ** 31),
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
