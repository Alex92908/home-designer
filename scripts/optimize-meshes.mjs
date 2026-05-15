#!/usr/bin/env node
// Reduce SUBMESH COUNT in every glTF/GLB under public/models —— Node API 版
// （在工程内 import @gltf-transform/core + functions，避免 npx cold-start，
//  对 423 个文件比 spawn npx 快 ~50×）
//
// 单独于 compress-draco/meshopt/textures 的角色：
//   - draco/meshopt: 压 .bin 字节数（带宽 / 上传量）—— 不减 mesh 数
//   - textures:      压图片字节数 —— 不减 mesh 数
//   - 本脚本:         dedup + join + weld + prune ——
//                   把同材质的 primitive 合并 + 去重 accessor + 合并相邻顶点
//                   + 删未引用资源 —— 直接砍 scene.traverse / projectObject
//                   遍历开销（这是 Three.js 主线程 ~120ms/帧瓶颈的根源）
//
// USAGE:
//   node scripts/optimize-meshes.mjs           # 实跑 + 报告
//   node scripts/optimize-meshes.mjs --dry     # 只 inspect 不改动

import { readdir, stat, rename } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression, EXTMeshoptCompression } from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  weld,
  join as joinPrimitives,
} from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");

const ROOT = new URL("..", import.meta.url).pathname;
const MODELS = join(ROOT, "public/models");

// Register decoders for already-compressed files (compress-draco/meshopt 跑过的)
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

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

async function fileSetSize(filePath) {
  const dir = dirname(filePath);
  let total = 0;
  for await (const p of walk(dir)) {
    try { total += (await stat(p)).size; } catch { /* ignore */ }
  }
  return total;
}

function countPrimitives(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    n += mesh.listPrimitives().length;
  }
  return n;
}

const files = [];
for await (const p of walk(MODELS)) {
  if ([".gltf", ".glb"].includes(extname(p).toLowerCase())) files.push(p);
}
console.log(`→ ${files.length} glTF/GLB files to process` + (DRY ? " (DRY RUN — inspect only)" : "") + "…");

let totalBefore = 0, totalAfter = 0;
let primBefore = 0, primAfter = 0;
let ok = 0, failed = 0;
const failures = [];

for (const file of files) {
  const rel = file.replace(ROOT, "");
  try {
    const sizeBefore = await fileSetSize(file);
    const doc = await io.read(file);
    const primsB = countPrimitives(doc);
    primBefore += primsB;
    totalBefore += sizeBefore;

    if (DRY) {
      console.log(`· ${rel}  ${human(sizeBefore)}  prims=${primsB}`);
      continue;
    }

    // Optimization pipeline — order matters:
    //   1. dedup   去重 accessor / texture / material（让 join 能识别"同 material"）
    //   2. join    合并同 material 的 mesh primitive  ← 减 mesh 数的关键
    //   3. weld    合并相邻顶点（顺手再压一点）
    //   4. prune   删除未引用资源
    await doc.transform(
      dedup(),
      joinPrimitives(),  // <-- the key step for projectObject bottleneck
      weld(),
      prune({ keepLeaves: false, keepAttributes: false }),
    );

    const primsA = countPrimitives(doc);
    primAfter += primsA;

    await io.write(file, doc);
    const sizeAfter = await fileSetSize(file);
    totalAfter += sizeAfter;
    ok++;

    const sizePct = sizeBefore ? Math.round((1 - sizeAfter / sizeBefore) * 100) : 0;
    const primDelta = primsB - primsA;
    console.log(
      `✔ ${rel}  ${human(sizeBefore)} → ${human(sizeAfter)}  ` +
      `(-${sizePct}%)  prims ${primsB} → ${primsA}` +
      (primDelta > 0 ? `  (-${primDelta})` : "")
    );
  } catch (e) {
    failed++;
    failures.push({ file: rel, err: e.message ?? String(e) });
    console.log(`✗ ${rel} — ${e.message ?? String(e)}`);
  }
}

console.log("─".repeat(70));
if (DRY) {
  console.log(`DRY RUN: ${files.length} files, total mesh primitives = ${primBefore}`);
} else {
  console.log(`${ok} ok, ${failed} failed`);
  console.log(`size:  ${human(totalBefore)} → ${human(totalAfter)}  saved ${human(totalBefore - totalAfter)}  (-${totalBefore ? ((totalBefore - totalAfter) / totalBefore * 100).toFixed(1) : 0}%)`);
  console.log(`prims: ${primBefore} → ${primAfter}  reduced ${primBefore - primAfter}  (-${primBefore ? ((primBefore - primAfter) / primBefore * 100).toFixed(1) : 0}%)`);
}
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ${f.file} — ${f.err}`);
  }
}
