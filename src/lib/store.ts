import { create, useStore } from "zustand";
import { persist } from "zustand/middleware";
import { temporal } from "zundo";
import type { TemporalState } from "zundo";
import { RoomType, ViewMode, MaterialItem, PlacedItem, RoomMaterials, ROOM_DEFS, StyleTag, getRoomArea, FurnitureItem, ExteriorSettings, WindowConfig, RoomState, FloorPlan, ExteriorWallDecorItem, ExteriorWall, WallSide, FacadeLayer, Building } from "./types";
import { FURNITURE, getFurnitureById, registerFurniture } from "./furniture";
import { MATERIALS } from "./data";
import { getOutdoorAssetByKind } from "./outdoorAssets";
import { ALL_TEMPLATES, buildTemplateRoomState, buildEmbeddedRoomState } from "./templates";
import { makeDefaultProject } from "./defaultProject";

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
  "pool","terrace","deck","pergola",
  "equipment_room",
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
  pergola:   { x: 1200, y: 100  },
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

// ─── AI 文生设计：家具分类 → 具体家具 id ─────────────────────────────
// 模型只给分类（如 "bookshelf"），这里挑一件最贴合该房间的真实家具。
function pickFurnitureForCategory(category: string, room: RoomType): string | undefined {
  const inCat = FURNITURE.filter(f => f.category === category);
  if (!inCat.length) return undefined;
  const forRoom = inCat.find(f => f.roomTypes.includes(room));
  return (forRoom ?? inCat[0]).id;
}

// AI 文生设计：材质 id → 具体 MaterialItem。只在 id 存在且分类匹配时返回，
// 否则返回 undefined（保持房间原材质不被乱改）。
// 把 AI 给的材质标识解析成 MaterialItem。弱模型（如 glm-4-flash）常常不回精确 id，
// 而是回中文名（「水晶吊灯」）、英文片段（「chandelier」）或近似词（「氛围吊灯」）。
// 严格 id=== 会把这些全判没 → 用户「换不了灯/墙/地」。所以分级模糊匹配，全程限定在
// 期望 category 内（绝不跨墙/地/灯/砖），最差也只是挑到同类里最接近的一件——
// 对用户而言「有变化」远好过「没反应」。
function resolveAiMaterial(
  id: string | undefined,
  expected: "wall" | "floor" | "light" | "tile",
): import("./types").MaterialItem | undefined {
  if (!id) return undefined;
  const q = String(id).trim();
  if (!q) return undefined;
  const ql = q.toLowerCase();
  const pool = MATERIALS.filter(x => x.category === expected);
  // 1) 精确 id
  let m = pool.find(x => x.id === q);
  if (m) return m;
  // 2) 精确中文名
  m = pool.find(x => x.name === q);
  if (m) return m;
  // 3) id 片段：「chandelier」→ light-chandelier；含/被含都算（≥3 字符防误命中）
  if (ql.length >= 3) {
    m = pool.find(x => x.id.toLowerCase().includes(ql) || ql.includes(x.id.toLowerCase()));
    if (m) return m;
  }
  // 4) 中文名互相包含：「水晶灯」⊂「水晶吊灯」之类
  if (q.length >= 2) {
    m = pool.find(x => x.name.includes(q) || q.includes(x.name));
    if (m) return m;
  }
  // 5) 2-gram 重叠打分（中文友好）：「氛围吊灯」与名称含「吊灯」的项重叠最高 → 选它
  const grams = (s: string) => {
    const g: string[] = [];
    const t = s.toLowerCase();
    for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
    return g;
  };
  const qg = grams(q);
  let best: import("./types").MaterialItem | undefined;
  let bestScore = 0;
  for (const x of pool) {
    const ng = new Set(grams(x.name));
    let sc = 0;
    for (const g of qg) if (ng.has(g)) sc++;
    if (sc > bestScore) { bestScore = sc; best = x; }
  }
  return bestScore >= 1 ? best : undefined;
}

// 把 AI 的家具清单解析成 PlacedItem[]：有 id 用 id（保住手动摆的），
// 否则按分类挑一件；没给坐标就从左到右、自动换行铺，并夹进房间范围内。
function resolveAiFurniture(
  list: import("./aiDesignTypes").AiDesignFurniture[],
  room: RoomType, roomW: number, roomD: number,
): PlacedItem[] {
  const items: PlacedItem[] = [];
  const M = 40; // 边距 / 间距 cm
  let cursorX = M, cursorZ = M, rowMaxD = 0;
  for (const entry of list) {
    let fid: string | undefined;
    if (entry.id && getFurnitureById(entry.id)) fid = entry.id;
    else if (entry.category) fid = pickFurnitureForCategory(entry.category, room);
    if (!fid) continue;
    const f = getFurnitureById(fid)!;
    let x = entry.x, z = entry.y;
    if (x === undefined && z === undefined) {
      if (cursorX + f.width + M > roomW) { cursorX = M; cursorZ += rowMaxD + M; rowMaxD = 0; }
      x = cursorX + f.width / 2;
      z = cursorZ + f.depth / 2;
      cursorX += f.width + M;
      rowMaxD = Math.max(rowMaxD, f.depth);
    } else {
      // 只给了一个轴：尊重给出的那个，缺的轴默认房间居中——
      // 别因为缺一半就把两个都丢回自动摆放。
      x = x ?? roomW / 2;
      z = z ?? roomD / 2;
    }
    x = Math.max(f.width / 2, Math.min(roomW - f.width / 2, x));
    z = Math.max(f.depth / 2, Math.min(roomD - f.depth / 2, z));
    // 朝向/缩放/吊顶：AI 给了就用，否则默认正放、原尺寸、落地。
    // rotation 吸附到最近的 90° 档（PlacedItem 只认 0/90/180/270）。
    const rot = entry.rotation != null
      ? (((Math.round(entry.rotation / 90) * 90) % 360) + 360) % 360
      : 0;
    const clampScale = (v: number | undefined) =>
      v != null ? Math.max(0.2, Math.min(5, v)) : 1;
    items.push({
      instanceId: genId(), furnitureId: fid, x, z,
      rotation: rot,
      scaleW: clampScale(entry.scaleW),
      scaleD: clampScale(entry.scaleD),
      scaleH: clampScale(entry.scaleH),
      ...(entry.mountCeiling ? { mountCeiling: true } : {}),
      ...(entry.elevationY != null ? { elevationY: Math.max(0, Math.round(entry.elevationY)) } : {}),
    });
  }
  return items;
}

// 院子结构件 prefab：AI 只允许这几种"整块"结构（与 PrefabKind 中 structural 子集对齐）。
const AI_YARD_PREFABS = ["pool", "pergola_classic", "outdoor_kitchen", "fountain"] as const;

// 把 AI 给的门款（可能是 DoorStyle 枚举值，也可能是中文/近义词）解析成合法
// DoorStyle。弱模型常回「磨砂玻璃」「谷仓门」这类自然语言而非枚举 id，严格匹配
// 会让「主卧门换磨砂玻璃」落空（设计已应用但门没变），故走宽容关键字匹配。
function resolveAiDoorStyle(v: string | undefined): import("./types").DoorStyle | undefined {
  if (!v) return undefined;
  const q = String(v).trim().toLowerCase();
  if (!q) return undefined;
  // 1) 直接是枚举值
  if (q === "wood_panel" || q === "frosted_glass" || q === "sliding_barn" || q === "french_double") {
    return q as import("./types").DoorStyle;
  }
  // 2) 关键字匹配（中英混合）。顺序：先判更具体的玻璃/谷仓/法式，木门兜底。
  if (/法式|french|double|对开/.test(q)) return "french_double";
  if (/谷仓|推拉|sliding|barn|移门|吊轨/.test(q)) return "sliding_barn";
  if (/磨砂|玻璃|frost|glass/.test(q)) return "frosted_glass";
  if (/实木|木门|木板|wood|panel|木质/.test(q)) return "wood_panel";
  return undefined;
}

// 把 AI 给的窗款（枚举值或中文/近义词）解析成合法 WindowStyle。理由同门款：
// 弱模型常回「落地窗」「百叶」这类自然语言，严格匹配会让「换成观景窗」落空。
function resolveAiWindowStyle(v: string | undefined): import("./types").WindowStyle | undefined {
  if (!v) return undefined;
  const q = String(v).trim().toLowerCase();
  if (!q) return undefined;
  if (q === "sliding" || q === "casement" || q === "fixed" || q === "louvered" || q === "security" || q === "wooden") {
    return q as import("./types").WindowStyle;
  }
  // 「落地窗/观景窗/固定窗」→ fixed（无分隔大玻璃）。先判更具体的，推拉窗兜底。
  if (/防盗|栏栅|铁艺|security|grille|bars/.test(q)) return "security";
  if (/百叶|louver|louvre|shutter|blind/.test(q)) return "louvered";
  if (/木窗|复古|中式|乡村|wood/.test(q)) return "wooden";
  if (/落地|观景|固定|panorama|picture|fixed/.test(q)) return "fixed";
  if (/平开|外开|casement/.test(q)) return "casement";
  if (/推拉|移窗|sliding|slide/.test(q)) return "sliding";
  return undefined;
}

// 外墙材质类型（render/brick/stone/wood/concrete/glass）宽容解析。
function resolveAiWallMaterial(v: string | undefined): import("./types").WallMaterialType | undefined {
  if (!v) return undefined;
  const q = String(v).trim().toLowerCase();
  if (!q) return undefined;
  if (["render", "brick", "stone", "wood", "concrete", "glass"].includes(q)) {
    return q as import("./types").WallMaterialType;
  }
  if (/砖|红砖|青砖|brick/.test(q)) return "brick";
  if (/石材|石头|大理石|stone|marble/.test(q)) return "stone";
  if (/木|wood|timber/.test(q)) return "wood";
  if (/混凝土|清水|水泥|concrete|cement/.test(q)) return "concrete";
  if (/玻璃|幕墙|glass|curtain/.test(q)) return "glass";
  if (/抹灰|涂料|乳胶|render|stucco|paint/.test(q)) return "render";
  return undefined;
}

// 房间形状预设（rect/l-shape/convex）宽容解析。custom 不让 AI 直接给（要点坐标）。
function resolveAiRoomShape(v: string | undefined): import("./roomGeometry").ShapePreset | undefined {
  if (!v) return undefined;
  const q = String(v).trim().toLowerCase();
  if (!q) return undefined;
  if (q === "rect" || q === "l-shape" || q === "convex") return q;
  if (/l型|l形|lshape|l-shape|l字/.test(q)) return "l-shape";
  if (/凸|convex|t型|t形/.test(q)) return "convex";
  if (/矩形|长方|方形|rect/.test(q)) return "rect";
  return undefined;
}

// 房间外立面（glass/concrete/auto）宽容解析。
function resolveAiExteriorStyle(v: string | undefined): "glass" | "concrete" | "auto" | undefined {
  if (!v) return undefined;
  const q = String(v).trim().toLowerCase();
  if (!q) return undefined;
  if (q === "glass" || q === "concrete" || q === "auto") return q;
  if (/玻璃|幕墙|glass|curtain/.test(q)) return "glass";
  if (/实墙|混凝土|concrete|solid/.test(q)) return "concrete";
  if (/自动|auto/.test(q)) return "auto";
  return undefined;
}

// 院子小径铺装材质（stone/gravel/grass/brick）宽容解析。
function resolveAiPathMaterial(v: string | undefined): "stone" | "gravel" | "grass" | "brick" | undefined {
  if (!v) return undefined;
  const q = String(v).trim().toLowerCase();
  if (!q) return undefined;
  if (["stone", "gravel", "grass", "brick"].includes(q)) return q as "stone";
  if (/石板|石头|石|stone/.test(q)) return "stone";
  if (/砾石|碎石|gravel/.test(q)) return "gravel";
  if (/草|grass/.test(q)) return "grass";
  if (/砖|brick/.test(q)) return "brick";
  return undefined;
}

// 楼体轮廓（rect/L/U/T）宽容解析。
function resolveAiFootprint(v: string | undefined): "rect" | "L" | "U" | "T" | undefined {
  if (!v) return undefined;
  const q = String(v).trim();
  if (!q) return undefined;
  const u = q.toUpperCase();
  if (u === "RECT" || /矩形|长方/.test(q)) return "rect";
  if (u === "L" || /L型|L形|L字/i.test(q)) return "L";
  if (u === "U" || /U型|U形|U字|回字/i.test(q)) return "U";
  if (u === "T" || /T型|T形|T字/i.test(q)) return "T";
  return undefined;
}

// 把 AI 的院子清单解析成 YardItem[]：kind 走 OUTDOOR_ASSET_LIBRARY（树/灌木/石头/
// 装饰/户外家具），prefab 走结构件（泳池/廊架/户外厨房/喷泉）。没给坐标就在前院
// （+z）自动散开，避免全堆在原点重叠。
function resolveAiYard(
  list: import("./aiDesignTypes").AiDesignYardItem[],
  startIndex: number,
): import("./types").YardItem[] {
  const out: import("./types").YardItem[] = [];
  let auto = startIndex;
  for (const entry of list) {
    // 自动散点：沿前院左右交替铺开，每个间隔 ~350cm。
    const autoPos = () => {
      const i = auto++;
      const col = Math.ceil(i / 2);
      const sign = i % 2 === 0 ? 1 : -1;
      return { x: sign * col * 350, z: 650 + (i % 3) * 200 };
    };
    if (entry.prefab && (AI_YARD_PREFABS as readonly string[]).includes(entry.prefab)) {
      const p = entry.x != null && entry.z != null ? { x: entry.x, z: entry.z } : autoPos();
      out.push({
        id: `yard-${genId()}`,
        type: "prefab",
        prefabKind: entry.prefab,
        x: p.x, z: p.z,
        ...(entry.scale != null ? { scale: entry.scale } : {}),
      });
    } else if (entry.kind && getOutdoorAssetByKind(entry.kind)) {
      const p = entry.x != null && entry.z != null ? { x: entry.x, z: entry.z } : autoPos();
      out.push({
        id: `yard-${genId()}`,
        type: "singleton",
        kind: entry.kind,
        x: p.x, z: p.z,
        ...(entry.scale != null ? { scale: entry.scale } : {}),
      });
    }
  }
  return out;
}

/** Resolve AI yard zones → YardZone items. Each is a rectangle (w×d) centred
 *  at (x, z); polygon is relative to the zone origin (matches preset zones). */
function resolveAiZones(
  list: import("./aiDesignTypes").AiDesignYardZone[] | undefined,
): import("./types").YardItem[] {
  const VALID = ["social", "private", "utility", "agro", "lawn"] as const;
  const out: import("./types").YardItem[] = [];
  for (const z of list ?? []) {
    if (!z || !(VALID as readonly string[]).includes(z.kind)) continue;
    const w = Math.max(100, Math.min(4000, Math.round(z.widthCm)));
    const d = Math.max(100, Math.min(4000, Math.round(z.depthCm)));
    if (!Number.isFinite(z.x) || !Number.isFinite(z.z)) continue;
    const hw = w / 2, hd = d / 2;
    out.push({
      id: `yard-zone-${genId()}`,
      type: "zone",
      zoneKind: z.kind,
      x: Math.round(z.x), z: Math.round(z.z),
      polygon: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]],
      rot: 0,
    } as import("./types").YardZone);
  }
  return out;
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

/** 楼梯间默认家具：一把双跑转折梯，居中放置。转折梯自带半层休息平台，
 *  上下都在同侧(走廊端)进出，到层后能直接走到走廊/下一跑，漫游里可真正
 *  爬通——直梯每层填满梯井、无平台、两跑反端，物理上走不通。楼梯和其它
 *  家具一样是普通 placedItem，方位/大小走统一编辑流程，各视图统一用
 *  PlacedItemMesh → StaircaseMesh 渲染。 */
function defaultStairItems(): PlacedItem[] {
  const { width, depth } = DEFAULT_ROOM_DIMENSIONS.stair;
  return [{
    instanceId: genId(),
    furnitureId: "staircase-u-shaped",
    x: Math.round(width / 2),
    z: Math.round(depth / 2),
    rotation: 0,
  }];
}

/** 凉亭房间默认家具：一座凉亭骨架，居中。和楼梯一样是普通 placedItem，
 *  方位/大小走统一编辑流程——「凉亭」本身就是这个房间。 */
function defaultPergolaItems(): PlacedItem[] {
  const { width, depth } = DEFAULT_ROOM_DIMENSIONS.pergola;
  return [{
    instanceId: genId(),
    furnitureId: "pergola",
    x: Math.round(width / 2),
    z: Math.round(depth / 2),
    rotation: 0,
  }];
}

/** 通用「房间添加即带的默认家具」表。某些房间（楼梯间、凉亭…）的本体就是
 *  一件家具，启用房间时自动放一件，省得用户再去目录里找。普通房间不在表里
 *  就是空房间。这是统一机制，不针对任何单一房间特判。 */
const DEFAULT_ROOM_FURNITURE: Partial<Record<RoomType, () => PlacedItem[]>> = {
  stair:   defaultStairItems,
  pergola: defaultPergolaItems,
};

/**
 * 天台层默认计划：天台就是一个「没有顶的普通楼层」，默认空着——只继承楼下的
 * 出屋面楼梯间（保证漫游能从楼梯爬上天台），其余房间由用户像普通楼层一样自行
 * 添加。没有任何天台专属房间类型或特殊家具预设。盖顶与否由 exterior.rooftopCeiling
 * 单一开关控制（默认露天）。
 */
function makeRooftopFloorPlan(regularPlans?: FloorPlan[]): FloorPlan {
  const ref = regularPlans && regularPlans.length > 0
    ? regularPlans[regularPlans.length - 1]
    : undefined;
  const fp: FloorPlan = {
    rooms: Object.fromEntries(ALL_ROOM_TYPES.map(r => [r, emptyRoom()])) as Record<RoomType, RoomState>,
    enabledRooms: [],
    roomLayout: { ...DEFAULT_ROOM_LAYOUT },
    roomDimensions: { ...DEFAULT_ROOM_DIMENSIONS },
    roomWindows: { ...DEFAULT_ROOM_WINDOWS },
    roomDoorPos: { ...DEFAULT_ROOM_DOOR_POS },
    roomHasDoor: { ...DEFAULT_ROOM_HAS_DOOR },
    roomDoorWall: { ...DEFAULT_ROOM_DOOR_WALL },
  };
  // 只继承楼梯间（出屋面间）——与楼下同位、同尺寸、同家具，让漫游可真正爬通。
  if (ref?.enabledRooms?.includes("stair")) {
    fp.enabledRooms = ["stair"];
    if (ref.roomLayout?.stair)     fp.roomLayout     = { ...fp.roomLayout,     stair: { ...ref.roomLayout.stair } };
    if (ref.roomDimensions?.stair) fp.roomDimensions = { ...fp.roomDimensions, stair: { ...ref.roomDimensions.stair } };
    fp.rooms.stair = ref.rooms?.stair?.placedItems
      ? { materials: { ...(ref.rooms.stair.materials ?? {}) }, placedItems: ref.rooms.stair.placedItems.map(p => ({ ...p, instanceId: genId() })) }
      : { materials: {}, placedItems: defaultStairItems() };
  }
  return fp;
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

// ─── updateYardPlan helper — yard is now a top-level store field (v9+) ───
// Previously lived in floorPlans[0].yardPlan; lifted to be shared across all buildings.
function updateYardFloor(
  get: () => DesignerStore,
  set: (partial: Partial<DesignerStore> | ((s: DesignerStore) => Partial<DesignerStore>)) => void,
  updater: (yp: import("./types").YardPlan) => import("./types").YardPlan
) {
  const s = get();
  set({ yardPlan: updater(s.yardPlan ?? { items: [] }) });
}

// ─── Store interface ───────────────────────────────────────

interface DesignerStore {
  // State
  floorPlans: FloorPlan[];
  activeRoom: RoomType;
  viewMode: ViewMode;
  // NSWE 方位标识（平面图/效果图/漫游图各墙的 N/S/W/E 标签）的显隐开关。
  // 用户可一键显示或隐藏。持久化保存偏好。
  showCompass: boolean;
  toggleCompass: () => void;
  selectedInstanceId: string | null;
  selectedInstanceIds: string[];
  budget: number;
  scores: StyleScore;
  /** 内置默认方案的版本戳（见 DEFAULT_PROJECT_VERSION）。 */
  defaultProjectVersion: number;

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
  toggleItemMirror: (instanceId: string, axis: "x" | "z") => void;
  setItemLabel: (instanceId: string, label: string) => void;
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
  /** 轮廓编辑收尾规范化：把拖出负坐标的多边形整体平移回正象限，
   *  并同步 roomLayout / roomDimensions / 家具 / 门窗偏移（历史坑：
   *  只平移多边形不平移家具门窗 → 门跳墙、家具错位）。世界位置不变。
   *  多数视图假设房间局部坐标 ≥0（单房间平面图从原点画 → 负坐标区被
   *  切掉），编辑轮廓退出时必须调用。 */
  normalizeRoomShape: (room: RoomType) => void;
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
  customRoomMeta: Partial<Record<RoomType, { name: string; icon: string; nameEn?: string }>>;
  setCustomRoomMeta: (room: RoomType, name: string, icon: string, nameEn?: string) => void;

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

  // ── Multi-building ──────────────────────────────────────────────────────
  /** All buildings on the plot. buildings[0] = main house (always at x=0,z=0).
   *  Top-level `floorPlans` and `exterior` are mirrors of
   *  buildings[activeBuilding].floorPlans / .exterior. */
  buildings: Building[];
  activeBuilding: number;
  /** Switch to building at index idx. Saves current floorPlans/exterior into
   *  buildings[activeBuilding] first so data is not lost. */
  setActiveBuilding: (idx: number) => void;
  /** Add a new building with a fresh default floor plan at the given yard position. */
  addBuilding: (label: string, x: number, z: number) => void;
  /** Remove a secondary building by id. Cannot remove buildings[0]. */
  removeBuilding: (id: string) => void;
  /** Update position/rotation of any building (including main house). */
  updateBuildingPosition: (id: string, patch: { x?: number; z?: number; rot?: number; label?: string }) => void;
  /** Replace floorPlans + exterior of buildings[idx] in-place. Refreshes active mirrors if needed. No page reload. */
  importIntoBuilding: (idx: number, floorPlans: FloorPlan[], exterior: ExteriorSettings) => void;

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
  /** Set the explicit show/hide override for one facade layer (实墙/玻璃幕墙/
   *  框架) on one face. `value` = true (force show) / false (force hide) /
   *  undefined (clear override → back to mode default). */
  setFaceLayer: (room: RoomType, key: string, layer: FacadeLayer, value: boolean | undefined) => void;
  /** Set per-face glass transparency (0..1). null clears → global default. */
  setFaceOpacity: (room: RoomType, key: string, value: number | null) => void;
  setDoorEdgeIdx: (room: RoomType, edgeIdx: number | null) => void;

  // ── Yard plan (outdoor 2D editor) ──
  // yardPlan is now a TOP-LEVEL store field (v9+), shared across all buildings.
  // Previously lived in floorPlans[0].yardPlan; migrated via persist v8→v9.
  yardPlan: import("./types").YardPlan;
  addYardItem:    (item: import("./types").YardItem) => void;
  removeYardItem: (id: string) => void;
  /** Patch is a structural subset — only fields shared across the union
   *  are statically typeable. Renderers / inspectors that touch
   *  prefab.params should pass `{ params: { … } }`; the value gets
   *  shallow-merged at the call site. */
  updateYardItem: (
    id: string,
    patch: { x?: number; z?: number; rot?: number; scale?: number; params?: Record<string, unknown>; subtype?: import("./types").ZoneSubtype | undefined; footprintCm?: { w: number; d: number }; polygon?: Array<[number, number]> },
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
  /** Apply a design generated by the AI text-to-design API.
   *  merge=true（增量微调）：只更新返回里出现的楼层/房间，其余原样保留——
   *  这样模型只需吐改动的那一两个房间，不必重写整套，又快又不易截断。 */
  applyAiDesign: (
    design: import("./aiDesignTypes").AiDesignResult,
    opts?: { merge?: boolean },
  ) => void;

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

// 当前持久化 schema 版本。导入 JSON 回灌 localStorage 时必须打这个版本号，
// 否则 zustand 会从 0 开始跑迁移链——其中 v0→v1 会把门窗整组抹成默认值。
export const PERSIST_VERSION = 9;

// 内置默认方案的版本号。存档里会戳上这个值。当老存档的戳 < 此值时，迁移会
// 把「最新完备默认方案」灌进去（详见 migrate 的 v7→v8）。
// ⚠️ 含义：bump 这个值 = 强制把所有低于它的存档重置成最新默认（会覆盖用户
// 自定义）。所以——只在「想强推新默认给所有人」时才 bump；如果只是想让新用户
// 看到更好的默认、不动老用户，**不要 bump**（冷启动初始 state 已覆盖新用户）。
export const DEFAULT_PROJECT_VERSION = 1;

// 冷启动默认方案（度假泳池别墅）。只在「无本地存档」时生效：persist 中间件
// 用初始 state，已有存档的老用户会被 rehydrate 覆盖，不受影响。模块加载时
// 取一份深拷贝即可（整轮会话只用这一份引用）。
const __defaultProject = makeDefaultProject();

export const useDesignerStore = create<DesignerStore>()(
  temporal(
  persist(
    (set, get) => ({
      floorPlans: __defaultProject.floorPlans,
      activeRoom: "living",
      viewMode: "3d",
      showCompass: true,
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
      budget: 350000,
      furnitureHistory: [],
      clipboard: [],
      roomClipboard: null,
      blueprint: { image: null, naturalW: 0, naturalH: 0, opacity: 0.4, offsetX: 0, offsetY: 0, scale: 1 },
      scores: __defaultProject.scores,
      defaultProjectVersion: DEFAULT_PROJECT_VERSION,
      customRoomMeta: {},
      customFurniture: [],
      exterior: { ...initialExterior, ...__defaultProject.exterior },
      activeFloor: 0,
      buildings: [{
        id: "main",
        label: "主楼",
        x: 0, z: 0, rot: 0,
        floorPlans: __defaultProject.floorPlans,
        exterior: { ...initialExterior, ...__defaultProject.exterior },
      }],
      activeBuilding: 0,
      yardPlan: __defaultProject.floorPlans[0]?.yardPlan ?? { items: [] },

      setActiveBuilding: (idx) => {
        const s = get();
        if (idx === s.activeBuilding) return;
        const bld = s.buildings[idx];
        if (!bld) return;
        // Save current state back to active building before switching.
        const saved = s.buildings.map((b, i) =>
          i === s.activeBuilding ? { ...b, floorPlans: s.floorPlans, exterior: s.exterior } : b
        );
        set({
          buildings: saved,
          activeBuilding: idx,
          floorPlans: bld.floorPlans,
          exterior: bld.exterior,
          activeFloor: 0,
        });
      },

      addBuilding: (label, x, z) => {
        const s = get();
        // Save current state first.
        const saved = s.buildings.map((b, i) =>
          i === s.activeBuilding ? { ...b, floorPlans: s.floorPlans, exterior: s.exterior } : b
        );
        const newBuilding: Building = {
          id: `bld_${Date.now()}`,
          label,
          x, z, rot: 0,
          floorPlans: [makeDefaultFloorPlan()],
          exterior: { ...initialExterior },
        };
        set({ buildings: [...saved, newBuilding] });
      },

      removeBuilding: (id) => {
        const s = get();
        if (id === "main") return; // cannot remove main house
        const idx = s.buildings.findIndex(b => b.id === id);
        if (idx <= 0) return;
        const updated = s.buildings.filter(b => b.id !== id);
        const newActive = s.activeBuilding >= updated.length ? 0 : s.activeBuilding;
        set({
          buildings: updated,
          activeBuilding: newActive,
          ...(s.activeBuilding === idx ? {
            floorPlans: updated[newActive].floorPlans,
            exterior: updated[newActive].exterior,
            activeFloor: 0,
          } : {}),
        });
      },

      updateBuildingPosition: (id, patch) => {
        const s = get();
        set({
          buildings: s.buildings.map(b => b.id === id ? { ...b, ...patch } : b),
        });
      },

      importIntoBuilding: (idx, floorPlans, exterior) => {
        const s = get();
        const updated = s.buildings.map((b, i) =>
          i === idx ? { ...b, floorPlans, exterior } : b
        );
        const patch: Partial<DesignerStore> = { buildings: updated };
        if (idx === s.activeBuilding) {
          patch.floorPlans = floorPlans;
          patch.exterior   = exterior;
          patch.activeFloor = 0;
        }
        set(patch);
      },

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
      toggleCompass: () => set(s => ({ showCompass: !s.showCompass })),

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
        // 不再强制跳到平面图——在效果图/全屋3D/整体布局里加家具就留在原视图
        // （新家具落在房间中心，所有视图都立刻可见；要精调位置自己切平面图）。
        set({ floorPlans, selectedInstanceId: newItem.instanceId, scores: computeScores(materials, updatedPlaced) });
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

      // 镜像翻转（横向 X / 纵向 Z）：翻转选中家具的对应轴，做成对对称摆件。
      toggleItemMirror: (instanceId, axis) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const key = axis === "x" ? "mirrorX" : "mirrorZ";
        const updatedPlaced = fp.rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId ? { ...p, [key]: !p[key] } : p
        );
        const floorPlans = [...s.floorPlans];
        floorPlans[activeFloor] = { ...fp, rooms: { ...fp.rooms, [activeRoom]: { ...fp.rooms[activeRoom], placedItems: updatedPlaced } } };
        set({ floorPlans });
      },

      // 店招灯箱等道具的显示文字。
      setItemLabel: (instanceId, label) => {
        const s = get();
        const { activeRoom, activeFloor } = s;
        const fp = s.floorPlans[activeFloor];
        if (!fp?.rooms[activeRoom]) return;
        const updatedPlaced = fp.rooms[activeRoom].placedItems.map(p =>
          p.instanceId === instanceId ? { ...p, label } : p
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

      normalizeRoomShape: (room: RoomType) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomShapes?.[room];
          if (!cur || cur.points.length < 3) return {};
          let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
          for (const [x, z] of cur.points) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
          }
          // 只在拖出了负坐标时平移（正常编辑零开销、零影响）
          const dx = minX < 0 ? -minX : 0;
          const dz = minZ < 0 ? -minZ : 0;
          if (dx === 0 && dz === 0) return {};
          const points = cur.points.map(([x, z]) =>
            [Math.round(x + dx), Math.round(z + dz)] as [number, number]);
          const lay = fp.roomLayout[room] ?? { x: 0, y: 0 };
          const patch: Partial<FloorPlan> = {
            roomShapes: { ...(fp.roomShapes ?? {}), [room]: { preset: cur.preset, points } },
            // 原点左移/上移 dx,dz → roomLayout 反向补偿，房间世界位置不变
            roomLayout: { ...fp.roomLayout, [room]: { x: Math.round(lay.x - dx), y: Math.round(lay.y - dz) } },
            // 尺寸 = 平移后 bbox 全跨度
            roomDimensions: { ...fp.roomDimensions, [room]: { width: Math.round(maxX - minX), depth: Math.round(maxZ - minZ) } },
          };
          // 家具同步平移（局部坐标 +dx,+dz = 世界位置不动）
          const rs = fp.rooms[room];
          if (rs?.placedItems?.length) {
            patch.rooms = { ...fp.rooms, [room]: { ...rs, placedItems: rs.placedItems.map(p => ({ ...p, x: p.x + dx, z: p.z + dz })) } };
          }
          // 门窗偏移：pos 沿墙起点计 → N/S 墙 +dx、W/E 墙 +dz；
          // edgeIndex 绑定的沿边偏移随顶点整体平移，不用动。
          const shiftPos = <T extends { wall: string; pos: number; edgeIndex?: number }>(c: T): T =>
            c.edgeIndex != null ? c : { ...c, pos: c.pos + ((c.wall === "N" || c.wall === "S") ? dx : dz) };
          const wins = fp.roomWindows?.[room];
          if (wins?.length) patch.roomWindows = { ...fp.roomWindows, [room]: wins.map(shiftPos) };
          const doors = fp.roomDoors?.[room];
          if (doors?.length) patch.roomDoors = { ...fp.roomDoors, [room]: doors.map(shiftPos) };
          return patch;
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
        updateFloor(get, set, fp => {
          const already = fp.enabledRooms.includes(room);
          // 房间本体即家具的（楼梯/凉亭…）首次启用时自动放一件默认家具。
          const existing = fp.rooms[room]?.placedItems ?? [];
          const seed = (!existing.length && DEFAULT_ROOM_FURNITURE[room]) ? DEFAULT_ROOM_FURNITURE[room]!() : [];
          // 兼容旧存档：该楼层若缺这个房间类型的尺寸/位置等默认值（房间类型是
          // 在此存档落地之后才新增的），就地补默认值，避免后续读 dims.width 崩。
          const patch: Partial<FloorPlan> = {};
          if (!fp.roomDimensions?.[room]) patch.roomDimensions = { ...fp.roomDimensions, [room]: DEFAULT_ROOM_DIMENSIONS[room] ?? { width: 300, depth: 260 } };
          if (!fp.roomLayout?.[room])     patch.roomLayout     = { ...fp.roomLayout,     [room]: DEFAULT_ROOM_LAYOUT[room]     ?? { x: 0, y: 0 } };
          if (!fp.roomWindows?.[room])    patch.roomWindows    = { ...fp.roomWindows,    [room]: makeDefaultWindows(room) };
          if (fp.roomDoorPos?.[room] === undefined)  patch.roomDoorPos  = { ...fp.roomDoorPos,  [room]: DEFAULT_ROOM_DOOR_POS[room]  ?? 50 };
          if (fp.roomHasDoor?.[room] === undefined)  patch.roomHasDoor  = { ...fp.roomHasDoor,  [room]: DEFAULT_ROOM_HAS_DOOR[room]  ?? true };
          if (!fp.roomDoorWall?.[room])   patch.roomDoorWall   = { ...fp.roomDoorWall,   [room]: DEFAULT_ROOM_DOOR_WALL[room]   ?? "S" };
          return {
            ...patch,
            enabledRooms: already ? fp.enabledRooms : [...fp.enabledRooms, room],
            rooms: (fp.rooms[room] && existing.length)
              ? fp.rooms
              : { ...fp.rooms, [room]: { materials: fp.rooms[room]?.materials ?? {}, placedItems: [...existing, ...seed] } },
          };
        });
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
        const OUTDOOR: RoomType[] = ["yard","garage","gym","cinema","pool","terrace","deck","pergola","balcony","balcony2"];
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

      setCustomRoomMeta: (room, name, icon, nameEn) =>
        set(s => ({ customRoomMeta: { ...s.customRoomMeta, [room]: { name, icon, ...(nameEn?.trim() ? { nameEn: nameEn.trim() } : {}) } } })),

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
          const shapesMap = { ...(existing.roomShapes ?? {}) };
          const hiddenMap = { ...(existing.roomWallsHidden ?? {}) };
          // 门窗数据**按模板从头生成**，不继承上一个方案（用户实拍：从别墅切到咖啡馆时，
          // 别墅那扇位置离谱、还横跨幕墙与实墙的窗被带了过来；30 个房间的 legacy 门字段
          // 同理）。没有任何项目模板定义 windows，全部靠下面按房间尺寸/立面重新算。
          // 这才是「一键加载模板 = 替换所有平面图」该有的行为。
          const winMap: Record<string, WindowConfig[]> = {};
          const dWallMap = { ...DEFAULT_ROOM_DOOR_WALL };
          const dPosMap  = { ...DEFAULT_ROOM_DOOR_POS };
          const dHasMap  = { ...DEFAULT_ROOM_HAS_DOOR };
          // 循环空间（走廊/楼梯间）靠开口连通，不该有门。全局默认是每房一扇 S 门，
          // 不排除的话走廊会凭空长出一扇门（用户：走廊你放个门吃屎啊）。
          dHasMap.hallway = false;
          dHasMap.stair = false;
          for (const r of layout.rooms) {
            layoutMap[r.room] = { x: r.x, y: r.y };
            dimsMap[r.room]   = { width: r.width, depth: r.depth };
            // 窗户：**保留用户在平面图里配置的窗**，模板不生成也不清除。
            //
            // 这里原本会按 ROOM_DEFS 给每个房间凭空造一扇窗、并把 exteriorStyle
            // ==="glass" 的房间强制清空。那是为了解决「切模板后残留上一个模板的窗」，
            // 但代价是用户自己画的窗每次都被删（用户：我明明平面图设置了窗户，
            // 为什么吃掉了）。用户的数据 > 我猜的整洁度：模板只搬自己声明的东西，
            // 窗户归平面图管。残留窗只在「该房间本模板根本没有」时才由下面统一清掉。
            if (existing.roomWindows?.[r.room]) winMap[r.room] = existing.roomWindows[r.room];
            // 模板声明了非矩形轮廓就应用；没声明则清掉旧项目残留的自定义形状
            if (r.shape) shapesMap[r.room] = r.shape; else delete shapesMap[r.room];
            // 模板声明了隐藏墙（开放式/骑楼）就应用；没声明则清掉残留
            if (r.wallsHidden?.length) {
              hiddenMap[r.room] = Object.fromEntries(r.wallsHidden.map(sd => [sd, true]));
            } else {
              delete hiddenMap[r.room];
            }
          }
          return {
            ...existing,
            enabledRooms: enabled,
            roomLayout: layoutMap,
            roomDimensions: dimsMap,
            roomShapes: shapesMap,
            roomWallsHidden: hiddenMap,
            // 门窗从头生成，不继承旧方案（见上）。legacy 单门字段回到全局默认，
            // 让 getRoomDoors 走"每房一扇 S 墙门"，而不是继承别墅 30 房间的旧值。
            roomWindows: winMap,
            roomDoorWall: dWallMap,
            roomDoorPos: dPosMap,
            roomHasDoor: dHasMap,
            roomDoors: {},
            roomDoorStyle: {},
            roomDoorLen: {},
            // yardPlan is now top-level; skip per-floor attachment

          };
        });

        // 2. Set exterior + floorPlans + reset to floor 0
        set({
          exterior: { ...s.exterior, ...tpl.exterior, floors },
          floorPlans: newFloorPlans,
          activeFloor: 0,
          ...(tpl.yardPlan ? { yardPlan: tpl.yardPlan } : {}),
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

        // 3.5 房间级立面/门（floorLayouts.rooms[].exteriorStyle / doors）——
        //     放在 styleTemplate 之后应用，免得被其默认门窗覆盖。
        //     卫生间/后场声明 concrete 实墙、临街大堂声明 glass + 加宽大门。
        {
          const plans = get().floorPlans.map((fp, fi) => {
            const layout = tpl.floorLayouts[fi];
            if (!layout) return fp;
            const exStyle = { ...(fp.roomExteriorStyle ?? {}) };
            const doorsMap = { ...(fp.roomDoors ?? {}) };
            const windowsMap = { ...(fp.roomWindows ?? {}) };
            let rooms = fp.rooms;
            let touched = false;
            for (const r of layout.rooms) {
              if (r.exteriorStyle) { exStyle[r.room] = r.exteriorStyle; touched = true; }
              if (r.doors?.length) {
                doorsMap[r.room] = r.doors.map((d, i) => ({
                  id: `tpl_door_${r.room}_${i}`, wall: d.wall, pos: d.pos, len: d.len,
                  ...(d.style ? { style: d.style } : {}), ...(d.h != null ? { h: d.h } : {}),
                }));
                touched = true;
              }
              // 显式窗（如咖啡馆西墙1幕墙上悬窗，edgeIndex 绑定多边形边）→ roomWindows。
              // 第一趟已把 roomWindows 设为「保留用户既有窗」，这里再叠加模板声明的窗。
              if (r.windows?.length) {
                windowsMap[r.room] = r.windows.map((w, i) => ({
                  id: `tpl_win_${r.room}_${i}`, wall: w.wall, pos: w.pos, len: w.len,
                  ...(w.h != null ? { h: w.h } : {}), ...(w.sill != null ? { sill: w.sill } : {}),
                  ...(w.style ? { style: w.style } : {}), ...(w.edgeIndex != null ? { edgeIndex: w.edgeIndex } : {}),
                }));
                touched = true;
              }
              // 外墙装饰（店招/壁画/壁灯）→ RoomState.exteriorDecor；
              // 未声明 wallDecor 的房间不动其现有装饰。
              if (r.wallDecor?.length && rooms[r.room]) {
                rooms = {
                  ...rooms,
                  [r.room]: {
                    ...rooms[r.room],
                    exteriorDecor: r.wallDecor.map((d, i) => ({
                      instanceId: `tpl_decor_${r.room}_${i}`,
                      furnitureId: d.furnitureId, wall: d.wall, u: d.u, v: d.v,
                      ...(d.scaleW ? { scaleW: d.scaleW } : {}),
                      ...(d.scaleH ? { scaleH: d.scaleH } : {}),
                      ...(d.label ? { label: d.label } : {}),
                    })),
                  },
                };
                touched = true;
              }
            }
            return touched ? { ...fp, roomExteriorStyle: exStyle, roomDoors: doorsMap, roomWindows: windowsMap, rooms } : fp;
          });
          set({ floorPlans: plans });
        }

        // 4. 片场级显式摆放（可选）：风格模板铺完后，逐房间整体替换 placedItems。
        //    非住宅片场（咖啡馆/办公室…）的家具不是住宅风格能推出来的。
        //    坐标即 store 内部格式（room-local 中心 cm），直接落。
        if (tpl.furnitureOverrides) {
          const plans = get().floorPlans.map((fp, fi) => {
            const overrides = tpl.furnitureOverrides![fi];
            if (!overrides) return fp;
            const rooms = { ...fp.rooms };
            for (const [roomId, items] of Object.entries(overrides)) {
              const rid = roomId as RoomType;
              if (!rooms[rid] || !items) continue;
              rooms[rid] = {
                ...rooms[rid],
                placedItems: items.map((it, i) => ({
                  instanceId: `tpl_${tpl.id}_${rid}_${i}_${it.furnitureId}`,
                  furnitureId: it.furnitureId,
                  x: it.x,
                  z: it.z,
                  rotation: it.rotation ?? 0,
                  scaleW: it.scaleW ?? 1,
                  scaleD: it.scaleD ?? 1,
                  scaleH: it.scaleH ?? 1,
                  // 垂直摆放：台面小件（elevationY 落桌/柜面）+ 吊挂件（mountCeiling
                  // 顶贴天花）。之前漏透传→咖啡杯掉地上、吊灯/绿萝站地上。
                  ...(it.elevationY != null ? { elevationY: Math.max(0, Math.round(it.elevationY)) } : {}),
                  ...(it.mountCeiling ? { mountCeiling: true } : {}),
                  ...(it.label != null ? { label: it.label } : {}),
                })),
              };
            }
            return { ...fp, rooms };
          });
          set({ floorPlans: plans });
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
        //    Stamp the canonical style id so the active highlight stays in sync
        //    no matter which entry point applied it (单一风格主线 single source).
        get().setExterior({ ...preset.settings, preset: presetId });

        // 2) Per-room material defaults + 3) yard items. Both touch
        // floorPlans, so we batch them into one set() to avoid an
        // intermediate render with mismatched state.
        const s = get();
        const findMat = (id: string | undefined) =>
          id ? MATERIALS.find(m => m.id === id) : undefined;

        let floorPlans = s.floorPlans;

        // 外墙材质由「套风格」完全托管：每次应用风格都先清空所有启用房间的
        // 外墙面材质，再按 recipe 重设 —— 否则上一个风格的外墙材质（如现代的
        // 木饰面）会残留到下一个风格（串味）。内墙/地面/灯等仍仅在 recipe
        // 指定时改（原行为）。注意：套风格本就是"一键重置为该风格"，会覆盖
        // 用户手动设的外墙材质。其余风格暂无 roomMaterials → 外墙材质被清空 →
        // 回落到该风格的 wallBaseColor（一致）。
        {
          const rm = preset.roomMaterials;
          floorPlans = floorPlans.map((fp) => {
            if (!fp) return fp;
            const updatedRooms = { ...fp.rooms };
            for (const room of fp.enabledRooms) {
              const existing = updatedRooms[room];
              if (!existing) continue;
              const recipe = rm?.[room];
              // 内墙/地面/瓷砖/灯/墙裙：仅 recipe 指定时改（保持原行为）
              const wall    = findMat(recipe?.wall);
              const floor   = findMat(recipe?.floor);
              const tile    = findMat(recipe?.tile);
              const light   = findMat(recipe?.light);
              const lower   = findMat(recipe?.wallLower);
              // 外墙材质（整体 + 逐面）：与左面板「外墙材质」同一字段，托管赋值
              // —— 指定就用、没指定就 undefined（清空）。让"选风格→立面到位"
              // 且切风格不串味，用户仍可在原面板逐房间/逐面继续改。
              const extAll  = findMat(recipe?.wallExterior);
              const extN    = findMat(recipe?.wallExteriorN);
              const extS    = findMat(recipe?.wallExteriorS);
              const extW    = findMat(recipe?.wallExteriorW);
              const extE    = findMat(recipe?.wallExteriorE);
              updatedRooms[room] = {
                ...existing,
                materials: {
                  ...existing.materials,
                  ...(wall  ? { wall }       : {}),
                  ...(floor ? { floor }      : {}),
                  ...(tile  ? { tile }       : {}),
                  ...(light ? { light }      : {}),
                  ...(lower ? { wallLower: lower } : {}),
                  wallExterior:      extAll,
                  wallBackExterior:  extN,
                  wallFrontExterior: extS,
                  wallLeftExterior:  extW,
                  wallRightExterior: extE,
                },
              };
            }
            return { ...fp, rooms: updatedRooms };
          });
        }

        if (preset.yardItems || preset.yardPaths) {
          // Replace floor-0 yard items / paths wholesale — the preset's
          // landscape is curated to match the facade（风格选一次、院子整包
          // 到位的一致性主线）。preset 没带的部分保持原样。
          // 包里的坐标按"典型住宅"写死，应用前先按当前房屋占地把重叠的
          // 物件/分区推出屋外（泳池压进客厅这类穿模就是这么来的）。
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { houseHalfExtentsCm, clearYardItemsOfHouse } = require("./yardAutoLayout") as typeof import("./yardAutoLayout");
          const fp0 = floorPlans[0];
          if (fp0) {
            const { hw, hd } = houseHalfExtentsCm(fp0);
            const curYp = s.yardPlan ?? { items: [] };
            const newYp = {
              ...curYp,
              ...(preset.yardItems ? { items: clearYardItemsOfHouse(preset.yardItems, hw, hd) } : {}),
              ...(preset.yardPaths ? { paths: preset.yardPaths } : {}),
            };
            set({ yardPlan: newYp });
          }
        }

        // 4) Commit + refresh scores for the active room.
        const activeFp = floorPlans[s.activeFloor];
        const activeRoom = activeFp?.rooms?.[s.activeRoom];
        const scores = activeRoom
          ? computeScores(activeRoom.materials, activeRoom.placedItems)
          : s.scores;
        set({ floorPlans, scores, activeTemplateId: null });
      },

      applyAiDesign: (design, opts) => {
        const merge = opts?.merge ?? false;
        // 单一风格主线：preset 必须先于逐房材质执行——它会整包覆写每间房的
        // 墙/地/灯/砖和院子，放在后面会把 AI 点名的材质冲掉（「地中海风格
        // +客厅鱼骨纹地板」后者丢失）。另外微调模式 current 会回传 preset、
        // 模型常照抄 → 只有 preset 真的变了才重跑，避免每次微调重置全屋。
        if (design.exterior?.preset
            && (!merge || design.exterior.preset !== get().exterior.preset)) {
          get().applyExteriorPreset(design.exterior.preset);
        }
        const s = get();
        // 楼层不再限制最多 3 层：与 setExterior 一致，仅 [1,99] 安全区间。
        // 增量模式：模型可能只回传改动的楼层，floors 缺省时沿用当前层数，别误把楼缩没了。
        const floors = Math.max(
          1,
          Math.min(99, design.floors ?? (merge ? s.exterior.floors : 1)),
        );
        // 旧的常规层数：floorPlans[oldRegularFloors] 在有天台时是天台层，
        // 加层时绝不能把它当普通楼层复用（否则新楼层继承天台布局且天台翻倍）。
        const oldRegularFloors = s.exterior.floors;
        const oldHadRooftop = s.exterior.hasRooftop ?? false;
        // 房间改名（customRoomMeta 是工程级、跨楼层的，循环里收集、最后一次写入）。
        const renamePatch: Partial<Record<RoomType, { name: string; icon: string }>> = {};
        // 灯光状态（开关/亮度/色温也是工程级 map，循环里收集、最后一次写入）。
        const lightOnPatch: Partial<Record<RoomType, boolean>> = {};
        const lightBrightnessPatch: Partial<Record<RoomType, number>> = {};
        const lightColorPatch: Partial<Record<RoomType, string>> = {};
        const newRegularPlans = Array.from({ length: floors }, (_, fi) => {
          // 索引落在旧天台层及以上 → 这是新加的普通楼层，从空白开始。
          const existing = (oldHadRooftop && fi >= oldRegularFloors)
            ? makeDefaultFloorPlan()
            : (s.floorPlans[fi] ?? makeDefaultFloorPlan());
          const layoutEntry = design.floorLayouts?.find(l => l.floorIndex === fi);
          // removeRooms 单独也算"动了这层"——「把书房去掉」可能 rooms 为空只给删除列表。
          if (!layoutEntry || (!layoutEntry.rooms?.length && !layoutEntry.removeRooms?.length)) {
            // 增量模式：没返回这层 = 没动这层，原样保留；重建模式：清空。
            return merge ? existing : { ...existing, enabledRooms: [] };
          }
          // 增量模式从现有房间起步（保留没提到的房间）；重建模式从空开始。
          const enabled: RoomType[] = merge ? [...existing.enabledRooms] : [];
          const layoutMap = { ...existing.roomLayout };
          const dimsMap   = { ...existing.roomDimensions };
          const roomsMap  = { ...existing.rooms };
          // 重建模式（merge=false，= "一键加载某个项目模板"）**不继承**上一个方案的
          // 门窗数据。
          //
          // 历史坑（用户实拍：外观图冒出一扇位置离谱、还横跨幕墙与实墙的幽灵窗）：
          // 这几个 map 原来一律 `{ ...existing }`。而**没有任何项目模板定义 windows**
          // （全部来自 makeDefaultWindows / 用户手改），于是从别墅切到咖啡馆时，
          // 别墅的窗户和 30 个房间的 legacy 门字段被整套带过去 —— 平面图本身就是脏的，
          // 三个 3D 视图再怎么改都是在下游擦屁股。
          //
          // 弹窗写的就是「将替换所有楼层平面图」，重建就该是重建。
          // 增量模式（merge=true，AI 局部改动）仍然保留原样，那才是"没提到的别动"。
          const windowsMap = merge ? { ...existing.roomWindows } : {} as typeof existing.roomWindows;
          const doorsMap = merge ? { ...(existing.roomDoors ?? {}) } : {} as NonNullable<typeof existing.roomDoors>;
          const doorStyleMap = merge ? { ...(existing.roomDoorStyle ?? {}) } : {} as NonNullable<typeof existing.roomDoorStyle>;
          // legacy 单门字段同理：重建模式回到全局默认，而不是继承上一个方案的
          // 30 个房间的旧值（咖啡馆用不到的卧室/车库门也会被带过来）。
          const doorWallMap = merge ? { ...existing.roomDoorWall } : { ...DEFAULT_ROOM_DOOR_WALL };
          const doorPosMap  = merge ? { ...existing.roomDoorPos }  : { ...DEFAULT_ROOM_DOOR_POS };
          const doorLenMap  = merge ? { ...(existing.roomDoorLen ?? {}) } : {} as NonNullable<typeof existing.roomDoorLen>;
          const hasDoorMap  = merge ? { ...existing.roomHasDoor } : { ...DEFAULT_ROOM_HAS_DOOR };
          const shapesMap = { ...(existing.roomShapes ?? {}) };
          const extStyleMap = { ...(existing.roomExteriorStyle ?? {}) };
          const wallsHiddenMap: NonNullable<typeof existing.roomWallsHidden> = { ...(existing.roomWallsHidden ?? {}) };
          for (const r of layoutEntry.rooms ?? []) {
            // Validate room type
            if (!(r.type in ROOM_DEFS)) continue;
            const rt = r.type as RoomType;
            if (!enabled.includes(rt)) enabled.push(rt);
            // 增量模式下 x/y/尺寸缺省就沿用现值，避免把没提的房间挪位/改尺寸。
            const prevPos = layoutMap[rt];
            layoutMap[rt] = {
              x: r.x ?? prevPos?.x ?? 50,
              y: r.y ?? prevPos?.y ?? 50,
            };
            const prevDim = dimsMap[rt];
            const width = Math.max(120, r.widthCm ?? prevDim?.width ?? ROOM_DEFS[rt]?.width ?? 300);
            const depth = Math.max(100, r.depthCm ?? prevDim?.depth ?? ROOM_DEFS[rt]?.depth ?? 260);
            dimsMap[rt] = { width, depth };
            // 家具 + 材质（墙/地/灯/砖）：哪个字段给了就改哪个，没给的保持原样。
            // 这样「主卧换个吊灯」只动 light，墙面/地板/家具都不受影响。
            const hasFurniture = r.furniture !== undefined;
            const newWall    = resolveAiMaterial(r.wall, "wall");
            const newFloor   = resolveAiMaterial(r.floor, "floor");
            const newLight   = resolveAiMaterial(r.light, "light");
            const newTile    = resolveAiMaterial(r.tile, "tile");
            // 天花板/墙裙没有独立材质库，复用 wall 条目（与左面板「天花板」分区
            // 同一做法）；天花板重新打 category 标。
            const ceilingBase = resolveAiMaterial(r.ceiling, "wall");
            const newCeiling = ceilingBase ? { ...ceilingBase, category: "ceiling" as const } : undefined;
            const newWallLower = resolveAiMaterial(r.wallLower, "wall");
            const hasMaterial = !!(newWall || newFloor || newLight || newTile || newCeiling || newWallLower);
            // 外墙装饰：wallDecor 给了（含[]）就按此重建（id 必须是
            // exterior_wall_decor 目录里的真实家具）。
            const hasWallDecor = r.wallDecor !== undefined;
            const newDecor = hasWallDecor
              ? (r.wallDecor ?? [])
                  .filter(d => d?.id && getFurnitureById(d.id)?.category === "exterior_wall_decor"
                    && ["N", "S", "W", "E"].includes(d.wall))
                  .map(d => ({
                    instanceId: genId(),
                    furnitureId: d.id,
                    wall: d.wall,
                    u: Math.max(0.05, Math.min(0.95, d.u ?? 0.5)),
                    v: Math.max(0.05, Math.min(0.95, d.v ?? 0.6)),
                  }))
              : undefined;
            if (hasFurniture || hasMaterial || hasWallDecor) {
              const prevRoom = roomsMap[rt] ?? emptyRoom();
              roomsMap[rt] = {
                ...prevRoom,
                placedItems: hasFurniture
                  ? resolveAiFurniture(r.furniture!, rt, width, depth)
                  : prevRoom.placedItems,
                ...(newDecor !== undefined ? { exteriorDecor: newDecor } : {}),
                materials: {
                  ...prevRoom.materials,
                  ...(newWall  ? { wall:  newWall  } : {}),
                  ...(newFloor ? { floor: newFloor } : {}),
                  ...(newLight ? { light: newLight } : {}),
                  ...(newTile  ? { tile:  newTile  } : {}),
                  ...(newCeiling ? { ceiling: newCeiling } : {}),
                  ...(newWallLower ? { wallLower: newWallLower } : {}),
                },
              };
            }
            // 窗户：r.windows 给了就按此重建该房间窗户（服务端生成 id）；没给保持原样。
            if (r.windows !== undefined) {
              windowsMap[rt] = r.windows
                // 防脏数据：非法墙向 / 非数值坐标直接丢弃（NaN 入库会让渲染层崩）。
                .filter(w => ["N", "S", "W", "E"].includes(w?.wall)
                  && Number.isFinite(w.pos) && Number.isFinite(w.len))
                .map(w => {
                  const style = resolveAiWindowStyle(w.style);
                  return {
                    id: `${rt}-w-${genId()}`,
                    wall: w.wall,
                    pos: Math.max(0, Math.round(w.pos)),
                    len: Math.max(30, Math.round(w.len)),
                    ...(w.h    != null && Number.isFinite(w.h)    ? { h:    Math.round(w.h)    } : {}),
                    ...(w.sill != null && Number.isFinite(w.sill) ? { sill: Math.round(w.sill) } : {}),
                    ...(style ? { style } : {}),
                    ...(w.edgeIndex != null && Number.isFinite(w.edgeIndex)
                      ? { edgeIndex: Math.round(w.edgeIndex) } : {}),
                  };
                });
            }
            // 开放式/拆墙：openWalls 给了就按此重建该房间的 NSWE 隐藏；
            // 非 NSWE 的隐藏键（如 ceiling）原样保留。
            if (r.openWalls !== undefined) {
              const prev = wallsHiddenMap[rt] ?? {};
              const next: Record<string, boolean> = {};
              for (const k of Object.keys(prev)) {
                if (!["N", "S", "W", "E"].includes(k)) next[k] = prev[k]!;
              }
              for (const side of r.openWalls) next[side] = true;
              wallsHiddenMap[rt] = next;
            }
            // 门（多门数组 + 单门旧字段，两套存储互斥感知）：
            // getDoorsForRoom 的规则是「roomDoors 非空 → 只认数组、忽略旧字段；
            // 空/缺省 → 按 hasDoor 回退旧单门」。所以：
            // 1) r.doors 给了（含[]）→ 重建数组；[] 时必须同时 hasDoor=false，
            //    否则旧字段回退会让门"删不掉"。
            if (r.doors !== undefined) {
              doorsMap[rt] = r.doors
                .filter(d => ["N", "S", "W", "E"].includes(d?.wall)
                  && Number.isFinite(d.pos))
                .map(d => {
                  const style = resolveAiDoorStyle(d.style);
                  return {
                    id: `${rt}-d-${genId()}`,
                    wall: d.wall,
                    pos: Math.max(0, Math.round(d.pos)),
                    len: Math.max(60, Math.min(200, Math.round(d.len ?? 80))),
                    ...(d.h != null && Number.isFinite(d.h)
                      ? { h: Math.max(180, Math.min(240, Math.round(d.h))) } : {}),
                    ...(style ? { style } : {}),
                  };
                });
              hasDoorMap[rt] = doorsMap[rt]!.length > 0;
            }
            // 2) 单门字段：该房间已有多门数组时（渲染层忽略旧字段），改写数组
            //    第一扇门；否则照旧写旧字段。
            const newDoorStyle = resolveAiDoorStyle(r.door);
            const wantWall = r.doorWall && ["N", "S", "W", "E"].includes(r.doorWall) ? r.doorWall : undefined;
            const wantPos = r.doorPos != null && Number.isFinite(r.doorPos)
              ? Math.max(0, Math.round(r.doorPos)) : undefined;
            const wantLen = r.doorLen != null && Number.isFinite(r.doorLen)
              ? Math.max(60, Math.min(200, Math.round(r.doorLen))) : undefined;
            const doorArr = doorsMap[rt];
            if (doorArr?.length && (newDoorStyle || wantWall || wantPos !== undefined || wantLen !== undefined)) {
              doorsMap[rt] = doorArr.map((d, i) => i === 0 ? {
                ...d,
                ...(wantWall ? { wall: wantWall } : {}),
                ...(wantPos !== undefined ? { pos: wantPos } : {}),
                ...(wantLen !== undefined ? { len: wantLen } : {}),
                ...(newDoorStyle ? { style: newDoorStyle } : {}),
              } : d);
            } else {
              if (newDoorStyle) doorStyleMap[rt] = newDoorStyle;
              if (wantWall) doorWallMap[rt] = wantWall;
              if (wantPos !== undefined) doorPosMap[rt] = wantPos;
              if (wantLen !== undefined) doorLenMap[rt] = wantLen;
            }
            // 3) hasDoor=false → 旧字段关掉之外，多门数组也得清空（数组优先）。
            if (r.hasDoor != null) hasDoorMap[rt] = r.hasDoor;
            if (r.hasDoor === false && doorsMap[rt]?.length) doorsMap[rt] = [];
            // 房间形状：按当前宽深重建预设多边形；rect=清掉多边形回矩形。
            const shapePreset = resolveAiRoomShape(r.shape);
            if (shapePreset) {
              if (shapePreset === "rect") {
                delete shapesMap[rt];
              } else {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { buildShape } = require("./roomGeometry") as typeof import("./roomGeometry");
                shapesMap[rt] = buildShape(shapePreset, width, depth);
              }
            }
            // 房间外立面（玻璃幕墙/实墙/自动）。
            const extStyle = resolveAiExteriorStyle(r.exteriorStyle);
            if (extStyle) extStyleMap[rt] = extStyle;
            // 重建模式下窗户不再继承（见上方 windowsMap 初始化），这里按房间补默认窗：
            //   · 玻璃幕墙房间 → **不给窗**。整面墙本身就是窗，再叠一扇打孔窗没有物理
            //     意义，还会在立面上留下一个框（咖啡馆客厅的幽灵窗就是这么来的）。
            //   · 其余房间 → 按 ROOM_DEFS 的开窗规则生成，但**按模板给的实际尺寸**换算，
            //     而不是用 ROOM_DEFS 的默认宽深（否则 11.8m 宽的客厅会拿到按 6.8m 算的窗）。
            // 模板显式给了 r.windows 时，下面的分支会覆盖这里。
            if (!merge && windowsMap[rt] === undefined) {
              const wdef = ROOM_DEFS[rt];
              if (extStyle === "glass" || !wdef?.hasWindow || wdef.windowWall === "none") {
                windowsMap[rt] = [];
              } else {
                const ww = wdef.windowWall as "N" | "E" | "W";
                const wallLen = ww === "N" ? width : depth;
                windowsMap[rt] = [{
                  id: `${rt}-w-${genId()}`, wall: ww,
                  pos: Math.round(wallLen * 0.25), len: Math.round(wallLen * 0.45),
                }];
              }
            }
            // 改名：沿用现有图标，只换显示名。
            if (r.name && r.name.trim()) {
              renamePatch[rt] = {
                name: r.name.trim().slice(0, 12),
                icon: s.customRoomMeta[rt]?.icon ?? ROOM_DEFS[rt]?.icon ?? "🏠",
              };
            }
            // 灯光状态（开关/亮度/色温）：工程级 map，给哪个改哪个。
            if (r.lightOn != null) lightOnPatch[rt] = !!r.lightOn;
            if (r.lightBrightness != null && Number.isFinite(r.lightBrightness)) {
              lightBrightnessPatch[rt] = Math.max(0.3, Math.min(2, r.lightBrightness));
            }
            if (r.lightColor && /^#[0-9a-fA-F]{3,8}$/.test(r.lightColor.trim())) {
              lightColorPatch[rt] = r.lightColor.trim();
            }
          }
          // 删房间：从 enabled 里移除（仅增量模式有意义——重建模式本来从空开始）。
          const removeSet = new Set(
            (layoutEntry.removeRooms ?? []).filter((rr): rr is RoomType => rr in ROOM_DEFS),
          );
          const finalEnabled = removeSet.size
            ? enabled.filter(r => !removeSet.has(r))
            : enabled;
          return {
            ...existing,
            enabledRooms: finalEnabled,
            roomLayout: layoutMap,
            roomDimensions: dimsMap,
            rooms: roomsMap,
            roomWindows: windowsMap,
            roomDoors: doorsMap,
            roomDoorStyle: doorStyleMap,
            roomDoorWall: doorWallMap,
            roomDoorPos: doorPosMap,
            roomDoorLen: doorLenMap,
            roomHasDoor: hasDoorMap,
            roomShapes: shapesMap,
            roomExteriorStyle: extStyleMap,
            roomWallsHidden: wallsHiddenMap,
          };
        });

        // 天台统一化：天台层 = floorPlans[floors]，复用 setExterior 的同款逻辑。
        // 重建模式 hasRooftop 缺省=false（从零重建不能把旧天台复活），
        // 且只有增量模式才复用旧天台布局。
        const hasRooftop = design.exterior?.hasRooftop
          ?? (merge ? (s.exterior.hasRooftop ?? false) : false);
        let floorPlans = newRegularPlans;
        if (hasRooftop) {
          const existingRooftop = merge && oldHadRooftop
            ? s.floorPlans[oldRegularFloors]
            : undefined;
          floorPlans = [...newRegularPlans, existingRooftop ?? makeRooftopFloorPlan(newRegularPlans)];
        }

        // 颜色作为兜底；若指定了 canonical preset，下面 applyExteriorPreset 会覆盖成整包风格。
        const extUpdate: Partial<typeof s.exterior> = { floors, hasRooftop };
        if (design.exterior?.wallColor)  extUpdate.wallColor  = design.exterior.wallColor;
        if (design.exterior?.roofColor)  extUpdate.roofColor  = design.exterior.roofColor;
        if (design.exterior?.roofType)   extUpdate.roofStyle  = design.exterior.roofType as typeof s.exterior.roofStyle;
        if (design.exterior?.accentColor) extUpdate.accentColor = design.exterior.accentColor;
        const newWallMat = resolveAiWallMaterial(design.exterior?.wallMaterial);
        if (newWallMat) extUpdate.wallMaterial = newWallMat;
        const newFootprint = resolveAiFootprint(design.exterior?.footprintShape);
        if (newFootprint) extUpdate.footprintShape = newFootprint;
        if (design.exterior?.pilotis != null && Number.isFinite(design.exterior.pilotis)) {
          extUpdate.pilotisHeightM = Math.max(0, Math.min(4, design.exterior.pilotis));
        }
        if (design.exterior?.fence != null) extUpdate.showPerimeterFence = !!design.exterior.fence;
        // 整屋玻璃幕墙开关 → facadeSystem。punched-window=常规实墙开窗。
        if (design.exterior?.glassCurtain != null) {
          extUpdate.facadeSystem = design.exterior.glassCurtain ? "curtain-wall" : "punched-window";
        }
        // 分层外墙：解析每带材质、归一化高度占比；全带非法就不动。
        if (Array.isArray(design.exterior?.wallZones) && design.exterior.wallZones.length) {
          const zones = design.exterior.wallZones
            .map(z => ({
              material: resolveAiWallMaterial(z?.material),
              color: typeof z?.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(z.color.trim())
                ? z.color.trim() : "#CCCCCC",
              hf: Number(z?.heightFraction),
            }))
            .filter(z => z.material && Number.isFinite(z.hf) && z.hf > 0);
          const hfSum = zones.reduce((a, z) => a + z.hf, 0);
          if (zones.length && hfSum > 0) {
            extUpdate.wallZones = zones.map(z => ({
              material: z.material!, color: z.color, heightFraction: z.hf / hfSum,
            }));
          }
        }

        // 增量微调：别把用户从当前楼层/房间甩走——保留 activeFloor（夹到合法范围）。
        // 从零重建才回到一楼总览。
        const nextActiveFloor = merge
          ? Math.min(s.activeFloor, floorPlans.length - 1)
          : 0;
        set({
          exterior: { ...s.exterior, ...extUpdate },
          floorPlans,
          activeFloor: nextActiveFloor,
          ...(Object.keys(renamePatch).length
            ? { customRoomMeta: { ...s.customRoomMeta, ...renamePatch } }
            : {}),
          ...(Object.keys(lightOnPatch).length
            ? { lightsOnByRoom: { ...s.lightsOnByRoom, ...lightOnPatch } }
            : {}),
          ...(Object.keys(lightBrightnessPatch).length
            ? { lightBrightnessByRoom: { ...s.lightBrightnessByRoom, ...lightBrightnessPatch } }
            : {}),
          ...(Object.keys(lightColorPatch).length
            ? { lightColorByRoom: { ...s.lightColorByRoom, ...lightColorPatch } }
            : {}),
        });

        // （applyExteriorPreset 已提前到函数开头执行——必须先铺整包风格、
        //   再落 AI 点名的逐房材质，顺序反了会把后者冲掉。）

        // 院子：在 preset 之后处理，避免被 preset 的整套院子覆盖。
        // clear=先清空再加；否则在现有基础上追加（与 edit 模式语义一致）。
        if (design.yard) {
          const s2 = get();
          const fp0 = s2.floorPlans[0];
          if (fp0) {
            const curYp = s2.yardPlan ?? { items: [] };
            const existingItems = design.yard.clear ? [] : (curYp.items ?? []);
            // AI 给的/自动散开的落点也要避开房屋占地（大宅会盖住默认前院位）。
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { houseHalfExtentsCm, clearYardItemsOfHouse } = require("./yardAutoLayout") as typeof import("./yardAutoLayout");
            const { hw, hd } = houseHalfExtentsCm(fp0);
            // 功能分区（铺装）排在物件前面，作为其它物件的底铺。zone 也避让房屋。
            const addedZones = clearYardItemsOfHouse(resolveAiZones(design.yard.zones), hw, hd);
            const added = [
              ...addedZones,
              ...clearYardItemsOfHouse(
                resolveAiYard(design.yard.add ?? [], existingItems.length), hw, hd),
            ];
            // 小径：追加语义（clear 只清物件、不动小径，与注释口径一致）。
            const addedPaths = (design.yard.paths ?? [])
              .filter(p => Array.isArray(p?.points) && p.points.length >= 2)
              .map(p => ({
                id: `yard-path-${genId()}`,
                points: p.points
                  .filter(pt => Array.isArray(pt) && pt.length >= 2)
                  .map(pt => [Math.round(pt[0]), Math.round(pt[1])] as [number, number]),
                widthCm: Math.max(30, Math.min(300, Math.round(p.widthCm ?? 80))),
                material: resolveAiPathMaterial(p.material) ?? "stone",
              }))
              .filter(p => p.points.length >= 2);
            set(state => ({
              yardPlan: {
                ...(state.yardPlan ?? { items: [] }),
                items: [...existingItems, ...added],
                ...(addedPaths.length
                  ? { paths: [...(state.yardPlan?.paths ?? []), ...addedPaths] }
                  : {}),
              },
            }));
          }
        }

        // ── Multi-building: persist the freshly-applied design to the ACTIVE
        // building. Without this, AI-designing a secondary building (楼2/楼3)
        // only updated the top-level mirrors; a reload (which reloads from
        // buildings[activeBuilding]) would lose it — and exterior never synced
        // back for index > 0 at all. Mirror floorPlans + exterior into the
        // active building so the design round-trips on any building.
        set(state => ({
          buildings: state.buildings.map((b, i) =>
            i === state.activeBuilding
              ? { ...b, floorPlans: state.floorPlans, exterior: state.exterior }
              : b),
        }));

        // ── Multi-building GENERATION: secondary buildings (副楼/庄园). The main
        // design above is 主楼 (buildings[0]). Each spec becomes a real building
        // at (x,z) with a default interior (refine later by switching to it and
        // AI-designing). create 模式替换现有副楼；edit 模式追加。主楼始终保留。
        if (Array.isArray(design.buildings) && design.buildings.length) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { EXTERIOR_PRESETS } = require("./exteriorPresets") as typeof import("./exteriorPresets");
          const MAX_SECONDARY = 6;
          const secondaries: Building[] = design.buildings.slice(0, MAX_SECONDARY).map((spec, i) => {
            const flrs = Math.max(1, Math.min(99, Math.round(spec.floors ?? 1)));
            const presetSettings = spec.preset
              ? (EXTERIOR_PRESETS.find(p => p.id === spec.preset)?.settings ?? {})
              : {};
            const ext: ExteriorSettings = {
              ...initialExterior,
              ...presetSettings,
              ...(spec.preset ? { preset: spec.preset } : {}),
              floors: flrs,
              hasRooftop: false,
              ...(spec.wallColor ? { wallColor: spec.wallColor } : {}),
              ...(spec.roofType ? { roofStyle: spec.roofType as ExteriorSettings["roofStyle"] } : {}),
              ...(spec.glassCurtain != null
                ? { facadeSystem: (spec.glassCurtain ? "curtain-wall" : "punched-window") as ExteriorSettings["facadeSystem"] }
                : {}),
            };
            return {
              id: `bld_ai_${genId()}`,
              label: spec.label || `楼${i + 2}`,
              x: Math.round(Number.isFinite(spec.x) ? spec.x : (i + 1) * 1600),
              z: Math.round(Number.isFinite(spec.z) ? spec.z : 0),
              rot: 0,
              floorPlans: Array.from({ length: flrs }, () => makeDefaultFloorPlan()),
              exterior: ext,
            };
          });
          set(state => ({
            buildings: merge
              ? [...state.buildings, ...secondaries]
              : [state.buildings[0], ...secondaries],
          }));
        }
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
        // Floors: 不再限制最多 4 层。仅保留下限 1 与一个宽松的安全上限 99
        // （防止导入异常值或误操作造成的超大楼层数把渲染拖垮）。
        if (patch.floors !== undefined) patch = { ...patch, floors: Math.max(1, Math.min(99, patch.floors)) };
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
          floorPlans = [...regularPlans, existingRooftop ?? makeRooftopFloorPlan(regularPlans)];
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
        const PREFERRED: RoomType[] = ["living", "master", "bedroom", "kitchen", "dining", "bathroom"];
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

      setFaceLayer: (room, key, layer, value) => {
        updateFloor(get, set, fp => {
          const all = { ...(fp.roomFacadeFaces ?? {}) };
          const face = { ...(all[room]?.[key] ?? {}) };
          if (value === undefined) delete face[layer];
          else face[layer] = value;
          // Drop empty inner objects so persisted JSON stays small.
          const faceEmpty = face.wall === undefined && face.glass === undefined
            && face.frame === undefined && face.opacity === undefined;
          const roomFaces = { ...(all[room] ?? {}) };
          if (faceEmpty) delete roomFaces[key];
          else roomFaces[key] = face;
          if (Object.keys(roomFaces).length === 0) delete all[room];
          else all[room] = roomFaces;
          return { roomFacadeFaces: all };
        });
      },
      setFaceOpacity: (room, key, value) => {
        updateFloor(get, set, fp => {
          const all = { ...(fp.roomFacadeFaces ?? {}) };
          const face = { ...(all[room]?.[key] ?? {}) };
          if (value === null) delete face.opacity;
          else face.opacity = value;
          const faceEmpty = face.wall === undefined && face.glass === undefined
            && face.frame === undefined && face.opacity === undefined;
          const roomFaces = { ...(all[room] ?? {}) };
          if (faceEmpty) delete roomFaces[key];
          else roomFaces[key] = face;
          if (Object.keys(roomFaces).length === 0) delete all[room];
          else all[room] = roomFaces;
          return { roomFacadeFaces: all };
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
        updateYardFloor(get, set, yp => ({ ...yp, items: [...(yp.items ?? []), item] }));
      },
      removeYardItem: (id) => {
        updateYardFloor(get, set, yp => ({ ...yp, items: (yp.items ?? []).filter(i => i.id !== id) }));
      },
      updateYardItem: (id, patch) => {
        updateYardFloor(get, set, yp => ({
          ...yp,
          items: (yp.items ?? []).map(i => i.id === id ? { ...i, ...patch } : i),
        }));
      },

      addYardPath: (path) => {
        updateYardFloor(get, set, yp => ({ ...yp, paths: [...(yp.paths ?? []), path] }));
      },
      removeYardPath: (id) => {
        updateYardFloor(get, set, yp => ({ ...yp, paths: (yp.paths ?? []).filter(p => p.id !== id) }));
      },

      addDoor: (room, door) => {
        updateFloor(get, set, fp => {
          const cur = fp.roomDoors?.[room] ?? [];
          // 兜底生成唯一 id——外部传入缺 id 的门会导致 React 重复 key 报错
          const withId = door.id ? door : { ...door, id: `door-${genId()}` };
          return { roomDoors: { ...(fp.roomDoors ?? {}), [room]: [...cur, withId] } };
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
        budget: 350000,
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
            // 先把快照里所有楼层级字段整体并进来（roomWindows / 各门字段 /
            // roomWallsHidden / roomShapes / yardPlan 等），缺哪个就保留默认。
            // 之前只搬了 enabledRooms/layout/dimensions/rooms，导致载入 demo
            // 或分享链接时门窗/院子全退回默认（窗户跑内墙、看起来全朝内）。
            const out: FloorPlan = { ...merged, ...sfp };
            out.enabledRooms = sfp.enabledRooms ?? merged.enabledRooms;
            out.roomLayout = { ...merged.roomLayout, ...(sfp.roomLayout ?? {}) };
            out.roomDimensions = { ...merged.roomDimensions, ...(sfp.roomDimensions ?? {}) };
            out.roomWindows = { ...merged.roomWindows, ...(sfp.roomWindows ?? {}) };
            out.roomDoorPos = { ...merged.roomDoorPos, ...(sfp.roomDoorPos ?? {}) };
            out.roomDoorWall = { ...merged.roomDoorWall, ...(sfp.roomDoorWall ?? {}) };
            out.roomHasDoor = { ...merged.roomHasDoor, ...(sfp.roomHasDoor ?? {}) };
            // rooms 要并进默认（保证所有房间类型都在），快照里的覆盖默认。
            out.rooms = { ...merged.rooms };
            for (const [room, rs] of Object.entries(sfp.rooms ?? {})) {
              if (rs) out.rooms[room as RoomType] = rs as RoomState;
            }
            return out;
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
      version: PERSIST_VERSION,
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
          const STAIR_IDS = ["staircase-straight", "staircase-l-shaped", "staircase-u-shaped", "staircase-spiral"];
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
          // v5 → v6: 历史上这里给天台专属房间（休闲区/泳池/花园/吧台）补外壳
          // 家具。这些天台专属房间类型已被整体删除（天台 = 普通空楼层），故本
          // 迁移改为 no-op；旧类型的清理在 v6 → v7 进行。
          console.info("[home-designer] migrated persist v5 → v6 (no-op; rooftop room types removed)");
        }
        if (persistedVersion < 7) {
          // v6 → v7: 删除天台专属房间类型（rooftop_lounge/pool/garden/bar）。
          // 天台改成「没有顶的普通楼层」，不再有任何专属房间。把存档里残留的
          // 这些类型从 enabledRooms / rooms 里清掉，避免 ROOM_DEFS 查不到而崩。
          const DEAD: string[] = ["rooftop_lounge", "rooftop_pool", "rooftop_garden", "rooftop_bar"];
          const st = state as { floorPlans?: FloorPlan[]; activeRoom?: string };
          if (Array.isArray(st.floorPlans)) {
            st.floorPlans.forEach(fp => {
              if (Array.isArray(fp.enabledRooms)) {
                fp.enabledRooms = fp.enabledRooms.filter(r => !DEAD.includes(r as string));
              }
              if (fp.rooms) {
                for (const rt of DEAD) delete (fp.rooms as Record<string, unknown>)[rt];
              }
              if (fp.roomDimensions) { for (const rt of DEAD) delete (fp.roomDimensions as Record<string, unknown>)[rt]; }
              if (fp.roomLayout)     { for (const rt of DEAD) delete (fp.roomLayout as Record<string, unknown>)[rt]; }
            });
          }
          // activeRoom 若指向已删除的天台专属房间，回退到通用房间，避免 ROOM_DEFS 查空崩溃。
          if (st.activeRoom && DEAD.includes(st.activeRoom)) st.activeRoom = "living";
          console.info("[home-designer] migrated persist v6 → v7 (removed rooftop-only room types)");
        }
        if (persistedVersion < 9) {
          // v8 → v9: yardPlan lifted from floorPlans[0].yardPlan → top-level store field.
          // Copy existing yardPlan data so yard items survive the migration.
          const st = state as { floorPlans?: FloorPlan[]; yardPlan?: import("./types").YardPlan };
          if (!st.yardPlan && Array.isArray(st.floorPlans) && st.floorPlans[0]?.yardPlan) {
            st.yardPlan = st.floorPlans[0].yardPlan;
          }
          if (!st.yardPlan) st.yardPlan = { items: [] };
          console.info("[home-designer] migrated persist v8 → v9 (yardPlan lifted to top-level)");
        }
        if (persistedVersion < 8) {
          // v7 → v8: 给默认方案加版本戳。2026-6-16 之前的旧存档没有这个戳
          // （多是测试/半成品数据）—— 把「最新完备默认方案」(度假泳池别墅，
          // 带完整院子+门窗) 灌进去，让这些老用户也用到完备版；之后大家都带
          // defaultProjectVersion，再改默认只影响新用户、不动已有数据。
          // 注意：本迁移会覆盖所有 戳<当前 的存档（含自定义）——这是按需求
          // 「2026-6-16 之前的数据不管」的一次性升级。
          const st = state as {
            defaultProjectVersion?: number;
            floorPlans?: FloorPlan[];
            exterior?: ExteriorSettings;
            scores?: StyleScore;
          };
          if ((st.defaultProjectVersion ?? 0) < DEFAULT_PROJECT_VERSION) {
            const dp = makeDefaultProject();
            st.floorPlans = dp.floorPlans;
            st.exterior = { ...initialExterior, ...dp.exterior } as ExteriorSettings;
            st.scores = dp.scores;
            st.defaultProjectVersion = DEFAULT_PROJECT_VERSION;
            console.info("[home-designer] migrated persist v7 → v8 (re-seeded latest default project; pre-stamp save upgraded)");
          } else {
            console.info("[home-designer] persist v7 → v8 (default already current; kept user data)");
          }
        }
        return state as unknown as DesignerStore;
      },
      partialize: (state) => ({
        floorPlans: state.floorPlans,
        activeRoom: state.activeRoom,
        activeFloor: state.activeFloor,
        // 刷新后回到离开时的视图（之前没持久化 → 永远回到默认的室内装修）
        viewMode: state.viewMode,
        showCompass: state.showCompass,
        budget: state.budget,
        scores: state.scores,
        defaultProjectVersion: state.defaultProjectVersion,
        customRoomMeta: state.customRoomMeta,
        customFurniture: state.customFurniture,
        exterior: state.exterior,
        blueprint: state.blueprint,
        buildings: state.buildings,
        activeBuilding: state.activeBuilding,
        yardPlan: state.yardPlan,
      }),
      onRehydrateStorage: () => (state) => {
        // Re-register any custom furniture after hydration
        if (state?.customFurniture) {
          state.customFurniture.forEach(item => registerFurniture(item));
        }
        // Back-fill any room types added after a floor plan was first
        // persisted (e.g. "stair" added in a later release). Without this,
        // rooms[r] is undefined and any access crashes at runtime.
        // Helper: back-fill missing room types in a single FloorPlan.
        const backfillFP = (fp: FloorPlan): FloorPlan => {
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
        };
        if (state?.floorPlans) {
          state.floorPlans = state.floorPlans.map(backfillFP);
        }
        // Multi-building migration: old saves have no `buildings` field.
        // Initialise from top-level floorPlans + exterior.
        if (state && (!state.buildings || state.buildings.length === 0)) {
          state.buildings = [{
            id: "main",
            label: "主楼",
            x: 0, z: 0, rot: 0,
            floorPlans: state.floorPlans ?? [],
            exterior: state.exterior ?? { ...initialExterior },
          }];
          state.activeBuilding = 0;
        }
        // Ensure each secondary building's floorPlans are also back-filled.
        if (state?.buildings) {
          state.buildings = state.buildings.map((b: Building, i: number) => ({
            ...b,
            floorPlans: i === (state.activeBuilding ?? 0)
              ? (state.floorPlans ?? b.floorPlans)  // active building uses top-level (already backfilled)
              : b.floorPlans.map(backfillFP),
          }));
          // Sync the ACTIVE building's exterior from the top-level mirror.
          // (floorPlans already handled above.) Previously this only ran for
          // index 0, so exterior edits / AI design on a secondary building were
          // lost on reload. Generalised to whichever building is active.
          const ab = state.activeBuilding ?? 0;
          if (state.buildings[ab]) {
            state.buildings[ab].exterior = state.exterior ?? state.buildings[ab].exterior;
          }
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
