/**
 * POST /api/image-to-3d
 *
 * Open-source Image → 3D pipeline using TripoSR / Stable-Fast-3D (SF3D).
 * Both are fully open-source (MIT / community licence) and hosted free on
 * Hugging Face Spaces — no API key required.
 *
 * Strategy (tries in order, falls back on timeout / error):
 *   1. SF3D  (stabilityai/stable-fast-3d)  — higher quality, ~10 s
 *   2. TripoSR (stabilityai/TripoSR)        — faster, ~5 s
 *
 * The GLB is returned as a base64 data URL so the frontend can immediately
 * pass it to useGLTF() without writing it to disk first.
 * A /public/models/generated/<id>.glb is also saved for persistence.
 *
 * "Transformer decomposition" pattern:
 *   Each PART of the villa (pool, pergola, pavilion…) is sent as a
 *   *separate* cropped image so each comes back as its own small GLB.
 *   The caller assembles them in R3F — independently draggable & colourable.
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// ─── HF Spaces endpoints ──────────────────────────────────────────
// Both spaces expose a standard Gradio REST API.
// fn_index tells Gradio which function to call (0-indexed tab / interface).
const ENDPOINTS = {
  sf3d: {
    url: "https://stabilityai-stable-fast-3d.hf.space",
    // fn 0: image → mesh.glb
    fnIndex: 0,
    // SF3D inputs: [image_b64, foreground_ratio, output_format]
    buildData: (imageB64: string) => [
      { name: "image.png", data: imageB64 },
      0.85,       // foreground ratio
      "glb",      // output format
    ],
  },
  triposr: {
    url: "https://stabilityai-triposr.hf.space",
    // fn 1 = "Generate" button
    fnIndex: 1,
    // TripoSR inputs: [image_b64, mc_resolution]
    buildData: (imageB64: string) => [
      { name: "image.png", data: imageB64 },
      256,        // mesh resolution (128–512)
    ],
  },
};

const TIMEOUT_MS = 60_000; // 60 s per attempt

// ─── Gradio queue-based call ──────────────────────────────────────
// HF Spaces use Gradio's SSE queue. We:
//   1. POST /queue/join  → get event_id
//   2. GET  /queue/data  → SSE stream, read until "process_completed"
async function callGradioSpace(
  baseUrl: string,
  fnIndex: number,
  data: unknown[],
): Promise<string /* GLB base64 URL */> {
  const sessionHash = Math.random().toString(36).slice(2, 10);

  // 1. Enqueue
  const joinRes = await fetch(`${baseUrl}/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, fn_index: fnIndex, session_hash: sessionHash }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!joinRes.ok) throw new Error(`queue/join failed: ${joinRes.status}`);

  // 2. Poll SSE stream for completion
  const evtRes = await fetch(
    `${baseUrl}/queue/data?session_hash=${sessionHash}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!evtRes.ok) throw new Error(`queue/data failed: ${evtRes.status}`);

  const reader = evtRes.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    // Each SSE event is delimited by \n\n
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";

    for (const evt of events) {
      const dataLine = evt.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) continue;
      let payload: { msg?: string; output?: { data?: unknown[] } };
      try { payload = JSON.parse(dataLine.slice(5)); }
      catch { continue; }

      if (payload.msg === "process_completed") {
        const outData = payload.output?.data;
        if (!Array.isArray(outData) || !outData[0]) {
          throw new Error("No output from model");
        }
        // Output is either { name, data } (base64) or { url } (hosted)
        const first = outData[0] as { data?: string; url?: string; name?: string };
        if (first.data) return first.data;            // already base64
        if (first.url)  return await fetchAsBase64(first.url);
        throw new Error("Unknown output format from model");
      }

      if (payload.msg === "queue_full") throw new Error("Queue full — retry later");
    }
  }
  throw new Error("SSE stream ended without completion");
}

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to fetch GLB: ${res.status}`);
  const buf = await res.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  return `data:model/gltf-binary;base64,${b64}`;
}

// ─── Save to disk for persistence ────────────────────────────────
async function saveGlbToDisk(glbBase64: string, id: string): Promise<string> {
  const dir = path.join(process.cwd(), "public", "models", "generated");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.glb`);
  // Strip data URL prefix
  const b64 = glbBase64.replace(/^data:[^;]+;base64,/, "");
  await writeFile(filePath, Buffer.from(b64, "base64"));
  return `/models/generated/${id}.glb`;
}

// ─── Route handler ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const {
      imageBase64,   // data URL of the cropped part image
      partHint,      // optional: "pool", "pergola", "car", etc. (unused by model but logged)
    } = await req.json() as {
      imageBase64: string;
      partHint?: string;
    };

    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[image-to-3d] starting generation, part="${partHint ?? "unknown"}", id=${id}`);

    // ── Try SF3D first, then TripoSR ────────────────────────────────
    let glbBase64: string | null = null;
    const errors: string[] = [];

    for (const [name, ep] of Object.entries(ENDPOINTS)) {
      try {
        console.log(`[image-to-3d] trying ${name}...`);
        glbBase64 = await callGradioSpace(ep.url, ep.fnIndex, ep.buildData(imageBase64));
        console.log(`[image-to-3d] ${name} succeeded`);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${name}: ${msg}`);
        console.warn(`[image-to-3d] ${name} failed: ${msg}`);
      }
    }

    if (!glbBase64) {
      return NextResponse.json(
        { error: "All 3D generation endpoints failed", details: errors },
        { status: 502 },
      );
    }

    // ── Save to disk (best-effort) ──────────────────────────────────
    let publicPath: string | null = null;
    try {
      publicPath = await saveGlbToDisk(glbBase64, id);
    } catch (e) {
      console.warn("[image-to-3d] disk save failed (will return base64 only):", e);
    }

    return NextResponse.json({
      /** Public URL if saved, otherwise null. Use glbBase64 as fallback. */
      glbUrl:    publicPath,
      /** Full base64 data URL — works immediately in useGLTF without disk access. */
      glbBase64,
      id,
    });
  } catch (err) {
    console.error("[image-to-3d] unexpected error:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    );
  }
}
