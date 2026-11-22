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
import * as THREE from "three";
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

/** 漏窗（leaky_lattice）的 8 种镂空图案（2026-11-21，doors/windows Phase B）。
 *  按 REPORT.md §2/§4：沧浪亭 108 式无一重复、拙政园复廊 25 式各异——
 *  同一面园林墙上绝不重复同一图案。图案几何由 shared/StyledWindow.tsx
 *  按名构建（ShapeGeometry 打孔，真空洞、可透光）；这里只定名录 +
 *  确定性选取，与渲染解耦，Phase D 的 lattice helper 合并时以此为准。 */
export const LEAKY_LATTICE_PATTERNS = [
  "haitang",       // 海棠花窗：四瓣海棠形孔
  "binglie",       // 冰裂纹：不规则多边形碎片孔
  "wanzi",         // 万字纹：连续回字/卍形孔
  "shizi_haitang", // 十字海棠：十字框 + 四端海棠瓣孔
  "liujiao",       // 六角：蜂窝六边形孔
  "linghua",       // 菱花：菱形孔
  "fangsheng",     // 方胜：双叠方（八角星）孔
  "ruyi",          // 如意：云头/如意形孔
] as const;
export type LeakyLatticePattern = (typeof LEAKY_LATTICE_PATTERNS)[number];

/** 稳定字符串哈希（FNV-1a），供图案选取与任何“按房间/墙确定性变化”
 *  的需求复用。同一输入永远得到同一输出，与加载顺序/随机数无关。 */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 按墙键 + 墙上序号确定性选取漏窗图案。`wallKey` 如 `"living|E"`，
 *  `indexOnWall` 是该窗在**同一面墙的漏窗中**的序号（0 起）。
 *  同一面墙上序号不同 → 图案必不同（+1 轮换），满足“不重复”规则；
 *  不同墙的 wallKey 哈希不同 → 起始图案不同。 */
export function leakyLatticePatternFor(wallKey: string, indexOnWall = 0): LeakyLatticePattern {
  const n = LEAKY_LATTICE_PATTERNS.length;
  return LEAKY_LATTICE_PATTERNS[(hashSeed(wallKey) + indexOnWall) % n];
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

// ─── 漏窗镂空图案几何（Phase B）─────────────────────────────────
// 8 种图案全部是 ExtrudeGeometry 上的真孔洞（Lattice = holes, not
// texture）——光线与颜色从孔里漏过去，网师园测试（光斑落到地上）成立。
// 约束：孔与孔不重叠、孔离板边 ≥0.06m，否则 earcut 三角化失败或板边断裂。
// 放在这里（而非 StyledWindow.tsx 内）是为了可单测：node 可直接 import
// 本模块建几何验证，不需要 DOM / React。渲染仍只由 StyledWindow 负责。
// Phase D worker 在 proceduralFurniture 里另建 lattice helper；两份实现
// 形态不同（这里是“整板打孔”，那边是“条栅拼装”），合并时以图案名录
// （LEAKY_LATTICE_PATTERNS）为准，几何实现二选一。

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function circleHole(cx: number, cy: number, r: number): THREE.Path {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

function polyHole(pts: Array<[number, number]>): THREE.Path {
  const p = new THREE.Path();
  pts.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
  p.closePath();
  return p;
}

function hexHole(cx: number, cy: number, r: number): THREE.Path {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6; // 平顶六边形
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return polyHole(pts);
}

function diamondHole(cx: number, cy: number, rx: number, ry: number): THREE.Path {
  return polyHole([[cx, cy + ry], [cx + rx, cy], [cx, cy - ry], [cx - rx, cy]]);
}

function star8Hole(cx: number, cy: number, R: number, r: number): THREE.Path {
  // 方胜：双叠方 = 八角星（外径 R、内径 r 交错 16 顶点）
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (Math.PI / 8) * i;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return polyHole(pts);
}

function swastikaHole(cx: number, cy: number, s: number): THREE.Path {
  // 万字/卍形孔：臂宽 s/3、总宽 s 的正交 12 顶点多边形
  const u = s / 3, x = cx, y = cy;
  return polyHole([
    [x - 0.5 * u, y + 1.5 * u], [x + 1.5 * u, y + 1.5 * u],
    [x + 1.5 * u, y + 0.5 * u], [x + 0.5 * u, y + 0.5 * u],
    [x + 0.5 * u, y - 0.5 * u], [x + 1.5 * u, y - 0.5 * u],
    [x + 1.5 * u, y - 1.5 * u], [x - 0.5 * u, y - 1.5 * u],
    [x - 0.5 * u, y - 0.5 * u], [x - 1.5 * u, y - 0.5 * u],
    [x - 1.5 * u, y + 0.5 * u], [x - 0.5 * u, y + 0.5 * u],
  ]);
}

/** 按图案名生成孔洞路径（局部坐标，中心为原点）。w/h 为整板尺寸。 */
export function leakyHoles(pattern: LeakyLatticePattern, w: number, h: number, seed: string): THREE.Path[] {
  const m = 0.07; // 板边留边：孔不贴边，板不断裂
  const iw = Math.max(0.2, w - m * 2), ih = Math.max(0.2, h - m * 2);
  const holes: THREE.Path[] = [];
  switch (pattern) {
    case "haitang": {
      // 海棠：四瓣圆孔 + 中心小圆（四瓣位置即十字海棠的四个端点）
      const s = Math.min(iw, ih);
      const r = s * 0.13, d = s * 0.30;
      holes.push(
        circleHole(-d, 0, r), circleHole(d, 0, r),
        circleHole(0, -d, r), circleHole(0, d, r),
        circleHole(0, 0, r * 0.6),
      );
      break;
    }
    case "binglie": {
      // 冰裂：3×4 抖动格，每格一个不规则凸五边形（种子随机，但确定性）
      const rand = mulberry32(hashSeed(`binglie|${seed}`));
      const cols = 3, rows = 4;
      const cw = iw / cols, ch = ih / rows;
      for (let ci = 0; ci < cols; ci++) {
        for (let ri = 0; ri < rows; ri++) {
          const cx = -iw / 2 + (ci + 0.5) * cw;
          const cy = -ih / 2 + (ri + 0.5) * ch;
          const pts: Array<[number, number]> = [];
          const n = 5;
          const base = rand() * Math.PI * 2;
          for (let k = 0; k < n; k++) {
            const a = base + (Math.PI * 2 * k) / n + (rand() - 0.5) * 0.5;
            const rad = Math.min(cw, ch) * 0.38 * (0.7 + 0.5 * rand());
            pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
          }
          holes.push(polyHole(pts));
        }
      }
      break;
    }
    case "wanzi": {
      // 万字：卍形孔阵列
      const cell = 0.34;
      const cols = Math.max(2, Math.floor(iw / cell));
      const rows = Math.max(2, Math.floor(ih / cell));
      const cw = iw / cols, ch = ih / rows;
      const s = Math.min(cw, ch) * 0.9;
      for (let ci = 0; ci < cols; ci++) {
        for (let ri = 0; ri < rows; ri++) {
          holes.push(swastikaHole(-iw / 2 + (ci + 0.5) * cw, -ih / 2 + (ri + 0.5) * ch, s));
        }
      }
      break;
    }
    case "shizi_haitang": {
      // 十字海棠：四端海棠瓣 + 中心方孔 + 四角小圆（十字排布）
      const s = Math.min(iw, ih);
      const r = s * 0.13, d = s * 0.30;
      holes.push(
        circleHole(-d, 0, r), circleHole(d, 0, r),
        circleHole(0, -d, r), circleHole(0, d, r),
      );
      const sq = s * 0.07;
      holes.push(polyHole([[-sq, -sq], [sq, -sq], [sq, sq], [-sq, sq]]));
      const sr = r * 0.45, sd = d * 0.7;
      holes.push(
        circleHole(-sd, -sd, sr), circleHole(sd, -sd, sr),
        circleHole(-sd, sd, sr), circleHole(sd, sd, sr),
      );
      break;
    }
    case "liujiao": {
      // 六角：蜂窝六边形孔，奇数行半格错位（出界的跳过）
      const cols = Math.max(2, Math.floor(iw / 0.30));
      const rows = Math.max(2, Math.floor(ih / 0.27));
      const cw = iw / cols, ch = ih / rows; // 按实际格数重算格宽，防溢出板边
      const r = Math.min(cw, ch) * 0.42;
      for (let ri = 0; ri < rows; ri++) {
        const off = ri % 2 === 1 ? cw / 2 : 0;
        for (let ci = 0; ci < cols; ci++) {
          const cx = -iw / 2 + (ci + 0.5) * cw + off;
          const cy = -ih / 2 + (ri + 0.5) * ch;
          if (Math.abs(cx) + r > iw / 2 - 0.01) continue;
          holes.push(hexHole(cx, cy, r));
        }
      }
      break;
    }
    case "linghua": {
      // 菱花：菱形孔阵列
      const cols = Math.max(2, Math.floor(iw / 0.26));
      const rows = Math.max(2, Math.floor(ih / 0.26));
      const cw = iw / cols, ch = ih / rows; // 按实际格数重算格宽，防溢出板边
      for (let ci = 0; ci < cols; ci++) {
        for (let ri = 0; ri < rows; ri++) {
          holes.push(diamondHole(
            -iw / 2 + (ci + 0.5) * cw, -ih / 2 + (ri + 0.5) * ch,
            cw * 0.42, ch * 0.42,
          ));
        }
      }
      break;
    }
    case "fangsheng": {
      // 方胜：八角星孔阵列
      const cols = Math.max(2, Math.floor(iw / 0.30));
      const rows = Math.max(2, Math.floor(ih / 0.30));
      const cw = iw / cols, ch = ih / rows; // 按实际格数重算格宽，防溢出板边
      const R = Math.min(cw, ch) * 0.42;
      for (let ci = 0; ci < cols; ci++) {
        for (let ri = 0; ri < rows; ri++) {
          holes.push(star8Hole(
            -iw / 2 + (ci + 0.5) * cw, -ih / 2 + (ri + 0.5) * ch, R, R * 0.5,
          ));
        }
      }
      break;
    }
    case "ruyi": {
      // 如意：每格一大一小两圆（云头 + 尾），2×3 阵列
      const cols = 2, rows = 3;
      const cw = iw / cols, ch = ih / rows;
      const big = Math.min(cw, ch) * 0.28;
      for (let ci = 0; ci < cols; ci++) {
        for (let ri = 0; ri < rows; ri++) {
          const cx = -iw / 2 + (ci + 0.5) * cw;
          const cy = -ih / 2 + (ri + 0.5) * ch;
          holes.push(circleHole(cx, cy, big));
          holes.push(circleHole(cx + big * 0.9, cy + big * 0.9, big * 0.45));
        }
      }
      break;
    }
  }
  return holes;
}

/** 漏窗整板：外框矩形 + 图案孔洞，挤出 3cm 真厚度（框有进深）。 */
export function buildLeakyLatticeGeometry(pattern: LeakyLatticePattern, w: number, h: number, seed: string): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2);
  shape.lineTo(-w / 2, h / 2);
  shape.closePath();
  shape.holes = leakyHoles(pattern, w, h, seed);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
  geo.translate(0, 0, -0.015); // 厚度居中
  return geo;
}
