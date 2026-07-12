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
  | "pergola"    // 凉亭（户外结构房间，添加即自带凉亭骨架家具）
  | "equipment_room";  // 设备间（普通封闭房间，任意楼层可用）

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
  /** Optional footprint override in centimetres. When set, overrides
   *  the default footprint from PREFAB_REGISTRY for both the 2D plan
   *  dashed box and the 3D mesh scale. */
  footprintCm?: { w: number; d: number };
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
  // ── Window appearance (user-configurable; was previously hardcoded) ─────
  /** Window glass tint in daytime. Hex string. Reads as a dark "punch-hole"
   *  against the cream facade. Default '#3E5066' (dark slate-blue). */
  windowGlassColor?: string;
  /** Dev-only: when true, the live R3F scene is published on window.__SCENE for
   *  introspection/debugging. Default false (off). Configurable; leaves no
   *  trace in production when unset. */
  debugExposeScene?: boolean;
  /** Exterior facade glass dials (per-room window panes in 外观). These tune
   *  how "glassy" vs "see-through" the panes read. Defaults make windows
   *  reflect the sky (light steel-blue, low transmission, high opacity) so they
   *  no longer read as flat black holes punched in the wall. */
  windowGlassTransmission?: number; // default 0.12 (0 = fully reflective, 1 = clear)
  windowGlassOpacity?: number;      // default 0.90
  windowGlassReflect?: number;      // default 0.70 (envMapIntensity — sky reflection)
  windowGlassRoughness?: number;    // default 0.10 (lower = glossier mirror)
  /** Window frame color (aluminium / millwork). Hex string. Falls back to
   *  ExteriorSettings.accentColor, then to '#3A4150' (dark anodised). */
  windowFrameColor?: string;
  /** Exterior window-frame sky reflection (envMapIntensity). Default 0.14
   *  (low — keeps the frame matte so it doesn't mirror the bright sky HDR
   *  into the same cream tone as the wall and make the window vanish). */
  windowFrameReflect?: number;
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
  /** Forward offset (m) of the exterior window detail so the glass clears the
   *  12 cm-thick facade wall box and is visible from outside. Default 0.05.
   *  Lower it toward 0 only if the wall is made thinner; raise it if windows
   *  read as recessed/occluded. */
  windowProtrude?: number;
  /** 外观图（非漫游）是否使用与效果图/室内漫游同源的"透明立面"渲染：
   *  关闭实心 ConcreteFacade 立面叠加层，露出带真实窗洞的墙体，并用共享
   *  <StyledWindow>（透明玻璃，按 win.style 渲染）填充窗洞 —— 这样外观图
   *  的窗型、玻璃通透度、墙面配色与效果图/室内漫游完全一致，可隔窗看到室内。
   *  false → 旧的实心立面外观（混凝土/木饰面/玻璃幕墙 + 程序化不透明窗）。
   *  Default true. */
  transparentExterior?: boolean;
  /** 外观图（透明立面）下室内补光强度系数（0..~1.5）。透明立面把墙体露成
   *  带真实窗洞的几何体后，室内默认是发黑的，从外面看窗户透不出内容（一片
   *  惨白玻璃）。点亮室内（每层一组暖色顶灯，强度 = 室内漫游值 × 本系数），
   *  光透过窗洞，外观图的窗户就有了「亮堂的室内」层次，和外观漫游图一样清晰。
   *  0 = 关闭（室内保持黑，回到旧的惨白窗）。Default 0.6。
   *  仅在 transparentExterior 开启的平面图驱动外观图生效，不影响室内漫游。 */
  exteriorInteriorFillIntensity?: number;
  /** 透明立面外观图的窗框颜色（Hex）。从外面大白天看，纯白窗框会糊进近纯白
   *  的墙体里导致窗户「消失」；给窗框一个有存在感的中性轮廓色，窗户立刻清晰
   *  可读（接近外观漫游图的观感）。Default '#6E6A60'（暖灰）。
   *  仅作用于 transparentExterior 外观图，不影响室内漫游（仍用白框）。 */
  transparentExteriorFrameColor?: string;
  /** 外观图（透明立面）专用玻璃外观——大白天从外面看，全透玻璃显示的颜色≈墙色，
   *  窗户会糊进墙里。这组参数把外观图的玻璃做成「可见的有色反光玻璃」（偏蓝灰、
   *  低通透、带一点反射），让门窗像真实建筑玻璃一样明显跳出墙面。
   *  仅作用于外观图，室内漫游仍是高通透全透玻璃。 */
  /** 外观图玻璃透射率 0..1。注意 >0 会折射式透出明亮背景导致惨白，默认 0
   *  改用 opacity+color 做成可见的半透实体玻璃面板。Default 0。 */
  exteriorWindowGlassTransmission?: number;
  /** 外观图玻璃不透明度 0..1，越高越像实体玻璃面板。Default 0.82。 */
  exteriorWindowGlassOpacity?: number;
  /** 外观图玻璃颜色（Hex），偏蓝灰更像建筑玻璃。Default '#8FA3B2'。 */
  exteriorWindowGlassColor?: string;
  /** 外观图玻璃环境反射强度 0..~1，给玻璃一点天空反射的层次。Default 0.6。 */
  exteriorWindowGlassEnvMapIntensity?: number;
  /** 外观图玻璃粗糙度 0..1。Default 0.12。 */
  exteriorWindowGlassRoughness?: number;
  /** 外观图玻璃凸出墙面的距离（米）。实测玻璃落在墙体厚度（WALL_T=0.12m）中线
   *  时，大白天斜视角下会被墙体几何挡住（关掉 depthTest 才看得到 → 证明是遮挡
   *  非颜色问题）。把外观玻璃往外推到墙体前表面之外，玻璃永不被墙挡，门窗立刻
   *  能从墙里读出来。Default 0.06（略大于半墙厚）。仅作用于外观图。 */
  exteriorWindowProtrude?: number;
  /** 透明立面外观图的入户/房门门框颜色（Hex）。和窗框同理：大白天近白门框会
   *  糊进近白墙体里导致门「消失」；给门框一个有存在感的中性轮廓色，门立刻清晰
   *  可读。缺省回退到 transparentExteriorFrameColor，最终默认 '#6E6A60'（暖灰）。
   *  仅作用于 transparentExterior 外观图，不影响室内漫游（仍用浅色门框）。 */
  transparentExteriorDoorFrameColor?: string;
  /** 外观图里把门沿墙体外法线往外推的距离（米）。和外观窗玻璃凸出同理：门默认
   *  坐在墙体内侧（D/2-0.08），落在墙体厚度后方，大白天斜视角下被墙挡住，门
   *  「消失」。往外推到墙体前表面之外，门凸出墙面、永不被挡，从外面立刻能读出
   *  来。Default 0.16。仅作用于外观图，室内漫游门位置不变（传 0）。 */
  exteriorDoorProtrude?: number;
  /** 是否在外观图/漫游里渲染楼梯间的门窗（楼梯间原本只渲染楼梯几何体，门窗被
   *  !isStair 跳过 → 楼梯间配的百叶窗/门在外观图不显示）。Default true。 */
  renderStairOpenings?: boolean;
  /** 通行空间（楼梯间 / 走廊）是否像普通房间一样渲染墙面装饰 —— 四壁、门、
   *  窗、踢脚线、吸顶灯。原本这些被 `!isStair && !isHallway` 硬编码跳过
   *  （通行空间借用相邻房间的墙）。这是一个可调试开关：Default false（保持
   *  通行空间无装饰的结构性约定），打开后通行空间也长门窗/踢脚/吸顶灯，
   *  方便排查"楼梯间为什么不画墙"之类问题。 */
  circulationDecor?: boolean;
  /** 楼梯间在上层（fi>0）是否渲染实心楼板。原本硬编码 `!(isStair && fi>0)`
   *  跳过 —— 上层楼梯间是楼梯井开口，没楼板下层才能上来。可调试开关：
   *  Default false（保持楼梯井开口）；打开后上层楼梯间也铺实心楼板。 */
  stairFloorSlab?: boolean;
  /** 天台楼梯口是否加盖「出屋面间」（带门带顶的小屋，门开在踏出天台那一侧）。
   *  挡雨遮风，避免雨水顺楼梯口灌入下层。Default true。关掉则楼梯口露天，
   *  仅保留开口安全护栏。 */
  stairPenthouse?: boolean;
  /** 顶层楼梯间（上方没有更高楼层的那个 stair 房间）默认是否带天花板。
   *  普通中间层楼梯间天花板要留洞让楼梯井贯通，所以默认无顶；但顶层
   *  楼梯间（出屋面间）上方就是天空，无需贯通，默认有顶才能挡雨。
   *  Default true。关掉后顶层楼梯间也露天（仅保留四面墙）。 */
  stairTopFloorCeiling?: boolean;
  /** 天台（屋顶层）的普通房间是否盖顶。天台本质就是一个「没有顶的普通楼层」，
   *  默认露天（false → ceilingHidden）。打开后天台房间像普通楼层一样有天花板/盖顶。
   *  走通用 roomWallsHidden[room].ceiling 机制，不特判天台。 */
  rooftopCeiling?: boolean;
  /** 出屋面间墙体颜色。Hex。Default 同女儿墙色 parapetColor / '#E8E4DE'。 */
  penthouseColor?: string;
  /** 一层客厅是否自动生成入户门（原本硬编码 `fi===0 && room==="living"`）。
   *  可调试开关：Default true（保持入户门）；关掉则一层客厅不再特判入户门。 */
  livingEntryDoor?: boolean;
  /** 外观图里是否允许点击门/窗开合（推拉门滑动、平开窗摆动等）。原本只在室内
   *  漫游 insideBuilding 才响应点击 → 外观图点推拉门没反应。Default true。 */
  exteriorInteractiveOpenings?: boolean;
  /** Outer plaster casing/trim ring color around windows AND entrance doors
   *  on the concrete facade. Hex. Default '#D8D0C2'. */
  windowCasingColor?: string;
  /** Window frame ring forward projection in cm — the proud metal frame that
   *  makes the glass read as set deep behind it (real 3D window depth).
   *  Default 7. Range 2–16. */
  windowFrameDepthCm?: number;
  /** Window frame member width in cm. Default 5.5. Range 3–12. */
  windowFrameMemberCm?: number;
  /** Entrance door leaf color on the concrete facade. Hex.
   *  Default '#9C9699' — gray, matching the 效果图 (interior render)
   *  door_with_frame.gltf door so both views stay visually consistent.
   *  (Glass-facade entrances use entranceFrameColor.) */
  entranceDoorColor?: string;
  /** Entrance door casing/frame color on the concrete facade. Hex.
   *  Default '#C7C4C7' — light gray matching the 效果图 door frame. */
  entranceCasingColor?: string;
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
  /** Flower-box foliage base color (the leafy mounds in each window
   *  flower box). Hex. Default '#3E7428' (mid foliage green). Per-
   *  bush variation still hashes ±20 % brightness for natural look. */
  flowerFoliageColor?: string;
  /** Flower bloom base color (the colourful dots above foliage).
   *  Hex. Default '#E83040' (geranium red). Try '#9940CC' for
   *  bougainvillea or '#F0F0F0' for jasmine white. */
  flowerBloomColor?: string;
  /** Concrete facade base color (the wall panels themselves).
   *  Hex. Default '#E6E0D8' (warm-white render). This is the OUTER
   *  facade surface — distinct from `wallColor`, which paints
   *  interior room boxes. */
  wallBaseColor?: string;
  /** Concrete facade groove shadow color (the thin lines between
   *  panels). Hex. Default '#C0BAB2'. */
  wallGrooveColor?: string;
  /** Skirting strip thickness in cm (how far it protrudes from the
   *  wall). Default 1.2. Range 0.5–4. Higher = chunkier ornate
   *  baseboard; lower = flush modern reveal. */
  skirtingThicknessCm?: number;
  /** Hallway ceiling cap thickness in cm. Default 8. Range 3–20. */
  hallwayCeilingThicknessCm?: number;
  /** Flat-roof slab thickness in cm. Default 10. Range 5–30. Higher
   *  reads as a beefier cantilever; lower for a thin minimal eave. */
  roofSlabThicknessCm?: number;
  /** Parapet wall thickness in cm. Default 12. Range 6–25. Thicker
   *  parapets read more solid / masonry; thinner reads modern metal. */
  parapetThicknessCm?: number;
  /** Parapet inner-cove LED strip (subtle uplight). Default true.
   *  Turns OFF the 4-side LED strip + day/night glow logic. */
  coveLightEnabled?: boolean;
  /** Parapet cove LED emissive color. Hex. Default '#D0E8FF'
   *  (cool white). Try '#FFE4A0' for warm white, '#9050E0' for a
   *  decorative purple-tint terrace. */
  coveLightColor?: string;
  /** Solar PV panel tilt angle in degrees. Default 18 (typical mid-
   *  latitude optimum). Range 0–45. 0 = flush horizontal, 45 =
   *  steep winter-optimised. */
  solarPanelTiltDeg?: number;
  /** Solar PV panel frame color (the anodised-aluminium edge band).
   *  Hex. Default '#2C3040' (dark anodised). Try '#1A1A1E' for
   *  matt-black bezels or '#A8AEB4' for natural anodised. */
  solarPanelFrameColor?: string;
  /** Solar PV cell-surface color (the monocrystalline silicon).
   *  Hex. Default '#1A1E2E' (dark blue silicon). Cell-busbar grid
   *  lines auto-derive a lighter tone above this. */
  solarPanelCellColor?: string;
  // ── Realism dial (Wallich-inspired naturalisation, 2026-05) ────────────────
  /** Hex tint MULTIPLIED into the grass ground texture + per-blade colour.
   *  Lower the saturation of the procedural grass without ripping out the
   *  worker. Default '#7E8E6A' (muted sage); try '#5F7050' for darker
   *  English-lawn vibe, or '#9AA88A' for sun-bleached prairie. Use white
   *  ('#FFFFFF') to bypass tinting and see the raw worker texture. */
  lawnTint?: string;
  /** Hex top-of-glass colour for window panes — simulates sky reflection on
   *  the upper portion. Default '#3B4A5E' (overcast deep blue). Bottom
   *  half blends to `windowGlassColor`. Pure photoreal look: set both to
   *  the same value to disable the gradient. */
  windowGlassTopColor?: string;
  /** Horizontal mullion (cross-bar) position on each window pane, 0–1 of
   *  pane height. Default 0 (disabled). 0.45–0.55 reads as classic 2-over-2
   *  glazing; 0.30 reads as transom over picture window. */
  windowMullionPos?: number;
  /** Mullion thickness in cm. Default 3. */
  windowMullionThicknessCm?: number;
  /** 0–1 visibility of the panel grout/seam lines on the facade. Default
   *  0.55. 1 = full saturation of `wallGrooveColor`; 0 = grout invisible.
   *  Lowering this is the single biggest "decartoon" lever for the wall. */
  wallPanelGrooveOpacity?: number;
  /** 0–1 amount of per-instance hue + scale jitter applied to yard trees
   *  and shrubs. Default 0.35. 0 = all clones identical; 0.6 = obviously
   *  varied palette. Deterministic per-item id. */
  treeColorJitter?: number;
  /** 0–1 sky/atmosphere haziness. Default 0.15. Boosts drei `<Sky>`
   *  turbidity + adds a soft grey-blue scene fog at the horizon. */
  skyHaze?: number;
  /** 0–1 strength of the inward darkening band drawn just inside each
   *  window's jamb. Reads windows as real openings, not stickers.
   *  Default 0.50. 0 disables. */
  windowRevealShadow?: number;
  /** 0–1 dark AO strip at the bottom of the ground-floor wall. Default 0
   *  (off). Makes the building stop "floating" above the grass. */
  buildingBaseShadow?: number;
  /** 0–1 dark AO strip below the eave / parapet on the top floor.
   *  Default 0 (off). Gives the cantilever a tangible undershadow. */
  eaveShadow?: number;
  /** 0–1 vertical wall vignette overlay. Default 0 (off). Top half gets
   *  a soft white wash, bottom half a soft black wash — fakes
   *  sky-occlusion lighting cheaply. */
  wallVignette?: number;
  /** Hide interior walkthrough walls in the EXTERIOR view so the per-room
   *  tile/brick wall texture (kitchen metro tile, bath tile, etc.) stops
   *  leaking through the cream ConcreteFacade as bright patches. Only
   *  affects the exterior view; walkthrough always renders walls.
   *  Default false (backward-compatible). */
  hideInteriorWalls?: boolean;
  /** Multiplier on the postprocess Bloom intensity (1 = default).
   *  Drop to 0.3–0.5 to kill the "halo at the base of windows" daytime
   *  bloom artifact, or push to 1.5 for a more cinematic look. */
  bloomIntensity?: number;
  /** Multiplier on instanced grass-blade count, 0..2. Default 1
   *  (= 650 blades, mostly near building). 0 disables the carpet
   *  (use when the blades read as falling rain at low camera angles). */
  grassDensity?: number;
  /** Show the cobblestone entry driveway leading south from the building.
   *  Default false — the procedural floor-plan-driven yard is meant to be
   *  1:1 with the user's YardPlan, so the auto-added driveway reads as an
   *  unwanted extra path. Set true to bring it back. */
  entryPathEnabled?: boolean;
  /** Tone-mapping exposure multiplier on the time-of-day baseline.
   *  1 = unchanged, 0.7 = darker / more cinematic, 1.3 = brighter.
   *  Lowering tames the ACES roll-off that produces white halos on
   *  sun-lit cream walls. */
  exposure?: number;
  /** Multiply a procedural stucco/grain texture into the ConcreteFacade
   *  baseColor. Default true (legacy was untextured cream cardboard).
   *  Set false to disable per-preset for pure-glass curtain wall looks. */
  wallStuccoEnabled?: boolean;
  /** Physical size (in metres) of one stucco-grain texture tile on the wall.
   *  Smaller = finer grain, larger = coarser. Default 1.2. Only applies when
   *  wallStuccoEnabled is not false. */
  wallStuccoScale?: number;
  /** Surface roughness of the stuccoed wall material, 0..1. Default 0.85.
   *  Higher = more matte plaster, lower = subtle sheen. */
  wallStuccoRoughness?: number;
  /** Override the EffectComposer Bloom luminanceThreshold (0..1). When unset,
   *  uses the time-of-day default (night 0.84 / dusk 0.82 / day 0.95).
   *  Raising it stops bright matte walls from blooming into halos while
   *  still letting genuine highlights, glass and lights glow. */
  bloomThreshold?: number;
  /**
   * Unified facade engine selector ("hidden-frame curtain wall" model).
   *  · "punched-window" (default) — the honest solid-wall envelope: stucco /
   *    concrete / brick / wood walls with discrete punched window openings.
   *    Correct for classical / Mediterranean / industrial / zen styles.
   *  · "curtain-wall" — the building envelope is expressed as a hidden-frame
   *    curtain wall: black-aluminium mullion grid + vision glass on every
   *    exterior (non-circulation) bay, white concrete slab bands at each floor
   *    line, rendered AT the wall plane (the glass IS the envelope, not a
   *    sticker in front of an opaque box). Per-room `roomExteriorStyle`
   *    ("glass" | "concrete") overrides the per-bay infill; privacy rooms
   *    (bath / stair / hallway) stay as solid stucco infill panels.
   *  This replaces the legacy `facadeGlass` + `transparentExterior` tangle —
   *  when set it is authoritative. Default "punched-window". */
  facadeSystem?: "punched-window" | "curtain-wall";
  /** @deprecated Superseded by `facadeSystem: "curtain-wall"`. Still read as a
   *  back-compat alias (facadeGlass:true ⇒ curtain-wall) so older saved designs
   *  keep working. Prefer setting `facadeSystem`. */
  facadeGlass?: boolean;
  /** Curtain-wall glass opacity multiplier (applied on top of each pane's
   *  base opacity, clamped ≤0.92). Higher = more reflective/less see-through,
   *  so the tower reads as glass rather than a window onto the interior.
   *  Default: 2.1 when facadeGlass is on, 1 otherwise (legacy look). */
  glassOpacity?: number;
  /** Override curtain-wall glass tint (hex). Default keeps the per-pane
   *  cool blue-white. Configurable for e.g. bronze/green glass towers. */
  glassColor?: string;
  /** Curtain-wall spandrel (opaque shadow-box) glass colour. Sits at the
   *  bottom band of each floor's panel. Default soft blue-grey "#283442" so
   *  it harmonises with the vision glass instead of reading as a harsh
   *  near-black band. */
  glassSpandrelColor?: string;
  /** Ground-floor glass entrance: door-frame colour. Default near-black
   *  anodised "#202329". Makes the front door legible against the curtain wall. */
  entranceFrameColor?: string;
  /** Ground-floor glass entrance: pull-handle colour. Default brushed
   *  steel "#C8CDD2". */
  entranceHandleColor?: string;
  /** Project a flat canopy slab over the ground-floor entrance. Default true. */
  entranceCanopy?: boolean;
  /** Render a warm walnut/teak batten soffit (实木格栅吊顶) on the underside of
   *  every floor slab / roof cantilever, instead of the default flat grey
   *  shadow strip. Gives the contemporary glass villa its signature warm
   *  wood underside (matches the reference photo). Default false so other
   *  designs are unaffected; opt in for glass-curtain villas. */
  woodSoffit?: boolean;
  /** Strength multiplier for the glass-facade "wash" point lights that light
   *  up the curtain wall. Default 1. Set 0 to disable. Only applies when
   *  facadeGlass is on — matte (non-glass) walls don't need them and get
   *  blown out to pure white if they fire. */
  facadeWashIntensity?: number;
  /** Backing tint for exterior-facing room-shell walls when facadeGlass is on.
   *  On some faces the glass cladding doesn't fully occlude the white shell
   *  wall; this dark glass-spandrel colour makes those faces read as glass
   *  rather than bright cartoon walls. Default "#1B2531" (dark blue-slate). */
  glassShellColor?: string;
  /** Global default interior-door opening height (cm) used in walkthrough/
   *  exterior when a door has no explicit height. With a 3.0 m ceiling the
   *  legacy 200 cm doors left a 1 m header and the 门洞 read as small/stubby.
   *  Default 240 cm gives a more proportional opening. Per-door `h` still
   *  wins; per-room `roomDoorH` overrides too. */
  interiorDoorHeightCm?: number;

  /** Interior-walkthrough trim colors. The exterior facade uses dark accent
   *  mullions (doorFrameColor / windowFrameColor / windowGlassColor) tuned for
   *  the glass-tower look, but indoors those read as ugly black frames + a dark
   *  mirror pane. These light/natural defaults are used only when standing
   *  inside the building so doors/windows look real. All configurable. */
  interiorDoorFrameColor?: string;   // default "#EFEAE2"
  interiorWindowFrameColor?: string; // default "#EFEAE2"
  interiorWindowGlassColor?: string; // default "#CFE8F7"

  /** Walkthrough floor overscan per edge (cm). Each room's floor is an exact
   *  width×depth rectangle; butted edge-to-edge they leave a hairline seam
   *  that shows the bright background (most visible at open room↔hallway
   *  boundaries). Growing each floor by this margin overlaps neighbours and
   *  hides the seam. The overlap tucks under walls so nothing pokes out.
   *  Default 6 cm. Set 0 to disable. */
  walkthroughFloorBleedCm?: number;
  /** Walkthrough: opaque underlay plane margin (cm) drawn just below each room
   *  floor so any hairline seam at room↔room boundaries cannot show the
   *  background through. Default 20 cm. Set 0 to disable. */
  walkthroughFloorUnderlayCm?: number;
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
  | "lamp" | "appliance" | "electronics" | "decor" | "toy"
  | "bath_accessory" | "electrical" | "plumbing"
  | "outdoor_plant" | "outdoor_hardscape" | "outdoor_water" | "outdoor_structure"
  | "vehicle"
  | "stair"
  | "counter"
  | "person"
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
    /** How to scale the asset into the declared width/depth/height box.
     *  - "contain" (default): uniform scale by the SMALLEST axis ratio so
     *    the model keeps its real proportions and never bursts past the box.
     *    Best for organic/proportioned items (plants, sofas, chairs, lamps).
     *  - "fill": non-uniform scale so the model exactly fills W×D×H. Best for
     *    boxy single appliances (fridge, sink, range hood) whose declared
     *    size is the real product size — no visible distortion since they're
     *    already rectangular, and it fixes the "too small/short" look that
     *    `contain` produces when the native aspect ratio differs.
     *  - "tile": uniform-fit ONE module by depth+height, then repeat it along
     *    the width to fill the declared run length. Best for cabinet runs
     *    where the GLB is a single cabinet module but the catalog declares a
     *    multi-meter counter run (e.g. 2.6m of base cabinets). */
    fit?: "contain" | "fill" | "tile";
    /** Optional hex color to repaint the model's materials. Use when the
     *  source GLB ships with a wrong/placeholder base color (e.g. a Sketchfab
     *  model whose "stainless" fridge is actually exported teal). Each mesh
     *  material's color is set to this and its base-color map dropped so the
     *  flat color shows cleanly. Best for untextured models; on textured ones
     *  it trades surface detail for a correct color. */
    recolor?: string;
    /** 预旋转（度，绕本地 X 轴），在测量包围盒 + fit 缩放【之前】施加，用于把
     *  「换轴/躺着建模」的 GLB（深度当高度、Z 轴朝上）扶正到 Y 朝上。扶正后
     *  fit 才按正确朝向缩放。仅 contain 支持（fill 会畸变，换轴模型用 contain）。 */
    preRotX?: number;
    /** 预旋转（度，绕本地 Z 轴），同 preRotX，用于横倒的模型。 */
    preRotZ?: number;
    /** 加载时剔除的网格名（在测量包围盒 + fit 之前移除）。用于去掉 GLB 里焊死的
     *  多余部件——自带凳的吧台/桌、自带背景墙的窗帘等（名字看 GLB 的 mesh/node，
     *  如 Sketchfab 导出的 "Object_0"）。剔除后 fit 只按剩余部件缩放。 */
    dropMeshNames?: string[];
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
  | "awning"    // 上悬窗（顶部水平铰链，底边向外顶开——幕墙通风扇常见）
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
  /** 横向镜像：沿局部 X 轴翻转（scale.x *= -1）。做左右对称的成对家具。 */
  mirrorX?: boolean;
  /** 纵向镜像：沿局部 Z 轴翻转（scale.z *= -1）。做前后对称。 */
  mirrorZ?: boolean;
  /** 店招灯箱等可写字道具的显示文字（如店名）。 */
  label?: string;
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
  pergola:   { width: 300, depth: 300, height: 0,   name: "凉亭",   icon: "⛩️", defaultWallColor: "#C8A070", defaultFloorColor: "#B8946A", hasWindow: false, windowWall: "none", isOutdoor: true },
  // 设备间：普通封闭小屋（任意楼层可用），天台上也只是「楼层里的一个普通房间」。
  equipment_room:  { width: 300, depth: 250, height: 250, name: "设备间",   icon: "⚙️", defaultWallColor: "#D0CEC8", defaultFloorColor: "#B0AEA8", hasWindow: false, windowWall: "none" },
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
  /** Per-face facade LAYER overrides (curtain-wall era). Each exterior face
   *  (same key styles as roomWallsHidden: "N"/"S"/"W"/"E" or "edge-${i}") has
   *  three independently controllable layers — 实墙(wall) / 玻璃幕墙(glass) /
   *  框架(frame) — plus a per-face glass transparency.
   *
   *  Each visibility flag is TRI-STATE: `true` = force show, `false` = force
   *  hide, `undefined` = use the global facade-mode default:
   *    - curtain-wall mode default → wall hidden, glass shown, frame shown
   *    - punched-window mode default → wall shown, glass hidden, frame hidden
   *  This lets the global "玻璃幕墙模式" be a macro (= per face: hide 实墙 +
   *  show 玻璃幕墙 + 框架) while any single layer can still be overridden per
   *  face (墙归墙、幕墙归幕墙、框架归框架).
   *
   *  `opacity` (0..1) overrides the glass transparency for THIS face only;
   *  undefined falls back to the global exterior.glassOpacity. The legacy
   *  roomWallsHidden[side]=true is still honoured as a fallback "wall hidden"
   *  when `wall` here is undefined (back-compat with saved designs). */
  roomFacadeFaces?: Partial<Record<RoomType, Record<string, {
    wall?: boolean; glass?: boolean; frame?: boolean; opacity?: number;
  }>>>;
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
}

/** The three independently-controllable facade layers on an exterior face. */
export type FacadeLayer = "wall" | "glass" | "frame";

/** Mode default visibility for a facade layer (when no per-face override):
 *  curtain-wall → 实墙 hidden, 玻璃幕墙 + 框架 shown;
 *  punched-window → 实墙 shown, 玻璃幕墙 + 框架 hidden. */
export function facadeLayerDefault(layer: FacadeLayer, curtainWall: boolean): boolean {
  return curtainWall ? layer !== "wall" : layer === "wall";
}

/** Resolve whether a facade layer is SHOWN on a given room face.
 *
 *  Precedence (highest → lowest):
 *  1. Explicit per-face override  (roomFacadeFaces[room][side][layer])
 *  2. Legacy wall-hide flag       (roomWallsHidden — wall layer only)
 *  3. Per-room exterior style     (roomExteriorStyle: "glass" | "concrete")
 *  4. Physical adjacency default  (interior wall → solid; exterior wall → mode default)
 *  5. Global mode default         (facadeLayerDefault)
 *
 *  Pass roomLayout / roomDimensions / enabledRooms to enable step 4 so that
 *  interior walls (adjacent rooms in the floor plan) fall back to solid rather
 *  than inheriting the global curtain-wall glass default. */
export function resolveFacadeLayer(
  fp: (Pick<FloorPlan, "roomFacadeFaces" | "roomWallsHidden" | "roomExteriorStyle">
     & Partial<Pick<FloorPlan, "enabledRooms" | "roomLayout" | "roomDimensions">>) | undefined,
  room: RoomType, sideKey: string, layer: FacadeLayer, curtainWall: boolean,
): boolean {
  // 1. Explicit per-face override
  const ov = fp?.roomFacadeFaces?.[room]?.[sideKey]?.[layer];
  if (ov !== undefined) return ov;
  // 1b. 实墙 ↔ 幕墙 互斥：某面显式设了幕墙(glass=true)，实墙层自动关；反之亦然。
  //     一个面要么是实墙要么是玻璃幕墙——若不互斥，不透明实墙(尤其内墙相邻 step4
  //     强制的 solid)会盖在玻璃前面，用户设了幕墙却看到白墙。frame 不参与互斥
  //     （玻璃幕墙本就带框）。
  const face = fp?.roomFacadeFaces?.[room]?.[sideKey];
  if (layer === "wall"  && face?.glass === true) return false;
  if (layer === "glass" && face?.wall  === true) return false;
  // 2. 隐藏墙 = 整面开敞：实墙/玻璃幕墙/框架三层全隐（不只去实墙）。
  //    用户在「隐藏」里勾掉某面，期望那面彻底没墙——旧逻辑只隐 wall 层，
  //    玻璃/框架仍按幕墙默认显示，导致走廊隐藏墙后外观仍是玻璃盒子。
  //    需保留玻璃外壳的「开敞但带玻璃」用 roomFacadeFaces 显式 override（第 1 步优先）。
  if (fp?.roomWallsHidden?.[room]?.[sideKey] === true) return false;
  // 3. Per-room style (glass/concrete beats mode default)
  const style = fp?.roomExteriorStyle?.[room];
  if (style === "glass") return layer !== "wall";
  if (style === "concrete") return layer === "wall";
  // 4. Physical adjacency: interior wall → solid regardless of global mode
  if (fp?.roomLayout && fp?.enabledRooms && !isExteriorWallSide(fp, room, sideKey)) {
    return layer === "wall";
  }
  // 5. Global mode default
  return facadeLayerDefault(layer, curtainWall);
}

/** Per-face glass transparency (0..1), falling back to the global value. */
export function resolveFaceOpacity(
  fp: Pick<FloorPlan, "roomFacadeFaces"> | undefined,
  room: RoomType, sideKey: string, globalOpacity: number,
): number {
  return fp?.roomFacadeFaces?.[room]?.[sideKey]?.opacity ?? globalOpacity;
}

/** Returns true if the given wall side of a room faces the building exterior —
 *  i.e. no other enabled room is physically adjacent on that side.
 *  Accepts a partial FloorPlan so callers can pass only what they have.
 *  Falls back to true (assume exterior) whenever layout data is absent,
 *  so glass is never wrongly suppressed on a real exterior face. */
export function isExteriorWallSide(
  fp: Partial<Pick<FloorPlan, "enabledRooms" | "roomLayout" | "roomDimensions">> | undefined | null,
  room: RoomType,
  side: string,
): boolean {
  const layout = fp?.roomLayout;
  const dims   = fp?.roomDimensions;
  const rooms  = fp?.enabledRooms;
  if (!layout || !rooms) return true;
  const pos = layout[room];
  if (!pos) return true;
  const aw = dims?.[room]?.width  ?? ROOM_DEFS[room]?.width  ?? 300;
  const ad = dims?.[room]?.depth  ?? ROOM_DEFS[room]?.depth  ?? 300;
  const ax = pos.x, ay = pos.y;
  const EPS = 15; // cm — shared-wall snap tolerance
  for (const r of rooms) {
    if (r === room) continue;
    const rl = layout[r]; if (!rl) continue;
    const rw = dims?.[r]?.width  ?? ROOM_DEFS[r as RoomType]?.width  ?? 300;
    const rd = dims?.[r]?.depth  ?? ROOM_DEFS[r as RoomType]?.depth  ?? 300;
    const rx = rl.x, ry = rl.y;
    const xOverlap = rx < ax + aw - EPS && rx + rw > ax + EPS;
    const yOverlap = ry < ay + ad - EPS && ry + rd  > ay + EPS;
    if (side === "N" && Math.abs((ry + rd) - ay) <= EPS && xOverlap) return false;
    if (side === "S" && Math.abs(ry - (ay + ad))  <= EPS && xOverlap) return false;
    if (side === "W" && Math.abs((rx + rw) - ax)  <= EPS && yOverlap) return false;
    if (side === "E" && Math.abs(rx - (ax + aw))  <= EPS && yOverlap) return false;
  }
  return true;
}

/** Interior-door visual styles. Each variant is rendered differently by
 *  RoomDoor3D and listed in the door style picker (2D edit mode). */
export type DoorStyle =
  | "wood_panel"     // 实木门板（默认，带面板线条）
  | "frosted_glass"  // 磨砂玻璃木框门
  | "sliding_barn"   // 谷仓推拉门
  | "french_double"  // 法式对开玻璃门
  | "glass_swing"    // 通透玻璃平开门（细框大玻璃 + 竖把手，幕墙别墅用）
  | "glass_slide"    // 通透玻璃推拉门（细框大玻璃 + 顶轨竖把手，左右滑动）
  | "roller_shutter"; // 真实卷帘门 GLB（车库门，向上卷起开启）

/** A distinct building on the same plot.
 *  buildings[0] is always the "main house" at (x=0, z=0).
 *  Secondary buildings are at their own (x, z, rot) offsets in yard-cm coords.
 *  Each building has independent floor plans and exterior style. */
export interface Building {
  id: string;
  /** Display label shown in building switcher and 2D/3D views. */
  label: string;
  /** Position relative to plot centre, in cm. Main house is always (0, 0). */
  x: number;
  z: number;
  /** Y-axis rotation in radians. */
  rot: number;
  floorPlans: FloorPlan[];
  exterior: ExteriorSettings;
}

// For wall/floor area estimation (m²)
export function getRoomArea(room: RoomType): { wall: number; floor: number } {
  const def = ROOM_DEFS[room];
  const floor = Math.round((def.width * def.depth) / 10000);
  const wall = Math.round((2 * (def.width + def.depth) * def.height) / 10000);
  return { wall, floor };
}
