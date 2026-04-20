import { NextRequest, NextResponse } from "next/server";

const COMFYUI = "http://localhost:8188";

/**
 * GET /api/comfyui/image?filename=xxx&subfolder=&type=output
 * Proxies the output image from ComfyUI to the client.
 * Avoids CORS issues since ComfyUI runs on localhost.
 */
export async function GET(req: NextRequest) {
  const filename  = req.nextUrl.searchParams.get("filename") ?? "";
  const subfolder = req.nextUrl.searchParams.get("subfolder") ?? "";
  const type      = req.nextUrl.searchParams.get("type") ?? "output";

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
