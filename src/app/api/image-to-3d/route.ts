/**
 * POST /api/image-to-3d
 *
 * Multi-backend image → GLB pipeline.  Tries in priority order:
 *
 *   1. Tripo3D   (TRIPO_API_KEY)   — best quality, 300 free credits/month
 *                                    https://platform.tripo3d.ai/
 *   2. Fal.ai    (FAL_API_KEY)     — fast, pay-per-use, reliable infra
 *                                    https://fal.ai/  model: fal-ai/triposg
 *   3. Hunyuan3D-2 (HF, free)     — ZeroGPU, ~120 GPU-s/day free
 *   4. SF3D        (HF, free)     — dedicated L4, currently unstable
 *
 * Set API keys in .env.local:
 *   TRIPO_API_KEY=tsk_xxxx
 *   FAL_API_KEY=xxxx:xxxx
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const T_ANY          = 7_200_000;   // 2 hours — no timeout
const HUNYUAN_SPACE  = "https://tencent-hunyuan3d-2.hf.space";
const SF3D_SPACE     = "https://stabilityai-stable-fast-3d.hf.space";
const TRIPO_BASE     = "https://api.tripo3d.ai/v2/openapi";
const FAL_BASE       = "https://queue.fal.run";

// ─── HF auth header ───────────────────────────────────────────────
function hfHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = process.env.HUGGINGFACE_TOKEN;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

// ─── Retry on transient connect errors ───────────────────────────
async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 3, delayMs = 8_000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      const msg = String(err);
      const transient = msg.includes("ConnectTimeout") || msg.includes("UND_ERR_CONNECT") || msg.includes("fetch failed");
      if (transient && i < retries - 1) {
        console.log(`[image-to-3d] ${label} connect error, retry ${i + 1}`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: all retries exhausted`);
}

// ─── Upload image, unique filename to bypass Gradio dedup ────────
async function uploadToHF(space: string, imageBase64: string): Promise<{ path: string; name: string }> {
  const b64  = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf  = Buffer.from(b64, "base64");
  const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
  return withRetry(async () => {
    const form = new FormData();
    form.append("files", new Blob([buf], { type: "image/png" }), name);
    const res = await fetch(`${space}/upload`, {
      method: "POST", headers: hfHeaders(), body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HF upload ${res.status}`);
    const paths = await res.json() as string[];
    if (!paths[0]) throw new Error("HF upload returned no path");
    return { path: paths[0], name };
  }, "HF upload");
}

// ─── Fetch remote file as base64 data URL ────────────────────────
async function fetchAsBase64(url: string, authHeader?: string): Promise<string> {
  const headers: Record<string, string> = authHeader ? { Authorization: authHeader } : {};
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(T_ANY) });
  if (!res.ok) throw new Error(`fetch file ${res.status} from ${url}`);
  const buf = await res.arrayBuffer();
  return `data:model/gltf-binary;base64,${Buffer.from(buf).toString("base64")}`;
}

// ─── Extract GLB from Gradio 6 FileData output ───────────────────
async function glbFromHfOutput(item: unknown, space: string): Promise<string> {
  const fd  = item as { value?: { path?: string; url?: string; data?: string } } | { path?: string; url?: string; data?: string } | null;
  const file = (fd as { value?: { path?: string; url?: string } })?.value
    ?? fd as { path?: string; url?: string; data?: string } | null;
  if (!file) throw new Error("HF FileData is null");
  if ((file as { data?: string }).data?.length ?? 0 > 100) {
    const d = (file as { data: string }).data;
    return d.startsWith("data:") ? d : `data:model/gltf-binary;base64,${d}`;
  }
  const url = (file as { url?: string }).url
    ?? ((file as { path?: string }).path ? `${space}/file=${(file as { path: string }).path}` : null);
  if (!url) throw new Error(`HF FileData missing url/path`);
  return fetchAsBase64(url);
}

// ─── HuggingFace Gradio-6 SSE stream with auto-reconnect ─────────
async function readGradio6Stream(streamUrl: string, label: string, maxReconnects = 4): Promise<unknown[]> {
  for (let attempt = 0; attempt <= maxReconnects; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(3000 * attempt, 10_000);
      console.log(`[${label}] SSE reconnect ${attempt}, wait ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
    let sseRes: Response;
    try {
      sseRes = await fetch(streamUrl, { headers: hfHeaders(), signal: AbortSignal.timeout(T_ANY) });
    } catch (err) {
      if (attempt === maxReconnects) throw new Error(`${label} stream connect failed: ${err}`);
      console.warn(`[${label}] stream connect error (retry):`, err);
      continue;
    }
    if (!sseRes.ok) throw new Error(`${label} stream ${sseRes.status}`);

    const reader = sseRes.body!.getReader();
    const dec    = new TextDecoder();
    let   buf    = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const lines     = chunk.split("\n");
          const eventLine = lines.find(l => l.startsWith("event:"))?.slice(6).trim();
          const dataLine  = lines.find(l => l.startsWith("data:"))?.slice(5).trim();
          if (!dataLine || dataLine === "null") continue;
          if (eventLine === "error") {
            throw new Error(`${label} error: ${dataLine === "null"
              ? "ZeroGPU quota exhausted (resets UTC midnight)" : dataLine}`);
          }
          if (eventLine === "complete") return JSON.parse(dataLine) as unknown[];
        }
      }
    } catch (err) {
      if (String(err).includes("error:")) throw err;  // hard error
      if (attempt === maxReconnects) throw err;
      console.warn(`[${label}] stream error (reconnect):`, err);
      continue;
    }
    if (attempt < maxReconnects) { console.warn(`[${label}] stream closed early, reconnecting`); continue; }
  }
  throw new Error(`${label} SSE failed after ${maxReconnects + 1} attempts`);
}

// ══════════════════════════════════════════════════════════════════
//  1. TRIPO3D  — REST poll API
//  Sign up free at https://platform.tripo3d.ai/ → API Keys
//  Free: 300 credits/month  (~150 models at 2 credits each)
// ══════════════════════════════════════════════════════════════════
async function runTripo3d(imageBase64: string): Promise<string> {
  const key = process.env.TRIPO_API_KEY;
  if (!key) throw new Error("TRIPO_API_KEY not set");

  const auth = `Bearer ${key}`;

  // 1. Upload image
  console.log("[tripo3d] uploading...");
  const b64  = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf  = Buffer.from(b64, "base64");
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "image/png" }), "input.png");

  const upRes = await fetch(`${TRIPO_BASE}/upload`, {
    method: "POST",
    headers: { Authorization: auth },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!upRes.ok) throw new Error(`Tripo upload ${upRes.status}: ${await upRes.text()}`);
  const upJson = await upRes.json() as { code: number; data?: { image_token?: string } };
  if (upJson.code !== 0 || !upJson.data?.image_token) throw new Error(`Tripo upload failed: ${JSON.stringify(upJson)}`);
  const fileToken = upJson.data.image_token;
  console.log("[tripo3d] uploaded, file_token:", fileToken.slice(0, 12) + "…");

  // 2. Create image_to_model task
  const taskRes = await fetch(`${TRIPO_BASE}/task`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "image_to_model",
      file: { type: "png", file_token: fileToken },
      model_version: "v2.5-20250123",  // solid default; v3.0 costs more credits
      texture: true,   // bake albedo texture
      pbr:     true,   // generate roughness + metalness + normal maps → full PBR GLB
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const taskJson = await taskRes.json() as { code: number; data?: { task_id?: string } };
  if (taskJson.code !== 0 || !taskJson.data?.task_id) throw new Error(`Tripo task create failed: ${JSON.stringify(taskJson)}`);
  const taskId = taskJson.data.task_id;
  console.log("[tripo3d] task_id:", taskId);

  // 3. Poll until done (typically 20-60s)
  const deadline = Date.now() + T_ANY;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4_000));
    const poll = await fetch(`${TRIPO_BASE}/task/${taskId}`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    });
    const pd = await poll.json() as {
      code: number;
      data?: { status?: string; output?: { model?: string; rendered_image?: string } };
    };
    const status = pd.data?.status ?? "unknown";
    console.log("[tripo3d] status:", status);
    if (status === "success") {
      const modelUrl = pd.data?.output?.model;
      if (!modelUrl) throw new Error("Tripo: no model URL in output");
      console.log("[tripo3d] done, downloading GLB...");
      return fetchAsBase64(modelUrl, auth);
    }
    if (status === "failed" || status === "cancelled") throw new Error(`Tripo task ${status}`);
  }
  throw new Error("Tripo: timeout");
}

// ══════════════════════════════════════════════════════════════════
//  2. FAL.AI  — queue submit/poll (TripoSG model)
//  Sign up at https://fal.ai/  → API Keys
//  Pay-per-use, ~$0.05-0.15 per model
// ══════════════════════════════════════════════════════════════════
async function runFal(imageBase64: string): Promise<string> {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY not set");

  const MODEL = "fal-ai/triposg";
  const auth  = `Key ${key}`;

  // Submit job (accepts base64 data URL directly)
  console.log("[fal] submitting triposg...");
  const submitRes = await fetch(`${FAL_BASE}/${MODEL}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageBase64 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!submitRes.ok) throw new Error(`Fal submit ${submitRes.status}: ${await submitRes.text()}`);
  const submitJson = await submitRes.json() as {
    request_id: string;
    status_url?: string;
    response_url?: string;
  };
  const { request_id, status_url, response_url } = submitJson;
  console.log("[fal] request_id:", request_id);

  // Poll status
  const statusEndpoint = status_url ?? `${FAL_BASE}/${MODEL}/requests/${request_id}/status`;
  const resultEndpoint = response_url ?? `${FAL_BASE}/${MODEL}/requests/${request_id}`;
  const deadline = Date.now() + T_ANY;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4_000));
    const statusRes = await fetch(statusEndpoint, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    });
    const sd = await statusRes.json() as { status?: string; queue_position?: number };
    console.log("[fal] status:", sd.status, sd.queue_position != null ? `queue=${sd.queue_position}` : "");

    if (sd.status === "COMPLETED") {
      const resultRes = await fetch(resultEndpoint, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(10_000),
      });
      const rd = await resultRes.json() as {
        model_mesh?: { url?: string };
        model_urls?: { glb?: { url?: string } };
      };
      const glbUrl = rd.model_mesh?.url ?? rd.model_urls?.glb?.url;
      if (!glbUrl) throw new Error(`Fal: no GLB URL in result: ${JSON.stringify(rd).slice(0, 200)}`);
      console.log("[fal] done, downloading GLB...");
      return fetchAsBase64(glbUrl, auth);
    }
    if (sd.status === "FAILED") throw new Error("Fal task failed");
  }
  throw new Error("Fal: timeout");
}

// ══════════════════════════════════════════════════════════════════
//  3. HUNYUAN3D-2 (HuggingFace) — free, ZeroGPU ~20/day
// ══════════════════════════════════════════════════════════════════
async function runHunyuan3d(imageBase64: string): Promise<string> {
  console.log("[hunyuan3d] uploading...");
  const { path: up, name } = await uploadToHF(HUNYUAN_SPACE, imageBase64);
  const img = { path: up, url: `${HUNYUAN_SPACE}/file=${up}`, orig_name: name, mime_type: "image/png" };
  console.log("[hunyuan3d] uploaded:", up);

  const startRes = await withRetry(() => fetch(`${HUNYUAN_SPACE}/call/shape_generation`, {
    method: "POST",
    headers: hfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ data: [null, img, null, null, null, null, 25, 5.0, 42, 256, true, 8000, false] }),
    signal: AbortSignal.timeout(15_000),
  }), "hunyuan3d start");

  if (!startRes.ok) throw new Error(`hunyuan3d start ${startRes.status}`);
  const { event_id } = await startRes.json() as { event_id: string };
  console.log("[hunyuan3d] event_id:", event_id);

  const outputs = await readGradio6Stream(`${HUNYUAN_SPACE}/call/shape_generation/${event_id}`, "hunyuan3d");
  console.log("[hunyuan3d] complete");
  return glbFromHfOutput(outputs[0], HUNYUAN_SPACE);
}

// ══════════════════════════════════════════════════════════════════
//  4. SF3D (HuggingFace) — free, dedicated L4, currently unstable
// ══════════════════════════════════════════════════════════════════
async function runSf3d(imageBase64: string): Promise<string> {
  console.log("[sf3d] uploading...");
  const { path: up, name } = await uploadToHF(SF3D_SPACE, imageBase64);
  const img = { path: up, url: `${SF3D_SPACE}/file=${up}`, orig_name: name, mime_type: "image/png" };

  const startRes = await withRetry(() => fetch(`${SF3D_SPACE}/call/run_button`, {
    method: "POST",
    headers: hfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ data: [img, 0.85, null, -1, 1024] }),
    signal: AbortSignal.timeout(15_000),
  }), "sf3d start");

  if (!startRes.ok) throw new Error(`sf3d start ${startRes.status}`);
  const { event_id } = await startRes.json() as { event_id: string };
  console.log("[sf3d] event_id:", event_id);

  const outputs = await readGradio6Stream(`${SF3D_SPACE}/call/run_button/${event_id}`, "sf3d");
  return glbFromHfOutput(outputs[1] ?? outputs[0], SF3D_SPACE);
}

// ─── Save to disk ─────────────────────────────────────────────────
async function saveToDisk(b64: string, id: string, suffix: string): Promise<string | null> {
  try {
    const dir = path.join(process.cwd(), "public", "models", "generated");
    await mkdir(dir, { recursive: true });
    const fp = path.join(dir, `${id}_${suffix}.glb`);
    await writeFile(fp, Buffer.from(b64.replace(/^data:[^;]+;base64,/, ""), "base64"));
    return `/models/generated/${id}_${suffix}.glb`;
  } catch { return null; }
}

// ─── Route handler ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { imageBase64, partHint } = await req.json() as { imageBase64: string; partHint?: string };
    if (!imageBase64) return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[image-to-3d] id=${id}, part="${partHint ?? "unknown"}"`);

    const backends: Array<{ name: string; fn: () => Promise<string>; suffix: string }> = [
      { name: "tripo3d",   fn: () => runTripo3d(imageBase64),   suffix: "tripo3d"   },
      { name: "fal",       fn: () => runFal(imageBase64),        suffix: "fal"       },
      { name: "hunyuan3d", fn: () => runHunyuan3d(imageBase64),  suffix: "hunyuan3d" },
      { name: "sf3d",      fn: () => runSf3d(imageBase64),       suffix: "sf3d"      },
    ];

    const errors: string[] = [];

    for (const { name, fn, suffix } of backends) {
      // Skip paid services if their API key isn't configured
      if (name === "tripo3d" && !process.env.TRIPO_API_KEY) continue;
      if (name === "fal"     && !process.env.FAL_API_KEY)   continue;

      try {
        const glbBase64 = await fn();
        console.log(`[image-to-3d] ${name} succeeded`);
        const glbUrl = await saveToDisk(glbBase64, id, suffix);
        return NextResponse.json({ glbBase64, glbUrl, id, backend: name });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${name}: ${msg}`);
        console.warn(`[image-to-3d] ${name} failed:`, msg);
      }
    }

    return NextResponse.json({ error: "All 3D backends failed", details: errors }, { status: 502 });
  } catch (err) {
    console.error("[image-to-3d] unexpected:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
