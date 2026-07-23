/**
 * 房间窗的**唯一合成来源**。镜像 `lib/roomDoors.ts` 的 getRoomDoors。
 *
 * 背景（2026-07 一致性审计）：门列表早已收敛到 `getRoomDoors()`，窗却没有对应的
 * 唯一真源——每个视图各自 `w.sill ?? 90` / `w.h ?? 150` / `win.style ?? …` 地
 * 现补默认值，且默认值在各处分叉：
 *
 *   · 窗高默认   效果图用 `Math.min(H*52,150)`（随房高缩放）vs 外观图/2D 一律 150
 *   · 窗台/窗高  外观图读 exterior.defaultWindowSill/Height，效果图/2D 却硬编码 90/150
 *   · 窗款式     幕墙→awning、实墙→sliding 的推导只有外观图有，其余视图一律 sliding
 *
 * 与门不同：窗**没有**旧版单窗字段（roomWindows 是唯一存储），所以合成只有一层——
 * `roomWindows[room]` 显式数组，逐窗 normalizeWindow 补全。**所有视图渲染时都应
 * 走这里，不要再手写 `?? 90` / `?? 150` / `?? style`。**
 */
import type { FloorPlan, RoomType, WallSide, WindowConfig, WindowStyle } from "./types";

/** 窗台默认高度（cm，地面到窗底）。统一取 90（= 三处历史值）。 */
export function defaultWindowSillCm(defaultSillCm?: number): number {
  return defaultSillCm ?? 90;
}

/** 窗洞默认高度（cm，竖直方向）。统一取 150。
 *  效果图原来用 `Math.min(H*52,150)` 随房高缩放，是三处里的少数派——去掉缩放，
 *  与外观图/2D 的固定 150 对齐，避免同一扇窗在不同视图里高度不同。 */
export function defaultWindowHCm(defaultHeightCm?: number): number {
  return defaultHeightCm ?? 150;
}

/** 窗款式默认值。幕墙体系→上悬窗（awning，幕墙通风扇常见）；实墙→推拉窗（sliding）。
 *  这是外观图 FloorPlanExterior.tsx:8152 现行的推导，幕墙 vs 实墙的分叉是有意的，
 *  不要强行统一成单一款式。 */
export function defaultWindowStyle(curtainWall: boolean): WindowStyle {
  return curtainWall ? "awning" : "sliding";
}

/** 把一扇窗补全为"各字段都已定值"的形态，供所有视图直接渲染。 */
export function normalizeWindow(
  win: WindowConfig,
  curtainWall: boolean,
  defaultSillCm?: number,
  defaultHeightCm?: number,
): WindowConfig {
  return {
    ...win,
    sill:  win.sill  ?? defaultWindowSillCm(defaultSillCm),
    h:     win.h     ?? defaultWindowHCm(defaultHeightCm),
    style: win.style ?? defaultWindowStyle(curtainWall),
    // edgeIndex 原样透传（多边形房间的边绑定），不改。
  };
}

export interface GetRoomWindowsOpts {
  /** exterior.defaultWindowSill —— 全局默认窗台高（cm）。 */
  defaultSillCm?: number;
  /** exterior.defaultWindowHeight —— 全局默认窗高（cm）。 */
  defaultHeightCm?: number;
  /** 是否幕墙体系（决定 awning vs sliding 默认款式）。 */
  curtainWall?: boolean;
  /** 房间开间/进深（cm）。目前窗默认值不依赖墙长，保留以对齐 getRoomDoors 的签名，
   *  也便于将来加"墙长封顶"之类的默认逻辑。 */
  widthCm?: number;
  depthCm?: number;
  /**
   * 外接矩形投影。**只有仍按"外接矩形四面"工作的消费者**才传这个：把沿边坐标
   * 折算成外框坐标，否则 L/凸字形房间内凹边上的窗会跑到外框上。
   *
   * 现状：外观图/2D/效果图都已原生消费 edgeIndex（沿边基准），无人传 rectProject。
   * 折算是有损的（凹角被压回外框），能不用就不用——与 getRoomDoors 完全一致。
   */
  rectProject?: (win: WindowConfig) => { wall: WallSide; pos: number } | null;
}

/**
 * 合成某房间的最终窗列表。窗只有一个来源：`roomWindows[room]` 显式数组
 * （不像门还有旧版单门字段）。逐窗 normalizeWindow 补全 sill/h/style。
 * `fp` 未定义时返回空数组。
 */
export function getRoomWindows(
  fp: (Pick<FloorPlan, "roomWindows">
      & Partial<Pick<FloorPlan, "roomDimensions">>) | undefined,
  room: RoomType,
  opts: GetRoomWindowsOpts = {},
): WindowConfig[] {
  if (!fp) return [];
  const curtainWall = opts.curtainWall ?? false;
  const norm = (w: WindowConfig) => {
    const n = normalizeWindow(w, curtainWall, opts.defaultSillCm, opts.defaultHeightCm);
    // edgeIndex → 外框坐标折算（只有仍按外接矩形工作的消费者会传 rectProject）。
    // 折算失败（多边形被改过、edgeIndex 失效）时保留原值，不至于让窗消失。
    if (n.edgeIndex != null && opts.rectProject) {
      const m = opts.rectProject(n);
      if (m) return { ...n, wall: m.wall, pos: m.pos, edgeIndex: undefined };
    }
    return n;
  };
  const wins = fp.roomWindows?.[room] ?? [];
  return wins.map(norm);
}
