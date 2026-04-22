#!/usr/bin/env node
/**
 * Download public-domain artwork images from Wikimedia Commons to
 * public/artworks/. Used as textures on the `artwork` furniture category
 * so users see real paintings hanging on the wall instead of plain
 * colored rectangles.
 *
 * All images chosen are:
 *  - Out of copyright (artist died > 100 years ago OR explicitly CC0)
 *  - No attribution required (public domain)
 *  - ~1024px wide (enough for 3D wall display)
 *
 * Usage: node scripts/download-artworks.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

// Use Special:FilePath redirect — bypasses the /thumb/<hash>/ prefix that
// needs to be computed manually. Width param returns a thumbnail.
const wmFile = (filename, width = 1024) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;

const ARTWORKS = [
  // 现代/抽象 — Mondrian (Dutch, 1872-1944, PD)
  {
    slug: "mondrian_composition",
    title: "Composition II with Red, Blue and Yellow",
    artist: "Piet Mondrian (1930)",
    url: wmFile("Piet_Mondriaan,_1930_-_Mondrian_Composition_II_in_Red,_Blue,_and_Yellow.jpg"),
  },
  // 印象派 — Monet Impression Sunrise (1872, PD)
  {
    slug: "monet_impression_sunrise",
    title: "Impression, Sunrise",
    artist: "Claude Monet (1872)",
    url: wmFile("Monet_-_Impression,_Sunrise.jpg"),
  },
  // 风景 — Van Gogh Wheat Field with Cypresses (1889, PD)
  {
    slug: "vangogh_wheatfield_cypresses",
    title: "Wheat Field with Cypresses",
    artist: "Vincent van Gogh (1889)",
    url: wmFile("Vincent_van_Gogh_-_Wheat_Field_with_Cypresses_-_Google_Art_Project.jpg"),
  },
  // 中国山水 — Fan Kuan, Song dynasty (PD, > 1000 years)
  {
    slug: "fankuan_travelers_mountains",
    title: "谿山行旅图",
    artist: "范宽 / Fan Kuan (北宋, c. 1000)",
    url: wmFile("Fan_Kuan_-_Travelers_Among_Mountains_and_Streams_-_Google_Art_Project.jpg", 512),
  },
  // 现代 — Hokusai Great Wave (1831, PD)
  {
    slug: "hokusai_great_wave",
    title: "神奈川冲浪里",
    artist: "葛飾北斎 / Hokusai (1831)",
    url: wmFile("The_Great_Wave_off_Kanagawa.jpg"),
  },
  // 第二批扩充 —— 都是过版权保护期的公版作品
  { slug: "klimt_the_kiss",              title: "吻",              artist: "Gustav Klimt (1907)",      url: wmFile("The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg") },
  { slug: "kandinsky_composition_viii",  title: "Composition VIII", artist: "Wassily Kandinsky (1923)", url: wmFile("Vassily_Kandinsky,_1923_-_Composition_8,_huile_sur_toile,_140_cm_x_201_cm,_Musée_Guggenheim,_New_York.jpg") },
  { slug: "friedrich_wanderer",          title: "雾海之上的漫游者",  artist: "Caspar David Friedrich (1818)", url: wmFile("Caspar_David_Friedrich_-_Wanderer_above_the_Sea_of_Fog.jpg") },
  { slug: "turner_fighting_temeraire",   title: "战舰无畏号的末日",  artist: "J.M.W. Turner (1839)",    url: wmFile("Turner,_J._M._W._-_The_Fighting_Téméraire_tugged_to_her_last_Berth_to_be_broken.jpg") },
  { slug: "seurat_grande_jatte",         title: "大碗岛星期日午后",  artist: "Georges Seurat (1884)",    url: wmFile("A_Sunday_on_La_Grande_Jatte,_Georges_Seurat,_1884.jpg") },
  { slug: "monet_water_lilies",          title: "睡莲",            artist: "Claude Monet (1919)",     url: wmFile("Claude_Monet_-_Water_Lilies_-_1919.jpg") },
  { slug: "vermeer_pearl_earring",       title: "戴珍珠耳环的少女",  artist: "Johannes Vermeer (1665)", url: wmFile("1665_Girl_with_a_Pearl_Earring.jpg") },
  { slug: "leonardo_mona_lisa",          title: "蒙娜丽莎",        artist: "Leonardo da Vinci (1503)", url: wmFile("Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg") },
  { slug: "degas_dance_class",           title: "舞蹈课",          artist: "Edgar Degas (1874)",      url: wmFile("Edgar_Degas_-_The_Ballet_Class_-_Google_Art_Project.jpg") },
  { slug: "hokusai_red_fuji",            title: "赤富士",          artist: "葛飾北斎 / Hokusai (1830)", url: wmFile("Red_Fuji_southern_wind_clear_morning.jpg") },
];

const ROOT = path.resolve(process.cwd(), "public", "artworks");

async function downloadFile(url, dest) {
  try {
    const stat = await fs.stat(dest);
    if (stat.size > 0) return { size: stat.size, skipped: true };
  } catch { /* missing, proceed */ }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  // Node 25 undici has IPv6 handshake quirks with upload.wikimedia.org;
  // curl reliably works. Use it as a subprocess for simplicity.
  // Wikimedia requires a descriptive User-Agent with contact info per
  // https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
  execSync(
    `curl -fsSL -H "User-Agent: home-designer/1.0 (zhuwen160@gmail.com) CC-learning-project" -o "${dest}" "${url}"`,
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  // Small delay to be a good citizen
  await new Promise(r => setTimeout(r, 400));
  const stat = await fs.stat(dest);
  return { size: stat.size, skipped: false };
}

function humanSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(2)} MB`;
}

async function main() {
  await fs.mkdir(ROOT, { recursive: true });
  console.log(`Artwork downloader · root=${path.relative(process.cwd(), ROOT)}\n`);
  let totalSize = 0;
  let okCount = 0;
  for (const art of ARTWORKS) {
    const dest = path.join(ROOT, `${art.slug}.jpg`);
    try {
      const { size, skipped } = await downloadFile(art.url, dest);
      console.log(`${skipped ? "⏭" : "✓"} ${art.slug}.jpg (${humanSize(size)})  ${art.title} — ${art.artist}`);
      totalSize += size;
      okCount++;
    } catch (err) {
      console.error(`✗ ${art.slug}: ${err.message}`);
    }
  }
  console.log(`\n✅ ${okCount}/${ARTWORKS.length} downloaded, total ${humanSize(totalSize)}`);

  // Write a manifest the app can import later
  const manifest = ARTWORKS.map(a => ({
    slug: a.slug,
    title: a.title,
    artist: a.artist,
    url: `/artworks/${a.slug}.jpg`,
    sourceUrl: a.url,
  }));
  await fs.writeFile(path.join(ROOT, "index.json"), JSON.stringify(manifest, null, 2));
  console.log(`Manifest → ${path.relative(process.cwd(), path.join(ROOT, "index.json"))}`);
}

main().catch(err => { console.error(err); process.exit(1); });
