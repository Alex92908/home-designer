/**
 * ktx2-encode.mjs —— 把 GLB 的内嵌纹理转成 KTX2(BasisU/ETC1S),就地覆盖。
 * basisu(brew)编码;按用途选色彩空间(color=sRGB / normal / 其它=linear);
 * 保留 Draco 几何;写入 KHR_texture_basisu。
 *   node scripts/ktx2-encode.mjs <a.glb> [b.glb ...]
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu } from "@gltf-transform/extensions";
import { draco } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import sharp from "sharp";
import { execFileSync } from "child_process";
import { readFileSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node scripts/ktx2-encode.mjs <glb...>"); process.exit(1); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

async function encodeOne(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
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
  const tmp = mkdtempSync(join(tmpdir(), "ktx-"));
  let n = 0, before = 0, after = 0;
  for (const tex of root.listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    if (tex.getMimeType() === "image/ktx2") { n++; continue; }
    before += img.length;
    const role = ROLE.get(tex) ?? "color";
    const png = join(tmp, `${n}.png`), out = join(tmp, `${n}.ktx2`);
    await sharp(Buffer.from(img)).png().toFile(png);
    const flags = ["-ktx2", "-mipmap", "-q", "160"];
    if (role === "normal") flags.push("-normal_map", "-linear");
    else if (role === "linear") flags.push("-linear");
    execFileSync("basisu", [...flags, png, "-output_file", out], { stdio: "pipe" });
    const buf = new Uint8Array(readFileSync(out));
    after += buf.length;
    tex.setImage(buf).setMimeType("image/ktx2");
    n++;
  }
  rmSync(tmp, { recursive: true, force: true });
  await doc.transform(draco());
  await io.write(file, doc);
  console.log(`✓ ${file}  ${n} tex  纹理 ${(before/1024).toFixed(0)}→${(after/1024).toFixed(0)}KB  文件 ${(statSync(file).size/1024).toFixed(0)}KB`);
}

for (const f of files) {
  try { await encodeOne(f); } catch (e) { console.error(`✗ ${f}: ${String(e.message ?? e).slice(0, 160)}`); }
}
