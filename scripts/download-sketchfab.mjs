#!/usr/bin/env node
/**
 * Download CC-BY Sketchfab glTF models into public/models/.
 *
 * Setup (one-time):
 *   1. Sign up at https://sketchfab.com/signup (free)
 *   2. Get API token at https://sketchfab.com/settings/password
 *   3. Put it in .env.local:  SKETCHFAB_TOKEN=xxxxxxxxxxxx
 *
 * Usage:
 *   node scripts/download-sketchfab.mjs
 *
 * CC-BY means you MUST credit the author. Each asset downloaded here
 * is already registered in public/models/ATTRIBUTION.md — keep that
 * file up to date and show its CC-BY section in your product's credits
 * page.
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { execSync } from "node:child_process";

// ── Load .env.local if present ─────────────────────────────────
async function loadEnv() {
  try {
    const text = await fs.readFile(path.resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) process.env[m[1]] = process.env[m[1]] || m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* no .env.local, that's fine */ }
}

// ── Assets (uid + category + author for attribution) ───────────
const ASSETS = [
  // ── Beds ─────────────────────────────────────────────
  { uid: "95e58eda71e8438fbf0be4169fefef86", slug: "bed_07",                  category: "bed",             author: "DoaaSheha" },
  { uid: "0d5590d1d2184aa98797c3d6382afd7e", slug: "japanese_futon_bed",      category: "bed",             author: "nicolas_solo" },
  { uid: "d3aeb724e09c44af96ef09cd20885220", slug: "dark_modern_bed",         category: "bed",             author: "renviros" },

  // ── Wardrobes ────────────────────────────────────────
  { uid: "a3c221e5504d40a8ba019f8f1bf5ab0e", slug: "antique_wooden_wardrobe", category: "wardrobe",        author: "kuuttisiitonen" },
  { uid: "a977729fff9d4bfdad487a59495436f5", slug: "wardrobe_dylanheyes",     category: "wardrobe",        author: "dylanheyes" },

  // ── Kitchen: refrigerators ───────────────────────────
  { uid: "ebe62ed6dd9b446a9c9b7d7d6a8086e7", slug: "french_door_fridge",      category: "refrigerator",    author: "Smokahontas" },
  { uid: "5436bb89a0d8400f80abc23992049f53", slug: "modern_fridge_drawer",    category: "refrigerator",    author: "Jimmy_Johansson" },

  // ── Kitchen: cabinets ────────────────────────────────
  { uid: "4b765920f7c34676acda91c0bfd87abd", slug: "modular_kitchen_cabinets", category: "kitchen_cabinet", author: "sauti" },
  { uid: "e77dc1c101c3483a834b2a9dbe2b9754", slug: "cabinet_base_drawers",     category: "kitchen_cabinet", author: "oliver.apin" },
  { uid: "d02a064357e748f88851d609647c278e", slug: "kitchen_cabinet_library",  category: "kitchen_cabinet", author: "ahmagh2e" },

  // ── Kitchen: range hood ──────────────────────────────
  { uid: "e846cb48e88446808af55976ff76b1da", slug: "range_hood",              category: "range_hood",      author: "govindu94" },

  // ── Kitchen: sink ────────────────────────────────────
  { uid: "0fc7c56aa9374b9c8ac548ccc02ff4cb", slug: "double_sink",             category: "kitchen_sink",    author: "Patricklab" },

  // ── Bathroom: toilets ────────────────────────────────
  { uid: "54821ef3bbd7457a9a1fbc1cc4d5f042", slug: "modern_toilet",           category: "toilet",          author: "madexc" },
  { uid: "de07cccdb657428cadc06f6bb96a551d", slug: "curved_modern_wc",        category: "toilet",          author: "attilakozma" },
  { uid: "530889235b64423da5f387588686b33e", slug: "simple_toilet",           category: "toilet",          author: "1_floki_1" },

  // ── Bathroom: bathtubs ───────────────────────────────
  { uid: "4f0df513307e4d8b958345570f6cf5b0", slug: "simple_bathtub",          category: "bathtub",         author: "neverfollow81" },
  { uid: "c00db576ea8b41a882ae2137a2e8da53", slug: "bathtub_3ddomino",        category: "bathtub",         author: "3DDomino" },

  // ── Bathroom: shower ─────────────────────────────────
  { uid: "c48c05b0877a4ebf89ca92615519640c", slug: "corner_shower",           category: "shower",          author: "allenbranch" },

  // ── Bathroom: vanity ─────────────────────────────────
  { uid: "750dfa5fab444c28baf30e063d2b56d3", slug: "legion_vanity_sink",      category: "bathroom_vanity", author: "allenbranch" },
  { uid: "4a6a3be47e1143c38c3cbadcdaac86ea", slug: "laufen_kartell_vanity",   category: "bathroom_vanity", author: "usbathstore" },

  // ── Architectural (room shell replacements, not placeable furniture) ─
  { uid: "7c34cb1c99544017a03119b566718399", slug: "window_modern",           category: "_arch_window",    author: "JeanLescano" },
  // Try #2: SketchUp "exploded open" model didn't work. AleixoAlonso's
  // Residential Window is a purpose-built closed-state residential window.
  { uid: "ae11104237314463a61251fd46ded4b4", slug: "residential_window",      category: "_arch_window",    author: "AleixoAlonso" },

  // ── Pending: need verified CC-BY + glTF-downloadable UIDs ──────
  //
  // HOW TO FIND A WORKING UID:
  //   1. Go to https://sketchfab.com/search?type=models&downloadable=true&license=cc-by
  //   2. Open a model page → check license badge says "CC Attribution" (NOT "CC Attribution-NonCommercial")
  //   3. Click Download → if glTF appears in the list → COPY the 32-char hex from the URL
  //   4. Uncomment the line below and paste uid + author
  //
  // TV units
  // { uid: "REPLACE", slug: "tv_stand",         category: "tv_unit",      author: "Author" },
  //
  // Desks
  { uid: "18abda12d33b4231aa13f92a291c717e", slug: "office_desk",    category: "desk",         author: "ahmagh2e" },
  //
  // Dining chairs (extra)
  // { uid: "REPLACE", slug: "dining_chair_b",   category: "dining_chair", author: "Author" },
  //
  // Accent / lounge chairs
  // { uid: "REPLACE", slug: "accent_chair",     category: "accent_chair", author: "Author" },
  //
  // Floor lamps
  { uid: "083c9408b89949d8b201e8a1bb6ce41c", slug: "pbr_floor_lamp", category: "floor_lamp",   author: "Justin.Foley" },
  //
  // Office chairs
  { uid: "a7fefb5dde954c84896949246dde5be6", slug: "office_chair",   category: "office_chair", author: "artvolodskikh" },
  //
  // Dresser
  // { uid: "REPLACE", slug: "dresser",          category: "dresser",      author: "Author" },
  //
  // Indoor plants
  // { uid: "REPLACE", slug: "potted_plant",     category: "plant",        author: "Author" },
  //
  // Rugs / Carpets
  // { uid: "REPLACE", slug: "rug",              category: "rug",          author: "Author" },

  // ── Small items / 小物件 ────────────────────────────
  { uid: "226e34b1a7b3470cb0ba095af68af90c", slug: "simple_ceiling_fan",      category: "ceiling_fan",     author: "Blender3D" },
  // Swapped: joshtmc's `interior_wooden_door` zip kept downloading corrupted
  // (truncated). Using keam.wf's low-poly game-ready door instead — 3.8k
  // faces, much smaller file.
  { uid: "f5c93a53f5e245c78ce4bbdd6130c4f9", slug: "wooden_door_lowpoly",     category: "_arch_door",      author: "keam.wf" },

  // ── Outdoor / Landscape — hero models for the 院子 ────────
  // Picked CC-BY downloadable models from sketchfab.com that are real
  // foliage geometry (not low-poly box trees). Bigger files than Kenney
  // — but only used as HERO assets (1-3 per scene) so total bundle stays
  // sane. The generic singleton rendering still falls back to Kenney.
  { uid: "df3d3ab0cbd44b02ba08fccbc87bd35d", slug: "olive_tree_apostolos",   category: "outdoor_tree",    author: "Apostolos Vainopoulos" },
  { uid: "6328df8a0f214143a880a72b86db2ab4", slug: "old_olive_tree",         category: "outdoor_tree",    author: "massive-graphisme" },
  { uid: "6198f5dd302644a2bc5e1d31fef46fb0", slug: "palm_tree_lowpoly",      category: "outdoor_tree",    author: "Connor_Appleton" },
  { uid: "92d1b08141ed40eb84e13674fa0cc942", slug: "palm_tree_stylized",     category: "outdoor_tree",    author: "ilyu.ziya" },
  { uid: "2c596282c551468ea6c6a129405e6b68", slug: "cypress_tree_lowpoly",   category: "outdoor_tree",    author: "Alan Zimmerman" },
  { uid: "4b27adcf92f644bdabf8ecc6c5bef399", slug: "maple_sugar_lowpoly",    category: "outdoor_tree",    author: "atrodler" },
  { uid: "b6eb627413ed40fdb8b0a1e1c9038fa9", slug: "japanese_maple",         category: "outdoor_tree",    author: "OliverMatheGames" },
  { uid: "40cf5dc6c7854745a5e9c3615d076d06", slug: "bonsai_lowpoly",         category: "outdoor_tree",    author: "Alice Ursu" },
  { uid: "f0efd57011404e1b9ff14e89f7ecb305", slug: "boxwood_bush",           category: "outdoor_plant",   author: "shortpaca" },
  { uid: "f2006b1a3af9442987963da054283ad7", slug: "hedge_generic",          category: "outdoor_plant",   author: "1-3D.com" },

  // ── Outdoor Furniture — need verified CC-BY + glTF UIDs ──────────
  // All 8 below failed (no gltf download available on those models).
  // Use the HOW TO FIND A WORKING UID guide above to replace them.
  //   "sun lounger outdoor"  → target: rattan/teak with cushion
  //   "outdoor sofa patio"   → target: sectional with cushions
  //   "patio umbrella"       → target: canvas market parasol on pole
  //   "garden table outdoor" → target: stone/metal coffee table
  //   "outdoor dining set"   → target: 4-6 chairs around table
  //   "bio ethanol fireplace"→ target: modern black rectangular unit
  //   "ceramic planter large"→ target: tall ceramic/concrete pot
  //   "pool chaise"          → target: adjustable recline, white frame
  //
  { uid: "c2c86c8f882d46abb01d06ddf9d1d7a8", slug: "sun_lounger",        category: "outdoor_furniture", author: "hotdoghans" },
  { uid: "f4eeef140d184d379bcd5461a4dc9b82", slug: "outdoor_lounge_sofa", category: "outdoor_furniture", author: "smomotempest" },
  { uid: "280a65bca20b425e96617b0dd78cce21", slug: "garden_parasol",      category: "outdoor_furniture", author: "k3v1nc0" },
  { uid: "9490039432e94536b05ac5bd3406ed61", slug: "fire_pit",            category: "outdoor_furniture", author: "meerschaumdigital" },
  // ── 院子结构件（接 yardPlan prefab；下完需把对应 prefab 改成渲染 GLB）──
  { uid: "788d32bf1a5648ddafad8ef1b88538d9", slug: "swimming_pool",       category: "outdoor_structure", author: "ahmagh2e" },
  { uid: "eca838f2af7b4969813747fbc64f207f", slug: "pergola",             category: "outdoor_structure", author: "alex999m" },
  { uid: "c7291c7bf89944dab0af896d0392c012", slug: "garden_gazebo",       category: "outdoor_structure", author: "atayhenna001" },
  { uid: "fb0a385842c94a009ea6fba45c2b80d2", slug: "water_fountain",      category: "outdoor_structure", author: "Harold.Llanos" },
  // ── 室内补齐 ──
  { uid: "57ba9e7b17464b58998e91f05dae9035", slug: "adjustable_desk",     category: "desk",   author: "twopixels" },
  { uid: "c48c05b0877a4ebf89ca92615519640c", slug: "corner_shower_glass", category: "shower", author: "allenbranch" },
  // ── 补齐最后几件（换关键词找到的）──
  { uid: "463f2c77f2694a699413dffd45797d9a", slug: "modular_l_sofa",        category: "sofa",    author: "murattd3v" },
  { uid: "ac64f37d1ece47f99fe5b50fdba1b1cf", slug: "coat_rack",             category: "wardrobe", author: "plaggy" },
  { uid: "57f348196dba448ca26fe80148efbb5b", slug: "luxury_wardrobe_closet", category: "storage", author: "zeroual.elmehdi" },
  { uid: "3c79bf11bc70400a8efcef9dc419d068", slug: "minimalist_closet",     category: "storage", author: "uniboxtrade" },
  { uid: "016c963080b84372aec7fa1241632d5b", slug: "outdoor_grill",        category: "outdoor_structure", author: "shirlanne" },
  { uid: "dcd691724f6b4d29a6d16def24d14e6e", slug: "angelo_freestanding_bath", category: "bathtub",         author: "tissinouk" },
  { uid: "6e20541ed8f543b28d2e71aef79b7b5e", slug: "sink_and_vanity",          category: "bathroom_vanity", author: "timothyahene" },
];

const API = "https://api.sketchfab.com/v3";
const ROOT = path.resolve(process.cwd(), "public", "models");

async function authedJSON(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
  return (await fs.stat(dest)).size;
}

function humanSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(2)} MB`;
}

async function downloadAsset({ uid, slug, category, author }, token) {
  const targetDir = path.join(ROOT, category, slug);
  const canonicalGltf = path.join(targetDir, `${slug}.gltf`);

  // Resume: if the canonical .gltf already exists, skip completely.
  // Handles script restarts after network interruptions.
  try {
    const stat = await fs.stat(canonicalGltf);
    if (stat.size > 0) {
      console.log(`⏭  ${slug} — already present (${humanSize(stat.size)}), skipping.`);
      return { slug, category, author, mainGltf: `${slug}.gltf`, skipped: true };
    }
  } catch { /* doesn't exist — proceed */ }

  console.log(`\n📦 ${slug} by ${author} → public/models/${category}/${slug}`);

  // Request the download URL (CC-BY)
  const dl = await authedJSON(`${API}/models/${uid}/download`, token);
  // Response has url for various formats: { gltf: { url, size, expires }, source, usdz, ... }
  const gltf = dl.gltf;
  if (!gltf?.url) {
    throw new Error(`No gltf download for ${uid}. Available: ${Object.keys(dl).join(", ")}`);
  }

  const zipPath = path.join(ROOT, category, `${slug}.zip`);
  const size = await downloadFile(gltf.url, zipPath);
  console.log(`   · zip ${humanSize(size)} downloaded`);

  // Unzip into target dir (already declared at the top of the function)
  await fs.mkdir(targetDir, { recursive: true });
  execSync(`unzip -o -q "${zipPath}" -d "${targetDir}"`);
  await fs.unlink(zipPath);
  console.log(`   · unzipped to ${path.relative(process.cwd(), targetDir)}`);

  // Find the main .gltf file (at root of extracted zip, not nested) and
  // rename to <slug>.gltf so paths in furniture.ts are predictable.
  const entries = await fs.readdir(targetDir);
  const originalGltf = entries.find(f => f.endsWith(".gltf"));
  if (!originalGltf) {
    console.warn(`   ⚠ no top-level .gltf found. Files: ${entries.slice(0, 6).join(", ")}`);
    return { slug, category, author, mainGltf: null };
  }
  const canonicalName = `${slug}.gltf`;
  if (originalGltf !== canonicalName) {
    await fs.rename(path.join(targetDir, originalGltf), path.join(targetDir, canonicalName));
    console.log(`   · renamed ${originalGltf} → ${canonicalName}`);
  }
  return { slug, category, author, mainGltf: canonicalName };
}

async function main() {
  await loadEnv();
  const token = process.env.SKETCHFAB_TOKEN;
  if (!token) {
    console.error("Missing SKETCHFAB_TOKEN. See script header for setup steps.");
    process.exit(1);
  }

  // 并发下载（同时 N 个，大幅加速；已存在的文件会被跳过，可随时 Ctrl+C 重跑续传）。
  const CONCURRENCY = Number(process.env.DL_CONCURRENCY) || 4;
  const results = [];
  let idx = 0;
  const worker = async () => {
    while (idx < ASSETS.length) {
      const a = ASSETS[idx++];
      try {
        results.push(await downloadAsset(a, token));
      } catch (err) {
        console.error(`✗ ${a.slug}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ASSETS.length) }, worker));

  console.log(`\n✅ Done. ${results.length}/${ASSETS.length} assets downloaded.`);
  console.log(`\nRemember: each of these is CC-BY. Make sure public/models/ATTRIBUTION.md`);
  console.log(`contains the author, and your product shows a credits page.\n`);
  console.log(`Wire into src/lib/furniture.ts:`);
  for (const r of results) {
    if (!r.mainGltf) continue;
    const url = `/models/${r.category}/${r.slug}/${r.mainGltf}`;
    console.log(`  model3d: { url: "${url}" },  // ${r.slug} by ${r.author}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
