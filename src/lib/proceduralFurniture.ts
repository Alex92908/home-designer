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
