/**
 * 房间门的**唯一合成来源**。
 *
 * 背景（2026-07 一致性审计）：门列表的合成逻辑原来在四个地方各手写了一遍——
 * `FloorPlan.tsx`、`RoomCanvas.tsx`、`FloorPlanExterior.tsx`、`HouseCanvas.tsx`
 * （最后一个的注释里明写着 "Mirror FloorPlanExterior.pickAutoDoor"）。
 * 四份镜像各自漂移，导致同一扇门在不同视图里尺寸/款式/位置都不同：
 *
 *   · 门高默认   2D/效果图 240  vs  外观图 200        （差 40cm）
 *   · 车库门     效果图退化成 80cm 实木门，外观图是 340cm 卷帘门
 *   · 车库门位置 外观图无条件强制居中，忽略用户拖动
 *   · 幕墙玻璃门 只有 2D 和外观图会推导 glass_swing，效果图一律实木
 *
 * `types.ts` 里 FloorPlan.roomDoors 的注释早就提到应该有个 `getRoomDoors()`，
 * 但这个函数一直不存在。本文件就是它。**所有视图必须走这里，不要再手写。**
 *
 * 自动门（pickAutoDoor）需要房间在整栋楼里的几何位置，只有外观图/全屋3D 算得出，
 * 因此通过 `autoDoor` 回调注入，而不是塞进本模块。
 */
import type { DoorConfig, DoorStyle, FloorPlan, RoomType, WallSide } from "./types";
import { resolveFacadeLayer } from "./types";

/** 循环空间（楼梯间/走廊）不生成自动门——它们靠开口连通，不是独立房间。 */
export const CIRCULATION_ROOMS: ReadonlySet<string> = new Set(["stair", "hallway"]);

/** 某面墙的长度（cm）。W/E 面沿进深，N/S 面沿开间。 */
export function wallLenCmOf(wall: WallSide, widthCm: number, depthCm: number): number {
  return (wall === "W" || wall === "E") ? depthCm : widthCm;
}

/** 门洞默认宽度（cm）。
 *  车库要一整扇宽卷帘门（墙长-40，封顶 340）才撑得满门洞、并触发卷帘门渲染阈值；
 *  统一取 340 是因为原来 FPE 的 defaultDoorLenCm 给 300、随后 widenGarageDoor 又
 *  拉到 340，实际生效值一直是 340——这里直接写成生效值，去掉那一层自相矛盾。 */
export function defaultDoorLenCm(room: RoomType, wallLenCm: number): number {
  if (room === "garage") return Math.max(240, Math.min(wallLenCm - 40, 340));
  return 80;
}

/** 门洞默认高度（cm）。
 *  统一取 240（= 2D 平面图与效果图原有值）；外观图原来用 200 是三处里的少数派，
 *  且比另两处矮 40cm，肉眼可见。车库门更高，210。 */
export function defaultDoorHCm(room: RoomType, interiorDoorHeightCm?: number): number {
  if (room === "garage") return 210;
  return interiorDoorHeightCm ?? 240;
}

/** 门款式默认值。车库→卷帘门；门所在墙是玻璃幕墙面→玻璃平开门；其余实木。 */
export function defaultDoorStyle(
  fp: Parameters<typeof resolveFacadeLayer>[0],
  room: RoomType, wall: WallSide, curtainWall: boolean,
): DoorStyle {
  if (room === "garage") return "roller_shutter";
  // 该墙的实墙层不显示 = 这面是玻璃幕墙 → 门也应是玻璃门，否则实木门板嵌在幕墙上很怪
  if (curtainWall && !resolveFacadeLayer(fp, room, wall, "wall", curtainWall)) return "glass_swing";
  return "wood_panel";
}

/** 把一扇门补全为"各字段都已定值"的形态，供所有视图直接渲染。 */
export function normalizeDoor(
  door: DoorConfig,
  room: RoomType,
  widthCm: number, depthCm: number,
  fp: Parameters<typeof resolveFacadeLayer>[0],
  curtainWall: boolean,
  interiorDoorHeightCm?: number,
  /** pos 未给时是否居中。旧版单门沿用历史的 0（改成居中会挪动既有项目里的门）；
   *  自动门/车库门居中。 */
  centerIfUnset = false,
): DoorConfig {
  const wallLen = wallLenCmOf(door.wall, widthCm, depthCm);
  const len = door.len ?? defaultDoorLenCm(room, wallLen);
  return {
    ...door,
    len,
    // pos 只在**用户没给**时才回落。原来 FPE 的 widenGarageDoor 无条件覆盖
    // pos=(wallLen-len)/2，把用户拖好的车库门位置直接吃掉了。
    pos: door.pos ?? ((centerIfUnset || room === "garage") ? Math.max(5, (wallLen - len) / 2) : 0),
    h: door.h ?? defaultDoorHCm(room, interiorDoorHeightCm),
    style: door.style ?? defaultDoorStyle(fp, room, door.wall, curtainWall),
  };
}

export interface GetRoomDoorsOpts {
  /** exterior.interiorDoorHeightCm —— 全局内门高。 */
  interiorDoorHeightCm?: number;
  /** 是否幕墙体系（决定玻璃门推导）。 */
  curtainWall?: boolean;
  /** 房间开间/进深（cm）。缺省时车库/居中类默认值会退化，但不会崩。 */
  widthCm?: number;
  depthCm?: number;
  /** 自动门回调：仅外观图/全屋3D 有足够几何信息实现。返回 null 表示不生成。 */
  autoDoor?: () => DoorConfig | null;
  /**
   * 外接矩形投影。**只有仍按"外接矩形四面"工作的消费者**才传这个：把沿边坐标
   * 折算成外框坐标，否则 L/凸字形房间内凹边上的门会跑到外框上。
   *
   * 现状：只剩 `HouseCanvas` 的**漫游碰撞墙**在用（那条路径仍是 AABB 墙）。
   * 外观图 FloorPlanExterior 已经改成按每条轴对齐边展开成面、原生消费 edgeIndex，
   * 不再折算；2D 平面图和室内效果图本来就原生支持沿边基准。
   * 折算是有损的（凹角被压回外框），能不用就不用。
   */
  rectProject?: (door: DoorConfig) => { wall: WallSide; pos: number } | null;
}

/**
 * 合成某房间的最终门列表。优先级（四视图统一）：
 *   1. `roomDoors[room]` 显式数组
 *   2. 旧版单门字段 `roomDoorWall/Pos/Len/H/Style/EdgeIdx`
 *   3. `autoDoor()` 自动门（仅在调用方提供时）
 * `roomHasDoor === false` 时一律返回空数组。
 */
export function getRoomDoors(
  fp: (Pick<FloorPlan, "roomDoors" | "roomHasDoor" | "roomDoorWall" | "roomDoorPos"
      | "roomDoorLen" | "roomDoorH" | "roomDoorStyle" | "roomDoorEdgeIdx"
      | "roomFacadeFaces" | "roomWallsHidden" | "roomExteriorStyle">
      & Partial<Pick<FloorPlan, "enabledRooms" | "roomLayout" | "roomDimensions">>) | undefined,
  room: RoomType,
  opts: GetRoomDoorsOpts = {},
): DoorConfig[] {
  if (!fp) return [];
  const curtainWall = opts.curtainWall ?? false;
  const widthCm = opts.widthCm ?? fp.roomDimensions?.[room]?.width ?? 400;
  const depthCm = opts.depthCm ?? fp.roomDimensions?.[room]?.depth ?? 300;
  const norm = (d: DoorConfig, centerIfUnset = false) => {
    const n = normalizeDoor(d, room, widthCm, depthCm, fp, curtainWall,
                            opts.interiorDoorHeightCm, centerIfUnset);
    // edgeIndex → 外框坐标折算（只有外观图/全屋3D 会传 rectProject）。
    // 折算失败（多边形被改过、edgeIndex 失效）时保留原值，不至于让门消失。
    if (n.edgeIndex != null && opts.rectProject) {
      const m = opts.rectProject(n);
      if (m) return { ...n, wall: m.wall, pos: m.pos, edgeIndex: undefined };
    }
    return n;
  };

  // 1. 显式多门数组
  const explicit = fp.roomDoors?.[room];
  if (explicit && explicit.length > 0) return explicit.map(d => norm(d));

  if (fp.roomHasDoor?.[room] === false) return [];

  // 2. 旧版单门字段
  const legacyWall = fp.roomDoorWall?.[room];
  if (legacyWall) {
    return [norm({
      id: `${room}-legacy-door`,
      wall: legacyWall as WallSide,
      pos: fp.roomDoorPos?.[room] as number,
      len: fp.roomDoorLen?.[room] as number,
      h: fp.roomDoorH?.[room],
      style: fp.roomDoorStyle?.[room],
      edgeIndex: fp.roomDoorEdgeIdx?.[room],
    })];
  }

  // 3. 自动门
  const auto = opts.autoDoor?.();
  return auto ? [norm(auto, true)] : [];
}
