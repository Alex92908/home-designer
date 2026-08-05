/**
 * mobile-assets.mjs —— 生成「手机专用」资产:贴图边长封顶 512 + KTX2(BasisU)。
 *
 * 为什么要两套:桌面保持 1024 满画质;手机端 1024² 贴图一间屋子几十张就上百 MB,
 * 是外观图「触顶留白膜」和漫游「走多了崩」的同一个根因。512 在手机屏上肉眼无差,
 * 但每张便宜 4 倍,家具可以全部加载。
 *
 * 取图来源:public/models 里的 GLB 现在已是 KTX2(上一个提交写入),没法再用 sharp 读。
 * 故从 **git HEAD~1** 取未压缩的原始 GLB,拿到原始 PNG/JPEG 再缩放重编码 —— 无损路径,
 * 不做「KTX2 解码→再压」的二次劣化。
 *
 *   node scripts/mobile-assets.mjs            # 全量
 *   node scripts/mobile-assets.mjs <a.glb>    # 指定文件(相对仓库根)
 *
 * 输出:public/models-mobile/<与 public/models 相同的相对路径>
 * 运行时:src/lib/drei.ts 在移动端把 /models/ 改写为 /models-mobile/
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu } from "@gltf-transform/extensions";
import { draco, simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import sharp from "sharp";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, relative } from "path";

const MAX = 512;                    // 贴图边长上限
const SRC_ROOT = "public/models";
const OUT_ROOT = "public/models-mobile";
const GIT_REF = process.env.ORIG_REF || "HEAD~1";   // 未压缩原始 GLB 所在的提交

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

/** 优先取 git 里未压缩的原始 GLB;取不到(新增文件)就用工作区当前文件。 */
function readSource(relPath) {
  try {
    return execFileSync("git", ["show", `${GIT_REF}:${relPath}`], { maxBuffer: 1 << 30 });
  } catch {
    return readFileSync(relPath);
  }
}

function listGlbs() {
  const out = execFileSync("find", [SRC_ROOT, "-name", "*.glb"], { encoding: "utf8", maxBuffer: 1 << 28 });
  return out.split("\n").filter(Boolean);
}

async function convert(relPath) {
  const outPath = join(OUT_ROOT, relative(SRC_ROOT, relPath));
  if (existsSync(outPath)) return "skip";           // 断点续跑

  const buf = readSource(relPath);
  const doc = await io.readBinary(new Uint8Array(buf));
  const root = doc.getRoot();

  // 按用途选色彩空间(与 ktx2-encode.mjs 一致)
  const ROLE = new Map();
  const set = (t, r) => { if (t && !ROLE.has(t)) ROLE.set(t, r); };
  for (const m of root.listMaterials()) {
    set(m.getBaseColorTexture(), "color");
    set(m.getEmissiveTexture(), "color");
    set(m.getNormalTexture(), "normal");
    set(m.getMetallicRoughnessTexture(), "linear");
    set(m.getOcclusionTexture(), "linear");
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);

  const tmp = mkdtempSync(join(tmpdir(), "m512-"));
  let n = 0;
  for (const tex of root.listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    if (tex.getMimeType() === "image/ktx2") { n++; continue; }   // 已是 KTX2(取不到原图)则原样保留
    const role = ROLE.get(tex) ?? "color";
    const png = join(tmp, `${n}.png`), out = join(tmp, `${n}.ktx2`);
    // 关键:缩到 MAX 以内(只缩不放),再交给 basisu
    await sharp(Buffer.from(img))
      .resize({ width: MAX, height: MAX, fit: "inside", withoutEnlargement: true })
      .png().toFile(png);
    const flags = ["-ktx2", "-mipmap", "-q", "160"];
    if (role === "normal") flags.push("-normal_map", "-linear");
    else if (role === "linear") flags.push("-linear");
    execFileSync("basisu", [...flags, png, "-output_file", out], { stdio: "pipe" });
    tex.setImage(new Uint8Array(readFileSync(out))).setMimeType("image/ktx2");
    n++;
  }
  rmSync(tmp, { recursive: true, force: true });

  // 网格简化:真机 HUD 实测,贴图降到 512 后**几何反而成了大头** ——
  // 几何 129MB(CPU+GPU 各一份≈258MB)、892 万三角形、2257 draw call。
  // weld 先焊接重复顶点(很多 GLB 顶点没索引化,焊完本身就省一大截),
  // 再 simplify 到 50%,error 容差 0.5% —— 手机屏上看整栋楼/一间屋,肉眼无差。
  try {
    await doc.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.005 }),
    );
  } catch { /* 个别模型(点/线图元等)简化失败就保持原网格 */ }
  await doc.transform(draco());
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(await io.writeBinary(doc)));
  return `${(statSync(outPath).size / 1024).toFixed(0)}KB`;
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : listGlbs();
let ok = 0, skip = 0, fail = 0;
for (const [i, f] of files.entries()) {
  try {
    const r = await convert(f);
    if (r === "skip") skip++; else ok++;
    if ((i + 1) % 25 === 0) console.log(`… ${i + 1}/${files.length}  ok=${ok} skip=${skip} fail=${fail}`);
  } catch (e) {
    fail++;
    console.error(`✗ ${f}: ${String(e.message ?? e).slice(0, 120)}`);
  }
}
console.log(`完成 ${files.length} 个:新建 ${ok} / 跳过 ${skip} / 失败 ${fail}`);
