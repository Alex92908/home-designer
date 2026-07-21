/**
 * Layout-only templates — only positions / dimensions / shapes, NO
 * materials or furniture. Applying one clears the current floor's
 * enabled rooms and replaces them with the template's room set.
 *
 * Used by FloorPlanAll's "📋 户型" picker.
 *
 * Coords: cm, origin = floor's back-left corner (same convention as
 * roomLayout). `shape.points` are in room-local cm (origin = room
 * back-left).
 */
import type { RoomType } from "./types";
import type { RoomShape } from "./roomGeometry";

export interface LayoutTemplateRoom {
  room: RoomType;
  x: number;           // cm
  y: number;
  width: number;       // cm
  depth: number;
  shape?: RoomShape;
  /** 需要隐藏的墙面（开放式/骑楼露天区，如咖啡馆沿街走廊）。
   *  applyProjectTemplate 会写进 roomWallsHidden。 */
  wallsHidden?: Array<"N" | "S" | "E" | "W">;
  /** 本房间外立面：glass=玻璃幕墙 / concrete=实墙。卫生间、厨房库房等
   *  隐私/后场房间应显式给 concrete。applyProjectTemplate 写进
   *  roomExteriorStyle（styleTemplate 应用后生效，不被其覆盖）。 */
  exteriorStyle?: "glass" | "concrete" | "auto";
  /** 显式门（如临街大门加宽双开）。applyProjectTemplate 写进 roomDoors。 */
  doors?: Array<{ wall: "N" | "S" | "E" | "W"; pos: number; len: number;
    style?: import("./types").DoorStyle; h?: number }>;
  /** 显式窗。applyProjectTemplate 写进 roomWindows。多边形房间的窗用 edgeIndex
   *  绑定到具体那条边（pos = 从边起点沿边偏移 cm），否则按外接矩形四面定位。 */
  windows?: Array<{ wall: "N" | "S" | "E" | "W"; pos: number; len: number;
    h?: number; sill?: number; style?: import("./types").WindowStyle; edgeIndex?: number }>;
  /** 外墙装饰——店招/壁画/壁灯等，写进 RoomState.exteriorDecor。 */
  wallDecor?: Array<{ furnitureId: string; wall: "N" | "S" | "E" | "W";
    u: number; v: number; scaleW?: number; scaleH?: number; label?: string }>;
}

export interface FloorplanLayout {
  id: string;
  name: string;
  area: number;        // ㎡, display only
  rooms: LayoutTemplateRoom[];
}

// All templates fit inside ~1200×1200 cm (12×12 m) bbox, with some padding.
// Rooms are axis-aligned (preset "rect") unless noted.

export const FLOORPLAN_LAYOUTS: FloorplanLayout[] = [
  {
    id: "studio-45",
    name: "一居室 45㎡",
    area: 45,
    rooms: [
      { room: "living",    x: 0,    y: 0,    width: 480, depth: 460 },
      { room: "kitchen",   x: 0,    y: 460,  width: 300, depth: 240 },
      { room: "bathroom",  x: 300,  y: 460,  width: 180, depth: 240 },
    ],
  },
  {
    id: "2br-south-north-85",
    name: "两居南北通透 85㎡",
    area: 85,
    rooms: [
      { room: "living",   x: 0,    y: 220,  width: 440, depth: 440 },
      { room: "kitchen",  x: 440,  y: 220,  width: 260, depth: 220 },
      { room: "bathroom", x: 440,  y: 440,  width: 260, depth: 220 },
      { room: "master",   x: 0,    y: 0,    width: 380, depth: 220 },
      { room: "bedroom",  x: 380,  y: 0,    width: 320, depth: 220 },
      { room: "balcony",  x: 0,    y: 660,  width: 700, depth: 140 },
    ],
  },
  {
    id: "3br-2lr-110",
    name: "三居两厅 110㎡",
    area: 110,
    rooms: [
      { room: "living",   x: 200,  y: 260,  width: 500, depth: 420 },
      { room: "dining",   x: 0,    y: 260,  width: 200, depth: 300 },
      { room: "kitchen",  x: 0,    y: 0,    width: 280, depth: 260 },
      { room: "bathroom", x: 280,  y: 0,    width: 200, depth: 260 },
      { room: "master",   x: 480,  y: 0,    width: 380, depth: 260 },
      { room: "bedroom",  x: 700,  y: 260,  width: 280, depth: 240 },
      { room: "bedroom2", x: 700,  y: 500,  width: 280, depth: 180 },
      { room: "balcony",  x: 200,  y: 680,  width: 500, depth: 120 },
    ],
  },
  {
    id: "l-shaped-living-95",
    name: "L 型客厅两居 95㎡",
    area: 95,
    rooms: [
      {
        room: "living", x: 0, y: 200, width: 600, depth: 500,
        shape: {
          preset: "l-shape",
          // L 型：右下角缺 40%×40%
          points: [
            [0, 0], [600, 0], [600, 300], [360, 300], [360, 500], [0, 500],
          ],
        },
      },
      { room: "kitchen",  x: 360, y: 500, width: 240, depth: 200 },
      { room: "master",   x: 0,   y: 0,   width: 340, depth: 200 },
      { room: "bedroom",  x: 340, y: 0,   width: 260, depth: 200 },
      { room: "bathroom", x: 600, y: 0,   width: 200, depth: 300 },
    ],
  },
  {
    id: "big-flat-with-study-150",
    name: "大平层带书房 150㎡",
    area: 150,
    rooms: [
      { room: "living",   x: 260,  y: 300,  width: 600, depth: 480 },
      { room: "dining",   x: 0,    y: 300,  width: 260, depth: 340 },
      { room: "kitchen",  x: 0,    y: 0,    width: 340, depth: 300 },
      { room: "bathroom", x: 340,  y: 0,    width: 220, depth: 300 },
      { room: "bathroom2",x: 860,  y: 300,  width: 200, depth: 240 },
      { room: "master",   x: 560,  y: 0,    width: 500, depth: 300 },
      { room: "closet",   x: 860,  y: 540,  width: 200, depth: 240 },
      { room: "bedroom",  x: 0,    y: 640,  width: 260, depth: 240 },
      { room: "study",    x: 0,    y: 880,  width: 260, depth: 200 },
      { room: "balcony",  x: 260,  y: 780,  width: 800, depth: 140 },
    ],
  },

  // ── 多层别墅专用楼层模版（含中央走廊）────────────────────────────────────
  // 约定：楼梯间统一放在 x=800，确保多层对齐后开口位置一致
  {
    id: "villa-floor1-corridor",
    name: "别墅一楼（带走廊）",
    area: 82,
    rooms: [
      // 北区（后方服务区）y = 0 → 280
      { room: "kitchen",  x: 0,   y: 0,   width: 360, depth: 280 },
      { room: "bathroom", x: 360, y: 0,   width: 200, depth: 280 },
      { room: "dining",   x: 560, y: 0,   width: 240, depth: 280 },
      { room: "stair",    x: 800, y: 0,   width: 200, depth: 280 },
      // 中央走廊 y = 280 → 400（120 cm）
      { room: "hallway",  x: 0,   y: 280, width: 1000, depth: 120 },
      // 南区（前方公共区）y = 400 → 820
      { room: "living",   x: 0,   y: 400, width: 600, depth: 420 },
      { room: "study",    x: 600, y: 400, width: 400, depth: 420 },
    ],
  },
  {
    id: "villa-floor2-corridor",
    name: "别墅二楼（带走廊）",
    area: 70,
    rooms: [
      // 北区（主卧套间）y = 0 → 300
      { room: "master",    x: 0,   y: 0,   width: 400, depth: 300 },
      { room: "closet",    x: 400, y: 0,   width: 200, depth: 300 },
      { room: "bathroom2", x: 600, y: 0,   width: 200, depth: 300 },
      { room: "stair",     x: 800, y: 0,   width: 200, depth: 300 },  // 同一楼梯位 x=800
      // 中央走廊 y = 300 → 420
      { room: "hallway",   x: 0,   y: 300, width: 1000, depth: 120 },
      // 南区（次卧区）y = 420 → 720
      { room: "bedroom",   x: 0,   y: 420, width: 340, depth: 300 },
      { room: "bedroom2",  x: 340, y: 420, width: 330, depth: 300 },
      { room: "bedroom3",  x: 670, y: 420, width: 330, depth: 300 },
    ],
  },
  {
    id: "villa-floor3-corridor",
    name: "别墅三楼（带走廊）",
    area: 55,
    rooms: [
      // 北区 y = 0 → 280
      { room: "bathroom",  x: 0,   y: 0,   width: 260, depth: 280 },
      { room: "study2",    x: 260, y: 0,   width: 280, depth: 280 },
      { room: "gym",       x: 540, y: 0,   width: 260, depth: 280 },
      { room: "stair",     x: 800, y: 0,   width: 200, depth: 280 },  // 同一楼梯位 x=800
      // 中央走廊
      { room: "hallway",   x: 0,   y: 280, width: 1000, depth: 120 },
      // 南区（休闲/娱乐区）
      { room: "cinema",    x: 0,   y: 400, width: 500, depth: 380 },
      { room: "bedroom3",  x: 500, y: 400, width: 500, depth: 380 },
    ],
  },
];
