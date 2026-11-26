/**
 * 漏窗镂空图案几何（原 roomWindows.ts Phase B 整块移出）。
 *
 * 本模块是 roomWindows.ts 的 three 依赖部分：只有 3D 渲染
 * （StyledWindow）需要它；2D 入口（FloorPlan 等）只 import
 * 纯数据的 ./roomWindows，不要 import 这里，否则 three 会重
 * 新漏进首屏包。
 */
import * as THREE from "three";
import { hashSeed, type LeakyLatticePattern } from "./roomWindows";

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
