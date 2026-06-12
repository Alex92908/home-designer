#!/usr/bin/env node
/**
 * 资产审计 — 盘点家具/户外/材质的真资产覆盖率，按类目列缺口。
 * 用法：node scripts/asset-audit.mjs [--missing]
 *   --missing  额外列出每个类目下没有 GLB 的家具 id（盯批次进度用）
 *
 * 纯文本解析（不 import TS），口径：
 *   家具   = src/lib/furniture.ts 里的目录项，model3d.url 视为有真模型
 *   户外   = src/lib/outdoorAssets.ts 的 kind 条目，glb/customGltfPath 视为有真模型
 *   材质   = src/lib/data.ts 的 MATERIALS，texture 字段视为有贴图（含 CSS 渐变，单列）
 */
import { readFileSync, statSync, readdirSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const showMissing = process.argv.includes("--missing");

// ── 家具 ─────────────────────────────────────────────────────────
// 逐个对象块扫描：以 `{ id:` 或 `{\n id:` 开界，块内找 category / model3d。
const furnitureSrc = read("src/lib/furniture.ts");
const furnitureBlocks = [];
{
  // 切块：匹配 id: "xxx" 之后到下一个 id: 之前的文本（够准——目录是平铺数组）
  const re = /id:\s*"([^"]+)"/g;
  const ids = [];
  let m;
  while ((m = re.exec(furnitureSrc))) ids.push({ id: m[1], at: m.index });
  for (let i = 0; i < ids.length; i++) {
    const chunk = furnitureSrc.slice(ids[i].at, ids[i + 1]?.at ?? furnitureSrc.length);
    const cat = chunk.match(/category:\s*"([^"]+)"/)?.[1] ?? "?";
    const hasGlb = /model3d:\s*\{/.test(chunk);
    furnitureBlocks.push({ id: ids[i].id, cat, hasGlb });
  }
}

// ── 户外 ─────────────────────────────────────────────────────────
const outdoorSrc = read("src/lib/outdoorAssets.ts");
const outdoorBlocks = [];
{
  const re = /kind:\s*"([a-z]+\.[a-zA-Z]+)"/g;
  const ids = [];
  let m;
  while ((m = re.exec(outdoorSrc))) ids.push({ id: m[1], at: m.index });
  for (let i = 0; i < ids.length; i++) {
    const chunk = outdoorSrc.slice(ids[i].at, ids[i + 1]?.at ?? outdoorSrc.length);
    const hasGlb = /glb|GltfPath/.test(chunk);
    outdoorBlocks.push({ id: ids[i].id, cat: ids[i].id.split(".")[0], hasGlb });
  }
}

// ── 材质 ─────────────────────────────────────────────────────────
const dataSrc = read("src/lib/data.ts");
const materialBlocks = [];
{
  const re = /id:\s*"((?:wall|floor|light|tile)-[^"]+)"/g;
  const ids = [];
  let m;
  while ((m = re.exec(dataSrc))) ids.push({ id: m[1], at: m.index });
  for (let i = 0; i < ids.length; i++) {
    const chunk = dataSrc.slice(ids[i].at, ids[i + 1]?.at ?? dataSrc.length);
    const cat = chunk.match(/category:\s*"([^"]+)"/)?.[1] ?? "?";
    const hasTexture = /texture:\s*"/.test(chunk);
    materialBlocks.push({ id: ids[i].id, cat, hasTexture });
  }
}

// ── 模型体积 ────────────────────────────────────────────────────
function dirSize(p) {
  let total = 0;
  let files = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else { total += statSync(fp).size; files++; }
    }
  };
  try { walk(path.join(ROOT, p)); } catch { /* absent */ }
  return { total, files };
}
const models = dirSize("public/models");
const biggest = [];
{
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/\.(glb|gltf|bin|png|jpe?g|webp)$/i.test(e.name)) {
        biggest.push({ f: path.relative(ROOT, fp), s: statSync(fp).size });
      }
    }
  };
  try { walk(path.join(ROOT, "public/models")); } catch { /* absent */ }
  biggest.sort((a, b) => b.s - a.s);
}

// ── 输出 ─────────────────────────────────────────────────────────
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const MB = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;

const byCat = (rows, key) => {
  const map = new Map();
  for (const r of rows) {
    const e = map.get(r.cat) ?? { total: 0, ok: 0, missing: [] };
    e.total++;
    if (r[key]) e.ok++; else e.missing.push(r.id);
    map.set(r.cat, e);
  }
  return [...map.entries()].sort((a, b) => (b[1].total - b[1].ok) - (a[1].total - a[1].ok));
};

console.log("══ 资产审计 ══════════════════════════════════════");
const fOk = furnitureBlocks.filter(b => b.hasGlb).length;
console.log(`\n■ 家具 GLB 覆盖：${fOk}/${furnitureBlocks.length}（${pct(fOk, furnitureBlocks.length)}）`);
for (const [cat, e] of byCat(furnitureBlocks, "hasGlb")) {
  if (e.ok === e.total) continue;
  console.log(`  ${cat.padEnd(22)} ${String(e.ok).padStart(3)}/${String(e.total).padEnd(3)} 缺 ${e.total - e.ok}`);
  if (showMissing) for (const id of e.missing) console.log(`      - ${id}`);
}

const oOk = outdoorBlocks.filter(b => b.hasGlb).length;
console.log(`\n■ 户外 GLB 覆盖：${oOk}/${outdoorBlocks.length}（${pct(oOk, outdoorBlocks.length)}）`);
for (const [cat, e] of byCat(outdoorBlocks, "hasGlb")) {
  console.log(`  ${cat.padEnd(22)} ${String(e.ok).padStart(3)}/${String(e.total).padEnd(3)} 缺 ${e.total - e.ok}`);
  if (showMissing) for (const id of e.missing) console.log(`      - ${id}`);
}

const mOk = materialBlocks.filter(b => b.hasTexture).length;
console.log(`\n■ 材质贴图（含 CSS 渐变）：${mOk}/${materialBlocks.length}（${pct(mOk, materialBlocks.length)}）`);
for (const [cat, e] of byCat(materialBlocks, "hasTexture")) {
  console.log(`  ${cat.padEnd(22)} ${String(e.ok).padStart(3)}/${String(e.total).padEnd(3)} 缺 ${e.total - e.ok}`);
}

console.log(`\n■ public/models 体积：${MB(models.total)}（${models.files} 个文件）`);
console.log("  最大的 10 个文件：");
for (const b of biggest.slice(0, 10)) console.log(`  ${MB(b.s).padStart(8)}  ${b.f}`);
console.log("");
