import { NextRequest, NextResponse } from "next/server";

// 后端地址由查询参数 baseUrl 指定（选中的通用 ComfyUI 后端），缺省退回本地。
function resolveBase(baseUrl: string | null): string {
  return baseUrl && baseUrl.trim() ? baseUrl.replace(/\/$/, "") : "http://localhost:8188";
}

/**
 * GET /api/comfyui/image?filename=xxx&subfolder=&type=output&baseUrl=...
 * Proxies the output image from the selected ComfyUI backend to the client.
 * Avoids CORS issues since the fetch happens server-side.
 */
export async function GET(req: NextRequest) {
  const filename  = req.nextUrl.searchParams.get("filename") ?? "";
  const subfolder = req.nextUrl.searchParams.get("subfolder") ?? "";
  const type      = req.nextUrl.searchParams.get("type") ?? "output";
  const COMFYUI   = resolveBase(req.nextUrl.searchParams.get("baseUrl"));

  if (!filename) {
    return NextResponse.json({ error: "missing_filename" }, { status: 400 });
  }

  try {
    const url = `${COMFYUI}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!res.ok) {
      return NextResponse.json({ error: "image_not_found" }, { status: 404 });
    }

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("Content-Type") ?? "image/png";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "fetch_failed", detail: msg }, { status: 500 });
  }
}
