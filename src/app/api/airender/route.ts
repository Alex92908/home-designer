import { NextRequest, NextResponse } from "next/server";
import { isUiGraph, uiGraphToApiPrompt } from "@/lib/comfyGraphConvert";

// ─── 通用 AI 出图代理 ──────────────────────────────────────────────────────
//
// 一个路由覆盖三种后端（comfyui-local / comfyui-http / runninghub）。
// 客户端把后端信息（kind/baseUrl/apiKey）随每次请求发来（BYOK），代理只转发，
// 绝不打印/落库密钥。前端按 action 分步调用，保证单个请求都很短。
//
// action：
//   "upload"  —— 上传一张 data URL 图片，返回后端里的文件名
//   "submit"  —— 提交任务（按 kind 走 ComfyUI /prompt 或 RunningHub openapi）
//   "status"  —— 查询任务状态（统一返回 QUEUED/RUNNING/SUCCESS/FAILED）
//   "outputs" —— 拉取产出图 URL 数组

export const maxDuration = 60;

type Kind = "comfyui-local" | "comfyui-http" | "runninghub";

interface NodeMapping {
  promptNodeId?: string;
  promptField?: string;
  imageNodeId?: string;
  imageField?: string;
}

interface Body {
  action: "upload" | "submit" | "status" | "outputs";
  kind: Kind;
  baseUrl?: string;
  apiKey?: string;
  // upload
  image?: string;
  // submit
  workflowId?: string;       // runninghub
  workflowJson?: string;     // comfyui (API-format graph)
  mapping?: NodeMapping;
  prompt?: string;
  imageFilename?: string;
  // status / outputs
  taskId?: string;
}

const COMFY_CLIENT = "home-designer";

function normBase(baseUrl: string | undefined, kind: Kind): string {
  if (baseUrl && baseUrl.trim()) return baseUrl.replace(/\/$/, "");
  return kind === "comfyui-local" ? "http://localhost:8188" : "https://www.runninghub.ai";
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { action, kind } = body;
  const base = normBase(body.baseUrl, kind);
  const isComfy = kind === "comfyui-local" || kind === "comfyui-http";

  if (kind === "runninghub" && !body.apiKey?.trim()) {
    return NextResponse.json({ error: "missing_api_key", detail: "RunningHub 后端需要先在设置里填写 API Key" }, { status: 503 });
  }

  try {
    // ════════════════════════════ UPLOAD ════════════════════════════
    if (action === "upload") {
      if (!body.image) return NextResponse.json({ error: "missing_image" }, { status: 400 });
      const buf = Buffer.from(body.image.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const form = new FormData();

      if (isComfy) {
        // ComfyUI 原生：POST /upload/image
        form.append("image", new Blob([buf], { type: "image/png" }), `hd_${Date.now()}.png`);
        form.append("overwrite", "true");
        const r = await fetch(`${base}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(45000) });
        if (!r.ok) return NextResponse.json({ error: "upload_failed", detail: `HTTP ${r.status}` }, { status: 502 });
        const data = await r.json().catch(() => ({}));
        return NextResponse.json({ fileName: data?.name });
      }

      // RunningHub：POST /task/openapi/upload
      form.append("apiKey", body.apiKey!);
      form.append("fileType", "image");
      form.append("file", new Blob([buf], { type: "image/png" }), `hd_${Date.now()}.png`);
      const r = await fetch(`${base}/task/openapi/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(45000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.code !== 0) return NextResponse.json({ error: "upload_failed", detail: data?.msg ?? `HTTP ${r.status}` }, { status: 502 });
      return NextResponse.json({ fileName: data?.data?.fileName ?? data?.data?.name ?? data?.data });
    }

    // ════════════════════════════ SUBMIT ════════════════════════════
    if (action === "submit") {
      const map = body.mapping ?? {};
      if (isComfy) {
        if (!body.workflowJson) return NextResponse.json({ error: "missing_workflow_json" }, { status: 400 });
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.workflowJson);
        } catch {
          return NextResponse.json({ error: "bad_workflow_json", detail: "工作流 JSON 解析失败" }, { status: 400 });
        }
        // 素材包是「UI 图」格式 → 取目标 ComfyUI 的 object_info 即时转「API」格式
        let graph: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
        if (isUiGraph(parsed)) {
          let objectInfo: Record<string, { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }>;
          try {
            const oi = await fetch(`${base}/object_info`, { signal: AbortSignal.timeout(30000) });
            if (!oi.ok) throw new Error(`object_info HTTP ${oi.status}`);
            objectInfo = await oi.json();
          } catch (e) {
            return NextResponse.json({ error: "object_info_failed", detail: `无法连接 ComfyUI 取节点定义（${base}）：${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
          }
          const conv = uiGraphToApiPrompt(parsed, objectInfo);
          if (!conv.ok || !conv.prompt) {
            return NextResponse.json({ error: "convert_failed", detail: conv.error ?? "UI→API 转换失败" }, { status: 422 });
          }
          graph = conv.prompt;
        } else {
          graph = parsed as typeof graph;
        }
        // 注入提示词
        if (map.promptNodeId && graph[map.promptNodeId]) {
          graph[map.promptNodeId].inputs = { ...(graph[map.promptNodeId].inputs ?? {}), [map.promptField || "text"]: body.prompt ?? "" };
        }
        // 注入输入图
        if (body.imageFilename && map.imageNodeId && graph[map.imageNodeId]) {
          graph[map.imageNodeId].inputs = { ...(graph[map.imageNodeId].inputs ?? {}), [map.imageField || "image"]: body.imageFilename };
        }
        const r = await fetch(`${base}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: graph, client_id: COMFY_CLIENT }),
          signal: AbortSignal.timeout(45000),
        });
        if (!r.ok) {
          const text = await r.text();
          return NextResponse.json({ error: "submit_failed", detail: text }, { status: 502 });
        }
        const data = await r.json() as { prompt_id?: string };
        return NextResponse.json({ taskId: data.prompt_id });
      }

      // RunningHub：按 mapping 构造 nodeInfoList
      if (!body.workflowId) return NextResponse.json({ error: "missing_workflow_id" }, { status: 400 });
      const nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }> = [];
      if (map.promptNodeId) nodeInfoList.push({ nodeId: map.promptNodeId, fieldName: map.promptField || "text", fieldValue: body.prompt ?? "" });
      if (body.imageFilename && map.imageNodeId) nodeInfoList.push({ nodeId: map.imageNodeId, fieldName: map.imageField || "image", fieldValue: body.imageFilename });
      const r = await fetch(`${base}/task/openapi/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Host: new URL(base).host },
        body: JSON.stringify({ apiKey: body.apiKey, workflowId: body.workflowId, nodeInfoList }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.code !== 0) return NextResponse.json({ error: "submit_failed", detail: data?.msg ?? `HTTP ${r.status}` }, { status: 502 });
      return NextResponse.json({ taskId: data?.data?.taskId ?? data?.data });
    }

    // ════════════════════════════ STATUS ════════════════════════════
    if (action === "status") {
      if (!body.taskId) return NextResponse.json({ error: "missing_task_id" }, { status: 400 });
      if (isComfy) {
        // ComfyUI 无独立 status；查 /history/{id}，有产出即 SUCCESS，否则仍在跑
        const r = await fetch(`${base}/history/${body.taskId}`, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) return NextResponse.json({ error: "status_failed", detail: `HTTP ${r.status}` }, { status: 502 });
        const data = await r.json().catch(() => ({}));
        const entry = data?.[body.taskId];
        const done = entry && entry.outputs && Object.keys(entry.outputs).length > 0;
        return NextResponse.json({ status: done ? "SUCCESS" : "RUNNING" });
      }
      const r = await fetch(`${base}/task/openapi/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Host: new URL(base).host },
        body: JSON.stringify({ apiKey: body.apiKey, taskId: body.taskId }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return NextResponse.json({ error: "status_failed", detail: `HTTP ${r.status}` }, { status: 502 });
      return NextResponse.json({ status: data?.data });
    }

    // ════════════════════════════ OUTPUTS ═══════════════════════════
    if (action === "outputs") {
      if (!body.taskId) return NextResponse.json({ error: "missing_task_id" }, { status: 400 });
      if (isComfy) {
        const r = await fetch(`${base}/history/${body.taskId}`, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) return NextResponse.json({ error: "outputs_failed", detail: `HTTP ${r.status}` }, { status: 502 });
        const data = await r.json().catch(() => ({}));
        const entry = data?.[body.taskId];
        const images: string[] = [];
        const outputs = entry?.outputs ?? {};
        for (const nodeId of Object.keys(outputs)) {
          const imgs: Array<{ filename?: string; subfolder?: string; type?: string }> = outputs[nodeId]?.images ?? [];
          for (const im of imgs) {
            if (!im.filename) continue;
            const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder ?? "", type: im.type ?? "output" });
            images.push(`${base}/view?${q.toString()}`);
          }
        }
        return NextResponse.json({ images });
      }
      const r = await fetch(`${base}/task/openapi/outputs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Host: new URL(base).host },
        body: JSON.stringify({ apiKey: body.apiKey, taskId: body.taskId }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.code !== 0) return NextResponse.json({ error: "outputs_failed", detail: data?.msg ?? `HTTP ${r.status}` }, { status: 502 });
      const items: Array<{ fileUrl?: string }> = Array.isArray(data?.data) ? data.data : [];
      return NextResponse.json({ images: items.map((it) => it.fileUrl).filter((u): u is string => typeof u === "string") });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("airender proxy error:", action, kind, msg);
    return NextResponse.json({ error: "internal_error", detail: msg }, { status: 500 });
  }
}
