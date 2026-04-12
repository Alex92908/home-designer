import { create } from "zustand";
import { persist } from "zustand/middleware";
import { RoomType, ViewMode, MaterialItem, PlacedItem, RoomMaterials, ROOM_DEFS, StyleTag, getRoomArea, FurnitureItem, ExteriorSettings, WindowConfig } from "./types";
import { FURNITURE, getFurnitureById, registerFurniture } from "./furniture";
import { MATERIALS, STYLE_RULES } from "./data";

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
export interface RoomState {
  materials: RoomMaterials;
  placedItems: PlacedItem[];
}

function emptyRoom(): RoomState {
  return { materials: {}, placedItems: [] };
}

const ALL_ROOM_TYPES: RoomType[] = ALL_POSSIBLE_ROOMS;

// ─── Store interface ───────────────────────────────────────

interface DesignerStore {
  // State
  rooms: Record<RoomType, RoomState>;
  activeRoom: RoomType;
  viewMode: ViewMode;
  selectedInstanceId: string | null;
  selectedInstanceIds: string[];
  budget: number;
  scores: StyleScore;

  // Furniture undo history (ephemeral, not persisted)
  furnitureHistory: Array<{ room: RoomType; placedItems: PlacedItem[] }>;

  // Clipboard for cross-room copy/paste (ephemeral)
  clipboard: Array<{ furnitureId: string; x: number; z: number; rotation: number; scaleW: number; scaleD: number }>;

  // Room-level clipboard (copy entire room config)
  roomClipboard: { materials: RoomMaterials; placedItems: PlacedItem[]; name: string; icon: string; width: number; depth: number } | null;

  // Room / view actions
  setActiveRoom: (room: RoomType) => void;
  setViewMode: (mode: ViewMode) => void;

  // Material actions
  setMaterial: (material: MaterialItem) => void;
  removeMaterial: (category: keyof RoomMaterials) => void;

  // Furniture placement actions
  placeFurniture: (furnitureId: string) => void;
  moveItem: (instanceId: string, x: number, z: number) => void;
  rotateItem: (instanceId: string) => void;
  removeItem: (instanceId: string) => void;
  selectInstance: (instanceId: string | null) => void;
  setSelection: (ids: string[]) => void;
  duplicateItems: (instanceIds: string[]) => void;
  removeItems: (instanceIds: string[]) => void;
  resizeItem: (instanceId: string, scaleW: number, scaleD: number) => void;

  // Furniture undo
  pushFurnitureHistory: () => void;
  undoFurniture: () => void;

  // Clipboard (cross-room copy/paste)
  copyToClipboard: (instanceIds: string[]) => void;
  pasteFromClipboard: () => void;

  // Budget
  setBudget: (budget: number) => void;

  // Room layout (global floor plan editor)
  roomLayout: Record<RoomType, { x: number; y: number }>;
  roomDimensions: Record<RoomType, { width: number; depth: number }>;
  enabledRooms: RoomType[];
  updateRoomLayout: (room: RoomType, x: number, y: number) => void;
  updateRoomDimension: (room: RoomType, width: number, depth: number) => void;
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

  // Windows per room
  roomWindows: Record<RoomType, WindowConfig[]>;
  setRoomWindows: (room: RoomType, windows: WindowConfig[]) => void;
  addWindow: (room: RoomType, win: WindowConfig) => void;
  removeWindow: (room: RoomType, id: string) => void;

  // Door per room
  roomDoorPos: Record<RoomType, number>;
  roomHasDoor: Record<RoomType, boolean>;
  roomDoorWall: Record<RoomType, "bottom" | "top" | "left" | "right">;
  setDoorPos: (room: RoomType, pos: number) => void;
  setRoomHasDoor: (room: RoomType, has: boolean) => void;
  setDoorWall: (room: RoomType, wall: "bottom" | "top" | "left" | "right") => void;

  // Room rotation (swaps width/depth in layout)
  rotateRoom: (room: RoomType) => void;

  // Layout undo history (not persisted, ephemeral)
  layoutHistory: Array<{
    roomLayout: Record<RoomType, { x: number; y: number }>;
    roomDimensions: Record<RoomType, { width: number; depth: number }>;
    enabledRooms: RoomType[];
  }>;
  pushLayoutHistory: () => void;
  undoLayout: () => void;

  // Persistence
  resetAll: () => void;

  // Derived
  currentRoom: () => RoomState;
  totalCost: () => number;
  isOverBudget: () => boolean;
}

const initialRooms: Record<RoomType, RoomState> = Object.fromEntries(
  ALL_ROOM_TYPES.map(r => [r, emptyRoom()])
) as Record<RoomType, RoomState>;

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
      rooms: initialRooms,
      activeRoom: "living",
      viewMode: "3d",
      selectedInstanceId: null,
      selectedInstanceIds: [],
      budget: 150000,
      furnitureHistory: [],
      clipboard: [],
      roomClipboard: null,
      scores: { style: 0, space: 0, light: 0, dominantStyle: "" },
      roomLayout: { ...DEFAULT_ROOM_LAYOUT },
      roomDimensions: { ...DEFAULT_ROOM_DIMENSIONS },
      enabledRooms: [...DEFAULT_ENABLED],
      customRoomMeta: {},
      customFurniture: [],
      exterior: { ...initialExterior },
      roomWindows: { ...DEFAULT_ROOM_WINDOWS },
      roomDoorPos: { ...DEFAULT_ROOM_DOOR_POS },
      roomHasDoor: { ...DEFAULT_ROOM_HAS_DOOR },
      roomDoorWall: { ...DEFAULT_ROOM_DOOR_WALL },
      layoutHistory: [],

      setActiveRoom: (room) => {
        const { rooms } = get();
        const { materials, placedItems } = rooms[room];
        set({ activeRoom: room, selectedInstanceId: null, selectedInstanceIds: [], scores: computeScores(materials, placedItems) });
      },

      setViewMode: (mode) => set({ viewMode: mode }),

      setMaterial: (material) => {
        const { activeRoom, rooms } = get();
        const updated = {
          ...rooms,
          [activeRoom]: {
            ...rooms[activeRoom],
            materials: { ...rooms[activeRoom].materials, [material.category]: material },
          },
        };
        const { materials, placedItems } = updated[activeRoom];
        set({ rooms: updated, scores: computeScores(materials, placedItems) });
      },

      removeMaterial: (category) => {
        const { activeRoom, rooms } = get();
        const updated = { ...rooms[activeRoom].materials };
        delete updated[category];
        const updatedRooms = { ...rooms, [activeRoom]: { ...rooms[activeRoom], materials: updated } };
        set({ rooms: updatedRooms, scores: computeScores(updated, rooms[activeRoom].placedItems) });
      },

      placeFurniture: (furnitureId) => {
        const { activeRoom, rooms } = get();
        const furniture = getFurnitureById(furnitureId);
        if (!furniture) return;
        // Push history before placing
        set(s => ({ furnitureHistory: [...s.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...rooms[activeRoom].placedItems] }] }));

        const def = ROOM_DEFS[activeRoom];
        const newItem: PlacedItem = {
          instanceId: genId(),
          furnitureId,
          x: def.width / 2,
          z: def.depth / 2,
          rotation: 0,
          scaleW: 1,
          scaleD: 1,
        };

        const updatedPlaced = [...rooms[activeRoom].placedItems, newItem];
        const updatedRooms = { ...rooms, [activeRoom]: { ...rooms[activeRoom], placedItems: updatedPlaced } };
        const { materials } = updatedRooms[activeRoom];
        set({ rooms: updatedRooms, selectedInstanceId: newItem.instanceId, scores: computeScores(materials, updatedPlaced), viewMode: "2d" });
      },

      moveItem: (instanceId, x, z) => {
        const { activeRoom, rooms } = get();
        const updatedPlaced = rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId ? { ...p, x, z } : p
        );
        const updatedRooms = { ...rooms, [activeRoom]: { ...rooms[activeRoom], placedItems: updatedPlaced } };
        set({ rooms: updatedRooms });
      },

      rotateItem: (instanceId) => {
        const { activeRoom, rooms } = get();
        set(s => ({ furnitureHistory: [...s.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...rooms[activeRoom].placedItems] }] }));
        const updatedPlaced = rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId ? { ...p, rotation: (p.rotation + 90) % 360 } : p
        );
        const updatedRooms = { ...rooms, [activeRoom]: { ...rooms[activeRoom], placedItems: updatedPlaced } };
        set({ rooms: updatedRooms });
      },

      removeItem: (instanceId) => {
        const { activeRoom, rooms, selectedInstanceId, selectedInstanceIds } = get();
        set(s => ({ furnitureHistory: [...s.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...rooms[activeRoom].placedItems] }] }));
        const updatedPlaced = rooms[activeRoom].placedItems.filter(p => p.instanceId !== instanceId);
        const updatedRooms = { ...rooms, [activeRoom]: { ...rooms[activeRoom], placedItems: updatedPlaced } };
        const { materials } = updatedRooms[activeRoom];
        const newIds = selectedInstanceIds.filter(id => id !== instanceId);
        set({
          rooms: updatedRooms,
          selectedInstanceId: selectedInstanceId === instanceId ? null : selectedInstanceId,
          selectedInstanceIds: newIds,
          scores: computeScores(materials, updatedPlaced),
        });
      },

      selectInstance: (instanceId) => set({ selectedInstanceId: instanceId, selectedInstanceIds: instanceId ? [instanceId] : [] }),

      setSelection: (ids) => set({ selectedInstanceIds: ids, selectedInstanceId: ids[0] ?? null }),

      duplicateItems: (instanceIds) => {
        const { activeRoom, rooms } = get();
        set(s => ({ furnitureHistory: [...s.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...rooms[activeRoom].placedItems] }] }));
        const placed = rooms[activeRoom].placedItems;
        const copies: PlacedItem[] = instanceIds.flatMap(id => {
          const src = placed.find(p => p.instanceId === id);
          if (!src) return [];
          return [{ ...src, instanceId: genId(), x: src.x + 50, z: src.z + 50 }];
        });
        const updatedPlaced = [...placed, ...copies];
        const updatedRooms = { ...rooms, [activeRoom]: { ...rooms[activeRoom], placedItems: updatedPlaced } };
        const { materials } = updatedRooms[activeRoom];
        const newIds = copies.map(c => c.instanceId);
        set({ rooms: updatedRooms, selectedInstanceIds: newIds, selectedInstanceId: newIds[0] ?? null, scores: computeScores(materials, updatedPlaced) });
      },

      removeItems: (instanceIds) => {
        const { activeRoom, rooms } = get();
        set(s => ({ furnitureHistory: [...s.furnitureHistory.slice(-29), { room: activeRoom, placedItems: [...rooms[activeRoom].placedItems] }] }));
        const updatedPlaced = rooms[activeRoom].placedItems.filter(p => !instanceIds.includes(p.instanceId));
        const updatedRooms = { ...rooms, [activeRoom]: { ...rooms[activeRoom], placedItems: updatedPlaced } };
        const { materials } = updatedRooms[activeRoom];
        set({ rooms: updatedRooms, selectedInstanceIds: [], selectedInstanceId: null, scores: computeScores(materials, updatedPlaced) });
      },

      resizeItem: (instanceId, scaleW, scaleD) => {
        const { activeRoom, rooms } = get();
        const updatedPlaced = rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId
            ? { ...p, scaleW: Math.max(0.3, Math.min(4, scaleW)), scaleD: Math.max(0.3, Math.min(4, scaleD)) }
            : p
        );
        const updatedRooms = { ...rooms, [activeRoom]: { ...rooms[activeRoom], placedItems: updatedPlaced } };
        set({ rooms: updatedRooms });
      },

      pushFurnitureHistory: () => {
        const { activeRoom, rooms } = get();
        set(s => ({
          furnitureHistory: [
            ...s.furnitureHistory.slice(-29),
            { room: activeRoom, placedItems: [...rooms[activeRoom].placedItems] },
          ],
        }));
      },

      undoFurniture: () => {
        const { activeRoom } = get();
        set(s => {
          // Find last entry for this room
          const idx = s.furnitureHistory.map(h => h.room).lastIndexOf(activeRoom);
          if (idx === -1) return {};
          const prev = s.furnitureHistory[idx];
          const updatedRooms = {
            ...s.rooms,
            [activeRoom]: { ...s.rooms[activeRoom], placedItems: prev.placedItems },
          };
          return {
            rooms: updatedRooms,
            furnitureHistory: s.furnitureHistory.filter((_, i) => i !== idx),
            selectedInstanceIds: [],
            selectedInstanceId: null,
            scores: computeScores(updatedRooms[activeRoom].materials, prev.placedItems),
          };
        });
      },

      copyToClipboard: (instanceIds) => {
        const { activeRoom, rooms } = get();
        const items = rooms[activeRoom].placedItems
          .filter(p => instanceIds.includes(p.instanceId))
          .map(p => ({
            furnitureId: p.furnitureId,
            x: p.x, z: p.z,
            rotation: p.rotation,
            scaleW: p.scaleW ?? 1,
            scaleD: p.scaleD ?? 1,
          }));
        set({ clipboard: items });
      },

      pasteFromClipboard: () => {
        const { activeRoom, rooms, clipboard } = get();
        if (clipboard.length === 0) return;
        // Push history before paste
        const prevItems = rooms[activeRoom].placedItems;
        const def = ROOM_DEFS[activeRoom];
        const copies: PlacedItem[] = clipboard.map(c => ({
          instanceId: genId(),
          furnitureId: c.furnitureId,
          x: Math.min(c.x + 50, def.width * 0.9),
          z: Math.min(c.z + 50, def.depth * 0.9),
          rotation: c.rotation,
          scaleW: c.scaleW,
          scaleD: c.scaleD,
        }));
        const updatedPlaced = [...prevItems, ...copies];
        const updatedRooms = { ...rooms, [activeRoom]: { ...rooms[activeRoom], placedItems: updatedPlaced } };
        const newIds = copies.map(c => c.instanceId);
        set(s => ({
          rooms: updatedRooms,
          furnitureHistory: [...s.furnitureHistory.slice(-29), { room: activeRoom, placedItems: prevItems }],
          selectedInstanceIds: newIds,
          selectedInstanceId: newIds[0] ?? null,
          scores: computeScores(updatedRooms[activeRoom].materials, updatedPlaced),
          viewMode: "2d",
        }));
      },

      setBudget: (budget) => set({ budget }),

      updateRoomLayout: (room, x, y) =>
        set(s => ({ roomLayout: { ...s.roomLayout, [room]: { x, y } } })),

      updateRoomDimension: (room, width, depth) =>
        set(s => ({ roomDimensions: { ...s.roomDimensions, [room]: { width, depth } } })),

      toggleRoom: (room) =>
        set(s => ({
          enabledRooms: s.enabledRooms.includes(room)
            ? s.enabledRooms.filter(r => r !== room)
            : [...s.enabledRooms, room],
        })),

      addRoom: (room) =>
        set(s => ({
          enabledRooms: s.enabledRooms.includes(room) ? s.enabledRooms : [...s.enabledRooms, room],
        })),

      removeRoom: (room) =>
        set(s => ({
          enabledRooms: s.enabledRooms.filter(r => r !== room),
          activeRoom: s.activeRoom === room
            ? (s.enabledRooms.find(r => r !== room) ?? "living")
            : s.activeRoom,
        })),

      resetLayout: () =>
        set({ roomLayout: { ...DEFAULT_ROOM_LAYOUT }, roomDimensions: { ...DEFAULT_ROOM_DIMENSIONS }, enabledRooms: [...DEFAULT_ENABLED] }),

      setCustomRoomMeta: (room, name, icon) =>
        set(s => ({ customRoomMeta: { ...s.customRoomMeta, [room]: { name, icon } } })),

      copyRoom: (room) => {
        const { rooms, customRoomMeta, roomDimensions } = get();
        const def = ROOM_DEFS[room];
        const meta = customRoomMeta[room];
        const dim = roomDimensions[room] ?? { width: def.width, depth: def.depth };
        set({ roomClipboard: {
          materials: { ...rooms[room].materials },
          placedItems: [...rooms[room].placedItems],
          name: meta?.name ?? def.name,
          icon: meta?.icon ?? def.icon,
          width: dim.width,
          depth: dim.depth,
        }});
      },

      pasteAsNewRoom: () => {
        const { roomClipboard, enabledRooms, rooms, roomLayout, roomDimensions, customRoomMeta } = get();
        if (!roomClipboard) return;
        const targetRoom = ALL_POSSIBLE_ROOMS.find(r => !enabledRooms.includes(r));
        if (!targetRoom) return;
        const newItems: PlacedItem[] = roomClipboard.placedItems.map(p => ({ ...p, instanceId: genId() }));
        const updatedRooms = { ...rooms, [targetRoom]: { materials: { ...roomClipboard.materials }, placedItems: newItems } };
        const lastRoom = enabledRooms[enabledRooms.length - 1];
        const lastPos = roomLayout[lastRoom] ?? { x: 0, y: 0 };
        const newLayout = { ...roomLayout, [targetRoom]: { x: lastPos.x + 300, y: lastPos.y } };
        const newDimensions = { ...roomDimensions, [targetRoom]: { width: roomClipboard.width, depth: roomClipboard.depth } };
        set(s => ({
          rooms: updatedRooms,
          enabledRooms: [...s.enabledRooms, targetRoom],
          activeRoom: targetRoom,
          viewMode: "2d" as const,
          roomLayout: newLayout,
          roomDimensions: newDimensions,
          customRoomMeta: { ...customRoomMeta, [targetRoom]: { name: roomClipboard.name, icon: roomClipboard.icon } },
          scores: computeScores(roomClipboard.materials, newItems),
        }));
      },

      pasteRoom: (targetRoom) => {
        const { rooms, roomClipboard, roomDimensions } = get();
        if (!roomClipboard) return;
        const newItems: PlacedItem[] = roomClipboard.placedItems.map(p => ({ ...p, instanceId: genId() }));
        const updatedRooms = { ...rooms, [targetRoom]: { materials: { ...roomClipboard.materials }, placedItems: newItems } };
        const newDimensions = { ...roomDimensions, [targetRoom]: { width: roomClipboard.width, depth: roomClipboard.depth } };
        set(s => ({
          rooms: updatedRooms,
          roomDimensions: newDimensions,
          furnitureHistory: [...s.furnitureHistory.slice(-29), { room: targetRoom, placedItems: rooms[targetRoom].placedItems }],
          selectedInstanceIds: [],
          selectedInstanceId: null,
          scores: computeScores(roomClipboard.materials, newItems),
        }));
      },

      addCustomFurniture: (item) => {
        registerFurniture(item);
        set(s => ({ customFurniture: [...s.customFurniture, item] }));
      },

      setExterior: (patch) => set(s => ({ exterior: { ...s.exterior, ...patch } })),

      setRoomWindows: (room, windows) =>
        set(s => ({ roomWindows: { ...s.roomWindows, [room]: windows } })),

      addWindow: (room, win) =>
        set(s => ({ roomWindows: { ...s.roomWindows, [room]: [...(s.roomWindows[room] ?? []), win] } })),

      removeWindow: (room, id) =>
        set(s => ({ roomWindows: { ...s.roomWindows, [room]: (s.roomWindows[room] ?? []).filter(w => w.id !== id) } })),

      setDoorPos: (room, pos) =>
        set(s => ({ roomDoorPos: { ...s.roomDoorPos, [room]: pos } })),

      setRoomHasDoor: (room, has) =>
        set(s => ({ roomHasDoor: { ...s.roomHasDoor, [room]: has } })),

      setDoorWall: (room, wall) =>
        set(s => ({ roomDoorWall: { ...s.roomDoorWall, [room]: wall } })),

      rotateRoom: (room) =>
        set(s => {
          const { width: W, depth: D } = s.roomDimensions[room];

          // Transform furniture: 90° CW room rotation → new_x = D - old_z, new_z = old_x, rotation += 90
          const newItems = s.rooms[room].placedItems.map(item => ({
            ...item,
            x: D - item.z,
            z: item.x,
            rotation: (item.rotation + 90) % 360,
          }));

          // Door wall remap (90° CW): bottom→left, left→top, top→right, right→bottom
          const doorWallCW: Record<string, "bottom"|"top"|"left"|"right"> = {
            bottom: "left", left: "top", top: "right", right: "bottom",
          };
          const oldDoorWall = s.roomDoorWall[room] ?? "bottom";
          const newDoorWall = doorWallCW[oldDoorWall];
          const oldDoorWallLen = (oldDoorWall === "bottom" || oldDoorWall === "top") ? W : D;
          const newDoorWallLen = (newDoorWall === "bottom" || newDoorWall === "top") ? D : W;
          const newDoorPos = (s.roomDoorPos[room] ?? 0) * (newDoorWallLen / oldDoorWallLen);

          // Window wall remap (90° CW): back→right, right→front, front→left, left→back
          const winWallCW: Record<string, "back"|"front"|"right"|"left"> = {
            back: "right", right: "front", front: "left", left: "back",
          };
          const newWindows = (s.roomWindows[room] ?? []).map(win => {
            const newWall = winWallCW[win.wall] ?? win.wall;
            const oldLen = (win.wall === "back" || win.wall === "front") ? W : D;
            const newLen = (newWall === "back" || newWall === "front") ? D : W;
            const scale = newLen / oldLen;
            return { ...win, wall: newWall, pos: win.pos * scale, len: win.len * scale };
          });

          return {
            roomDimensions: { ...s.roomDimensions, [room]: { width: D, depth: W } },
            rooms: { ...s.rooms, [room]: { ...s.rooms[room], placedItems: newItems } },
            roomDoorWall: { ...s.roomDoorWall, [room]: newDoorWall },
            roomDoorPos:  { ...s.roomDoorPos,  [room]: newDoorPos },
            roomWindows:  { ...s.roomWindows,  [room]: newWindows },
          };
        }),

      pushLayoutHistory: () =>
        set(s => ({
          layoutHistory: [
            ...s.layoutHistory.slice(-19), // keep last 20
            {
              roomLayout:     { ...s.roomLayout },
              roomDimensions: { ...s.roomDimensions },
              enabledRooms:   [...s.enabledRooms],
            },
          ],
        })),

      undoLayout: () =>
        set(s => {
          if (s.layoutHistory.length === 0) return {};
          const prev = s.layoutHistory[s.layoutHistory.length - 1];
          return {
            roomLayout:     prev.roomLayout,
            roomDimensions: prev.roomDimensions,
            enabledRooms:   prev.enabledRooms,
            layoutHistory:  s.layoutHistory.slice(0, -1),
          };
        }),

      resetAll: () => set({
        rooms: initialRooms,
        activeRoom: "living",
        selectedInstanceId: null,
        selectedInstanceIds: [],
        furnitureHistory: [],
        clipboard: [],
        roomClipboard: null,
        budget: 150000,
        scores: { style: 0, space: 0, light: 0, dominantStyle: "" },
        roomLayout: { ...DEFAULT_ROOM_LAYOUT },
        roomDimensions: { ...DEFAULT_ROOM_DIMENSIONS },
        enabledRooms: [...DEFAULT_ENABLED],
        customRoomMeta: {},
        customFurniture: [],
        exterior: { ...initialExterior },
        roomWindows: { ...DEFAULT_ROOM_WINDOWS },
        roomDoorPos: { ...DEFAULT_ROOM_DOOR_POS },
        roomHasDoor: { ...DEFAULT_ROOM_HAS_DOOR },
        roomDoorWall: { ...DEFAULT_ROOM_DOOR_WALL },
        layoutHistory: [],
      }),

      currentRoom: () => {
        const { activeRoom, rooms } = get();
        return rooms[activeRoom];
      },

      totalCost: () => {
        const { activeRoom, rooms } = get();
        const { materials, placedItems } = rooms[activeRoom];
        const area = getRoomArea(activeRoom);
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

        return total;
      },

      isOverBudget: () => {
        const { totalCost, budget } = get();
        return totalCost() > budget;
      },
    }),
    {
      name: "home-designer-v1",
      partialize: (state) => ({
        rooms: state.rooms,
        activeRoom: state.activeRoom,
        budget: state.budget,
        scores: state.scores,
        roomLayout: state.roomLayout,
        roomDimensions: state.roomDimensions,
        enabledRooms: state.enabledRooms,
        customRoomMeta: state.customRoomMeta,
        customFurniture: state.customFurniture,
        exterior: state.exterior,
        roomWindows: state.roomWindows,
        roomDoorPos: state.roomDoorPos,
        roomHasDoor: state.roomHasDoor,
        roomDoorWall: state.roomDoorWall,
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
export type { RoomType, ViewMode, MaterialItem, PlacedItem, RoomMaterials };
