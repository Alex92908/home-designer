import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, copyFile, stat, rm, readdir } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * 统一 3D 模型导入入口 → 落成 public/models/imported/ 下的真实文件，
 * 返回可直接用于 useGLTF 的 URL。与内置家具（public/models/<类目>/…）
 * 同一套「URL 即资产」机制：换浏览器/清缓存不丢、可随项目分享提交。
 *
 * 两种输入（二选一）：
 *   - multipart FormData { file }            ：浏览器上传
 *   - JSON { localPath: "/abs/path/x.glb" }  ：本机文件直接放入（不经浏览器，
 *     适合从下载目录/素材库批量拿模型；仅限本地/自托管部署）
 *
 * 压缩（用户可选，默认开）：FormData 带 compress="0" / JSON 带 compress:false
 * 则跳过。开启时落盘后跑 gltf-transform optimize（Draco 网格 + 贴图≤1k WebP，
 * 与 scripts/compress-models.mjs 同参数）。压缩失败或压完更大 → 保留原件，
 * 导入永不因压缩挂掉。Draco 解码器已自托管（public/draco/）。
 *
 * 只读环境（serverless）写文件会 500，客户端 persistGlb() 自动退 IndexedDB。
 */

const MAX_SIZE = 50 * 1024 * 1024;
const IMPORT_DIR = () => path.join(process.cwd(), "public", "models", "imported");

/** GET：列出已导入的模型（院子图「已导入」分区调出用）。 */
export async function GET() {
  try {
    const dir = IMPORT_DIR();
    const files = await readdir(dir).catch(() => [] as string[]);
    const models = await Promise.all(
      files.filter(f => /\.glb$/i.test(f)).map(async f => {
        const st = await stat(path.join(dir, f));
        return {
          url: `/models/imported/${f}`,
          // 去掉导入时附加的时间戳后缀，还原成可读名
          name: f.replace(/\.glb$/i, "").replace(/_\d{13}$/, ""),
          bytes: st.size,
          mtime: st.mtimeMs,
        };
      }),
    );
    models.sort((a, b) => b.mtime - a.mtime);
    return NextResponse.json({ models });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list failed" },
      { status: 500 },
    );
  }
}

/** DELETE：从模型库删除一个已导入文件（只认 imported/ 下的裸文件名）。 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const file = searchParams.get("file") ?? "";
    // 只接受裸文件名，杜绝路径穿越
    if (!/^[^/\\]+\.glb$/i.test(file)) {
      return NextResponse.json({ error: "invalid file" }, { status: 400 });
    }
    await rm(path.join(IMPORT_DIR(), file), { force: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "delete failed" },
      { status: 500 },
    );
  }
}

function sanitizeBase(name: string): string {
  return (name || "model.glb")
    .replace(/\.(glb|gltf)$/i, "")
    .replace(/[^a-zA-Z0-9一-龥._-]/g, "_")
    .slice(0, 60) || "model";
}

/** gltf-transform optimize（与批量压缩脚本同参）。成功且更小 → 替换原文件。 */
async function compressInPlace(filePath: string): Promise<{ before: number; after: number }> {
  const before = (await stat(filePath)).size;
  const tmp = path.join(os.tmpdir(), `glb-opt-${Date.now()}.glb`);
  try {
    await execFileAsync("npx", [
      "--yes", "@gltf-transform/cli", "optimize", filePath, tmp,
      "--compress", "draco",
      "--texture-compress", "webp",
      "--texture-size", "1024",
    ], { timeout: 120_000 });
    const after = (await stat(tmp)).size;
    if (after > 0 && after < before) {
      await copyFile(tmp, filePath);
      await rm(tmp, { force: true });
      return { before, after };
    }
    await rm(tmp, { force: true });
    return { before, after: before };
  } catch {
    await rm(tmp, { force: true }).catch(() => {});
    return { before, after: before }; // 压缩失败保留原件
  }
}

export async function POST(req: NextRequest) {
  try {
    const dir = path.join(process.cwd(), "public", "models", "imported");
    await mkdir(dir, { recursive: true });

    let base: string;
    let destPath: string;
    let compress = true; // 用户可选，默认压缩

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // ── 本地路径放入 ──
      const { localPath, compress: c } = await req.json();
      if (c === false) compress = false;
      if (typeof localPath !== "string" || !/\.(glb|gltf)$/i.test(localPath)) {
        return NextResponse.json({ error: "localPath（.glb/.gltf）is required" }, { status: 400 });
      }
      const st = await stat(localPath).catch(() => null);
      if (!st?.isFile()) {
        return NextResponse.json({ error: `文件不存在：${localPath}` }, { status: 404 });
      }
      if (st.size > MAX_SIZE) {
        return NextResponse.json({ error: "file too large (max 50MB)" }, { status: 413 });
      }
      // 注：.gltf 多文件场景靠 gltf-transform 读入时解析同目录 bin/textures，
      // optimize 输出的是自包含 .glb——所以本地路径连散件 .gltf 也能收。
      base = sanitizeBase(path.basename(localPath));
      destPath = path.join(dir, `${base}_${Date.now()}.glb`);
      if (/\.gltf$/i.test(localPath)) {
        // 散件 gltf 必须打包成自包含 .glb：选压缩走 optimize，不压缩走 copy
        // （copy 只合并 bin/textures 进单文件，不动网格和贴图）。
        await execFileAsync("npx", compress
          ? ["--yes", "@gltf-transform/cli", "optimize", localPath, destPath,
             "--compress", "draco", "--texture-compress", "webp", "--texture-size", "1024"]
          : ["--yes", "@gltf-transform/cli", "copy", localPath, destPath],
        { timeout: 120_000 });
      } else {
        await copyFile(localPath, destPath);
      }
    } else {
      // ── 浏览器上传 ──
      const fd = await req.formData();
      const file = fd.get("file");
      if (fd.get("compress") === "0") compress = false;
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }
      if (file.size > MAX_SIZE) {
        return NextResponse.json({ error: "file too large (max 50MB)" }, { status: 413 });
      }
      base = sanitizeBase(file.name);
      destPath = path.join(dir, `${base}_${Date.now()}.glb`);
      await writeFile(destPath, Buffer.from(await file.arrayBuffer()));
    }

    // 统一压缩（用户勾选才跑；本地 .gltf 已在打包时压过，重复跑只是 no-op）
    const { before, after } = compress
      ? await compressInPlace(destPath)
      : await stat(destPath).then(s => ({ before: s.size, after: s.size }));

    return NextResponse.json({
      url: `/models/imported/${path.basename(destPath)}`,
      bytes: after,
      compressed: after < before,
      savedBytes: before - after,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }
}
