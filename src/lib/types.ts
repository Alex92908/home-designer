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

export type ViewMode = "2d" | "3d" | "all" | "exterior";

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

export type StyleTag = "现代" | "北欧" | "中式" | "日式" | "轻奢" | "工业风";

export type MaterialCategory = "wall" | "floor" | "ceiling" | "light" | "tile";

export type FurnitureCategory =
  | "sofa" | "coffee_table" | "tv_unit" | "bookshelf" | "sideboard"
  | "bed" | "nightstand" | "wardrobe" | "dresser"
  | "dining_table" | "dining_chair"
  | "kitchen_cabinet" | "refrigerator" | "range_hood" | "kitchen_sink"
  | "toilet" | "bathtub" | "shower" | "bathroom_vanity"
  | "desk" | "office_chair" | "storage"
  | "plant" | "rug" | "artwork" | "floor_lamp"
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
}

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
}

export interface RoomMaterials {
  wall?: MaterialItem;
  floor?: MaterialItem;
  ceiling?: MaterialItem;
  light?: MaterialItem;
  tile?: MaterialItem;
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
}

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
}

// For wall/floor area estimation (m²)
export function getRoomArea(room: RoomType): { wall: number; floor: number } {
  const def = ROOM_DEFS[room];
  const floor = Math.round((def.width * def.depth) / 10000);
  const wall = Math.round((2 * (def.width + def.depth) * def.height) / 10000);
  return { wall, floor };
}
