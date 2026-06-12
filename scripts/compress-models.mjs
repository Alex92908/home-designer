#!/usr/bin/env node
/**
 * 模型批量压缩 — gltf-transform optimize（Draco 网格压缩 + 贴图缩到 1k WebP）。
 *
 * 用法：
 *   node scripts/compress-models.mjs --dry          # 只列出将处理的文件与体积
 *   node scripts/compress-models.mjs                # 全量压缩（原地替换为 .glb）
 *   node scripts/compress-models.mjs <子目录>       # 只压某个类目，如 outdoor_tree
 *
 * 设计要点：
 * - .gltf（多文件）→ 压成单文件 .glb 放在同目录、同主名；原 .gltf/.bin/textures
 *   会保留（代码引用谁就加载谁），需要人工确认后把 furniture.ts/outdoorAssets.ts
 *   的 url 从 .gltf 改 .glb 再删旧文件 —— 脚本打印出每条需要改的引用。
 * - 已是 .glb 的原地覆盖（先写 .tmp 成功后替换，失败不动原件）。
 * - Draco 解码器 public/draco/ 已自托管，运行时无需额外配置。
 * - 跳过 public/models/imported/（用户自己导入的，不动）。
 */
import { execFileSync } from "child_process";
import { readdirSync, statSync, renameSync, rmSync, existsSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "public", "models");
const dry = process.argv.includes("--dry");
const only = process.argv.find(a => !a.startsWith("-") && !a.includes("/") && a !== process.argv[0] && a !== process.argv[1]);

const MB = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;

// 收集待处理模型：每个 .gltf / .glb 入口文件
const targets = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (path.relative(MODELS, fp) === "imported") continue; // 用户导入不动
      walk(fp);
    } else if (/\.(gltf|glb)$/i.test(e.name)) {
      targets.push(fp);
    }
  }
}
walk(only ? path.join(MODELS, only) : MODELS);

let before = 0, after = 0, failed = 0;
const refsToUpdate = [];

for (const src of targets) {
  // 入口 + 其引用的 bin/textures 的总体积（同目录粗算）
  const dir = path.dirname(src);
  const isGltf = src.toLowerCase().endsWith(".gltf");
  const sizeOfDir = () => readdirSync(dir).reduce((s, f) => {
    const st = statSync(path.join(dir, f));
    return s + (st.isFile() ? st.size : 0);
  }, 0);
  const srcSize = isGltf ? sizeOfDir() : statSync(src).size;
  before += srcSize;

  const out = isGltf ? src.replace(/\.gltf$/i, ".glb") : src + ".tmp.glb";
  if (dry) {
    console.log(`${MB(srcSize).padStart(8)}  ${path.relative(ROOT, src)}`);
    continue;
  }
  try {
    execFileSync("npx", [
      "--yes", "@gltf-transform/cli", "optimize", src, out,
      "--compress", "draco",
      "--texture-compress", "webp",
      "--texture-size", "1024",
    ], { stdio: "pipe" });
    if (isGltf) {
      after += statSync(out).size;
      refsToUpdate.push({
        from: "/" + path.relative(path.join(ROOT, "public"), src).split(path.sep).join("/"),
        to:   "/" + path.relative(path.join(ROOT, "public"), out).split(path.sep).join("/"),
      });
      console.log(`✓ ${path.relative(ROOT, src)}  ${MB(srcSize)} → ${MB(statSync(out).size)}（旧文件保留，待改引用后删）`);
    } else {
      const newSize = statSync(out).size;
      // 压缩后反而更大（已压过/极小文件）就放弃
      if (newSize < srcSize) {
        renameSync(out, src);
        after += newSize;
        console.log(`✓ ${path.relative(ROOT, src)}  ${MB(srcSize)} → ${MB(newSize)}`);
      } else {
        rmSync(out);
        after += srcSize;
        console.log(`- ${path.relative(ROOT, src)}  已最优（${MB(srcSize)}）`);
      }
    }
  } catch (e) {
    failed++;
    after += srcSize;
    if (existsSync(out) && out !== src) rmSync(out, { force: true });
    console.error(`✗ ${path.relative(ROOT, src)}  压缩失败：${String(e.message ?? e).slice(0, 120)}`);
  }
}

console.log(`\n合计：${MB(before)} → ${dry ? "(dry run)" : MB(after)}  失败 ${failed}`);
if (refsToUpdate.length) {
  console.log(`\n⚠ 以下 ${refsToUpdate.length} 个 .gltf 已生成同名 .glb，请把代码引用改过去后删除旧 .gltf/.bin/textures：`);
  for (const r of refsToUpdate) console.log(`  ${r.from}  →  ${r.to}`);
}
