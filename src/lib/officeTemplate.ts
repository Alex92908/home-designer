/**
 * officeTemplate.ts — 办公室片场模板的「数据驱动」构建。
 *
 * 单一事实来源 = src/data/templates/office-snapshot.json（用户从 app「导入/导出」
 * 导出的完整方案，top-left 坐标）。本模块从快照生成两样交给 OFFICE_SET 用的东西：
 *   1. OFFICE_ROOMS —— floorLayouts[0].rooms（房间几何：位置归一到 living=(0,0)，
 *      轮廓/门/窗/隐藏墙直接取自快照）。
 *   2. OFFICE_FURNITURE_OVERRIDES —— furnitureOverrides（家具，top-left→center，
 *      与 ExportModal/defaultProject 同源转换）。
 *
 * 好处：用户在 app 里改了布局/家具后，只需用新导出**替换 office-snapshot.json**，
 * 房间几何与家具全部自动跟着更新，无需再手改 projectTemplates.ts、也不会漏项。
 * 房名/图标/顺序/走廊隐藏这类"模板元数据"（导出里没有）维护在下面的 ROOM_META。
 */
import type { RoomType } from "./types";
import type { RoomShape } from "./roomGeometry";
import type { LayoutTemplateRoom } from "./floorplanLayouts";
import type { TemplatePlacedItem } from "./projectTemplates";
import { getFurnitureById } from "./furniture";
import rawOfficeSnapshot from "@/data/templates/office-snapshot.json";

const WALLS = ["N", "S", "E", "W"] as const;
type Wall = (typeof WALLS)[number];

/** 模板元数据：房间显示名/图标/切换栏顺序（数组序）/走廊隐藏。导出快照里没有这些，
 *  故手工维护；房名或房间增减时才动它（极少）。几何与家具全部来自快照。 */
const ROOM_META: Array<{ room: RoomType; name: string; nameEn: string; icon: string; hideFromSwitcher?: boolean }> = [
  { room: "living",         name: "大厅",       nameEn: "Open Office",        icon: "🏛️" },
  { room: "dining",         name: "会议室",     nameEn: "Meeting Room",       icon: "📊" },
  { room: "master",         name: "独立办公室", nameEn: "Private Office",     icon: "💼" },
  { room: "kitchen",        name: "茶水间",     nameEn: "Tea Room",           icon: "☕" },
  { room: "hallway",        name: "走廊",       nameEn: "Corridor",           icon: "🚶", hideFromSwitcher: true },
  { room: "custom2",        name: "小会议室",   nameEn: "Small Meeting Room", icon: "💬" },
  { room: "equipment_room", name: "机房",       nameEn: "Server Room",        icon: "🖧" },
  { room: "closet",         name: "洽谈室",     nameEn: "Meeting Room",       icon: "💬" },
  { room: "bathroom",       name: "男洗手间",   nameEn: "Men's Room",         icon: "🚹" },
  { room: "bathroom2",      name: "女洗手间",   nameEn: "Women's Room",       icon: "🚺" },
];

type RawItem = {
  furnitureId: string; x: number; z: number;
  rotation?: number; scaleW?: number; scaleD?: number; scaleH?: number;
  elevationY?: number; mountCeiling?: boolean; mirrorX?: boolean; mirrorZ?: boolean; label?: string;
};
type RawSnapshot = {
  floorPlans: Array<{
    rooms: Record<string, { placedItems?: RawItem[] }>;
    roomLayout: Record<string, { x: number; y: number }>;
    roomDimensions: Record<string, { width: number; depth: number }>;
    roomShapes?: Record<string, RoomShape>;
    roomDoors?: Record<string, Array<{ wall: Wall; pos: number; len: number; style?: string; h?: number }>>;
    roomWindows?: Record<string, Array<{ wall: Wall; pos: number; len: number; h?: number; sill?: number; style?: string; edgeIndex?: number }>>;
    roomWallsHidden?: Record<string, Partial<Record<Wall, boolean>>>;
  }>;
};

const snap = (rawOfficeSnapshot as unknown as RawSnapshot).floorPlans[0];
const origin = snap.roomLayout.living ?? { x: 0, y: 0 }; // 归一化，令 living=(0,0)

function buildRooms(): LayoutTemplateRoom[] {
  const rooms: LayoutTemplateRoom[] = [];
  for (const meta of ROOM_META) {
    const r = meta.room;
    const pos = snap.roomLayout[r];
    const dim = snap.roomDimensions[r];
    if (!pos || !dim) continue;
    const room: LayoutTemplateRoom = {
      room: r,
      x: Math.round(pos.x - origin.x),
      y: Math.round(pos.y - origin.y),
      width: dim.width,
      depth: dim.depth,
      name: meta.name,
      nameEn: meta.nameEn,
      icon: meta.icon,
    };
    if (meta.hideFromSwitcher) room.hideFromSwitcher = true;
    // 轮廓：只带非矩形（custom，如大厅回字外框）。矩形是默认，省略。
    const shape = snap.roomShapes?.[r];
    if (shape && shape.preset === "custom") room.shape = shape;
    // 门（快照带 id，模板类型不需要，剔除）
    const doors = snap.roomDoors?.[r];
    if (doors?.length) {
      room.doors = doors.map(d => ({
        wall: d.wall, pos: d.pos, len: d.len,
        ...(d.style ? { style: d.style as NonNullable<LayoutTemplateRoom["doors"]>[number]["style"] } : {}),
        ...(d.h != null ? { h: d.h } : {}),
      }));
    }
    // 窗（同上剔 id）
    const wins = snap.roomWindows?.[r];
    if (wins?.length) {
      room.windows = wins.map(w => ({
        wall: w.wall, pos: w.pos, len: w.len,
        ...(w.h != null ? { h: w.h } : {}),
        ...(w.sill != null ? { sill: w.sill } : {}),
        ...(w.style ? { style: w.style as NonNullable<LayoutTemplateRoom["windows"]>[number]["style"] } : {}),
        ...(w.edgeIndex != null ? { edgeIndex: w.edgeIndex } : {}),
      }));
    }
    // 隐藏墙（开放式/走廊两端）
    const hidden = snap.roomWallsHidden?.[r];
    if (hidden) {
      const walls = WALLS.filter(w => hidden[w]);
      if (walls.length) room.wallsHidden = walls;
    }
    rooms.push(room);
  }
  return rooms;
}

// top-left 角 → 中心：x += halfWidth, z += halfDepth（按家具尺寸×缩放，同 ExportModal/defaultProject）。
function buildFurnitureOverrides(): Partial<Record<RoomType, TemplatePlacedItem[]>> {
  const out: Partial<Record<RoomType, TemplatePlacedItem[]>> = {};
  for (const [rid, rs] of Object.entries(snap.rooms)) {
    const items = rs.placedItems ?? [];
    if (!items.length) continue;
    out[rid as RoomType] = items.map(p => {
      const f = getFurnitureById(p.furnitureId);
      const hw = f ? (f.width * (p.scaleW ?? 1)) / 2 : 0;
      const hd = f ? (f.depth * (p.scaleD ?? 1)) / 2 : 0;
      const it: TemplatePlacedItem = { furnitureId: p.furnitureId, x: p.x + hw, z: p.z + hd };
      if (p.rotation) it.rotation = p.rotation;
      if (p.scaleW != null && p.scaleW !== 1) it.scaleW = p.scaleW;
      if (p.scaleD != null && p.scaleD !== 1) it.scaleD = p.scaleD;
      if (p.scaleH != null && p.scaleH !== 1) it.scaleH = p.scaleH;
      if (p.elevationY) it.elevationY = p.elevationY;
      if (p.mountCeiling) it.mountCeiling = true;
      if (p.mirrorX) it.mirrorX = true;
      if (p.mirrorZ) it.mirrorZ = true;
      if (p.label != null) it.label = p.label;
      return it;
    });
  }
  return out;
}

/** floorLayouts[0].rooms —— 数据驱动生成的办公室房间几何。 */
export const OFFICE_ROOMS: LayoutTemplateRoom[] = buildRooms();

/** furnitureOverrides —— 单层，room-local 中心坐标。 */
export const OFFICE_FURNITURE_OVERRIDES: Array<Partial<Record<RoomType, TemplatePlacedItem[]>>> = [buildFurnitureOverrides()];
