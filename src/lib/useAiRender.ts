"use client";

import { useCallback, useRef, useState } from "react";
import {
  getAiRenderConfig,
  getBackend,
  type RenderWorkflow,
  type RenderBackend,
} from "./aiRenderConfig";

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

    const config = getAiRenderConfig();
    const backend: RenderBackend | undefined = getBackend(config, args.workflow.backendId);
    if (!backend) {
      setError("该工作流未绑定有效后端，请在设置里检查。");
      setPhase("error");
      return null;
    }
    if (backend.kind === "runninghub" && !backend.apiKey?.trim()) {
      setError("RunningHub 后端缺少 API Key，请先在设置里填写。");
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
        setError(up.error ?? "图片上传失败");
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
        setError(`读取预设工作流失败：${e instanceof Error ? e.message : String(e)}`);
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
      setError(submitted.error ?? "任务提交失败");
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
        setError("渲染失败（后端返回 FAILED）");
        setPhase("error");
        return null;
      }
    }

    // 4) 取产出
    const out = await callProxy<{ images: string[] }>({ ...base, action: "outputs", taskId });
    if (cancelledRef.current) return null;
    if (!out.ok || !out.data?.images?.length) {
      setError(out.error ?? "未取到产出图（可能仍在排队，稍后重试）");
      setPhase("error");
      return null;
    }
    setImages(out.data.images);
    setPhase("done");
    return out.data.images;
  }, []);

  return { phase, images, error, generate, reset, cancel };
}
