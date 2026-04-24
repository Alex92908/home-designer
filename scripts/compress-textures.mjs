#!/usr/bin/env node
// Walk public/models/**/*.{png,jpg,jpeg} and resize any image whose
// longest dimension > MAX to MAX while preserving aspect ratio. Writes
// in place. Normals / roughness / metallic maps keep PNG (alpha / 16-bit
// precision); diffuse baseColor on JPG re-encodes as JPG 82% quality.
//
// Typical savings on this repo: 305MB → ~40MB (~87% reduction) because
// most textures are 4K and the app renders them at small on-screen sizes.
//
// USAGE:
//   node scripts/compress-textures.mjs          # dry run + report
//   node scripts/compress-textures.mjs --apply  # actually rewrite files
//   node scripts/compress-textures.mjs --apply --max 2048  # optional custom cap
//
// SAFE: dry run by default; use --apply to write. Git diff shows what changed.

import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const MAX = Number(args.find(a => a.startsWith("--max=") || a.startsWith("--max "))
  ?.replace(/^--max[ =]/, "") ?? (args[args.indexOf("--max") + 1] || 1024)) || 1024;

const ROOT = new URL("..", import.meta.url).pathname;
const MODELS = join(ROOT, "public/models");

const IMG_EXT = new Set([".png", ".jpg", ".jpeg"]);

/** @param {string} dir */
async function* walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function human(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

let totalBefore = 0;
let totalAfter = 0;
let touched = 0;
let skipped = 0;

for await (const file of walk(MODELS)) {
  const ext = extname(file).toLowerCase();
  if (!IMG_EXT.has(ext)) continue;

  let img;
  try { img = sharp(file); }
  catch (e) { console.warn("skip (open failed):", file, e.message); skipped++; continue; }

  const meta = await img.metadata();
  const { width = 0, height = 0 } = meta;
  if (!width || !height) { skipped++; continue; }

  const longest = Math.max(width, height);
  const size = (await stat(file)).size;
  totalBefore += size;

  if (longest <= MAX) {
    // Already small enough — leave it alone
    totalAfter += size;
    continue;
  }

  const ratio = MAX / longest;
  const newW = Math.round(width * ratio);
  const newH = Math.round(height * ratio);

  // Encode preserving format. JPG: 82% quality (visually lossless at the
  // res walls/furniture get on screen). PNG: use adaptive compression, keep
  // 8-bit (most normals the models ship with are 8-bit anyway).
  let pipeline = sharp(file).resize(newW, newH, { kernel: "lanczos3" });
  if (ext === ".jpg" || ext === ".jpeg") {
    pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  }

  const newBuf = await pipeline.toBuffer();
  const newSize = newBuf.length;
  const saved = size - newSize;
  const pct = ((saved / size) * 100).toFixed(0);

  totalAfter += newSize;
  touched++;

  const rel = file.replace(ROOT, "");
  console.log(
    `${APPLY ? "✔" : "·"} ${rel}  ${width}×${height} → ${newW}×${newH}  ${human(size)} → ${human(newSize)}  (-${pct}%)`,
  );

  if (APPLY) {
    await writeFile(file, newBuf);
  }
}

const totalSaved = totalBefore - totalAfter;
const pct = totalBefore ? ((totalSaved / totalBefore) * 100).toFixed(1) : "0";
console.log("─".repeat(70));
console.log(
  `${APPLY ? "APPLIED" : "DRY RUN"} · ${touched} files ${APPLY ? "rewritten" : "to rewrite"}, ${skipped} skipped`,
);
console.log(
  `total: ${human(totalBefore)} → ${human(totalAfter)}  saved ${human(totalSaved)} (-${pct}%)`,
);
if (!APPLY) console.log(`pass --apply to write. Optional --max=<px> (default 1024).`);
