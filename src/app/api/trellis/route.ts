/**
 * POST /api/trellis
 *
 * microsoft/TRELLIS on HF Spaces — 5-step Gradio pipeline:
 *   fn 4  start_session    : allocate GPU (required)
 *   fn 8  preprocess_image : bg removal + normalise
 *   fn 11 image_to_3d      : generate 3DGS (2-4 min)
 *   fn 14 extract_glb      : export GLB
 *   fn 5  end_session      : free GPU
 *
 * Key fixes vs naive impl:
 *   1. Image must be uploaded via /upload first (Gradio rejects raw base64)
 *   2. SSE events filtered by event_id (otherwise previous step's
 *      process_completed is mistaken for the current step's result)
 *   3. start_session allocates the GPU slot — without it image_to_3d silently
 *      returns empty.
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";


const SPACE   = "https://microsoft-trellis.hf.space";
const T_ANY   = 7_200_000;   // 2 hours — large scenes can take a very long time

const FN_START_SESSION = 4;
const FN_END_SESSION   = 5;
const FN_PREPROCESS    = 8;
const FN_IMAGE_TO_3D   = 11;
const FN_EXTRACT_GLB   = 14;

// ─── HF auth header (bypasses anonymous ZeroGPU quota) ───────────
function hfHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = process.env.HUGGINGFACE_TOKEN;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ─── Retry helper — HF Spaces cold-start can take 30-60s ─────────
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 4,
  delayMs = 15_000,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isConnectErr = String(err).includes("ConnectTimeout") ||
        String(err).includes("UND_ERR_CONNECT") ||
        String(err).includes("fetch failed");
      if (isConnectErr && i < retries - 1) {
        console.log(`[trellis] ${label} connect error, retrying in ${delayMs / 1000}s… (${i + 1}/${retries - 1})`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: all retries exhausted`);
}

// ─── Upload image to Space, get server-side path ──────────────────
async function uploadImage(imageBase64: string): Promise<string> {
  const b64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf  = Buffer.from(b64, "base64");

  return withRetry(async () => {
    const form = new FormData();
    form.append("files", new Blob([buf], { type: "image/png" }), "input.png");

    const res = await fetch(`${SPACE}/upload`, {
      method: "POST",
      headers: hfHeaders(),
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`/upload failed: ${res.status}`);
    const paths = await res.json() as string[];
    if (!paths[0]) throw new Error("upload returned no path");
    return paths[0];
  }, "upload");
}

// ─── Gradio SSE queue call — filtered by event_id ─────────────────
async function callFn(
  fnIndex: number,
  data: unknown[],
  sessionHash: string,
  timeoutMs: number,
): Promise<unknown[]> {
  // 1. Join queue → get event_id for this specific call
  const joinRes = await fetch(`${SPACE}/queue/join`, {
    method: "POST",
    headers: hfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fn_index: fnIndex, data, session_hash: sessionHash }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!joinRes.ok) {
    const txt = await joinRes.text().catch(() => "");
    throw new Error(`fn${fnIndex} queue/join ${joinRes.status}: ${txt}`);
  }
  const { event_id } = await joinRes.json() as { event_id: string };

  // 2. Stream SSE — only accept process_completed for OUR event_id
  const sseRes = await fetch(`${SPACE}/queue/data?session_hash=${sessionHash}`, {
    headers: hfHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!sseRes.ok) throw new Error(`fn${fnIndex} queue/data ${sseRes.status}`);

  const reader = sseRes.body!.getReader();
  const dec    = new TextDecoder();
  let   buf    = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk.split("\n").find(l => l.startsWith("data:"));
      if (!line) continue;
      let msg: {
        msg?: string;
        event_id?: string;
        output?: { data?: unknown[]; error?: string | null };
        error?: string;
        success?: boolean;
      };
      try { msg = JSON.parse(line.slice(5)); } catch { continue; }

      // Skip events not for our call
      if (msg.event_id && msg.event_id !== event_id) continue;

      if (msg.msg === "process_completed") {
        if (msg.success === false) {
          console.error(`[trellis] fn${fnIndex} process_completed failure:`, JSON.stringify(msg).slice(0, 800));
          const errMsg = msg.output?.error ?? msg.error
            ?? JSON.stringify(msg.output).slice(0, 200)
            ?? "unknown error";
          throw new Error(`fn${fnIndex} failed: ${errMsg}`);
        }
        return msg.output?.data ?? [];
      }
      if (msg.msg === "queue_full") {
        throw new Error("Trellis queue is full — retry in a minute");
      }
    }
  }
  throw new Error(`fn${fnIndex}: SSE stream closed without completion`);
}

// ─── Helpers ──────────────────────────────────────────────────────
async function fetchAsBase64(url: string): Promise<string> {
  const r = await fetch(url, { headers: hfHeaders(), signal: AbortSignal.timeout(T_ANY) });
  if (!r.ok) throw new Error(`fetch GLB ${r.status}`);
  const buf = await r.arrayBuffer();
  return `data:model/gltf-binary;base64,${Buffer.from(buf).toString("base64")}`;
}

async function saveToDisk(b64: string, id: string): Promise<string | null> {
  try {
    const dir = path.join(process.cwd(), "public", "models", "generated");
    await mkdir(dir, { recursive: true });
    const raw = b64.replace(/^data:[^;]+;base64,/, "");
    const fp  = path.join(dir, `${id}_trellis.glb`);
    await writeFile(fp, Buffer.from(raw, "base64"));
    return `/models/generated/${id}_trellis.glb`;
  } catch { return null; }
}

// ─── Quota error detection ────────────────────────────────────────
function isQuotaError(msg: string) {
  return msg.includes("ZeroGPU quota") || msg.includes("GPU quota") || msg.includes("exceeded your");
}

// ─── Route handler ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const sess = Math.random().toString(36).slice(2, 12);
  const id   = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  console.log(`[trellis] id=${id} sess=${sess}`);

  try {
    const { imageBase64 } = await req.json() as { imageBase64: string };
    if (!imageBase64) return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });

    // ── Upload image file ──────────────────────────────────────────
    console.log("[trellis] uploading image...");
    const uploadedPath = await uploadImage(imageBase64);
    const imageInput   = { path: uploadedPath, url: null, orig_name: "input.png", size: null };
    console.log("[trellis] uploaded:", uploadedPath);

    // ── start_session — allocate GPU ───────────────────────────────
    console.log("[trellis] start_session");
    await callFn(FN_START_SESSION, [], sess, T_ANY);
    console.log("[trellis] session ready");

    try {
      // ── preprocess_image ─────────────────────────────────────────
      console.log("[trellis] preprocess_image");
      const prep = await callFn(FN_PREPROCESS, [imageInput], sess, T_ANY);
      const preprocessed = prep[0] ?? imageInput;
      console.log("[trellis] preprocess done");

      // ── image_to_3d (heavy) — full 12 steps, no limit ────────────
      const steps = 12;
      console.log(`[trellis] image_to_3d (steps=${steps}, ~2-4 min)...`);
      await callFn(FN_IMAGE_TO_3D, [
        preprocessed,   // image
        [],             // multiimages
        null,           // internal state (server-managed)
        0,              // seed
        7.5,            // ss_guidance_strength
        steps,          // ss_sampling_steps
        3.0,            // slat_guidance_strength
        steps,          // slat_sampling_steps
        "stochastic",   // multiimage_algo
      ], sess, T_ANY);
      console.log("[trellis] image_to_3d done");

      // ── extract_glb ──────────────────────────────────────────────
      console.log("[trellis] extract_glb");
      const glbOut = await callFn(FN_EXTRACT_GLB, [
        null,   // session state (server fills from session)
        0.95,   // mesh_simplify
        1024,   // texture_size
      ], sess, T_ANY);
      console.log("[trellis] extract_glb raw:", JSON.stringify(glbOut).slice(0, 300));

      // glbOut[1] = download button → { path, url, orig_name }
      const dlFile = (glbOut[1] ?? glbOut[0]) as
        { data?: string; url?: string; path?: string } | null;
      if (!dlFile) throw new Error(`No GLB in output: ${JSON.stringify(glbOut)}`);

      let glbBase64: string;
      if (dlFile.data && dlFile.data.length > 100) {
        glbBase64 = dlFile.data.startsWith("data:") ? dlFile.data
          : `data:model/gltf-binary;base64,${dlFile.data}`;
      } else {
        const url = dlFile.url ?? (dlFile.path ? `${SPACE}/file=${dlFile.path}` : null);
        if (!url) throw new Error(`GLB file missing url/path: ${JSON.stringify(dlFile)}`);
        glbBase64 = await fetchAsBase64(url);
      }

      const glbUrl = await saveToDisk(glbBase64, id);
      console.log(`[trellis] done, saved=${glbUrl}`);
      return NextResponse.json({ glbBase64, glbUrl, id });

    } finally {
      callFn(FN_END_SESSION, [], sess, T_ANY).catch(() => {});
    }

  } catch (err) {
    const msg = String(err);
    console.error("[trellis]", msg);
    if (isQuotaError(msg)) {
      return NextResponse.json(
        { error: msg, quotaExceeded: true, hint: "fastMode=true 可减少 GPU 用量约 75%" },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
