import { create } from "zustand";
import { persist } from "zustand/middleware";
import { RoomType, ViewMode, MaterialItem, PlacedItem, RoomMaterials, ROOM_DEFS, StyleTag, getRoomArea, FurnitureItem, ExteriorSettings, WindowConfig, RoomState, FloorPlan, ExteriorWallDecorItem, ExteriorWall, WallSide } from "./types";
import { FURNITURE, getFurnitureById, registerFurniture } from "./furniture";
import { MATERIALS, STYLE_RULES } from "./data";
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
  const wall = def.windowWall as "back" | "right" | "left";
  const wallLen = wall === "back" ? def.width : def.depth;
  return [{ id: genWinId(room), wall, pos: wallLen * 0.25, len: wallLen * 0.45 }];
}

export const DEFAULT_ROOM_WINDOWS: Record<RoomType, WindowConfig[]> =
  Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, makeDefaultWindows(r)])) as Record<RoomType, WindowConfig[]>;

// Default door pos = 10% from left of room width
export const DEFAULT_ROOM_DOOR_POS: Record<RoomType, number> =
  Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, Math.round(ROOM_DEFS[r].width * 0.1)])) as Record<RoomType, number>;

export const DEFAULT_ROOM_HAS_DOOR: Record<RoomType, boolean> =
  Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, true])) as Record<RoomType, boolean>;

export const DEFAULT_ROOM_DOOR_WALL: Record<RoomType, "bottom" | "top" | "left" | "right"> =
  Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, "bottom" as const])) as Record<RoomType, "bottom" | "top" | "left" | "right">;

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
function makeDefaultFloorPlan(): FloorPlan {
  return {
    rooms: Object.fromEntries(ALL_ROOM_TYPES.map(r => [r, emptyRoom()])) as Record<RoomType, RoomState>,
    enabledRooms: [...DEFAULT_ENABLED],
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
  frontWallOpacity: 0 | 0.5 | 1;
  setFrontWallOpacity: (o: 0 | 0.5 | 1) => void;
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
  /** Set a per-side wall override. side="back"|"front"|"left"|"right". */
  setWallSide: (side: "back" | "front" | "left" | "right", material: MaterialItem | undefined) => void;
  /** Set the lower-wall (护墙板/墙裙) material. Pass undefined to clear. */
  setWallLower: (material: MaterialItem | undefined) => void;
  /** Set where upper/lower split happens (cm from floor). Default 110. */
  setWallSplitHeight: (cm: number) => void;
  /** Set exterior-face wall material for the active room. Pass
   *  side="all" for the global default, or a specific side for
   *  independent per-face color. Pass undefined material to clear. */
  setWallExterior: (side: "all" | "back" | "front" | "left" | "right", material: MaterialItem | undefined) => void;

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
  setDoorWall: (room: RoomType, wall: "bottom" | "top" | "left" | "right") => void;
  setDoorLen: (room: RoomType, len: number) => void;
  setDoorH:   (room: RoomType, h: number) => void;
  setDoorStyle: (room: RoomType, style: import("./types").DoorStyle) => void;
  updateWindow: (room: RoomType, id: string, patch: Partial<WindowConfig>) => void;

  // Room rotation (swaps width/depth in layout)
  rotateRoom: (room: RoomType) => void;

  // Layout undo history (not persisted, ephemeral)
  layoutHistory: Array<{
    floorIndex: number;
    roomLayout: Record<RoomType, { x: number; y: number }>;
    roomDimensions: Record<RoomType, { width: number; depth: number }>;
    enabledRooms: RoomType[];
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

  // Derived
  currentRoom: () => RoomState;
  totalCost: () => number;
  isOverBudget: () => boolean;

  // Camera-move-and-capture (ephemeral — registered by RoomCanvas, called by AiRenderModal)
  cameraAndCapture: ((pos: [number, number, number], lookAt: [number, number, number]) => string) | null;
  setCameraAndCapture: (fn: DesignerStore["cameraAndCapture"]) => void;
}

const initialExterior: ExteriorSettings = {
  preset: "modern",
  roofStyle: "flat",
  roofColor: "#3A3A3A",
  wallMaterial: "render",
  wallColor: "#F2EEE6",
  accentColor: "#2A2A2A",
  floors: 1,
  yardPreset: "garden",
};

export const useDesignerStore = create<DesignerStore>()(
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
      frontWallOpacity: 0,
      setFrontWallOpacity: (o) => set({ frontWallOpacity: o }),
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

      setActiveRoom: (room) => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
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
        const key = side === "back" ? "wallBack" : side === "front" ? "wallFront" : side === "left" ? "wallLeft" : "wallRight";
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
        const updatedMaterials = { ...fp.rooms[activeRoom].materials };
        const fieldMap = {
          all:   "wallExterior",
          back:  "wallBackExterior",
          front: "wallFrontExterior",
          left:  "wallLeftExterior",
          right: "wallRightExterior",
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
            { id: "plant-monstera",    pos: (w, d) => ({ x: w - 40,       z: 40 }) },
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
          const { buildShape } = require("./roomGeometry") as typeof import("./roomGeometry");
          const nextShapes = { ...(fp.roomShapes ?? {}) };
          if (preset === "rect") {
            delete nextShapes[room];                       // clear override
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
          const nextPts = cur.points.map((p, i) => (i === idx ? [x, z] : p)) as Array<[number, number]>;
          return {
            roomShapes: { ...fp.roomShapes, [room]: { preset: "custom", points: nextPts } },
          };
        });
      },

      deleteRoomShapePoint: (room: RoomType, idx: number) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomShapes?.[room];
          if (!cur || cur.points.length <= 3) return {};   // keep ≥3
          const nextPts = cur.points.filter((_, i) => i !== idx);
          return {
            roomShapes: { ...fp.roomShapes, [room]: { preset: "custom", points: nextPts } },
          };
        });
      },

      toggleRoom: (room) => {
        updateFloor(get, set, fp => ({
          enabledRooms: fp.enabledRooms.includes(room)
            ? fp.enabledRooms.filter(r => r !== room)
            : [...fp.enabledRooms, room],
        }));
      },

      addRoom: (room) => {
        updateFloor(get, set, fp => ({
          enabledRooms: fp.enabledRooms.includes(room) ? fp.enabledRooms : [...fp.enabledRooms, room],
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
          return {
            enabledRooms: enabled,
            roomLayout: layoutMap,
            roomDimensions: dimsMap,
            roomShapes: shapesMap,
          };
        });
      },

      copyRoom: (room) => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
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
          furnitureHistory: [...st.furnitureHistory.slice(-29), { room: targetRoom, placedItems: fp.rooms[targetRoom].placedItems }],
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
        const newExterior = { ...s.exterior, ...patch };
        let floorPlans = s.floorPlans;
        if (patch.floors !== undefined && patch.floors > floorPlans.length) {
          while (floorPlans.length < patch.floors) {
            floorPlans = [...floorPlans, makeDefaultFloorPlan()];
          }
        }
        return { exterior: newExterior, floorPlans };
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
        return { activeFloor: floor, floorPlans };
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
        const { width: W, depth: D } = fp.roomDimensions[room];

        // Transform furniture: 90° CW room rotation → new_x = D - old_z, new_z = old_x, rotation += 90
        const newItems = fp.rooms[room].placedItems.map(item => ({
          ...item,
          x: D - item.z,
          z: item.x,
          rotation: (item.rotation + 90) % 360,
        }));

        // Door wall remap (90° CW): bottom→left, left→top, top→right, right→bottom
        const doorWallCW: Record<string, "bottom"|"top"|"left"|"right"> = {
          bottom: "left", left: "top", top: "right", right: "bottom",
        };
        const oldDoorWall = fp.roomDoorWall[room] ?? "bottom";
        const newDoorWall = doorWallCW[oldDoorWall];
        const oldDoorWallLen = (oldDoorWall === "bottom" || oldDoorWall === "top") ? W : D;
        const newDoorWallLen = (newDoorWall === "bottom" || newDoorWall === "top") ? D : W;
        const newDoorPos = (fp.roomDoorPos[room] ?? 0) * (newDoorWallLen / oldDoorWallLen);

        // Window wall remap (90° CW): back→right, right→front, front→left, left→back
        const winWallCW: Record<string, "back"|"front"|"right"|"left"> = {
          back: "right", right: "front", front: "left", left: "back",
        };
        const newWindows = (fp.roomWindows[room] ?? []).map(win => {
          const newWall = winWallCW[win.wall] ?? win.wall;
          const oldLen = (win.wall === "back" || win.wall === "front") ? W : D;
          const newLen = (newWall === "back" || newWall === "front") ? D : W;
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
          return {
            layoutHistory: [
              ...s.layoutHistory.slice(-19), // keep last 20
              {
                floorIndex:     s.activeFloor,
                roomLayout:     { ...fp.roomLayout },
                roomDimensions: { ...fp.roomDimensions },
                enabledRooms:   [...fp.enabledRooms],
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
        frontWallOpacity: 0,
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
            activeRoom: floorPlans[0]?.enabledRooms[0] ?? "living",
            selectedInstanceId: null,
            selectedInstanceIds: [],
            furnitureHistory: [],
            clipboard: [],
            roomClipboard: null,
            scores: { style: 0, space: 0, light: 0, dominantStyle: "" },
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
            activeRoom: (snapshot.enabledRooms?.[0]) ?? "living",
            selectedInstanceId: null,
            selectedInstanceIds: [],
            furnitureHistory: [],
            clipboard: [],
            roomClipboard: null,
            scores: { style: 0, space: 0, light: 0, dominantStyle: "" },
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
        const { enabledRooms, roomDimensions } = fp;
        const updatedRooms = { ...fp.rooms };
        // Template can now also drive windows and door style per room —
        // these live OUTSIDE RoomState (on the floor plan), so we collect
        // patches and apply them alongside the per-room rooms update.
        const windowsPatch: Record<string, import("./types").WindowConfig[]> = {};
        const doorStylePatch: Partial<Record<RoomType, import("./types").DoorStyle>> = {};
        const doorWallPatch: Partial<Record<RoomType, "bottom" | "top" | "left" | "right">> = {};
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
          const doorWall = (built as { doorWall?: "bottom" | "top" | "left" | "right" }).doorWall;
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
        set({
          floorPlans,
          activeRoom: firstTemplatedRoom,
          activeTemplateId: templateId,
          selectedInstanceId: null,
          selectedInstanceIds: [],
          furnitureHistory: [],
          scores: { ...computed, dominantStyle: template.styleTag },
        });
      },

      currentRoom: () => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
        return fp.rooms[s.activeRoom];
      },

      totalCost: () => {
        const s = get();
        const fp = s.floorPlans[s.activeFloor];
        const room = fp.rooms[s.activeRoom];
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
      version: 1,
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
          // eslint-disable-next-line no-console
          console.info("[home-designer] migrated persist v0 → v1 (cleared door/window/decor fields)");
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
      },
    }
  )
);

// ─── Exports for convenience ───────────────────────────────
export { MATERIALS, FURNITURE };
export type { RoomType, ViewMode, MaterialItem, PlacedItem, RoomMaterials, FloorPlan };
