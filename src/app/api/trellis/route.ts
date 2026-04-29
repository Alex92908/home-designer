/**
 * POST /api/trellis
 *
 * Calls Microsoft TRELLIS (open-source, HF Spaces) to generate a complete
 * 3D mesh of an entire villa scene from a single photo.
 *
 * TRELLIS is fundamentally different from TripoSR:
 *   • TripoSR: single isolated object → mesh (bad for complex scenes)
 *   • TRELLIS: full scene → structured mesh + PBR texture atlas
 *     Handles buildings, outdoor environments, multiple objects in one shot.
 *
 * HF Space: JeffreyXiang/TRELLIS-image-large
 * Returns: { glbBase64, glbUrl? }
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const TRELLIS_SPACE = "https://jeffreyxiang-trellis-image-large.hf.space";
const TIMEOUT_MS = 120_000; // Trellis takes longer than TripoSR — up to 2 min

// ─── Gradio SSE queue helper ──────────────────────────────────────
async function callGradioQueue(
  baseUrl: string,
  fnIndex: number,
  data: unknown[],
  timeoutMs = TIMEOUT_MS,
): Promise<unknown[]> {
  const sessionHash = Math.random().toString(36).slice(2, 12);

  // 1. Join queue
  const joinRes = await fetch(`${baseUrl}/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, fn_index: fnIndex, session_hash: sessionHash }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!joinRes.ok) throw new Error(`queue/join ${joinRes.status}: ${await joinRes.text()}`);

  // 2. Stream SSE until process_completed
  const evtRes = await fetch(`${baseUrl}/queue/data?session_hash=${sessionHash}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!evtRes.ok) throw new Error(`queue/data ${evtRes.status}`);

  const reader = evtRes.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";

    for (const evt of events) {
      const line = evt.split("\n").find(l => l.startsWith("data:"));
      if (!line) continue;
      let payload: { msg?: string; output?: { data?: unknown[] }; error?: string };
      try { payload = JSON.parse(line.slice(5)); } catch { continue; }

      if (payload.msg === "process_completed") {
        if (payload.error) throw new Error(`Trellis error: ${payload.error}`);
        return payload.output?.data ?? [];
      }
      if (payload.msg === "queue_full") throw new Error("Trellis queue full — retry later");
    }
  }
  throw new Error("SSE stream ended without completion");
}

// ─── Fetch hosted GLB as base64 ──────────────────────────────────
async function toBase64(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`fetch GLB ${r.status}`);
  const buf = await r.arrayBuffer();
  return `data:model/gltf-binary;base64,${Buffer.from(buf).toString("base64")}`;
}

// ─── Save GLB to disk ─────────────────────────────────────────────
async function saveToDisk(b64: string, id: string): Promise<string | null> {
  try {
    const dir = path.join(process.cwd(), "public", "models", "generated");
    await mkdir(dir, { recursive: true });
    const b = b64.replace(/^data:[^;]+;base64,/, "");
    const fp = path.join(dir, `${id}_full.glb`);
    await writeFile(fp, Buffer.from(b, "base64"));
    return `/models/generated/${id}_full.glb`;
  } catch { return null; }
}

// ─── Route handler ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json() as { imageBase64: string };
    if (!imageBase64) return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    console.log(`[trellis] starting, id=${id}`);

    // TRELLIS API — fn_index 0 is the main image-to-3D pipeline.
    // Params: image, seed, ss_guidance, ss_steps, slat_guidance, slat_steps,
    //         mesh_simplify, texture_size
    const data = await callGradioQueue(TRELLIS_SPACE, 0, [
      { name: "input.png", data: imageBase64 },
      0,      // seed (0 = random)
      7.5,    // ss_guidance_strength
      12,     // ss_sampling_steps
      3.0,    // slat_guidance_strength
      12,     // slat_sampling_steps
      0.95,   // mesh_simplify ratio (keep 95% of faces)
      1024,   // texture_size
    ]);

    // Output index 1 = GLB file {name, data|url}
    const glbOut = (data[1] ?? data[0]) as { data?: string; url?: string; name?: string } | null;
    if (!glbOut) throw new Error("No GLB in Trellis output");

    const glbBase64 = glbOut.data
      ? (glbOut.data.startsWith("data:") ? glbOut.data : `data:model/gltf-binary;base64,${glbOut.data}`)
      : await toBase64(glbOut.url!);

    const glbUrl = await saveToDisk(glbBase64, id);
    console.log(`[trellis] done, saved=${glbUrl}`);

    return NextResponse.json({ glbBase64, glbUrl, id });
  } catch (err) {
    console.error("[trellis]", err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
