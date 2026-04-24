#!/usr/bin/env node
// Apply Meshopt (EXT_meshopt_compression) to every glTF/GLB under
// public/models. Works on already-Draco-compressed files: gltf-transform
// decodes Draco first, then re-applies Meshopt.
//
// Why Meshopt over Draco:
//   - Decode 3-5× faster on the CPU (matters on low-end mobile)
//   - Decoder bundle ~50KB (vs Draco's 280KB WASM)
//   - Geometry size comparable or slightly smaller
//
// drei's useGLTF auto-registers MeshoptDecoder when useMeshopt=true
// (default), so no client code changes needed.

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
function run(file) {
  return new Promise((resolve) => {
    const p = spawn("npx", ["gltf-transform", "meshopt", file, file], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => out += d.toString());
    p.on("close", code => resolve({ code, log: out }));
  });
}
async function dirSize(filePath) {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  let total = 0;
  for await (const p of walk(dir)) {
    try { total += (await stat(p)).size; } catch { /* ignore */ }
  }
  return total;
}

const files = [];
for await (const p of walk(MODELS)) {
  if ([".gltf", ".glb"].includes(extname(p).toLowerCase())) files.push(p);
}
console.log(`→ ${files.length} glTF/GLB files to process…`);

let totalBefore = 0, totalAfter = 0, ok = 0, failed = 0;
const failures = [];

for (const file of files) {
  const rel = file.replace(ROOT, "");
  const before = await dirSize(file);
  const { code, log } = await run(file);
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
console.log(`total: ${human(totalBefore)} → ${human(totalAfter)}  saved ${human(totalBefore - totalAfter)}  (-${totalBefore ? ((totalBefore - totalAfter) / totalBefore * 100).toFixed(1) : 0}%)`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) {
    const last = f.log.trim().split("\n").slice(-2).join(" | ");
    console.log(`  ${f.file} — ${last}`);
  }
}
