/**
 * 现代玻璃幕墙别墅样板
 *
 * 设计逻辑：
 *  • 南面（前立面）= 玻璃幕墙：客厅 + 餐厅（一楼）、次卧2 + 书房（二楼）
 *  • 北面（后立面）= 混凝土 + 横向窗：卧室区保私密采光
 *  • 东西两侧 = 混凝土带竖向/横向窗
 *  • 每个房间按真实功能布置家具、门窗
 *
 * 平面图坐标系（与 computeExteriorWalls 一致）：
 *   x 向东（右），y 向南（下）。
 *   "南面" = room.y + room.depth 最大处。
 *
 * 一楼（fl0）布局 —— 总: 1300 × 800 cm
 * ┌───────────────────────────────────────────────────────┐
 * │ 卫生间 280×350 │ 楼梯 200×350 │ 健身房 420×350 │ 厨房 400×350 │  y=0–350
 * ├────────────────────────────────────────────┬──────────┤
 * │           客厅 900×450                      │餐厅 400×450│  y=350–800
 * └────────────────────────────────────────────┴──────────┘
 *  南面(y=800) → 全玻璃幕墙 ✓
 *
 * 二楼（fl1）布局 —— 总: 1300 × 800 cm
 * ┌──────────────────────────────────────────────────────┐
 * │  主卧 600×450  │  次卧 400×450  │  书房 300×450      │  y=0–450
 * ├───────┬─────────┴─────────────────┬──────────────────┤
 * │衣帽间 │  卫生间2 250×350          │次卧2 550×350  │楼梯 300×350│  y=450–800
 * └───────┴────────────────────────────┴───────────────────┘
 *  南面(y=800) → 次卧2(南窗)+书房(侧窗)
 */

import type { FloorPlan, RoomState, WindowConfig, DoorConfig, PlacedItem, MaterialItem, RoofStyle } from "./types";
import { ALL_POSSIBLE_ROOMS, DEFAULT_ROOM_LAYOUT, DEFAULT_ROOM_DIMENSIONS,
         DEFAULT_ROOM_WINDOWS, DEFAULT_ROOM_DOOR_POS,
         DEFAULT_ROOM_HAS_DOOR, DEFAULT_ROOM_DOOR_WALL } from "./store";

// ── helpers ──────────────────────────────────────────────────
let _uid = 10000;
const uid = (prefix: string) => `${prefix}-${++_uid}`;

function emptyRoomState(): RoomState {
  return { materials: {}, placedItems: [] };
}

function mat(category: MaterialItem["category"], color: string, name: string): MaterialItem {
  return { id: `m-${category}-${color.slice(1)}`, category, color, name, brand: "", price: 0, unit: "", tags: [], description: name };
}

function item(
  furnitureId: string,
  x: number, z: number,
  rotation: number,
  opts: Partial<Pick<PlacedItem, "scaleW"|"scaleD"|"scaleH"|"elevationY"|"mountCeiling">> = {}
): PlacedItem {
  return { instanceId: uid("pi"), furnitureId, x, z, rotation, ...opts };
}

function win(
  wall: "N"|"S"|"W"|"E",
  pos: number, len: number,
  h = 140, sill = 90,
  style: WindowConfig["style"] = "fixed"
): WindowConfig {
  return { id: uid("win"), wall, pos, len, h, sill, style };
}

function door(
  wall: "N"|"S"|"W"|"E",
  pos: number, len = 90, h = 210
): DoorConfig {
  return { id: uid("door"), wall, pos, len, h };
}

// ─────────────────────────────────────────────────────────────
//  一楼 Floor 0
// ─────────────────────────────────────────────────────────────

// ── 客厅 (900×450) ── 南面玻璃幕墙，北面电视墙
const livingState: RoomState = {
  materials: {
    wall:  mat("wall",  "#F2EDE5", "暖白涂料"),
    floor: mat("floor", "#C8A882", "橡木地板"),
  },
  placedItems: [
    // 沙发组 —— 面朝北墙电视
    item("sofa-leather-brown",    290, 270, 0),       // L形主沙发，中央
    item("coffee-marble-rect",    290, 190, 0),       // 大理石茶几
    item("rug-modern-gray",       290, 235, 0),       // 地毯
    // 电视柜 + 画 —— 北墙
    item("tvunit-float-white",    420,  30, 0),       // 悬浮电视柜
    item("artwork-abstract",      420,   5, 0,  { elevationY: 155 }),  // 北墙装饰画
    // 侧柜 + 植物
    item("sideboard-walnut",      830,  30, 0),       // 东侧边柜
    item("plant-monstera",        830, 360,  0),      // 龟背竹
    item("plant-rubber-tree",      50, 380,  0),      // 橡皮树
    item("plant-sansevieria",      50,  60,  0),      // 虎尾兰
    // 落地灯
    item("lamp-arc-gold",         580, 170,  0),      // 弧形金落地灯
    // 窗帘 —— 南侧玻璃幕墙
    item("curtain-modern-gray",   450, 440, 0),       // 宽幅窗帘
  ],
};

// ── 餐厅 (400×450) ── 南玻璃 + 西连厨房
const diningState: RoomState = {
  materials: {
    wall:  mat("wall",  "#F0EBE2", "暖白涂料"),
    floor: mat("floor", "#C8A882", "橡木地板"),
  },
  placedItems: [
    item("dining-oak-rect",      190, 210, 0),        // 橡木长餐桌
    item("chair-nordic-oak",      95, 210, 90),       // 餐椅×4
    item("chair-nordic-oak",     285, 210, 270),
    item("chair-nordic-oak",     190, 130, 180),
    item("chair-nordic-oak",     190, 290,   0),
    item("sideboard-modern-black", 20,  30,  0),      // 北墙边柜
    item("artwork-seurat",       190,   5,  0, { elevationY: 90 }),   // 北墙画
    item("plant-rubber-tree",    360,  60,  0),       // 绿植
    item("curtain-brown-sheer",  200, 440,  0),       // 南侧纱帘
  ],
};

// ── 厨房 (400×350) ── 北面采光窗，南接餐厅
const kitchenState: RoomState = {
  materials: {
    wall:  mat("wall",  "#FFFFFF", "白色瓷砖"),
    floor: mat("floor", "#E0E0E0", "防滑地砖"),
  },
  placedItems: [
    item("cabinet-lower-white",   130,  30, 0),       // 北墙下柜 (260×60)
    item("cabinet-upper-white",    60,  30, 0, { elevationY: 155 }),  // 北墙上柜
    item("fridge-french-door",    350,  65, 90),      // 冰箱，东北角
    item("sink-double-steel",      70,  30, 0),       // 水槽
    item("hood-side-black",        80,  28, 0, { elevationY: 155 }),  // 油烟机
    item("cabinet-lower-gray",    330, 175, 90),      // 东侧立柜
    item("plant-sansevieria",     330, 300,  0),      // 小绿植
  ],
};

// ── 卫生间 (280×350) ── 北面小窗
const bathroomState: RoomState = {
  materials: {
    wall:  mat("wall",  "#F5F5F5", "白色瓷砖"),
    floor: mat("floor", "#DCDCDC", "防滑地砖"),
  },
  placedItems: [
    item("vanity-single-white",    65,  40, 0),
    item("toilet-smart",          210,  40, 0),
    item("shower-enclosed",       210, 255, 0),
    item("mirror-cabinet",         65,   5, 0, { elevationY: 100 }),
  ],
};

// ── 楼梯间 (200×350) ── 无窗内部空间
const stairState: RoomState = emptyRoomState();

// ── 健身房 (420×350) ── 北面大窗
const gymState: RoomState = {
  materials: {
    wall:  mat("wall",  "#E8E8E8", "运动灰涂料"),
    floor: mat("floor", "#4A4A4A", "橡胶地板"),
  },
  placedItems: [
    item("bookshelf-open-white", 390, 175, 90),       // 借用书架当器材架
    item("lamp-industrial-black", 60, 175,  0),       // 落地灯
    item("rug-modern-gray",      200, 200,  0, { scaleW: 1.4 }),
    item("plant-monstera",       380,  50,  0),
  ],
};

// ─────────────────────────────────────────────────────────────
//  二楼 Floor 1
// ─────────────────────────────────────────────────────────────

// ── 主卧 (600×450) ── 北面私密大卧，背面采光
const masterState: RoomState = {
  materials: {
    wall:  mat("wall",  "#EAE4DC", "暖灰涂料"),
    floor: mat("floor", "#8B6340", "深色橡木地板"),
  },
  placedItems: [
    item("bed-leather-dark",      250,  95, 0),       // 真皮大床 (200×220)
    item("nightstand-oak",        105,  95, 0),       // 左床头柜
    item("nightstand-oak",        395,  95, 0),       // 右床头柜
    item("wardrobe-solid-walnut", 540, 225, 90),      // 东墙大衣柜
    item("dresser-nordic-white",   60, 350,  0),      // 南区梳妆台
    item("lamp-arc-gold",          80, 195,  0),      // 弧形落地灯
    item("rug-modern-gray",       270, 250,  0),      // 地毯
    item("artwork-klimt-kiss",    250,   5,  0, { elevationY: 100 }),  // 北墙挂画
    item("curtain-modern-gray",   300, 440,  0),      // 南侧遮光窗帘
    item("plant-sansevieria",     550,  50,  0),      // 虎尾兰
  ],
};

// ── 次卧 (400×450) ── 北面窗，学生/客卧
const bedroomState: RoomState = {
  materials: {
    wall:  mat("wall",  "#EEF0F5", "浅蓝白涂料"),
    floor: mat("floor", "#C8B890", "实木地板"),
  },
  placedItems: [
    item("bed-wood-nordic",  180,  90, 0),
    item("nightstand-white",  65,  90, 0),
    item("nightstand-white", 295,  90, 0),
    item("wardrobe-slide-white", 360, 225, 90),       // 东墙
    item("rug-nordic-geo",   180, 255,  0),
    item("curtain-brown-sheer", 200, 440, 0),
    item("artwork-impression", 180,  5,  0, { elevationY: 90 }),
    item("plant-sansevieria", 350,  50,  0),
  ],
};

// ── 书房 (300×450) ── 东侧采光+北窗，安静
const studyState: RoomState = {
  materials: {
    wall:  mat("wall",  "#E8E0D8", "木色涂料"),
    floor: mat("floor", "#B89060", "仿古木地板"),
  },
  placedItems: [
    item("desk-nordic-oak",       150,  55, 0),       // 北墙书桌
    item("bookshelf-solid-walnut",  20, 230, 0),      // 西墙书架
    item("bookshelf-open-white",   270, 230, 0),      // 东墙书架
    item("rug-modern-gray",        150, 300,  0),
    item("lamp-industrial-black",   80, 200,  0),
    item("artwork-kandinsky",       150,   5, 0, { elevationY: 90 }),
    item("plant-sansevieria",       265,  55,  0),
    item("fish-tank",               265, 380,  0),    // 鱼缸
  ],
};

// ── 衣帽间 (200×350) ── 主卧衣帽间
const closetState: RoomState = {
  materials: {
    wall:  mat("wall",  "#F5F0E8", "米白涂料"),
    floor: mat("floor", "#D4C0A0", "复合木地板"),
  },
  placedItems: [
    item("closet-system-white", 100,  55, 0),         // 定制衣柜系统
    item("closet-island-white", 100, 250, 0),         // 中岛柜
  ],
};

// ── 卫生间2 (250×350) ── 主浴，浴缸 + 独立淋浴
const bathroom2State: RoomState = {
  materials: {
    wall:  mat("wall",  "#F0F0F0", "哑光白瓷砖"),
    floor: mat("floor", "#D4D4D4", "防滑大理石"),
  },
  placedItems: [
    item("vanity-double-marble",  100,  45, 0),       // 双盆浴室柜
    item("toilet-wallhung",       210,  45, 0),       // 壁挂马桶
    item("bathtub-freestanding",  110, 280, 0),       // 独立浴缸
    item("shower-walkin",         210, 230, 0),       // 步入式淋浴
    item("mirror-cabinet",        100,   5, 0, { elevationY: 100 }),
  ],
};

// ── 次卧2 (550×350) ── 南面景观房，大窗户
const bedroom2State: RoomState = {
  materials: {
    wall:  mat("wall",  "#F2F0EC", "暖白涂料"),
    floor: mat("floor", "#C8A882", "浅色橡木地板"),
  },
  placedItems: [
    item("bed-fabric-beige",      220,  85, 0),       // 布艺床
    item("nightstand-white",       90,  85, 0),
    item("nightstand-white",      350,  85, 0),
    item("wardrobe-open-rack",    490, 175, 90),      // 东墙
    item("rug-nordic-geo",        220, 200,  0),
    item("artwork-vangogh",       220,   5,  0, { elevationY: 90 }),
    item("curtain-modern-gray",   220, 340,  0),      // 南面遮光帘
    item("plant-monstera",        480, 290,  0),
    item("lamp-arc-gold",          70, 180,  0),
  ],
};

// ── 楼梯间二楼 (300×350) ── 内部过渡空间
const stair2State: RoomState = emptyRoomState();

// ─────────────────────────────────────────────────────────────
//  窗户配置（真实外墙才有效，内墙被忽略）
// ─────────────────────────────────────────────────────────────

// 一楼
const fl0Windows = {
  living:   [win("S", 30, 840, 260, 10, "fixed")],   // 南面通高玻璃幕墙
  dining:   [win("S", 30, 340, 260, 10, "fixed")],   // 南面通高
  kitchen:  [win("N",  80, 240, 100, 100, "sliding")],// 北面采光推拉窗
  gym:      [win("N",  60, 300, 130,  80, "fixed")],  // 北面固定大窗
  bathroom: [],                                            // 卫生间无窗
  stair:    [],
};

// 二楼
const fl1Windows = {
  master:   [win("N",   80, 440, 160, 70, "fixed")],  // 北面私密横向大窗
  bedroom:  [win("N",   60, 280, 150, 80, "sliding")],// 北面推拉窗
  study:    [win("E",  50, 300, 220, 30, "fixed"),   // 东面通高景观窗
             win("N",   50, 200, 120, 90, "sliding")],// 北面采光
  bedroom2: [win("S",  40, 470, 180, 50, "fixed")],  // 南面景观大窗
  closet:   [],
  bathroom2:[],
  stair:    [],
};

// ─────────────────────────────────────────────────────────────
//  门配置（roomDoors 新格式，pos = 从房间X/Y起点算起的偏移）
// ─────────────────────────────────────────────────────────────

const fl0Doors: Record<string, DoorConfig[]> = {
  living:   [door("S", 340, 120, 230)],  // 主入口双开大门
  kitchen:  [door("S",  50,  90, 210)],  // 厨餐通道门
  bathroom: [door("S",  90,  80, 210)],  // 卫生间门
  gym:      [door("S", 170,  80, 210)],  // 健身房门
  stair:    [door("S",  55,  90, 210)],  // 楼梯门
};

const fl1Doors: Record<string, DoorConfig[]> = {
  master:   [door("S", 240,  90, 210)],  // 主卧门
  bedroom:  [door("S", 150,  90, 210)],  // 次卧门
  study:    [door("W",  100,  80, 210)],  // 书房门（西墙）
  closet:   [door("N",   60,  70, 210)],  // 衣帽间门（北面→主卧）
  bathroom2:[door("N",   80,  80, 210)],  // 卫浴门（北面→过道）
  bedroom2: [door("N",  200,  90, 210)],  // 次卧2门（北面）
  stair:    [door("N",  100,  90, 210)],  // 楼梯间门
};

// ─────────────────────────────────────────────────────────────
//  buildSampleFloorPlan — 拼装完整 FloorPlan 对象
// ─────────────────────────────────────────────────────────────

function buildFloorPlan(
  enabledRooms: string[],
  layout: Record<string, { x: number; y: number }>,
  dimensions: Record<string, { width: number; depth: number }>,
  roomStates: Record<string, RoomState>,
  windows: Record<string, WindowConfig[]>,
  doors: Record<string, DoorConfig[]>,
): FloorPlan {
  // Start from full defaults so all RoomType keys are present
  const allLayout = { ...DEFAULT_ROOM_LAYOUT } as Record<string, { x: number; y: number }>;
  const allDims   = { ...DEFAULT_ROOM_DIMENSIONS } as Record<string, { width: number; depth: number }>;
  const allWins   = { ...DEFAULT_ROOM_WINDOWS } as Record<string, WindowConfig[]>;
  const allRooms  = Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, emptyRoomState()])) as Record<string, RoomState>;
  const doorPosDefault = Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, 40])) as Record<string, number>;
  const hasDoorDefault = Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, true])) as Record<string, boolean>;
  const doorWallDefault = Object.fromEntries(ALL_POSSIBLE_ROOMS.map(r => [r, "S" as const])) as Record<string, "N"|"S"|"W"|"E">;

  Object.assign(allLayout, layout);
  Object.assign(allDims, dimensions);
  Object.assign(allWins, windows);
  Object.assign(allRooms, roomStates);

  return {
    rooms:         allRooms as FloorPlan["rooms"],
    enabledRooms:  enabledRooms as FloorPlan["enabledRooms"],
    roomLayout:    allLayout as FloorPlan["roomLayout"],
    roomDimensions:allDims as FloorPlan["roomDimensions"],
    roomWindows:   allWins as FloorPlan["roomWindows"],
    roomDoorPos:   doorPosDefault as FloorPlan["roomDoorPos"],
    roomHasDoor:   hasDoorDefault as FloorPlan["roomHasDoor"],
    roomDoorWall:  doorWallDefault as FloorPlan["roomDoorWall"],
    roomDoors:     doors as FloorPlan["roomDoors"],
  };
}

// ─────────────────────────────────────────────────────────────
//  公开导出
// ─────────────────────────────────────────────────────────────

export function getSampleGlassVillaFloorPlans(): FloorPlan[] {
  // 一楼
  const fl0 = buildFloorPlan(
    ["bathroom", "stair", "gym", "kitchen", "living", "dining"],
    {
      bathroom: { x: 0,    y: 0   },
      stair:    { x: 280,  y: 0   },
      gym:      { x: 480,  y: 0   },
      kitchen:  { x: 900,  y: 0   },
      living:   { x: 0,    y: 350 },
      dining:   { x: 900,  y: 350 },
    },
    {
      bathroom: { width: 280, depth: 350 },
      stair:    { width: 200, depth: 350 },
      gym:      { width: 420, depth: 350 },
      kitchen:  { width: 400, depth: 350 },
      living:   { width: 900, depth: 450 },
      dining:   { width: 400, depth: 450 },
    },
    {
      bathroom: bathroomState,
      stair:    stairState,
      gym:      gymState,
      kitchen:  kitchenState,
      living:   livingState,
      dining:   diningState,
    },
    fl0Windows,
    fl0Doors,
  );

  // 二楼
  const fl1 = buildFloorPlan(
    ["master", "bedroom", "study", "closet", "bathroom2", "bedroom2", "stair"],
    {
      master:    { x: 0,    y: 0   },
      bedroom:   { x: 600,  y: 0   },
      study:     { x: 1000, y: 0   },
      closet:    { x: 0,    y: 450 },
      bathroom2: { x: 200,  y: 450 },
      bedroom2:  { x: 450,  y: 450 },
      stair:     { x: 1000, y: 450 },
    },
    {
      master:    { width: 600, depth: 450 },
      bedroom:   { width: 400, depth: 450 },
      study:     { width: 300, depth: 450 },
      closet:    { width: 200, depth: 350 },
      bathroom2: { width: 250, depth: 350 },
      bedroom2:  { width: 550, depth: 350 },
      stair:     { width: 300, depth: 350 },
    },
    {
      master:    masterState,
      bedroom:   bedroomState,
      study:     studyState,
      closet:    closetState,
      bathroom2: bathroom2State,
      bedroom2:  bedroom2State,
      stair:     stair2State,
    },
    fl1Windows,
    fl1Doors,
  );

  return [fl0, fl1];
}

export const SAMPLE_GLASS_VILLA_EXTERIOR = {
  buildingType: "floor-plan-driven" as const,
  preset:       "modern",
  roofStyle:    "flat" as RoofStyle,
  roofColor:    "#D8D4CC",
  wallMaterial: "render",
  wallColor:    "#F0EDE8",    // 暖白混凝土
  accentColor:  "#1A1A1A",   // 深灰铝合金框
  floors:       2,
  yardPreset:   "pool",
  showPerimeterFence: false,
};
