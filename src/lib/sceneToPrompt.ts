/**
 * sceneToPrompt.ts — Exterior scene graph → Stable Diffusion / ComfyUI prompt
 *
 * Traverses the designer's data model (exterior settings + yard plan) and
 * generates a rich, architecture-photography-style English prompt that can
 * be fed directly to:
 *   • The existing AiRenderModal (which already POSTs to ComfyUI)
 *   • SDXL + ControlNet (Depth + Canny) for photorealistic exterior renders
 *
 * The output matches the vocabulary expected by the comfyWorkflow.ts pipeline
 * and is optimised for SDXL 1.0 + "Architectural Visualization" LoRA weights.
 */

import type { ExteriorSettings, YardItem, YardPrefab } from "./types";
import { isYardPrefab, isYardSingleton } from "./types";
import type { PrefabKind } from "./types";

// ─── Material descriptors ──────────────────────────────────────────
const WALL_MATERIAL_DESC: Record<string, string> = {
  render:   "smooth white render facade",
  brick:    "exposed brick facade",
  stone:    "natural stone cladding",
  wood:     "vertical timber cladding",
  concrete: "board-formed concrete facade",
};

const ROOF_STYLE_DESC: Record<string, string> = {
  flat:     "deep cantilevered flat roof with walnut wood soffit",
  gable:    "gabled roof",
  hip:      "hipped roof",
  mansard:  "mansard roof",
  chinese:  "upswept Chinese eave roof with grey clay tiles",
};

const YARD_PRESET_DESC: Record<string, string> = {
  minimal: "minimalist landscaped garden",
  garden:  "lush landscaped garden with specimen trees",
  pool:    "infinity swimming pool with travertine deck and sun loungers",
  full:    "resort-style infinity pool, outdoor kitchen, fire pit and pergola",
};

// ─── Prefab semantic descriptors ──────────────────────────────────
const PREFAB_DESC: Record<PrefabKind, string> = {
  pool:             "large infinity swimming pool with glass overflow edge, turquoise water, and travertine surround",
  social_island:    "sunken fire-pit social island with built-in bench seating and outdoor kitchen counter",
  pergola_classic:  "steel-and-timber pergola dining area with six outdoor chairs",
  outdoor_kitchen:  "L-shaped outdoor kitchen island with built-in BBQ grill and stone countertop",
  fountain:         "circular stone fountain with central jet",
  farm_box:         "raised timber planting beds with herbs and vegetables",
  porte_cochere:    "concrete porte-cochère canopy over parking",
  slat_wall:        "vertical timber slat privacy screen",
  fence_segment:    "modern timber slat fence",
  parking_area:     "paved parking area with driveway",
};

// ─── Outdoor singleton descriptors ────────────────────────────────
const SINGLETON_DESC: Record<string, string> = {
  "tree.olive":         "mature olive tree",
  "tree.palm":          "tall palm tree",
  "tree.japanese_maple":"Japanese maple tree with red foliage",
  "tree.cypress":       "tall cypress tree",
  "tree.bonsai":        "sculpted bonsai tree",
  "plant.boxwood":      "sculpted boxwood hedge ball",
  "plant.agave":        "agave succulent",
  "rock.boulder":       "natural boulder feature",
};

// ─── Time-of-day lighting descriptors ─────────────────────────────
// Matches the sun slider hour ranges in HouseCanvas
function lightingFromHour(hour: number): string {
  if (hour < 6 || hour > 20)  return "moonlit night, dramatic artificial lighting, warm lamplight";
  if (hour < 8)               return "golden sunrise light, long horizontal shadows, warm amber glow";
  if (hour < 10)              return "bright morning light, crisp shadows, golden hour";
  if (hour < 15)              return "bright midday sun, sharp shadows, vibrant colors";
  if (hour < 17)              return "warm afternoon sunlight, soft shadows";
  if (hour < 19)              return "golden hour sunset, long dramatic shadows, warm orange glow";
  return                             "dusk, deep blue sky, subtle artificial lighting";
}

// ─── Main generator ────────────────────────────────────────────────

export interface ScenePromptOptions {
  exterior:  ExteriorSettings;
  yardItems: YardItem[];
  /** Sun slider hour (0–24). Drives lighting vocabulary. Default 14. */
  sunHour?:  number;
  /** Style override e.g. "Chinese contemporary", "Tropical modern". */
  styleTag?: string;
}

export interface GeneratedPrompt {
  /** Full positive prompt, ready to paste into ComfyUI or SDXL. */
  positive: string;
  /** Negative prompt (standard exclusion list for architectural viz). */
  negative: string;
  /** Short summary shown in the UI (≤ 80 chars). */
  summary:  string;
}

export function generateExteriorPrompt(opts: ScenePromptOptions): GeneratedPrompt {
  const { exterior, yardItems, sunHour = 14, styleTag } = opts;

  // ── Building description ────────────────────────────────────────
  const wallDesc  = WALL_MATERIAL_DESC[exterior.wallMaterial] ?? "modern facade";
  const roofDesc  = ROOF_STYLE_DESC[exterior.roofStyle] ?? "flat roof";
  const floorsStr = exterior.floors > 1 ? `${exterior.floors}-storey ` : "single-storey ";
  const yardDesc  = YARD_PRESET_DESC[exterior.yardPreset] ?? "landscaped garden";
  const style     = styleTag ?? (exterior.preset === "modern-villa" ? "contemporary" : "modern");

  // ── Prefab elements ─────────────────────────────────────────────
  const prefabs  = yardItems.filter(isYardPrefab) as YardPrefab[];
  const prefabDescs = [...new Set(prefabs.map(p => PREFAB_DESC[p.prefabKind]).filter(Boolean))];

  // ── Singleton plants / trees ────────────────────────────────────
  const singles = yardItems.filter(isYardSingleton);
  const singleDescs = [
    ...new Set(singles.map(it => SINGLETON_DESC[it.kind]).filter(Boolean)),
  ].slice(0, 4); // cap at 4 so prompt doesn't explode

  // ── Lighting ────────────────────────────────────────────────────
  const lighting = lightingFromHour(sunHour);

  // ── Compose positive prompt ─────────────────────────────────────
  // Pattern: <subject> <material> <style> <key features> <lighting> <quality tags>
  const features = [
    ...prefabDescs,
    ...singleDescs,
    yardDesc,
  ].filter(Boolean);

  const positive = [
    `Architectural photography of a ${floorsStr}${style} luxury villa,`,
    `${wallDesc},`,
    `${roofDesc},`,
    features.length > 0 ? features.join(", ") + "," : "",
    `${lighting},`,
    "ultra-realistic, 8K, cinematic composition, depth of field,",
    "professional architectural visualization, award-winning photography",
  ].filter(Boolean).join(" ");

  // ── Negative prompt ─────────────────────────────────────────────
  const negative = [
    "cartoon, illustration, sketch, watercolor, 3D render artifact,",
    "bad proportions, distorted architecture, ugly, blurry, low quality,",
    "people, cars, clutter, wires, construction materials, scaffolding,",
    "over-exposed, under-exposed, noise, grain",
  ].join(" ");

  // ── Summary ─────────────────────────────────────────────────────
  const summary = `${floorsStr}${style} villa · ${exterior.wallMaterial} · ${exterior.yardPreset} · ${lightingFromHour(sunHour).split(",")[0]}`;

  return { positive, negative, summary };
}

/**
 * Snap helper — checks whether a proposed world position (in cm)
 * violates the minimum clearance from the house footprint edge.
 *
 * @param x         Proposed X position (cm, world)
 * @param z         Proposed Z position (cm, world)
 * @param houseW    House width (metres)
 * @param houseD    House depth (metres)
 * @param minClear  Required minimum clearance from house wall (cm). Default 60cm.
 * @returns  { ok, nudgeX, nudgeZ } — if !ok, apply nudge to push item to safe zone
 */
export function checkHouseClearance(
  x: number, z: number,
  houseW: number, houseD: number,
  minClear = 60,
): { ok: boolean; nudgeX: number; nudgeZ: number } {
  const hw = (houseW / 2) * 100 + minClear;
  const hd = (houseD / 2) * 100 + minClear;

  // Is the point inside the exclusion zone (inside house + clearance band)?
  const insideX = Math.abs(x) < hw;
  const insideZ = Math.abs(z) < hd;
  if (!(insideX && insideZ)) return { ok: true, nudgeX: 0, nudgeZ: 0 };

  // Push outward along the shorter axis to respect clearance
  const overlapX = hw - Math.abs(x);
  const overlapZ = hd - Math.abs(z);
  if (overlapX < overlapZ) {
    return { ok: false, nudgeX: Math.sign(x) * overlapX, nudgeZ: 0 };
  } else {
    return { ok: false, nudgeX: 0, nudgeZ: Math.sign(z) * overlapZ };
  }
}

/**
 * Smart snap — given a dragged item position, snaps it to the nearest
 * house wall edge if within SNAP_THRESHOLD centimetres.
 *
 * This is the "磁吸" (magnetic snap) from the design doc.
 *
 * @param x, z       Current drag position (cm)
 * @param houseW, houseD   House dimensions (metres)
 * @param snapThresh  Distance within which snap activates (cm). Default 50cm.
 * @returns  { x, z } — possibly snapped to wall edge + clearance gap
 */
export function snapToHouseWall(
  x: number, z: number,
  houseW: number, houseD: number,
  snapThresh = 50,
): { x: number; z: number; snapped: boolean } {
  const hw = (houseW / 2) * 100;
  const hd = (houseD / 2) * 100;
  const GAP = 30; // 30cm clearance from wall face

  // Distances from each wall face
  const dRight  = Math.abs(x - (hw + GAP));
  const dLeft   = Math.abs(x - (-(hw + GAP)));
  const dFront  = Math.abs(z - (hd + GAP));
  const dBack   = Math.abs(z - (-(hd + GAP)));

  const minDist = Math.min(dRight, dLeft, dFront, dBack);
  if (minDist > snapThresh) return { x, z, snapped: false };

  if (minDist === dRight)  return { x:  hw + GAP, z, snapped: true };
  if (minDist === dLeft)   return { x: -(hw + GAP), z, snapped: true };
  if (minDist === dFront)  return { x, z:  hd + GAP, snapped: true };
  return                          { x, z: -(hd + GAP), snapped: true };
}
