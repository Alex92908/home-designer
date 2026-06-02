import { create, useStore } from "zustand";
import { persist } from "zustand/middleware";
import { temporal } from "zundo";
import type { TemporalState } from "zundo";
import { RoomType, ViewMode, MaterialItem, PlacedItem, RoomMaterials, ROOM_DEFS, StyleTag, getRoomArea, FurnitureItem, ExteriorSettings, WindowConfig, RoomState, FloorPlan, ExteriorWallDecorItem, ExteriorWall, WallSide } from "./types";
import { FURNITURE, getFurnitureById, registerFurniture } from "./furniture";
import { MATERIALS } from "./data";
import { ALL_TEMPLATES, buildTemplateRoomState, buildEmbeddedRoomState } from "./templates";

// ─── Style scoring ─────────────────────────────────────────

interface StyleScore {
  style: number;
  space: number;
  light: number;
  dominantStyle: string;
}

function hexToLightness(hex: string): number {
  const clean = hex.replace("#", "");
  if (clean.length < 6) return 50;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return Math.round((0.299 * r + 0.587 * g + 0.114 * b) * 100);
}

function computeScores(materials: RoomMaterials, placedItems: PlacedItem[]): StyleScore {
  const matItems = Object.values(materials).filter(Boolean) as MaterialItem[];
  const furnitureTags: StyleTag[] = placedItems.flatMap(p => {
    const f = getFurnitureById(p.furnitureId);
    return f ? f.tags : [];
  });

  const allTags: StyleTag[] = [...matItems.flatMap(i => i.tags), ...furnitureTags];
  if (allTags.length < 2) return { style: 0, space: 0, light: 0, dominantStyle: "" };

  const tagCounts: Partial<Record<StyleTag, number>> = {};
  for (const tag of allTags) {
    tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  }

  const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  const dominantStyle = sorted[0]?.[0] ?? "";
  const dominantCount = sorted[0]?.[1] ?? 0;
  const styleScore = Math.min(100, Math.round((dominantCount / allTags.length) * 100 * 1.3));

  const wallBrightness = materials.wall ? hexToLightness(materials.wall.color) : 50;
  const floorBrightness = materials.floor ? hexToLightness(materials.floor.color) : 50;
  const hasTrackLight = materials.light?.id === "light-spot";
  const spaceScore = Math.min(100, Math.round(wallBrightness * 0.5 + floorBrightness * 0.3 + (hasTrackLight ? 20 : 0)));

  const lightBrightness = materials.light ? hexToLightness(materials.light.color) : 0;
  const lightScore = Math.min(100, Math.round(lightBrightness * 0.6 + wallBrightness * 0.4));

  return { style: styleScore, space: spaceScore, light: lightScore, dominantStyle };
}

// ─── Default room layout & dimensions ─────────────────────
export const ALL_POSSIBLE_ROOMS: RoomType[] = [
  "living","master","bedroom","bedroom2","bedroom3",
  "kitchen","bathroom","bathroom2","dining",
  "study","study2","closet","balcony","balcony2",
  "yard","garage","gym","cinema",
  "custom1","custom2","custom3","custom4","custom5",
  "stair","hallway",
  "pool","terrace","deck",
  // 屋顶层专属
  "rooftop_lounge","rooftop_pool","rooftop_garden","rooftop_bar","equipment_room",
];

export const ROOFTOP_ROOM_TYPES: RoomType[] = [
  "rooftop_lounge","rooftop_pool","rooftop_garden","rooftop_bar","equipment_room",
];

export const DEFAULT_ENABLED: RoomType[] = [
  "living","master","bedroom","kitchen","bathroom","dining","study","closet","balcony",
];

export const DEFAULT_ROOM_LAYOUT: Record<RoomType, { x: number; y: number }> = {
  master:    { x: 0,    y: 0    },
  closet:    { x: 400,  y: 0    },
  bathroom:  { x: 400,  y: 200  },
  bathroom2: { x: 620,  y: 200  },
  study:     { x: 660,  y: 0    },
  study2:    { x: 660,  y: 290  },
  living:    { x: 0,    y: 360  },
  bedroom:   { x: 500,  y: 360  },
  bedroom2:  { x: 500,  y: 660  },
  bedroom3:  { x: 500,  y: 940  },
  dining:    { x: 0,    y: 780  },
  kitchen:   { x: 380,  y: 780  },
  balcony:   { x: 0,    y: 1100 },
  balcony2:  { x: 500,  y: 1100 },
  yard:      { x: -860, y: 0    },
  garage:    { x: -560, y: 0    },
  gym:       { x: -560, y: 320  },
  cinema:    { x: -560, y: 640  },
  custom1:   { x: 820,  y: 0    },
  custom2:   { x: 820,  y: 300  },
  custom3:   { x: 820,  y: 600  },
  custom4:   { x: 820,  y: 900  },
  custom5:   { x: 820,  y: 1200 },
  stair:     { x: 620,  y: 780  },
  hallway:   { x: 380,  y: 360  },
  // 户外结构 —— 默认放在屋子东侧，用户拖动到目标位置
  pool:      { x: 1200, y: 400  },
  terrace:   { x: 1200, y: 800  },
  deck:      { x: 1200, y: 1100 },
  // 屋顶层专属 —— 在屋顶平面图里分散排列
  rooftop_lounge:  { x: 0,   y: 0   },
  rooftop_pool:    { x: 600, y: 0   },
  rooftop_garden:  { x: 0,   y: 450 },
  rooftop_bar:     { x: 600, y: 450 },
  equipment_room:  { x: 0,   y: 900 },
};

export const DEFAULT_ROOM_DIMENSIONS: Record<RoomType, { width: number; depth: number }> =
  Object.fromEntries(
    ALL_POSSIBLE_ROOMS.map(r => [r, { width: ROOM_DEFS[r].width, depth: ROOM_DEFS[r].depth }])
  ) as Record<RoomType, { width: number; depth: number }>;

// ─── Default windows per room ─────────────────────────────
let _winIdCounter = 0;
function genWinId(room: RoomType) { return `${room}-w${++_winIdCounter}`; }

function makeDefaultWindows(room: RoomType): WindowConfig[] {
  const def = ROOM_DEFS[room];
  if (!def.hasWindow || def.windowWall === "none") return [];
  const wall = def.windowWall as "N" | "E" | "W";
  const wallLen = wall === "N" ? def.width : def.depth;
  return [{ id: genWinId(room), wall, pos: wallLen * 0.25, len: wallLen * 0.45 }];
}

export const DEFAULT_ROOM_WINDOWS: Record<RoomType, WindowConfig[]> =
  Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, makeDefaultWindows(r)])) as Record<RoomType, WindowConfig[]>;

// Default door pos = 10% from left of room width
export const DEFAULT_ROOM_DOOR_POS: Record<RoomType, number> =
  Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, Math.round(ROOM_DEFS[r].width * 0.1)])) as Record<RoomType, number>;

export const DEFAULT_ROOM_HAS_DOOR: Record<RoomType, boolean> =
  Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, true])) as Record<RoomType, boolean>;

export const DEFAULT_ROOM_DOOR_WALL: Record<RoomType, WallSide> =
  Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, "S" as const])) as Record<RoomType, WallSide>;

// ─── ID generator ─────────────────────────────────────────
let _idCounter = 0;
function genId(): string {
  return `pi_${++_idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Room state ────────────────────────────────────────────
export type { RoomState };

function emptyRoom(): RoomState {
  return { materials: {}, placedItems: [] };
}

const ALL_ROOM_TYPES: RoomType[] = ALL_POSSIBLE_ROOMS;

// ─── makeDefaultFloorPlan ─────────────────────────────────
/** Create a blank floor plan, optionally inheriting stair/hallway from a
 *  reference floor so multi-floor buildings always have a staircase path. */
function makeDefaultFloorPlan(ref?: FloorPlan): FloorPlan {
  const fp: FloorPlan = {
    rooms: Object.fromEntries(ALL_ROOM_TYPES.map(r => [r, emptyRoom()])) as Record<RoomType, RoomState>,
    enabledRooms: [...DEFAULT_ENABLED],
    roomLayout: { ...DEFAULT_ROOM_LAYOUT },
    roomDimensions: { ...DEFAULT_ROOM_DIMENSIONS },
    roomWindows: { ...DEFAULT_ROOM_WINDOWS },
    roomDoorPos: { ...DEFAULT_ROOM_DOOR_POS },
    roomHasDoor: { ...DEFAULT_ROOM_HAS_DOOR },
    roomDoorWall: { ...DEFAULT_ROOM_DOOR_WALL },
  };
  // 楼梯间默认放一把直梯（普通家具）。
  if (fp.enabledRooms.includes("stair")) {
    fp.rooms.stair = { materials: {}, placedItems: defaultStairItems() };
  }
  // Copy stair (and hallway) from reference floor so new floors always have
  // a staircase path. Position/dimensions are preserved for alignment.
  const VERTICAL_ROOMS: RoomType[] = ["stair", "hallway"];
  if (ref) {
    for (const r of VERTICAL_ROOMS) {
      if (!ref.enabledRooms.includes(r)) continue;
      if (!fp.enabledRooms.includes(r)) fp.enabledRooms = [...fp.enabledRooms, r];
      if (ref.roomLayout?.[r])     fp.roomLayout     = { ...fp.roomLayout,     [r]: { ...ref.roomLayout[r] } };
      if (ref.roomDimensions?.[r]) fp.roomDimensions = { ...fp.roomDimensions, [r]: { ...ref.roomDimensions[r] } };
      // 楼梯家具随参考楼层一并继承（保持楼梯位置/方位/大小一致）。
      if (r === "stair" && ref.rooms?.stair?.placedItems) {
        fp.rooms.stair = {
          materials: { ...(ref.rooms.stair.materials ?? {}) },
          placedItems: ref.rooms.stair.placedItems.map(p => ({ ...p, instanceId: genId() })),
        };
      }
    }
  }
  return fp;
}

/** 天台休闲区默认家具布局。坐标为房间左上角原点、单位 cm，房间默认
 *  500×400cm（ROOM_DEFS.rooftop_lounge）。这些就是普通房间的 placedItems，
 *  渲染、拖动、增删全部走统一流程（平面图 / 效果图 / 外观 / 全局3D）。 */
function defaultRooftopLoungeItems(): PlacedItem[] {
  const mk = (furnitureId: string, x: number, z: number, rotation = 0): PlacedItem => ({
    instanceId: genId(), furnitureId, x, z, rotation,
  });
  return [
    // 遮阳棚：一件普通家具（凉亭），默认覆盖休闲区中央，渲染走统一
    // PlacedItemMesh → RooftopFixtureMesh(Pergola)，不再在各视图写死。
    mk("pergola", 250, 200, 0),
    mk("lounger-sun", 175, 250, 0),
    mk("lounger-sun", 325, 250, 180),
    mk("outdoor-sofa", 250, 95, 0),
    mk("garden-coffee-table", 250, 185, 0),
    mk("planter-clay", 55, 345, 0),
    mk("planter-clay", 445, 345, 0),
    // 光伏阵列：一件普通家具，默认 360×360（≈3×2 块），放在休闲区里，
    // 可在平面图 / 效果图里拖动 / 缩放 / 旋转，拉大尺寸即增加面板。
    mk("solar-panel-array", 260, 150, 0),
  ];
}

/** 屋顶泳池默认布局（600×350cm）：一座镜面泳池 + 两张躺椅。家具化，
 *  各视图统一渲染，用户可自由增删 / 缩放 / 拖动。 */
function defaultRooftopPoolItems(): PlacedItem[] {
  return [
    { instanceId: genId(), furnitureId: "reflecting-pool", x: 300, z: 200, rotation: 0, scaleW: 1.6, scaleD: 2.5 },
    { instanceId: genId(), furnitureId: "lounger-sun", x: 80,  z: 60, rotation: 0 },
    { instanceId: genId(), furnitureId: "lounger-sun", x: 520, z: 60, rotation: 0 },
  ];
}

/** 屋顶花园默认布局（500×400cm）：一块绿化草坪 + 数个花盆。家具化。 */
function defaultRooftopGardenItems(): PlacedItem[] {
  return [
    { instanceId: genId(), furnitureId: "green-roof-patch", x: 250, z: 200, rotation: 0 },
    { instanceId: genId(), furnitureId: "planter-clay", x: 60,  z: 60,  rotation: 0 },
    { instanceId: genId(), furnitureId: "planter-clay", x: 440, z: 60,  rotation: 0 },
    { instanceId: genId(), furnitureId: "planter-clay", x: 60,  z: 340, rotation: 0 },
    { instanceId: genId(), furnitureId: "planter-clay", x: 440, z: 340, rotation: 0 },
  ];
}

/** 天台酒吧默认布局（400×300cm）：一座露天吧台（含吧凳/酒架）。家具化。 */
function defaultRooftopBarItems(): PlacedItem[] {
  return [
    { instanceId: genId(), furnitureId: "sky-bar", x: 200, z: 130, rotation: 0 },
  ];
}

/** 楼梯间默认家具：一把直梯，居中放置。楼梯和其它家具一样是普通
 *  placedItem，方位（rotation）/大小（scaleW/D/H）走统一编辑流程，
 *  各视图统一用 PlacedItemMesh → StaircaseMesh 渲染。 */
function defaultStairItems(): PlacedItem[] {
  const { width, depth } = DEFAULT_ROOM_DIMENSIONS.stair;
  return [{
    instanceId: genId(),
    furnitureId: "staircase-straight",
    x: Math.round(width / 2),
    z: Math.round(depth / 2),
    rotation: 0,
  }];
}

function makeRooftopFloorPlan(): FloorPlan {
  const rooms = Object.fromEntries(ALL_ROOM_TYPES.map(r => [r, emptyRoom()])) as Record<RoomType, RoomState>;
  rooms.rooftop_lounge = { materials: {}, placedItems: defaultRooftopLoungeItems() };
  // 其余天台房间也预置默认家具：用户启用后即按普通房间渲染（外壳/装饰
  // 全部走 placedItems，不再在视图里按类型写死）。
  rooms.rooftop_pool   = { materials: {}, placedItems: defaultRooftopPoolItems() };
  rooms.rooftop_garden = { materials: {}, placedItems: defaultRooftopGardenItems() };
  rooms.rooftop_bar    = { materials: {}, placedItems: defaultRooftopBarItems() };
  return {
    rooms,
    enabledRooms: ["rooftop_lounge"],
    roomLayout: { ...DEFAULT_ROOM_LAYOUT },
    roomDimensions: { ...DEFAULT_ROOM_DIMENSIONS },
    roomWindows: { ...DEFAULT_ROOM_WINDOWS },
    roomDoorPos: { ...DEFAULT_ROOM_DOOR_POS },
    roomHasDoor: { ...DEFAULT_ROOM_HAS_DOOR },
    roomDoorWall: { ...DEFAULT_ROOM_DOOR_WALL },
  };
}

// ─── updateFloor helper ───────────────────────────────────
function updateFloor(
  get: () => DesignerStore,
  set: (partial: Partial<DesignerStore> | ((s: DesignerStore) => Partial<DesignerStore>)) => void,
  updater: (fp: FloorPlan) => Partial<FloorPlan>
) {
  const s = get();
  const fp = s.floorPlans[s.activeFloor];
  const updated = [...s.floorPlans];
  updated[s.activeFloor] = { ...fp, ...updater(fp) };
  set({ floorPlans: updated });
}

/**
 * Sync roomDimensions to match the polygon's bbox span.
 *
 * IMPORTANT: this function does NOT shift the polygon or roomLayout.
 * An earlier attempt did — to keep the polygon in the positive
 * quadrant — but that broke door/window/furniture positions, which
 * also live in room-local coords and were NOT shifted. Result: doors
 * jumped to wrong walls and couldn't be deleted.
 *
 * Instead, we let the polygon keep negative coords (e.g. when the
 * user drags the top edge up). Dimensions become the FULL span
 * `(maxX - minX, maxZ - minZ)` so the SVG canvas in 单房间 平面图
 * is big enough; the renderer handles the offset.
 *
 * Returns the unmodified points (caller stores them as-is) plus the
 * dim patch. Layout is NEVER touched here.
 */
function syncDimsAndLayout(
  fp: FloorPlan,
  room: RoomType,
  points: Array<[number, number]>,
): { points: Array<[number, number]>; patch: Partial<FloorPlan> } {
  if (!points.length) return { points, patch: {} };
  let minX = points[0][0], minZ = points[0][1], maxX = minX, maxZ = minZ;
  for (const [x, z] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const spanX = maxX - Math.min(0, minX);
  const spanZ = maxZ - Math.min(0, minZ);
  const snap = (v: number) => Math.round(v / 10) * 10;
  const curDims = fp.roomDimensions[room];
  const newW = Math.max(curDims?.width ?? 0, snap(spanX));
  const newD = Math.max(curDims?.depth ?? 0, snap(spanZ));
  const patch: Partial<FloorPlan> = {};
  if (!curDims || curDims.width !== newW || curDims.depth !== newD) {
    patch.roomDimensions = { ...fp.roomDimensions, [room]: { width: newW, depth: newD } };
  }
  return { points, patch };
}

// ─── updateYardFloor helper — yard is ground-level, always floor 0 ───
// The yard (outdoor space) is a physical ground-level feature shared by
// all floors. Always read/write yardPlan from floorPlans[0] regardless
// of which floor the user is currently editing.
function updateYardFloor(
  get: () => DesignerStore,
  set: (partial: Partial<DesignerStore> | ((s: DesignerStore) => Partial<DesignerStore>)) => void,
  updater: (fp: FloorPlan) => Partial<FloorPlan>
) {
  const s = get();
  const fp = s.floorPlans[0];
  const updated = [...s.floorPlans];
  updated[0] = { ...fp, ...updater(fp) };
  set({ floorPlans: updated });
}

// ─── Store interface ───────────────────────────────────────

interface DesignerStore {
  // State
  floorPlans: FloorPlan[];
  activeRoom: RoomType;
  viewMode: ViewMode;
  selectedInstanceId: string | null;
  selectedInstanceIds: string[];
  budget: number;
  scores: StyleScore;

  // Door open/close state per room (ephemeral UI state, not persisted).
  // Used by 3D view to animate doors swinging open on click.
  doorOpenByRoom: Partial<Record<RoomType, boolean>>;
  toggleDoorOpen: (room: RoomType) => void;

  // Window open/close state per window instance (ephemeral, not persisted).
  // Keyed by WindowConfig.id so each window in a room opens independently.
  windowOpenByWinId: Record<string, boolean>;
  toggleWindowOpen: (winId: string) => void;
  /** Open/close state for curtain instances — toggled by clicking the
   *  curtain mesh in 3D. When open, the curtain glTF is animated to
   *  gather sideways (scale.x ~0.4), revealing the window behind. */
  curtainOpenByInstanceId: Record<string, boolean>;
  toggleCurtainOpen: (instanceId: string) => void;

  // Front wall opacity in 3D dollhouse view. 0 = cut away (default, so
  // you can see into the room), 0.5 = frosted glass, 1.0 = fully opaque.
  // User cycles through these three via the floating toggle.
  southWallOpacity: 0 | 0.5 | 1;
  setSouthWallOpacity: (o: 0 | 0.5 | 1) => void;
  /** Ceiling display opacity — same 0/0.5/1 cycle as front wall. Lets the
   *  user see the ceiling lamp / skylight / 吊顶装饰 from above by
   *  hiding the slab. */
  ceilingOpacity: 0 | 0.5 | 1;
  setCeilingOpacity: (o: 0 | 0.5 | 1) => void;
  /** Per-room light on/off toggle. Default true. When false, the ceiling
   *  fixture + any emissive wall lamps in that room go dark (emissive
   *  and pointLight intensity set to 0). Ambient/daylight still lights
   *  the scene, so the room gets dimmer but remains visible. */
  lightsOnByRoom: Partial<Record<RoomType, boolean>>;
  toggleRoomLights: (room: RoomType) => void;
  /** Per-fixture off state for non-ceiling lights — floor lamps,
   *  exterior wall lamps, lanterns, light strips. Keyed by the item's
   *  instance ID. true = off, undefined/false = on. Toggled by clicking
   *  the individual fixture in 3D. */
  fixtureOffById: Record<string, boolean>;
  toggleFixture: (instanceId: string) => void;
  /** Draw-mode for the 2D plan: when set, clicking a fixture starts
   *  or completes a routing connection of this kind. null = normal
   *  edit mode. */
  routingMode: import("./types").RoutingKind | null;
  setRoutingMode: (mode: import("./types").RoutingKind | null) => void;
  /** First clicked endpoint while in routingMode (instanceId of the
   *  source fixture). Becomes the `from` of the new RoutingConnection. */
  routingFrom: string | null;
  setRoutingFrom: (id: string | null) => void;
  addRoutingConnection: (room: RoomType, from: string, to: string, kind: import("./types").RoutingKind) => void;
  removeRoutingConnection: (room: RoomType, connId: string) => void;
  /** Per-room light tuning: brightness multiplier (0.3–2.0, default 1),
   *  color-temperature override (hex string, null = use material default),
   *  and post-fx exposure (0.6–1.8, default 1.2). */
  lightBrightnessByRoom: Partial<Record<RoomType, number>>;
  lightColorByRoom: Partial<Record<RoomType, string>>;
  roomExposureByRoom: Partial<Record<RoomType, number>>;
  setLightBrightness: (room: RoomType, v: number) => void;
  setLightColor: (room: RoomType, hex: string | null) => void;
  setRoomExposure: (room: RoomType, v: number) => void;
  /** Per-room ceiling light position (cm offset from room center on the
   *  ceiling plane). {x:0, z:0} = centered. Range clamps to the room
   *  footprint in the UI. */
  lightPosByRoom: Partial<Record<RoomType, { x: number; z: number }>>;
  setLightPos: (room: RoomType, pos: { x: number; z: number }) => void;

  // Furniture undo history (ephemeral, not persisted)
  /** Undo history — one snapshot per mutating action. Each entry stores
   *  BOTH the room's placedItems AND exteriorDecor so the single Undo
   *  button rolls back interior furniture ops and exterior wall decor
   *  ops uniformly. `exteriorDecor` is optional for backward compat
   *  with older persisted histories. */
  furnitureHistory: Array<{ room: RoomType; placedItems: PlacedItem[]; exteriorDecor?: ExteriorWallDecorItem[] }>;

  // Clipboard for cross-room copy/paste (ephemeral)
  clipboard: Array<{ furnitureId: string; x: number; z: number; rotation: number; scaleW: number; scaleD: number; scaleH: number }>;

  // Room-level clipboard (copy entire room config)
  roomClipboard: { materials: RoomMaterials; placedItems: PlacedItem[]; name: string; icon: string; width: number; depth: number; shape?: import("./roomGeometry").RoomShape } | null;

  // Blueprint tracing (FloorPlanAll overlay): user uploads a floorplan
  // image and positions / scales it behind the SVG so rooms can be
  // drawn on top. `image` is a data URL (persisted across reloads).
  // `offsetX/Y` are in cm (same units as roomLayout). `scale` is a
  // multiplier from image native pixels to cm (1 = 1 px ≈ 1 cm).
  blueprint: {
    image: string | null;
    naturalW: number;   // native pixels
    naturalH: number;
    opacity: number;
    offsetX: number;    // cm, top-left in FloorPlanAll coord system
    offsetY: number;
    scale: number;      // cm per pixel (so rendered size = natural × scale)
  };
  setBlueprint: (patch: Partial<DesignerStore["blueprint"]>) => void;
  clearBlueprint: () => void;

  /** Apply a layout-only template to the current floor: replaces
   *  enabledRooms, roomLayout, roomDimensions, roomShapes. Keeps existing
   *  RoomState (materials + placedItems) for rooms that appear in both
   *  — safer than wiping customizations. */
  applyFloorplanLayout: (layoutId: string) => void;

  // Room / view actions
  setActiveRoom: (room: RoomType) => void;
  setViewMode: (mode: ViewMode) => void;

  // Material actions
  setMaterial: (material: MaterialItem) => void;
  removeMaterial: (category: keyof RoomMaterials) => void;
  /** Set a per-side wall override. side="N"|"S"|"W"|"E". */
  setWallSide: (side: WallSide, material: MaterialItem | undefined) => void;
  /** Set the lower-wall (护墙板/墙裙) material. Pass undefined to clear. */
  setWallLower: (material: MaterialItem | undefined) => void;
  /** Set where upper/lower split happens (cm from floor). Default 110. */
  setWallSplitHeight: (cm: number) => void;
  /** Set exterior-face wall material for the active room. Pass
   *  side="all" for the global default, or a specific side for
   *  independent per-face color. Pass undefined material to clear. */
  setWallExterior: (side: "all" | WallSide, material: MaterialItem | undefined) => void;

  // Furniture placement actions
  placeFurniture: (furnitureId: string) => void;
  moveItem: (instanceId: string, x: number, z: number) => void;
  rotateItem: (instanceId: string) => void;
  /** Toggle a placed item between floor-mounted and ceiling-mounted.
   *  Ceiling-mounted items render with their top at ceiling height. */
  toggleItemMountCeiling: (instanceId: string) => void;
  removeItem: (instanceId: string) => void;
  selectInstance: (instanceId: string | null) => void;
  setSelection: (ids: string[]) => void;
  duplicateItems: (instanceIds: string[]) => void;
  removeItems: (instanceIds: string[]) => void;
  resizeItem: (instanceId: string, scaleW: number, scaleD: number, scaleH?: number) => void;
  setElevation: (instanceId: string, elevationY: number) => void;
  clearRoom: () => void;
  /** Auto-fill the active room with decorative items (rug, plants, art,
   *  lamp) at sensible positions. Skips any decoration already placed. */
  autoDecorate: () => void;

  // Furniture undo
  pushFurnitureHistory: () => void;
  undoFurniture: () => void;

  // Clipboard (cross-room copy/paste)
  copyToClipboard: (instanceIds: string[]) => void;
  pasteFromClipboard: () => void;

  // Budget
  setBudget: (budget: number) => void;

  // Room layout (per-floor floor plan editor)
  updateRoomLayout: (room: RoomType, x: number, y: number) => void;
  updateRoomDimension: (room: RoomType, width: number, depth: number) => void;
  setRoomShape: (room: RoomType, preset: import("./roomGeometry").ShapePreset) => void;
  updateRoomShapePoint: (room: RoomType, idx: number, x: number, z: number) => void;
  /** Insert a new vertex after `afterIdx` at position (x, z) in cm. */
  insertRoomShapePoint: (room: RoomType, afterIdx: number, x: number, z: number) => void;
  /** Remove a vertex from a room's polygon. No-op if the shape would end
   *  up with fewer than 3 points. Switches preset to "custom". */
  deleteRoomShapePoint: (room: RoomType, idx: number) => void;
  /** Snap every polygon edge to axis-aligned (horizontal or vertical),
   *  choosing the dominant axis per edge. Useful after noisy vertex
   *  drags produced slightly tilted walls. */
  rectifyRoomShape: (room: RoomType) => void;
  toggleRoom: (room: RoomType) => void;
  addRoom: (room: RoomType) => void;
  removeRoom: (room: RoomType) => void;
  resetLayout: () => void;
  /** Auto-detect two adjacent room groups on the current floor and insert an
   *  80 cm hallway corridor between them.  Shifts the right-group rooms to
   *  make space.  No-op when no clear split is found or hallway is already
   *  present at the detected position. */
  autoInsertHallway: () => void;

  // Custom room names/icons
  customRoomMeta: Partial<Record<RoomType, { name: string; icon: string }>>;
  setCustomRoomMeta: (room: RoomType, name: string, icon: string) => void;

  // Room copy/paste
  copyRoom: (room: RoomType) => void;
  pasteRoom: (targetRoom: RoomType) => void;
  pasteAsNewRoom: () => void;

  // Custom furniture
  customFurniture: FurnitureItem[];
  addCustomFurniture: (item: FurnitureItem) => void;

  // Exterior / house facade
  exterior: ExteriorSettings;
  setExterior: (patch: Partial<ExteriorSettings>) => void;
  setOutdoorPosition: (key: string, pos: { x: number; z: number }) => void;
  rotateOutdoor: (key: string) => void;
  resetOutdoorPosition: (key: string) => void;

  // Exterior wall decor — per room (lights/mailboxes/vines on the
  // outside face of the owning room's walls)
  addRoomExteriorDecor: (room: RoomType, furnitureId: string, wall: ExteriorWall) => void;
  removeRoomExteriorDecor: (room: RoomType, instanceId: string) => void;
  updateRoomExteriorDecor: (room: RoomType, instanceId: string, patch: Partial<ExteriorWallDecorItem>) => void;
  selectedExteriorDecorId: string | null;
  setSelectedExteriorDecor: (instanceId: string | null) => void;

  // Multi-floor switching
  activeFloor: number;
  setActiveFloor: (floor: number) => void;

  // Windows per room (operate on current floor)
  setRoomWindows: (room: RoomType, windows: WindowConfig[]) => void;
  addWindow: (room: RoomType, win: WindowConfig) => void;
  removeWindow: (room: RoomType, id: string) => void;

  // Door per room (operate on current floor)
  setDoorPos: (room: RoomType, pos: number) => void;
  setRoomHasDoor: (room: RoomType, has: boolean) => void;
  setDoorWall: (room: RoomType, wall: WallSide) => void;
  /** Toggle a single wall's hidden flag for a room. Key is either a
   *  cardinal side ("N"/"S"/"W"/"E") for rect rooms OR
   *  "edge-${i}" for polygon-edge rooms. */
  toggleWallHidden: (room: RoomType, key: string) => void;
  setDoorEdgeIdx: (room: RoomType, edgeIdx: number | null) => void;

  // ── Yard plan (outdoor 2D editor) ──
  // Items in the yard plan are stored on the active floor's `yardPlan.items`
  // array. The exterior 3D view auto-renders these. v2 schema (2026-04):
  // items can be singletons, prefabs, or zones — see YardItem union.
  addYardItem:    (item: import("./types").YardItem) => void;
  removeYardItem: (id: string) => void;
  /** Patch is a structural subset — only fields shared across the union
   *  are statically typeable. Renderers / inspectors that touch
   *  prefab.params should pass `{ params: { … } }`; the value gets
   *  shallow-merged at the call site. */
  updateYardItem: (
    id: string,
    patch: { x?: number; z?: number; rot?: number; scale?: number; params?: Record<string, unknown>; subtype?: import("./types").ZoneSubtype | undefined },
  ) => void;
  /** Yard paths (walkways). Stored in yardPlan.paths[]. */
  addYardPath:    (path: NonNullable<import("./types").YardPlan["paths"]>[number]) => void;
  removeYardPath: (id: string) => void;
  setDoorLen: (room: RoomType, len: number) => void;
  setDoorH:   (room: RoomType, h: number) => void;
  setDoorStyle: (room: RoomType, style: import("./types").DoorStyle) => void;
  setRoomExteriorStyle: (room: RoomType, style: "glass" | "concrete" | "auto") => void;
  updateWindow: (room: RoomType, id: string, patch: Partial<WindowConfig>) => void;

  // Multi-door (new schema). Doors per room are an array; the legacy
  // single-door fields are kept for backward compat and migrated on
  // first add via getDoorsForRoom().
  addDoor:    (room: RoomType, door: import("./types").DoorConfig) => void;
  removeDoor: (room: RoomType, id: string) => void;
  updateDoor: (room: RoomType, id: string, patch: Partial<import("./types").DoorConfig>) => void;

  // Room rotation (swaps width/depth in layout)
  rotateRoom: (room: RoomType) => void;

  // Layout undo history (not persisted, ephemeral)
  layoutHistory: Array<{
    floorIndex: number;
    roomLayout: Record<RoomType, { x: number; y: number }>;
    roomDimensions: Record<RoomType, { width: number; depth: number }>;
    enabledRooms: RoomType[];
    roomShapes?: Record<string, import("./roomGeometry").RoomShape>;
  }>;
  pushLayoutHistory: () => void;
  undoLayout: () => void;

  // Active template tracking
  activeTemplateId: string | null;

  // Persistence
  resetAll: () => void;
  /** "彻底清空"：所有房间也清掉（enabledRooms 为空），剩下一张白纸。
   *  比 resetAll 更进一步；resetAll 会恢复到默认的 9 个启用房间。 */
  wipeAll: () => void;
  loadFromShare: (snapshot: import("./share").ShareSnapshot) => void;
  loadTemplate: (templateId: string) => void;
  /** One-click project template: sets exterior + both floor plans + yard plan. */
  applyProjectTemplate: (templateId: string) => void;
  /** Apply a style preset from EXTERIOR_PRESETS as a full design package:
   *  exterior settings + per-room material defaults (wall/floor/tile/light)
   *  + a matching yard item list. Preserves anything the preset leaves
   *  undefined. See src/lib/exteriorPresets.ts. */
  applyExteriorPreset: (presetId: string) => void;
  /** Apply a design generated by the AI text-to-design API. */
  applyAiDesign: (design: import("./aiDesignTypes").AiDesignResult) => void;

  // Derived
  currentRoom: () => RoomState;
  totalCost: () => number;
  isOverBudget: () => boolean;

  // Camera-move-and-capture (ephemeral — registered by RoomCanvas, called by AiRenderModal)
  cameraAndCapture: ((pos: [number, number, number], lookAt: [number, number, number]) => string) | null;
  setCameraAndCapture: (fn: DesignerStore["cameraAndCapture"]) => void;

  // Global flag — any component can set this to true to open AiRenderModal.
  // page.tsx watches it and opens the modal, then resets the flag.
  aiRenderRequested: boolean;
  requestAiRender: () => void;
  clearAiRenderRequest: () => void;

  // ── Sun analysis — shared across HouseCanvas (3D lighting) + AiRenderModal (prompt) ──
  /** Current slider hour 0–24. Drives real-time sun position in 3D and
   *  the lighting descriptor in the exterior AI render prompt. */
  sunHour: number;
  setSunHour: (h: number) => void;

  /** Project geographic location — used by SunCalc for accurate solar geometry.
   *  Default: Shanghai (31.23°N, 121.47°E). User can override in settings. */
  siteLatLng: { lat: number; lng: number };
  setSiteLatLng: (ll: { lat: number; lng: number }) => void;

  /** Active Stable Diffusion checkpoint filename (must exist in ComfyUI models/checkpoints/).
   *  Drives the CheckpointLoaderSimple node in every workflow. */
  sdModel: string;
  setSdModel: (m: string) => void;

  /** Reference image data URL for IP-Adapter style anchoring */
  referenceImageDataUrl: string | null;
  setReferenceImageDataUrl: (url: string | null) => void;
  /** Extra SD prompt keywords extracted from user's reference image */
  promptAdditions: string;
  setPromptAdditions: (s: string) => void;

  /** IP-Adapter style reference weight — 0.3 (subtle) to 1.0 (dominant).
   *  Only active when referenceImageDataUrl is set. */
  ipAdapterWeight: number;
  setIpAdapterWeight: (w: number) => void;
}

const initialExterior: ExteriorSettings = {
  preset: "modern",
  roofStyle: "flat",
  roofColor: "#2A2A2A",
  wallMaterial: "render",
  wallColor: "#F4F2EE",
  accentColor: "#1A1A1A",
  floors: 2,
  yardPreset: "pool",
  showPerimeterFence: false,
};

// Dev-only global expose for browser-console debugging.
//   useDesignerStore.getState() / setState() from window.__store
// Skipped in production builds via the NODE_ENV check.
const _dev_expose_store = (s: unknown) => {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    (window as unknown as { __store?: unknown }).__store = s;
  }
};

export const useDesignerStore = create<DesignerStore>()(
  temporal(
  persist(
    (set, get) => ({
      floorPlans: [makeDefaultFloorPlan()],
      activeRoom: "living",
      viewMode: "3d",
      selectedInstanceId: null,
      selectedInstanceIds: [],
      doorOpenByRoom: {},
      toggleDoorOpen: (room) => set(st => ({
        doorOpenByRoom: { ...st.doorOpenByRoom, [room]: !st.doorOpenByRoom[room] },
      })),
      curtainOpenByInstanceId: {},
      toggleCurtainOpen: (instanceId) => set(st => ({
        curtainOpenByInstanceId: {
          ...st.curtainOpenByInstanceId,
          [instanceId]: !st.curtainOpenByInstanceId[instanceId],
        },
      })),
      windowOpenByWinId: {},
      toggleWindowOpen: (winId) => set(st => ({
        windowOpenByWinId: { ...st.windowOpenByWinId, [winId]: !st.windowOpenByWinId[winId] },
      })),
      southWallOpacity: 0,
      setSouthWallOpacity: (o) => set({ southWallOpacity: o }),
      ceilingOpacity: 0,
      setCeilingOpacity: (o) => set({ ceilingOpacity: o }),
      lightsOnByRoom: {},
      toggleRoomLights: (room) => set(st => ({
        lightsOnByRoom: {
          ...st.lightsOnByRoom,
          [room]: st.lightsOnByRoom[room] === false ? true : false,
        },
      })),
      fixtureOffById: {},
      toggleFixture: (instanceId) => set(st => ({
        fixtureOffById: {
          ...st.fixtureOffById,
          [instanceId]: !st.fixtureOffById[instanceId],
        },
      })),
      routingMode: null,
      setRoutingMode: (mode) => set({ routingMode: mode, routingFrom: null }),
      routingFrom: null,
      setRoutingFrom: (id) => set({ routingFrom: id }),
      addRoutingConnection: (room, from, to, kind) => set(st => {
        const fp = st.floorPlans[st.activeFloor];
        if (!fp?.rooms[room]) return {};
        const existing = fp.rooms[room].connections ?? [];
        const newConn = {
          id: `conn_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          from, to, kind,
        };
        const updatedRoom = { ...fp.rooms[room], connections: [...existing, newConn] };
        const floorPlans = [...st.floorPlans];
        floorPlans[st.activeFloor] = { ...fp, rooms: { ...fp.rooms, [room]: updatedRoom } };
        return { floorPlans, routingFrom: null };
      }),
      removeRoutingConnection: (room, connId) => set(st => {
        const fp = st.floorPlans[st.activeFloor];
        if (!fp?.rooms[room]) return {};
        const existing = fp.rooms[room].connections ?? [];
        const updatedRoom = { ...fp.rooms[room], connections: existing.filter(c => c.id !== connId) };
        const floorPlans = [...st.floorPlans];
        floorPlans[st.activeFloor] = { ...fp, rooms: { ...fp.rooms, [room]: updatedRoom } };
        return { floorPlans };
      }),
      lightBrightnessByRoom: {},
      lightColorByRoom: {},
      roomExposureByRoom: {},
      setLightBrightness: (room, v) => set(st => ({
        lightBrightnessByRoom: { ...st.lightBrightnessByRoom, [room]: Math.max(0.3, Math.min(2, v)) },
      })),
      setLightColor: (room, hex) => set(st => {
        const next = { ...st.lightColorByRoom };
        if (hex) next[room] = hex; else delete next[room];
        return { lightColorByRoom: next };
      }),
      setRoomExposure: (room, v) => set(st => ({
        roomExposureByRoom: { ...st.roomExposureByRoom, [room]: Math.max(0.6, Math.min(1.8, v)) },
      })),
      lightPosByRoom: {},
      setLightPos: (room, pos) => set(st => ({
        lightPosByRoom: { ...st.lightPosByRoom, [room]: pos },
      })),
      budget: 150000,
      furnitureHistory: [],
      clipboard: [],
      roomClipboard: null,
      blueprint: { image: null, naturalW: 0, naturalH: 0, opacity: 0.4, offsetX: 0, offsetY: 0, scale: 1 },
      scores: { style: 0, space: 0, light: 0, dominantStyle: "" },
      customRoomMeta: {},
      customFurniture: [],
      exterior: { ...initialExterior },
      activeFloor: 0,
      layoutHistory: [],
      activeTemplateId: null,
      cameraAndCapture: null,
      setCameraAndCapture: (fn) => set({ cameraAndCapture: fn }),

      aiRenderRequested: false,
      requestAiRender:   () => set({ aiRenderRequested: true }),
      clearAiRenderRequest: () => set({ aiRenderRequested: false }),

      sunHour: 10.5,
      setSunHour: (h) => set({ sunHour: h }),
      siteLatLng: { lat: 31.23, lng: 121.47 }, // Shanghai default
      setSiteLatLng: (ll) => set({ siteLatLng: ll }),
      sdModel: "RealVisXL_V5.0_fp16.safetensors",
      setSdModel: (m) => set({ sdModel: m }),

      referenceImageDataUrl: null,
      setReferenceImageDataUrl: (url) => set({ referenceImageDataUrl: url }),
      promptAdditions: "",
      setPromptAdditions: (s) => set({ promptAdditions: s }),
      ipAdapterWeight: 0.75,
      setIpAdapterWeight: (w) => set({ ipAdapterWeight: w }),

      setActiveRoom: (room) => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
        if (!fp?.rooms[room]) { set({ activeRoom: room, selectedInstanceId: null, selectedInstanceIds: [] }); return; }
        const { materials, placedItems } = fp.rooms[room];
        const computed = computeScores(materials, placedItems);
        const dominantStyle = s.activeTemplateId
          ? (ALL_TEMPLATES.find(t => t.id === s.activeTemplateId)?.styleTag ?? computed.dominantStyle)
          : computed.dominantStyle;
        set({ activeRoom: room, selectedInstanceId: null, selectedInstanceIds: [], scores: { ...computed, dominantStyle } });
      },

      setViewMode: (mode) => set({ viewMode: mode }),

      setMaterial: (material) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const updatedRoom = {
          ...fp.rooms[activeRoom],
          materials: { ...fp.rooms[activeRoom].materials, [material.category]: material },
        };
        const updatedRooms = { ...fp.rooms, [activeRoom]: updatedRoom };
        const newFp = { ...fp, rooms: updatedRooms };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = newFp;
        const { materials, placedItems } = updatedRoom;
        set({ floorPlans, scores: computeScores(materials, placedItems), activeTemplateId: null });
      },

      removeMaterial: (category) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const updatedMaterials = { ...fp.rooms[activeRoom].materials };
        delete updatedMaterials[category];
        const updatedRoom = { ...fp.rooms[activeRoom], materials: updatedMaterials };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        set({ floorPlans, scores: computeScores(updatedMaterials, fp.rooms[activeRoom].placedItems) });
      },

      setWallSide: (side, material) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const key = side === "N" ? "wallBack" : side === "S" ? "wallFront" : side === "W" ? "wallLeft" : "wallRight";
        const updatedMaterials = { ...fp.rooms[activeRoom].materials };
        if (material) updatedMaterials[key] = material;
        else delete updatedMaterials[key];
        const updatedRoom = { ...fp.rooms[activeRoom], materials: updatedMaterials };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        set({ floorPlans, scores: computeScores(updatedMaterials, fp.rooms[activeRoom].placedItems) });
      },

      setWallLower: (material) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const updatedMaterials = { ...fp.rooms[activeRoom].materials };
        if (material) {
          updatedMaterials.wallLower = material;
          // Default split at chair-rail height (110cm) if user hasn't set one.
          if (updatedMaterials.wallSplitHeight === undefined) {
            updatedMaterials.wallSplitHeight = 110;
          }
        } else {
          delete updatedMaterials.wallLower;
        }
        const updatedRoom = { ...fp.rooms[activeRoom], materials: updatedMaterials };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        set({ floorPlans, scores: computeScores(updatedMaterials, fp.rooms[activeRoom].placedItems) });
      },

      setWallSplitHeight: (cm) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const clamped = Math.max(30, Math.min(200, Math.round(cm)));
        const updatedMaterials = { ...fp.rooms[activeRoom].materials, wallSplitHeight: clamped };
        const updatedRoom = { ...fp.rooms[activeRoom], materials: updatedMaterials };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        set({ floorPlans });
      },

      setWallExterior: (side, material) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const updatedMaterials = { ...fp.rooms[activeRoom].materials };
        const fieldMap = {
          all: "wallExterior",
          N:   "wallBackExterior",
          S:   "wallFrontExterior",
          W:   "wallLeftExterior",
          E:   "wallRightExterior",
        } as const;
        const key = fieldMap[side];
        if (material) (updatedMaterials as Record<string, MaterialItem>)[key] = material;
        else delete (updatedMaterials as Record<string, unknown>)[key];
        const updatedRoom = { ...fp.rooms[activeRoom], materials: updatedMaterials };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        set({ floorPlans });
      },

      placeFurniture: (furnitureId) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const furniture = getFurnitureById(furnitureId);
        if (!furniture) return;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        // Push history before placing
        set(st => ({ furnitureHistory: [...st.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...fp.rooms[activeRoom].placedItems], exteriorDecor: [...(fp.rooms[activeRoom].exteriorDecor ?? [])] }] }));

        const def = ROOM_DEFS[activeRoom];
        const newItem: PlacedItem = {
          instanceId: genId(),
          furnitureId,
          x: def.width / 2,
          z: def.depth / 2,
          rotation: 0,
          scaleW: 1,
          scaleD: 1,
          scaleH: 1,
        };

        const updatedPlaced = [...fp.rooms[activeRoom].placedItems, newItem];
        const updatedRoom = { ...fp.rooms[activeRoom], placedItems: updatedPlaced };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        const { materials } = updatedRoom;
        set({ floorPlans, selectedInstanceId: newItem.instanceId, scores: computeScores(materials, updatedPlaced), viewMode: "2d" });
      },

      moveItem: (instanceId, x, z) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const updatedPlaced = fp.rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId ? { ...p, x, z } : p
        );
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: { ...fp.rooms[activeRoom], placedItems: updatedPlaced } } };
        set({ floorPlans });
      },

      rotateItem: (instanceId) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        set(st => ({ furnitureHistory: [...st.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...fp.rooms[activeRoom].placedItems], exteriorDecor: [...(fp.rooms[activeRoom].exteriorDecor ?? [])] }] }));
        const updatedPlaced = fp.rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId ? { ...p, rotation: (p.rotation + 90) % 360 } : p
        );
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: { ...fp.rooms[activeRoom], placedItems: updatedPlaced } } };
        set({ floorPlans });
      },

      toggleItemMountCeiling: (instanceId) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const updatedPlaced = fp.rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId ? { ...p, mountCeiling: !p.mountCeiling } : p
        );
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: { ...fp.rooms[activeRoom], placedItems: updatedPlaced } } };
        set({ floorPlans });
      },

      removeItem: (instanceId) => {
        const s = get();
        const { activeRoom, activeFloor, selectedInstanceId, selectedInstanceIds } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        set(st => ({ furnitureHistory: [...st.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...fp.rooms[activeRoom].placedItems], exteriorDecor: [...(fp.rooms[activeRoom].exteriorDecor ?? [])] }] }));
        const updatedPlaced = fp.rooms[activeRoom].placedItems.filter(p => p.instanceId !== instanceId);
        const updatedRoom = { ...fp.rooms[activeRoom], placedItems: updatedPlaced };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        const { materials } = updatedRoom;
        const newIds = selectedInstanceIds.filter(id => id !== instanceId);
        set({
          floorPlans,
          selectedInstanceId: selectedInstanceId === instanceId ? null : selectedInstanceId,
          selectedInstanceIds: newIds,
          scores: computeScores(materials, updatedPlaced),
        });
      },

      selectInstance: (instanceId) => set({ selectedInstanceId: instanceId, selectedInstanceIds: instanceId ? [instanceId] : [] }),

      setSelection: (ids) => set({ selectedInstanceIds: ids, selectedInstanceId: ids[0] ?? null }),

      duplicateItems: (instanceIds) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        set(st => ({ furnitureHistory: [...st.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...fp.rooms[activeRoom].placedItems], exteriorDecor: [...(fp.rooms[activeRoom].exteriorDecor ?? [])] }] }));
        const placed = fp.rooms[activeRoom].placedItems;
        const copies: PlacedItem[] = instanceIds.flatMap(id => {
          const src = placed.find(p => p.instanceId === id);
          if (!src) return [];
          return [{ ...src, instanceId: genId(), x: src.x + 50, z: src.z + 50 }];
        });
        const updatedPlaced = [...placed, ...copies];
        const updatedRoom = { ...fp.rooms[activeRoom], placedItems: updatedPlaced };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        const { materials } = updatedRoom;
        const newIds = copies.map(c => c.instanceId);
        set({ floorPlans, selectedInstanceIds: newIds, selectedInstanceId: newIds[0] ?? null, scores: computeScores(materials, updatedPlaced) });
      },

      removeItems: (instanceIds) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        set(st => ({ furnitureHistory: [...st.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...fp.rooms[activeRoom].placedItems], exteriorDecor: [...(fp.rooms[activeRoom].exteriorDecor ?? [])] }] }));
        const updatedPlaced = fp.rooms[activeRoom].placedItems.filter(p => !instanceIds.includes(p.instanceId));
        const updatedRoom = { ...fp.rooms[activeRoom], placedItems: updatedPlaced };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        const { materials } = updatedRoom;
        set({ floorPlans, selectedInstanceIds: [], selectedInstanceId: null, scores: computeScores(materials, updatedPlaced) });
      },

      clearRoom: () => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        set(st => ({ furnitureHistory: [...st.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...fp.rooms[activeRoom].placedItems], exteriorDecor: [...(fp.rooms[activeRoom].exteriorDecor ?? [])] }] }));
        const clearedRoom = { materials: {}, placedItems: [] };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: clearedRoom } };
        set({ floorPlans, selectedInstanceIds: [], selectedInstanceId: null, scores: computeScores({}, []), activeTemplateId: null });
      },

      autoDecorate: () => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const def = ROOM_DEFS[activeRoom];
        const dims = fp.roomDimensions[activeRoom] ?? { width: def.width, depth: def.depth };
        const existing = fp.rooms[activeRoom].placedItems;

        // Room-type-aware decoration kit. Each entry is a furnitureId + a
        // position picker that returns (x,z) in cm from back-left corner.
        // Positions are chosen to stay clear of walls and typical center-
        // placed furniture. Skip any category already present in the room.
        const existingCats = new Set(
          existing
            .map(p => getFurnitureById(p.furnitureId)?.category)
            .filter(Boolean)
        );

        const DECOR_PLAN: Record<string, Array<{ id: string; pos: (w: number, d: number) => { x: number; z: number; rot?: number } }>> = {
          living: [
            { id: "rug-nordic-geo",    pos: (w, d) => ({ x: w / 2,        z: d * 0.65 }) },
            { id: "plant-monstera",    pos: (w)    => ({ x: w - 40,       z: 40 }) },
            { id: "plant-rubber-tree", pos: (_, d) => ({ x: 40,           z: d - 40 }) },
            { id: "artwork-abstract",  pos: (w)    => ({ x: w / 2,        z: 10 }) },
            { id: "lamp-arc-gold",     pos: (_, d) => ({ x: 40,           z: d * 0.4 }) },
          ],
          master: [
            { id: "rug-modern-gray",   pos: (w, d) => ({ x: w / 2,        z: d * 0.7 }) },
            { id: "plant-sansevieria", pos: (_, d) => ({ x: 35,           z: d - 35 }) },
            { id: "lamp-arc-gold",     pos: (w, d) => ({ x: w - 40,       z: d * 0.4 }) },
            { id: "artwork-inkwash",   pos: (w)    => ({ x: w / 2,        z: 10 }) },
          ],
          bedroom: [
            { id: "rug-modern-gray",   pos: (w, d) => ({ x: w / 2,        z: d * 0.65 }) },
            { id: "plant-sansevieria", pos: (_, d) => ({ x: 35,           z: d - 35 }) },
          ],
          bedroom2: [
            { id: "rug-modern-gray",   pos: (w, d) => ({ x: w / 2,        z: d * 0.65 }) },
            { id: "plant-sansevieria", pos: (_, d) => ({ x: 35,           z: d - 35 }) },
          ],
          bedroom3: [
            { id: "rug-modern-gray",   pos: (w, d) => ({ x: w / 2,        z: d * 0.65 }) },
            { id: "plant-sansevieria", pos: (_, d) => ({ x: 35,           z: d - 35 }) },
          ],
          dining: [
            { id: "plant-monstera",    pos: (_, d) => ({ x: 40,           z: d - 40 }) },
            { id: "rug-persian",       pos: (w, d) => ({ x: w / 2,        z: d / 2 }) },
            { id: "artwork-inkwash",   pos: (w)    => ({ x: w / 2,        z: 10 }) },
          ],
          study: [
            { id: "plant-rubber-tree", pos: (w, d) => ({ x: w - 40,       z: d - 40 }) },
            { id: "lamp-industrial-black", pos: (_, d) => ({ x: 40,        z: d - 40 }) },
            { id: "rug-nordic-geo",    pos: (w, d) => ({ x: w / 2,        z: d * 0.55 }) },
          ],
          study2: [
            { id: "plant-rubber-tree", pos: (w, d) => ({ x: w - 40,       z: d - 40 }) },
            { id: "rug-nordic-geo",    pos: (w, d) => ({ x: w / 2,        z: d * 0.55 }) },
          ],
        };

        const plan = DECOR_PLAN[activeRoom as keyof typeof DECOR_PLAN];
        if (!plan) return; // kitchen / bathroom / etc. — skip auto-decorate

        set(st => ({ furnitureHistory: [...st.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...existing] }] }));

        const toAdd: PlacedItem[] = [];
        for (const entry of plan) {
          const f = getFurnitureById(entry.id);
          if (!f) continue;
          // Don't add if this category already exists in the room (except
          // plants — a room can happily have several plants).
          if (f.category !== "plant" && existingCats.has(f.category)) continue;
          const { x, z, rot } = entry.pos(dims.width, dims.depth);
          toAdd.push({
            instanceId: genId(),
            furnitureId: entry.id,
            x, z,
            rotation: rot ?? 0,
            scaleW: 1, scaleD: 1, scaleH: 1,
          });
        }

        if (toAdd.length === 0) return;
        const updatedPlaced = [...existing, ...toAdd];
        const updatedRoom = { ...fp.rooms[activeRoom], placedItems: updatedPlaced };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        set({ floorPlans, scores: computeScores(updatedRoom.materials, updatedPlaced) });
      },

      resizeItem: (instanceId, scaleW, scaleD, scaleH) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const updatedPlaced = fp.rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId
            ? {
                ...p,
                scaleW: Math.max(0.3, Math.min(4, scaleW)),
                scaleD: Math.max(0.3, Math.min(4, scaleD)),
                scaleH: scaleH === undefined ? (p.scaleH ?? 1) : Math.max(0.3, Math.min(4, scaleH)),
              }
            : p
        );
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: { ...fp.rooms[activeRoom], placedItems: updatedPlaced } } };
        set({ floorPlans });
      },

      setElevation: (instanceId, elevationY) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const updatedPlaced = fp.rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId
            ? { ...p, elevationY: Math.max(0, Math.min(300, elevationY)) }
            : p
        );
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: { ...fp.rooms[activeRoom], placedItems: updatedPlaced } } };
        set({ floorPlans });
      },

      pushFurnitureHistory: () => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        set(st => ({
          furnitureHistory: [
            ...st.furnitureHistory.slice(-29),
            { room: activeRoom, placedItems: [...fp.rooms[activeRoom].placedItems], exteriorDecor: [...(fp.rooms[activeRoom].exteriorDecor ?? [])] },
          ],
        }));
      },

      undoFurniture: () => {
        const { activeRoom, activeFloor } = get();
        set(s => {
          const idx = s.furnitureHistory.map(h => h.room).lastIndexOf(activeRoom);
          if (idx === -1) return {};
          const prev = s.furnitureHistory[idx];
          const fp = s.floorPlans[activeFloor];
          if (!fp?.rooms[activeRoom]) return {};
          // Restore BOTH placedItems and exteriorDecor from the snapshot.
          // exteriorDecor is optional on older snapshots (backward compat)
          // — if absent, leave the current decor alone.
          const updatedRoom = {
            ...fp.rooms[activeRoom],
            placedItems: prev.placedItems,
            ...(prev.exteriorDecor !== undefined ? { exteriorDecor: prev.exteriorDecor } : {}),
          };
          const floorPlans = [...s.floorPlans];
          floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
          return {
            floorPlans,
            furnitureHistory: s.furnitureHistory.filter((_, i) => i !== idx),
            selectedInstanceIds: [],
            selectedInstanceId: null,
            selectedExteriorDecorId: null,
            scores: computeScores(updatedRoom.materials, prev.placedItems),
          };
        });
      },

      copyToClipboard: (instanceIds) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const items = fp.rooms[activeRoom].placedItems
          .filter(p => instanceIds.includes(p.instanceId))
          .map(p => ({
            furnitureId: p.furnitureId,
            x: p.x, z: p.z,
            rotation: p.rotation,
            scaleW: p.scaleW ?? 1,
            scaleD: p.scaleD ?? 1,
            scaleH: p.scaleH ?? 1,
          }));
        set({ clipboard: items });
      },

      pasteFromClipboard: () => {
        const s = get();
        const { activeRoom, activeFloor, clipboard } = s;
        if (clipboard.length === 0) return;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const prevItems = fp.rooms[activeRoom].placedItems;
        const def = ROOM_DEFS[activeRoom];
        const copies: PlacedItem[] = clipboard.map(c => ({
          instanceId: genId(),
          furnitureId: c.furnitureId,
          x: Math.min(c.x + 50, def.width * 0.9),
          z: Math.min(c.z + 50, def.depth * 0.9),
          rotation: c.rotation,
          scaleW: c.scaleW,
          scaleD: c.scaleD,
          scaleH: c.scaleH,
        }));
        const updatedPlaced = [...prevItems, ...copies];
        const updatedRoom = { ...fp.rooms[activeRoom], placedItems: updatedPlaced };
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: updatedRoom } };
        const newIds = copies.map(c => c.instanceId);
        set(st => ({
          floorPlans,
          furnitureHistory: [...st.furnitureHistory.slice(-29), { room: activeRoom, placedItems: prevItems }],
          selectedInstanceIds: newIds,
          selectedInstanceId: newIds[0] ?? null,
          scores: computeScores(updatedRoom.materials, updatedPlaced),
          viewMode: "2d",
        }));
      },

      setBudget: (budget) => set({ budget }),

      updateRoomLayout: (room, x, y) => {
        updateFloor(get, set, fp => ({ roomLayout: { ...fp.roomLayout, [room]: { x, y } } }));
      },

      updateRoomDimension: (room, width, depth) => {
        updateFloor(get, set, fp => {
          const nextShapes = { ...(fp.roomShapes ?? {}) };
          // If a preset shape is set, rebuild it for the new dims so the
          // polygon scales with the bounding box.
          const existing = nextShapes[room];
          if (existing && existing.preset !== "rect" && existing.preset !== "custom") {
            // Lazy import to avoid circular
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { buildShape } = require("./roomGeometry") as typeof import("./roomGeometry");
            nextShapes[room] = buildShape(existing.preset, width, depth);
          }
          return {
            roomDimensions: { ...fp.roomDimensions, [room]: { width, depth } },
            roomShapes: nextShapes,
          };
        });
      },

      setRoomShape: (room: RoomType, preset: import("./roomGeometry").ShapePreset) => {
        updateFloor(get, set, fp => {
          const dims = fp.roomDimensions[room];
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { buildShape, rectShape } = require("./roomGeometry") as typeof import("./roomGeometry");
          const nextShapes = { ...(fp.roomShapes ?? {}) };
          if (preset === "rect") {
            // Initialize rectangle as an editable polygon (4 corner points).
            // Callers that want to truly clear the shape override should call
            // deleteRoomShapePoint down to 0 themselves — but for "enter
            // shape-edit mode on a plain rect" we need real polygon points.
            nextShapes[room] = rectShape(dims.width, dims.depth);
          } else if (preset === "custom") {
            // Not called with "custom" from the preset picker — handled via
            // updateRoomShapePoint instead. Ignore defensively.
          } else {
            nextShapes[room] = buildShape(preset, dims.width, dims.depth);
          }
          return { roomShapes: nextShapes };
        });
      },

      rectifyRoomShape: (room: RoomType) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomShapes?.[room];
          if (!cur || cur.points.length < 3) return {};
          const pts = cur.points.map(p => [p[0], p[1]] as [number, number]);
          const n = pts.length;
          // For each edge, decide if it's dominantly horizontal or vertical,
          // and snap the second vertex to match the first along the other axis.
          // Two passes so drift at the closing edge gets absorbed.
          for (let pass = 0; pass < 2; pass++) {
            for (let i = 0; i < n; i++) {
              const a = pts[i];
              const b = pts[(i + 1) % n];
              const dx = Math.abs(b[0] - a[0]);
              const dz = Math.abs(b[1] - a[1]);
              if (dx >= dz) {
                // horizontal edge — average Z and assign to both
                const avg = Math.round((a[1] + b[1]) / 2 / 10) * 10;
                a[1] = avg; b[1] = avg;
              } else {
                const avg = Math.round((a[0] + b[0]) / 2 / 10) * 10;
                a[0] = avg; b[0] = avg;
              }
            }
          }
          // Drop near-duplicate consecutive vertices (< 5cm apart)
          const cleaned: Array<[number, number]> = [];
          for (let i = 0; i < n; i++) {
            const p = pts[i], prev = cleaned[cleaned.length - 1];
            if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 5) cleaned.push(p);
          }
          return {
            roomShapes: {
              ...(fp.roomShapes ?? {}),
              [room]: { preset: "custom", points: cleaned },
            },
          };
        });
      },

      updateRoomShapePoint: (room: RoomType, idx: number, x: number, z: number) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomShapes?.[room];
          if (!cur) return {};
          const raw = cur.points.map((p, i) => (i === idx ? [x, z] : p)) as Array<[number, number]>;
          const { points, patch } = syncDimsAndLayout(fp, room, raw);
          return {
            roomShapes: { ...fp.roomShapes, [room]: { preset: "custom", points } },
            ...patch,
          };
        });
      },

      deleteRoomShapePoint: (room: RoomType, idx: number) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomShapes?.[room];
          if (!cur || cur.points.length <= 3) return {};   // keep ≥3
          const raw = cur.points.filter((_, i) => i !== idx);
          const { points, patch } = syncDimsAndLayout(fp, room, raw);
          return {
            roomShapes: { ...fp.roomShapes, [room]: { preset: "custom", points } },
            ...patch,
          };
        });
      },

      insertRoomShapePoint: (room: RoomType, afterIdx: number, x: number, z: number) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomShapes?.[room];
          if (!cur) return {};
          const raw = [...cur.points];
          raw.splice(afterIdx + 1, 0, [x, z] as [number, number]);
          const { points, patch } = syncDimsAndLayout(fp, room, raw);
          return {
            roomShapes: { ...fp.roomShapes, [room]: { preset: "custom", points } },
            ...patch,
          };
        });
      },

      toggleRoom: (room) => {
        updateFloor(get, set, fp => {
          const adding = !fp.enabledRooms.includes(room);
          return {
            enabledRooms: adding ? [...fp.enabledRooms, room] : fp.enabledRooms.filter(r => r !== room),
            // 确保新加房间在 rooms 对象里有条目
            rooms: adding && !fp.rooms[room]
              ? { ...fp.rooms, [room]: { materials: {}, placedItems: [] } }
              : fp.rooms,
          };
        });
      },

      addRoom: (room) => {
        updateFloor(get, set, fp => ({
          enabledRooms: fp.enabledRooms.includes(room) ? fp.enabledRooms : [...fp.enabledRooms, room],
          rooms: fp.rooms[room] ? fp.rooms : { ...fp.rooms, [room]: { materials: {}, placedItems: [] } },
        }));
      },

      removeRoom: (room) => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
        const newActiveRoom = s.activeRoom === room
          ? (fp.enabledRooms.find(r => r !== room) ?? "living")
          : s.activeRoom;
        updateFloor(get, set, fp2 => {
          const nextShapes = fp2.roomShapes ? { ...fp2.roomShapes } : undefined;
          if (nextShapes) delete nextShapes[room];
          return {
            enabledRooms: fp2.enabledRooms.filter(r => r !== room),
            roomShapes: nextShapes,
          };
        });
        if (newActiveRoom !== s.activeRoom) set({ activeRoom: newActiveRoom });
      },

      resetLayout: () => {
        updateFloor(get, set, () => ({
          roomLayout: { ...DEFAULT_ROOM_LAYOUT },
          roomDimensions: { ...DEFAULT_ROOM_DIMENSIONS },
          enabledRooms: [...DEFAULT_ENABLED],
        }));
      },

      autoInsertHallway: () => {
        const HALLWAY_W = 80; // cm — corridor width
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
        if (!fp) return;

        // Gather indoor, non-hallway rooms that have layout data
        const OUTDOOR: RoomType[] = ["yard","garage","gym","cinema","pool","terrace","deck","balcony","balcony2"];
        const rooms = (fp.enabledRooms ?? []).filter(r => r !== "hallway" && !OUTDOOR.includes(r));

        type Box = { r: RoomType; x: number; y: number; w: number; d: number };
        const boxes: Box[] = [];
        for (const r of rooms) {
          const pos = fp.roomLayout?.[r];
          const dim = fp.roomDimensions?.[r];
          if (!pos || !dim) continue;
          boxes.push({ r, x: pos.x, y: pos.y, w: dim.width, d: dim.depth });
        }
        if (boxes.length < 2) return;

        // ── Step 1: classify left vs right by x-center (median split) ──────────
        const centers = boxes.map(b => b.x + b.w / 2).sort((a, b) => a - b);
        const medCenter = centers[Math.floor(centers.length / 2)];

        const leftGroup  = boxes.filter(b => b.x + b.w / 2 <= medCenter);
        const rightGroup = boxes.filter(b => b.x + b.w / 2 >  medCenter);
        if (leftGroup.length === 0 || rightGroup.length === 0) return;

        // ── Step 2: find split position = rightmost edge of left group ──────────
        const splitX     = Math.max(...leftGroup.map(b => b.x + b.w));
        // Leftmost edge of right group (may overlap with left group)
        const rightStart = Math.min(...rightGroup.map(b => b.x));

        // How much do we need to shift the right group?
        // If rightStart < splitX they overlap → shift by (splitX - rightStart + HALLWAY_W)
        // If rightStart === splitX they touch → shift by HALLWAY_W
        // If rightStart > splitX there is already a gap → we still normalize to HALLWAY_W
        const shift = splitX + HALLWAY_W - rightStart;
        // Only shift if the gap is not already large enough for a hallway
        const currentGap = rightStart - splitX;
        if (currentGap >= HALLWAY_W - 5) {
          // Gap exists and is already ≥ hallway width — just place hallway in the gap
        }

        // ── Step 3: compute hallway y-span ──────────────────────────────────────
        const allY = boxes.flatMap(b => [b.y, b.y + b.d]);
        const minY = Math.min(...allY);
        const maxY = Math.max(...allY);
        const hallwayDepth = maxY - minY;
        if (hallwayDepth <= 0) return;

        // ── Step 4: build new layout ─────────────────────────────────────────────
        const newLayout = { ...fp.roomLayout } as Record<RoomType, { x: number; y: number }>;
        const newDims   = { ...fp.roomDimensions } as Record<RoomType, { width: number; depth: number }>;

        if (currentGap < HALLWAY_W - 5) {
          // Shift right group to make room for hallway
          for (const b of rightGroup) {
            newLayout[b.r] = { x: b.x + shift, y: b.y };
          }
        }

        // Place hallway between groups
        newLayout["hallway"] = { x: splitX, y: minY };
        newDims["hallway"]   = { width: HALLWAY_W, depth: hallwayDepth };

        const newEnabled: RoomType[] = fp.enabledRooms.includes("hallway")
          ? fp.enabledRooms
          : [...fp.enabledRooms, "hallway" as RoomType];

        // Push undo snapshot first
        set({
          layoutHistory: [
            ...s.layoutHistory.slice(-19),
            {
              floorIndex:     s.activeFloor,
              roomLayout:     { ...fp.roomLayout },
              roomDimensions: { ...fp.roomDimensions },
              enabledRooms:   [...fp.enabledRooms],
            },
          ],
        });

        updateFloor(get, set, () => ({
          roomLayout: newLayout,
          roomDimensions: newDims,
          enabledRooms: newEnabled,
        }));
      },

      setCustomRoomMeta: (room, name, icon) =>
        set(s => ({ customRoomMeta: { ...s.customRoomMeta, [room]: { name, icon } } })),

      setBlueprint: (patch) => set(s => ({ blueprint: { ...s.blueprint, ...patch } })),
      clearBlueprint: () => set(() => ({ blueprint: { image: null, naturalW: 0, naturalH: 0, opacity: 0.4, offsetX: 0, offsetY: 0, scale: 1 } })),

      applyFloorplanLayout: (layoutId) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { FLOORPLAN_LAYOUTS } = require("./floorplanLayouts") as typeof import("./floorplanLayouts");
        const layout = FLOORPLAN_LAYOUTS.find(l => l.id === layoutId);
        if (!layout) return;
        updateFloor(get, set, fp => {
          const enabled = layout.rooms.map(r => r.room);
          const layoutMap = { ...fp.roomLayout };
          const dimsMap = { ...fp.roomDimensions };
          const shapesMap: Partial<Record<RoomType, import("./roomGeometry").RoomShape>> = { ...(fp.roomShapes ?? {}) };
          // Clear stale shapes from rooms not in this template
          for (const key of Object.keys(shapesMap) as RoomType[]) {
            if (!enabled.includes(key)) delete shapesMap[key];
          }
          for (const r of layout.rooms) {
            layoutMap[r.room] = { x: r.x, y: r.y };
            dimsMap[r.room]   = { width: r.width, depth: r.depth };
            if (r.shape) {
              shapesMap[r.room] = {
                preset: r.shape.preset,
                points: r.shape.points.map(p => [...p] as [number, number]),
              };
            } else {
              delete shapesMap[r.room];
            }
          }
          // 确保所有启用的房间在 rooms 对象里都有条目（兼容旧存档）
          const roomsMap = { ...fp.rooms };
          for (const r of enabled) {
            if (!roomsMap[r]) roomsMap[r] = { materials: {}, placedItems: [] };
          }
          return {
            enabledRooms: enabled,
            roomLayout: layoutMap,
            roomDimensions: dimsMap,
            roomShapes: shapesMap,
            rooms: roomsMap,
          };
        });
      },

      applyProjectTemplate: (templateId) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PROJECT_TEMPLATES } = require("./projectTemplates") as typeof import("./projectTemplates");
        const tpl = PROJECT_TEMPLATES.find(t => t.id === templateId);
        if (!tpl) return;

        // 1. Build the new floorPlans array
        const s = get();
        const floors = tpl.floorLayouts.length;
        const newFloorPlans = Array.from({ length: floors }, (_, fi) => {
          const existing = s.floorPlans[fi] ?? makeDefaultFloorPlan();
          const layout   = tpl.floorLayouts[fi];
          const enabled  = layout.rooms.map(r => r.room);
          const layoutMap = { ...existing.roomLayout };
          const dimsMap   = { ...existing.roomDimensions };
          for (const r of layout.rooms) {
            layoutMap[r.room] = { x: r.x, y: r.y };
            dimsMap[r.room]   = { width: r.width, depth: r.depth };
          }
          return {
            ...existing,
            enabledRooms: enabled,
            roomLayout: layoutMap,
            roomDimensions: dimsMap,
            // Attach the yard plan to floor 0 only
            ...(fi === 0 ? { yardPlan: tpl.yardPlan } : {}),
          };
        });

        // 2. Set exterior + floorPlans + reset to floor 0
        set({
          exterior: { ...s.exterior, ...tpl.exterior, floors },
          floorPlans: newFloorPlans,
          activeFloor: 0,
        });

        // 3. Apply style template (furniture + materials + doors/windows) to every floor
        if (tpl.styleTemplateId) {
          for (let fi = 0; fi < floors; fi++) {
            set({ activeFloor: fi });
            get().loadTemplate(tpl.styleTemplateId);
          }
          // Reset to floor 0 and pick an activeRoom that actually EXISTS on floor 0.
          // (The last loadTemplate call set activeRoom from floor N-1, which may have
          // different rooms — e.g. floor 1 has "master" but floor 0 does not.)
          const floor0Rooms = get().floorPlans[0].enabledRooms;
          const preferredRooms: RoomType[] = ["living", "master", "bedroom", "kitchen", "dining", "bathroom"];
          const bestRoom = preferredRooms.find(r => floor0Rooms.includes(r)) ?? floor0Rooms[0] ?? "living" as RoomType;
          set({ activeFloor: 0, activeRoom: bestRoom });
        }
      },

      applyExteriorPreset: (presetId) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { EXTERIOR_PRESETS } = require("./exteriorPresets") as typeof import("./exteriorPresets");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { MATERIALS } = require("./data") as typeof import("./data");
        const preset = EXTERIOR_PRESETS.find(p => p.id === presetId);
        if (!preset) return;

        // 1) Exterior settings — merge over current (preserves unset fields).
        get().setExterior(preset.settings);

        // 2) Per-room material defaults + 3) yard items. Both touch
        // floorPlans, so we batch them into one set() to avoid an
        // intermediate render with mismatched state.
        const s = get();
        const findMat = (id: string | undefined) =>
          id ? MATERIALS.find(m => m.id === id) : undefined;

        let floorPlans = s.floorPlans;

        if (preset.roomMaterials) {
          const rm = preset.roomMaterials;
          floorPlans = floorPlans.map((fp, fi) => {
            if (!fp) return fp;
            const updatedRooms = { ...fp.rooms };
            // Only touch rooms that are actually enabled on this floor —
            // no point materialising 主卧 on floor 0 if user disabled it.
            for (const room of fp.enabledRooms) {
              const recipe = rm[room];
              if (!recipe) continue;
              const existing = updatedRooms[room];
              if (!existing) continue;
              const wall    = findMat(recipe.wall);
              const floor   = findMat(recipe.floor);
              const tile    = findMat(recipe.tile);
              const light   = findMat(recipe.light);
              const lower   = findMat(recipe.wallLower);
              updatedRooms[room] = {
                ...existing,
                materials: {
                  ...existing.materials,
                  ...(wall  ? { wall }       : {}),
                  ...(floor ? { floor }      : {}),
                  ...(tile  ? { tile }       : {}),
                  ...(light ? { light }      : {}),
                  ...(lower ? { wallLower: lower } : {}),
                },
              };
            }
            // Recompute scores only for the active floor's active room.
            if (fi === s.activeFloor) {
              const r = updatedRooms[s.activeRoom];
              if (r) {
                // computeScores happens via the closing set() below — we
                // call it inline for the new activeRoom snapshot.
              }
            }
            return { ...fp, rooms: updatedRooms };
          });
        }

        if (preset.yardItems) {
          // Replace floor-0 yard items wholesale — the preset's landscape
          // is curated to match the facade. Paths / groundPolygons (if
          // any) are preserved.
          floorPlans = floorPlans.map((fp, fi) => {
            if (fi !== 0 || !fp) return fp;
            return {
              ...fp,
              yardPlan: {
                ...(fp.yardPlan ?? { items: [] }),
                items: preset.yardItems!,
              },
            };
          });
        }

        // 4) Commit + refresh scores for the active room.
        const activeFp = floorPlans[s.activeFloor];
        const activeRoom = activeFp?.rooms?.[s.activeRoom];
        const scores = activeRoom
          ? computeScores(activeRoom.materials, activeRoom.placedItems)
          : s.scores;
        set({ floorPlans, scores, activeTemplateId: null });
      },

      applyAiDesign: (design) => {
        const s = get();
        const floors = Math.max(1, Math.min(3, design.floors ?? 1));
        const newFloorPlans = Array.from({ length: floors }, (_, fi) => {
          const existing = s.floorPlans[fi] ?? makeDefaultFloorPlan();
          const layoutEntry = design.floorLayouts?.find(l => l.floorIndex === fi);
          if (!layoutEntry || !layoutEntry.rooms?.length) {
            return { ...existing, enabledRooms: [] };
          }
          const enabled: RoomType[] = [];
          const layoutMap = { ...existing.roomLayout };
          const dimsMap   = { ...existing.roomDimensions };
          for (const r of layoutEntry.rooms) {
            // Validate room type
            if (!(r.type in ROOM_DEFS)) continue;
            enabled.push(r.type as RoomType);
            layoutMap[r.type as RoomType] = { x: r.x ?? 50, y: r.y ?? 50 };
            dimsMap[r.type as RoomType]   = {
              width: Math.max(120, r.widthCm ?? ROOM_DEFS[r.type as RoomType]?.width ?? 300),
              depth: Math.max(100, r.depthCm ?? ROOM_DEFS[r.type as RoomType]?.depth ?? 260),
            };
          }
          return { ...existing, enabledRooms: enabled, roomLayout: layoutMap, roomDimensions: dimsMap };
        });

        const extUpdate: Partial<typeof s.exterior> = { floors };
        if (design.exterior?.wallColor)  extUpdate.wallColor  = design.exterior.wallColor;
        if (design.exterior?.roofColor)  extUpdate.roofColor  = design.exterior.roofColor;
        if (design.exterior?.roofType)   extUpdate.roofStyle  = design.exterior.roofType as typeof s.exterior.roofStyle;
        if (design.exterior?.accentColor) extUpdate.accentColor = design.exterior.accentColor;

        set({ exterior: { ...s.exterior, ...extUpdate }, floorPlans: newFloorPlans, activeFloor: 0 });
      },

      copyRoom: (room) => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
        if (!fp?.rooms[room]) return;
        const def = ROOM_DEFS[room];
        const meta = s.customRoomMeta[room];
        const dim = fp.roomDimensions[room] ?? { width: def.width, depth: def.depth };
        set({ roomClipboard: {
          materials: { ...fp.rooms[room].materials },
          placedItems: [...fp.rooms[room].placedItems],
          name: meta?.name ?? def.name,
          icon: meta?.icon ?? def.icon,
          width: dim.width,
          depth: dim.depth,
          shape: fp.roomShapes?.[room]
            ? { preset: fp.roomShapes[room]!.preset, points: fp.roomShapes[room]!.points.map(p => [...p] as [number, number]) }
            : undefined,
        }});
      },

      pasteAsNewRoom: () => {
        const s = get();
        const { roomClipboard, activeFloor } = s;
        if (!roomClipboard) return;
        const fp = s.floorPlans[activeFloor];
        const targetRoom = ALL_POSSIBLE_ROOMS.find(r => !fp.enabledRooms.includes(r));
        if (!targetRoom) return;
        const newItems: PlacedItem[] = roomClipboard.placedItems.map(p => ({ ...p, instanceId: genId() }));
        const updatedRooms = { ...fp.rooms, [targetRoom]: { materials: { ...roomClipboard.materials }, placedItems: newItems } };
        const lastRoom = fp.enabledRooms[fp.enabledRooms.length - 1];
        const lastPos = fp.roomLayout[lastRoom] ?? { x: 0, y: 0 };
        const newLayout = { ...fp.roomLayout, [targetRoom]: { x: lastPos.x + 300, y: lastPos.y } };
        const newDimensions = { ...fp.roomDimensions, [targetRoom]: { width: roomClipboard.width, depth: roomClipboard.depth } };
        // Copy shape (L型/凸字/custom) too if present
        const newShapes = roomClipboard.shape
          ? { ...(fp.roomShapes ?? {}), [targetRoom]: { preset: roomClipboard.shape.preset, points: roomClipboard.shape.points.map(p => [...p] as [number, number]) } }
          : fp.roomShapes;
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = {
          ...fp,
          rooms: updatedRooms,
          enabledRooms: [...fp.enabledRooms, targetRoom],
          roomLayout: newLayout,
          roomDimensions: newDimensions,
          roomShapes: newShapes,
        };
        set(st => ({
          floorPlans,
          activeRoom: targetRoom,
          viewMode: "2d" as const,
          customRoomMeta: { ...st.customRoomMeta, [targetRoom]: { name: roomClipboard.name, icon: roomClipboard.icon } },
          scores: computeScores(roomClipboard.materials, newItems),
        }));
      },

      pasteRoom: (targetRoom) => {
        const s = get();
        const { roomClipboard, activeFloor } = s;
        if (!roomClipboard) return;
        const fp = s.floorPlans[activeFloor];
        const newItems: PlacedItem[] = roomClipboard.placedItems.map(p => ({ ...p, instanceId: genId() }));
        const updatedRoom = { materials: { ...roomClipboard.materials }, placedItems: newItems };
        const newDimensions = { ...fp.roomDimensions, [targetRoom]: { width: roomClipboard.width, depth: roomClipboard.depth } };
        // Carry shape override with paste (clear it if clipboard was rect-shaped)
        const nextShapes = { ...(fp.roomShapes ?? {}) };
        if (roomClipboard.shape) {
          nextShapes[targetRoom] = { preset: roomClipboard.shape.preset, points: roomClipboard.shape.points.map(p => [...p] as [number, number]) };
        } else {
          delete nextShapes[targetRoom];
        }
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = {
          ...fp,
          rooms: { ...fp.rooms, [targetRoom]: updatedRoom },
          roomDimensions: newDimensions,
          roomShapes: nextShapes,
        };
        set(st => ({
          floorPlans,
          furnitureHistory: [...st.furnitureHistory.slice(-29), { room: targetRoom, placedItems: fp.rooms[targetRoom]?.placedItems ?? [] }],
          selectedInstanceIds: [],
          selectedInstanceId: null,
          scores: computeScores(roomClipboard.materials, newItems),
        }));
      },

      addCustomFurniture: (item) => {
        registerFurniture(item);
        set(s => ({ customFurniture: [...s.customFurniture, item] }));
      },

      setExterior: (patch) => set(s => {
        // Clamp exterior floors to 1–3 max (visual exterior cap)
        if (patch.floors !== undefined) patch = { ...patch, floors: Math.max(1, Math.min(4, patch.floors)) };
        const newExterior = { ...s.exterior, ...patch };
        let floorPlans = s.floorPlans;
        const targetFloors = newExterior.floors; // desired regular-floor count

        // ── Sync floorPlans with the new floor count ───────────────────────
        // Always work on the regular-floor slice only (strip any existing rooftop
        // at index s.exterior.floors so it doesn't pollute regular floor slots).
        const oldRegularFloors = s.exterior.floors;
        let regularPlans = floorPlans.slice(0, oldRegularFloors);

        if (patch.floors !== undefined) {
          if (patch.floors > oldRegularFloors) {
            // Grow: add floor plans for new regular floors, inheriting stair from last floor
            const refPlan = regularPlans[regularPlans.length - 1];
            while (regularPlans.length < patch.floors) {
              regularPlans = [...regularPlans, makeDefaultFloorPlan(refPlan)];
            }
          } else if (patch.floors < oldRegularFloors) {
            // Shrink: trim to exactly targetFloors
            regularPlans = regularPlans.slice(0, patch.floors);
          }
        }
        // Ensure we have exactly targetFloors regular plans (inherit stair from last)
        while (regularPlans.length < targetFloors) {
          regularPlans.push(makeDefaultFloorPlan(regularPlans[regularPlans.length - 1]));
        }
        regularPlans = regularPlans.slice(0, targetFloors);

        // ── Rooftop floor plan at index `targetFloors` ────────────────────
        if (newExterior.hasRooftop) {
          // Preserve existing rooftop plan if it was already there, else create new
          const existingRooftop = s.exterior.hasRooftop ? floorPlans[oldRegularFloors] : undefined;
          floorPlans = [...regularPlans, existingRooftop ?? makeRooftopFloorPlan()];
        } else {
          // hasRooftop disabled: only regular floors
          floorPlans = regularPlans;
        }

        // ── Clamp activeFloor so it stays within valid range ──────────────
        const maxFloor = newExterior.hasRooftop ? targetFloors : targetFloors - 1;
        const activeFloor = Math.min(s.activeFloor, Math.max(0, maxFloor));

        return { exterior: newExterior, floorPlans, activeFloor };
      }),

      setOutdoorPosition: (key, pos) => set(s => ({
        exterior: {
          ...s.exterior,
          outdoorPositions: {
            ...(s.exterior.outdoorPositions ?? {}),
            [key]: { ...(s.exterior.outdoorPositions?.[key] ?? {}), ...pos },
          },
        },
      })),

      rotateOutdoor: (key) => set(s => {
        const cur = s.exterior.outdoorPositions?.[key] ?? { x: 0, z: 0 };
        return {
          exterior: {
            ...s.exterior,
            outdoorPositions: {
              ...(s.exterior.outdoorPositions ?? {}),
              [key]: { ...cur, rot: ((cur.rot ?? 0) + 45) % 360 },
            },
          },
        };
      }),

      resetOutdoorPosition: (key) => set(s => {
        const positions = { ...(s.exterior.outdoorPositions ?? {}) };
        delete positions[key];
        return { exterior: { ...s.exterior, outdoorPositions: positions } };
      }),

      // Per-room exterior decor — pinned to the outside face of a
      // specific room's walls. New items spawn centered on the chosen
      // wall (u=0.5, v=0.5).
      selectedExteriorDecorId: null,
      setSelectedExteriorDecor: (instanceId) => set({ selectedExteriorDecorId: instanceId }),
      addRoomExteriorDecor: (room, furnitureId, wall) => set(s => {
        const plan = s.floorPlans[s.activeFloor];
        const roomState = plan.rooms[room];
        if (!roomState) return {};
        const newItem: ExteriorWallDecorItem = {
          instanceId: `ed_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          furnitureId,
          wall,
          u: 0.5,
          v: 0.5,
        };
        const existing = roomState.exteriorDecor ?? [];
        const updatedRoom = { ...roomState, exteriorDecor: [...existing, newItem] };
        const updatedRooms = { ...plan.rooms, [room]: updatedRoom };
        const updatedPlan = { ...plan, rooms: updatedRooms };
        const updatedPlans = s.floorPlans.map((p, i) => i === s.activeFloor ? updatedPlan : p);
        // Push undo snapshot (of state BEFORE the add) so the Undo
        // button in TopBar removes the new decor in one click.
        return {
          floorPlans: updatedPlans,
          selectedExteriorDecorId: newItem.instanceId,
          furnitureHistory: [
            ...s.furnitureHistory.slice(-29),
            { room, placedItems: [...roomState.placedItems], exteriorDecor: [...existing] },
          ],
        };
      }),
      removeRoomExteriorDecor: (room, instanceId) => set(s => {
        const plan = s.floorPlans[s.activeFloor];
        const roomState = plan.rooms[room];
        if (!roomState) return {};
        const existing = roomState.exteriorDecor ?? [];
        const updatedRoom = { ...roomState, exteriorDecor: existing.filter(d => d.instanceId !== instanceId) };
        const updatedRooms = { ...plan.rooms, [room]: updatedRoom };
        const updatedPlan = { ...plan, rooms: updatedRooms };
        const updatedPlans = s.floorPlans.map((p, i) => i === s.activeFloor ? updatedPlan : p);
        return {
          floorPlans: updatedPlans,
          selectedExteriorDecorId: s.selectedExteriorDecorId === instanceId ? null : s.selectedExteriorDecorId,
          furnitureHistory: [
            ...s.furnitureHistory.slice(-29),
            { room, placedItems: [...roomState.placedItems], exteriorDecor: [...existing] },
          ],
        };
      }),
      updateRoomExteriorDecor: (room, instanceId, patch) => set(s => {
        const plan = s.floorPlans[s.activeFloor];
        const roomState = plan.rooms[room];
        if (!roomState) return {};
        const existing = roomState.exteriorDecor ?? [];
        const updatedRoom = {
          ...roomState,
          exteriorDecor: existing.map(d => d.instanceId === instanceId ? { ...d, ...patch } : d),
        };
        const updatedRooms = { ...plan.rooms, [room]: updatedRoom };
        const updatedPlan = { ...plan, rooms: updatedRooms };
        const updatedPlans = s.floorPlans.map((p, i) => i === s.activeFloor ? updatedPlan : p);
        return { floorPlans: updatedPlans };
      }),

      setActiveFloor: (floor) => set(s => {
        let floorPlans = s.floorPlans;
        while (floorPlans.length <= floor) {
          floorPlans = [...floorPlans, makeDefaultFloorPlan()];
        }
        // Auto-switch activeRoom to the best room on the target floor
        const targetRooms = floorPlans[floor]?.enabledRooms ?? [];
        const PREFERRED: RoomType[] = ["living", "master", "bedroom", "kitchen", "dining", "bathroom", "rooftop_lounge"];
        const bestRoom: RoomType =
          (targetRooms.includes(s.activeRoom) ? s.activeRoom : null) ??
          PREFERRED.find(r => targetRooms.includes(r)) ??
          targetRooms[0] ??
          s.activeRoom;
        return { activeFloor: floor, floorPlans, activeRoom: bestRoom };
      }),

      setRoomWindows: (room, windows) => {
        updateFloor(get, set, fp => ({ roomWindows: { ...fp.roomWindows, [room]: windows } }));
      },

      addWindow: (room, win) => {
        updateFloor(get, set, fp => ({ roomWindows: { ...fp.roomWindows, [room]: [...(fp.roomWindows[room] ?? []), win] } }));
      },

      removeWindow: (room, id) => {
        updateFloor(get, set, fp => ({ roomWindows: { ...fp.roomWindows, [room]: (fp.roomWindows[room] ?? []).filter(w => w.id !== id) } }));
      },

      setDoorPos: (room, pos) => {
        updateFloor(get, set, fp => ({ roomDoorPos: { ...fp.roomDoorPos, [room]: pos } }));
      },

      setRoomHasDoor: (room, has) => {
        updateFloor(get, set, fp => ({ roomHasDoor: { ...fp.roomHasDoor, [room]: has } }));
      },

      setDoorWall: (room, wall) => {
        updateFloor(get, set, fp => ({ roomDoorWall: { ...fp.roomDoorWall, [room]: wall } }));
      },

      toggleWallHidden: (room, key) => {
        updateFloor(get, set, fp => {
          const all = fp.roomWallsHidden ?? {};
          const cur = all[room] ?? {};
          const next = { ...cur, [key]: !cur[key] };
          // Drop the inner object entirely when all sides are unset — keeps
          // the persisted JSON small for users who never used the feature.
          const anyTrue = Object.keys(next).some(k => next[k] === true);
          return {
            roomWallsHidden: anyTrue
              ? { ...all, [room]: next }
              : (() => { const c = { ...all }; delete c[room]; return c; })(),
          };
        });
      },

      setDoorEdgeIdx: (room, edgeIdx) => {
        updateFloor(get, set, fp => {
          const next = { ...(fp.roomDoorEdgeIdx ?? {}) };
          if (edgeIdx == null) delete next[room];
          else next[room] = edgeIdx;
          return { roomDoorEdgeIdx: next };
        });
      },

      addYardItem: (item) => {
        updateYardFloor(get, set, fp => {
          const cur = fp.yardPlan?.items ?? [];
          return { yardPlan: { ...(fp.yardPlan ?? { items: [] }), items: [...cur, item] } };
        });
      },
      removeYardItem: (id) => {
        updateYardFloor(get, set, fp => {
          const cur = fp.yardPlan?.items ?? [];
          return { yardPlan: { ...(fp.yardPlan ?? { items: [] }), items: cur.filter(i => i.id !== id) } };
        });
      },
      updateYardItem: (id, patch) => {
        updateYardFloor(get, set, fp => {
          const cur = fp.yardPlan?.items ?? [];
          return {
            yardPlan: {
              ...(fp.yardPlan ?? { items: [] }),
              items: cur.map(i => i.id === id ? { ...i, ...patch } : i),
            },
          };
        });
      },

      addYardPath: (path) => {
        updateYardFloor(get, set, fp => {
          const cur = fp.yardPlan?.paths ?? [];
          return { yardPlan: { ...(fp.yardPlan ?? { items: [] }), paths: [...cur, path] } };
        });
      },
      removeYardPath: (id) => {
        updateYardFloor(get, set, fp => {
          const cur = fp.yardPlan?.paths ?? [];
          return { yardPlan: { ...(fp.yardPlan ?? { items: [] }), paths: cur.filter(p => p.id !== id) } };
        });
      },

      addDoor: (room, door) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomDoors?.[room] ?? [];
          return { roomDoors: { ...(fp.roomDoors ?? {}), [room]: [...cur, door] } };
        });
      },
      removeDoor: (room, id) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomDoors?.[room] ?? [];
          return { roomDoors: { ...(fp.roomDoors ?? {}), [room]: cur.filter(d => d.id !== id) } };
        });
      },
      updateDoor: (room, id, patch) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomDoors?.[room] ?? [];
          // New-style door: found in roomDoors array
          if (cur.some(d => d.id === id)) {
            return { roomDoors: { ...(fp.roomDoors ?? {}), [room]: cur.map(d => d.id === id ? { ...d, ...patch } : d) } };
          }
          // Legacy door: stored in roomDoorPos / roomDoorWall / etc.
          if (id === `${room}-legacy-door`) {
            const out: Partial<typeof fp> = {};
            if (patch.pos  !== undefined) out.roomDoorPos  = { ...(fp.roomDoorPos  ?? {}), [room]: patch.pos };
            if (patch.len  !== undefined) out.roomDoorLen  = { ...(fp.roomDoorLen  ?? {}), [room]: patch.len };
            if (patch.wall !== undefined) out.roomDoorWall = { ...(fp.roomDoorWall ?? {}), [room]: patch.wall };
            return out;
          }
          return {};
        });
      },

      setDoorLen: (room, len) => {
        const v = Math.max(50, Math.min(300, len));
        updateFloor(get, set, fp => ({ roomDoorLen: { ...(fp.roomDoorLen ?? {}), [room]: v } }));
      },

      setDoorH: (room, h) => {
        const v = Math.max(140, Math.min(260, h));
        updateFloor(get, set, fp => ({ roomDoorH: { ...(fp.roomDoorH ?? {}), [room]: v } }));
      },

      setDoorStyle: (room, style) => {
        updateFloor(get, set, fp => ({ roomDoorStyle: { ...(fp.roomDoorStyle ?? {}), [room]: style } }));
      },

      setRoomExteriorStyle: (room, style) => {
        updateFloor(get, set, fp => ({
          roomExteriorStyle: { ...(fp.roomExteriorStyle ?? {}), [room]: style },
        }));
      },

      updateWindow: (room, id, patch) => {
        updateFloor(get, set, fp => ({
          roomWindows: {
            ...fp.roomWindows,
            [room]: (fp.roomWindows[room] ?? []).map(w => w.id === id ? { ...w, ...patch } : w),
          },
        }));
      },

      rotateRoom: (room) => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
        if (!fp?.rooms[room]) return;
        const { width: W, depth: D } = fp.roomDimensions[room];

        // Transform furniture: 90° CW room rotation → new_x = D - old_z, new_z = old_x, rotation += 90
        const newItems = fp.rooms[room].placedItems.map(item => ({
          ...item,
          x: D - item.z,
          z: item.x,
          rotation: (item.rotation + 90) % 360,
        }));

        // Wall remap (90° CW rotation of the room):
        //   N(top) → E(right), E(right) → S(bottom), S(bottom) → W(left), W(left) → N(top)
        const wallCW: Record<WallSide, WallSide> = {
          N: "E", E: "S", S: "W", W: "N",
        };
        const oldDoorWall = fp.roomDoorWall[room] ?? "S";
        const newDoorWall = wallCW[oldDoorWall];
        // Horizontal walls (N/S) span the room's width; vertical walls (W/E) span depth.
        const oldDoorWallLen = (oldDoorWall === "N" || oldDoorWall === "S") ? W : D;
        const newDoorWallLen = (newDoorWall === "N" || newDoorWall === "S") ? D : W;
        const newDoorPos = (fp.roomDoorPos[room] ?? 0) * (newDoorWallLen / oldDoorWallLen);

        const newWindows = (fp.roomWindows[room] ?? []).map(win => {
          const newWall = wallCW[win.wall] ?? win.wall;
          const oldLen = (win.wall === "N" || win.wall === "S") ? W : D;
          const newLen = (newWall === "N" || newWall === "S") ? D : W;
          const scale = newLen / oldLen;
          return { ...win, wall: newWall, pos: win.pos * scale, len: win.len * scale };
        });

        const floorPlans = [...s.floorPlans];
        floorPlans[s.activeFloor] = {
          ...fp,
          roomDimensions: { ...fp.roomDimensions, [room]: { width: D, depth: W } },
          rooms: { ...fp.rooms, [room]: { ...fp.rooms[room], placedItems: newItems } },
          roomDoorWall: { ...fp.roomDoorWall, [room]: newDoorWall },
          roomDoorPos:  { ...fp.roomDoorPos,  [room]: newDoorPos },
          roomWindows:  { ...fp.roomWindows,  [room]: newWindows },
        };
        set({ floorPlans });
      },

      pushLayoutHistory: () =>
        set(s => {
          const fp = s.floorPlans[s.activeFloor];
          // Deep-copy roomShapes so vertex edits can be undone
          const roomShapesSnap = fp.roomShapes
            ? Object.fromEntries(
                Object.entries(fp.roomShapes).map(([k, v]) => [
                  k,
                  { preset: v.preset, points: v.points.map(p => [...p] as [number, number]) },
                ]),
              ) as Record<string, import("./roomGeometry").RoomShape>
            : undefined;
          return {
            layoutHistory: [
              ...s.layoutHistory.slice(-19), // keep last 20
              {
                floorIndex:     s.activeFloor,
                roomLayout:     { ...fp.roomLayout },
                roomDimensions: { ...fp.roomDimensions },
                enabledRooms:   [...fp.enabledRooms],
                roomShapes:     roomShapesSnap,
              },
            ],
          };
        }),

      undoLayout: () =>
        set(s => {
          if (s.layoutHistory.length === 0) return {};
          const prev = s.layoutHistory[s.layoutHistory.length - 1];
          const floorPlans = [...s.floorPlans];
          const fp = floorPlans[prev.floorIndex] ?? makeDefaultFloorPlan();
          floorPlans[prev.floorIndex] = {
            ...fp,
            roomLayout:     prev.roomLayout,
            roomDimensions: prev.roomDimensions,
            enabledRooms:   prev.enabledRooms,
            // Restore roomShapes snapshot (undefined = clear custom shapes)
            roomShapes:     prev.roomShapes ?? {},
          };
          return {
            floorPlans,
            layoutHistory: s.layoutHistory.slice(0, -1),
          };
        }),

      resetAll: () => set({
        floorPlans: [makeDefaultFloorPlan()],
        activeRoom: "living",
        selectedInstanceId: null,
        selectedInstanceIds: [],
        furnitureHistory: [],
        clipboard: [],
        roomClipboard: null,
        budget: 150000,
        scores: { style: 0, space: 0, light: 0, dominantStyle: "" },
        customRoomMeta: {},
        customFurniture: [],
        exterior: { ...initialExterior },
        activeFloor: 0,
        layoutHistory: [],
        activeTemplateId: null,
        // 清 ephemeral 交互状态：门窗开合、灯光 / 家具开关、亮度 / 色温、
        // 窗帘开合、灯位置、墙/顶透明度、图纸描图 —— 不清会残留上一次
        // 的用户偏好，让"重置到初始状态"名不副实。
        doorOpenByRoom: {},
        windowOpenByWinId: {},
        curtainOpenByInstanceId: {},
        lightsOnByRoom: {},
        lightBrightnessByRoom: {},
        lightColorByRoom: {},
        roomExposureByRoom: {},
        lightPosByRoom: {},
        fixtureOffById: {},
        southWallOpacity: 0,
        ceilingOpacity: 0,
        blueprint: { image: null, naturalW: 0, naturalH: 0, opacity: 0.4, offsetX: 0, offsetY: 0, scale: 1 },
      }),

      wipeAll: () => {
        // 先跑 resetAll，再把所有 floorPlan 的 enabledRooms 清空 +
        // roomShapes 清掉，只剩一张白纸
        get().resetAll();
        const empty = makeDefaultFloorPlan();
        empty.enabledRooms = [];
        empty.roomShapes = {};
        set({ floorPlans: [empty] });
      },

      loadFromShare: (snapshot) => {
        // Re-register custom furniture into the runtime FURNITURE map BEFORE
        // we set placedItems — otherwise placeFurniture lookups for those
        // ids will return undefined while React renders.
        const customFurniture = snapshot.customFurniture ?? [];
        customFurniture.forEach(item => registerFurniture(item));

        const defaultBlueprint = { image: null, naturalW: 0, naturalH: 0, opacity: 0.4, offsetX: 0, offsetY: 0, scale: 1 };
        const defaultScores    = { style: 0, space: 0, light: 0, dominantStyle: "" };

        const fp = makeDefaultFloorPlan();
        if (snapshot.floorPlans && Array.isArray(snapshot.floorPlans)) {
          // New format: floorPlans array
          const floorPlans = (snapshot.floorPlans as FloorPlan[]).map(sfp => {
            const merged = makeDefaultFloorPlan();
            merged.enabledRooms = sfp.enabledRooms ?? merged.enabledRooms;
            merged.roomLayout = { ...merged.roomLayout, ...(sfp.roomLayout ?? {}) };
            merged.roomDimensions = { ...merged.roomDimensions, ...(sfp.roomDimensions ?? {}) };
            for (const [room, rs] of Object.entries(sfp.rooms ?? {})) {
              if (rs) merged.rooms[room as RoomType] = rs as RoomState;
            }
            return merged;
          });
          set({
            floorPlans,
            budget: snapshot.budget,
            exterior: { ...initialExterior, ...(snapshot.exterior as Partial<typeof initialExterior>) },
            customRoomMeta: snapshot.customRoomMeta ?? {},
            customFurniture,
            blueprint: { ...defaultBlueprint, ...(snapshot.blueprint ?? {}) },
            activeRoom: floorPlans[0]?.enabledRooms[0] ?? "living",
            selectedInstanceId: null,
            selectedInstanceIds: [],
            furnitureHistory: [],
            clipboard: [],
            roomClipboard: null,
            scores: snapshot.scores ?? defaultScores,
            layoutHistory: [],
            activeFloor: 0,
          });
        } else {
          // Legacy format: flat rooms + enabledRooms (floor 0 only)
          for (const [room, rs] of Object.entries(snapshot.rooms ?? {})) {
            if (rs) fp.rooms[room as RoomType] = rs as RoomState;
          }
          fp.enabledRooms = snapshot.enabledRooms ?? [...DEFAULT_ENABLED];
          fp.roomDimensions = { ...DEFAULT_ROOM_DIMENSIONS, ...(snapshot.roomDimensions ?? {}) };
          set({
            floorPlans: [fp],
            budget: snapshot.budget,
            exterior: { ...initialExterior, ...(snapshot.exterior as Partial<typeof initialExterior>) },
            customRoomMeta: snapshot.customRoomMeta ?? {},
            customFurniture,
            blueprint: { ...defaultBlueprint, ...(snapshot.blueprint ?? {}) },
            activeRoom: (snapshot.enabledRooms?.[0]) ?? "living",
            selectedInstanceId: null,
            selectedInstanceIds: [],
            furnitureHistory: [],
            clipboard: [],
            roomClipboard: null,
            scores: snapshot.scores ?? defaultScores,
            layoutHistory: [],
            activeFloor: 0,
          });
        }
      },

      loadTemplate: (templateId) => {
        const template = ALL_TEMPLATES.find(t => t.id === templateId);
        if (!template) return;
        const s = get();
        const { activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        // 彻底清空后 enabledRooms 为空，风格模板本来没东西可套。
        // 这里自举：把模板定义过的所有房间启用（使用默认尺寸 / 布局），
        // 这样风格模板也能在"白纸"状态下一键重建整屋。
        const templateRoomIds = Object.keys(template.rooms) as RoomType[];
        let enabledRooms = fp.enabledRooms;
        let roomDimensions = fp.roomDimensions;
        let roomLayout = fp.roomLayout;
        if (enabledRooms.length === 0 && templateRoomIds.length > 0) {
          enabledRooms = templateRoomIds;
          roomDimensions = { ...DEFAULT_ROOM_DIMENSIONS };
          roomLayout = { ...DEFAULT_ROOM_LAYOUT };
        }
        const updatedRooms = { ...fp.rooms };
        // Template can now also drive windows and door style per room —
        // these live OUTSIDE RoomState (on the floor plan), so we collect
        // patches and apply them alongside the per-room rooms update.
        const windowsPatch: Record<string, import("./types").WindowConfig[]> = {};
        const doorStylePatch: Partial<Record<RoomType, import("./types").DoorStyle>> = {};
        const doorWallPatch: Partial<Record<RoomType, WallSide>> = {};
        const doorPosPatch: Partial<Record<RoomType, number>> = {};
        const doorLenPatch: Partial<Record<RoomType, number>> = {};
        for (const roomId of enabledRooms) {
          const tplRoom = template.rooms[roomId];
          if (!tplRoom) continue;
          const dims = roomDimensions[roomId];
          const embedded = template.embeddedRooms?.[roomId];
          const built = embedded
            ? buildEmbeddedRoomState(roomId, embedded, dims.width, dims.depth)
            : buildTemplateRoomState(roomId, tplRoom, dims.width, dims.depth);
          const { materials, placedItems } = built;
          // Optional fields only present on embedded rooms
          const windows = (built as { windows?: import("./types").WindowConfig[] }).windows ?? [];
          const doorStyle = (built as { doorStyle?: import("./types").DoorStyle }).doorStyle;
          const doorWall = (built as { doorWall?: WallSide }).doorWall;
          const doorPos = (built as { doorPos?: number }).doorPos;
          const doorLen = (built as { doorLen?: number }).doorLen;
          const exteriorDecor = (built as { exteriorDecor?: import("./types").ExteriorWallDecorItem[] }).exteriorDecor ?? [];
          const connections = (built as { connections?: import("./types").RoutingConnection[] }).connections ?? [];
          updatedRooms[roomId] = {
            materials: materials as never,
            placedItems: placedItems as never,
            ...(exteriorDecor.length > 0 ? { exteriorDecor } : {}),
            ...(connections.length > 0 ? { connections } : {}),
          };
          if (windows.length > 0) windowsPatch[roomId] = windows;
          if (doorStyle) doorStylePatch[roomId] = doorStyle;
          if (doorWall) doorWallPatch[roomId] = doorWall;
          if (doorPos !== undefined) doorPosPatch[roomId] = doorPos;
          if (doorLen !== undefined) doorLenPatch[roomId] = doorLen;
        }
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = {
          ...fp,
          enabledRooms,          // 自举启用的房间会写回来
          roomLayout,
          roomDimensions,
          rooms: updatedRooms,
          roomWindows: { ...fp.roomWindows, ...windowsPatch },
          roomDoorStyle: { ...(fp.roomDoorStyle ?? {}), ...doorStylePatch },
          roomDoorWall: { ...fp.roomDoorWall, ...doorWallPatch },
          roomDoorPos:  { ...fp.roomDoorPos,  ...doorPosPatch },
          roomDoorLen:  { ...(fp.roomDoorLen ?? {}), ...doorLenPatch },
        };
        const firstTemplatedRoom = enabledRooms.find(r => template.rooms[r]) ?? s.activeRoom;
        const { materials, placedItems } = updatedRooms[firstTemplatedRoom];
        const computed = computeScores(materials as never, placedItems as never);
        // Strip `floors` from the style template's exterior patch — floors
        // is a project-level concept (set by applyProjectTemplate /
        // setExterior), and style templates declaring their own preferred
        // floor count would silently overwrite it. Symptom: "豪华三层"
        // project template applied 3 floors → loadTemplate("modern-villa")
        // ran per floor → modern-villa.exterior.floors=2 leaked back into
        // state → user saw 2 floors instead of 3.
        const exteriorPatch = template.exterior
          ? (() => {
              const { floors: _ignoreFloors, ...rest } = template.exterior;
              void _ignoreFloors;
              return Object.keys(rest).length > 0
                ? { exterior: { ...s.exterior, ...rest } }
                : {};
            })()
          : {};
        set({
          floorPlans,
          activeRoom: firstTemplatedRoom,
          activeTemplateId: templateId,
          selectedInstanceId: null,
          selectedInstanceIds: [],
          furnitureHistory: [],
          scores: { ...computed, dominantStyle: template.styleTag },
          ...exteriorPatch,
        });
      },

      currentRoom: () => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
        return fp?.rooms[s.activeRoom];
      },

      totalCost: () => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
        const room = fp?.rooms[s.activeRoom];
        if (!room) return 0;
        const { materials, placedItems } = room;
        const area = getRoomArea(s.activeRoom);
        let total = 0;

        if (materials.wall) total += materials.wall.price * area.wall;
        if (materials.floor) total += materials.floor.price * area.floor;
        if (materials.ceiling) total += materials.ceiling.price * area.floor;
        if (materials.tile) total += materials.tile.price * area.floor;
        if (materials.light) {
          total += materials.light.price * (materials.light.id === "light-spot" ? 8 : 1);
        }

        for (const placed of placedItems) {
          const f = getFurnitureById(placed.furnitureId);
          if (f) total += f.price;
        }

        // Routing cost — sum of (manhattan length × per-meter price) for
        // every connection in this room.
        const conns = room.connections ?? [];
        if (conns.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { routingCost } = require("./routingValidation") as typeof import("./routingValidation");
          total += routingCost(placedItems, conns);
        }

        return total;
      },

      isOverBudget: () => {
        const { totalCost, budget } = get();
        return totalCost() > budget;
      },
    }),
    {
      name: "home-designer-v2",
      // Bump this every time templates gain a new field that LoadTemplate
      // writes into FloorPlan or RoomState. Without a version bump, users
      // with persisted state from before the schema change get stuck
      // showing stale (often default) values for the new field because
      // LoadTemplate's patches merge INTO the old persisted data — old
      // missing keys stay missing, new defaults never kick in.
      //
      // History:
      //   v0 = legacy (pre-versioning)
      //   v1 = templates now drive roomDoorPos/Len/Wall/Style,
      //        roomWindows, and RoomState.exteriorDecor
      //   v2 = wall-side strings unified to NSWE. Old saves carried
      //        "back"/"front"/"left"/"right" (room data) and
      //        "top"/"bottom"/"left"/"right" (SVG door-wall). The migrate
      //        function below rewrites all of them to N/S/W/E. CRITICAL:
      //        without this, every existing user's saved house breaks.
      //   v3 = facade-zone keys on ExteriorSettings (faceMaterials,
      //        faceMaterialTypes, faceZones, facades) unified to NSWE.
      //        Old saves stored them as "front"/"back"/"left"/"right"
      //        sub-records; the v2 → v3 branch rewrites the keys.
      //   v4 = yard-only-from-yardPlan: hardcoded "luxury villa" yard
      //        items (pool, driveway, perimeter fence + gate, granite
      //        path, bollard lamps, perimeter trees, lawn fill, etc.)
      //        in FloorPlanExterior have been deleted. Yard is now
      //        sourced exclusively from `yardPlan.items`. Migration is
      //        a no-op (no seeding) — see v3 → v4 branch.
      version: 6,
      migrate: (persistedState, persistedVersion) => {
        const state = persistedState as Partial<DesignerStore> | undefined;
        if (!state) return state as unknown as DesignerStore;
        if (persistedVersion < 1 && state.floorPlans) {
          // v0 → v1: wipe door/window/exterior-decor fields on every
          // floor so the next loadTemplate call writes clean values.
          // Preserve the rest (placedItems, materials, budget, exterior
          // style) so user customization outside these fields survives.
          state.floorPlans = state.floorPlans.map((fp) => ({
            ...fp,
            roomDoorPos:   { ...DEFAULT_ROOM_DOOR_POS },
            roomDoorWall:  { ...DEFAULT_ROOM_DOOR_WALL },
            roomDoorLen:   {},
            roomDoorStyle: {},
            roomWindows:   { ...DEFAULT_ROOM_WINDOWS },
            rooms: Object.fromEntries(
              Object.entries(fp.rooms).map(([roomId, room]) => [
                roomId,
                { ...(room as RoomState), exteriorDecor: [] },
              ])
            ) as unknown as typeof fp.rooms,
          }));
          console.info("[home-designer] migrated persist v0 → v1 (cleared door/window/decor fields)");
        }
        if (persistedVersion < 2 && state.floorPlans) {
          // v1 → v2: rewrite every wall-side literal to NSWE form.
          //   "back"   → "N"   (also  "top"    in SVG door-wall storage)
          //   "front"  → "S"   (also  "bottom" in SVG door-wall storage)
          //   "left"   → "W"
          //   "right"  → "E"
          const roomData = (w: unknown): WallSide | undefined => {
            switch (w) {
              case "back": case "top":     return "N";
              case "front": case "bottom": return "S";
              case "left":                 return "W";
              case "right":                return "E";
              case "N": case "S": case "W": case "E": return w;
              default: return undefined;
            }
          };
          state.floorPlans = state.floorPlans.map((fp) => {
            const out = { ...fp } as FloorPlan;
            // roomDoorWall (was "bottom"/"top"/"left"/"right")
            if (fp.roomDoorWall) {
              out.roomDoorWall = Object.fromEntries(
                Object.entries(fp.roomDoorWall).map(([k, v]) => [k, roomData(v) ?? "S"]),
              ) as FloorPlan["roomDoorWall"];
            }
            // roomDoors[]
            if (fp.roomDoors) {
              out.roomDoors = Object.fromEntries(
                Object.entries(fp.roomDoors).map(([rk, doors]) => [
                  rk,
                  (doors ?? []).map(d => ({ ...d, wall: roomData(d.wall) ?? d.wall })),
                ]),
              ) as FloorPlan["roomDoors"];
            }
            // roomWindows[]
            if (fp.roomWindows) {
              out.roomWindows = Object.fromEntries(
                Object.entries(fp.roomWindows).map(([rk, wins]) => [
                  rk,
                  (wins ?? []).map(w => ({ ...w, wall: roomData(w.wall) ?? w.wall })),
                ]),
              ) as FloorPlan["roomWindows"];
            }
            // roomWallsHidden — inner key is either a cardinal wall name
            // OR "edge-${i}". Only rewrite cardinal-style keys.
            if (fp.roomWallsHidden) {
              out.roomWallsHidden = Object.fromEntries(
                Object.entries(fp.roomWallsHidden).map(([rk, inner]) => {
                  if (!inner) return [rk, inner];
                  const remapped: Record<string, boolean | undefined> = {};
                  for (const [key, val] of Object.entries(inner)) {
                    const ns = roomData(key);
                    remapped[ns ?? key] = val;
                  }
                  return [rk, remapped];
                }),
              ) as FloorPlan["roomWallsHidden"];
            }
            // exteriorDecor inside each room
            if (fp.rooms) {
              out.rooms = Object.fromEntries(
                Object.entries(fp.rooms).map(([rk, room]) => {
                  const r = room as RoomState;
                  if (!r?.exteriorDecor || r.exteriorDecor.length === 0) return [rk, r];
                  return [rk, {
                    ...r,
                    exteriorDecor: r.exteriorDecor.map(d => ({
                      ...d,
                      wall: (roomData(d.wall) ?? d.wall) as ExteriorWall,
                    })),
                  }];
                }),
              ) as FloorPlan["rooms"];
            }
            return out;
          });
          console.info("[home-designer] migrated persist v1 → v2 (wall sides → NSWE)");
        }
        if (persistedVersion < 3 && state.exterior) {
          // v2 → v3: rewrite facade-zone keys on ExteriorSettings from
          // front/back/left/right to NSWE (S/N/W/E). Same mapping as the
          // v1 → v2 wall-side migration above. Inline switch — do NOT
          // extract into a shared helper (keeps the migration self-
          // contained for review).
          const faceKey = (k: unknown): WallSide | undefined => {
            switch (k) {
              case "back":  return "N";
              case "front": return "S";
              case "left":  return "W";
              case "right": return "E";
              case "N": case "S": case "W": case "E": return k;
              default: return undefined;
            }
          };
          const remap = <V,>(rec: Record<string, V> | undefined): Partial<Record<WallSide, V>> | undefined => {
            if (!rec) return rec;
            const out: Partial<Record<WallSide, V>> = {};
            for (const [k, v] of Object.entries(rec)) {
              const ns = faceKey(k);
              if (ns !== undefined) out[ns] = v;
            }
            return out;
          };
          const ext = { ...state.exterior } as ExteriorSettings & Record<string, unknown>;
          if (ext.faceMaterials)      ext.faceMaterials      = remap(ext.faceMaterials as Record<string, string>);
          if (ext.faceMaterialTypes)  ext.faceMaterialTypes  = remap(ext.faceMaterialTypes as Record<string, ExteriorSettings["wallMaterial"]>);
          if (ext.faceZones)          ext.faceZones          = remap(ext.faceZones as Record<string, NonNullable<ExteriorSettings["faceZones"]>[WallSide]>);
          if (ext.facades)            ext.facades            = remap(ext.facades as Record<string, NonNullable<ExteriorSettings["facades"]>[WallSide]>);
          state.exterior = ext;
          console.info("[home-designer] migrated persist v2 → v3 (facade zones → NSWE)");
        }
        if (persistedVersion < 4) {
          // v3 → v4: Yard items now live ONLY in `yardPlan.items` —
          // FloorPlanExterior no longer auto-places hardcoded landscape
          // (pool, driveway, perimeter fence, lawn, lamps, granite path,
          // perimeter trees, etc.). New projects start from templates that
          // already populate yardPlan.items.
          //
          // We intentionally DO NOT seed defaults into existing saves:
          // a user with deliberately empty yardPlan.items would have
          // those defaults clobbered. The trade-off is an empty yard for
          // migrated saves; users can add prefabs via the YardPlan editor.
          console.info("[home-designer] migrated persist v3 → v4 (yard items now sourced from yardPlan.items only)");
        }
        if (persistedVersion < 5) {
          // v4 → v5: 楼梯不再是 stairConfig 特判，改成普通家具。给已启用
          // 楼梯间、却没有楼梯家具的存档注入一把默认直梯，并丢弃旧的
          // stairConfig 字段。各视图统一用 PlacedItemMesh → StaircaseMesh。
          const STAIR_IDS = ["staircase-straight", "staircase-l-shaped", "staircase-spiral"];
          const st = state as { floorPlans?: FloorPlan[] };
          if (Array.isArray(st.floorPlans)) {
            st.floorPlans.forEach(fp => {
              delete (fp as { stairConfig?: unknown }).stairConfig;
              if (!fp.enabledRooms?.includes("stair")) return;
              const stairRoom = fp.rooms?.stair;
              const items = stairRoom?.placedItems ?? [];
              const hasStair = items.some(p => STAIR_IDS.includes(p.furnitureId));
              if (!hasStair) {
                fp.rooms = {
                  ...fp.rooms,
                  stair: {
                    materials: stairRoom?.materials ?? {},
                    placedItems: [...items, ...defaultStairItems()],
                  },
                } as FloorPlan["rooms"];
              }
            });
          }
          console.info("[home-designer] migrated persist v4 → v5 (stair → ordinary furniture)");
        }
        if (persistedVersion < 6) {
          // v5 → v6: 天台「房间外壳」（遮阳棚/泳池/花园/吧台）不再在视图里
          // 按房间类型写死，全部改成普通 placedItems。给已启用却没有对应
          // 外壳家具的天台房间补默认布局，遮阳棚补进休闲区。
          const seeders: Record<string, () => PlacedItem[]> = {
            rooftop_lounge: () => [{ instanceId: genId(), furnitureId: "pergola", x: 250, z: 200, rotation: 0 }],
            rooftop_pool:   defaultRooftopPoolItems,
            rooftop_garden: defaultRooftopGardenItems,
            rooftop_bar:    defaultRooftopBarItems,
          };
          const shellIds: Record<string, string[]> = {
            rooftop_lounge: ["pergola"],
            rooftop_pool:   ["reflecting-pool"],
            rooftop_garden: ["green-roof-patch"],
            rooftop_bar:    ["sky-bar"],
          };
          const st = state as { floorPlans?: FloorPlan[] };
          if (Array.isArray(st.floorPlans)) {
            st.floorPlans.forEach(fp => {
              for (const rt of Object.keys(seeders)) {
                if (!fp.enabledRooms?.includes(rt as RoomType)) continue;
                const room = fp.rooms?.[rt as RoomType];
                const items = room?.placedItems ?? [];
                const hasShell = items.some(p => shellIds[rt].includes(p.furnitureId));
                if (hasShell) continue;
                fp.rooms = {
                  ...fp.rooms,
                  [rt]: {
                    materials: room?.materials ?? {},
                    placedItems: [...items, ...seeders[rt]()],
                  },
                } as FloorPlan["rooms"];
              }
            });
          }
          console.info("[home-designer] migrated persist v5 → v6 (rooftop shells → ordinary furniture)");
        }
        return state as unknown as DesignerStore;
      },
      partialize: (state) => ({
        floorPlans: state.floorPlans,
        activeRoom: state.activeRoom,
        activeFloor: state.activeFloor,
        budget: state.budget,
        scores: state.scores,
        customRoomMeta: state.customRoomMeta,
        customFurniture: state.customFurniture,
        exterior: state.exterior,
        blueprint: state.blueprint,
      }),
      onRehydrateStorage: () => (state) => {
        // Re-register any custom furniture after hydration
        if (state?.customFurniture) {
          state.customFurniture.forEach(item => registerFurniture(item));
        }
        // Back-fill any room types added after a floor plan was first
        // persisted (e.g. "stair" added in a later release). Without this,
        // rooms[r] is undefined and any access crashes at runtime.
        if (state?.floorPlans) {
          state.floorPlans = state.floorPlans.map(fp => {
            const rooms = { ...fp.rooms };
            for (const r of ALL_ROOM_TYPES) {
              if (!rooms[r]) rooms[r] = emptyRoom();
            }
            const roomLayout     = { ...fp.roomLayout };
            const roomDimensions = { ...fp.roomDimensions };
            const roomWindows    = { ...fp.roomWindows };
            const roomDoorPos    = { ...fp.roomDoorPos };
            const roomHasDoor    = { ...fp.roomHasDoor };
            const roomDoorWall   = { ...fp.roomDoorWall };
            for (const r of ALL_ROOM_TYPES) {
              if (!roomLayout[r])     roomLayout[r]     = DEFAULT_ROOM_LAYOUT[r]     ?? { x: 0, y: 0 };
              if (!roomDimensions[r]) roomDimensions[r] = DEFAULT_ROOM_DIMENSIONS[r] ?? { width: 300, depth: 260 };
              if (!roomWindows[r])    roomWindows[r]    = makeDefaultWindows(r);
              if (roomDoorPos[r]    === undefined) roomDoorPos[r]  = DEFAULT_ROOM_DOOR_POS[r]  ?? 50;
              if (roomHasDoor[r]    === undefined) roomHasDoor[r]  = DEFAULT_ROOM_HAS_DOOR[r]  ?? true;
              if (!roomDoorWall[r]) roomDoorWall[r]   = DEFAULT_ROOM_DOOR_WALL[r] ?? "S";
            }
            return { ...fp, rooms, roomLayout, roomDimensions, roomWindows, roomDoorPos, roomHasDoor, roomDoorWall };
          });
        }
      },
    }
  ),
  {
    // Only track design-relevant state in temporal history.
    // UI-only state (viewMode, activeRoom, selections, ephemeral toggles)
    // is deliberately excluded so undo/redo only affects design mutations.
    limit: 50,
    partialize: (state) => ({
      floorPlans: state.floorPlans,
      exterior: state.exterior,
      budget: state.budget,
    }),
  }
  )
);

// ─── Temporal store hook (zundo) ──────────────────────────
// Provides undo/redo over design-related state (floorPlans, exterior, budget).
// Usage: const { undo, redo, pastStates, futureStates } = useTemporalStore(s => s);
type DesignSnapshot = { floorPlans: FloorPlan[]; exterior: ExteriorSettings; budget: number };
export const useTemporalStore = <T>(
  selector: (state: TemporalState<DesignSnapshot>) => T
): T => useStore(useDesignerStore.temporal, selector);

// ─── Exports for convenience ───────────────────────────────
export { MATERIALS, FURNITURE };
export type { RoomType, ViewMode, MaterialItem, PlacedItem, RoomMaterials, FloorPlan };

/** Read all doors for a room, transparently migrating legacy single-door
 *  storage (roomHasDoor + roomDoorWall + roomDoorPos + …) into the new
 *  roomDoors[] schema. UI / 3D / clearance code should use this rather
 *  than touching the legacy fields directly. */
export function getDoorsForRoom(fp: FloorPlan, room: RoomType): import("./types").DoorConfig[] {
  const arr = fp.roomDoors?.[room];
  if (arr && arr.length > 0) return arr;
  // Legacy single door fallback
  const hasDoor = fp.roomHasDoor?.[room];
  if (!hasDoor) return [];
  // roomDoorWall is already NSWE post v1→v2 migration.
  const wall: WallSide = fp.roomDoorWall?.[room] ?? "S";
  return [{
    id: `${room}-legacy-door`,
    wall,
    pos: fp.roomDoorPos?.[room] ?? 0,
    len: fp.roomDoorLen?.[room] ?? 80,
    h:   fp.roomDoorH?.[room]   ?? 200,
    style: fp.roomDoorStyle?.[room],
    edgeIndex: fp.roomDoorEdgeIdx?.[room],
  }];
}

// Install the dev-only console expose. Done at module load so it's
// available before any UI renders. NOP in production.
_dev_expose_store(useDesignerStore);
