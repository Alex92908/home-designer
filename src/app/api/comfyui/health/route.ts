import { NextRequest, NextResponse } from "next/server";

// 后端地址由查询参数 baseUrl 指定（选中的通用 ComfyUI 后端），缺省退回本地。
function resolveBase(baseUrl: string | null): string {
  return baseUrl && baseUrl.trim() ? baseUrl.replace(/\/$/, "") : "http://localhost:8188";
}

/**
 * GET /api/comfyui/health?baseUrl=...
 * Checks whether the selected ComfyUI backend is reachable.
 * Returns { available: true } if reachable, { available: false } otherwise.
 */
export async function GET(req: NextRequest) {
  const COMFYUI = resolveBase(req.nextUrl.searchParams.get("baseUrl"));
  try {
    const res = await fetch(`${COMFYUI}/system_stats`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return NextResponse.json({ available: true });
    return NextResponse.json({ available: false });
  } catch {
    return NextResponse.json({ available: false });
  }
}
