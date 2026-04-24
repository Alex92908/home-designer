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
  | "custom5";   // 自定义5

export type ViewMode = "2d" | "3d" | "all" | "exterior" | "global3d";

export type RoofStyle = "flat" | "gable" | "hip" | "mansard" | "chinese";
export type WallMaterialType = "render" | "brick" | "stone" | "wood" | "concrete";

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
}

/** A decor item pinned to the OUTSIDE face of a room wall. Stored inside
 *  the owning room (see `RoomState.exteriorDecor`). Walls match the
 *  windows naming: back = -Z, front = +Z (room view convention), left =
 *  -X, right = +X. Normalized u/v coords span the wall rectangle (0 =
 *  left/bottom, 1 = right/top as viewed from outside). */
export type ExteriorWall = WallSide; // = "back" | "front" | "left" | "right"

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
  wall: "back" | "front" | "right" | "left";
  pos: number;   // cm from wall start (left or top)
  len: number;   // cm length (width along wall)
  h?: number;    // cm height (vertical), default 150
  sill?: number; // cm from floor to bottom of window, default 90
  /** Visual style. Default "sliding" (国内推拉窗) if unset. */
  style?: WindowStyle;
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

/** Which of the 4 walls an override applies to. Dollhouse view hides
 *  `front` but we still track the data for 2D plan + future views. */
export type WallSide = "back" | "front" | "left" | "right";

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
  windowWall: "back" | "right" | "left" | "none";
  isCustom?: boolean;
  isOutdoor?: boolean;
}

export const ROOM_DEFS: Record<RoomType, RoomDef> = {
  living:    { width: 500, depth: 420, height: 280, name: "客厅",    icon: "🛋️", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: true,  windowWall: "right" },
  master:    { width: 400, depth: 360, height: 280, name: "主卧",    icon: "🛏️", defaultWallColor: "#EAE5DC", defaultFloorColor: "#C8A882", hasWindow: true,  windowWall: "right" },
  bedroom:   { width: 320, depth: 300, height: 280, name: "次卧",    icon: "🛏️", defaultWallColor: "#EEF0F5", defaultFloorColor: "#C8B890", hasWindow: true,  windowWall: "back"  },
  bedroom2:  { width: 300, depth: 280, height: 280, name: "次卧2",   icon: "🛏️", defaultWallColor: "#EEF0F5", defaultFloorColor: "#C8B890", hasWindow: true,  windowWall: "back"  },
  bedroom3:  { width: 280, depth: 260, height: 280, name: "次卧3",   icon: "🛏️", defaultWallColor: "#EEF0F5", defaultFloorColor: "#C8B890", hasWindow: true,  windowWall: "back"  },
  kitchen:   { width: 360, depth: 280, height: 270, name: "厨房",    icon: "🍳", defaultWallColor: "#FFFFFF", defaultFloorColor: "#E8E8E8", hasWindow: true,  windowWall: "back"  },
  bathroom:  { width: 260, depth: 220, height: 260, name: "卫生间",  icon: "🚿", defaultWallColor: "#F5F5F5", defaultFloorColor: "#DCDCDC", hasWindow: false, windowWall: "none"  },
  bathroom2: { width: 240, depth: 200, height: 260, name: "卫生间2", icon: "🚿", defaultWallColor: "#F5F5F5", defaultFloorColor: "#DCDCDC", hasWindow: false, windowWall: "none"  },
  dining:    { width: 380, depth: 320, height: 280, name: "餐厅",    icon: "🍽️", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: true,  windowWall: "right" },
  study:     { width: 320, depth: 290, height: 280, name: "书房",    icon: "📚", defaultWallColor: "#E8E0D8", defaultFloorColor: "#B89060", hasWindow: true,  windowWall: "back"  },
  study2:    { width: 300, depth: 260, height: 280, name: "书房2",   icon: "📚", defaultWallColor: "#E8E0D8", defaultFloorColor: "#B89060", hasWindow: true,  windowWall: "back"  },
  closet:    { width: 260, depth: 200, height: 260, name: "衣帽间",  icon: "👗", defaultWallColor: "#F5F0E8", defaultFloorColor: "#D4C0A0", hasWindow: false, windowWall: "none"  },
  balcony:   { width: 420, depth: 160, height: 280, name: "阳台",    icon: "🌿", defaultWallColor: "#E8E8E0", defaultFloorColor: "#A0A098", hasWindow: true,  windowWall: "back"  },
  balcony2:  { width: 300, depth: 160, height: 280, name: "阳台2",   icon: "🌿", defaultWallColor: "#E8E8E0", defaultFloorColor: "#A0A098", hasWindow: true,  windowWall: "back"  },
  // Outdoor
  yard:      { width: 800, depth: 600, height: 0,   name: "院子",    icon: "🏡", defaultWallColor: "#6B8E60", defaultFloorColor: "#7CAF5A", hasWindow: false, windowWall: "none", isOutdoor: true },
  garage:    { width: 500, depth: 320, height: 260, name: "车库",    icon: "🚗", defaultWallColor: "#D0CEC8", defaultFloorColor: "#B0AEA8", hasWindow: true,  windowWall: "right" },
  gym:       { width: 360, depth: 320, height: 280, name: "健身房",  icon: "🏋️", defaultWallColor: "#E8E8E8", defaultFloorColor: "#C0C0C0", hasWindow: true,  windowWall: "back"  },
  cinema:    { width: 420, depth: 320, height: 280, name: "影音室",  icon: "🎬", defaultWallColor: "#1A1A2E", defaultFloorColor: "#16213E", hasWindow: false, windowWall: "none"  },
  // Custom slots
  custom1:   { width: 300, depth: 300, height: 280, name: "自定义1", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
  custom2:   { width: 300, depth: 300, height: 280, name: "自定义2", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
  custom3:   { width: 300, depth: 300, height: 280, name: "自定义3", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
  custom4:   { width: 300, depth: 300, height: 280, name: "自定义4", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
  custom5:   { width: 300, depth: 300, height: 280, name: "自定义5", icon: "🔲", defaultWallColor: "#EDE8E0", defaultFloorColor: "#C8A882", hasWindow: false, windowWall: "none", isCustom: true },
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
  roomDoorWall: Record<RoomType, "bottom" | "top" | "left" | "right">;
  roomDoorLen?: Partial<Record<RoomType, number>>; // cm, width along wall (default 80)
  roomDoorH?: Partial<Record<RoomType, number>>;   // cm, height (default 200)
  /** Per-room door style. Default "wood_panel" if unset. */
  roomDoorStyle?: Partial<Record<RoomType, DoorStyle>>;
  /** Per-room non-rectangular polygon override (L型/凸字型/etc).
   *  Absent entry = rectangle fallback using roomDimensions. */
  roomShapes?: Partial<Record<RoomType, import("./roomGeometry").RoomShape>>;
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
