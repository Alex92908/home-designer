"use client";

import { useCallback, useRef, useState } from "react";
import {
  getAiRenderConfig,
  getBackend,
  type RenderWorkflow,
  type RenderBackend,
} from "./aiRenderConfig";
import { useLocaleStore } from "./i18n";

// ─── 通用 AI 出图客户端编排 ────────────────────────────────────────────────
// 上传 → 提交 → 轮询 → 取图。后端差异全在 /api/airender 代理里处理，这里只按
// 工作流配置组装请求，统一暴露 phase/images/error。

export type RenderPhase = "idle" | "uploading" | "submitting" | "rendering" | "done" | "error";

export interface RenderArgs {
  workflow: RenderWorkflow;
  prompt: string;
  image?: string;   // data URL（needsImage 的工作流用）
}

interface ProxyResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function callProxy<T>(payload: Record<string, unknown>): Promise<ProxyResult<T>> {
  try {
    const res = await fetch("/api/airender", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as T & { error?: string; detail?: string };
    if (!res.ok || (data as { error?: string }).error) {
      return { ok: false, error: (data as { detail?: string }).detail ?? (data as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// RunningHub 的原始报错（如 NODE_INFO_MISMATCH(nodeId=18,fieldName=prompt,
// reason=field_not_found_in_node_inputs)）对用户是天书。这里把已知模式翻成
// 「该改哪个设置」的可操作中文/英文。节点不匹配 = 预设里默认的节点号/字段名
// 跟用户 RunningHub 账号里那条工作流对不上 → 去设置改 mapping 即可。
function friendlyRenderError(raw: string | undefined, en: boolean): string {
  const fallback = en ? "Task submission failed" : "任务提交失败";
  if (!raw) return fallback;
  const m = /NODE_INFO_MISMATCH\(nodeId=([^,]+),\s*fieldName=([^,)]+)/i.exec(raw);
  if (m) {
    const [, nodeId, field] = m;
    return en
      ? `Node ${nodeId} has no “${field}” field in your RunningHub workflow. Open settings and change the prompt/image node ID & field to match the actual text/image node in your workflow.`
      : `你 RunningHub 工作流里第 ${nodeId} 号节点没有「${field}」字段。请打开设置，把「提示词/输入图 节点号·字段」改成你工作流里实际的文本/图片节点。`;
  }
  if (/field_not_found_in_node_inputs/i.test(raw)) {
    return en
      ? `A configured node/field doesn't exist in your RunningHub workflow. Fix the node IDs in settings. (${raw})`
      : `配置的节点号/字段在你 RunningHub 工作流里不存在，请到设置里修正节点号。（${raw}）`;
  }
  return raw;
}

export function useAiRender() {
  const [phase, setPhase] = useState<RenderPhase>("idle");
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const reset = useCallback(() => {
    cancelledRef.current = false;
    setPhase("idle");
    setImages([]);
    setError(null);
  }, []);

  const cancel = useCallback(() => { cancelledRef.current = true; }, []);

  const generate = useCallback(async (args: RenderArgs): Promise<string[] | null> => {
    cancelledRef.current = false;
    setError(null);
    setImages([]);
    const en = useLocaleStore.getState().locale === "en";

    const config = getAiRenderConfig();
    const backend: RenderBackend | undefined = getBackend(config, args.workflow.backendId);
    if (!backend) {
      setError(en ? "This workflow isn't bound to a valid backend. Check the settings."
                  : "该工作流未绑定有效后端，请在设置里检查。");
      setPhase("error");
      return null;
    }
    if (backend.kind === "runninghub" && !backend.apiKey?.trim()) {
      setError(en ? "The RunningHub backend is missing an API key. Add it in settings first."
                  : "RunningHub 后端缺少 API Key，请先在设置里填写。");
      setPhase("error");
      return null;
    }

    const base = {
      kind: backend.kind,
      baseUrl: backend.baseUrl,
      apiKey: backend.apiKey,
    };

    // 1) 上传输入图
    let imageFilename: string | undefined;
    if (args.workflow.needsImage && args.image) {
      setPhase("uploading");
      const up = await callProxy<{ fileName: string }>({ ...base, action: "upload", image: args.image });
      if (cancelledRef.current) return null;
      if (!up.ok || !up.data?.fileName) {
        setError(up.error ?? (en ? "Image upload failed" : "图片上传失败"));
        setPhase("error");
        return null;
      }
      imageFilename = up.data.fileName;
    }

    // 2) 提交任务
    setPhase("submitting");
    // comfyui 系：若工作流来自素材包预设，按需 fetch 原始 JSON（避免塞 localStorage）
    let workflowJson = args.workflow.workflowJson;
    if (!workflowJson && args.workflow.presetPath && backend.kind !== "runninghub") {
      try {
        const r = await fetch(args.workflow.presetPath);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        workflowJson = await r.text();
      } catch (e) {
        setError(`${en ? "Failed to load preset workflow: " : "读取预设工作流失败："}${e instanceof Error ? e.message : String(e)}`);
        setPhase("error");
        return null;
      }
    }
    const submitted = await callProxy<{ taskId: string }>({
      ...base,
      action: "submit",
      workflowId: args.workflow.workflowId,
      workflowJson,
      mapping: args.workflow.mapping,
      prompt: args.prompt,
      imageFilename,
    });
    if (cancelledRef.current) return null;
    if (!submitted.ok || !submitted.data?.taskId) {
      setError(friendlyRenderError(submitted.error, en));
      setPhase("error");
      return null;
    }
    const taskId = submitted.data.taskId;

    // 3) 轮询状态（最多约 5 分钟）
    setPhase("rendering");
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      if (cancelledRef.current) return null;
      await sleep(4000);
      const st = await callProxy<{ status: string }>({ ...base, action: "status", taskId });
      if (cancelledRef.current) return null;
      const status = String(st.data?.status ?? "").toUpperCase();
      if (status === "SUCCESS") break;
      if (status === "FAILED" || status === "ERROR") {
        setError(en ? "Render failed (backend returned FAILED)" : "渲染失败（后端返回 FAILED）");
        setPhase("error");
        return null;
      }
    }

    // 4) 取产出
    const out = await callProxy<{ images: string[] }>({ ...base, action: "outputs", taskId });
    if (cancelledRef.current) return null;
    if (!out.ok || !out.data?.images?.length) {
      setError(out.error ?? (en ? "No output image (may still be queued — try again later)" : "未取到产出图（可能仍在排队，稍后重试）"));
      setPhase("error");
      return null;
    }
    setImages(out.data.images);
    setPhase("done");
    return out.data.images;
  }, []);

  return { phase, images, error, generate, reset, cancel };
}
