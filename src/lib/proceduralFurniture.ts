/**
 * proceduralFurniture.ts — 程序化时代家具（导演台 12 个新场景）。
 *
 * 为什么是程序化而不是 GLB：时代家具（汉榻/案/几、胡床、蒙古包、干栏屋、
 * 半地穴屋、博古架、榻榻米/床の間、温突地板、镜墙/水晶灯……）在现有 587 件
 * 目录里没有对应模型；Sketchfab/NVIDIA 的可用模型要么许可证不清、要么尺寸
 * 不合、要么下载链路不可靠。程序化几何零许可风险、零下载、离线可用，且与
 * RoomCanvas 已有的程序化盒子回退（FurnitureMesh）是同一路数。
 *
 * 结构（刻意与现有家具系统解耦、只加不改）：
 *   • 本文件是纯 three.js、无 JSX、无 React：每个 builder 都是
 *     `(g, w, d, h, color, secondary) => void`，往 group 里加 mesh。
 *     坐标约定与 FurnitureMesh 各子渲染器一致：局部原点 = 占地中心、
 *     y=0 为地面；w/d/h 为米（调用方已把目录 cm 换算成米并乘上 scale）。
 *   • 目录登记在 furniture.ts（FURNITURE 数组，id 以 `proc-` 开头、无
 *     model3d）；RoomCanvas 的 FurnitureMesh 顶部按 id 前缀分流到
 *     ProceduralFurnitureMesh（薄 R3F 包装，只做 useMemo 构建 + 释放）。
 *   • 本文件不 import 任何组件/ store，可被 node  harness 直接打包验证
 *     （每个 builder 的包围盒有限、无 NaN、落在声明尺寸内）。
 *
 * 扩展方法：加新场景 = 在下面加 builder + 在 PROCEDURAL_BUILDERS 登记 +
 * 在 furniture.ts 加一行目录 + 在模板里引用 id。不动渲染管线。
 */
import * as THREE from "three";

/** 程序化家具 id 前缀（目录 id、模板引用、渲染分流共用）。 */
export const PROCEDURAL_PREFIX = "proc-";

export function isProceduralFurnitureId(id: string): boolean {
  return id.startsWith(PROCEDURAL_PREFIX);
}

// ─── 小工具 ────────────────────────────────────────────────────────────────

type Mat = THREE.MeshStandardMaterial;

function std(color: string, rough = 0.8, metal = 0): Mat {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function glow(color: string, emissive: string, intensity = 0.9): Mat {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.6, metalness: 0, emissive, emissiveIntensity: intensity,
  });
}

function add(g: THREE.Group, mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

/** 盒子：sx/sy/sz 为米；cx/cz 为中心；y0 为底面高度（米）。 */
function box(
  g: THREE.Group, sx: number, sy: number, sz: number,
  cx: number, y0: number, cz: number, m: Mat,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  mesh.position.set(cx, y0 + sy / 2, cz);
  return add(g, mesh);
}

/** 圆柱/圆台：rT 顶半径、rB 底半径、sh 高；cx/cz 中心；y0 底面。 */
function cyl(
  g: THREE.Group, rT: number, rB: number, sh: number,
  cx: number, y0: number, cz: number, m: Mat, seg = 20,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, sh, seg), m);
  mesh.position.set(cx, y0 + sh / 2, cz);
  return add(g, mesh);
}

/** 圆锥：r 底半径、sh 高；cx/cz 中心；y0 底面。 */
function cone(
  g: THREE.Group, r: number, sh: number,
  cx: number, y0: number, cz: number, m: Mat, seg = 20,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, sh, seg), m);
  mesh.position.set(cx, y0 + sh / 2, cz);
  return add(g, mesh);
}

/** 球：cy 为球心高度。 */
function sphere(
  g: THREE.Group, r: number, cx: number, cy: number, cz: number, m: Mat,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), m);
  mesh.position.set(cx, cy, cz);
  return add(g, mesh);
}

/**
 * 旋转体（瓶/罐/碗/炉）：pts 为 [半径, 离地高度]（米），绕 Y 轴旋转。
 * 调用方保证 pts 的 y 覆盖 0..h、半径 ≤ min(w,d)/2。
 */
function lathe(g: THREE.Group, pts: Array<[number, number]>, m: Mat, seg = 28): THREE.Mesh {
  const v = pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(v, seg), m);
  mesh.position.set(0, 0, 0);
  return add(g, mesh);
}

/** 四条腿的通用底座（榻/案/几/桌类共用）：腿高 legH、腿截面 leg。 */
function fourLegs(
  g: THREE.Group, w: number, d: number, legH: number, leg: number,
  ix: number, iz: number, m: Mat,
): void {
  const hx = w / 2 - ix, hz = d / 2 - iz;
  box(g, leg, legH, leg, -hx, 0, -hz, m);
  box(g, leg, legH, leg, hx, 0, -hz, m);
  box(g, leg, legH, leg, -hx, 0, hz, m);
  box(g, leg, legH, leg, hx, 0, hz, m);
}

type Builder = (g: THREE.Group, w: number, d: number, h: number, c: string, s?: string) => void;

// ─── 秦汉 ──────────────────────────────────────────────────────────────────

/** 汉榻：18cm 矮足（时代锁）+ 厚板 + 席面。h≈0.38m。 */
function buildHanTa(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.75);
  const mat = std("#C8B878", 0.95); // 苇席
  const legH = Math.min(0.18, h * 0.47);
  const slabT = 0.08;
  fourLegs(g, w, d, legH, 0.07, 0.08, 0.08, wood);
  box(g, w, 0.03, d, 0, legH, 0, wood); // 承板
  box(g, w * 0.96, slabT, d * 0.94, 0, legH + 0.03, 0, wood); // 榻板
  box(g, w * 0.92, 0.02, d * 0.9, 0, legH + 0.03 + slabT, 0, mat); // 席
}

/** 汉案：12–14cm 高的低案（时代锁），分餐一人一案。h≈0.13m。 */
function buildHanAn(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.7);
  const legH = h * 0.55;
  // 两块侧板足（案的典型做法）+ 薄案面
  box(g, 0.04, legH, d * 0.8, -w / 2 + 0.08, 0, 0, wood);
  box(g, 0.04, legH, d * 0.8, w / 2 - 0.08, 0, 0, wood);
  box(g, w, h - legH, d, 0, legH, 0, wood);
  // 案面朱红边线
  box(g, w * 0.98, 0.008, d * 0.96, 0, h - 0.008, 0, std("#8B2010", 0.6));
}

/** 汉几：凭几/小矮几，扶手状低台。h≈0.25m。 */
function buildHanJi(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.7);
  const legH = h * 0.6;
  fourLegs(g, w, d, legH, 0.045, 0.06, 0.05, wood);
  box(g, w, h - legH, d, 0, legH, 0, wood);
}

/** 博山炉：柄杯 + 山形盖（镂孔山峦以叠层小锥示意）。 */
function buildBoshanlu(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const dark = std(c || "#2A2A2A", 0.45, 0.55);
  const r = Math.min(w, d) / 2;
  cyl(g, r * 0.55, r * 0.75, h * 0.14, 0, 0, 0, dark); // 底座
  cyl(g, r * 0.16, r * 0.16, h * 0.34, 0, h * 0.14, 0, dark); // 柄
  cyl(g, r * 0.95, r * 0.7, h * 0.1, 0, h * 0.48, 0, dark); // 杯
  cone(g, r * 0.85, h * 0.36, 0, h * 0.58, 0, dark); // 山形盖
  sphere(g, r * 0.1, 0, h * 0.94, 0, dark); // 盖顶小珠
}

/** 漆碗：黑胎朱口（黑+朱红是秦汉漆器基调）。 */
function buildLacquerBowl(g: THREE.Group, w: number, d: number, h: number, c: string, s?: string): void {
  const black = std(c || "#1A1A1A", 0.35, 0.1);
  const red = std(s || "#C03028", 0.4, 0.1);
  const r = Math.min(w, d) / 2;
  lathe(g, [[0.001, 0], [r * 0.45, 0], [r * 0.55, h * 0.12], [r * 0.95, h * 0.7], [r, h * 0.92], [r * 0.96, h]], black);
  // 朱红口沿
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, 0.008, 8, 28), red);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, h * 0.97, 0);
  add(g, rim);
}

// ─── 魏晋 ──────────────────────────────────────────────────────────────────

/** 胡床：X 形交足折叠凳（魏晋由西域传入文人书斋）。 */
function buildHuchuang(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.7);
  const seatH = h * 0.72;
  // 座面
  box(g, w, h - seatH, d, 0, seatH, 0, wood);
  // 两组 X 形交足：用斜置薄盒近似交叉腿
  const legLen = seatH * 1.25;
  for (const sx of [-1, 1]) {
    for (const rz of [0.5, -0.5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, legLen, 0.04), wood);
      leg.position.set(sx * w * 0.32, seatH / 2, 0);
      leg.rotation.z = rz;
      add(g, leg);
    }
    // 前后横档
    box(g, 0.04, 0.04, d * 0.9, sx * w * 0.32, seatH * 0.32, 0, wood);
  }
}

/** 木凳：方/圆凳通用（魏晋方圆凳、民国农村凳共用）。 */
function buildWoodStool(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.75);
  const seatH = h * 0.8;
  fourLegs(g, w, d, seatH, 0.05, 0.06, 0.06, wood);
  box(g, w, h - seatH, d, 0, seatH, 0, wood);
}

/** 越窑青瓷瓶：青灰釉旋转体。 */
function buildCeladonVase(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const glaze = std(c || "#9AB8A0", 0.3, 0.05);
  const r = Math.min(w, d) / 2;
  lathe(g, [
    [0.001, 0], [r * 0.5, 0], [r * 0.55, h * 0.04], [r * 0.9, h * 0.3],
    [r, h * 0.55], [r * 0.62, h * 0.78], [r * 0.42, h * 0.86], [r * 0.45, h * 0.95], [r * 0.42, h],
  ], glaze);
}

/** 铜佛像（坐姿，简化）：莲台 + 交脚身 + 头 + 背光盘。 */
function buildBuddhaStatue(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const bronze = std(c || "#8A6A2F", 0.45, 0.75);
  const r = Math.min(w, d) / 2;
  cyl(g, r * 0.9, r, h * 0.1, 0, 0, 0, bronze); // 莲台
  // 交脚盘坐身：压扁球体
  const body = sphere(g, r * 0.62, 0, h * 0.42, 0, bronze);
  body.scale.set(1.15, 0.85, 0.8);
  sphere(g, r * 0.32, 0, h * 0.78, 0, bronze); // 头
  cone(g, r * 0.12, h * 0.08, 0, h * 0.9, 0, bronze); // 肉髻
  // 背光盘（薄圆盘竖立身后）
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.015, 24), std("#C8A24A", 0.4, 0.8));
  halo.rotation.x = Math.PI / 2;
  halo.position.set(0, h * 0.55, -d * 0.28);
  add(g, halo);
}

/** 佛龛：小柜 + 龛门框 + 内置小佛（与十字架共存，见元场景）。 */
function buildShrineNiche(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.7);
  const dark = std("#3A2A1A", 0.8);
  box(g, w, h * 0.92, d, 0, 0, 0, wood); // 柜身
  box(g, w * 1.04, h * 0.08, d * 1.04, 0, h * 0.92, 0, dark); // 顶盖
  // 龛口（前脸开洞以深色内框示意）+ 小佛
  box(g, w * 0.6, h * 0.55, 0.02, 0, h * 0.25, d / 2 + 0.005, dark);
  const inner = new THREE.Group();
  buildBuddhaStatue(inner, w * 0.4, d * 0.5, h * 0.45, "#8A6A2F");
  inner.position.set(0, h * 0.28, d * 0.22);
  g.add(inner);
}

/** 十字架：两根相交木条（元代多元信仰：佛龛与十字架共存）。 */
function buildCross(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.7);
  box(g, w * 0.18, h, d, 0, 0, 0, wood);
  box(g, w, h * 0.14, d, 0, h * 0.62, 0, wood);
  box(g, w * 0.3, h * 0.06, d * 1.6, 0, 0, 0, std("#5A4A3A", 0.8)); // 底座
}

// ─── 元 ────────────────────────────────────────────────────────────────────

/**
 * 蒙古包（斡耳朵/金帐）：圆形毡帐 + 中央立柱 + 顶部天窗圈 + 放射状屋杆
 * （以锥顶示意）。家具 8 件套不含床——包内不放床（圆帐摆不下）。
 */
function buildYurt(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const felt = std(c || "#E8E0CC", 0.95);
  const wood = std("#7A5A34", 0.8);
  const r = Math.min(w, d) / 2;
  const wallH = h * 0.52;
  // 圆墙（毡）
  cyl(g, r, r, wallH, 0, 0, 0, felt, 28);
  // 墙顶收口绳圈
  const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.02, 8, 28), std("#B0503A", 0.8));
  band.rotation.x = Math.PI / 2;
  band.position.set(0, wallH, 0);
  add(g, band);
  // 锥顶（毡）
  cone(g, r * 1.02, h - wallH, 0, wallH, 0, felt, 28);
  // 顶部天窗圈（toono）
  cyl(g, r * 0.16, r * 0.16, 0.06, 0, h - 0.06, 0, wood, 16);
  // 中央立柱
  cyl(g, 0.05, 0.05, h - 0.05, 0, 0, 0, wood, 12);
  // 门洞（南向，深色小框）
  box(g, w * 0.18, wallH * 0.62, 0.03, 0, 0, r - 0.01, std("#4A3220", 0.85));
}

/** 青花瓷瓶（元代成熟期，高端器物，只进宫殿/贵室）：白胎 + 钴蓝带纹。 */
function buildBluewhiteVase(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const white = std(c || "#F5F5F0", 0.3, 0.05);
  const blue = std("#2A4A8A", 0.35, 0.05);
  const r = Math.min(w, d) / 2;
  lathe(g, [
    [0.001, 0], [r * 0.55, 0], [r * 0.6, h * 0.04], [r * 0.95, h * 0.3],
    [r, h * 0.52], [r * 0.66, h * 0.72], [r * 0.5, h * 0.8], [r * 0.52, h * 0.9],
    [r * 0.56, h * 0.95], [r * 0.5, h],
  ], white);
  // 钴蓝带纹：腹、颈各一圈
  for (const [yy, rr] of [[h * 0.45, r * 1.005], [h * 0.82, r * 0.53]] as Array<[number, number]>) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.012, 8, 28), blue);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, yy, 0);
    add(g, band);
  }
}

// ─── 半坡（仰韶）───────────────────────────────────────────────────────────

/** 半坡彩陶罐：红陶底 + 黑彩带（人面鱼纹以黑带示意，不做饭碗用）。 */
function buildBanpoPot(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const clay = std(c || "#B06030", 0.85);
  const black = std("#2A1A12", 0.8);
  const r = Math.min(w, d) / 2;
  lathe(g, [
    [0.001, 0], [r * 0.55, 0], [r * 0.62, h * 0.05], [r * 0.95, h * 0.35],
    [r, h * 0.6], [r * 0.7, h * 0.82], [r * 0.55, h * 0.92], [r * 0.58, h],
  ], clay);
  const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, 0.01, 8, 28), black);
  band.rotation.x = Math.PI / 2;
  band.position.set(0, h * 0.55, 0);
  add(g, band);
  // 口沿黑彩
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.56, 0.008, 8, 24), black);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, h * 0.97, 0);
  add(g, rim);
}

/** 火塘：石圈 + 灰烬 + 微光火苗（全屋唯一光源）。 */
function buildFirepit(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const stone = std("#7A7A72", 0.9);
  const ash = std("#3A332C", 0.95);
  const r = Math.min(w, d) / 2;
  // 灰烬盘
  cyl(g, r * 0.8, r * 0.85, h * 0.25, 0, 0, 0, ash, 24);
  // 石圈：8 块小石围成
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.BoxGeometry(r * 0.28, h * 0.7, r * 0.24), stone);
    st.position.set(Math.cos(a) * r * 0.85, h * 0.35, Math.sin(a) * r * 0.85);
    st.rotation.y = -a;
    add(g, st);
  }
  // 火苗（小发光锥）+ 余烬光盘
  cone(g, r * 0.22, h * 0.9, 0, h * 0.2, 0, glow("#E88020", "#FF6A00", 1.6), 12);
  const ember = new THREE.Mesh(new THREE.CircleGeometry(r * 0.6, 20), glow("#FF8A30", "#FF5A00", 1.2));
  ember.rotation.x = -Math.PI / 2;
  ember.position.set(0, h * 0.28, 0);
  add(g, ember);
}

/** 土台：夯土矮台（坐卧/置物之用，半坡室内仅有的“家具级”物之一）。 */
function buildEarthPlatform(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const earth = std(c || "#9A7A55", 0.95);
  box(g, w, h, d, 0, 0, 0, earth);
  box(g, w * 0.96, 0.02, d * 0.94, 0, h - 0.02, 0, std("#B08A62", 0.95)); // 台面
}

/**
 * 半坡半地穴屋：矮土垣（地面下约 1m 的坑以低垣示意）+ 木柱 + 茅草锥顶、
 * 南向门洞。放在四墙隐藏的露天“宅基地”房间里，屋即场景本身。
 */
function buildBanpoHouse(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const earth = std("#8A6A48", 0.95);
  const thatch = std(c || "#A08055", 0.95);
  const wood = std("#6A4A28", 0.85);
  const wallH = h * 0.32;
  const r = Math.min(w, d) / 2;
  // 土垣（环形矮墙，以 4 面薄墙拼成方环）
  const t = 0.18;
  box(g, w, wallH, t, 0, 0, -d / 2 + t / 2, earth);
  box(g, w, wallH, t, 0, 0, d / 2 - t / 2, earth);
  box(g, t, wallH, d, -w / 2 + t / 2, 0, 0, earth);
  box(g, t, wallH, d, w / 2 - t / 2, 0, 0, earth);
  // 四根木柱 + 茅草锥顶（四坡顶以方锥近似）。方锥顶点在对角线上：
  // 边长 = 房屋宽 × 1.15（微出檐），顶点到中心距离 = 边长/√2。
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    cyl(g, 0.07, 0.08, h * 0.75, sx * w * 0.32, 0, sz * d * 0.32, wood, 10);
  }
  const roofR = (Math.min(w, d) * 1.15) / Math.SQRT2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(roofR, h - wallH, 4), thatch);
  roof.position.set(0, wallH + (h - wallH) / 2, 0);
  roof.rotation.y = Math.PI / 4;
  add(g, roof);
  // 南向门洞（深色门框）
  box(g, w * 0.2, wallH * 0.8, 0.04, 0, 0, d / 2 - 0.02, std("#3A2A18", 0.9));
}

// ─── 河姆渡 ────────────────────────────────────────────────────────────────

/** 河姆渡黑陶釜：夹炭黑陶，厚胎多孔，黑色（与半坡红陶对照）。 */
function buildHemuduPot(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const black = std(c || "#1E1A16", 0.9);
  const r = Math.min(w, d) / 2;
  lathe(g, [
    [0.001, 0], [r * 0.6, 0], [r * 0.7, h * 0.06], [r, h * 0.35],
    [r * 0.98, h * 0.6], [r * 0.7, h * 0.82], [r * 0.62, h * 0.92], [r * 0.66, h],
  ], black);
  // 釜耳（两侧小提耳）
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.TorusGeometry(r * 0.16, 0.02, 8, 16), black);
    ear.position.set(sx * r * 0.95, h * 0.8, 0);
    ear.rotation.y = Math.PI / 2;
    add(g, ear);
  }
}

/**
 * 河姆渡干栏屋（长屋）：高脚柱 + 架空地板（离地 1m+）+ 长屋 + 走廊 +
 * 茅草双坡顶；楼上住人、楼下养畜。w 按真实长屋 23m 声明，builder 按比例缩放。
 */
function buildHemuduStilt(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#8A6A42", 0.85);
  const darkWood = std("#5A4028", 0.85);
  const thatch = std("#A89060", 0.95);
  const floorY = h * 0.32; // 架空地板高（≈1m）
  const cols = Math.max(4, Math.round(w / 2.2)); // 约每 2.2m 一柱
  const rows = 2;
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / cols;
    for (let j = 0; j < rows; j++) {
      const z = -d / 2 + d * (j + 0.5) / rows;
      cyl(g, 0.07, 0.09, floorY + h * 0.28, x, 0, z, darkWood, 10);
    }
  }
  // 架空地板
  box(g, w, 0.12, d, 0, floorY, 0, wood);
  // 楼板上：矮墙（半高）+ 走廊栏杆
  const wallH = h * 0.28;
  box(g, w, wallH, 0.08, 0, floorY + 0.12, -d / 2 + 0.04, wood);
  box(g, 0.08, wallH, d, -w / 2 + 0.04, floorY + 0.12, 0, wood);
  box(g, 0.08, wallH, d, w / 2 - 0.04, floorY + 0.12, 0, wood);
  // 走廊（南侧）：栏杆
  box(g, w, 0.05, 0.05, 0, floorY + 0.55, d / 2 - 0.06, darkWood);
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / cols;
    box(g, 0.05, 0.45, 0.05, x, floorY + 0.12, d / 2 - 0.06, darkWood);
  }
  // 双坡茅草顶（两块斜板，屋脊在中线、檐口齐墙边，不伸出占地）
  const roofH = h - floorY - 0.12 - wallH;
  const slopeLen = Math.sqrt((d / 2) ** 2 + roofH ** 2);
  const ang = Math.atan2(roofH, d / 2);
  for (const sz of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, slopeLen), thatch);
    slab.position.set(0, floorY + 0.12 + wallH + roofH / 2, sz * (d / 4));
    slab.rotation.x = sz * ang;
    add(g, slab);
  }
  // 楼梯（斜梯上楼，收在占地内，靠南侧地板边；底端贴地）
  const ladLen = floorY * 1.5;
  const lad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, ladLen), darkWood);
  lad.position.set(w * 0.32, (ladLen / 2) * Math.cos(0.65), d / 2 - 0.4);
  lad.rotation.x = 0.65;
  add(g, lad);
}

// ─── 民国农村 ────────────────────────────────────────────────────────────

/** 火炕：占屋三分之一到二分之一的砖砌大平台，家庭中心（睡/吃/待客）。 */
function buildKang(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const brick = std(c || "#9A7A5A", 0.9);
  const mat = std("#C8B878", 0.95); // 炕席
  box(g, w, h * 0.85, d, 0, 0, 0, brick);
  box(g, w * 0.98, h * 0.15, d * 0.96, 0, h * 0.85, 0, mat);
  // 炕沿（前沿高起一线）
  box(g, w, 0.06, 0.06, 0, h * 0.85, d / 2 - 0.03, std("#7A5A3A", 0.9));
  // 炕洞口（侧面小黑口，烧炕的灶口）
  box(g, 0.3, 0.25, 0.03, -w / 2 + 0.01, h * 0.1, 0, std("#2A2018", 0.95));
}

/** 豆油灯：小碟 + 灯芯 + 微光。 */
function buildOilLamp(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const clay = std(c || "#8A6A3A", 0.85);
  const r = Math.min(w, d) / 2;
  cyl(g, r * 0.9, r * 0.6, h * 0.25, 0, 0, 0, clay, 16);
  cyl(g, r * 0.12, r * 0.12, h * 0.3, r * 0.3, h * 0.2, 0, std("#3A2A1A", 0.9), 8);
  sphere(g, r * 0.22, r * 0.3, h * 0.62, 0, glow("#FFC860", "#FF8A00", 1.8));
}

/** 煤油灯（1920s+）：底座 + 玻璃罩 + 火苗。 */
function buildKeroseneLamp(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const metal = std(c || "#3A3A3A", 0.5, 0.6);
  const glass = new THREE.MeshStandardMaterial({
    color: "#F0E8D0", roughness: 0.15, metalness: 0, transparent: true, opacity: 0.45,
  });
  const r = Math.min(w, d) / 2;
  cyl(g, r * 0.8, r * 0.9, h * 0.2, 0, 0, 0, metal, 16); // 油壶底座
  cyl(g, r * 0.15, r * 0.15, h * 0.12, 0, h * 0.2, 0, metal, 10); // 灯芯座
  cyl(g, r * 0.55, r * 0.7, h * 0.5, 0, h * 0.3, 0, glass, 16); // 玻璃罩
  cone(g, r * 0.18, h * 0.22, 0, h * 0.3, 0, glow("#FFC860", "#FF8A00", 1.8), 10); // 火苗
}

/** 木箱：储物箱（农村橱/箱、韩屋衣柜的通用木箱）。 */
function buildWoodChest(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.75);
  const dark = std("#4A3220", 0.8);
  box(g, w, h * 0.88, d, 0, 0, 0, wood);
  box(g, w * 1.02, h * 0.12, d * 1.02, 0, h * 0.88, 0, dark); // 箱盖
  // 箱箍（两道铁箍）
  for (const sx of [-0.3, 0.3]) {
    box(g, 0.03, h * 0.9, d * 1.01, sx * w, 0, 0, std("#3A3A3A", 0.5, 0.6));
  }
  box(g, 0.12, 0.06, 0.03, 0, h * 0.7, d / 2 + 0.01, std("#8A6A2F", 0.4, 0.7)); // 锁扣
}

/** 谷束（粟/稻共用，颜色区分）：捆扎的谷穗束。 */
function buildGrainSheaf(color: string): Builder {
  return (g: THREE.Group, w: number, d: number, h: number) => {
    const straw = std(color, 0.9);
    const grain = std("#C89830", 0.9);
    const r = Math.min(w, d) / 2;
    // 束身：上小下大的锥形捆
    cyl(g, r * 0.45, r * 0.8, h * 0.7, 0, 0, 0, straw, 12);
    // 穗头：顶部散开的几支谷穗
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, h * 0.45, 6), grain);
      stalk.position.set(Math.cos(a) * r * 0.3, h * 0.8, Math.sin(a) * r * 0.3);
      stalk.rotation.z = Math.cos(a) * 0.25;
      stalk.rotation.x = -Math.sin(a) * 0.25;
      add(g, stalk);
      cone(g, 0.04, h * 0.22, Math.cos(a) * r * 0.42, h * 0.92, Math.sin(a) * r * 0.42, grain, 8);
    }
    // 捆绳
    const rope = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, 0.015, 8, 20), std("#8A6A3A", 0.9));
    rope.rotation.x = Math.PI / 2;
    rope.position.set(0, h * 0.45, 0);
    add(g, rope);
  };
}

// ─── 近郊别墅 ────────────────────────────────────────────────────────────

/**
 * 博古架：中式多宝格（不是现代开放置物架）：大小不一的格子 + 内置小件
 * （瓶/盒/卷轴示意）。茶室核心。
 */
function buildBogujia(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.7);
  const t = 0.035; // 板厚
  const cols = 4, rows = 5;
  // 外框
  box(g, w, t, d, 0, 0, 0, wood);
  box(g, w, t, d, 0, h - t, 0, wood);
  box(g, t, h, d, -w / 2 + t / 2, 0, 0, wood);
  box(g, t, h, d, w / 2 - t / 2, 0, 0, wood);
  // 竖隔（不等距：中间一格加宽）
  const xs = [-0.22, 0.05, 0.28];
  for (const fx of xs) box(g, t, h, d * 0.92, fx * w, 0, 0, wood);
  // 横隔（每列错层，做出多宝格的不规则感）
  const shelfY = [0.2, 0.42, 0.58, 0.78];
  for (let i = 0; i < shelfY.length; i++) {
    const y = shelfY[i] * h;
    const x0 = i % 2 === 0 ? -w / 2 : -w * 0.22;
    const x1 = i % 2 === 0 ? w * 0.05 : w / 2;
    box(g, x1 - x0, t, d * 0.92, (x0 + x1) / 2, y, 0, wood);
  }
  // 格内小件：小瓶/小盒/小卷轴（固定点缀，不可取）
  const vaseM = std("#7A9AB0", 0.4, 0.1);
  const boxM = std("#8B2010", 0.7);
  cyl(g, 0.05, 0.07, 0.22, -w * 0.35, h * 0.2, 0, vaseM, 12);
  box(g, 0.16, 0.1, 0.14, -w * 0.08, h * 0.42, 0, boxM);
  cyl(g, 0.04, 0.04, 0.3, w * 0.16, h * 0.58, 0, std("#E8DCC8", 0.9), 10);
  cyl(g, 0.05, 0.06, 0.18, w * 0.38, h * 0.78, 0, std("#3A5A3A", 0.5), 12);
  void cols; void rows;
}

// ─── 学校 ────────────────────────────────────────────────────────────────

/** 课桌椅一体（传统黑板教室）：课桌 + 连体座椅，成排面向黑板。 */
function buildSchoolDesk(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.75);
  const deskH = h * 0.95; // 桌面高 ≈0.71m
  const deskD = d * 0.55;
  // 桌面（前部）+ 桌斗
  box(g, w, 0.04, deskD, 0, deskH - 0.04, -d / 2 + deskD / 2, wood);
  box(g, w * 0.9, 0.18, deskD * 0.85, 0, deskH - 0.22, -d / 2 + deskD / 2, std("#A08050", 0.8));
  // 桌腿
  box(g, 0.05, deskH - 0.22, 0.05, -w / 2 + 0.05, 0, -d / 2 + 0.06, wood);
  box(g, 0.05, deskH - 0.22, 0.05, w / 2 - 0.05, 0, -d / 2 + 0.06, wood);
  // 座椅（后部）：座面 + 靠背
  const seatH = h * 0.55;
  box(g, w * 0.92, 0.05, d * 0.32, 0, seatH, d / 2 - d * 0.16, wood);
  box(g, w * 0.92, h * 0.45, 0.04, 0, seatH + 0.05, d / 2 - 0.03, wood);
  box(g, 0.05, seatH, 0.05, -w / 2 + 0.05, 0, d / 2 - 0.06, wood);
  box(g, 0.05, seatH, 0.05, w / 2 - 0.05, 0, d / 2 - 0.06, wood);
}

/** 黑板：深绿板面 + 粉笔槽 + 两支粉笔（前黑板/后黑板报共用）。 */
function buildBlackboard(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const board = std(c || "#2E4A3A", 0.9);
  const frame = std("#8A6A42", 0.7);
  box(g, w, h, d, 0, 0, 0, board);
  // 木框四边
  box(g, w, 0.04, d + 0.01, 0, -0.02, 0, frame);
  box(g, w, 0.04, d + 0.01, 0, h - 0.02, 0, frame);
  box(g, 0.04, h, d + 0.01, -w / 2 + 0.02, 0, 0, frame);
  box(g, 0.04, h, d + 0.01, w / 2 - 0.02, 0, 0, frame);
  // 粉笔槽 + 粉笔
  box(g, w * 0.6, 0.03, 0.06, 0, -0.05, d / 2 + 0.02, frame);
  box(g, 0.12, 0.015, 0.015, -w * 0.2, -0.03, d / 2 + 0.02, std("#F5F5F0", 0.9));
  box(g, 0.12, 0.015, 0.015, -w * 0.05, -0.03, d / 2 + 0.02, std("#F5F5F0", 0.9));
  // 粉笔字痕（几道白线示意板书）
  const chalk = std("#E8E8E0", 0.9);
  for (let i = 0; i < 3; i++) {
    box(g, w * (0.5 - i * 0.1), 0.012, 0.006, -w * 0.1, h * (0.62 - i * 0.18), d / 2 + 0.004, chalk);
  }
}

/** 扫帚：竹竿 + 草扎头（教室后角）。 */
function buildBroom(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const bamboo = std(c || "#C8A860", 0.85);
  cyl(g, 0.018, 0.018, h * 0.68, 0, h * 0.32, 0, bamboo, 8);
  cone(g, Math.min(w, d) * 0.42, h * 0.34, 0, 0, 0, std("#B09850", 0.95), 12);
}

// ─── 医院 ────────────────────────────────────────────────────────────────

/** 病床：床架 + 床垫 + 两侧护栏 + 可调床头（非美式单人豪华间）。h≈1.10m（含床头板）。 */
function buildHospitalBed(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const frame = std("#C8C8C8", 0.4, 0.7);
  const mattress = std("#F0F0EA", 0.9);
  const sheet = std("#E8F0F0", 0.95);
  const bedH = h * 0.55; // 床板高
  fourLegs(g, w, d, bedH, 0.05, 0.06, 0.06, frame);
  box(g, w, 0.08, d, 0, bedH, 0, frame); // 床板
  box(g, w * 0.97, 0.14, d * 0.96, 0, bedH + 0.08, 0, mattress); // 床垫
  box(g, w * 0.97, 0.05, d * 0.5, 0, bedH + 0.22, d * 0.2, sheet); // 被单（下半）
  // 床头板（可调，立起一截）
  box(g, w * 0.9, 0.35, 0.04, 0, bedH + 0.08, -d / 2 + 0.05, frame);
  // 两侧护栏（细杆 ×3）
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      box(g, 0.025, 0.22, 0.025, sx * (w / 2 - 0.02), bedH + 0.22, -d / 4 + (i * d) / 4, frame);
    }
    box(g, 0.03, 0.03, d * 0.7, sx * (w / 2 - 0.02), bedH + 0.42, 0, frame);
  }
  // 床尾牌
  box(g, 0.3, 0.2, 0.02, 0, bedH + 0.22, d / 2 + 0.01, std("#F5F5F0", 0.8));
}

/** 输液架：立杆 + 挂钩 + 输液袋。 */
function buildIvStand(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const metal = std(c || "#C8C8C8", 0.35, 0.8);
  const r = Math.min(w, d) / 2;
  cyl(g, r * 0.9, r, 0.04, 0, 0, 0, metal, 16); // 底座
  cyl(g, 0.02, 0.02, h * 0.92, 0, 0.04, 0, metal, 10); // 立杆
  box(g, w * 0.8, 0.03, 0.03, 0, h * 0.94, 0, metal); // 横挂杆
  box(g, 0.14, 0.24, 0.05, -w * 0.28, h * 0.68, 0, std("#E8E0C8", 0.6)); // 输液袋
  cyl(g, 0.008, 0.008, h * 0.4, -w * 0.28, h * 0.28, 0, std("#D8D8D8", 0.5), 6); // 输液管
}

/** 床头设备带：墙挂长条 + 插座 + 呼叫按钮（红）。 */
function buildMedStrip(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const panel = std(c || "#F0F0F0", 0.6);
  box(g, w, h, d, 0, 0, 0, panel);
  // 氧气/插座口（小方块 ×3）
  for (let i = 0; i < 3; i++) {
    box(g, 0.08, h * 0.4, 0.02, -w * 0.3 + i * w * 0.22, h * 0.3, d / 2 + 0.005, std("#C8C8C8", 0.4, 0.6));
  }
  // 呼叫按钮（红色圆钮）
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), std("#C02020", 0.4));
  btn.rotation.x = Math.PI / 2;
  btn.position.set(w * 0.32, h * 0.5, d / 2 + 0.015);
  add(g, btn);
}

/** 陪护折叠椅：X 形折叠架 + 布面（夜间展开在床边）。 */
function buildCampChair(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const frame = std("#5A5A5A", 0.5, 0.6);
  const fabric = std(c || "#5A6A7A", 0.95);
  const seatH = h * 0.55;
  box(g, w, 0.06, d, 0, seatH, 0, fabric); // 布座面
  box(g, w, h * 0.4, 0.05, 0, seatH + 0.03, d / 2 - 0.03, fabric); // 布靠背
  // X 形折叠腿（两侧）：腿长按斜角折算，底端贴地不穿地
  const legLen = seatH * 1.15, legAng = 0.35;
  const legVert = legLen * Math.cos(legAng);
  for (const sx of [-1, 1]) {
    for (const rz of [legAng, -legAng]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, legLen, 0.03), frame);
      leg.position.set(sx * w * 0.38, legVert / 2, 0);
      leg.rotation.z = rz;
      add(g, leg);
    }
  }
}

/** 保温壶：圆柱壶身 + 壶盖 + 提手。 */
function buildThermos(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const body = std(c || "#C03028", 0.5, 0.2);
  const r = Math.min(w, d) / 2;
  cyl(g, r * 0.85, r, h * 0.72, 0, 0, 0, body, 18);
  cyl(g, r * 0.5, r * 0.55, h * 0.16, 0, h * 0.72, 0, std("#2A2A2A", 0.6), 14);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, 0.015, 8, 18, Math.PI), std("#2A2A2A", 0.6));
  handle.position.set(0, h * 0.88, 0);
  add(g, handle);
}

/** 脸盆：浅圆盆（陪护洗漱）。 */
function buildBasin(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const enamel = std(c || "#E8E8E8", 0.35, 0.15);
  const r = Math.min(w, d) / 2;
  lathe(g, [[0.001, 0], [r * 0.7, 0], [r * 0.85, h * 0.3], [r, h * 0.85], [r * 0.98, h]], enamel);
}

// ─── 凡尔赛 ──────────────────────────────────────────────────────────────

/** 镜墙：一面镜 + 鎏金框 + 壁柱线（17 窗对 17 镜墙，成对出现）。 */
function buildMirrorWall(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const gold = std("#C8A24A", 0.35, 0.85);
  const mirror = new THREE.MeshStandardMaterial({
    color: "#DCE4E8", roughness: 0.06, metalness: 1,
  });
  box(g, w, h, d, 0, 0, 0, std("#8A6A3A", 0.7)); // 背板
  box(g, w * 0.88, h * 0.92, 0.015, 0, h * 0.04, d / 2 + 0.005, mirror); // 镜面
  // 鎏金框
  box(g, w, 0.06, 0.03, 0, 0, d / 2 + 0.01, gold);
  box(g, w, 0.06, 0.03, 0, h - 0.06, d / 2 + 0.01, gold);
  box(g, 0.06, h, 0.03, -w / 2 + 0.03, 0, d / 2 + 0.01, gold);
  box(g, 0.06, h, 0.03, w / 2 - 0.03, 0, d / 2 + 0.01, gold);
  // 中竖棂（太阳纹以金色小圆示意）
  box(g, 0.04, h * 0.9, 0.02, 0, h * 0.05, d / 2 + 0.012, gold);
  sphere(g, 0.06, 0, h * 0.55, d / 2 + 0.02, gold);
}

/** 水晶吊灯：中柱 + 双层烛臂 + 水晶坠（微发光）。 */
function buildChandelierCrystal(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const gold = std("#C8A24A", 0.35, 0.85);
  const crystal = glow("#FFFFFF", "#FFF2CC", 0.55);
  const r = Math.min(w, d) / 2;
  cyl(g, 0.03, 0.03, h * 0.7, 0, h * 0.15, 0, gold, 10); // 中柱
  sphere(g, r * 0.16, 0, h * 0.12, 0, gold); // 底坠
  // 两层烛臂环
  for (const [yy, rr, n] of [[h * 0.42, r * 0.8, 6], [h * 0.68, r * 0.55, 6]] as Array<[number, number, number]>) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.02, 8, 28), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, yy, 0);
    add(g, ring);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      cyl(g, 0.015, 0.015, 0.12, x, yy, z, gold, 8); // 烛台
      sphere(g, 0.03, x, yy + 0.09, z, crystal); // 烛光
      cone(g, 0.035, 0.16, x, yy - 0.16, z, crystal, 8); // 水晶坠
    }
  }
}

/** 鎏金扶手椅：金框 + 红丝绒（凡尔赛厅堂沿墙座椅）。 */
function buildGiltChair(g: THREE.Group, w: number, d: number, h: number, c: string, s?: string): void {
  const gold = std(c || "#C8A24A", 0.35, 0.85);
  const velvet = std(s || "#8B1A1A", 0.95);
  const seatH = h * 0.42;
  fourLegs(g, w, d, seatH, 0.05, 0.06, 0.06, gold);
  box(g, w, 0.08, d, 0, seatH, 0, velvet); // 座面
  box(g, w, h - seatH - 0.08, 0.07, 0, seatH + 0.08, -d / 2 + 0.04, velvet); // 靠背
  box(g, w * 1.02, 0.05, d * 1.02, 0, h - 0.05, 0, gold); // 靠背顶金饰
  // 扶手
  box(g, 0.05, 0.06, d * 0.8, -w / 2 + 0.03, seatH + 0.22, 0, gold);
  box(g, 0.05, 0.06, d * 0.8, w / 2 - 0.03, seatH + 0.22, 0, gold);
}

// ─── 和室 / 韩屋 ─────────────────────────────────────────────────────────

/** 榻榻米：草席面 + 深绿包边（以“帖”计量的模数，和室地面以此铺满）。 */
function buildTatami(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const straw = std(c || "#C8B878", 0.95);
  const edge = std("#3A5A3A", 0.9);
  box(g, w, h, d, 0, 0, 0, straw);
  // 四边包边（深绿布边）
  box(g, w, h + 0.004, 0.03, 0, -0.002, -d / 2 + 0.015, edge);
  box(g, w, h + 0.004, 0.03, 0, -0.002, d / 2 - 0.015, edge);
  box(g, 0.03, h + 0.004, d, -w / 2 + 0.015, -0.002, 0, edge);
  box(g, 0.03, h + 0.004, d, w / 2 - 0.015, -0.002, 0, edge);
  // 席纹（两道浅压线）
  box(g, w * 0.96, 0.003, 0.012, 0, h - 0.001, -d * 0.18, std("#B8A868", 0.95));
  box(g, w * 0.96, 0.003, 0.012, 0, h - 0.001, d * 0.18, std("#B8A868", 0.95));
}

/**
 * 床の間：低台 + 床柱 + 挂轴（只挂轴、摆插花；什么都不许放、不许坐）。
 * 作为靠墙摆件：台面空无一物，只有一幅挂轴与一枝插花。
 */
function buildTokonoma(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.75);
  const dark = std("#3A2A1A", 0.8);
  // 低台
  box(g, w, h * 0.06, d, 0, 0, 0, wood);
  // 床柱（右侧立柱）
  box(g, 0.09, h * 0.94, 0.09, w / 2 - 0.12, h * 0.06, d / 2 - 0.1, dark);
  // 挂轴（靠墙，素色 + 深色上下轴）
  box(g, w * 0.34, h * 0.62, 0.02, -w * 0.12, h * 0.2, -d / 2 + 0.06, std("#E8E0CC", 0.95));
  box(g, w * 0.34, 0.05, 0.025, -w * 0.12, h * 0.2 + h * 0.62, -d / 2 + 0.06, dark);
  box(g, w * 0.34, 0.05, 0.025, -w * 0.12, h * 0.2, -d / 2 + 0.06, dark);
  // 插花（小瓶 + 一枝）
  cyl(g, 0.04, 0.05, 0.14, w * 0.28, h * 0.06, 0, std("#4A5A6A", 0.5), 12);
  cyl(g, 0.008, 0.008, h * 0.3, w * 0.28, h * 0.18, 0, std("#3A5A3A", 0.9), 6);
}

/** 障子/纸拉门：木格 + 半透和纸（透光）。 */
function buildShoji(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#8A6A42", 0.75);
  const paper = new THREE.MeshStandardMaterial({
    color: "#F5EFDC", roughness: 0.9, metalness: 0,
    transparent: true, opacity: 0.65, side: THREE.DoubleSide,
  });
  box(g, w, h, d, 0, 0, 0, paper); // 纸面
  const t = 0.035;
  box(g, w, t, d + 0.01, 0, 0, 0, wood);
  box(g, w, t, d + 0.01, 0, h - t, 0, wood);
  box(g, t, h, d + 0.01, -w / 2 + t / 2, 0, 0, wood);
  box(g, t, h, d + 0.01, w / 2 - t / 2, 0, 0, wood);
  // 横格 ×3 + 竖格 ×2
  for (const fy of [0.25, 0.5, 0.75]) box(g, w, 0.025, d + 0.012, 0, fy * h, 0, wood);
  for (const fx of [-0.17, 0.17]) box(g, 0.025, h, d + 0.012, fx * w, 0, 0, wood);
}

/** 坐垫（座布団）：扁圆垫（和室/韩屋地面坐具）。 */
function buildFloorCushion(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const fabric = std(c, 0.95);
  const r = Math.min(w, d) / 2;
  cyl(g, r * 0.95, r, h * 0.7, 0, 0, 0, fabric, 20);
  box(g, w * 0.7, h * 0.3, d * 0.7, 0, h * 0.7, 0, std("#D8C8B8", 0.95));
}

/** 被褥（折叠收纳态）：叠放的被褥卷（和室白天起居、夜晚铺开变卧室）。 */
function buildFuton(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const cloth = std(c || "#E8E0D0", 0.95);
  const accent = std("#8B9AB0", 0.95);
  box(g, w, h * 0.4, d, 0, 0, 0, cloth);
  box(g, w * 0.94, h * 0.32, d * 0.94, 0, h * 0.4, 0, accent);
  box(g, w * 0.88, h * 0.28, d * 0.88, 0, h * 0.72, 0, cloth);
}

/** 韩屋小桌（소반）：矮圆/方桌，温突房餐叙用。 */
function buildOndolTable(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.7);
  const legH = h * 0.62;
  // 圆角桌面（圆柱扁盘更接近 소반）
  cyl(g, Math.min(w, d) / 2, Math.min(w, d) / 2, h - legH, 0, legH, 0, wood, 24);
  fourLegs(g, w * 0.8, d * 0.8, legH, 0.045, 0.06, 0.06, wood);
}

/** 温突地板：整间铺设的暖黄色油纸地板（灶 + 地下烟道供暖，ondol）。 */
function buildOndolFloor(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const floor = std(c || "#C89858", 0.9);
  box(g, w, h, d, 0, 0, 0, floor);
  // 地板接缝（几道浅线）
  for (let i = 1; i < 4; i++) {
    box(g, 0.015, 0.004, d * 0.98, -w / 2 + (w * i) / 4, h - 0.002, 0, std("#B08048", 0.9));
  }
}

/** 韩屋灶口（아궁이）：土灶 + 灶口黑洞 + 上置铁锅（火从厨房烧起暖全屋）。 */
function buildHanokStove(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const clay = std(c || "#8A7A6A", 0.9);
  const iron = std("#2A2A2A", 0.5, 0.6);
  box(g, w, h * 0.8, d, 0, 0, 0, clay); // 灶身
  box(g, w * 0.5, h * 0.45, 0.03, -w * 0.1, h * 0.12, d / 2 + 0.005, std("#1A1410", 0.95)); // 灶口
  const potR = Math.min(w, d) * 0.32; // 铁锅半径按窄边取，不伸出灶身
  cyl(g, potR * 0.88, potR, h * 0.22, 0, h * 0.8, 0, iron, 18); // 铁锅
  cyl(g, potR * 0.88, potR * 0.88, 0.02, 0, h * 0.98, 0, iron, 18); // 锅盖
}

// ─── 高频日常场景（学校/家庭/公司/联想补充）───────────────────────────

/** 双层床（宿舍标配）：上下铺 + 护栏 + 爬梯 + 枕头。 */
function buildBunkBed(g: THREE.Group, w: number, d: number, h: number, c: string, s?: string): void {
  const frame = std(c, 0.7, 0.2);
  const mattress = std(s || "#E8E8E8", 0.95);
  const px = w / 2 - 0.03, pz = d / 2 - 0.03;
  // 四根立柱
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    box(g, 0.06, h, 0.06, sx * px, 0, sz * pz, frame);
  }
  // 下铺（0.35）与上铺（1.25）床板 + 床垫 + 枕头
  for (const y of [0.35, 1.25]) {
    box(g, w - 0.06, 0.06, d - 0.06, 0, y, 0, frame);
    box(g, w - 0.12, 0.12, d - 0.12, 0, y + 0.06, 0, mattress);
    box(g, w * 0.5, 0.08, 0.3, 0, y + 0.18, -d / 2 + 0.25, std("#F5F5F0", 0.95));
  }
  // 上铺护栏（两侧长边）
  for (const sz of [-1, 1]) {
    box(g, w - 0.06, 0.28, 0.04, 0, 1.43, sz * (d / 2 - 0.05), frame);
  }
  // 爬梯（床尾）：两竖杆 + 三横档
  const lx = w / 2 - 0.1;
  box(g, 0.04, 1.25, 0.04, lx, 0, d / 2 - 0.21, frame);
  box(g, 0.04, 1.25, 0.04, lx, 0, d / 2 - 0.03, frame);
  for (const y of [0.4, 0.8, 1.15]) {
    box(g, 0.04, 0.04, 0.22, lx, y, d / 2 - 0.12, frame);
  }
}

/** 图书馆书架：双面高架 + 五层 + 书脊（两面都有书）。 */
function buildLibraryShelf(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.7);
  const t = 0.04;
  box(g, t, h, d, -w / 2 + t / 2, 0, 0, wood); // 侧板
  box(g, t, h, d, w / 2 - t / 2, 0, 0, wood);
  box(g, w, t, d, 0, 0, 0, wood); // 底板
  box(g, w, t, d, 0, h - t, 0, wood); // 顶板
  const shelfY = [0.35, 0.72, 1.09, 1.46, 1.8];
  const bookColors = ["#8B2010", "#2A4A6A", "#3A5A3A", "#C8A860", "#5A3A6A", "#7A6A3A"];
  for (const y of shelfY) {
    box(g, w - 2 * t, 0.03, d - 0.02, 0, y, 0, wood);
    // 每层两面各一排书脊（高低错落）
    for (const sz of [-1, 1]) {
      let x = -w / 2 + 0.12;
      let i = 0;
      while (x < w / 2 - 0.2) {
        const bw = 0.05 + (i % 3) * 0.015;
        const bh = 0.2 + (i % 3) * 0.03;
        box(g, bw, bh, 0.14, x + bw / 2, y + 0.03, sz * (d / 2 - 0.1), std(bookColors[i % bookColors.length], 0.85));
        x += bw + 0.012;
        i++;
      }
    }
  }
}

/** 饭堂长桌：长桌 + 两侧长凳一体。 */
function buildCafeteriaTable(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const top = std(c, 0.6);
  const legM = std("#5A5A5A", 0.5, 0.5);
  const tableH = h * 0.95;
  box(g, w, 0.04, d * 0.62, 0, tableH - 0.04, 0, top); // 桌面
  box(g, 0.06, tableH - 0.04, d * 0.5, -w / 2 + 0.15, 0, 0, legM); // 桌腿板
  box(g, 0.06, tableH - 0.04, d * 0.5, w / 2 - 0.15, 0, 0, legM);
  // 两侧长凳
  for (const sz of [-1, 1]) {
    const bz = sz * d * 0.42;
    box(g, w * 0.92, 0.05, d * 0.16, 0, h * 0.56, bz, std("#A08050", 0.8));
    box(g, 0.05, h * 0.56, 0.05, -w / 2 + 0.12, 0, bz, legM);
    box(g, 0.05, h * 0.56, 0.05, w / 2 - 0.12, 0, bz, legM);
  }
}

/** 打饭窗口柜台：不锈钢台身 + 玻璃防飞沫挡板 + 餐盘。 */
function buildServingCounter(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const steel = std(c || "#C8C8C8", 0.35, 0.7);
  const glass = new THREE.MeshStandardMaterial({
    color: "#DCE8E8", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.4,
  });
  box(g, w, 0.9, d, 0, 0, 0, steel); // 台身
  box(g, w, 0.04, d * 1.04, 0, 0.9, 0, std("#E8E8E8", 0.3, 0.6)); // 台面
  // 玻璃挡板（后沿立起）
  box(g, w * 0.98, 0.35, 0.015, 0, 0.94, -d / 2 + 0.06, glass);
  // 餐盘 ×3 + 菜盆 ×2
  for (let i = 0; i < 3; i++) {
    box(g, 0.5, 0.02, 0.32, -w * 0.3 + i * w * 0.3, 0.94, d * 0.12, std("#F5F5F0", 0.5));
  }
  box(g, 0.4, 0.1, 0.3, -w * 0.2, 0.94, -d * 0.1, std("#B0503A", 0.6));
  box(g, 0.4, 0.1, 0.3, w * 0.2, 0.94, -d * 0.1, std("#3A5A3A", 0.6));
}

/**
 * 开水房水龙头排：中国学校/宿舍的 communal hot-water room（开水房）：
 * 长台 + 一排水龙头（热水）+ 排水槽 + 两端水壶。学生排队打水，
 * 保温壶放在台面。无对应照片见参考包缺口，布局据文字描述。
 */
function buildWaterTapRow(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const steel = std(c || "#C8C8C8", 0.35, 0.7);
  const brass = std("#B08A3A", 0.4, 0.7);
  box(g, w, 0.85, d, 0, 0, 0, steel); // 台身
  box(g, w, 0.03, d * 1.02, 0, 0.85, 0, std("#E8E8E8", 0.3, 0.6)); // 台面
  box(g, w, 0.15, 0.03, 0, 0.85, -d / 2 + 0.015, steel); // 后挡水板
  // 排水槽（台面前沿深色条）
  box(g, w * 0.94, 0.012, 0.1, 0, 0.885, d * 0.22, std("#5A5A5A", 0.6));
  // 4 个热水龙头：立管 + 横出水嘴（朝前）
  for (const fx of [-0.375, -0.125, 0.125, 0.375]) {
    const x = fx * w;
    cyl(g, 0.02, 0.02, 0.12, x, 0.88, -d / 2 + 0.08, brass, 10);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), brass);
    spout.rotation.x = Math.PI / 2;
    spout.position.set(x, 0.98, -d / 2 + 0.16);
    add(g, spout);
    // 红色热水标识钮
    sphere(g, 0.02, x, 1.01, -d / 2 + 0.08, std("#C02020", 0.5));
  }
  // 两端水壶（保温壶/暖水瓶）：圆柱壶身 + 壶盖 + 提手
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.16);
    cyl(g, 0.085, 0.095, 0.16, x, 0.88, 0, std("#C03028", 0.5, 0.2), 16);
    cyl(g, 0.05, 0.055, 0.03, x, 1.04, 0, std("#2A2A2A", 0.6), 12);
  }
}

/** 篮球架：底座 + 立柱 + 篮板 + 篮筐 + 篮网。 */
function buildBasketballHoop(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const steel = std(c || "#2A5A8A", 0.5, 0.6);
  const boardM = std("#F5F5F0", 0.5);
  box(g, 0.9, 0.15, 0.6, 0, 0, -d / 2 + 0.3, std("#3A3A3A", 0.6)); // 配重底座
  cyl(g, 0.06, 0.07, 3.3, 0, 0.15, -d / 2 + 0.15, steel, 12); // 立柱
  box(g, 0.08, 0.08, 0.5, 0, 3.4, -d / 2 + 0.32, steel); // 伸臂
  box(g, 1.05, 0.75, 0.05, 0, 3.05, 0.1, boardM); // 篮板
  box(g, 0.45, 0.4, 0.01, 0, 3.18, 0.13, std("#C02020", 0.6)); // 篮板内框线
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.015, 8, 24), std("#C06020", 0.4, 0.7));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 3.05, 0.32);
  add(g, rim);
  cone(g, 0.2, 0.3, 0, 2.75, 0.32, new THREE.MeshStandardMaterial({
    color: "#F5F5F0", roughness: 0.9, transparent: true, opacity: 0.55,
  }), 12); // 篮网
}

/** 足球门：两立柱 + 横梁 + 球网（半透明网面）。 */
function buildGoalPost(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const post = std(c || "#F5F5F0", 0.5);
  const net = new THREE.MeshStandardMaterial({
    color: "#FFFFFF", roughness: 0.9, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
  });
  for (const sx of [-1, 1]) {
    cyl(g, 0.05, 0.05, h, sx * (w / 2 - 0.05), 0, 0, post, 10);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, w - 0.1, 10), post);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, h - 0.05, 0);
  add(g, bar);
  // 球网：后网 + 两侧 + 顶网
  box(g, w - 0.1, h - 0.1, 0.02, 0, 0, -d / 2 + 0.05, net);
  box(g, 0.02, h - 0.1, d - 0.1, -w / 2 + 0.05, 0, 0, net);
  box(g, 0.02, h - 0.1, d - 0.1, w / 2 - 0.05, 0, 0, net);
  box(g, w - 0.1, 0.02, d - 0.1, 0, h - 0.1, 0, net);
}

/** 田径跑道：红色塑胶道面 + 白色分道线（平铺地面垫）。 */
function buildTrackLane(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const track = std(c || "#B0503A", 0.95);
  const line = std("#F5F5F0", 0.9);
  box(g, w, h, d, 0, 0, 0, track);
  for (let i = 0; i <= 4; i++) {
    const z = -d / 2 + (d * i) / 4;
    box(g, w * 0.98, 0.005, 0.05, 0, h, z, line);
  }
  // 起跑线（横向白线）
  box(g, 0.06, 0.005, d * 0.96, -w * 0.42, h, 0, line);
}

/** 停车挡：水泥车位挡块 + 黄色警示条。 */
function buildParkingStop(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const concrete = std(c || "#9A9A9A", 0.95);
  box(g, w, h * 0.85, d, 0, 0, 0, concrete);
  box(g, w * 0.96, h * 0.15, d * 0.96, 0, h * 0.85, 0, std("#C8A020", 0.8));
}

/** 户外长椅：木条座面 + 靠背 + 铁架。 */
function buildOutdoorBench(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.8);
  const iron = std("#3A3A3A", 0.5, 0.6);
  box(g, w, 0.06, d * 0.8, 0, 0.42, d * 0.05, wood); // 座面
  box(g, w, 0.4, 0.05, 0, 0.48, -d / 2 + 0.04, wood); // 靠背
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.12);
    box(g, 0.06, 0.42, 0.06, x, 0, d * 0.28, iron); // 前腿
    box(g, 0.06, 0.88, 0.06, x, 0, -d / 2 + 0.06, iron); // 后腿兼靠背支柱
    box(g, 0.06, 0.05, d * 0.8, x, 0.2, 0, iron); // 侧撑
  }
}

/** 总裁大班台：大桌面 + 皮面嵌 + 两侧抽屉柜 + 前挡板。 */
function buildCeoDesk(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.55);
  const dark = std("#2A2018", 0.7);
  box(g, w, 0.05, d, 0, h - 0.05, 0, wood); // 桌面
  box(g, w * 0.64, 0.012, d * 0.6, 0, h - 0.038, 0, std("#1A3A2A", 0.9)); // 皮面嵌
  box(g, w * 0.92, h * 0.78, 0.04, 0, 0.08, -d / 2 + 0.05, dark); // 前挡板
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.28);
    box(g, 0.52, h - 0.1, d * 0.9, x, 0, 0, wood); // 抽屉柜
    for (let i = 0; i < 3; i++) {
      box(g, 0.46, 0.16, 0.02, x, 0.12 + i * 0.2, d * 0.45 + 0.005, std("#6A4A2A", 0.65));
      box(g, 0.1, 0.02, 0.02, x, 0.2 + i * 0.2, d * 0.45 + 0.015, std("#C8A24A", 0.4, 0.8));
    }
  }
}

/** 会议长桌：长桌 + 板式桌腿 + 线盒 + 两支话筒。 */
function buildMeetingTable(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.55);
  const dark = std("#3A3A3A", 0.5, 0.5);
  box(g, w, 0.05, d, 0, h - 0.05, 0, wood); // 桌面
  for (const sx of [-1, 1]) {
    box(g, 0.08, h - 0.05, d * 0.85, sx * (w / 2 - 0.25), 0, 0, dark);
  }
  box(g, 0.6, 0.05, 0.3, 0, h - 0.025, 0, dark); // 线盒
  for (const sx of [-1, 1]) {
    const x = sx * w * 0.22;
    cyl(g, 0.012, 0.012, 0.14, x, h, 0, dark, 8); // 话筒杆
    sphere(g, 0.03, x, h + 0.16, 0, dark); // 话筒头
  }
}

/** 前台接待台：高前挡 + 台面 + 背面工作台 + 金色标识板。 */
function buildReceptionDesk(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const front = std(c, 0.6);
  const stone = std("#E8E4DC", 0.4);
  box(g, w, 1.1, 0.06, 0, 0, d / 2 - 0.03, front); // 前挡
  box(g, w, 0.05, d, 0, 1.1, 0, stone); // 台面
  box(g, w * 0.86, 0.71, 0.5, 0, 0, -d / 2 + 0.28, std("#5A4A3A", 0.7)); // 背面工作台
  // 金色标识板（前挡中央）
  box(g, w * 0.4, 0.25, 0.02, 0, 0.55, d / 2 + 0.01, std("#C8A24A", 0.35, 0.85));
  box(g, w * 0.3, 0.04, 0.022, 0, 0.55, d / 2 + 0.012, std("#2A2A2A", 0.5));
}

/**
 * 电梯轿厢：轿厢本身即围合（不锈钢门 + 后墙镜 + 扶手 + 按钮盘 +
 * 顶灯）。放在四墙隐藏的房间里，轿厢就是房间的墙。
 */
function buildElevatorCar(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const steel = std(c || "#B8B8B8", 0.35, 0.8);
  const darkSteel = std("#8A8A8A", 0.4, 0.8);
  const mirror = new THREE.MeshStandardMaterial({
    color: "#DCE4E8", roughness: 0.06, metalness: 1,
  });
  box(g, w, 0.04, d, 0, 0, 0, darkSteel); // 轿底
  box(g, w, 0.04, d, 0, h - 0.04, 0, steel); // 轿顶
  box(g, w, h, 0.05, 0, 0, -d / 2 + 0.025, steel); // 后墙
  box(g, 0.05, h, d, -w / 2 + 0.025, 0, 0, steel); // 左墙
  box(g, 0.05, h, d, w / 2 - 0.025, 0, 0, steel); // 右墙
  // 前门：两扇闭合不锈钢门 + 中缝
  box(g, w / 2 - 0.03, h - 0.08, 0.04, -w / 4, 0.04, d / 2 - 0.02, steel);
  box(g, w / 2 - 0.03, h - 0.08, 0.04, w / 4, 0.04, d / 2 - 0.02, steel);
  box(g, 0.02, h - 0.08, 0.045, 0, 0.04, d / 2 - 0.02, darkSteel);
  // 后墙镜 + 扶手
  box(g, w * 0.6, h * 0.7, 0.02, 0, h * 0.22, -d / 2 + 0.06, mirror);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, w * 0.86, 10), darkSteel);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 0.9, -d / 2 + 0.12);
  add(g, rail);
  // 右墙按钮盘（楼层钮 ×4 + 开关门）
  box(g, 0.03, 0.4, 0.15, w / 2 - 0.06, 1.0, d * 0.28, darkSteel);
  for (let i = 0; i < 4; i++) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.015, 10), std(i === 0 ? "#C02020" : "#E8E8E8", 0.4));
    btn.rotation.z = Math.PI / 2;
    btn.position.set(w / 2 - 0.08, 1.08 + i * 0.08, d * 0.28);
    add(g, btn);
  }
  // 顶灯（微发光）
  box(g, w * 0.4, 0.02, d * 0.22, 0, h - 0.06, 0, glow("#FFFFFF", "#FFF2CC", 0.8));
}

/** 茶水间柜台：柜体 + 水槽 + 龙头 + 电水壶 + 微波炉 + 杯子。 */
function buildPantryCounter(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const body = std(c, 0.7);
  const steel = std("#C8C8C8", 0.35, 0.7);
  box(g, w, 0.86, d, 0, 0, 0, body); // 柜体
  box(g, w, 0.04, d * 1.03, 0, 0.86, 0, std("#E8E4DC", 0.4)); // 台面
  // 水槽（左）+ 龙头
  box(g, 0.6, 0.02, 0.4, -w * 0.25, 0.9, 0, std("#5A5A5A", 0.5, 0.5));
  cyl(g, 0.015, 0.015, 0.18, -w * 0.25, 0.9, -d * 0.28, steel, 8);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8), steel);
  spout.rotation.x = Math.PI / 2;
  spout.position.set(-w * 0.25, 1.06, -d * 0.18);
  add(g, spout);
  // 电水壶（中）
  cyl(g, 0.08, 0.09, 0.2, 0, 0.9, 0, std("#2A2A2A", 0.5, 0.3), 14);
  cyl(g, 0.045, 0.05, 0.03, 0, 1.1, 0, steel, 12);
  // 微波炉（右）
  box(g, 0.5, 0.3, 0.35, w * 0.28, 0.9, 0, std("#E8E8E8", 0.4, 0.3));
  box(g, 0.34, 0.2, 0.02, w * 0.28, 0.95, d * 0.18, std("#2A2A2A", 0.3));
  // 杯子 ×3
  for (let i = 0; i < 3; i++) {
    cyl(g, 0.035, 0.03, 0.08, -w * 0.05 + i * 0.14, 0.9, d * 0.28, std(["#C03028", "#2A4A6A", "#3A5A3A"][i], 0.6), 10);
  }
}

/** 白板：白板面 + 铝框 + 笔槽 + 两支白板笔（挂墙，见 allowlist）。 */
function buildWhiteboard(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const board = std(c || "#F5F5F0", 0.5);
  const frame = std("#9A9A9A", 0.4, 0.7);
  box(g, w, h, 0.03, 0, 0, 0, board);
  box(g, w, 0.04, d, 0, -0.02, 0, frame);
  box(g, w, 0.04, d, 0, h - 0.02, 0, frame);
  box(g, 0.04, h, d, -w / 2 + 0.02, 0, 0, frame);
  box(g, 0.04, h, d, w / 2 - 0.02, 0, 0, frame);
  box(g, w * 0.6, 0.03, 0.07, 0, -0.03, d / 2 + 0.01, frame); // 笔槽
  for (const [mx, mc] of [[-0.15, "#C02020"], [-0.05, "#2A2A2A"]] as Array<[number, string]>) {
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), std(mc, 0.6));
    marker.rotation.z = Math.PI / 2;
    marker.position.set(mx * w, -0.01, d / 2 + 0.02);
    add(g, marker);
  }
  // 板书字迹（几道灰线示意）
  box(g, w * 0.5, 0.015, 0.006, -w * 0.1, h * 0.65, d / 2 + 0.004, std("#8A8A8A", 0.8));
  box(g, w * 0.35, 0.015, 0.006, -w * 0.15, h * 0.45, d / 2 + 0.004, std("#8A8A8A", 0.8));
}

/** 案情板：软木板 + 照片卡 + 红线串联（挂墙，见 allowlist）。 */
function buildEvidenceBoard(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const cork = std(c || "#B08A5A", 0.95);
  const frame = std("#5A3A22", 0.7);
  box(g, w, h, 0.03, 0, 0, 0, cork);
  box(g, w, 0.04, d, 0, -0.02, 0, frame);
  box(g, w, 0.04, d, 0, h - 0.02, 0, frame);
  box(g, 0.04, h, d, -w / 2 + 0.02, 0, 0, frame);
  box(g, 0.04, h, d, w / 2 - 0.02, 0, 0, frame);
  // 6 张照片卡（白底 + 深色人像剪影块）
  const spots: Array<[number, number]> = [
    [-0.32, 0.68], [0, 0.72], [0.32, 0.66],
    [-0.3, 0.3], [0.05, 0.26], [0.33, 0.32],
  ];
  const red = std("#C02020", 0.6);
  for (const [fx, fy] of spots) {
    const x = fx * w, y = fy * h;
    box(g, 0.2, 0.26, 0.012, x, y, d / 2 + 0.004, std("#F5F5F0", 0.8));
    box(g, 0.12, 0.14, 0.004, x, y + 0.04, d / 2 + 0.012, std("#3A3A3A", 0.8));
    sphere(g, 0.012, x, y + 0.14, d / 2 + 0.014, red); // 图钉
  }
  // 红线：两段对角连线（薄盒旋转）
  const line1 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.008, 0.008), red);
  line1.position.set(-w * 0.08, h * 0.55, d / 2 + 0.014);
  line1.rotation.z = 0.5;
  add(g, line1);
  const line2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.008, 0.008), red);
  line2.position.set(w * 0.12, h * 0.42, d / 2 + 0.014);
  line2.rotation.z = -0.35;
  add(g, line2);
}

/** 酒吧吧台：高前挡 + 台面 + 背架酒瓶（两层）+ 脚踏杆。 */
function buildBarCounter(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const front = std(c, 0.55);
  box(g, w, 1.05, 0.06, 0, 0, d / 2 - 0.03, front); // 前挡
  box(g, w, 0.05, d, 0, 1.05, 0, std("#2A2018", 0.5)); // 台面
  // 背架：两根立柱（立于台面）+ 一层层板 + 两层酒瓶
  for (const sx of [-1, 1]) {
    box(g, 0.04, 0.3, 0.04, sx * (w / 2 - 0.06), 1.1, -d / 2 + 0.12, std("#3A2A1A", 0.7));
  }
  box(g, w * 0.9, 0.03, 0.22, 0, 1.28, -d / 2 + 0.12, std("#3A2A1A", 0.7)); // 层板
  const bottleColors = ["#2A5A2A", "#5A3A1A", "#3A3A2A", "#7A2A2A"];
  for (let i = 0; i < 4; i++) {
    const x = -w * 0.36 + i * w * 0.24;
    cyl(g, 0.04, 0.045, 0.22, x, 1.1, -d / 2 + 0.12, std(bottleColors[i], 0.3, 0.2), 10); // 台面一层
    cyl(g, 0.035, 0.04, 0.18, x + w * 0.06, 1.31, -d / 2 + 0.12, std(bottleColors[(i + 2) % 4], 0.3, 0.2), 10); // 层板二层
  }
  // 台面酒杯 ×3
  for (let i = 0; i < 3; i++) {
    cyl(g, 0.035, 0.03, 0.1, -w * 0.25 + i * w * 0.25, 1.1, d * 0.15, std("#D8C890", 0.3), 10);
  }
  // 脚踏杆（前沿）
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, w * 0.94, 10), std("#C8A24A", 0.4, 0.8));
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 0.15, d / 2 + 0.05);
  add(g, rail);
}

/** 法官席：高台 + 法官桌 + 前挡板 + 法槌。 */
function buildJudgeBench(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.6);
  const dark = std("#2A2018", 0.7);
  box(g, w, 0.25, d, 0, 0, 0, wood); // 高台
  box(g, w * 0.94, 0.75, d * 0.78, 0, 0.25, -d * 0.06, wood); // 桌身
  box(g, w, 0.05, d * 0.84, 0, 1.0, -d * 0.06, dark); // 桌面
  box(g, w, 1.0, 0.05, 0, 0.25, d / 2 - 0.025, dark); // 前挡板
  box(g, w * 0.3, 0.12, 0.02, 0, 0.7, d / 2 + 0.005, std("#C8A24A", 0.35, 0.85)); // 铭牌
  // 法槌 + 槌座（桌面）
  cyl(g, 0.04, 0.04, 0.12, -w * 0.3, 1.05, 0, dark, 10);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 8), dark);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(-w * 0.3 + 0.16, 1.07, 0);
  add(g, handle);
  cyl(g, 0.06, 0.07, 0.02, -w * 0.15, 1.05, 0, wood, 12); // 槌座
}

/** 证人席：小高台 + 围栏 + 座位 + 话筒。 */
function buildWitnessStand(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c, 0.6);
  box(g, w, 0.2, d, 0, 0, 0, wood); // 高台
  box(g, w, 0.5, 0.05, 0, 0.7, d / 2 - 0.025, wood); // 前围栏
  box(g, 0.05, 0.5, d, -w / 2 + 0.025, 0.7, 0, wood); // 侧栏
  box(g, 0.05, 0.5, d, w / 2 - 0.025, 0.7, 0, wood);
  box(g, w * 0.6, 0.06, d * 0.5, 0, 0.55, -d * 0.15, std("#5A3A22", 0.7)); // 座位
  box(g, w * 0.6, 0.4, 0.05, 0, 0.61, -d / 2 + 0.05, std("#5A3A22", 0.7)); // 靠背
  cyl(g, 0.012, 0.012, 0.14, -w * 0.25, 1.2, d * 0.3, std("#2A2A2A", 0.5), 8); // 话筒
  sphere(g, 0.025, -w * 0.25, 1.28, d * 0.3, std("#2A2A2A", 0.5));
}

/** 跑步机：跑带底座 + 立柱 + 控制台 + 扶手。 */
function buildGymTreadmill(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const frame = std(c || "#2A2A2A", 0.5, 0.4);
  const belt = std("#1A1A1A", 0.9);
  box(g, w * 0.88, 0.12, d * 0.88, 0, 0, 0, frame); // 底座
  box(g, w * 0.75, 0.02, d * 0.78, 0, 0.12, 0, belt); // 跑带
  for (const sx of [-1, 1]) {
    cyl(g, 0.03, 0.03, 1.15, sx * w * 0.38, 0.1, -d / 2 + 0.12, frame, 10); // 立柱
    box(g, 0.04, 0.04, d * 0.62, sx * w * 0.38, 0.88, d * 0.05, frame); // 侧扶手
  }
  const console = box(g, w * 0.75, 0.32, 0.08, 0, 1.22, -d / 2 + 0.12, std("#3A3A3A", 0.4, 0.5));
  console.rotation.x = -0.28;
  box(g, w * 0.5, 0.14, 0.02, 0, 1.26, -d / 2 + 0.16, glow("#2A4A6A", "#3A6A9A", 0.7)); // 显示屏
}

/** 卧推凳：卧推凳 + 杠铃架 + 杠铃 + 杠铃片。 */
function buildGymBench(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const frame = std(c || "#3A3A3A", 0.5, 0.6);
  const pad = std("#2A2A2A", 0.9);
  box(g, w * 0.92, 0.08, 0.4, 0, 0.37, 0, pad); // 凳面
  for (const sx of [-1, 1]) {
    box(g, 0.06, 0.37, 0.06, sx * w * 0.42, 0, 0, frame); // 凳腿
  }
  // 杠铃架立柱（床头端 x=-0.5）
  for (const sz of [-1, 1]) {
    box(g, 0.05, 0.55, 0.05, -w * 0.42, 0, sz * d * 0.38, frame);
  }
  // 杠铃杆（沿 z）+ 杠铃片
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, d * 0.92, 10), std("#C8C8C8", 0.35, 0.8));
  bar.rotation.x = Math.PI / 2;
  bar.position.set(-w * 0.42, 0.55, 0);
  add(g, bar);
  for (const sz of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 20), std("#1A1A1A", 0.6, 0.4));
    plate.rotation.x = Math.PI / 2;
    plate.position.set(-w * 0.42, 0.55, sz * d * 0.42);
    add(g, plate);
  }
}

/** 哑铃架：两层架 + 6 对哑铃。 */
function buildDumbbellRack(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const frame = std(c || "#3A3A3A", 0.5, 0.6);
  for (const sx of [-1, 1]) {
    box(g, 0.05, h, d, sx * (w / 2 - 0.025), 0, 0, frame); // 侧框
  }
  const tiers: Array<[number, number]> = [[0.28, 0], [0.62, 0]];
  for (const [y] of tiers) {
    box(g, w, 0.04, d * 0.9, 0, y, 0, frame);
  }
  // 哑铃：横杆（沿 z）+ 两端球头
  const iron = std("#1A1A1A", 0.55, 0.5);
  for (let t = 0; t < 2; t++) {
    const y = tiers[t][0] + 0.06;
    for (let i = 0; i < 3; i++) {
      const x = -w * 0.3 + i * w * 0.3;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), iron);
      b.rotation.x = Math.PI / 2;
      b.position.set(x, y, 0);
      add(g, b);
      sphere(g, 0.06, x, y, -0.15, iron);
      sphere(g, 0.06, x, y, 0.15, iron);
    }
  }
}

/** 超市货架：双面货架 + 四层 + 商品盒。 */
function buildSupermarketShelf(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const frame = std(c || "#5A6A7A", 0.5, 0.4);
  const t = 0.04;
  box(g, t, h, d, -w / 2 + t / 2, 0, 0, frame); // 侧板
  box(g, t, h, d, w / 2 - t / 2, 0, 0, frame);
  box(g, w, 0.1, d, 0, 0, 0, frame); // 底座
  box(g, w, t, d, 0, h - t, 0, frame); // 顶板
  const shelfY = [0.35, 0.7, 1.05, 1.4];
  const goods = ["#C03028", "#2A6A2A", "#C8A020", "#2A4A8A", "#E8E8E8", "#8B2010"];
  for (const y of shelfY) {
    box(g, w - 2 * t, 0.03, d - 0.04, 0, y, 0, frame);
    for (const sz of [-1, 1]) {
      let x = -w / 2 + 0.2;
      let i = 0;
      while (x < w / 2 - 0.35) {
        const gw = 0.24 + (i % 2) * 0.06;
        const gh = 0.16 + (i % 3) * 0.05;
        box(g, gw, gh, 0.16, x + gw / 2, y + 0.03, sz * (d / 2 - 0.12), std(goods[i % goods.length], 0.7));
        x += gw + 0.04;
        i++;
      }
    }
    // 价签条
    box(g, w - 2 * t, 0.03, 0.012, 0, y + 0.015, d / 2 - 0.01, std("#F5D020", 0.7));
    box(g, w - 2 * t, 0.03, 0.012, 0, y + 0.015, -d / 2 + 0.01, std("#F5D020", 0.7));
  }
}

/** 收银台：传送带 + 扫描区 + 打包区 + 收银屏。 */
function buildCheckoutCounter(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const body = std(c || "#8A8A8A", 0.5, 0.4);
  const belt = std("#1A1A1A", 0.9);
  box(g, w * 0.6, 0.85, d * 0.66, -w * 0.18, 0, -d * 0.12, body); // 主柜（传送带段）
  box(g, w * 0.6, 0.03, d * 0.6, -w * 0.18, 0.85, -d * 0.12, belt); // 传送带
  box(g, w * 0.32, 0.85, d * 0.66, w * 0.32, 0, -d * 0.12, std("#5A5A5A", 0.5, 0.4)); // 打包区
  // 分隔杆
  cyl(g, 0.02, 0.02, 0.3, w * 0.1, 0.88, -d * 0.12, std("#C8A24A", 0.4, 0.8), 8);
  // 收银屏（立柱 + 屏）
  cyl(g, 0.025, 0.025, 0.25, -w * 0.42, 0.88, -d * 0.3, body, 8);
  box(g, 0.34, 0.26, 0.02, -w * 0.42, 1.12, -d * 0.3, glow("#2A4A6A", "#3A6A9A", 0.6));
  // 商品 ×2 在传送带上
  box(g, 0.18, 0.14, 0.12, -w * 0.05, 0.88, -d * 0.12, std("#C03028", 0.7));
  box(g, 0.14, 0.2, 0.12, w * 0.08, 0.88, -d * 0.05, std("#2A6A2A", 0.7));
}

/** 购物车：筐体 + 把手 + 四轮。 */
function buildShoppingCart(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const frame = std(c || "#8A8A8A", 0.4, 0.7);
  box(g, w * 0.84, 0.02, d * 0.78, 0, 0.55, 0, frame); // 筐底
  box(g, 0.02, 0.35, d * 0.78, -w * 0.42, 0.55, 0, frame); // 筐侧
  box(g, 0.02, 0.35, d * 0.78, w * 0.42, 0.55, 0, frame);
  box(g, w * 0.84, 0.35, 0.02, 0, 0.55, -d * 0.39, frame); // 筐端
  box(g, w * 0.84, 0.35, 0.02, 0, 0.55, d * 0.39, frame);
  // 把手
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, w * 0.8, 8), frame);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, 0.95, d / 2 + 0.02);
  add(g, handle);
  // 腿 + 轮
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    box(g, 0.03, 0.55, 0.03, sx * w * 0.35, 0, sz * d * 0.32, frame);
    sphere(g, 0.04, sx * w * 0.35, 0.04, sz * d * 0.32, std("#2A2A2A", 0.6));
  }
  // 筐内商品 ×2
  box(g, 0.2, 0.16, 0.16, -w * 0.12, 0.57, 0, std("#C03028", 0.7));
  box(g, 0.16, 0.2, 0.14, w * 0.15, 0.57, -d * 0.08, std("#2A6A2A", 0.7));
}

/** KTV 大屏：大屏 + 发光屏面 + 边框（挂墙，见 allowlist）。 */
function buildKtvScreen(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const frame = std("#1A1A1A", 0.4);
  box(g, w, h, 0.04, 0, 0, 0, frame);
  box(g, w * 0.96, h * 0.94, 0.012, 0, h * 0.03, d / 2 + 0.004, glow("#1A2A4A", "#2A4A8A", 0.9));
  // 歌词行（亮色横条示意）
  box(g, w * 0.5, 0.04, 0.006, -w * 0.1, h * 0.55, d / 2 + 0.012, std("#F5F5F0", 0.8));
  box(g, w * 0.35, 0.04, 0.006, -w * 0.18, h * 0.42, d / 2 + 0.012, std("#F5D020", 0.8));
  box(g, w * 0.6, 0.03, 0.006, -w * 0.05, h * 0.3, d / 2 + 0.012, std("#8AB0E8", 0.8));
}

/** 婚礼拱门：双柱 + 顶梁 + 花球 + 飘带。 */
function buildWeddingArch(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const post = std(c || "#F5F0E8", 0.7);
  const flower = std("#E8A0B0", 0.9);
  const leaf = std("#3A5A3A", 0.9);
  for (const sx of [-1, 1]) {
    box(g, 0.08, h * 0.96, 0.08, sx * (w / 2 - 0.06), 0, 0, post);
  }
  box(g, w, 0.12, 0.12, 0, h * 0.96, 0, post); // 顶梁
  // 花球：沿顶梁 ×5 + 柱顶 ×2
  for (let i = 0; i < 5; i++) {
    const x = -w * 0.36 + i * w * 0.18;
    sphere(g, 0.13, x, h * 0.96 + 0.06, 0, i % 2 === 0 ? flower : std("#F5F5F0", 0.9));
    sphere(g, 0.08, x, h * 0.96 - 0.08, 0.08, leaf);
  }
  sphere(g, 0.14, -w / 2 + 0.06, h * 0.96 + 0.08, 0, flower);
  sphere(g, 0.14, w / 2 - 0.06, h * 0.96 + 0.08, 0, flower);
  // 飘带 ×3（顶梁垂下）
  for (const fx of [-0.25, 0, 0.25]) {
    box(g, 0.07, 0.5, 0.01, fx * w, h * 0.9 - 0.25, 0.08, std("#F5E8D8", 0.9));
  }
}

/** 婚礼舞台：低台 + 背景纱幔 + 顶梁。 */
function buildWeddingStage(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const platform = std(c || "#F5F0E8", 0.7);
  box(g, w, 0.4, d, 0, 0, 0, platform); // 低台
  box(g, w * 0.98, 0.02, d * 0.98, 0, 0.4, 0, std("#FFFFFF", 0.9)); // 台面
  // 背景架：两立柱 + 顶梁 + 纱幔
  for (const sx of [-1, 1]) {
    box(g, 0.08, h - 0.4, 0.08, sx * (w / 2 - 0.3), 0.4, -d / 2 + 0.08, std("#C8A24A", 0.4, 0.8));
  }
  box(g, w - 0.6, 0.15, 0.1, 0, h - 0.15, -d / 2 + 0.08, std("#C8A24A", 0.4, 0.8));
  box(g, w - 0.6, h - 0.7, 0.02, 0, 0.5, -d / 2 + 0.06, new THREE.MeshStandardMaterial({
    color: "#F5E8E8", roughness: 0.9, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
  }));
  // 台上花球 ×2
  sphere(g, 0.15, -w * 0.3, 0.55, d * 0.2, std("#E8A0B0", 0.9));
  sphere(g, 0.15, w * 0.3, 0.55, d * 0.2, std("#F5F5F0", 0.9));
}

/** 灶台面板：黑色玻璃面板 + 四个炉头圈（放橱柜上，elevationY=柜高）。 */
function buildCooktop(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const glass = std(c || "#1A1A1A", 0.25, 0.3);
  box(g, w, h * 0.8, d, 0, 0, 0, glass);
  for (const [sx, sz, r] of [[-1, -1, 0.09], [1, -1, 0.09], [-1, 1, 0.07], [1, 1, 0.07]] as Array<[number, number, number]>) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 8, 24), std("#3A3A3A", 0.4, 0.7));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(sx * w * 0.24, h * 0.8 + 0.004, sz * d * 0.24);
    add(g, ring);
  }
}

// ─── 繁荣/衰败成对场景（第 5 批）─────────────────────────────────────────
// 衰败态通用件：瓦砾、断裂家具、蛛网、杂草、坍塌墙、焦梁、枯树、倒塌柱；
// 繁荣态通用件：集市摊位、灯笼杆、罗马柱、牌楼、石井、太湖石、倒塌货架
// （倒塌货架是衰败态的商场件，归在此批）。
// 倾斜件的角度都按声明尺寸反推过：包围盒落在 w/d/h 的 15%+10cm 容差内
// （harness 第 1 节会逐件验算）。

/** 瓦砾堆：碎石板 + 断砖 + 碎瓦， deterministic 摆法（可复现）。 */
function buildRubblePile(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const grey = std("#8A8378", 0.95);
  const dark = std("#5A5348", 0.95);
  const brick = std("#8A4A30", 0.9);
  const tile = std("#4A3A30", 0.9);
  box(g, w * 0.94, 0.08, d * 0.94, 0, 0, 0, grey); // 底板
  const chunks: Array<[number, number, number, number, number, number, Mat]> = [
    [0.42, 0.16, 0.4, -0.4, 0.08, -0.35, grey],
    [0.5, 0.2, 0.44, 0.35, 0.08, -0.3, dark],
    [0.38, 0.14, 0.36, -0.1, 0.08, 0.35, brick],
    [0.44, 0.18, 0.4, 0.42, 0.08, 0.32, grey],
    [0.36, 0.2, 0.34, -0.05, 0.24, -0.05, dark],
    [0.3, 0.14, 0.3, 0.3, 0.26, 0.05, tile],
    [0.28, 0.12, 0.26, -0.35, 0.26, 0.2, grey],
  ];
  for (const [sx, sy, sz, cx, y0, cz, m] of chunks) box(g, sx, sy, sz, cx, y0, cz, m);
  cone(g, 0.16, 0.22, 0.05, 0.42, -0.35, tile); // 碎瓦尖
  box(g, 0.3, 0.1, 0.24, 0.1, 0.42, 0.28, brick); // 顶层断砖
}

/** 断裂桌案：桌面倾斜 10° + 缺一条腿（断茬）+ 一条断腿横在桌下。 */
function buildBrokenTable(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#6A4A2A", 0.7);
  const dark = std("#3A2A1A", 0.8);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), wood);
  top.position.set(0, h - 0.05, 0);
  top.rotation.x = -0.17; // 前沿下沉约 10°
  add(g, top);
  const legH = h - 0.1;
  const hx = w / 2 - 0.06, hz = d / 2 - 0.06;
  box(g, 0.06, legH, 0.06, -hx, 0, -hz, wood);
  box(g, 0.06, legH, 0.06, hx, 0, -hz, wood);
  box(g, 0.06, legH, 0.06, -hx, 0, hz, wood);
  box(g, 0.06, 0.22, 0.06, hx, 0, hz, dark); // 断茬短桩（第四条腿只剩一截）
  box(g, legH, 0.06, 0.06, 0.05, 0.03, -hz + 0.02, dark); // 断腿横在桌下（沿 X 向）
}

/** 断裂椅子：座面微斜 + 靠背歪斜 + 缺一条腿。 */
function buildBrokenChair(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#6A4A2A", 0.7);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.05, d * 0.88), wood);
  seat.position.set(0, 0.42, 0);
  seat.rotation.z = 0.12; // 座面微斜
  add(g, seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.42, 0.04), wood);
  back.position.set(0.02, 0.66, -d / 2 + 0.04);
  back.rotation.z = 0.1; // 靠背歪斜
  add(g, back);
  box(g, 0.05, 0.42, 0.05, -w / 2 + 0.06, 0, -d / 2 + 0.06, wood);
  box(g, 0.05, 0.42, 0.05, w / 2 - 0.06, 0, -d / 2 + 0.06, wood);
  box(g, 0.05, 0.42, 0.05, -w / 2 + 0.06, 0, d / 2 - 0.06, wood);
  box(g, 0.05, 0.14, 0.05, w / 2 - 0.06, 0, d / 2 - 0.06, std("#3A2A1A", 0.8)); // 断腿短桩
}

/** 蛛网：墙角扇形网（挂墙件，harness 白名单，elevationY 挂墙）。 */
function buildCobweb(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const web = std("#D8D8D8", 0.9);
  const cx = -w / 2 + 0.02, cy = 0.02; // 扇形原点：左下角
  const spokes: Array<[number, number]> = [[0.35, 0.5], [0.7, 0.42], [1.05, 0.55], [1.35, 0.7], [1.57, 0.78]];
  for (const [ang, len] of spokes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.012), web);
    m.position.set(cx + (len / 2) * Math.cos(ang), cy + (len / 2) * Math.sin(ang), 0);
    m.rotation.z = ang;
    add(g, m);
  }
  // 两道弧：用短直段近似
  for (const r of [0.3, 0.55]) {
    for (let i = 0; i < 4; i++) {
      const a0 = 0.35 + i * 0.3, a1 = a0 + 0.3;
      const mx = cx + r * Math.cos((a0 + a1) / 2), my = cy + r * Math.sin((a0 + a1) / 2);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(r * 0.3 + 0.02, 0.01, 0.01), web);
      seg.position.set(mx, my, 0);
      seg.rotation.z = (a0 + a1) / 2 + Math.PI / 2;
      add(g, seg);
    }
  }
}

/** 杂草丛：枯黄草叶 + 土丘。 */
function buildWeedClump(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const dry = std("#8A8A4A", 0.95);
  const green = std("#5A6A3A", 0.95);
  const brown = std("#7A6A3A", 0.95);
  box(g, w * 0.7, 0.08, d * 0.7, 0, 0, 0, std("#6A5A42", 0.95)); // 土丘
  const blades: Array<[number, number, number, number, number, Mat]> = [
    [0, 0, 0.6, 0, 0, dry], [0.12, 0.1, 0.5, 0.2, 0.1, green],
    [-0.12, -0.08, 0.55, -0.18, -0.12, dry], [0.08, -0.14, 0.45, 0.15, -0.2, brown],
    [-0.06, 0.14, 0.48, -0.1, 0.18, green], [0.16, 0.02, 0.4, 0.22, 0.05, dry],
    [-0.16, 0.05, 0.42, -0.22, 0.08, brown], [0.03, 0.18, 0.38, 0.05, 0.25, green],
  ];
  for (const [bx, bz, len, tx, tz, m] of blades) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.025, len, 6), m);
    blade.position.set(bx + tx / 2, 0.06 + len / 2, bz + tz / 2);
    blade.rotation.z = -tx / len;
    blade.rotation.x = tz / len;
    add(g, blade);
  }
}

/** 坍塌墙段：矮墙基 + 高低错落的断墙头 + 露砖。 */
function buildBrokenWall(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const plaster = std(c || "#B8A894", 0.95);
  const brick = std("#8A4A30", 0.9);
  box(g, w, 0.5, d * 0.9, 0, 0, 0, plaster); // 墙基
  const tops: Array<[number, number, number]> = [
    [-0.75, 0.4, 0.45], [-0.25, 0.6, 0.45], [0.25, 0.3, 0.45], [0.75, 0.5, 0.45],
  ];
  for (const [cx, th, tw] of tops) box(g, tw, th, d * 0.9, cx, 0.5, 0, plaster);
  box(g, 0.3, 0.28, 0.02, -0.25, 0.55, d * 0.45 + 0.005, brick); // 露砖补丁
  box(g, 0.24, 0.2, 0.02, 0.75, 0.55, d * 0.45 + 0.005, brick);
  box(g, 0.2, 0.16, 0.02, 0.1, 0.6, -d * 0.45 - 0.005, brick);
}

/** 集市摊位：柜台 + 四柱 + 顶篷 + 前布 + 柜上货物（货物做进件内，不另摆小件）。 */
function buildMarketStall(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std("#7A5A38", 0.7);
  const cloth = std(c || "#A03028", 0.85);
  const post = std("#5A3A22", 0.7);
  box(g, w * 0.95, 0.85, d * 0.75, 0, 0, 0, wood); // 柜台
  box(g, w * 0.95, 0.6, 0.03, 0, 0.12, d * 0.38, cloth); // 前布
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(g, 0.07, 2.2, 0.07, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), post);
  }
  box(g, w, 0.06, d, 0, 2.2, 0, cloth); // 顶篷
  box(g, w, 0.22, 0.03, 0, 1.98, d / 2 - 0.02, cloth); // 篷沿
  const goods = ["#C03028", "#2A6A2A", "#C8A020", "#2A4A8A", "#E8E8E8", "#8B2010"];
  for (let i = 0; i < 6; i++) {
    const gx = -w * 0.36 + i * w * 0.145;
    box(g, 0.22, 0.16 + (i % 3) * 0.05, 0.2, gx, 0.85, -0.1 + (i % 2) * 0.25, std(goods[i % goods.length], 0.7));
  }
  box(g, 0.3, 0.12, 0.24, -w * 0.3, 0.85, 0.28, std("#D8B060", 0.7));
  box(g, 0.26, 0.18, 0.22, w * 0.32, 0.85, -0.28, std("#2A6A2A", 0.7));
}

/** 灯笼杆：立柱 + 横挑 + 垂挂红灯笼（发光）。 */
function buildLanternPole(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const pole = std("#3A2A1A", 0.7);
  box(g, 0.4, 0.15, 0.4, 0, 0, 0, std("#6A6A6A", 0.6)); // 底座
  cyl(g, 0.05, 0.06, 2.9, 0, 0.15, 0, pole, 10);
  box(g, 0.5, 0.06, 0.06, 0, 2.78, 0, pole); // 横挑
  cyl(g, 0.008, 0.008, 0.1, 0.22, 2.68, 0, pole, 6); // 垂绳
  const red = glow("#C03028", "#A02020", 0.9);
  const gold = std("#C8A24A", 0.4, 0.8);
  const body = lathe(g, [[0.001, 0], [0.14, 0.02], [0.19, 0.12], [0.19, 0.22], [0.14, 0.32], [0.001, 0.34]], red);
  body.position.set(0.22, 2.34, 0);
  cyl(g, 0.05, 0.05, 0.04, 0.22, 2.68, 0, gold, 8); // 顶盖
  cyl(g, 0.05, 0.05, 0.04, 0.22, 2.3, 0, gold, 8); // 底盖
  cyl(g, 0.02, 0.015, 0.12, 0.22, 2.18, 0, std("#E8C020", 0.7), 8); // 流苏
}

/** 罗马柱：方形基座 + 圆柱身 + 柱头。 */
function buildRomanColumn(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const stone = std(c || "#D8D0C0", 0.85);
  const darker = std("#B8B0A0", 0.85);
  box(g, w, 0.25, d, 0, 0, 0, darker); // 基座
  box(g, w * 0.85, 0.12, d * 0.85, 0, 0.25, 0, stone); // 柱础
  cyl(g, 0.26, 0.3, 2.78, 0, 0.37, 0, stone, 20); // 柱身
  box(g, w * 0.88, 0.18, d * 0.88, 0, 3.15, 0, stone); // 柱头
  box(g, w * 0.98, 0.1, d * 0.98, 0, 3.33, 0, darker); // 顶板
}

/** 倒塌石柱：横倒的柱身 + 一节断鼓 + 柱头残块。 */
function buildFallenColumn(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const stone = std(c || "#C8C0B0", 0.9);
  const darker = std("#9A9284", 0.9);
  const shaft = cyl(g, 0.26, 0.28, 2.2, 0, 0, 0, stone, 18);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(0, 0.27, 0);
  const drum = cyl(g, 0.26, 0.26, 0.25, 0, 0, 0, darker, 18);
  drum.rotation.z = Math.PI / 2;
  drum.position.set(1.35, 0.27, 0.08);
  box(g, 0.6, 0.15, 0.6, -1.3, 0, 0.12, darker); // 柱头残块
  box(g, 0.5, 0.12, 0.5, -1.32, 0.15, 0.12, stone);
}

/** 牌楼：双柱 + 额枋 + 双层檐顶（简化：无翘角）。 */
function buildPailou(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const red = std(c || "#A03028", 0.6);
  const tile = std("#3A2A1A", 0.7);
  const gold = std("#C8A24A", 0.4, 0.8);
  for (const sx of [-1, 1]) {
    box(g, 0.5, 0.4, 0.5, sx * 1.7, 0, 0, std("#8A8A80", 0.9)); // 柱础石
    box(g, 0.28, 3.6, 0.28, sx * 1.7, 0.4, 0, red); // 柱
  }
  box(g, w * 0.96, 0.3, 0.25, 0, 3.6, 0, red); // 额枋
  box(g, 0.9, 0.5, 0.06, 0, 3.0, 0.14, gold); // 匾额
  box(g, w * 0.96, 0.12, 0.9, 0, 3.95, 0, tile); // 下檐
  box(g, w * 0.72, 0.12, 0.7, 0, 4.25, 0, tile); // 上檐
  box(g, w * 0.72, 0.1, 0.15, 0, 4.37, 0, tile); // 正脊
}

/** 独立木门框（门窗修复 fix (c)）：双柱 + 过梁 + 门槛 + 半掩木门扇。
 *  给无墙场景（森林/街道/战场等）的门 —— 没有墙可开洞，就立一扇门。
 *  门扇绕左柱铰链张开 30°，摆幅计入进深（目录 depth 70cm 含摆幅，见下）。 */
function buildDoorFrameWood(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#5A3A22", 0.7);
  const leafMat = std("#6B4A2F", 0.7);
  const panelMat = std("#7A5230", 0.7);
  const postW = 0.12;
  const postX = w / 2 - postW / 2;
  box(g, postW, h, 0.14, -postX, 0, 0, wood); // 左柱
  box(g, postW, h, 0.14, postX, 0, 0, wood); // 右柱
  box(g, w, 0.14, 0.14, 0, h - 0.14, 0, wood); // 过梁
  box(g, w, 0.06, 0.16, 0, 0, 0, std("#8A8A80", 0.9)); // 门槛石
  // 半掩门扇：铰链在左柱内侧，绕 Y 轴张开 30°
  const leafW = w - postW * 2 - 0.04;
  const leafH = h - 0.14 - 0.06 - 0.02;
  const leaf = new THREE.Group();
  box(leaf, leafW, leafH, 0.05, leafW / 2, 0.06, 0, leafMat);
  box(leaf, leafW * 0.8, 0.7, 0.02, leafW / 2, 0.35, 0.035, panelMat); // 下嵌板
  box(leaf, leafW * 0.8, 0.7, 0.02, leafW / 2, 1.25, 0.035, panelMat); // 上嵌板
  leaf.position.set(-w / 2 + postW + 0.02, 0, 0);
  leaf.rotation.y = -Math.PI / 6;
  g.add(leaf);
}

/** 月洞门（门窗修复 fix (c)）：白墙段 + 圆形洞口（八角近似）+ 压顶。
 *  给庭院/桃园类无墙场景的门。洞口中心高 1.5m、直径 2.2m。 */
function buildMoonGate(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wall = std(c || "#EDE6D6", 0.85);
  const tile = std("#3A2A1A", 0.7);
  const wallD = 0.4;
  // 两侧墩（洞口宽 2.2，两墩各 0.5）
  box(g, 0.5, 3.0, wallD, -1.35, 0, 0, wall);
  box(g, 0.5, 3.0, wallD, 1.35, 0, 0, wall);
  // 洞口下槛 + 上梁
  box(g, 2.2, 0.4, wallD, 0, 0, 0, wall);
  box(g, 2.2, 0.4, wallD, 0, 2.6, 0, wall);
  // 四角填块（绕 Z 转 45° 的方块）→ 洞口近似圆形（八角）
  for (const sx of [-1, 1]) for (const sy of [0.62, 2.38]) {
    const corner = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, wallD), wall);
    corner.position.set(sx * 0.82, sy, 0);
    corner.rotation.z = Math.PI / 4;
    add(g, corner);
  }
  // 压顶 + 正脊（不超出声明尺寸）
  box(g, w, 0.12, 0.5, 0, 2.98, 0, tile);
  box(g, 2.4, 0.08, 0.3, 0, 3.1, 0, tile);
}

/** 独立花格窗（门窗修复 fix (c)）：双腿支架 + 镂空木格窗扇（无玻璃/无纸，
 *  通透）。给无墙场景（集市/街道/庭院）与露天廊下的窗。 */
function buildLatticeWindow(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#6B4A2F", 0.75);
  const legX = w / 2 - 0.04;
  box(g, 0.08, 0.35, 0.1, -legX, 0, 0, wood); // 左腿
  box(g, 0.08, 0.35, 0.1, legX, 0, 0, wood); // 右腿
  box(g, w, 0.08, 0.1, 0, 0.35, 0, wood); // 下框
  box(g, w, 0.08, 0.1, 0, h - 0.08, 0, wood); // 上框
  box(g, 0.08, h - 0.43, 0.1, -legX, 0.43, 0, wood); // 左梃
  box(g, 0.08, h - 0.43, 0.1, legX, 0.43, 0, wood); // 右梃
  box(g, w - 0.16, 0.05, 0.1, 0, 0.69, 0, wood); // 横棂 ×2
  box(g, w - 0.16, 0.05, 0.1, 0, 0.95, 0, wood);
  box(g, 0.05, h - 0.43, 0.1, -0.27, 0.43, 0, wood); // 竖棂 ×2
  box(g, 0.05, h - 0.43, 0.1, 0.27, 0.43, 0, wood);
}

// ─── 门窗 Phase D：镂空花格（真实几何）+ 垂花门 + 墙洞框 ──────────────
// 背景：REPORT.md §5 Phase D（10–13）。外购模型覆盖不了的缺口由程序化补：
//   · 垂花门——全网无 web-ready 来源（Cults #13 只是 STL 打印微缩件），
//     按 part2-references.md §1D（Chuihuamen.JPG）+ #13 零件分解重建；
//   · 具名漏窗纹样——冰裂/万字/海棠等是园林文化的本体，外购件未必对得上
//     明清/唐宋各朝的纹样，程序化花格是保底；
//   · 墙洞框——外购开间多为 4m 固定模块，落进真实房洞仍需程序化收边。
// 六规则（REPORT.md §5 末）：(1) 洞口先行——花格是洞里的条，不是贴墙的画；
// (2) 隔扇/对开门必有一扇半掩；(3) 同一园子漏窗不重样——10 种纹样按墙轮换；
// (4) 花格=真洞：所有条都是实几何、条间是空的（网师园检验：花格须能在
// 地面投出光影——本文件 add() 给每条都开 castShadow/receiveShadow）；
// (5) 框有进深、槛有门槛石；(6) 时代门：月洞/漏窗只进苏州式园林，唐=直棂+
// 宏大尺度，秦汉=实木板门无格，石库门/民国=石门框+法式窗，西式=法式/拱窗。
// 注意：Phase A+B 工人在 RoomDoor3D / StyledWindow 里也在平行实现花格纹样，
// 两套实现目前重复——日后合并且以本文件的 buildLatticePanel 为准（见 BUILD-D.md）。
// 本节只加 builder + 导出 helper，不动任何已有 builder，不放任何场景。

/** 确定性伪随机（种子固定 → 同一纹样每次渲染一致，不用 Math.random）。 */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 斜撑条：中心 (cx,cy)、长 len、截面 th×depth，绕 Z 转 rotZ。 */
function strut(
  g: THREE.Group, len: number, th: number, depth: number,
  cx: number, cy: number, cz: number, rotZ: number, m: Mat,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, th, depth), m);
  mesh.position.set(cx, cy, cz);
  mesh.rotation.z = rotZ;
  return add(g, mesh);
}

/** 两点之间的条（冰裂纹/海棠瓣用）：端点 (x0,y0)→(x1,y1)。 */
function barBetween(
  g: THREE.Group, x0: number, y0: number, x1: number, y1: number,
  th: number, depth: number, cz: number, m: Mat,
): THREE.Mesh {
  const dx = x1 - x0, dy = y1 - y0;
  return strut(g, Math.hypot(dx, dy), th, depth, (x0 + x1) / 2, (y0 + y1) / 2, cz, Math.atan2(dy, dx), m);
}

/**
 * 过 (cx,cy)、方向角 ang 的直线裁剪到矩形 [x0,x1]×[y0,y1] 内，
 * 返回可放的条段（中心 + 长度），裁不进矩形返回 null。
 * 平行线族（菱形/六角/渔网）用它逐条裁剪，条端永不出框。
 */
function clipLineToRect(
  cx: number, cy: number, ang: number,
  x0: number, y0: number, x1: number, y1: number,
): { mx: number; my: number; len: number } | null {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  // Liang–Barsky：每轴算进/出参数 t，取交集 [tEnter, tExit]。
  let tEnter = -Infinity, tExit = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [dx, cx, x0, x1], [dy, cy, y0, y1],
  ];
  for (const [d, c, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (c < lo || c > hi) return null; // 直线平行于该轴且在矩形外
      continue;
    }
    const ta = (lo - c) / d, tb = (hi - c) / d;
    const tLo = Math.min(ta, tb), tHi = Math.max(ta, tb);
    if (tLo > tEnter) tEnter = tLo;
    if (tHi < tExit) tExit = tHi;
    if (tEnter > tExit) return null;
  }
  if (tExit - tEnter < 1e-6) return null;
  const mx = cx + dx * (tEnter + tExit) / 2, my = cy + dy * (tEnter + tExit) / 2;
  return { mx, my, len: tExit - tEnter };
}

/** 一组平行线：方向角 ang、法线间距 spacing，逐条裁剪进矩形。 */
function parallelLines(
  g: THREE.Group, ang: number, spacing: number,
  x0: number, y0: number, x1: number, y1: number,
  th: number, depth: number, cz: number, m: Mat,
): void {
  const nx = -Math.sin(ang), ny = Math.cos(ang); // 法线
  const ccx = (x0 + x1) / 2, ccy = (y0 + y1) / 2;
  const corners = [x0, x1].flatMap(x => [y0, y1].map(y => nx * (x - ccx) + ny * (y - ccy)));
  const tMin = Math.min(...corners), tMax = Math.max(...corners);
  for (let t = Math.ceil(tMin / spacing) * spacing; t <= tMax; t += spacing) {
    const seg = clipLineToRect(ccx + nx * t, ccy + ny * t, ang, x0, y0, x1, y1);
    if (seg && seg.len > th * 2) strut(g, seg.len, th, depth, seg.mx, seg.my, cz, ang, m);
  }
}

/** 花格纹样名（10 种 ≥ REPORT 要求的 8 种；同园按墙轮换，见 latticePatternForIndex）。 */
export type LatticePattern =
  | "cracked_ice"   // 冰裂纹：不规则多边形碎片（抖动网格 + 随机对角）
  | "fret"          // 万字纹：连续直角回纹（卍单元平铺）
  | "diamond"       // 菱形：±45° 斜线网格
  | "hexagon"       // 六角：三向线族构成的六角格（0°/±60°）
  | "begonia"       // 海棠：四瓣花 outline（四出海棠）
  | "cross_begonia" // 十字海棠：十字骨架 + 四臂海棠瓣
  | "square_grid"   // 方格：明式素格（宋斋/明厅素面）
  | "straight"      // 直棂：竖条 + 横枋（唐宫宏大尺度）
  | "fishnet"       // 渔网：细密菱形网（网师园得名之窗）
  | "ruyi";         // 如意：云头卷草（顶部卷云 + 下部竖条，风格化）

export const LATTICE_PATTERNS: LatticePattern[] = [
  "cracked_ice", "fret", "diamond", "hexagon", "begonia",
  "cross_begonia", "square_grid", "straight", "fishnet", "ruyi",
];

/** 同园不重样：按墙序号轮换纹样（沧浪亭 108 式、拙政园复廊 25 式之规则）。 */
export function latticePatternForIndex(i: number): LatticePattern {
  return LATTICE_PATTERNS[((i % LATTICE_PATTERNS.length) + LATTICE_PATTERNS.length) % LATTICE_PATTERNS.length];
}

/**
 * 镂空花格板：矩形 [x0,x1]×[y0,y1]（米）、进深 depth，XY 平面、z=cz。
 * 先立边框，再按纹样填实几何条——条间全是空的，可透光/透色。
 * 供 Phase B 的 leaky_lattice / sill_lattice / lattice_door 渲染器复用，
 * 也供将来外购花格缺失时的程序化补位。barTh 为条厚（渔网用细条）。
 */
export function buildLatticePanel(
  g: THREE.Group, x0: number, y0: number, x1: number, y1: number,
  depth: number, mat: Mat, pattern: LatticePattern, barTh = 0.04, cz = 0,
): void {
  const w = x1 - x0, h = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const th = barTh;
  // 边框（四边）
  box(g, w, th, depth, cx, y1 - th, cz, mat);
  box(g, w, th, depth, cx, y0, cz, mat);
  box(g, th, h - th * 2, depth, x0 + th / 2, y0 + th, cz, mat);
  box(g, th, h - th * 2, depth, x1 - th / 2, y0 + th, cz, mat);
  const ix0 = x0 + th, iy0 = y0 + th, ix1 = x1 - th, iy1 = y1 - th;
  const iw = ix1 - ix0, ih = iy1 - iy0;
  if (iw <= 0 || ih <= 0) return;

  switch (pattern) {
    case "straight": { // 直棂：竖条 + 两道横枋（唐宫）
      const step = 0.18;
      for (let x = ix0 + step; x < ix1 - 0.02; x += step) box(g, th, ih, depth, x, iy0, cz, mat);
      for (const fy of [iy0 + ih / 3, iy0 + (2 * ih) / 3]) box(g, iw, th, depth, cx, fy - th / 2, cz, mat);
      break;
    }
    case "square_grid": { // 方格
      const step = 0.22;
      for (let x = ix0 + step; x < ix1 - 0.02; x += step) box(g, th, ih, depth, x, iy0, cz, mat);
      for (let y = iy0 + step; y < iy1 - 0.02; y += step) box(g, iw, th, depth, cx, y - th / 2, cz, mat);
      break;
    }
    case "diamond": // 菱形：±45° 两向平行线
      parallelLines(g, Math.PI / 4, 0.3, ix0, iy0, ix1, iy1, th, depth, cz, mat);
      parallelLines(g, -Math.PI / 4, 0.3, ix0, iy0, ix1, iy1, th, depth, cz, mat);
      break;
    case "fishnet": { // 渔网：细密菱形网
      const fth = Math.min(th, 0.025);
      parallelLines(g, Math.PI / 4, 0.12, ix0, iy0, ix1, iy1, fth, depth, cz, mat);
      parallelLines(g, -Math.PI / 4, 0.12, ix0, iy0, ix1, iy1, fth, depth, cz, mat);
      break;
    }
    case "hexagon": // 六角：水平 + ±60° 三向线族
      parallelLines(g, 0, 0.26, ix0, iy0, ix1, iy1, th, depth, cz, mat);
      parallelLines(g, Math.PI / 3, 0.3, ix0, iy0, ix1, iy1, th, depth, cz, mat);
      parallelLines(g, -Math.PI / 3, 0.3, ix0, iy0, ix1, iy1, th, depth, cz, mat);
      break;
    case "fret": { // 万字纹：卍单元平铺（单元 0.3m，6 条/单元）
      const s = 0.3;
      const nx = Math.max(1, Math.floor(iw / s)), ny = Math.max(1, Math.floor(ih / s));
      const ox = ix0 + (iw - nx * s) / 2, oy = iy0 + (ih - ny * s) / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const ux = ox + i * s + s / 2, uy = oy + j * s + s / 2;
        barBetween(g, ux, uy - s / 2, ux, uy + s / 2, th, depth, cz, mat); // 竖
        barBetween(g, ux - s / 2, uy, ux + s / 2, uy, th, depth, cz, mat); // 横
        barBetween(g, ux, uy + s / 2, ux + s / 2, uy + s / 2, th, depth, cz, mat); // 上臂→右
        barBetween(g, ux + s / 2, uy, ux + s / 2, uy - s / 2, th, depth, cz, mat); // 右臂→下
        barBetween(g, ux, uy - s / 2, ux - s / 2, uy - s / 2, th, depth, cz, mat); // 下臂→左
        barBetween(g, ux - s / 2, uy, ux - s / 2, uy + s / 2, th, depth, cz, mat); // 左臂→上
      }
      break;
    }
    case "cracked_ice": { // 冰裂纹：抖动网格点 + 右/下/随机对角连线（无悬空条）
      const nx = 4, ny = 5;
      const rnd = seededRand(Math.round(w * 100) + Math.round(h * 37) + 11);
      const pts: Array<Array<[number, number]>> = [];
      for (let j = 0; j <= ny; j++) {
        const row: Array<[number, number]> = [];
        for (let i = 0; i <= nx; i++) {
          const jx = (i === 0 || i === nx) ? 0 : (rnd() - 0.5) * (iw / nx) * 0.5;
          const jy = (j === 0 || j === ny) ? 0 : (rnd() - 0.5) * (ih / ny) * 0.5;
          row.push([ix0 + (i * iw) / nx + jx, iy0 + (j * ih) / ny + jy]);
        }
        pts.push(row);
      }
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const [px, py] = pts[j][i];
        if (i < nx) barBetween(g, px, py, pts[j][i + 1][0], pts[j][i + 1][1], th, depth, cz, mat);
        if (j < ny) barBetween(g, px, py, pts[j + 1][i][0], pts[j + 1][i][1], th, depth, cz, mat);
        if (i < nx && j < ny && rnd() < 0.5) {
          barBetween(g, px, py, pts[j + 1][i + 1][0], pts[j + 1][i + 1][1], th, depth, cz, mat);
        }
      }
      break;
    }
    case "begonia":
    case "cross_begonia": {
      // 海棠：中心四瓣花（每瓣 3 条：尖→两底角 + 底边）；十字海棠再加十字骨架 + 四臂小瓣。
      const r = Math.min(iw, ih) * 0.3;
      const petal = (tipX: number, tipY: number, dirX: number, dirY: number, pr: number): void => {
        const px = -dirY, py = dirX; // 垂直方向
        const bx = tipX - dirX * pr * 0.55, by = tipY - dirY * pr * 0.55;
        barBetween(g, tipX, tipY, bx + px * pr * 0.38, by + py * pr * 0.38, th, depth, cz, mat);
        barBetween(g, tipX, tipY, bx - px * pr * 0.38, by - py * pr * 0.38, th, depth, cz, mat);
        barBetween(g, bx + px * pr * 0.38, by + py * pr * 0.38, bx - px * pr * 0.38, by - py * pr * 0.38, th, depth, cz, mat);
      };
      if (pattern === "cross_begonia") {
        box(g, th, ih, depth, cx, iy0, cz, mat);
        box(g, iw, th, depth, cx, cy - th / 2, cz, mat);
        const arm = Math.min(iw, ih) * 0.38, pr = Math.min(iw, ih) * 0.16;
        petal(cx + arm, cy, 1, 0, pr); petal(cx - arm, cy, -1, 0, pr);
        petal(cx, cy + arm, 0, 1, pr); petal(cx, cy - arm, 0, -1, pr);
      } else {
        const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) petal(cx + dx * r, cy + dy * r, dx, dy, r);
        // 中心小菱形
        const cr = r * 0.3;
        barBetween(g, cx - cr, cy, cx, cy + cr, th, depth, cz, mat);
        barBetween(g, cx, cy + cr, cx + cr, cy, th, depth, cz, mat);
        barBetween(g, cx + cr, cy, cx, cy - cr, th, depth, cz, mat);
        barBetween(g, cx, cy - cr, cx - cr, cy, th, depth, cz, mat);
      }
      break;
    }
    case "ruyi": { // 如意：顶部卷云带（3 个方钩卷头）+ 下部竖条
      const bandH = Math.min(ih * 0.28, 0.3);
      const bandY = iy1 - bandH;
      box(g, iw, th, depth, cx, bandY - th / 2, cz, mat);
      for (let k = 0; k < 3; k++) {
        const sx = ix0 + ((k + 0.5) * iw) / 3 - 0.09;
        const topY = iy1 - th - 0.02;
        box(g, 0.18, th, depth, sx + 0.09, topY - th, cz, mat); // 卷头横
        barBetween(g, sx + 0.18, topY - th / 2, sx + 0.24, topY - bandH + th * 2, th, depth, cz, mat); // 斜钩
        box(g, 0.09, th, depth, sx + 0.2, topY - bandH + th, cz, mat); // 回钩横
      }
      const step = 0.2;
      for (let x = ix0 + step; x < ix1 - 0.02; x += step) box(g, th, bandY - iy0 - th, depth, x, iy0, cz, mat);
      break;
    }
  }
}

/**
 * 垂花门（门窗 Phase D，proc-chuihua-gate）：明清四合院内外院之间的门。
 * 按 part2 §1D（Chuihuamen.JPG）+ part3 #13 Cults 零件分解重建：
 * 双柱（红漆）+ 柱础石 + 门鼓石 + 额枋 + 斗拱 + 垂莲柱（梁下垂挂、莲苞收尾）
 * + 小青瓦顶（双坡 + 正脊）+ 实木对开门（左扇半掩 30°，规则 2）。
 * 洞口是真通道：左扇半掩露出院内，右扇关闭；门槛石 0.06m 可迈过。
 * 尺寸按目录 360×120×400cm 设计（w=3.6m 时柱距 ±1.35m）；
 * 时代门：只用于明清四合院/庭院序列（set-qing-sanxitang 庭院等），
 * 不进唐/秦汉/西式场景。——只建 builder + 目录，不放任何场景（后一轮
 * 布局评估后再定点位）。
 */
function buildChuihuaGate(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  void d; void h;
  const red = std(c || "#A03028", 0.6);
  const darkWood = std("#5A3A22", 0.7);
  const doorMat = std("#7A2A20", 0.65);
  const gold = std("#C8A24A", 0.4, 0.8);
  const tile = std("#3A2A1A", 0.7);
  const stone = std("#8A8A80", 0.9);
  const colX = w / 2 - 0.45; // 柱中心 ±1.35（w=3.6）
  const colW = 0.28;
  const doorTop = 2.6, beamY = 2.9, beamH = 0.3;
  // 柱础石 + 红漆柱
  for (const sx of [-1, 1]) {
    box(g, 0.44, 0.25, 0.44, sx * colX, 0, 0, stone); // 柱础石
    box(g, colW, 2.95, colW, sx * colX, 0.25, 0, red); // 柱
  }
  // 门鼓石（柱外侧、前移）：石墩 + 横置石鼓
  for (const sx of [-1, 1]) {
    const dx = sx * (colX + 0.23);
    box(g, 0.3, 0.18, 0.3, dx, 0, 0.18, stone); // 鼓墩
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.16, 18), stone);
    drum.position.set(dx, 0.18 + 0.19, 0.18);
    drum.rotation.z = Math.PI / 2; // 鼓轴沿 X
    add(g, drum);
  }
  // 门槛石（可迈过的低槛，规则 5）
  box(g, 2.7, 0.06, 0.3, 0, 0, 0, stone);
  // 门框边柱 + 门楣
  const innerX = colX - colW / 2 - 0.05; // ±1.16，门洞净宽 2.32
  for (const sx of [-1, 1]) box(g, 0.1, doorTop, 0.12, sx * innerX, 0.06, 0, darkWood);
  box(g, innerX * 2 + 0.1, 0.12, 0.12, 0, doorTop, 0, darkWood); // 门楣
  // 实木对开门：单扇宽 1.13、高 2.54；右扇关闭，左扇绕左铰链半掩 30°（规则 2）
  const leafW = 1.13, leafH = 2.54;
  const stud = (grp: THREE.Group, lz: number): void => {
    for (const sx of [0.22, 0.565, 0.91]) for (const sy of [0.45, 1.05, 1.65, 2.25]) {
      sphere(grp, 0.035, sx, sy, lz, gold); // 门钉 3×4 / 扇
    }
  };
  // 右扇（关闭）
  box(g, leafW, leafH, 0.06, leafW / 2 + 0.03, 0.06, 0, doorMat);
  for (const sx of [0.25, 0.595, 0.94]) for (const sy of [0.51, 1.11, 1.71, 2.31]) {
    sphere(g, 0.035, sx, sy, 0.045, gold);
  }
  cyl(g, 0.02, 0.02, 0.18, 0.14, 1.2, 0.05, gold, 8); // 右扇拉手
  // 左扇（半掩）
  const leftLeaf = new THREE.Group();
  box(leftLeaf, leafW, leafH, 0.06, leafW / 2, 0, 0, doorMat);
  stud(leftLeaf, 0.045);
  cyl(leftLeaf, 0.02, 0.02, 0.18, leafW - 0.14, 1.2, 0.05, gold, 8);
  leftLeaf.position.set(-innerX, 0.06, 0);
  leftLeaf.rotation.y = -Math.PI / 6; // 30° 半掩
  g.add(leftLeaf);
  // 额枋 + 金线 + 挂落雕花板
  box(g, w - 0.62, beamH, 0.26, 0, beamY, 0, red); // 额枋（2.98）
  box(g, w - 0.62, 0.05, 0.28, 0, beamY, 0, gold); // 枋下金线
  box(g, 1.5, 0.22, 0.04, 0, beamY - 0.24, 0.14, darkWood); // 挂落板
  for (const px of [-0.4, 0, 0.4]) box(g, 0.04, 0.22, 0.05, px, beamY - 0.24, 0.14, gold);
  // 垂莲柱（梁下垂挂 ×2）：柱身 + 莲苞 + 尖坠，位于门扇前方 z=0.16
  for (const sx of [-1, 1]) {
    cyl(g, 0.06, 0.08, 0.5, sx * 0.65, 2.35, 0.16, red, 12); // 柱身 2.35–2.85
    sphere(g, 0.09, sx * 0.65, 2.3, 0.16, gold); // 莲苞
    cone(g, 0.05, 0.12, sx * 0.65, 2.12, 0.16, gold, 10); // 尖坠
  }
  // 斗拱（三攒：柱头 ×2 + 枋中 ×1，逐层向外出挑）
  for (const bx of [-colX, 0, colX]) {
    box(g, 0.5, 0.09, 0.18, bx, 3.2, 0, red);
    box(g, 0.4, 0.09, 0.28, bx, 3.29, 0.03, red);
    box(g, 0.3, 0.09, 0.38, bx, 3.38, 0.06, red);
  }
  // 小青瓦顶：双坡 + 正脊 + 脊端
  for (const sz of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.7), tile);
    slab.position.set(0, 3.62, sz * 0.26);
    slab.rotation.x = sz * 0.42;
    add(g, slab);
  }
  box(g, 3.3, 0.1, 0.2, 0, 3.82, 0, tile); // 正脊
  for (const sx of [-1, 1]) box(g, 0.12, 0.18, 0.12, sx * 1.68, 3.8, 0, tile); // 脊端
  for (const sz of [-1, 1]) box(g, w, 0.05, 0.08, 0, 3.42, sz * 0.58, tile); // 檐口
}

// ─── 通用墙洞框（Phase D-8）────────────────────────────────────────────
// 外购开间（Jinlan 4m 模块 / Hitree 固定尺寸）落进 ZhuyaHome 真实房洞时
// 的收边件：按给定洞口宽/高（米）生成——与洞口同宽的框，不是固定尺寸件。
// 坐标约定与本文件一致：group 原点 = 洞口底边中心、y=0 为地面/洞底；
// 框的进深 = 墙厚 wallDepth（规则 5：框有进深，洞口见墙厚）。
export interface OpeningFrameOptions {
  jambWidth?: number;      // 边框宽（米），默认 0.1
  headHeight?: number;     // 上楣高（米），默认 0.12
  sillHeight?: number;     // 门槛石高（米），默认 0.06（可迈过的低槛）
  thresholdProtrude?: number; // 门槛石每侧外伸（米），默认 0.06
  trimWidth?: number;      // 正面线脚宽（米），默认 0.06；0 = 不做线脚
}
export function buildWallOpeningFrame(
  g: THREE.Group, openingW: number, openingH: number, wallDepth: number,
  wood: Mat, stone: Mat, opts: OpeningFrameOptions = {},
): void {
  const jambW = opts.jambWidth ?? 0.1;
  const headH = opts.headHeight ?? 0.12;
  const sillH = opts.sillHeight ?? 0.06;
  const protrude = opts.thresholdProtrude ?? 0.06;
  const trimW = opts.trimWidth ?? 0.06;
  // 两侧边框（通高，含墙厚进深）
  for (const sx of [-1, 1]) box(g, jambW, openingH, wallDepth, sx * (openingW / 2 + jambW / 2), 0, 0, wood);
  // 上楣
  box(g, openingW + jambW * 2, headH, wallDepth, 0, openingH, 0, wood);
  // 门槛石（洞底，略宽于洞口、略厚于墙，规则 5）
  box(g, openingW + jambW * 2 + protrude * 2, sillH, wallDepth + 0.08, 0, 0, 0, stone);
  // 正面线脚（洞口四周，贴墙面一圈）
  if (trimW > 0) {
    const z = wallDepth / 2 + 0.011;
    box(g, openingW + (jambW + trimW) * 2, trimW, 0.02, 0, openingH + headH, z, wood);
    for (const sx of [-1, 1]) box(g, trimW, openingH + headH, 0.02, sx * (openingW / 2 + jambW + trimW / 2), 0, z, wood);
  }
}

/**
 * 外购开间适配：把一个固定尺寸的开间（bayW×bayH，如 Jinlan 4m 模块）
 * 等比缩放到真实墙洞（openingW×openingH）内。返回统一缩放 + 居中偏移
 * （米，相对洞口底边中心）。调用方按 scale 缩放 GLB group、按 offset
 * 平移即可，不改模型本身。
 */
export function fitBayToOpening(
  bayW: number, bayH: number, openingW: number, openingH: number,
): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(openingW / bayW, openingH / bayH);
  return { scale, offsetX: (openingW - bayW * scale) / 2, offsetY: (openingH - bayH * scale) / 2 };
}

// ─── 门窗 Phase D（扩围）：葫芦/八角洞门 + 扇窗 + 石库门 ───────────────
// 2026-11-21 用户扩围：无免费来源的 6 件全部进入生成范围（three.js 程序化
// 优先，Blender 只在明显更好时用）。本节是 three.js 侧：
//   · 葫芦洞门 / 八角洞门——Shape + Extrude（贝塞尔葫芦腰 / 八角洞口），
//     是 Blender GLB 版的程序化回退（目录 model3d 指向 GLB，加载失败时
//     GltfFurnitureWithFallback → FurnitureMesh → 这里的 builder）；
//   · 扇窗 / 石库门——纯程序化（方/直线几何已够好，不上 Blender）。
// 垂花门仍用上节的程序化版（已建成；斗拱盒子叠层在房间距离可读，全量
// Blender 重建 60+ 零件会吃掉本轮，见 BUILD-D.md）。
// 全部只建 builder + 目录，不放任何场景。

/** 带洞口的墙体：外框矩形（已扣掉倒角外扩）+ 洞口路径，挤出 wallDepth，
 *  居中于 z=0。洞口是真空洞（规则 1）；bevel 给石质洞口一个倒角边。 */
function extrudedWallWithHole(
  g: THREE.Group, outerW: number, outerH: number, wallDepth: number,
  hole: THREE.Path, mat: Mat, bevel = 0.02,
): THREE.Mesh {
  const shape = new THREE.Shape();
  const hw = outerW / 2 - bevel, hh = outerH - bevel;
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: wallDepth, bevelEnabled: bevel > 0,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // 倒角会向外扩 bevel：底部抬 bevel 使墙根落在 y=0，顶只多出 bevel（< 目录高）。
  mesh.position.set(0, bevel, -wallDepth / 2);
  return add(g, mesh);
}

/** 葫芦洞口（part2 §1A）：下葫芦鼓 → 腰收 → 上葫芦鼓 → 顶收；腰是特征。 */
function gourdHolePath(cx: number, baseY: number, halfW: number, height: number): THREE.Path {
  const waist = halfW * 0.65;
  const x = (f: number): number => cx + f;
  const p = new THREE.Path();
  p.moveTo(x(-halfW * 0.86), baseY);
  p.lineTo(x(halfW * 0.86), baseY);
  p.bezierCurveTo(x(halfW * 1.02), baseY + height * 0.15, x(halfW * 1.02), baseY + height * 0.32, x(waist), baseY + height * 0.5);
  p.bezierCurveTo(x(waist), baseY + height * 0.6, x(halfW * 0.98), baseY + height * 0.68, x(halfW * 0.95), baseY + height * 0.82);
  p.bezierCurveTo(x(halfW * 0.93), baseY + height * 0.93, x(halfW * 0.85), baseY + height, x(halfW * 0.72), baseY + height);
  p.lineTo(x(-halfW * 0.72), baseY + height);
  p.bezierCurveTo(x(-halfW * 0.85), baseY + height, x(-halfW * 0.93), baseY + height * 0.93, x(-halfW * 0.95), baseY + height * 0.82);
  p.bezierCurveTo(x(-halfW * 0.98), baseY + height * 0.68, x(-waist), baseY + height * 0.6, x(-waist), baseY + height * 0.5);
  p.bezierCurveTo(x(-halfW * 1.02), baseY + height * 0.32, x(-halfW * 1.02), baseY + height * 0.15, x(-halfW * 0.86), baseY);
  p.closePath();
  return p;
}

/** 八角洞口：平顶/平底的正八角（22.5° 起点），留园廊门同款。 */
function octagonHolePath(cx: number, cy: number, r: number): THREE.Path {
  const p = new THREE.Path();
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
    if (k === 0) p.moveTo(px, py); else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}

/** 圆拱洞口：矩形直部 + 上半圆拱顶（石库门）。 */
function archHolePath(cx: number, baseY: number, halfW: number, rectH: number): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(cx - halfW, baseY);
  p.lineTo(cx + halfW, baseY);
  p.lineTo(cx + halfW, baseY + rectH);
  p.absarc(cx, baseY + rectH, halfW, 0, Math.PI, false);
  p.lineTo(cx - halfW, baseY);
  p.closePath();
  return p;
}

/** 洞口石 rim：一圈楔形石（voussoir）沿洞口轮廓按弧长排布（每 0.30m 一块、
 *  每块 0.32m 长，微叠成连续石环），半嵌墙、半露洞口。底边（y<0.15）不放：
 *  底边是门槛石的地盘，rim 石会与门槛石前脸共面闪烁。 */
function rimVoussoirs(g: THREE.Group, hole: THREE.Path, wallDepth: number, mat: Mat): void {
  const pts = hole.getPoints(64);
  if (pts.length < 8) return;
  if (pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  const n = pts.length;
  const stepLen = 0.3;
  let dist = 0, target = stepLen / 2;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const seg = a.distanceTo(b);
    while (target <= dist + seg) {
      const t = seg > 0 ? (target - dist) / seg : 0;
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      if (py >= 0.15) {
        strut(g, 0.32, 0.16, wallDepth + 0.06, px, py, 0, Math.atan2(b.y - a.y, b.x - a.x), mat);
      }
      target += stepLen;
    }
    dist += seg;
  }
}

/** 墙头压顶 + 正脊（与月洞门同款）。 */
function gateCoping(g: THREE.Group, w: number, y: number, tile: Mat): void {
  box(g, w, 0.12, 0.5, 0, y, 0, tile);
  box(g, w * 0.75, 0.08, 0.3, 0, y + 0.12, 0, tile);
}

/** 葫芦洞门（proc-gourd-gate）：白墙 + 葫芦形通洞 + 石 rim + 门槛 + 压顶。
 *  与 Blender GLB 版同尺寸（3.2×3.0m 墙、洞 2.2×2.4m）；GLB 优先，
 *  本 builder 是加载失败时的程序化回退。时代门：只进苏州式园林。 */
function buildGourdGate(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  void w; void d; void h;
  const wall = std(c || "#EDE6D6", 0.85);
  const stone = std("#6A655C", 0.9);
  const tile = std("#3A2A1A", 0.7);
  const wallD = 0.4;
  const hole = gourdHolePath(0, 0, 1.1, 2.4);
  extrudedWallWithHole(g, 3.2, 3.0, wallD, hole, wall);
  rimVoussoirs(g, hole, wallD, stone);
  box(g, 2.4, 0.12, 0.46, 0, 0, 0, stone); // 门槛石（可迈过）
  gateCoping(g, 3.2, 2.98, tile);
}

/** 八角洞门（proc-octagon-gate）：白墙 + 八角通洞 + 石 rim + 门槛 + 压顶。
 *  与 Blender GLB 版同尺寸；GLB 优先，本 builder 是回退。时代门：苏州式园林。 */
function buildOctagonalGate(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  void w; void d; void h;
  const wall = std(c || "#EDE6D6", 0.85);
  const stone = std("#6A655C", 0.9);
  const tile = std("#3A2A1A", 0.7);
  const wallD = 0.4;
  const hole = octagonHolePath(0, 1.2, 1.15);
  extrudedWallWithHole(g, 3.2, 3.0, wallD, hole, wall);
  rimVoussoirs(g, hole, wallD, stone);
  box(g, 2.4, 0.12, 0.46, 0, 0, 0, stone); // 门槛石
  gateCoping(g, 3.2, 2.98, tile);
}

/** 随墙门（proc-suiqiang-gate）：沿墙而建的素门——白墙 + 圆拱通洞 + 石 rim + 门槛，
 *  无挑檐、无柱、无门扇，是苏州园林里最素的边门/侧门（part2 §1E：洞就是洞，
 *  只是一堵墙上的洞）。圆拱洞 1.6×2.2m 真通洞。时代门：苏州式园林/江南民居。 */
function buildSuiqiangGate(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  void w; void d; void h;
  const wall = std(c || "#EDE6D6", 0.85);
  const stone = std("#6A655C", 0.9);
  const wallD = 0.4;
  const hole = archHolePath(0, 0, 0.8, 1.4);
  extrudedWallWithHole(g, 2.4, 2.6, wallD, hole, wall);
  rimVoussoirs(g, hole, wallD, stone);
  box(g, 1.8, 0.12, 0.46, 0, 0, 0, stone); // 门槛石
}

/** 扇窗（proc-fan-window）：半圆扇形窗，扇框 + 5 根放射扇骨 + 两道弧棂
 *  + 扇心圆钮，下有底框双腿（与 proc-lattice-window 同款独立式）。
 *  扇形是真空洞：骨间全是空的，可透光。园林/中式厅堂用。 */
function buildFanWindow(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  void w; void d; void h;
  const wood = std(c || "#6B4A2F", 0.75);
  const R = 0.8;
  const legH = 0.35;
  const hubY = legH + 0.07;
  // 扇框：半圆环（挤出 0.08）
  const ring = new THREE.Shape();
  ring.absarc(0, 0, R, 0, Math.PI, false);
  ring.absarc(0, 0, R - 0.07, Math.PI, 0, true);
  ring.closePath();
  const ringMesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(ring, { depth: 0.08, bevelEnabled: false, curveSegments: 32 }), wood,
  );
  ringMesh.position.set(0, hubY, -0.04);
  add(g, ringMesh);
  box(g, R * 2, 0.07, 0.1, 0, legH, 0, wood); // 底框
  box(g, 0.08, legH, 0.1, -R + 0.04, 0, 0, wood); // 腿
  box(g, 0.08, legH, 0.1, R - 0.04, 0, 0, wood);
  // 扇骨：5 根放射条（30°/60°/90°/120°/150°）
  for (let k = 1; k <= 5; k++) {
    const a = (k * Math.PI) / 6;
    const len = R - 0.07;
    strut(g, len, 0.04, 0.08, (Math.cos(a) * len) / 2, hubY + (Math.sin(a) * len) / 2, 0, a, wood);
  }
  // 两道弧棂（同心半圆）
  for (const rr of [R * 0.45, R * 0.7]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.02, 8, 32, Math.PI), wood);
    arc.position.set(0, hubY, 0);
    add(g, arc);
  }
  // 扇心圆钮（朝前的短圆柱）
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12), wood);
  boss.position.set(0, hubY, 0);
  boss.rotation.x = Math.PI / 2;
  add(g, boss);
}

/** 石库门（proc-shikumen-gate）：花岗岩石墙 + 圆拱洞口 + 红砖拱环 +
 *  黑漆厚木对开门（左扇半掩 30°，规则 2）+ 铜环门钹 + 门槛石。
 *  拱顶扇形区留空（两根放射条作扇形格），透进天井光。时代门：只进
 *  石库门/民国里弄场景，绝不进中式园林/唐宋厅堂。 */
function buildShikumenGate(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  void w; void d; void h;
  const stone = std("#8A8A80", 0.9);
  const brick = std("#8A3A28", 0.85);
  const doorMat = std("#1A1A1A", 0.6);
  const plankMat = std("#0A0A0A", 0.65);
  const bronze = std("#8A6A2A", 0.4, 0.9);
  const wallD = 0.6;
  const hole = archHolePath(0, 0, 1.0, 2.2);
  extrudedWallWithHole(g, 3.0, 3.4, wallD, hole, stone);
  // 红砖拱环：沿拱顶每 15° 一块砖（半嵌洞口边）
  for (let k = 0; k <= 12; k++) {
    const a = (k * Math.PI) / 12;
    const px = Math.cos(a) * 1.0, py = 2.2 + Math.sin(a) * 1.0;
    strut(g, 0.2, 0.14, wallD + 0.02, px, py, 0, a + Math.PI / 2, brick);
  }
  box(g, 0.22, 0.3, 0.1, 0, 3.02, wallD / 2 + 0.02, stone); // 拱顶石（keystone）
  box(g, 3.0, 0.1, 0.66, 0, 3.4, 0, stone); // 墙顶石檐
  box(g, 2.2, 0.08, 0.7, 0, 0, 0, stone); // 门槛石
  // 黑漆对开门：单扇 0.98×2.14m；右扇关，左扇半掩 30°
  const leafW = 0.98, leafH = 2.14;
  box(g, leafW, leafH, 0.08, leafW / 2 + 0.02, 0.08, 0, doorMat);
  for (const px of [0.3, 0.62, 0.94]) box(g, 0.02, leafH - 0.1, 0.085, px, 0.13, 0, plankMat); // 右扇板缝
  const ringR = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 8, 20), bronze);
  ringR.position.set(0.55, 1.3, 0.06);
  add(g, ringR);
  const bossR = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10), bronze);
  bossR.position.set(0.55, 1.39, 0.03);
  bossR.rotation.x = Math.PI / 2; // 环首座：连门面与铜环顶
  add(g, bossR);
  const leftLeaf = new THREE.Group();
  box(leftLeaf, leafW, leafH, 0.08, leafW / 2, 0, 0, doorMat);
  for (const px of [0.3, 0.62, 0.94]) box(leftLeaf, 0.02, leafH - 0.1, 0.085, px, 0.05, 0, plankMat);
  const ringL = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 8, 20), bronze);
  ringL.position.set(leafW - 0.43, 1.22, 0.06);
  add(leftLeaf, ringL);
  const bossL = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10), bronze);
  bossL.position.set(leafW - 0.43, 1.31, 0.03);
  bossL.rotation.x = Math.PI / 2;
  add(leftLeaf, bossL);
  leftLeaf.position.set(-1.0, 0.08, 0);
  leftLeaf.rotation.y = -Math.PI / 6; // 30° 半掩
  g.add(leftLeaf);
  // 拱顶扇形格：3 根放射条（45°/90°/135°），其余留空透光
  for (const a of [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
    const len = 0.95;
    strut(g, len, 0.04, 0.06, (Math.cos(a) * len) / 2, 2.2 + (Math.sin(a) * len) / 2, 0, a, plankMat);
  }
}

/** 石井：石环 + 井口 + 双柱小顶。 */
function buildStoneWell(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const stone = std(c || "#9A9488", 0.95);
  cyl(g, 0.55, 0.58, 0.85, 0, 0, 0, stone, 20); // 井环
  cyl(g, 0.45, 0.45, 0.02, 0, 0.8, 0, std("#1A2A30", 0.95), 20); // 井口（暗水面）
  cyl(g, 0.58, 0.58, 0.06, 0, 0.85, 0, std("#7A7468", 0.95), 20); // 井沿
  for (const sx of [-1, 1]) box(g, 0.08, 0.85, 0.08, sx * 0.45, 0.85, 0, std("#5A3A22", 0.7));
  for (const sz of [-1, 1]) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.6), std("#3A2A1A", 0.7));
    slope.position.set(0, 1.62, sz * 0.28);
    slope.rotation.x = sz * 0.35;
    add(g, slope);
  }
}

/** 焦黑断梁：横倒的焦木主梁 + 碎木。 */
function buildBurntBeam(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const char = std("#1A1512", 0.95);
  const ash = std("#4A4440", 0.95);
  box(g, w * 0.93, 0.32, 0.32, 0, 0.04, 0, char); // 主梁
  box(g, 0.5, 0.14, 0.2, -0.7, 0.36, 0.05, ash); // 碎木
  box(g, 0.4, 0.12, 0.18, 0.6, 0.36, -0.04, char);
  box(g, 0.34, 0.1, 0.16, 0.1, 0.36, 0.08, ash);
}

/** 枯树：主干 + 五条秃枝（无叶）。 */
function buildDeadTree(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const bark = std(c || "#4A3A28", 0.95);
  cyl(g, 0.07, 0.13, 2.2, 0, 0, 0, bark, 10); // 主干
  const branches: Array<[number, number, number, number]> = [
    // [倾角(rad), 绕Z还是绕X(0=Z,1=X), 方向, 长度]
    [0.6, 0, 1, 1.1], [0.7, 0, -1, 1.0], [0.5, 1, 1, 1.05], [0.65, 1, -1, 0.95], [0.15, 0, 1, 0.9],
  ];
  for (const [ang, axis, dir, len] of branches) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, len, 8), bark);
    const baseY = 2.0;
    if (axis === 0) {
      br.rotation.z = -dir * ang;
      br.position.set(dir * (len / 2) * Math.sin(ang), baseY + (len / 2) * Math.cos(ang), 0);
    } else {
      br.rotation.x = dir * ang;
      br.position.set(0, baseY + (len / 2) * Math.cos(ang), dir * (len / 2) * Math.sin(ang));
    }
    add(g, br);
  }
}

/** 太湖石：三层叠石（只绕 Y 轴转，包围盒可控）。 */
function buildRockery(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const rock = std(c || "#8A8A80", 0.95);
  const dark = std("#6A6A60", 0.95);
  const s1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.9), rock);
  s1.position.set(0, 0.35, 0); s1.rotation.y = 0.2; add(g, s1);
  const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.7), dark);
  s2.position.set(-0.05, 1.0, 0.05); s2.rotation.y = -0.3; add(g, s2);
  const s3 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), rock);
  s3.position.set(0.05, 1.55, -0.05); s3.rotation.y = 0.5; add(g, s3);
  const s4 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.4), dark);
  s4.position.set(0.45, 0.4, 0.25); s4.rotation.y = 0.4; add(g, s4);
}

/** 倒塌货架：侧倒的货架（板层叠落 + 商品散落）。 */
function buildToppledShelf(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const frame = std(c || "#5A6A7A", 0.5, 0.4);
  box(g, w * 0.95, 0.1, d * 0.85, 0, 0, 0, frame); // 倒下的侧板
  box(g, w * 0.9, 0.05, d * 0.7, 0.04, 0.12, 0.02, frame); // 板层 ×2
  box(g, w * 0.9, 0.05, d * 0.7, -0.03, 0.2, -0.02, frame);
  box(g, 0.08, 0.3, d * 0.7, -w / 2 + 0.1, 0.1, 0, frame); // 立柱残段
  box(g, 0.08, 0.3, d * 0.7, w / 2 - 0.12, 0.1, 0, frame);
  const goods = ["#C03028", "#2A6A2A", "#C8A020", "#E8E8E8"];
  for (let i = 0; i < 5; i++) {
    const gx = -w * 0.35 + i * w * 0.18;
    box(g, 0.2, 0.14 + (i % 2) * 0.06, 0.18, gx, 0.26, (i % 2 === 0 ? 0.28 : -0.28), std(goods[i % goods.length], 0.7));
  }
}

// ─── 户外场景（第六批：室外片场 26 个）──────────────────────────────────────
// 植被/地形/水体/户外构筑全部程序化：室外场景的地面、树木、山水在 587 件
// 目录里没有可用模型（tree-oak 等只有素盒子回退），且 Sketchfab 同类模型
// 许可证与尺寸均不合用。builder 只用 w/d/h 相对尺寸，包围盒落在声明尺寸内
// （harness 第 1 节逐项核对）；颜色取目录 color（树冠/花色/铺面色），
// 树干/石材等固定色写死在 builder 里。

/** 阔叶乔木：树干 + 三层错开树冠球（颜色 = 树冠色）。 */
function buildTree(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const m = Math.min(w, d);
  const trunk = std("#6A4A2A", 0.9);
  const leaf = std(c || "#2D6A1F", 0.9);
  cyl(g, m * 0.07, m * 0.09, h * 0.45, 0, 0, 0, trunk);
  sphere(g, m * 0.30, 0, h * 0.60, 0, leaf);
  sphere(g, m * 0.26, w * 0.12, h * 0.74, 0, leaf);
  sphere(g, m * 0.22, -w * 0.10, h * 0.84, d * 0.08, leaf);
}

/** 松树：树干 + 三层叠锥（颜色 = 针叶色；雪松用白色目录色）。 */
function buildPine(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const m = Math.min(w, d);
  const leaf = std(c || "#1E5022", 0.9);
  cyl(g, m * 0.06, m * 0.08, h * 0.20, 0, 0, 0, std("#5A3A22", 0.9));
  cone(g, m * 0.42, h * 0.42, 0, h * 0.18, 0, leaf);
  cone(g, m * 0.34, h * 0.36, 0, h * 0.42, 0, leaf);
  cone(g, m * 0.25, h * 0.32, 0, h * 0.64, 0, leaf);
}

/** 棕榈树：微倾树干 + 六片平铺放射叶 + 椰果。 */
function buildPalm(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const m = Math.min(w, d);
  const leaf = std(c || "#3D7A2A", 0.9);
  const trunk = cyl(g, m * 0.045, m * 0.06, h * 0.72, 0, 0, 0, std("#8A7A5A", 0.9));
  trunk.rotation.z = 0.06;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const frond = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42, 0.02, d * 0.09), leaf);
    frond.position.set(Math.cos(a) * w * 0.17, h * 0.74, Math.sin(a) * w * 0.17);
    frond.rotation.y = -a;
    add(g, frond);
  }
  for (const [sx, sz] of [[-1, 0], [1, 0], [0, 1]] as Array<[number, number]>) {
    sphere(g, m * 0.045, sx * m * 0.05, h * 0.70, sz * m * 0.05, std("#6A4A2A", 0.9));
  }
}

/** 竹丛：五竿细竹（微倾）+ 竿顶叶簇。 */
function buildBambooClump(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const culm = std("#4A8A3A", 0.7);
  const leaf = std(c || "#3A8A3A", 0.9);
  const spots: Array<[number, number, number]> = [
    [-0.28, -0.22, 0.95], [0.24, -0.28, 1.0], [0.0, 0.05, 0.88],
    [-0.22, 0.26, 0.92], [0.28, 0.24, 0.98],
  ];
  for (const [fx, fz, fh] of spots) {
    const m = cyl(g, 0.03, 0.035, h * fh, fx * w, 0, fz * d, culm, 10);
    m.rotation.z = fx * 0.08;
    sphere(g, 0.12, fx * w, h * fh * 0.96, fz * d, leaf);
  }
}

/** 岩石：低多面体（十二面体压扁），颜色 = 目录色。 */
function buildRock(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), std(c || "#8A8A80", 0.95));
  mesh.scale.set(w * 0.42, h * 0.45, d * 0.42);
  mesh.position.set(0, h * 0.42, 0);
  mesh.rotation.y = 0.5;
  add(g, mesh);
}

/** 灌木丛：三球交叠叶丛。 */
function buildBush(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const m = Math.min(w, d);
  const leaf = std(c || "#3A6A2A", 0.9);
  sphere(g, m * 0.28, 0, h * 0.30, 0, leaf);
  sphere(g, m * 0.24, w * 0.14, h * 0.45, d * 0.06, leaf);
  sphere(g, m * 0.22, -w * 0.12, h * 0.42, -d * 0.08, leaf);
}

/** 草丛：七束锥形草叶。 */
function buildGrassTuft(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const leaf = std(c || "#5A9E3A", 0.9);
  const spots: Array<[number, number]> = [
    [0, 0], [-0.28, -0.2], [0.26, -0.24], [-0.24, 0.26], [0.28, 0.22], [0.05, -0.3], [-0.05, 0.3],
  ];
  for (const [fx, fz] of spots) cone(g, 0.04, h * 0.85, fx * w, 0, fz * d, leaf, 8);
}

/** 花丛：五茎 + 顶花球（颜色 = 花色），茎叶固定绿。 */
function buildFlowerCluster(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const flower = std(c || "#E88AA0", 0.9);
  const stem = std("#3A6A2A", 0.9);
  const spots: Array<[number, number]> = [[0, 0], [-0.26, -0.2], [0.26, -0.22], [-0.22, 0.26], [0.24, 0.24]];
  for (const [fx, fz] of spots) {
    cyl(g, 0.012, 0.012, h * 0.5, fx * w, 0, fz * d, stem, 6);
    sphere(g, 0.05, fx * w, h * 0.55, fz * d, flower);
  }
  sphere(g, 0.07, -w * 0.1, h * 0.25, 0, stem);
  sphere(g, 0.06, w * 0.12, h * 0.22, d * 0.1, stem);
}

/** 地面铺面：5cm 薄板（草/沙/雪/石/干草），颜色 = 目录色，靠 scaleW/D 放大铺满。 */
function buildGroundPatch(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  box(g, w, h, d, 0, 0, 0, std(c || "#5A9E3A", 0.95));
}

/** 水面：半透明蓝色薄板（平面示意，非水体模拟）。 */
function buildWaterPlane(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({
    color: c || "#3A90C0", roughness: 0.25, metalness: 0.1,
    transparent: true, opacity: 0.85,
  }));
  mesh.position.set(0, h / 2, 0);
  add(g, mesh);
}

/** 远山：锥形山体 + 白色雪顶。 */
function buildMountain(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const m = Math.min(w, d);
  cone(g, m * 0.48, h * 0.85, 0, 0, 0, std(c || "#6A7A8A", 0.95));
  cone(g, m * 0.48 * 0.42, h * 0.30, 0, h * 0.62, 0, std("#F0F4F8", 0.95));
}

/** 沙丘：扁球形沙堆（下半埋入地下，只露上半）。 */
function buildDune(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), std(c || "#D8C090", 0.95));
  mesh.scale.set(w * 0.48, h * 0.5, d * 0.48);
  mesh.position.set(0, h * 0.5, 0);
  add(g, mesh);
}


/** 路灯：立柱 + 顶灯头（发光）。 */
function buildStreetLamp(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  cyl(g, 0.035, 0.045, h * 0.92, 0, 0, 0, std("#3A3A3A", 0.4, 0.7), 10);
  box(g, w * 0.5, 0.06, d * 0.5, 0, h * 0.92, 0, std("#2A2A2A", 0.4, 0.7));
  box(g, w * 0.4, 0.03, d * 0.4, 0, h * 0.92 - 0.045, 0, glow("#F5E8C8", "#F5D890", 0.9));
}


/** 帐篷：地布 + 双坡篷布（两块斜板）+ 脊杆。 */
function buildTent(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const cloth = std(c || "#8A7A5A", 0.95);
  box(g, w, 0.03, d, 0, 0, 0, std("#7A6A4A", 0.95)); // 地布
  const ridgeH = h * 0.9;
  const slope = Math.hypot(w / 2, ridgeH);
  const ang = Math.atan2(ridgeH, w / 2);
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.04, d), cloth);
    panel.position.set((s * w) / 4, ridgeH / 2, 0);
    panel.rotation.z = -s * ang;
    add(g, panel);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, d, 8), std("#6A4A2A", 0.9));
  pole.rotation.x = Math.PI / 2;
  pole.position.set(0, ridgeH, 0);
  add(g, pole);
}

/** 旗帜：旗杆 + 旗面 + 顶球。 */
function buildBanner(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  cyl(g, 0.035, 0.045, h * 0.92, 0, 0, 0, std("#6A4A2A", 0.9), 10);
  box(g, w * 0.44, h * 0.22, 0.02, w * 0.24, h * 0.78, 0, std(c || "#B03030", 0.9));
  sphere(g, 0.05, 0, h * 0.94, 0, std("#C8A24A", 0.4, 0.8));
}

/** 城墙段：墙体 + 马道 + 一排垛口。 */
function buildCityWall(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const stone = std(c || "#8A7A6A", 0.95);
  box(g, w, h * 0.72, d, 0, 0, 0, stone);
  box(g, w, 0.04, d * 0.9, 0, h * 0.72, 0, std("#7A6A5A", 0.95));
  for (let i = 0; i < 8; i++) {
    const x = -w * 0.44 + (i * w * 0.88) / 7;
    box(g, w * 0.06, h * 0.16, d * 0.2, x, h * 0.76, d * 0.32, stone);
  }
}

/** 城门：双塔 + 横梁 + 顶盖，中空门洞（不做拱券减法，横梁在门洞上方）。 */
function buildCityGate(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const stone = std(c || "#8A7A6A", 0.95);
  for (const sx of [-1, 1]) {
    box(g, w * 0.28, h * 0.78, d, sx * w * 0.36, 0, 0, stone);
  }
  box(g, w, h * 0.14, d * 0.9, 0, h * 0.78, 0, stone); // 横梁
  box(g, w * 0.98, 0.05, d * 0.98, 0, h * 0.92, 0, std("#7A6A5A", 0.95)); // 顶盖
}

/** 拱桥：五级阶梯桥面 + 两侧栏杆（斜栏杆段 + 立柱）。 */
function buildArchBridge(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#A08050", 0.9);
  const ys = [0.10, 0.45, 0.70, 0.45, 0.10];
  const xs = [-0.4, -0.2, 0, 0.2, 0.4].map((f) => f * w);
  for (let i = 0; i < 5; i++) {
    box(g, w * 0.22, 0.08, d, xs[i], ys[i] * h, 0, wood);
  }
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x0 = xs[i], x1 = xs[i + 1];
      const y0 = (ys[i] + 0.08) * h + 0.55, y1 = (ys[i + 1] + 0.08) * h + 0.55;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.04), wood);
      rail.position.set((x0 + x1) / 2, (y0 + y1) / 2, sz * d * 0.44);
      rail.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      add(g, rail);
    }
    for (let i = 0; i < 5; i++) {
      box(g, 0.05, 0.55, 0.05, xs[i], (ys[i] + 0.08) * h, sz * d * 0.44, wood);
    }
  }
}

/** 木船：船体 + 翘首尾 + 桅杆 + 篷顶（渡船/湖船）。 */
function buildWoodenBoat(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#6A4A2A", 0.9);
  box(g, w * 0.85, h * 0.35, d * 0.55, 0, 0, 0, wood); // 船体
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(w * 0.1, h * 0.45, d * 0.5), wood);
    end.position.set(s * w * 0.39, h * 0.3, 0);
    end.rotation.z = -s * 0.5;
    add(g, end);
  }
  cyl(g, 0.04, 0.05, h * 0.6, 0, h * 0.35, 0, std("#5A3A22", 0.9), 10); // 桅杆
  for (const sx of [-1, 1]) cyl(g, 0.03, 0.03, h * 0.27, sx * w * 0.2, h * 0.35, 0, wood, 8);
  box(g, w * 0.5, 0.04, d * 0.6, 0, h * 0.62, 0, std("#8A7A5A", 0.9)); // 篷顶
}

/** 临街店面（现代）：墙体 + 玻璃橱窗 + 雨篷 + 招牌板。 */
function buildShopFacade(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  box(g, w, h, d, 0, 0, 0, std(c || "#C8C8C8", 0.9));
  box(g, w * 0.7, h * 0.45, 0.04, 0, h * 0.05, d / 2, std("#8AB0C8", 0.25, 0.4));
  box(g, w * 0.8, 0.04, d * 0.3, 0, h * 0.55, d * 0.35, std("#3A3A3A", 0.8));
  box(g, w * 0.6, h * 0.12, 0.04, 0, h * 0.8, d / 2, std("#2A2A2A", 0.7));
}

/** 木构店面（古镇）：木墙 + 双坡顶 + 招牌 + 灯笼。 */
function buildTimberFacade(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#6A4A2A", 0.9);
  box(g, w, h * 0.7, d * 0.6, 0, 0, -d * 0.2, wood);
  const rise = h * 0.3;
  const slope = Math.hypot(w / 2, rise);
  const ang = Math.atan2(rise, w / 2);
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.04, d * 0.9), std("#5A3A22", 0.9));
    panel.position.set((s * w) / 4, h * 0.7 + rise / 2, 0);
    panel.rotation.z = -s * ang;
    add(g, panel);
  }
  box(g, w * 0.5, h * 0.1, 0.03, 0, h * 0.5, d * 0.12, std("#3A2A1A", 0.9));
  sphere(g, 0.07, w * 0.3, h * 0.5, d * 0.35, glow("#C03028", "#C03028", 0.7));
}

/** 茶树行：四丛压扁弧形茶树。 */
function buildTeaRow(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const leaf = std(c || "#3A6A2A", 0.9);
  for (const fx of [-0.375, -0.125, 0.125, 0.375]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(d * 0.45, 14, 10), leaf);
    m.scale.set(1, 0.7, 1);
    m.position.set(fx * w, h * 0.45, 0);
    add(g, m);
  }
}

/** 稻田块：浅水底 + 十二丛秧苗。 */
function buildRicePaddy(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  box(g, w, 0.05, d, 0, 0, 0, std("#8AB090", 0.4));
  const shoot = std(c || "#7AB060", 0.9);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      cone(g, 0.03, 0.18, -w * 0.36 + i * w * 0.24, 0.05, -d * 0.3 + j * d * 0.3, shoot, 6);
    }
  }
}

/** 作物行：两排幼苗锥。 */
function buildCropRow(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const crop = std(c || "#5A8A3A", 0.9);
  for (let i = 0; i < 6; i++) {
    for (const sz of [-1, 1]) {
      cone(g, 0.05, h * 0.5, -w * 0.4 + i * w * 0.16, 0, sz * d * 0.25, crop, 6);
    }
  }
}

/** 谷仓：红板墙 + 双坡顶 + 大门。 */
function buildBarn(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  box(g, w, h * 0.62, d, 0, 0, 0, std(c || "#A03028", 0.9));
  const rise = h * 0.38;
  const slope = Math.hypot(w / 2, rise);
  const ang = Math.atan2(rise, w / 2);
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.05, d), std("#6A4A2A", 0.9));
    panel.position.set((s * w) / 4, h * 0.62 + rise / 2, 0);
    panel.rotation.z = -s * ang;
    add(g, panel);
  }
  box(g, w * 0.3, h * 0.45, 0.04, 0, 0, d / 2, std("#5A3A22", 0.9));
}

/** 马厩：四柱 + 顶盖 + 两道隔栏 + 食槽。 */
function buildStable(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#8A6A42", 0.9);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    box(g, 0.08, h * 0.75, 0.08, sx * w * 0.42, 0, sz * d * 0.42, wood);
  }
  box(g, w, 0.05, d, 0, h * 0.75, 0, std("#6A4A2A", 0.9));
  for (const sx of [-1, 1]) box(g, 0.04, h * 0.4, d * 0.8, sx * w * 0.15, 0, 0, wood);
  box(g, w * 0.8, h * 0.15, d * 0.2, 0, 0, -d * 0.35, std("#5A3A22", 0.9));
}

/** 草垛：圆柱底 + 圆锥顶。 */
function buildHaystack(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const hay = std(c || "#D8B060", 0.95);
  const m = Math.min(w, d);
  cyl(g, m * 0.4, m * 0.42, h * 0.25, 0, 0, 0, hay, 14);
  cone(g, m * 0.42, h * 0.75, 0, h * 0.25, 0, hay, 14);
}

/** 站台：台面 + 四柱雨棚 + 站牌。 */
function buildPlatform(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  box(g, w, h * 0.28, d, 0, 0, 0, std(c || "#C8C8C8", 0.9));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    cyl(g, 0.05, 0.05, h * 0.6, sx * w * 0.45, h * 0.28, sz * d * 0.4, std("#5A5A5A", 0.4, 0.7), 10);
  }
  box(g, w, 0.05, d, 0, h * 0.88, 0, std("#8A8A8A", 0.9));
  box(g, w * 0.3, h * 0.08, 0.03, 0, h * 0.7, d / 2, std("#2A5A8A", 0.7));
}

/** 铁轨：道砟底 + 十根轨枕 + 双轨。 */
function buildRailTrack(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  box(g, w, 0.03, d, 0, 0, 0, std("#6A6A60", 0.95));
  for (let i = 0; i < 10; i++) {
    box(g, 0.18, 0.03, d * 0.8, -w * 0.45 + (i * w * 0.9) / 9, 0.03, 0, std("#4A3A2A", 0.9));
  }
  for (const sz of [-1, 1]) {
    box(g, w, 0.04, 0.08, 0, h * 0.55, sz * d * 0.3, std("#8A8A8A", 0.3, 0.8));
  }
}

/** 石灯笼：基座 + 柱 + 灯室 + 四棱宝珠顶。 */
function buildStoneLantern(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const stone = std(c || "#8A8A80", 0.95);
  box(g, w * 0.5, h * 0.12, d * 0.5, 0, 0, 0, stone);
  box(g, w * 0.25, h * 0.5, d * 0.25, 0, h * 0.12, 0, stone);
  box(g, w * 0.4, h * 0.25, d * 0.4, 0, h * 0.62, 0, stone);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.35, h * 0.13, 4), stone);
  cap.position.set(0, h * 0.87 + h * 0.065, 0);
  cap.rotation.y = Math.PI / 4;
  add(g, cap);
}


/** 瀑布：岩壁 + 半透明落水 + 前方水潭。 */
function buildWaterfall(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  box(g, w, h, d * 0.45, 0, 0, -d * 0.275, std(c || "#7A8A8A", 0.95));
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.55, h * 0.85, 0.04),
    new THREE.MeshStandardMaterial({
      color: "#D8ECF8", roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.8,
    }));
  water.position.set(0, h * 0.08 + h * 0.425, d * 0.2);
  add(g, water);
  cyl(g, Math.min(w, d) * 0.32, Math.min(w, d) * 0.32, 0.05, 0, 0, d * 0.15,
    new THREE.MeshStandardMaterial({
      color: "#3A90C0", roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85,
    }), 20);
}

/** 花架亭：四柱 + 两横梁 + 五根顶条。 */
function buildPergola(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  const wood = std(c || "#C8A070", 0.9);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    box(g, 0.09, h * 0.8, 0.09, sx * w * 0.44, 0, sz * d * 0.44, wood);
  }
  for (const sz of [-1, 1]) box(g, w, 0.06, 0.08, 0, h * 0.8, sz * d * 0.44, wood);
  for (let i = 0; i < 5; i++) {
    box(g, 0.07, 0.04, d, -w * 0.4 + (i * w * 0.8) / 4, h * 0.86, 0, wood);
  }
}

/** 长枪：枪杆 + 枪尖（插地竖立）。 */
function buildSpear(g: THREE.Group, w: number, d: number, h: number, c: string): void {
  cyl(g, 0.02, 0.025, h * 0.9, 0, 0, 0, std("#8A6A42", 0.9), 8);
  cone(g, 0.035, h * 0.1, 0, h * 0.9, 0, std("#8A8A8A", 0.3, 0.8), 8);
}
// ─── 登记 ──────────────────────────────────────────────────────────────────

const PROCEDURAL_BUILDERS: Record<string, Builder> = {
  "proc-han-ta": buildHanTa,
  "proc-han-an": buildHanAn,
  "proc-han-ji": buildHanJi,
  "proc-boshanlu": buildBoshanlu,
  "proc-lacquer-bowl": buildLacquerBowl,
  "proc-huchuang": buildHuchuang,
  "proc-wood-stool": buildWoodStool,
  "proc-celadon-vase": buildCeladonVase,
  "proc-buddha-statue": buildBuddhaStatue,
  "proc-shrine-niche": buildShrineNiche,
  "proc-cross": buildCross,
  "proc-yurt": buildYurt,
  "proc-bluewhite-vase": buildBluewhiteVase,
  "proc-banpo-pot": buildBanpoPot,
  "proc-banpo-firepit": buildFirepit,
  "proc-earth-platform": buildEarthPlatform,
  "proc-banpo-house": buildBanpoHouse,
  "proc-hemudu-pot": buildHemuduPot,
  "proc-hemudu-stilt": buildHemuduStilt,
  "proc-kang": buildKang,
  "proc-oil-lamp": buildOilLamp,
  "proc-kerosene-lamp": buildKeroseneLamp,
  "proc-wood-chest": buildWoodChest,
  "proc-millet-sheaf": buildGrainSheaf("#D8B060"),
  "proc-rice-sheaf": buildGrainSheaf("#C8C078"),
  "proc-bogujia": buildBogujia,
  "proc-school-desk": buildSchoolDesk,
  "proc-blackboard": buildBlackboard,
  "proc-school-broom": buildBroom,
  "proc-hospital-bed": buildHospitalBed,
  "proc-iv-stand": buildIvStand,
  "proc-med-strip": buildMedStrip,
  "proc-camp-chair": buildCampChair,
  "proc-thermos": buildThermos,
  "proc-basin": buildBasin,
  "proc-mirror-wall": buildMirrorWall,
  "proc-chandelier-crystal": buildChandelierCrystal,
  "proc-gilt-chair": buildGiltChair,
  "proc-tatami": buildTatami,
  "proc-tokonoma": buildTokonoma,
  "proc-shoji": buildShoji,
  "proc-floor-cushion": buildFloorCushion,
  "proc-futon": buildFuton,
  "proc-ondol-table": buildOndolTable,
  "proc-ondol-floor": buildOndolFloor,
  "proc-hanok-stove": buildHanokStove,
  // ── 高频日常场景（学校/家庭/公司/联想补充）──
  "proc-bunk-bed": buildBunkBed,
  "proc-library-shelf": buildLibraryShelf,
  "proc-cafeteria-table": buildCafeteriaTable,
  "proc-serving-counter": buildServingCounter,
  "proc-water-tap-row": buildWaterTapRow,
  "proc-basketball-hoop": buildBasketballHoop,
  "proc-goal-post": buildGoalPost,
  "proc-track-lane": buildTrackLane,
  "proc-parking-stop": buildParkingStop,
  "proc-outdoor-bench": buildOutdoorBench,
  "proc-ceo-desk": buildCeoDesk,
  "proc-meeting-table": buildMeetingTable,
  "proc-reception-desk": buildReceptionDesk,
  "proc-elevator-car": buildElevatorCar,
  "proc-pantry-counter": buildPantryCounter,
  "proc-whiteboard": buildWhiteboard,
  "proc-evidence-board": buildEvidenceBoard,
  "proc-bar-counter": buildBarCounter,
  "proc-judge-bench": buildJudgeBench,
  "proc-witness-stand": buildWitnessStand,
  "proc-gym-treadmill": buildGymTreadmill,
  "proc-gym-bench": buildGymBench,
  "proc-dumbbell-rack": buildDumbbellRack,
  "proc-supermarket-shelf": buildSupermarketShelf,
  "proc-checkout-counter": buildCheckoutCounter,
  "proc-shopping-cart": buildShoppingCart,
  "proc-ktv-screen": buildKtvScreen,
  "proc-wedding-arch": buildWeddingArch,
  "proc-wedding-stage": buildWeddingStage,
  "proc-cooktop": buildCooktop,
  // ── 户外场景（室外片场 26 个）──
  "proc-tree-oak": buildTree,
  "proc-tree-peach": buildTree,
  "proc-pine": buildPine,
  "proc-pine-snow": buildPine,
  "proc-palm": buildPalm,
  "proc-bamboo-clump": buildBambooClump,
  "proc-rock": buildRock,
  "proc-rock-big": buildRock,
  "proc-bush": buildBush,
  "proc-bush-snow": buildBush,
  "proc-grass-tuft": buildGrassTuft,
  "proc-flower-lavender": buildFlowerCluster,
  "proc-flower-mixed": buildFlowerCluster,
  "proc-flower-rapeseed": buildFlowerCluster,
  "proc-ground-grass": buildGroundPatch,
  "proc-ground-sand": buildGroundPatch,
  "proc-ground-snow": buildGroundPatch,
  "proc-ground-stone": buildGroundPatch,
  "proc-ground-dry": buildGroundPatch,
  "proc-water-plane": buildWaterPlane,
  "proc-sea-plane": buildWaterPlane,
  "proc-mountain": buildMountain,
  "proc-mountain-snow": buildMountain,
  "proc-dune": buildDune,
  "proc-street-lamp": buildStreetLamp,
  "proc-tent": buildTent,
  "proc-banner": buildBanner,
  "proc-city-wall": buildCityWall,
  "proc-city-gate": buildCityGate,
  "proc-arch-bridge": buildArchBridge,
  "proc-wooden-boat": buildWoodenBoat,
  "proc-shop-facade": buildShopFacade,
  "proc-timber-facade": buildTimberFacade,
  "proc-tea-row": buildTeaRow,
  "proc-rice-paddy": buildRicePaddy,
  "proc-crop-row": buildCropRow,
  "proc-barn": buildBarn,
  "proc-stable": buildStable,
  "proc-haystack": buildHaystack,
  "proc-platform": buildPlatform,
  "proc-rail-track": buildRailTrack,
  "proc-stone-lantern": buildStoneLantern,
  "proc-waterfall": buildWaterfall,
  "proc-pergola": buildPergola,
  "proc-spear": buildSpear,
  // ── 繁荣/衰败成对场景（第 5 批）──
  "proc-rubble-pile": buildRubblePile,
  "proc-broken-table": buildBrokenTable,
  "proc-broken-chair": buildBrokenChair,
  "proc-cobweb": buildCobweb,
  "proc-weed-clump": buildWeedClump,
  "proc-broken-wall": buildBrokenWall,
  "proc-market-stall": buildMarketStall,
  "proc-lantern-pole": buildLanternPole,
  "proc-roman-column": buildRomanColumn,
  "proc-fallen-column": buildFallenColumn,
  "proc-pailou": buildPailou,
  // ── 门窗修复 fix (c)：无墙场景的独立门/窗道具 ──
  "proc-door-frame-wood": buildDoorFrameWood,
  "proc-moon-gate": buildMoonGate,
  "proc-lattice-window": buildLatticeWindow,
  // ── 门窗 Phase D：垂花门（程序化重建，全网无 web-ready 来源）──
  "proc-chuihua-gate": buildChuihuaGate,
  // ── 门窗 Phase D（扩围）：葫芦/八角洞门（Blender GLB 优先 + 程序化回退）、扇窗、石库门 ──
  "proc-gourd-gate": buildGourdGate,
  "proc-octagon-gate": buildOctagonalGate,
  "proc-suiqiang-gate": buildSuiqiangGate,
  "proc-fan-window": buildFanWindow,
  "proc-shikumen-gate": buildShikumenGate,
  "proc-stone-well": buildStoneWell,
  "proc-burnt-beam": buildBurntBeam,
  "proc-dead-tree": buildDeadTree,
  "proc-rockery": buildRockery,
  "proc-toppled-shelf": buildToppledShelf,
};

/** 全部程序化家具 id（目录/模板/渲染分流/harness 共用）。 */
export const PROCEDURAL_FURNITURE_IDS: string[] = Object.keys(PROCEDURAL_BUILDERS);

/**
 * 构建一件程序化家具的 three.js Group（局部原点=占地中心、y=0 为地面）。
 * 未知 id 返回 null（调用方回退到通用盒子，不让场景崩掉）。
 */
export function buildProceduralGeometry(
  id: string, w: number, d: number, h: number, color: string, secondaryColor?: string,
): THREE.Group | null {
  const build = PROCEDURAL_BUILDERS[id];
  if (!build) return null;
  const g = new THREE.Group();
  build(g, w, d, h, color, secondaryColor);
  return g;
}
