// ─── 通用 AI 出图配置（后端 + 工作流均可自由增删）────────────────────────────
//
// 不锁死任何一家服务商。出图后端抽象成「provider」：
//   - comfyui-local : 本地 ComfyUI（默认 http://localhost:8188，无需 key）
//   - comfyui-http  : 任意自建/第三方 ComfyUI HTTP 服务（填 baseUrl，可选 key）
//   - runninghub    : RunningHub 云（openapi，需要 apiKey + workflowId）
//
// 这三者都说同一种「ComfyUI 工作流」语言，差别只在「提交端点 + 鉴权」。
// 配置只存浏览器 localStorage，请求经本站 /api/airender 代理转发，密钥不落服务端。

export type BackendKind = "comfyui-local" | "comfyui-http" | "runninghub";

export interface RenderBackend {
  id: string;
  name: string;
  kind: BackendKind;
  baseUrl?: string;   // comfyui-http 必填；local/runninghub 有默认值
  apiKey?: string;    // runninghub 必填；自建按需
}

/** 把提示词 / 输入图注入工作流时，指明落到哪个节点的哪个字段 */
export interface NodeMapping {
  promptNodeId?: string;
  promptField?: string;   // 默认 "text"
  imageNodeId?: string;
  imageField?: string;    // 默认 "image"
}

export interface RenderWorkflow {
  id: string;
  name: string;
  backendId: string;            // 指向某个 RenderBackend
  needsImage: boolean;          // 是否需要输入图（image→image）
  mapping: NodeMapping;
  // runninghub 用 workflowId；comfyui 用内嵌的工作流 JSON 文本
  workflowId?: string;
  workflowJson?: string;
  // 来自素材包预设：public 下的原始 ComfyUI JSON 路径。运行时按需 fetch，
  // 避免把几十个大 JSON 塞进 localStorage。comfyui 后端会即时把 UI 图转成 API 格式。
  presetPath?: string;
  category?: string;            // 预设分类，仅用于 UI 分组展示
}

export interface AiRenderConfig {
  backends: RenderBackend[];
  workflows: RenderWorkflow[];
}

const STORAGE_KEY = "home-designer-airender";

export const DEFAULT_CONFIG: AiRenderConfig = {
  backends: [
    { id: "local",      name: "本地 ComfyUI", kind: "comfyui-local", baseUrl: "http://localhost:8188" },
    { id: "runninghub", name: "RunningHub 云", kind: "runninghub",    baseUrl: "https://www.runninghub.ai", apiKey: "" },
  ],
  workflows: [],
};

export function getAiRenderConfig(): AiRenderConfig {
  if (typeof window === "undefined") return structuredClone(DEFAULT_CONFIG);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw) as Partial<AiRenderConfig>;
    return {
      backends: parsed.backends?.length ? parsed.backends : structuredClone(DEFAULT_CONFIG.backends),
      workflows: parsed.workflows ?? [],
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveAiRenderConfig(config: AiRenderConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function getBackend(config: AiRenderConfig, backendId: string): RenderBackend | undefined {
  return config.backends.find((b) => b.id === backendId);
}

export function defaultBaseUrl(kind: BackendKind): string {
  switch (kind) {
    case "comfyui-local": return "http://localhost:8188";
    case "runninghub":    return "https://www.runninghub.ai";
    default:              return "";
  }
}

/** 是否至少有一个可用工作流（且其后端凭证齐备） */
export function hasUsableWorkflow(config: AiRenderConfig): boolean {
  return config.workflows.some((w) => {
    const b = getBackend(config, w.backendId);
    if (!b) return false;
    if (b.kind === "runninghub") return Boolean(b.apiKey?.trim() && w.workflowId?.trim());
    return Boolean(w.workflowJson?.trim() || w.presetPath); // comfyui 系：要有工作流 JSON 或预设
  });
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── 预设 → 工作流（供设置面板批量导入 & 视图内一键直达共用）────────────────
import type { WorkflowPreset } from "./workflowPresets";

/** cloud 预设挂第一个 RunningHub 后端；local 预设挂第一个 ComfyUI 后端 */
export function backendIdForPreset(config: AiRenderConfig, cloud: boolean): string {
  if (cloud) return config.backends.find((b) => b.kind === "runninghub")?.id ?? config.backends[0]?.id ?? "";
  return config.backends.find((b) => b.kind === "comfyui-local" || b.kind === "comfyui-http")?.id ?? config.backends[0]?.id ?? "";
}

export function buildWorkflowFromPreset(config: AiRenderConfig, preset: WorkflowPreset): RenderWorkflow {
  return {
    id: newId("wf"),
    name: preset.name,
    category: preset.category,
    backendId: backendIdForPreset(config, preset.cloud),
    needsImage: preset.needsImage,
    mapping: { promptNodeId: preset.promptNodeId, promptField: preset.promptField || "text", imageNodeId: preset.imageNodeId, imageField: "image" },
    workflowId: "",
    presetPath: preset.jsonPath,
  };
}

/**
 * 找出（或按需创建并持久化）某预设对应的工作流。
 * 用于「视图内一键出图」：第一次点会自动导入到工作流列表，之后复用。
 */
export function ensureWorkflowForPreset(preset: WorkflowPreset): RenderWorkflow {
  const config = getAiRenderConfig();
  const existing = config.workflows.find((w) => w.presetPath === preset.jsonPath);
  if (existing) return existing;
  const wf = buildWorkflowFromPreset(config, preset);
  saveAiRenderConfig({ ...config, workflows: [...config.workflows, wf] });
  return wf;
}
