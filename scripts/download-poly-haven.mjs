#!/usr/bin/env node
/**
 * Download Poly Haven glTF models + PBR textures into public/models/.
 *
 * Usage:
 *   node scripts/download-poly-haven.mjs             # download default list
 *   node scripts/download-poly-haven.mjs --res=2k    # higher-res textures
 *   node scripts/download-poly-haven.mjs --force     # re-download even if present (fix corrupt bins)
 *
 * Assets are CC0 (https://polyhaven.com/license).
 *
 * Directory layout after run:
 *   public/models/<category>/<slug>/
 *     <slug>_1k.gltf
 *     <slug>.bin
 *     textures/<slug>_diff_1k.jpg   (albedo)
 *     textures/<slug>_nor_gl_1k.jpg (normal)
 *     textures/<slug>_arm_1k.jpg    (AO+rough+metal packed)
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

// ── Assets to download ─────────────────────────────────────────
// Slug → category (project furniture category dir).
const ASSETS = [
  // ── Round 1 (already downloaded) ──────────────────────
  { slug: "sofa_02",                   category: "sofa" },
  { slug: "modern_coffee_table_01",    category: "coffee_table" },
  { slug: "modern_wooden_cabinet",     category: "tv_unit" },
  { slug: "mid_century_lounge_chair",  category: "dining_chair" },
  { slug: "side_table_01",             category: "nightstand" },

  // ── Round 2: sofas ────────────────────────────────────
  { slug: "sofa_03",                   category: "sofa" },   // modern minimal
  { slug: "Sofa_01",                   category: "sofa" },   // classic

  // ── Round 2: coffee tables (better style matches) ─────
  { slug: "coffee_table_round_01",     category: "coffee_table" },  // 真·圆茶几
  { slug: "industrial_coffee_table",   category: "coffee_table" },  // metal+wood
  { slug: "modern_coffee_table_02",    category: "coffee_table" },

  // ── Round 2: dining tables + chairs ───────────────────
  { slug: "round_wooden_table_01",     category: "dining_table" },
  { slug: "WoodenTable_02",            category: "dining_table" },
  { slug: "dining_chair_02",           category: "dining_chair" },  // actual dining chair

  // ── Round 2: desks ────────────────────────────────────
  { slug: "metal_office_desk",         category: "desk" },

  // ── Round 2: bookshelves ──────────────────────────────
  { slug: "wooden_bookshelf_worn",     category: "bookshelf" },
  { slug: "steel_frame_shelves_01",    category: "bookshelf" },

  // ── Round 2: nightstands + cabinets ───────────────────
  { slug: "ClassicNightstand_01",      category: "nightstand" },
  { slug: "painted_wooden_cabinet_02", category: "sideboard" },
  { slug: "vintage_cabinet_01",        category: "sideboard" },

  // ── Round 2: armchairs (new use case, map to accent) ──
  { slug: "modern_arm_chair_01",       category: "accent_chair" },
  { slug: "ArmChair_01",               category: "accent_chair" },

  // ── Round 4: outdoor landscape — shrubs, rocks, plants ───────
  // shrub_02 OK; shrub_01/03/04 .bin truncated (30-49%) — re-download
  { slug: "shrub_01",               category: "outdoor_shrub" },
  { slug: "shrub_02",               category: "outdoor_shrub" },
  { slug: "shrub_03",               category: "outdoor_shrub" },
  { slug: "shrub_04",               category: "outdoor_shrub" },
  { slug: "boulder_01",             category: "outdoor_rock"  },
  { slug: "coast_rocks_01",         category: "outdoor_rock"  },
  // Plants — all .bin truncated (30-49%) — re-download all
  { slug: "crystalline_iceplant",   category: "outdoor_plant" },
  { slug: "cheiridopsis_succulent", category: "outdoor_plant" },
  { slug: "anthurium_botany_01",    category: "outdoor_plant" },
  { slug: "calathea_orbifolia_01",  category: "outdoor_plant" },
  { slug: "dandelion_01",           category: "outdoor_plant" },
  { slug: "celandine_01",           category: "outdoor_plant" },
  // Potted plants — .bin truncated (36-47%) — re-download
  { slug: "potted_plant_01",        category: "plant"         },
  { slug: "potted_plant_02",        category: "plant"         },
  { slug: "potted_plant_04",        category: "plant"         },
  // Dresser — .bin truncated (38%) — re-download
  { slug: "drawer_cabinet",         category: "dresser"       },

  // ── Round 5: outdoor furniture alternatives (Poly Haven CC0) ──
  // Sketchfab outdoor furniture has no gltf download available.
  // These Poly Haven models serve as stand-ins:
  { slug: "outdoor_table_chair_set_01", category: "outdoor_furniture" },  // dining set
  { slug: "planter_pot_clay",           category: "outdoor_furniture" },  // large planter
  { slug: "planter_box_01",             category: "outdoor_furniture" },  // rectangular planter
  { slug: "stone_fire_pit",             category: "outdoor_furniture" },  // outdoor fireplace
  { slug: "painted_wooden_bench",       category: "outdoor_furniture" },  // garden bench

  // ── Round 6: 替换「程序化盒子」的丑家具（Poly Haven 有好货的那批）──
  // 绿植（程序化最假，收益最大）→ 接 plant-monstera / -rubber-tree / -sansevieria / -balcony-pot
  { slug: "potted_plant_01",            category: "plant" },
  { slug: "potted_plant_02",            category: "plant" },
  { slug: "potted_plant_04",            category: "plant" },
  // 餐桌 → 接 dining-black-metal；餐椅 → 接 chair-modern-gray / -industrial-black
  { slug: "WoodenTable_03",             category: "dining_table" },
  { slug: "painted_wooden_chair_01",    category: "dining_chair" },
  { slug: "painted_wooden_chair_02",    category: "dining_chair" },
  // 电视柜 → 接 tvunit-float-white / -black-stone（古典控制台风，凑合）
  { slug: "ClassicConsole_01",          category: "tv_unit" },
  // 梳妆台 → 接 dresser-nordic-white
  { slug: "vintage_wooden_drawer_01",   category: "dresser" },
  // 工业落地灯 → 接 lamp-industrial-black
  { slug: "industrial_pipe_lamp",       category: "floor_lamp" },
];

// ── CLI flags ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const resArg = argv.find(a => a.startsWith("--res="));
const RES = resArg ? resArg.split("=")[1] : "1k"; // 1k | 2k | 4k
const FORCE = argv.includes("--force");            // re-download even if present

const API = "https://api.polyhaven.com";
const ROOT = path.resolve(process.cwd(), "public", "models");

// ── Helpers ────────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function downloadTo(url, dest) {
  // Skip if file already exists with non-zero size (resume after interrupted
  // run). Pass --force on CLI to re-download and fix truncated .bin files.
  if (!FORCE) {
    try {
      const stat = await fs.stat(dest);
      if (stat.size > 0) return { size: stat.size, skipped: true };
    } catch { /* missing, proceed */ }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
  const stat = await fs.stat(dest);
  return { size: stat.size, skipped: false };
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ── Main ───────────────────────────────────────────────────────
async function downloadAsset({ slug, category }) {
  const dir = path.join(ROOT, category, slug);
  console.log(`\n📦 ${slug} → ${path.relative(process.cwd(), dir)}`);

  const files = await fetchJSON(`${API}/files/${slug}`);
  const bundle = files?.gltf?.[RES]?.gltf;
  if (!bundle) {
    throw new Error(`No gltf.${RES} bundle for ${slug}. Available: ${Object.keys(files.gltf || {}).join(", ")}`);
  }

  // Main .gltf file — name matches the URL's basename
  const mainName = path.basename(new URL(bundle.url).pathname);
  const mainDest = path.join(dir, mainName);
  const { size: mainSize, skipped: mainSkipped } = await downloadTo(bundle.url, mainDest);
  console.log(`   · ${mainName}  ${humanSize(mainSize)}${mainSkipped ? " [skipped]" : ""}`);

  // Aux files (textures + .bin). Keys are paths relative to the .gltf file.
  let totalSize = mainSize;
  let skippedCount = mainSkipped ? 1 : 0;
  let newCount = mainSkipped ? 0 : 1;
  for (const [rel, info] of Object.entries(bundle.include || {})) {
    const dest = path.join(dir, rel);
    const { size, skipped } = await downloadTo(info.url, dest);
    totalSize += size;
    if (skipped) skippedCount++; else newCount++;
    console.log(`   · ${rel}  ${humanSize(size)}${skipped ? " [skipped]" : ""}`);
  }
  if (skippedCount > 0 && newCount === 0) {
    console.log(`   ✓ all ${skippedCount} files already present`);
  }

  return { slug, category, dir, mainFile: mainName, totalSize };
}

async function main() {
  console.log(`Poly Haven downloader · resolution=${RES} · root=${path.relative(process.cwd(), ROOT)}`);

  await fs.mkdir(ROOT, { recursive: true });

  const results = [];
  for (const asset of ASSETS) {
    try {
      results.push(await downloadAsset(asset));
    } catch (err) {
      console.error(`✗ ${asset.slug}: ${err.message}`);
    }
  }

  console.log(`\n✅ Done. ${results.length}/${ASSETS.length} assets downloaded.`);
  console.log(`\nNext step: wire these into src/lib/furniture.ts by adding to the matching FurnitureItem:\n`);
  for (const r of results) {
    const relPath = `/models/${r.category}/${r.slug}/${r.mainFile}`;
    console.log(`  // ${r.slug}  (${humanSize(r.totalSize)})`);
    console.log(`  model3d: { url: "${relPath}" },`);
  }
  console.log(``);
}

main().catch(err => { console.error(err); process.exit(1); });
