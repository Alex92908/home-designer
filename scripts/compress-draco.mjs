#!/usr/bin/env node
// Run gltf-transform Draco compression on every glTF/GLB under
// public/models. Parameters chosen to be visually lossless at typical
// screen sizes (walls / floors / furniture rendered at 1-3m from camera):
//   position  14 bits — 16384 positions per axis
//   normal    10 bits — 1024 directions, imperceptible for non-mirror surfaces
//   texcoord  12 bits — 4096 UV positions per axis (enough for 1K tex)
//
// Typical savings: .bin geometry 60-85% smaller. Re-running on an
// already-compressed file is a near no-op.

import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MODELS = join(ROOT, "public/models");

async function* walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function human(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

function runDraco(file) {
  return new Promise((resolve) => {
    const p = spawn(
      "npx",
      [
        "gltf-transform", "draco", file, file,
        "--quantize-position", "14",
        "--quantize-normal", "10",
        "--quantize-texcoord", "12",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => out += d.toString());
    p.on("close", code => resolve({ code, log: out }));
  });
}

/** Measure the dir holding file (glTF often has companion .bin + textures) */
async function dirSize(filePath) {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  let total = 0;
  for await (const p of walk(dir)) {
    try { total += (await stat(p)).size; } catch { /* ignore */ }
  }
  return total;
}

let totalBefore = 0, totalAfter = 0, ok = 0, failed = 0;
const failures = [];

const files = [];
for await (const p of walk(MODELS)) {
  if ([".gltf", ".glb"].includes(extname(p).toLowerCase())) files.push(p);
}
console.log(`→ ${files.length} glTF/GLB files to process…`);

for (const file of files) {
  const rel = file.replace(ROOT, "");
  const before = await dirSize(file);
  const { code, log } = await runDraco(file);
  if (code !== 0) {
    failed++;
    failures.push({ file: rel, log });
    console.log(`✗ ${rel} — FAILED`);
    continue;
  }
  const after = await dirSize(file);
  const saved = before - after;
  const pct = before ? ((saved / before) * 100).toFixed(0) : "0";
  totalBefore += before;
  totalAfter += after;
  ok++;
  console.log(`✔ ${rel}  ${human(before)} → ${human(after)}  (-${pct}%)`);
}

console.log("─".repeat(70));
console.log(`${ok} ok, ${failed} failed`);
console.log(`total models dir: ${human(totalBefore)} → ${human(totalAfter)}  saved ${human(totalBefore - totalAfter)} (-${totalBefore ? ((totalBefore - totalAfter) / totalBefore * 100).toFixed(1) : 0}%)`);
if (failures.length) {
  console.log("\nFailures (last line each):");
  for (const f of failures) {
    const last = f.log.trim().split("\n").slice(-2).join(" | ");
    console.log(`  ${f.file} — ${last}`);
  }
}
