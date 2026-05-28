// Shared types for the home designer app

export type RoomType =
  | "living"     // 客厅
  | "master"     // 主卧
  | "bedroom"    // 次卧
  | "bedroom2"   // 次卧2
  | "bedroom3"   // 次卧3
  | "kitchen"    // 厨房
  | "bathroom"   // 卫生间
  | "bathroom2"  // 卫生间2
  | "dining"     // 餐厅
  | "study"      // 书房
  | "study2"     // 书房2
  | "closet"     // 衣帽间
  | "balcony"    // 阳台
  | "balcony2"   // 阳台2
  | "yard"       // 院子
  | "garage"     // 车库
  | "gym"        // 健身房
  | "cinema"     // 影音室
  | "custom1"    // 自定义1
  | "custom2"    // 自定义2
  | "custom3"    // 自定义3
  | "custom4"    // 自定义4
  | "custom5"    // 自定义5
  | "stair"      // 楼梯间
  | "hallway"    // 走廊/过道
  // ── 户外结构（按房间机制管理位置和尺寸，可换 GLB）──
  | "pool"       // 泳池
  | "terrace"    // 露台
  | "deck"       // 木栈台
  // ── 屋顶层专属（仅显示在 hasRooftop 的屋顶楼层）──
  | "rooftop_lounge"   // 天台休闲区
  | "rooftop_pool"     // 屋顶泳池
  | "rooftop_garden"   // 屋顶花园
  | "rooftop_bar"      // 天台酒吧
  | "equipment_room";  // 设备间

export type ViewMode = "2d" | "3d" | "all" | "exterior" | "global3d" | "yard2d";

/** Outdoor yard plan — analogous to FloorPlan but for the property surrounds.
 *  User draws this 2D and the Exterior 3D view auto-generates from it.
 *
 *  v2 schema (2026-04): YardItem is now a discriminated union so a single
 *  `items[]` array can mix three kinds of "things on the property":
 *    - "singleton" — a single asset (tree, rock, lamp, etc.) — original v1
 *    - "prefab"    — a compound spatial block (social island, farm box…)
 *    - "zone"      — a polygon paving region with a narrative role
 *
 *  Old saves stored items WITHOUT the `type` field. The store layer fills
 *  `type: "singleton"` on read so old data continues to render correctly. */
export type YardItem = YardSingleton | YardPrefab | YardZone;

interface YardCommonFields {
  id: string;
  /** World position in cm, origin = house center on the ground plane.
   *  For prefab/zone, this is the prefab's pivot / zone's centroid. */
  x: number;
  z: number;
  /** Y rotation in radians. */
  rot?: number;
  /** Uniform scale multiplier (default 1). */
  scale?: number;
}

export interface YardSingleton extends YardCommonFields {
  type?: "singleton";   // optional for back-compat with v1 saves
  /** Asset key from the outdoor library (e.g. "tree.olive", "feature.firepit"). */
  kind: string;
}

export interface YardPrefab extends YardCommonFields {
  type: "prefab";
  /** Prefab kind from PREFAB_REGISTRY (see src/lib/outdoorPrefabs.ts). */
  prefabKind: PrefabKind;
  /** Prefab-specific parameters. Each PrefabKind has its own schema. */
  params?: Record<string, unknown>;
  /** For glb_model kind: URL to the GLTF/GLB file. */
  glbSrc?: string;
  /** For glb_model kind: optional tint colour for unlit parts. */
  partColor?: string;
  /** For glb_model kind: human-readable label shown in the 院子图 palette. */
  partLabel?: string;
}

export interface YardZone extends YardCommonFields {
  type: "zone";
  /** Narrative role of this zone (drives default paving + plant rules). */
  zoneKind: ZoneKind;
  /** Optional sub-type refining the parent ZoneKind. See ZoneSubtype docs
   *  for the canonical set. Drives sun-aware placement + sub-rules in
   *  outdoorClearance.ts. Existing zones default to undefined and fall
   *  back to parent-kind rules. */
  subtype?: ZoneSubtype;
  /** Polygon vertices in cm, RELATIVE TO the zone's (x, z) origin. */
  polygon: Array<[number, number]>;
  /** Override the default paving material id for this zoneKind. */
  pavingMaterialId?: string;
}

/** §10.3 of docs/yard-design-references.md — 11 functional sub-types
 *  that real designers use. Each maps to one of the 5 parent ZoneKinds
 *  but lets the solver apply richer rules (sunset terrace prefers west,
 *  service yard hidden from social sightlines, etc.).
 *
 *  Selection: pick the sub-type your zone is intended as; leave unset
 *  for generic. Used by:
 *    - YardPlan inspector dropdown (UI hint + paving variant)
 *    - outdoorClearance constraint rules (sun bias, sightline hide)
 *    - sceneToPrompt naming for AI render captioning */
export type ZoneSubtype =
  | "entry-sequence"      // gate → walk → threshold → door
  | "threshold"           // pergola / archway transition
  | "outdoor-room"        // patio, deck, dining terrace (default social)
  | "sunset-terrace"      // west-facing evening patio
  | "mudroom-side"        // bins / AC / tools, side of house
  | "kitchen-garden"      // raised-bed potager (default agro)
  | "fragrance-corridor"  // aromatic planting along a walk
  | "wild-edge"           // meadow / woodland edge at rear fence
  | "back-against"        // bench with wall/hedge behind
  | "service-yard"        // hidden tools / compost
  | "kids-sightline";     // play area visible from kitchen window

export type PrefabKind =
  | "social_island"
  | "farm_box"
  | "porte_cochere"
  | "slat_wall"
  | "fence_segment"
  | "parking_area"
  | "glb_model"
  // Structural — wraps the existing Pool/Pergola/OutdoorKitchen/Fountain
  // implementations so the user can DRAG these onto the YardPlan instead
  // of selecting via ExteriorSettings.yardPreset (which auto-places them
  // at fixed coordinates and can't be moved).
  | "pool"
  | "pergola_classic"
  | "outdoor_kitchen"
  | "fountain";

export type ZoneKind =
  | "social"     // 社交核心环 — patio + outdoor kitchen + fire feature
  | "private"    // 私密休闲环 — pergola, meditation, tea
  | "utility"    // 功能配套环 — driveway, entry, service
  | "agro"       // 抬高床菜园 / edible landscape
  | "lawn";      // 自然铺草，柔过渡

/** Type guards. Items persisted under v1 have no `type` field — those are
 *  treated as singletons. Use these in renderers / actions instead of
 *  switching on `(item as any).type` directly. */
export function isYardSingleton(it: YardItem): it is YardSingleton {
  return it.type === undefined || it.type === "singleton";
}
export function isYardPrefab(it: YardItem): it is YardPrefab {
  return it.type === "prefab";
}
export function isYardZone(it: YardItem): it is YardZone {
  return it.type === "zone";
}

export interface YardPlan {
  /** Free-form items — singletons, prefabs, zones (all in one array, see
   *  YardItem union). Render order = array order; zones first looks best. */
  items: YardItem[];
  /** Reserved for v3: explicit path / lawn polygon overrides not derived
   *  from a Zone. Most usage should go through `items` with type:"zone". */
  groundPolygons?: Array<{ id: string; kind: "lawn" | "paving" | "water"; points: Array<[number, number]> }>;
  paths?: Array<{ id: string; points: Array<[number, number]>; widthCm: number; material: string }>;
}

export type RoofStyle = "flat" | "gable" | "hip" | "mansard" | "chinese";
export type WallMaterialType = "render" | "brick" | "stone" | "wood" | "concrete" | "glass";

/**
 * One horizontal zone of an exterior wall surface.
 * A wall can have 1–N zones stacked from bottom to top.
 * heightFraction values should sum to 1.0.
 */
export interface WallZone {
  material: WallMaterialType;
  color: string;
  /** 0.0 – 1.0; fraction of total wall height this zone occupies */
  heightFraction: number;
}

export interface ExteriorSettings {
  preset: string;
  roofStyle: RoofStyle;
  roofColor: string;
  wallMaterial: WallMaterialType;
  wallColor: string;
  accentColor: string;   // windows, trim, door
  floors: number;        // 1–6
  yardPreset: "minimal" | "garden" | "pool" | "full";
  showParking?: boolean;
  /** Saved state for draggable outdoor elements (pool, pergola, etc.) */
  outdoorPositions?: Record<string, { x: number; z: number; rot?: number; hidden?: boolean }>;
  /** Whether to render the perimeter slat fence around the property.
   *  Default true. Set false for fully open lots or when the user has
   *  drawn explicit boundary slat_wall prefabs in the yardPlan. */
  showPerimeterFence?: boolean;
  /** Distance multiplier for the perimeter fence — 1.1 means the fence
   *  sits 10% beyond the house bounding box. Bigger = larger garden,
   *  smaller = tight courtyard. Default 1.1. Range typically 0.6 - 2.5. */
  fenceInsetMultiplier?: number;
  /** Pilotis (架空层) height in metres. >0 lifts the entire house off
   *  the ground by this amount and renders 4 corner concrete columns
   *  to support the structure. Use for: tropical stilt houses, Le
   *  Corbusier modernist pilotis, raised Chinese platforms, traditional
   *  raised tea houses. Default 0 (slab on grade). Sane range 0 - 4m. */
  pilotisHeightM?: number;
  /** Optional per-face material overrides. Each face can have its own color
   *  AND material type. If absent, falls back to wallColor / wallMaterial.
   *  Keys are NSWE cardinal sides: N=-Z (back), S=+Z (front), W=-X (left),
   *  E=+X (right). Unified with room WallSide identifiers. */
  faceMaterials?: Partial<Record<WallSide, string>>;
  /** Per-face material type (used alongside faceMaterials colors). */
  faceMaterialTypes?: Partial<Record<WallSide, WallMaterialType>>;
  /**
   * Split-zone wall material for ALL faces.
   * When set, overrides the single wallMaterial/wallColor.
   * Example: [{ material:"brick", color:"#B05030", heightFraction:0.4 },
   *           { material:"glass", color:"#C8E0F0", heightFraction:0.6 }]
   */
  wallZones?: WallZone[];
  /** Per-face zone overrides. When set for a face, overrides wallZones for that face.
   *  Keys are NSWE cardinal sides — see `faceMaterials` for the convention. */
  faceZones?: Partial<Record<WallSide, WallZone[]>>;
  /** Whether the building has a usable rooftop floor (天台层).
   *  When true, floorPlans[floors] holds the rooftop layout with
   *  parapet walls, no ceiling, and rooftop-only room types. */
  hasRooftop?: boolean;
  /** Building footprint shape. Default "rect". */
  footprintShape?: "rect" | "L" | "U" | "T";
  /** Wing proportions for non-rectangular shapes. 0.4–0.7 range. Default 0.5. */
  wingRatio?: number;
  /**
   * Component-based facade layout. Each face can have an array of FloorFacade
   * entries (one per storey). When set, this OVERRIDES the simple wallMaterial /
   * wallZones approach and lets the user compose the facade from individual
   * segments (glass curtain, solid wall, window opening, door, column…).
   */
  facades?: Partial<Record<WallSide, FloorFacade[]>>;
  /**
   * Special building renderer override.
   * "rich-glass-villa" → RichGlassVillaBuilding (3-volume luxury modern villa)
   * undefined → standard FloorShell-based rendering
   */
  buildingType?: string;
  // ── Rooftop content (user-configurable; replaces hardcoded counts) ──────
  /** Solar panels visible on the flat roof. Default true. */
  solarPanelsEnabled?: boolean;
  /** Columns in the PV grid. Sane range 1–10. Default 5. */
  solarPanelCols?: number;
  /** Rows in the PV grid. Sane range 1–6. Default 3. */
  solarPanelRows?: number;
  /** Rooftop deck furniture (loungers, dining set, hot tub, BBQ, bar, plunge
   *  pool, weather station, etc.). When false, all the hardcoded terrace
   *  decoration meshes are hidden — useful for a clean flat-roof look or
   *  when the user wants to place their own items via yardPlan. Default true. */
  rooftopDeckEnabled?: boolean;
  // ── Window appearance (user-configurable; was previously hardcoded) ─────
  /** Window glass tint in daytime. Hex string. Reads as a dark "punch-hole"
   *  against the cream facade. Default '#3E5066' (dark slate-blue). */
  windowGlassColor?: string;
  /** Window frame color (aluminium / millwork). Hex string. Falls back to
   *  ExteriorSettings.accentColor, then to '#1E2530' (dark anodised). */
  windowFrameColor?: string;
  // ── Facade panelisation (was hardcoded in ConcreteFacade) ───────────────
  /** Horizontal precast-panel seam spacing in metres. Default 0.90.
   *  Sane range 0.4–2.0. Smaller = more horizontal banding. */
  wallPanelHSpacing?: number;
  /** Vertical precast-panel seam spacing in metres. Default 1.20.
   *  Sane range 0.4–3.0. Smaller = more vertical articulation. */
  wallPanelVSpacing?: number;
  // ── Ground-floor stone base + roof vents ────────────────────────────────
  /** Limestone-look base rustication band on the ground floor. Default true. */
  stoneBaseEnabled?: boolean;
  /** Height of the ground-floor stone base in metres. Default 0.55. */
  stoneBaseHeight?: number;
  /** Roof exhaust / vent stacks. Default 3. Range 0–6. Zero hides the
   *  rooftop machine-room cluster entirely. */
  roofVentCount?: number;
  // ── Window ornaments (default classic; turn off for a minimal look) ─────
  /** Stone sill + drip-edge under each window. Default true. */
  windowSillEnabled?: boolean;
  /** Concrete lintel above each window. Default true. */
  windowLintelEnabled?: boolean;
  /** Side jamb reveals (3D depth around the window opening). Default true. */
  windowJambEnabled?: boolean;
  /** Wrought-iron flower-box probability per window (0–100). Default 70. */
  windowFlowerBoxFreq?: number;
  /** Even/odd two-tone panel striping on the facade. Default true.
   *  Turn off for a perfectly flat single-tone wall. */
  wallPanelTwoTone?: boolean;
  // ── Roof geometry (was hardcoded in FlatRoof) ───────────────────────────
  /** Eave overhang on N / E / W sides in metres. Default 0.45. Range 0–1.5.
   *  0 = flush flat-roof; larger = deeper modernist cantilever. */
  roofOverhang?: number;
  /** Extra south-side overhang beyond `roofOverhang` (m). Default 0.30.
   *  Set 0 for symmetric eaves on all 4 sides. */
  roofOverhangSouthExtra?: number;
  /** Parapet wall height (m) around the flat roof. Default 0.30.
   *  Set 0 to drop the parapet — gives an unbroken cantilever look. */
  parapetHeight?: number;
  /** Glass balustrade on top of the parapet (for roof-terrace safety).
   *  Default true. Only renders when parapetHeight > 0. */
  parapetGlassEnabled?: boolean;
  // ── Door style overrides (was hardcoded) ────────────────────────────────
  /** Minimum door width (m) above which the door renders as a sectional
   *  garage door instead of a regular hinged door. Default 2.0.
   *  Set very high (e.g. 10) to never render garage-door styling. */
  garageDoorMinWidth?: number;
  /** Default style for the auto-generated ground-floor living-room entrance
   *  door. Other doors fall back to "wood_panel". Default "french_double". */
  frontEntranceStyle?: DoorStyle;
  // ── Window dimension defaults (cm) ──────────────────────────────────────
  /** Default sill height (cm above the floor) for windows without explicit
   *  `sill`. Default 90. Range 0–200. Floor-to-ceiling glazing = 0. */
  defaultWindowSill?: number;
  /** Default window height in cm for windows without explicit `h`.
   *  Default 150. Range 60–280. Larger than `FLOOR_H - sill` will clip. */
  defaultWindowHeight?: number;
  // ── Door materials (was hardcoded inside WalkthroughDoor3D) ─────────────
  /** Door-frame paint color (the trim around every interior door). Hex
   *  string. Default '#F0EEEA' — warm off-white millwork. */
  doorFrameColor?: string;
  /** Door handle / knob metal color. Hex string. Default '#B8A060'
   *  (warm brass). Try '#9A9A9E' for brushed nickel or '#1E1E22' for
   *  matt black hardware. */
  doorHandleColor?: string;
  // ── Ceiling downlights (walkthrough only) ───────────────────────────────
  /** Master toggle for the recessed ceiling downlight array. Default true.
   *  Disabling gives unlit ceilings — sometimes preferred for bedroom
   *  walkthrough where ambient light is sufficient and downlights pop too
   *  bright. */
  ceilingLightsEnabled?: boolean;
  /** Floor area (m²) above which a room gets 4 downlights instead of 2.
   *  Default 12. Range 4–40. */
  ceilingLightLargeArea?: number;
  /** Floor area (m²) above which a room gets 2 downlights instead of 1.
   *  Default 6. Range 2–20. Must be ≤ ceilingLightLargeArea. */
  ceilingLightMediumArea?: number;
  // ── Skirting / baseboard (walkthrough only) ─────────────────────────────
  /** Skirting (baseboard) at the foot of interior walls. Default true. */
  skirtingEnabled?: boolean;
  /** Skirting height in cm. Default 8. Range 4–20. */
  skirtingHeight?: number;
  /** Skirting paint color. Hex string. Default '#9C8A70' (warm walnut). */
  skirtingColor?: string;
  // ── Window frame strip thickness ────────────────────────────────────────
  /** Vertical (left + right) window frame strip width in cm. Default 4.
   *  Range 2–12. Higher = chunkier sash-bar look. */
  windowFrameStripVCm?: number;
  /** Horizontal (top + bottom) window frame strip thickness in cm.
   *  Default 8. Range 2–16. Setting higher than vertical gives a more
   *  traditional sash-window look; setting equal gives a uniform metal
   *  frame. */
  windowFrameStripHCm?: number;
  /** Walkthrough window center mullion (the vertical bar between the
   *  two sliding sashes) width in cm. Default 4. Range 0–10.
   *  0 = no mullion, gives a frameless modern look. */
  windowCenterMullionCm?: number;
  /** Ceiling downlight housing radius (cm). Default 8. Range 4–15.
   *  Larger = bigger downlight cans (more dramatic ceiling presence). */
  ceilingLightRadiusCm?: number;
  /** Ceiling downlight emissive intensity. Default 3.5. Range 0.5–6.0.
   *  Higher = brighter glow disc (visible ceiling light source). */
  ceilingLightIntensity?: number;
  /** Ceiling downlight glow color. Hex string. Default '#FFF5D0' (warm
   *  white). Try '#E4E8FF' for cool daylight or '#FF9F50' for sodium-
   *  vapour warm. */
  ceilingLightColor?: string;
  /** Window sill (the stone band under each window) paint color.
   *  Hex string. Default '#B8B4AC' (limestone). */
  windowSillColor?: string;
  /** Window lintel (the cast-concrete band above each window) color.
   *  Hex string. Default '#C0BCB4' (off-white concrete). */
  windowLintelColor?: string;
  /** Window jamb (side reveals — the depth recess around each window
   *  opening) color. Hex string. Default '#BCBAB2'. */
  windowJambColor?: string;
  /** Window jamb depth in cm. Default 9. Range 4–20. Controls how
   *  deeply the reveal punches back from the wall face. */
  windowJambDepthCm?: number;
  /** Interior ceiling paint color. Hex string. Default '#F5F2EE'
   *  (warm off-white). Try '#1E1E22' for a moody dark ceiling. */
  roomCeilingColor?: string;
  /** Flat-roof slab + eave color (the top deck visible from above /
   *  from the eaves below). Hex. Default '#F0EDE8' (warm off-white).
   *  Try '#3A3E48' for a charcoal modern look. */
  roofSlabColor?: string;
  /** Parapet wall color (the low wall around the roof terrace).
   *  Hex. Default '#E8E4DE'. Often matches the facade but can be
   *  set independently for contrast. */
  parapetColor?: string;
  /** Hallway ceiling slat color (the thin top board that visually
   *  caps the corridor). Hex. Default '#E8E4DC'. */
  hallwayCeilingColor?: string;
  /** Wrought-iron flower-box body color. Hex. Default '#2A2C34'
   *  (warm charcoal). The cap rim of the box is auto-derived from
   *  this so a single picker drives the whole flower-box look. */
  windowFlowerBoxColor?: string;
  /** Roof exhaust / vent stack metal color. Hex. Default '#606468'
   *  (galvanised steel). Cap cowl darkens ~25 % below this value
   *  automatically. */
  roofVentColor?: string;
  /** Flower-box foliage base color (the leafy mounds in each window
   *  flower box). Hex. Default '#3E7428' (mid foliage green). Per-
   *  bush variation still hashes ±20 % brightness for natural look. */
  flowerFoliageColor?: string;
  /** Flower bloom base color (the colourful dots above foliage).
   *  Hex. Default '#E83040' (geranium red). Try '#9940CC' for
   *  bougainvillea or '#F0F0F0' for jasmine white. */
  flowerBloomColor?: string;
}

// ─── Facade component system ────────────────────────────────────────────────

export type FacadeSegmentType = "glass" | "solid" | "window" | "door" | "column";

/**
 * One vertical strip of a wall face on a single storey.
 * Multiple segments compose a full-width elevation.
 */
export interface FacadeSegment {
  id:            string;
  type:          FacadeSegmentType;
  /** Fraction of the total wall width — all segments on a floor must sum to 1. */
  widthFraction: number;
  material?:     WallMaterialType;
  color?:        string;
  /** Glass-specific: number of mullion subdivisions. Default auto from width. */
  panelCount?:   number;
  /** Frame / trim color for glass or window segments. */
  frameColor?:   string;
}

/**
 * The facade layout for a single storey on one wall face.
 * An array of FacadeSegment ordered left→right (as seen from outside).
 */
export interface FloorFacade {
  segments: FacadeSegment[];
}

/** A decor item pinned to the OUTSIDE face of a room wall. Stored inside
 *  the owning room (see `RoomState.exteriorDecor`). Cardinal-direction
 *  naming: N = -Z (back), S = +Z (front), W = -X (left), E = +X (right).
 *  Normalized u/v coords span the wall rectangle (0 = left/bottom, 1 =
 *  right/top as viewed from outside). */
export type ExteriorWall = WallSide; // = "N" | "S" | "W" | "E"

export interface ExteriorWallDecorItem {
  instanceId: string;
  furnitureId: string;
  wall: ExteriorWall;
  /** 0 = left edge, 1 = right edge (viewed from outside). */
  u: number;
  /** 0 = floor, 1 = ceiling of the room's height. */
  v: number;
  /** Width/height scale multipliers (default 1). */
  scaleW?: number;
  scaleH?: number;
  /** In-plane rotation in degrees (0 = upright). */
  rotation?: number;
}

export type StyleTag = "现代" | "北欧" | "中式" | "日式" | "轻奢" | "工业风";

export type MaterialCategory = "wall" | "floor" | "ceiling" | "light" | "tile";

export type FurnitureCategory =
  | "sofa" | "coffee_table" | "tv_unit" | "bookshelf" | "sideboard"
  | "bed" | "nightstand" | "wardrobe" | "dresser"
  | "dining_table" | "dining_chair"
  | "kitchen_cabinet" | "refrigerator" | "range_hood" | "kitchen_sink"
  | "toilet" | "bathtub" | "shower" | "bathroom_vanity"
  | "desk" | "office_chair" | "storage"
  | "plant" | "rug" | "artwork" | "floor_lamp" | "curtain" | "exterior_wall_decor"
  | "bath_accessory" | "electrical" | "plumbing"
  | "outdoor_plant" | "outdoor_hardscape" | "outdoor_water" | "outdoor_structure"
  | "pet" | "livestock";

export interface MaterialItem {
  id: string;
  name: string;
  brand: string;
  price: number;
  unit: string;
  category: MaterialCategory;
  color: string;
  texture?: string;
  tags: StyleTag[];
  description: string;
}

export interface FurnitureItem {
  id: string;
  name: string;
  brand: string;
  price: number;
  unit: string;
  category: FurnitureCategory;
  roomTypes: RoomType[];
  color: string;
  secondaryColor?: string;
  width: number;   // cm footprint width
  depth: number;   // cm footprint depth
  height: number;  // cm height
  tags: StyleTag[];
  description: string;
  icon: string;    // emoji for floor plan
  /** For the `artwork` category: URL of a public-domain painting image
   *  (JPG/PNG) to texture the front face of the artwork in 3D. Stored in
   *  public/artworks/ and downloaded via scripts/download-artworks.mjs. */
  imageUrl?: string;
  /** Optional glTF/GLB model path. When set, 3D view renders the real
   *  asset instead of the procedural box mesh. Path is relative to the
   *  site root (e.g. "/models/sofa/nordic-3seat.glb"). See
   *  docs/3d-assets.md for the expected coordinate conventions. */
  model3d?: {
    /** Absolute URL or site-root-relative path to a .glb / .gltf file. */
    url: string;
    /** Extra uniform scale multiplier (default 1). Use when the asset's
     *  exported size doesn't match the declared width/depth/height. */
    scale?: number;
    /** Extra Y-axis rotation in radians (default 0). Use when the
     *  asset's forward vector doesn't match this project's +Z-front. */
    rotation?: number;
    /** Y offset in meters to push the model up/down from floor level.
     *  Use when the asset's pivot isn't at the base. */
    yOffset?: number;
  };
}

export interface WindowConfig {
  id: string;
  wall: WallSide;
  pos: number;   // cm from wall start (left or top)
  len: number;   // cm length (width along wall)
  h?: number;    // cm height (vertical), default 150
  sill?: number; // cm from floor to bottom of window, default 90
  /** Visual style. Default "sliding" (国内推拉窗) if unset. */
  style?: WindowStyle;
  /** Polygon-room only: explicit polygon edge index. When set, the renderer
   *  binds this window to that exact edge and `pos` is interpreted as the
   *  offset along that edge (cm from the edge's start vertex). Required for
   *  inner-corner walls of L / convex shapes that cannot be addressed by
   *  the bbox-projected (wall, pos) tuple. */
  edgeIndex?: number;
}

/** Multi-door support. Same shape as WindowConfig but with door-specific
 *  fields (style + height). A room can have any number of doors, each
 *  bound either to a cardinal wall (rect rooms) or an explicit polygon
 *  edge (L / convex). */
export interface DoorConfig {
  id: string;
  wall: WallSide;
  pos: number;   // cm offset from wall / edge start
  len: number;   // cm width along wall (default 80)
  h?: number;    // cm height (default 200)
  style?: DoorStyle;
  edgeIndex?: number;
}

/** Window visual styles. */
export type WindowStyle =
  | "sliding"   // 推拉窗（中间一条竖轨，国内最常见）
  | "casement"  // 平开窗（单整块玻璃，向外开）
  | "fixed"     // 固定观景窗（无分隔）
  | "louvered"  // 百叶窗（水平条）
  | "security"  // 防盗窗（铁艺栏栅，不可开启）
  | "wooden";   // 木窗（复古/中式/乡村风）

export interface PlacedItem {
  instanceId: string;
  furnitureId: string;
  x: number;          // cm from left wall (0 = left wall)
  z: number;          // cm from back wall (0 = back wall)
  rotation: number;   // degrees: 0, 90, 180, 270
  scaleW?: number;    // width scale multiplier (default 1.0)
  scaleD?: number;    // depth scale multiplier (default 1.0)
  scaleH?: number;    // height scale multiplier (default 1.0)
  elevationY?: number; // cm above floor (default 0 = on floor)
  /** When true, the item is mounted to the CEILING instead of the floor.
   *  Renderer anchors the item's TOP at ceiling (elevationY ignored).
   *  Use for 吊灯/吊扇/吸顶装饰 etc. */
  mountCeiling?: boolean;
}

/** Which of the 4 walls an override applies to. Cardinal-direction
 *  naming: N (back, world -Z), S (front, world +Z), W (left, world -X),
 *  E (right, world +X). Dollhouse view hides `S` (front) but we still
 *  track the data for 2D plan + future views. */
export type WallSide = "N" | "S" | "W" | "E";

export interface RoomMaterials {
  /** Default wall material — applied to any side without an override. */
  wall?: MaterialItem;
  floor?: MaterialItem;
  ceiling?: MaterialItem;
  light?: MaterialItem;
  tile?: MaterialItem;
  /** Optional lower-wall material (墙裙/护墙板). When set, walls render
   *  as two stacked bands: lower band from floor to `wallSplitHeight`
   *  uses this material; upper band uses the per-side wall material. */
  wallLower?: MaterialItem;
  /** Height in cm where upper and lower wall materials meet. Default
   *  110cm (chair-rail height). Only used when `wallLower` is set. */
  wallSplitHeight?: number;
  /** Per-side wall material overrides (沙发/床头背景墙). Any side without
   *  an override falls back to `wall`. Allows 4-color walls in one room. */
  wallBack?: MaterialItem;
  wallFront?: MaterialItem;
  wallLeft?: MaterialItem;
  wallRight?: MaterialItem;
  /** Exterior-facing material default — applies to any outside wall
   *  face that doesn't have an explicit per-side override below. When
   *  unset and no per-side override exists, the outside face uses the
   *  same material as the inside (interior color shows through). */
  wallExterior?: MaterialItem;
  /** Per-side EXTERIOR overrides — each face can be a different colour.
   *  Falls back to `wallExterior`, then to the interior material. */
  wallBackExterior?: MaterialItem;
  wallFrontExterior?: MaterialItem;
  wallLeftExterior?: MaterialItem;
  wallRightExterior?: MaterialItem;
}

export interface RoomDef {
  width: number;   // cm
  depth: number;   // cm
  height: number;  // cm
  name: string;
  icon: string;
  defaultWallColor: string;
  defaultFloorColor: string;
  hasWindow: boolean;
  windowWall: "N" | "E" | "W" | "none";
  isCustom?: boolean;
  isOutdoor?: boolean;
  isRooftopOnly?: boolean;
}

export const ROOM_DEFS: Record<RoomType, RoomDef> = {
  living:    { width: 500, depth: 420, height: 280, name: "客厅",    icon: "🛋️", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: true,  windowWall: "E"     },
  master:    { width: 400, depth: 360, height: 280, name: "主卧",    icon: "🛏️", defaultWallColor: "#EAE5DC", defaultFloorColor: "#C8A882", hasWindow: true,  windowWall: "E"     },
  bedroom:   { width: 320, depth: 300, height: 280, name: "次卧",    icon: "🛏️", defaultWallColor: "#EEF0F5", defaultFloorColor: "#C8B890", hasWindow: true,  windowWall: "N"     },
  bedroom2:  { width: 300, depth: 280, height: 280, name: "次卧2",   icon: "🛏️", defaultWallColor: "#EEF0F5", defaultFloorColor: "#C8B890", hasWindow: true,  windowWall: "N"     },
  bedroom3:  { width: 280, depth: 260, height: 280, name: "次卧3",   icon: "🛏️", defaultWallColor: "#EEF0F5", defaultFloorColor: "#C8B890", hasWindow: true,  windowWall: "N"     },
  kitchen:   { width: 360, depth: 280, height: 270, name: "厨房",    icon: "🍳", defaultWallColor: "#FFFFFF", defaultFloorColor: "#E8E8E8", hasWindow: true,  windowWall: "N"     },
  bathroom:  { width: 260, depth: 220, height: 260, name: "卫生间",  icon: "🚿", defaultWallColor: "#F5F5F5", defaultFloorColor: "#DCDCDC", hasWindow: false, windowWall: "none"  },
  bathroom2: { width: 240, depth: 200, height: 260, name: "卫生间2", icon: "🚿", defaultWallColor: "#F5F5F5", defaultFloorColor: "#DCDCDC", hasWindow: false, windowWall: "none"  },
  dining:    { width: 380, depth: 320, height: 280, name: "餐厅",    icon: "🍽️", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: true,  windowWall: "E"     },
  study:     { width: 320, depth: 290, height: 280, name: "书房",    icon: "📚", defaultWallColor: "#E8E0D8", defaultFloorColor: "#B89060", hasWindow: true,  windowWall: "N"     },
  study2:    { width: 300, depth: 260, height: 280, name: "书房2",   icon: "📚", defaultWallColor: "#E8E0D8", defaultFloorColor: "#B89060", hasWindow: true,  windowWall: "N"     },
  closet:    { width: 260, depth: 200, height: 260, name: "衣帽间",  icon: "👗", defaultWallColor: "#F5F0E8", defaultFloorColor: "#D4C0A0", hasWindow: false, windowWall: "none"  },
  balcony:   { width: 420, depth: 160, height: 280, name: "阳台",    icon: "🌿", defaultWallColor: "#E8E8E0", defaultFloorColor: "#A0A098", hasWindow: true,  windowWall: "N"     },
  balcony2:  { width: 300, depth: 160, height: 280, name: "阳台2",   icon: "🌿", defaultWallColor: "#E8E8E0", defaultFloorColor: "#A0A098", hasWindow: true,  windowWall: "N"     },
  // Outdoor
  yard:      { width: 800, depth: 600, height: 0,   name: "院子",    icon: "🏡", defaultWallColor: "#6B8E60", defaultFloorColor: "#7CAF5A", hasWindow: false, windowWall: "none", isOutdoor: true },
  garage:    { width: 500, depth: 320, height: 260, name: "车库",    icon: "🚗", defaultWallColor: "#D0CEC8", defaultFloorColor: "#B0AEA8", hasWindow: true,  windowWall: "E"     },
  gym:       { width: 360, depth: 320, height: 280, name: "健身房",  icon: "🏋️", defaultWallColor: "#E8E8E8", defaultFloorColor: "#C0C0C0", hasWindow: true,  windowWall: "N"     },
  cinema:    { width: 420, depth: 320, height: 280, name: "影音室",  icon: "🎬", defaultWallColor: "#1A1A2E", defaultFloorColor: "#16213E", hasWindow: false, windowWall: "none"  },
  // Custom slots
  custom1:   { width: 300, depth: 300, height: 280, name: "自定义1", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
  custom2:   { width: 300, depth: 300, height: 280, name: "自定义2", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
  custom3:   { width: 300, depth: 300, height: 280, name: "自定义3", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
  custom4:   { width: 300, depth: 300, height: 280, name: "自定义4", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
  custom5:   { width: 300, depth: 300, height: 280, name: "自定义5", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
  stair:     { width: 260, depth: 220, height: 280, name: "楼梯间", icon: "🪜", defaultWallColor: "#F5F0E8", defaultFloorColor: "#C8B888", hasWindow: false, windowWall: "none" },
  hallway:   { width: 120, depth: 300, height: 280, name: "走廊",   icon: "🚶", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C4BAA6", hasWindow: false, windowWall: "none" },
  // 户外结构 —— 当作 isOutdoor 房间处理（不参与室内 facade/家具/外墙等），
  // 位置和尺寸都由用户在 floor plan 里精确控制，3D 渲染时可换 GLB
  pool:      { width: 600, depth: 350, height: 0,   name: "泳池",   icon: "🏊", defaultWallColor: "#C8DCE8", defaultFloorColor: "#3B82F6", hasWindow: false, windowWall: "none", isOutdoor: true },
  terrace:   { width: 500, depth: 300, height: 0,   name: "露台",   icon: "🌅", defaultWallColor: "#E0D5C0", defaultFloorColor: "#D8C8A8", hasWindow: false, windowWall: "none", isOutdoor: true },
  deck:      { width: 400, depth: 250, height: 0,   name: "木栈台", icon: "🪵", defaultWallColor: "#A07050", defaultFloorColor: "#8B6340", hasWindow: false, windowWall: "none", isOutdoor: true },
  // ── 屋顶层专属 ──
  rooftop_lounge:  { width: 500, depth: 400, height: 0, name: "天台休闲区", icon: "🛋️", defaultWallColor: "#F0EDE5", defaultFloorColor: "#C8B898", hasWindow: false, windowWall: "none", isOutdoor: true, isRooftopOnly: true },
  rooftop_pool:    { width: 600, depth: 350, height: 0, name: "屋顶泳池",   icon: "🏊", defaultWallColor: "#C8DCE8", defaultFloorColor: "#3B82F6", hasWindow: false, windowWall: "none", isOutdoor: true, isRooftopOnly: true },
  rooftop_garden:  { width: 500, depth: 400, height: 0, name: "屋顶花园",   icon: "🌿", defaultWallColor: "#6B8E60", defaultFloorColor: "#7CAF5A", hasWindow: false, windowWall: "none", isOutdoor: true, isRooftopOnly: true },
  rooftop_bar:     { width: 400, depth: 300, height: 0, name: "天台酒吧",   icon: "🍸", defaultWallColor: "#2D2D3A", defaultFloorColor: "#4A3C28", hasWindow: false, windowWall: "none", isOutdoor: true, isRooftopOnly: true },
  equipment_room:  { width: 300, depth: 250, height: 250, name: "设备间",   icon: "⚙️", defaultWallColor: "#D0CEC8", defaultFloorColor: "#B0AEA8", hasWindow: false, windowWall: "none", isRooftopOnly: true },
};

// ─── Room state ────────────────────────────────────────────
export interface RoomState {
  materials: RoomMaterials;
  placedItems: PlacedItem[];
  /** Decor pinned to the OUTSIDE face of this room's walls (外墙装饰：
   *  壁灯、门牌、信箱、爬藤…). Visible in RoomCanvas when the camera
   *  orbits outside the room, and in HouseCanvas on the corresponding
   *  house-perimeter segment. */
  exteriorDecor?: ExteriorWallDecorItem[];
  /** Pipe/wire routing — connections between water/electrical point
   *  fixtures placed in this room. Drawn in the 2D plan view. */
  connections?: RoutingConnection[];
  /** 户外结构房间（pool/terrace/deck 等 isOutdoor）可指定一个 GLB 资产
   *  来替代程序化几何。例如把泳池换成自带瓷砖纹理的 GLB 模型。
   *  字符串是 customGltfPath（参考 outdoorAssets.ts 里的 PBR 资产）。
   *  室内房间忽略此字段。 */
  outdoorGlb?: string;
}

/** A single routing segment between two fixture instanceIds. The kind
 *  determines color + which fixture categories are valid endpoints. */
export interface RoutingConnection {
  id: string;
  /** instanceId of source PlacedItem */
  from: string;
  /** instanceId of destination PlacedItem */
  to: string;
  kind: RoutingKind;
}

export type RoutingKind = "wire" | "cold-water" | "hot-water" | "drain";

// ─── Per-floor independent floor plan ─────────────────────
export interface FloorPlan {
  rooms: Record<RoomType, RoomState>;
  enabledRooms: RoomType[];
  roomLayout: Record<RoomType, { x: number; y: number }>;
  roomDimensions: Record<RoomType, { width: number; depth: number }>;
  roomWindows: Record<RoomType, WindowConfig[]>;
  roomDoorPos: Record<RoomType, number>;
  roomHasDoor: Record<RoomType, boolean>;
  roomDoorWall: Record<RoomType, WallSide>;
  /** Per-room wall hide flags. Two key styles share the inner record:
   *    - cardinal: "N" | "S" | "W" | "E" — rect rooms +
   *      RoomShell-rendered rooms (single facing).
   *    - polygon edge: "edge-${i}" where `i` is the index into the
   *      room's roomShape.points polygon. Polygon rooms can have many
   *      walls per facing ("南墙1", "南墙2"…), each needing independent
   *      hide control.
   *  Renderers / FloorPlan UI map between the two styles. Missing flag
   *  = visible. Lets the user merge two rooms visually by hiding the
   *  shared wall. Walkthrough collision is unaffected. */
  roomWallsHidden?: Partial<Record<RoomType, Partial<Record<string, boolean>>>>;
  roomDoorLen?: Partial<Record<RoomType, number>>; // cm, width along wall (default 80)
  roomDoorH?: Partial<Record<RoomType, number>>;   // cm, height (default 200)
  /** Per-room door style. Default "wood_panel" if unset. */
  roomDoorStyle?: Partial<Record<RoomType, DoorStyle>>;
  /** Polygon-room only: explicit polygon edge index for the legacy door.
   *  Required for inner-corner walls of L / convex shapes. */
  roomDoorEdgeIdx?: Partial<Record<RoomType, number>>;
  /** Multi-door array. New schema — supersedes the legacy single
   *  roomDoorWall/Pos/Len fields when present. Old saves are migrated
   *  on read by `getRoomDoors()` in [@/lib/store]. */
  roomDoors?: Partial<Record<RoomType, DoorConfig[]>>;
  /** Per-room non-rectangular polygon override (L型/凸字型/etc).
   *  Absent entry = rectangle fallback using roomDimensions. */
  roomShapes?: Partial<Record<RoomType, import("./roomGeometry").RoomShape>>;
  /** Per-room exterior facade style override. Controls how the OUTSIDE face
   *  of this room's exterior walls is rendered in 效果图 (FloorPlanExterior).
   *  - "glass":    full-height glass curtain wall
   *  - "concrete": opaque concrete facade with windows cut out
   *  - undefined / "auto": automatic — long segments + many windows ⇒ glass,
   *                        otherwise concrete (legacy behaviour). */
  roomExteriorStyle?: Partial<Record<RoomType, "glass" | "concrete" | "auto">>;
  /** Outdoor yard plan for THIS floor (only floor 0 is rendered in 3D
   *  exterior view; others are reserved for future "ground vs roof deck"
   *  distinction). Drawn by user in the 院子图 (yard2d) view. */
  yardPlan?: YardPlan;
  /** Stair shape / orientation config (only meaningful when "stair" room is enabled). */
  stairConfig?: StairConfig;
}

/** Staircase appearance configuration used in the 2-D floor plan. */
export interface StairConfig {
  /** Visual shape of the stair symbol */
  shape: "straight" | "L-shaped" | "spiral";
  /** Rotation of the whole stair block in degrees (0 | 90 | 180 | 270).
   *  For straight: 0 = treads horizontal, ascending toward top-left.
   *  For L-shaped: 0 = first run goes up, second turns right. */
  rotation: 0 | 90 | 180 | 270;
  /** L-shaped only: which side the turn goes toward. */
  turnSide?: "left" | "right";
  /** Number of treads visible in each run (default auto-computed from room depth) */
  risers?: number;
}

/** Interior-door visual styles. Each variant is rendered differently by
 *  RoomDoor3D and listed in the door style picker (2D edit mode). */
export type DoorStyle =
  | "wood_panel"     // 实木门板（默认，带面板线条）
  | "frosted_glass"  // 磨砂玻璃木框门
  | "sliding_barn"   // 谷仓推拉门
  | "french_double"; // 法式对开玻璃门

// For wall/floor area estimation (m²)
export function getRoomArea(room: RoomType): { wall: number; floor: number } {
  const def = ROOM_DEFS[room];
  const floor = Math.round((def.width * def.depth) / 10000);
  const wall = Math.round((2 * (def.width + def.depth) * def.height) / 10000);
  return { wall, floor };
}
