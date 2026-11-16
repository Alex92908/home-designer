/**
 * verify-director-sets.mjs — 导演台片场自检（node 直接跑，不用起 dev server）。
 *
 * 用法：node scripts/verify-director-sets.mjs
 * 依赖：仓库自带的 jiti（TS 直读）+ three（几何验证）。
 *
 * 查 7 件事（失败即非零退出）：
 *  1. 程序化几何：每个 proc- builder 生成的 Group 包围盒有限、无 NaN、
 *     落在声明尺寸内（允许 5cm/15% 的小 protrusion，如镜框/粉笔槽）。
 *  2. 注册表一致：PROCEDURAL_FURNITURE_IDS ⟷ FURNITURE 里的 proc- 项
 *     双向一致，且 proc- 项都没有 model3d（程序化件不走 GLB）。
 *  3. 模板拼贴：每个新场景每层楼的房间矩形无重叠、面积之和 = 外接矩形面积。
 *  4. 摆放合法：每件家具的旋转后占地落在所属房间内（允 5cm 误差）；
 *     elevationY>0 的件正下方 30cm 内须有承托物（或在墙挂白名单里）。
 *  5. 房间全覆盖：新场景每个房间都在 furnitureOverrides 里出现（不漏给
 *     风格模板去铺现代家具串味；空房间用 [] 显式清空）。
 *  6. 关键词：12 个新场景各命中、旧 10 个场景不回归（尤其 民国农村 vs
 *     石库门、近郊别墅 vs 泛别墅、半坡 vs 河姆渡、裸客厅不劫持）。
 *  7. 清单：SCENE_SETS 总数 = 22，含全部 12 个新 id；旧 10 个场景仍
 *     在清单里、关键词仍命中（旧场景的拼贴/摆放不查：咖啡馆/办公室/
 *     餐厅用多边形房间与墙挂件，矩形拼贴与“正下方承托”规则对它们不适用，
 *     且本次未动它们的代码——回归只查清单与关键词）。
 */
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const { buildProceduralGeometry, PROCEDURAL_FURNITURE_IDS } =
  jiti("../src/lib/proceduralFurniture.ts");
const { FURNITURE, getFurnitureById } = jiti("../src/lib/furniture.ts");
const { PROJECT_TEMPLATES } = jiti("../src/lib/projectTemplates.ts");
const { matchProjectTemplate } = jiti("../src/lib/matchProjectTemplate.ts");
const { SCENE_SETS } = jiti("../src/lib/sceneSets.ts");

const NEW_SET_IDS = [
  "set-villa-suburban", "set-school", "set-hospital", "set-qinhan",
  "set-weijin", "set-yuan", "set-banpo", "set-hemudu",
  "set-rural-republican", "set-versailles", "set-washitsu", "set-hanok",
];
const OLD_SET_IDS = [
  "set-cafe", "set-office", "set-restaurant", "set-apartment",
  "set-rural-hall", "set-ming-hall", "set-qing-sanxitang",
  "set-tang-palace", "set-song-study", "set-shikumen",
];
// 墙挂/悬置件：正下方无承托物是设计如此（黑板/设备带挂墙；漆碗在干栏
// 长屋架空地板上，地板本身不是一件家具）。
const SUSPENDED_ALLOWLIST = new Set(["proc-blackboard", "proc-med-strip", "proc-lacquer-bowl"]);

let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log(`  PASS ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}`); }
}
function section(name) { console.log(`\n## ${name}`); }

const byId = Object.fromEntries(FURNITURE.map((f) => [f.id, f]));

// ── 1. 程序化几何 ────────────────────────────────────────────────
section("1. procedural geometry");
const THREE = await import("three");
for (const id of PROCEDURAL_FURNITURE_IDS) {
  const item = byId[id];
  const w = item.width / 100, d = item.depth / 100, h = item.height / 100;
  const g = buildProceduralGeometry(id, w, d, h, item.color, item.secondaryColor);
  if (!g) { ok(false, `${id}: builder returned null`); continue; }
  let meshes = 0;
  g.traverse((o) => { if (o.isMesh) meshes++; });
  // 逐顶点精确包围盒：Box3.setFromObject 会对旋转件取几何 AABB 的角点再
  // 变换，会把 45° 方锥顶这类件高估 √2 倍，不能用。
  const box3 = new THREE.Box3();
  const v = new THREE.Vector3();
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry?.attributes?.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      box3.expandByPoint(v);
    }
  });
  const size = new THREE.Vector3();
  box3.getSize(size);
  const finite = [box3.min.x, box3.min.y, box3.min.z, box3.max.x, box3.max.y, box3.max.z]
    .every(Number.isFinite);
  const within =
    size.x <= w * 1.15 + 0.1 && size.z <= d * 1.15 + 0.1 &&
    size.y <= h * 1.15 + 0.1 && box3.min.y >= -0.05;
  ok(finite && within && meshes > 0,
    `${id}: meshes=${meshes} bbox=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}m vs declared ${w}x${h}x${d}m minY=${box3.min.y.toFixed(3)}`);
}

// ── 2. 注册表一致 ────────────────────────────────────────────────
section("2. registry <-> catalog");
const catalogProc = FURNITURE.filter((f) => f.id.startsWith("proc-")).map((f) => f.id);
ok(catalogProc.length === PROCEDURAL_FURNITURE_IDS.length,
  `proc count: registry=${PROCEDURAL_FURNITURE_IDS.length} catalog=${catalogProc.length}`);
for (const id of PROCEDURAL_FURNITURE_IDS) {
  const item = byId[id];
  ok(!!item, `${id} in FURNITURE`);
  if (item) {
    ok(!item.model3d, `${id} has no model3d (procedural)`);
    ok(item.width > 0 && item.depth > 0 && item.height > 0, `${id} dims positive`);
  }
}
for (const id of catalogProc) {
  ok(PROCEDURAL_FURNITURE_IDS.includes(id), `${id} in registry`);
}

// ── 3/4/5. 模板：拼贴 + 摆放 + 全覆盖 ───────────────────────────
section("3-5. templates: tiling, placement, override coverage");
const STYLE_IDS = new Set(["nordic", "luxury", "industrial", "japanese", "chinese", "modern-villa", "walnut-villa", "stone-villa"]);
function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.depth && b.y < a.y + a.depth;
}
for (const tpl of PROJECT_TEMPLATES) {
  const isNew = NEW_SET_IDS.includes(tpl.id);
  if (!isNew) continue; // 只查新 12 场景（旧场景见文件头说明）
  ok(tpl.id.startsWith("set-"), `${tpl.id}: id has set- prefix`);
  ok(STYLE_IDS.has(tpl.styleTemplateId), `${tpl.id}: styleTemplateId ${tpl.styleTemplateId} known`);
  for (let fi = 0; fi < tpl.floorLayouts.length; fi++) {
    const layout = tpl.floorLayouts[fi];
    const rooms = layout.rooms;
    // 拼贴：无重叠 + 面积和 = 外接矩形
    let overlap = false;
    for (let i = 0; i < rooms.length; i++)
      for (let j = i + 1; j < rooms.length; j++)
        if (rectsOverlap(rooms[i], rooms[j])) overlap = true;
    const areaSum = rooms.reduce((s, r) => s + r.width * r.depth, 0);
    const minX = Math.min(...rooms.map((r) => r.x)), minY = Math.min(...rooms.map((r) => r.y));
    const maxX = Math.max(...rooms.map((r) => r.x + r.width)), maxY = Math.max(...rooms.map((r) => r.y + r.depth));
    const bboxArea = (maxX - minX) * (maxY - minY);
    ok(!overlap && areaSum === bboxArea,
      `${tpl.id} floor${fi}: tiling areaSum=${areaSum} bbox=${bboxArea} overlap=${overlap}`);
    // 全覆盖：每个房间都在 furnitureOverrides 里出现
    {
      const overrides = tpl.furnitureOverrides?.[fi] ?? null;
      ok(!!overrides, `${tpl.id} floor${fi}: has furnitureOverrides`);
      if (overrides) {
        for (const r of rooms) {
          ok(Object.prototype.hasOwnProperty.call(overrides, r.room),
            `${tpl.id} floor${fi}: room ${r.room} (${r.name}) overridden`);
        }
      }
    }
    // 摆放合法
    const overrides = tpl.furnitureOverrides?.[fi];
    if (!overrides) continue;
    for (const [roomId, items] of Object.entries(overrides)) {
      const room = rooms.find((r) => r.room === roomId);
      if (!room) { ok(false, `${tpl.id}: override room ${roomId} not in layout`); continue; }
      for (const it of items) {
        const f = getFurnitureById(it.furnitureId);
        ok(!!f, `${tpl.id}/${roomId}: ${it.furnitureId} resolves`);
        if (!f) continue;
        const sw = it.scaleW ?? 1, sd = it.scaleD ?? 1;
        const wCm = f.width * sw, dCm = f.depth * sd;
        const rot90 = it.rotation === 90 || it.rotation === 270;
        const fw = rot90 ? dCm : wCm, fd = rot90 ? wCm : dCm;
        // overrides 坐标是 room-local（原点=房间左上），比较 local 坐标对房间宽深。
        const localInside =
          it.x - fw / 2 >= -5 && it.x + fw / 2 <= room.width + 5 &&
          it.z - fd / 2 >= -5 && it.z + fd / 2 <= room.depth + 5;
        ok(localInside, `${tpl.id}/${roomId}: ${it.furnitureId} @(${it.x},${it.z}) ${fw.toFixed(0)}x${fd.toFixed(0)} in ${room.width}x${room.depth}`);
        // elevationY 承托检查
        const elev = it.elevationY ?? 0;
        if (elev > 0 && !it.mountCeiling) {
          let supported = false;
          for (const other of items) {
            if (other === it) continue;
            const of = getFurnitureById(other.furnitureId);
            if (!of) continue;
            const osw = other.scaleW ?? 1, osd = other.scaleD ?? 1, osh = other.scaleH ?? 1;
            const ow = of.width * osw, od = of.depth * osd;
            const orot90 = other.rotation === 90 || other.rotation === 270;
            const ofw = orot90 ? od : ow, ofd = orot90 ? ow : od;
            const oElev = other.elevationY ?? 0;
            const top = oElev + of.height * osh;
            const covers = Math.abs(it.x - other.x) <= ofw / 2 + 8 && Math.abs(it.z - other.z) <= ofd / 2 + 8;
            if (covers && Math.abs(top - elev) <= 30) { supported = true; break; }
          }
          ok(supported || SUSPENDED_ALLOWLIST.has(it.furnitureId),
            `${tpl.id}/${roomId}: ${it.furnitureId} elev=${elev} supported=${supported}`);
        }
      }
    }
  }
}

// ── 6. 关键词 ────────────────────────────────────────────────────
section("6. keyword matching");
const MATCH_CASES = [
  // [输入, 期望 id]
  ["近郊别墅", "set-villa-suburban"],
  ["郊区别墅", "set-villa-suburban"],
  ["学校教室", "set-school"],
  ["教室", "set-school"],
  ["黑板", "set-school"],
  ["医院病房", "set-hospital"],
  ["住院陪护", "set-hospital"],
  ["秦汉", "set-qinhan"],
  ["汉代宴饮", "set-qinhan"],
  ["魏晋清谈", "set-weijin"],
  ["南北朝", "set-weijin"],
  ["元代蒙古包", "set-yuan"],
  ["元朝", "set-yuan"],
  ["半坡", "set-banpo"],
  ["仰韶", "set-banpo"],
  ["河姆渡", "set-hemudu"],
  ["干栏式", "set-hemudu"],
  ["民国农村", "set-rural-republican"],
  ["窑洞", "set-rural-republican"],
  ["火炕", "set-rural-republican"],
  ["一明二暗", "set-rural-republican"],
  ["凡尔赛宫", "set-versailles"],
  ["镜厅", "set-versailles"],
  ["和室", "set-washitsu"],
  ["榻榻米", "set-washitsu"],
  ["韩屋", "set-hanok"],
  ["温突", "set-hanok"],
  // 不回归
  ["咖啡馆", "set-cafe"],
  ["火锅店", "set-restaurant"],
  ["办公室", "set-office"],
  ["小户型客厅", "set-apartment"],
  ["明代厅堂", "set-ming-hall"],
  ["三希堂", "set-qing-sanxitang"],
  ["唐宫宴会", "set-tang-palace"],
  ["宋代书斋", "set-song-study"],
  ["农村堂屋", "set-rural-hall"],
  ["民国石库门", "set-shikumen"],
  ["民国", "set-shikumen"],
  ["别墅", "modern-pool-villa"],
  ["日式禅意", "japanese-zen-villa"],
];
for (const [input, expected] of MATCH_CASES) {
  const got = matchProjectTemplate(input)?.id ?? null;
  ok(got === expected, `match(${JSON.stringify(input)}) = ${got} (want ${expected})`);
}
ok(matchProjectTemplate("客厅") === null, `match("客厅") = null (bare living room hijacks nothing)`);
ok(matchProjectTemplate("上海") === null, `match("上海") = null`);

// ── 7. 清单 ─────────────────────────────────────────────────────
section("7. manifest");
ok(SCENE_SETS.length === 22, `SCENE_SETS total = ${SCENE_SETS.length} (want 22)`);
for (const id of [...OLD_SET_IDS, ...NEW_SET_IDS]) {
  ok(SCENE_SETS.some((s) => s.id === id), `manifest contains ${id}`);
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
