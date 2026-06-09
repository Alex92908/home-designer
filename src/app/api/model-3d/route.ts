/**
 * POST /api/model-3d  ── 统一「图片 → 3D（GLB）」代理（BYOK）
 *
 * 取代 /api/trellis、/api/trellis2、/api/image-to-3d 三条碎片化路由。后端清单见
 * src/lib/model3dProviders.ts —— 加一个后端只改注册表 + 这里的 SPEC 一处。
 *
 * 关键约束（与项目 BYOK 口径一致）：
 *   • 密钥从请求体取（hfToken / falKey），绝不读 process.env、绝不落服务端、不回显。
 *   • 旧路由读 env 里的 HUGGINGFACE_TOKEN（且与 .env.local 的 HF_TOKEN 名字对不上，
 *     等于没生效）—— 这里彻底改成前端 BYOK 传入。
 *
 * Body:  { provider: "trellis"|"trellis2"|"hunyuan", hfToken?: string,
 *          falKey?: string, imageBase64: string }
 * Resp:  { glbBase64, glbUrl, id }  |  { error, quotaExceeded?, retryIn? }
 *
 * TRELLIS 1.0 / 2.0 走同一套 Gradio 队列驱动（差异仅 fn 索引 + 参数数组，见 SPECS）。
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import type { Model3dProviderId } from "@/lib/model3dProviders";

const T_ANY = 7_200_000; // 2h —— 大场景可能很慢

// ─── 各后端的 Gradio 管线规格（fn 索引 + 参数数组） ──────────────────────────
interface GradioSpec {
  apiBase: string; // upload / queue / file 都挂这个前缀（v1 = 根，v2 = /gradio_api）
  fnStartSession: number;
  fnEndSession: number;
  fnPreprocess: number;
  fnImageTo3d: number;
  fnExtractGlb: number;
  /** image_to_3d 的入参数组（preprocessed 为预处理后的图） */
  imageTo3dArgs: (preprocessed: unknown) => unknown[];
  /** extract_glb 的入参数组 */
  extractGlbArgs: unknown[];
}

const SPECS: Record<"trellis" | "trellis2", GradioSpec> = {
  // microsoft/TRELLIS —— 队列挂在根路径
  trellis: {
    apiBase: "https://microsoft-trellis.hf.space",
    fnStartSession: 4,
    fnEndSession: 5,
    fnPreprocess: 8,
    fnImageTo3d: 11,
    fnExtractGlb: 14,
    imageTo3dArgs: (img) => [
      img, [], null, 0, 7.5, 12, 3.0, 12, "stochastic",
    ],
    extractGlbArgs: [null, 0.95, 1024],
  },
  // microsoft/TRELLIS.2 —— 所有路径前缀 /gradio_api，1024 分辨率 + 2048 贴图
  trellis2: {
    apiBase: "https://microsoft-trellis-2.hf.space/gradio_api",
    fnStartSession: 2,
    fnEndSession: 3,
    fnPreprocess: 4,
    fnImageTo3d: 7,
    fnExtractGlb: 9,
    imageTo3dArgs: (img) => [
      img, 0, "1024", 7.5, 0.7, 12, 5.0, 7.5, 0.5, 12, 3.0, 1.0, 0.0, 12, 3.0,
    ],
    extractGlbArgs: [300000, 2048],
  },
};

// ─── HF 鉴权头（token 来自 BYOK，不读 env） ─────────────────────────────────
function hfHeaders(token: string | undefined, extra?: Record<string, string>): Record<string, string> {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ─── 冷启动重试（HF Space 冷启动 30-60s） ──────────────────────────────────
async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 4, delayMs = 15_000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isConnectErr =
        String(err).includes("ConnectTimeout") ||
        String(err).includes("UND_ERR_CONNECT") ||
        String(err).includes("fetch failed");
      if (isConnectErr && i < retries - 1) {
        console.log(`[model-3d] ${label} connect error, retry in ${delayMs / 1000}s (${i + 1}/${retries - 1})`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: all retries exhausted`);
}

// ─── 上传图片，拿服务端路径 ────────────────────────────────────────────────
async function uploadImage(apiBase: string, token: string | undefined, imageBase64: string): Promise<string> {
  const b64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  return withRetry(async () => {
    const form = new FormData();
    form.append("files", new Blob([buf], { type: "image/png" }), "input.png");
    const res = await fetch(`${apiBase}/upload`, {
      method: "POST",
      headers: hfHeaders(token),
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`/upload failed: ${res.status}`);
    const paths = (await res.json()) as string[];
    if (!paths[0]) throw new Error("upload returned no path");
    return paths[0];
  }, "upload");
}

// ─── Gradio 队列调用 —— 按 event_id 过滤 SSE ───────────────────────────────
async function callFn(
  apiBase: string,
  token: string | undefined,
  fnIndex: number,
  data: unknown[],
  sessionHash: string,
  timeoutMs: number,
): Promise<unknown[]> {
  const joinRes = await fetch(`${apiBase}/queue/join`, {
    method: "POST",
    headers: hfHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ fn_index: fnIndex, data, session_hash: sessionHash }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!joinRes.ok) {
    const txt = await joinRes.text().catch(() => "");
    throw new Error(`fn${fnIndex} queue/join ${joinRes.status}: ${txt}`);
  }
  const { event_id } = (await joinRes.json()) as { event_id: string };

  const sseRes = await fetch(`${apiBase}/queue/data?session_hash=${sessionHash}`, {
    headers: hfHeaders(token),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!sseRes.ok) throw new Error(`fn${fnIndex} queue/data ${sseRes.status}`);

  const reader = sseRes.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let msg: {
        msg?: string;
        event_id?: string;
        output?: { data?: unknown[]; error?: string | null };
        error?: string;
        success?: boolean;
      };
      try {
        msg = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (msg.event_id && msg.event_id !== event_id) continue;
      if (msg.msg === "process_completed") {
        if (msg.success === false) {
          const errMsg =
            msg.output?.error ?? msg.error ?? JSON.stringify(msg.output).slice(0, 200) ?? "unknown error";
          throw new Error(`fn${fnIndex} failed: ${errMsg}`);
        }
        return msg.output?.data ?? [];
      }
      if (msg.msg === "queue_full") throw new Error("queue is full — retry in a minute");
    }
  }
  throw new Error(`fn${fnIndex}: SSE stream closed without completion`);
}

// ─── 工具 ──────────────────────────────────────────────────────────────────
async function fetchAsBase64(url: string, token: string | undefined): Promise<string> {
  const r = await fetch(url, { headers: hfHeaders(token), signal: AbortSignal.timeout(T_ANY) });
  if (!r.ok) throw new Error(`fetch GLB ${r.status} from ${url}`);
  const buf = await r.arrayBuffer();
  return `data:model/gltf-binary;base64,${Buffer.from(buf).toString("base64")}`;
}

async function saveToDisk(b64: string, id: string, suffix: string): Promise<string | null> {
  try {
    const dir = path.join(process.cwd(), "public", "models", "generated");
    await mkdir(dir, { recursive: true });
    const raw = b64.replace(/^data:[^;]+;base64,/, "");
    const fp = path.join(dir, `${id}_${suffix}.glb`);
    await writeFile(fp, Buffer.from(raw, "base64"));
    return `/models/generated/${id}_${suffix}.glb`;
  } catch {
    return null;
  }
}

function isQuotaError(msg: string): boolean {
  return (
    msg.includes("ZeroGPU quota") ||
    msg.includes("GPU quota") ||
    msg.includes("exceeded your")
  );
}

// ─── Hunyuan3D-2（腾讯 HF Space）—— Gradio 新版 /call API ────────────────────
//
// 与 TRELLIS 的 queue/join 不同，Hunyuan 走 /call/{fn} → event_id → SSE 取
// `complete` 事件。契约取自已验证的 /api/pbr-texture（runHunyuan3dFree）。
// /generation_all 返回 [shape.glb, textured.glb, ...]，取 output[1] 带贴图的那个。
const HUNYUAN_SPACE = "https://tencent-hunyuan3d-2.hf.space";

async function uploadToHunyuan(token: string | undefined, imageBase64: string): Promise<string> {
  const b64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
  const form = new FormData();
  form.append("files", new Blob([buf], { type: "image/png" }), name);
  const res = await fetch(`${HUNYUAN_SPACE}/upload`, {
    method: "POST",
    headers: hfHeaders(token),
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HF upload ${res.status}`);
  const paths = (await res.json()) as string[];
  if (!paths[0]) throw new Error("HF upload returned no path");
  return paths[0];
}

async function readHunyuanStream(streamUrl: string, token: string | undefined): Promise<unknown[]> {
  for (let attempt = 0; attempt <= 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(3000 * attempt, 10_000)));
    let sseRes: Response;
    try {
      sseRes = await fetch(streamUrl, { headers: hfHeaders(token), signal: AbortSignal.timeout(T_ANY) });
    } catch (err) {
      if (attempt === 4) throw new Error(`hunyuan stream connect: ${err}`);
      continue;
    }
    if (!sseRes.ok) throw new Error(`hunyuan stream ${sseRes.status}`);
    const reader = sseRes.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
          const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
          if (!dataLine || dataLine === "null") continue;
          if (eventLine === "error") {
            const msg = dataLine === "null" ? "ZeroGPU quota exhausted (resets UTC midnight)" : dataLine;
            throw new Error(`hunyuan: ${msg}`);
          }
          if (eventLine === "complete") return JSON.parse(dataLine) as unknown[];
        }
      }
    } catch (err) {
      if (String(err).includes("hunyuan:") || String(err).includes("quota")) throw err;
      if (attempt === 4) throw err;
      continue;
    }
  }
  throw new Error("hunyuan: SSE failed");
}

async function runHunyuan(
  token: string | undefined,
  imageBase64: string,
  id: string,
  suffix: string,
): Promise<{ glbBase64: string; glbUrl: string | null }> {
  const hfPath = await uploadToHunyuan(token, imageBase64);
  const imageArg = { path: hfPath, meta: { _type: "gradio.FileData" } };

  const callRes = await fetch(`${HUNYUAN_SPACE}/call/generation_all`, {
    method: "POST",
    headers: hfHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      data: [
        "", // caption（空 —— 图像引导）
        imageArg, // image
        null, null, null, null, // mv front/back/left/right（可选）
        50, // steps
        7.5, // guidance_scale
        42, // seed
        256, // octree_resolution
        true, // check_box_rembg
        200000, // num_chunks
        false, // randomize_seed
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!callRes.ok) throw new Error(`Hunyuan call ${callRes.status}: ${await callRes.text()}`);
  const { event_id } = (await callRes.json()) as { event_id: string };

  const output = await readHunyuanStream(`${HUNYUAN_SPACE}/call/generation_all/${event_id}`, token);

  // output[1] = 带贴图 GLB（output[0] 是无贴图 shape）
  const fd = output[1] as { value?: { url?: string; path?: string }; url?: string; path?: string } | null;
  if (!fd) throw new Error("Hunyuan: no textured output");
  const file = (fd as { value?: { url?: string; path?: string } }).value ?? (fd as { url?: string; path?: string });
  const glbUrl0 =
    (file as { url?: string }).url ??
    ((file as { path?: string }).path ? `${HUNYUAN_SPACE}/file=${(file as { path: string }).path}` : null);
  if (!glbUrl0) throw new Error("Hunyuan: no GLB URL in output");

  const glbBase64 = await fetchAsBase64(glbUrl0, token);
  const glbUrl = await saveToDisk(glbBase64, id, suffix);
  return { glbBase64, glbUrl };
}

// ─── TRELLIS 1.0 / 2.0 共用管线 ─────────────────────────────────────────────
async function runTrellis(
  spec: GradioSpec,
  token: string | undefined,
  imageBase64: string,
  id: string,
  suffix: string,
): Promise<{ glbBase64: string; glbUrl: string | null }> {
  const sess = Math.random().toString(36).slice(2, 12);
  const apiBase = spec.apiBase;

  const uploadedPath = await uploadImage(apiBase, token, imageBase64);
  const imageInput = { path: uploadedPath, url: null, orig_name: "input.png", size: null };

  await callFn(apiBase, token, spec.fnStartSession, [], sess, T_ANY);
  try {
    const prep = await callFn(apiBase, token, spec.fnPreprocess, [imageInput], sess, T_ANY);
    const preprocessed = prep[0] ?? imageInput;

    await callFn(apiBase, token, spec.fnImageTo3d, spec.imageTo3dArgs(preprocessed), sess, T_ANY);

    const glbOut = await callFn(apiBase, token, spec.fnExtractGlb, spec.extractGlbArgs, sess, T_ANY);
    const dlFile = (glbOut[1] ?? glbOut[0]) as { data?: string; url?: string; path?: string } | null;
    if (!dlFile) throw new Error(`No GLB in output: ${JSON.stringify(glbOut)}`);

    let glbBase64: string;
    if (dlFile.data && dlFile.data.length > 100) {
      glbBase64 = dlFile.data.startsWith("data:") ? dlFile.data : `data:model/gltf-binary;base64,${dlFile.data}`;
    } else {
      const url = dlFile.url ?? (dlFile.path ? `${apiBase}/file=${dlFile.path}` : null);
      if (!url) throw new Error(`GLB file missing url/path: ${JSON.stringify(dlFile)}`);
      glbBase64 = await fetchAsBase64(url, token);
    }
    const glbUrl = await saveToDisk(glbBase64, id, suffix);
    return { glbBase64, glbUrl };
  } finally {
    callFn(apiBase, token, spec.fnEndSession, [], sess, T_ANY).catch(() => {});
  }
}

// ─── 路由 ───────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let body: { provider?: Model3dProviderId; hfToken?: string; falKey?: string; imageBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider ?? "trellis2";
  const imageBase64 = body.imageBase64;
  if (!imageBase64) return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });

  console.log(`[model-3d] id=${id} provider=${provider}`);

  try {
    if (provider === "trellis" || provider === "trellis2") {
      const { glbBase64, glbUrl } = await runTrellis(
        SPECS[provider],
        body.hfToken?.trim() || undefined,
        imageBase64,
        id,
        provider,
      );
      return NextResponse.json({ glbBase64, glbUrl, id });
    }

    if (provider === "hunyuan") {
      const { glbBase64, glbUrl } = await runHunyuan(
        body.hfToken?.trim() || undefined,
        imageBase64,
        id,
        provider,
      );
      return NextResponse.json({ glbBase64, glbUrl, id });
    }

    return NextResponse.json({ error: `unknown provider: ${provider}` }, { status: 400 });
  } catch (err) {
    const msg = String(err);
    console.error("[model-3d]", msg);
    if (isQuotaError(msg)) {
      const retryMatch = msg.match(/Try again in (\d+:\d+:\d+)/);
      return NextResponse.json(
        { error: msg, quotaExceeded: true, retryIn: retryMatch?.[1] ?? "24:00:00" },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
