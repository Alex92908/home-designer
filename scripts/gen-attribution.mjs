#!/usr/bin/env node
/**
 * 扫描 public/models 下所有 license.txt（Sketchfab 下载自带），解析出
 * 标题/作者/来源/许可，生成 src/data/attribution.json 供 /credits 页渲染。
 * CC-BY 模型必须署名 —— 这是合规来源，随每次下载新模型重跑即可。
 *
 * 用法：node scripts/gen-attribution.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "public", "models");
const OUT = path.resolve(process.cwd(), "src", "data", "attribution.json");

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.name.toLowerCase() === "license.txt") out.push(p);
  }
  return out;
}

function field(txt, label) {
  const m = txt.match(new RegExp(`\\*\\s*${label}:\\s*(.+)`));
  return m ? m[1].trim() : "";
}

async function main() {
  const files = await walk(ROOT);
  const seen = new Set();
  const items = [];
  for (const f of files) {
    const txt = await fs.readFile(f, "utf8");
    const title = field(txt, "title");
    const source = field(txt, "source");
    const authorRaw = field(txt, "author");
    const license = field(txt, "license type") || "CC-BY-4.0";
    // author: "name (url)"
    const am = authorRaw.match(/^(.*?)\s*\((https?:[^)]+)\)\s*$/);
    const author = am ? am[1].trim() : authorRaw;
    const authorUrl = am ? am[2].trim() : "";
    if (!title || seen.has(source || title)) continue;
    seen.add(source || title);
    items.push({ title, author, authorUrl, source, license });
  }
  items.sort((a, b) => a.title.localeCompare(b.title));
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(items, null, 2));
  console.log(`✓ ${items.length} 条署名写入 ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
