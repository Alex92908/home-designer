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
