import { NextResponse } from "next/server";

const COMFYUI = "http://localhost:8188";

/**
 * GET /api/comfyui/health
 * Checks whether ComfyUI is running locally.
 * Returns { available: true } if reachable, { available: false } otherwise.
 */
export async function GET() {
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
