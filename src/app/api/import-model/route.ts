import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

/**
 * 导入 3D 模型 → 落成 public/models/imported/ 下的真实文件，返回可直接
 * 用于 useGLTF 的 URL。与内置家具（public/models/<类目>/…）同一套
 * 「URL 即资产」机制：换浏览器/清缓存不丢、可随项目分享提交。
 *
 * 本地/自托管 node 部署可写文件；只读环境（serverless）会 500，
 * 客户端 persistGlb() 自动退回 IndexedDB，不影响使用。
 */
export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    // 50MB 上限：防误传超大文件把磁盘/请求体撑爆
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "file too large (max 50MB)" }, { status: 413 });
    }
    const base = (file.name || "model.glb")
      .replace(/\.(glb|gltf)$/i, "")
      .replace(/[^a-zA-Z0-9一-龥._-]/g, "_")
      .slice(0, 60) || "model";
    const fname = `${base}_${Date.now()}.glb`;
    const dir = path.join(process.cwd(), "public", "models", "imported");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fname), Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ url: `/models/imported/${fname}` });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }
}
