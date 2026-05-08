/**
 * POST /api/pbr-texture
 *
 * Four-tier PBR strategy (try in order, skip if key absent):
 *
 * ┌─ Tier 1: Meshy AI       (MESHY_API_KEY)  ── TRUE retexture, keeps geometry
 * ├─ Tier 2: TripoAI        (TRIPO_API_KEY)  ── new mesh + full PBR from image
 * ├─ Tier 3: Fal.ai         (FAL_API_KEY)   ── new mesh + texture from image
 * └─ Tier 4: Hunyuan3D-2    (HF free)       ── FREE, no key needed, ZeroGPU quota
 *            generates shape+texture in one pass from the reference image
 *
 * Body:    { glbBase64: string, imageBase64: string, prompt?: string }
 * Returns: { glbBase64: string, backend: string, note?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import https from "node:https";
import path from "path";

const MESHY_BASE    = "https://api.meshy.ai";
const TRIPO_BASE    = "https://api.tripo3d.ai/v2/openapi";
const FAL_BASE      = "https://queue.fal.run";
const HUNYUAN_SPACE = "https://tencent-hunyuan3d-2.hf.space";
const T_ANY      = 7_200_000;

// ─── native HTTPS helper (bypasses undici for multipart) ─────────
function httpsRequest(
  hostname: string, reqPath: string, method: string,
  headers: Record<string, string>, body: Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy(new Error("https timeout 60s"));
    }, 60_000);

    const req = https.request(
      { hostname, port: 443, path: reqPath, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, body: data });
        });
        res.on("error", (e) => { clearTimeout(timer); reject(e); });
      },
    );
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// ─── TripoAI multipart upload via node:https ─────────────────────
// undici (Next.js built-in fetch) has a bug where Blob-based FormData
// corrupts the multipart boundary in certain Node versions.
// Using node:https directly matches curl behavior exactly.
async function tripoUpload(imageBuf: Buffer, filename: string, auth: string): Promise<string> {
  const boundary = `----TripoFormBoundary${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: image/png\r\n\r\n`,
    ),
    imageBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const resp = await httpsRequest(
    "api.tripo3d.ai",
    "/v2/openapi/upload",
    "POST",
    {
      Authorization:  auth,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length.toString(),
    },
    body,
  );

  const json = JSON.parse(resp.body) as {
    code: number;
    message?: string;
    data?: { image_token?: string };
  };
  if (json.code === 2010) throw new Error("tripo_no_credits");
  if (json.code !== 0)    throw new Error(`Tripo upload code ${json.code}: ${json.message ?? resp.body}`);
  if (!json.data?.image_token) throw new Error(`Tripo upload: no token in response`);
  return json.data.image_token;
}

// ─── TripoAI: poll task ───────────────────────────────────────────
async function tripoTask(taskId: string, auth: string): Promise<string> {
  const deadline = Date.now() + T_ANY;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4_000));
    const resp = await httpsRequest(
      "api.tripo3d.ai",
      `/v2/openapi/task/${taskId}`,
      "GET",
      { Authorization: auth },
      Buffer.alloc(0),
    );
    const pd = JSON.parse(resp.body) as {
      code: number;
      data?: { status?: string; output?: { model?: string; pbr_model?: string } };
    };
    const status = pd.data?.status ?? "unknown";
    console.log("[pbr-texture/tripo] status:", status);
    if (status === "success") {
      const url = pd.data?.output?.pbr_model ?? pd.data?.output?.model;
      if (!url) throw new Error("Tripo: no model URL in output");
      return url;
    }
    if (status === "failed" || status === "cancelled")
      throw new Error(`Tripo task ${status}`);
  }
  throw new Error("Tripo: timeout");
}

// ─── Shared helpers ───────────────────────────────────────────────
async function fetchAsBase64(url: string, authHeader?: string): Promise<string> {
  const res = await fetch(url, {
    headers: authHeader ? { Authorization: authHeader } : {},
    signal: AbortSignal.timeout(T_ANY),
  });
  if (!res.ok) throw new Error(`download ${res.status} from ${url}`);
  const buf = await res.arrayBuffer();
  return `data:model/gltf-binary;base64,${Buffer.from(buf).toString("base64")}`;
}

async function saveGlbPublic(glbBuf: Buffer, baseUrl: string): Promise<{ url: string; filePath: string }> {
  const tmpDir  = path.join(process.cwd(), "public", "models", "temp");
  await mkdir(tmpDir, { recursive: true });
  const filename = `pbr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.glb`;
  const filePath = path.join(tmpDir, filename);
  await writeFile(filePath, glbBuf);
  return { url: `${baseUrl}/models/temp/${filename}`, filePath };
}

// ══════════════════════════════════════════════════════════════════
//  Tier 1: Meshy AI — true mesh retexturing
// ══════════════════════════════════════════════════════════════════
async function runMeshyTexture(
  glbBuf: Buffer, prompt: string, baseUrl: string,
): Promise<string> {
  const key  = process.env.MESHY_API_KEY!;
  const auth = `Bearer ${key}`;

  console.log("[pbr-texture/meshy] saving GLB to public dir…");
  const { url: modelUrl, filePath } = await saveGlbPublic(glbBuf, baseUrl);
  console.log("[pbr-texture/meshy] model URL:", modelUrl);

  try {
    const createRes = await fetch(`${MESHY_BASE}/v2/text-to-texture`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_url:       modelUrl,
        object_prompt:   prompt || "villa building, realistic architectural materials, stone walls, glass windows",
        art_style:       "realistic",
        negative_prompt: "low quality, blurry, cartoon",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!createRes.ok) throw new Error(`Meshy create ${createRes.status}: ${await createRes.text()}`);
    const created = await createRes.json() as { result?: string };
    const taskId  = created.result;
    if (!taskId) throw new Error(`Meshy: no task_id: ${JSON.stringify(created)}`);
    console.log("[pbr-texture/meshy] task_id:", taskId);

    const deadline = Date.now() + T_ANY;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5_000));
      const poll = await fetch(`${MESHY_BASE}/v2/text-to-texture/${taskId}`, {
        headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000),
      });
      const pd = await poll.json() as {
        status?: string; model_url?: string;
        model_urls?: { glb?: string }; progress?: number;
      };
      console.log(`[pbr-texture/meshy] ${pd.status} (${pd.progress ?? 0}%)`);
      if (pd.status === "SUCCEEDED") {
        const url = pd.model_urls?.glb ?? pd.model_url;
        if (!url) throw new Error("Meshy: no GLB URL in result");
        return fetchAsBase64(url, auth);
      }
      if (pd.status === "FAILED" || pd.status === "EXPIRED")
        throw new Error(`Meshy task ${pd.status}`);
    }
    throw new Error("Meshy: timeout");
  } finally {
    unlink(filePath).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════
//  Tier 2: TripoAI — PBR image_to_model via node:https
// ══════════════════════════════════════════════════════════════════
async function runTripoFromImage(imageBuf: Buffer): Promise<string> {
  const auth = `Bearer ${process.env.TRIPO_API_KEY!}`;

  console.log("[pbr-texture/tripo] uploading reference image (node:https)…");
  const fileToken = await tripoUpload(imageBuf, `ref_${Date.now()}.png`, auth);
  console.log("[pbr-texture/tripo] image_token:", fileToken.slice(0, 12) + "…");

  // Create task via node:https (same reason — avoid undici JSON weirdness)
  const taskBody = Buffer.from(JSON.stringify({
    type:          "image_to_model",
    file:          { type: "png", file_token: fileToken },
    model_version: "v2.5-20250123",
    texture:       true,
    pbr:           true,
  }));

  const taskResp = await httpsRequest(
    "api.tripo3d.ai",
    "/v2/openapi/task",
    "POST",
    {
      Authorization:  auth,
      "Content-Type": "application/json",
      "Content-Length": taskBody.length.toString(),
    },
    taskBody,
  );

  const taskJson = JSON.parse(taskResp.body) as {
    code: number; message?: string; data?: { task_id?: string };
  };
  if (taskJson.code === 2010) throw new Error("tripo_no_credits");
  if (taskJson.code !== 0 || !taskJson.data?.task_id)
    throw new Error(`Tripo task create code ${taskJson.code}: ${taskJson.message ?? taskResp.body}`);

  const taskId = taskJson.data.task_id;
  console.log("[pbr-texture/tripo] task_id:", taskId);
  const modelUrl = await tripoTask(taskId, auth);
  return fetchAsBase64(modelUrl, auth);
}

// ══════════════════════════════════════════════════════════════════
//  Tier 3: Fal.ai — TripoSG (if balance available)
// ══════════════════════════════════════════════════════════════════
async function runFalTriposg(imageBase64: string): Promise<string> {
  const auth  = `Key ${process.env.FAL_API_KEY!}`;
  // Try the queue endpoint; fal-ai/triposg is the canonical model name
  const MODEL = "fal-ai/triposg";

  console.log("[pbr-texture/fal] submitting…");
  const submitRes = await fetch(`${FAL_BASE}/${MODEL}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageBase64 }),
    signal: AbortSignal.timeout(15_000),
  });
  const submitText = await submitRes.text();

  // Detect exhausted balance before surfacing a confusing error
  if (submitText.includes("Exhausted balance") || submitText.includes("locked"))
    throw new Error("fal_no_balance");
  if (!submitRes.ok) throw new Error(`Fal submit ${submitRes.status}: ${submitText}`);

  const sub = JSON.parse(submitText) as { request_id: string; status_url?: string; response_url?: string };
  const statusUrl = sub.status_url  ?? `${FAL_BASE}/${MODEL}/requests/${sub.request_id}/status`;
  const resultUrl = sub.response_url ?? `${FAL_BASE}/${MODEL}/requests/${sub.request_id}`;
  console.log("[pbr-texture/fal] request_id:", sub.request_id);

  const deadline = Date.now() + T_ANY;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4_000));
    const s  = await fetch(statusUrl, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) });
    const sd = await s.json() as { status?: string };
    console.log("[pbr-texture/fal] status:", sd.status);
    if (sd.status === "COMPLETED") {
      const r  = await fetch(resultUrl, { headers: { Authorization: auth }, signal: AbortSignal.timeout(T_ANY) });
      const rd = await r.json() as { model_mesh?: { url?: string } };
      const url = rd.model_mesh?.url;
      if (!url) throw new Error(`Fal: no model URL: ${JSON.stringify(rd)}`);
      return fetchAsBase64(url);
    }
    if (sd.status === "FAILED") throw new Error("Fal triposg: task failed");
  }
  throw new Error("Fal: timeout");
}

// ══════════════════════════════════════════════════════════════════
//  Tier 4: Hunyuan3D-2 (HuggingFace free, ZeroGPU)
//  Uses /generation_all which returns [shape.glb, textured.glb, ...]
//  Free: ~120 GPU-seconds/day (about 1-2 calls/day)
//  No API key needed — uses HUGGINGFACE_TOKEN if set for better quota
// ══════════════════════════════════════════════════════════════════
function hfHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = process.env.HUGGINGFACE_TOKEN;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

async function uploadToHunyuan(imageBase64: string): Promise<string> {
  const b64  = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf  = Buffer.from(b64, "base64");
  const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(buf)], { type: "image/png" }), name);
  const res = await fetch(`${HUNYUAN_SPACE}/upload`, {
    method: "POST", headers: hfHeaders(), body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HF upload ${res.status}`);
  const paths = await res.json() as string[];
  if (!paths[0]) throw new Error("HF upload returned no path");
  return paths[0];
}

async function readGradio6Stream(streamUrl: string, label: string): Promise<unknown[]> {
  for (let attempt = 0; attempt <= 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, Math.min(3000 * attempt, 10_000)));
    let sseRes: Response;
    try {
      sseRes = await fetch(streamUrl, { headers: hfHeaders(), signal: AbortSignal.timeout(T_ANY) });
    } catch (err) {
      if (attempt === 4) throw new Error(`${label} stream connect: ${err}`);
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
        const chunks = buf.split("\n\n"); buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const lines     = chunk.split("\n");
          const eventLine = lines.find(l => l.startsWith("event:"))?.slice(6).trim();
          const dataLine  = lines.find(l => l.startsWith("data:"))?.slice(5).trim();
          if (!dataLine || dataLine === "null") continue;
          if (eventLine === "error") {
            const msg = dataLine === "null"
              ? "ZeroGPU quota exhausted (resets UTC midnight)"
              : dataLine;
            throw new Error(`${label}: ${msg}`);
          }
          if (eventLine === "complete") return JSON.parse(dataLine) as unknown[];
        }
      }
    } catch (err) {
      if (String(err).includes("error:") || String(err).includes("quota")) throw err;
      if (attempt === 4) throw err;
      continue;
    }
    if (attempt < 4) continue;
  }
  throw new Error(`${label}: SSE failed`);
}

async function runHunyuan3dFree(imageBase64: string): Promise<string> {
  console.log("[pbr-texture/hunyuan3d] uploading image to HF…");
  const hfPath = await uploadToHunyuan(imageBase64);
  const imageArg = { path: hfPath, meta: { _type: "gradio.FileData" } };

  console.log("[pbr-texture/hunyuan3d] calling /generation_all…");
  const callRes = await fetch(`${HUNYUAN_SPACE}/call/generation_all`, {
    method: "POST",
    headers: hfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      data: [
        "",         // caption (empty — image-guided)
        imageArg,   // image
        null, null, null, null,  // mv front/back/left/right (optional)
        50,         // steps
        7.5,        // guidance_scale
        42,         // seed
        256,        // octree_resolution
        true,       // check_box_rembg
        200000,     // num_chunks
        false,      // randomize_seed
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!callRes.ok) throw new Error(`Hunyuan3D call ${callRes.status}: ${await callRes.text()}`);
  const { event_id } = await callRes.json() as { event_id: string };
  console.log("[pbr-texture/hunyuan3d] event_id:", event_id);

  // SSE stream — output[1] is the textured GLB (output[0] is untextured shape)
  const output = await readGradio6Stream(
    `${HUNYUAN_SPACE}/call/generation_all/${event_id}`,
    "hunyuan3d",
  );

  // output[1] = textured GLB FileData
  const fd = output[1] as { value?: { url?: string; path?: string }; url?: string; path?: string } | null;
  if (!fd) throw new Error("Hunyuan3D: no textured output");
  const file   = (fd as { value?: { url?: string; path?: string } }).value ?? fd as { url?: string; path?: string };
  const glbUrl = (file as { url?: string }).url
    ?? ((file as { path?: string }).path ? `${HUNYUAN_SPACE}/file=${(file as { path: string }).path}` : null);
  if (!glbUrl) throw new Error("Hunyuan3D: no GLB URL in output");

  console.log("[pbr-texture/hunyuan3d] downloading textured GLB…");
  return fetchAsBase64(glbUrl);
}

// ══════════════════════════════════════════════════════════════════
//  Known credit/balance error sentinels
// ══════════════════════════════════════════════════════════════════
const CREDIT_ERRORS = new Map<string, string>([
  ["tripo_no_credits", "TripoAI 本月免费额度已用完（每月1日重置，或在 platform.tripo3d.ai 充值）"],
  ["fal_no_balance",   "Fal.ai 余额不足，请在 fal.ai/dashboard/billing 充值"],
]);

// ══════════════════════════════════════════════════════════════════
//  Route handler
// ══════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const { glbBase64, imageBase64, prompt = "" } = await req.json() as {
    glbBase64: string; imageBase64: string; prompt?: string;
  };

  if (!glbBase64 || !imageBase64)
    return NextResponse.json({ error: "glbBase64 and imageBase64 required" }, { status: 400 });

  const glbBuf = Buffer.from(glbBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
  const imgBuf = Buffer.from(imageBase64.replace(/^data:[^;]+;base64,/, ""), "base64");

  const host     = req.headers.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const baseUrl  = process.env.NEXT_PUBLIC_BASE_URL ?? `${protocol}://${host}`;

  const backends = [
    {
      name: "meshy",     label: "Meshy AI（真实重贴图，保留原始几何）",
      key:  "MESHY_API_KEY" as string | null,
      fn:   () => runMeshyTexture(glbBuf, prompt, baseUrl),
      note: "几何结构完整保留，仅重新生成 Albedo + Normal + Roughness + AO 贴图",
      trueRetexture: true,
    },
    {
      name: "tripo",     label: "TripoAI PBR 生成",
      key:  "TRIPO_API_KEY" as string | null,
      fn:   () => runTripoFromImage(imgBuf),
      note: "从参考图 AI 重建新模型（几何由AI重构，非原始GLB）+ 完整 PBR",
      trueRetexture: false,
    },
    {
      name: "fal",       label: "Fal.ai TripoSG PBR 生成",
      key:  "FAL_API_KEY" as string | null,
      fn:   () => runFalTriposg(imageBase64),
      note: "从参考图 AI 重建新模型（几何由AI重构，非原始GLB）+ 完整 PBR",
      trueRetexture: false,
    },
    {
      name: "hunyuan3d", label: "Hunyuan3D-2（免费 · HuggingFace ZeroGPU）",
      key:  null,   // no API key required — always try
      fn:   () => runHunyuan3dFree(imageBase64),
      note: "从参考图重建新模型 + 完整纹理，每日 ~120 GPU秒免费额度",
      trueRetexture: false,
    },
  ];

  const errors: string[] = [];
  for (const b of backends) {
    // key=null means always try (no API key required)
    if (b.key !== null && !process.env[b.key]) {
      errors.push(`${b.name}: ${b.key} not configured`);
      continue;
    }
    try {
      console.log(`[pbr-texture] trying ${b.name}…`);
      const glbResult = await b.fn();
      console.log(`[pbr-texture] ✓ ${b.name} succeeded`);
      return NextResponse.json({
        glbBase64: glbResult, backend: b.name, backendLabel: b.label,
        note: b.note, trueRetexture: b.trueRetexture,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Translate sentinel codes to human-readable Chinese messages
      const friendly = CREDIT_ERRORS.get(raw) ?? raw;
      console.error(`[pbr-texture] ${b.name} failed:`, friendly);
      errors.push(`${b.name}: ${friendly}`);
    }
  }

  // Hunyuan3D is always tried (no key), so we never return "no_api_keys"
  return NextResponse.json({ error: errors.join(" | "), errors }, { status: 500 });
}
